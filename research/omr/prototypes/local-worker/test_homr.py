"""HOMR adapter boundary checks; fake recognizer output is not accuracy evidence."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import pytest
import homr

def digest(data):
    return hashlib.sha256(data).hexdigest()

@pytest.fixture
def prepared(tmp_path,monkeypatch):
    bundle=tmp_path/"toolchain"
    source=bundle/f"homr-{homr.COMMIT}-piano-cues"
    (source/"homr").mkdir(parents=True)
    (source/"homr/main.py").write_bytes(b"pass\n")
    (source/"homr/model.onnx").write_bytes(b"pinned-model")
    homr.venv_python(bundle).parent.mkdir(parents=True)
    homr.venv_python(bundle).write_bytes(b"test-launcher")
    requirements=tmp_path/"requirements.txt"
    requirements.write_text("onnxruntime==1.0\n")
    (bundle/"installed.txt").write_text("onnxruntime==1.0\n")
    manifest=tmp_path/"manifest.json"
    manifest.write_text(json.dumps({"commit":homr.COMMIT,"patched":{"homr/main.py":digest(b"pass\n")}}))
    monkeypatch.setattr(homr,"SOURCE_MANIFEST_PATH",manifest)
    monkeypatch.setattr(homr,"REQUIREMENTS_PATH",requirements)
    monkeypatch.setattr(homr,"MODELS",{"homr/model.onnx":digest(b"pinned-model")})
    return bundle,source

def test_interpreter_path_follows_the_platform():
    assert homr.venv_python(Path("t"), "nt") == Path("t/venv/Scripts/python.exe")
    assert homr.venv_python(Path("t"), "posix") == Path("t/venv/bin/python")

def test_preflight_rejects_missing_or_changed_model(prepared):
    bundle,source=prepared
    (source/"homr/model.onnx").write_bytes(b"changed")
    with pytest.raises(ValueError,match="model hash"):
        homr.Homr(bundle)

def test_preflight_rejects_unexpected_source(prepared):
    bundle,source=prepared
    (source/"homr/unexpected.py").write_text("pass")
    with pytest.raises(ValueError,match="source differs"):
        homr.Homr(bundle)

def test_preflight_rejects_dependency_manifest_mismatch(prepared):
    bundle,_=prepared
    (bundle/"installed.txt").write_text("onnxruntime==2.0\n")
    with pytest.raises(ValueError,match="dependency"):
        homr.Homr(bundle)

def test_original_input_isolation_and_per_job_audits(prepared,tmp_path,monkeypatch):
    bundle,_=prepared
    adapter=homr.Homr(bundle)
    job=tmp_path/"job";job.mkdir()
    source=job/"input.jpeg";source.write_bytes(b"original-private-bytes")
    monkeypatch.setenv("PYTHONPATH","do-not-inherit")
    monkeypatch.setenv("PYTHONHOME","do-not-inherit")
    captured={}
    def run(command,directory,env,cancelled,timeout,log):
        captured.update(command=command,env=env,timeout=timeout)
        local=Path(command[-1])
        assert local.read_bytes()==b"original-private-bytes"
        local.with_suffix(".musicxml").write_text('<score-partwise><part><measure><note><pitch><step>C</step><octave>4</octave></pitch></note></measure></part></score-partwise>')
        local.with_name(local.stem+"_piano-cues.json").write_text(json.dumps({"removed":[{"systemIndex":2}]}))
        (directory/(local.stem+"_foreign-staff-0.json")).write_text(json.dumps({"removed":[{"bounds":[1,2,3,4]}]}))
    monkeypatch.setattr(homr,"run_process",run)
    output=adapter(source,job,threading.Event())
    assert output==job/"result.musicxml"
    assert source.read_bytes()==b"original-private-bytes"
    assert captured["command"][1:4]==["-I","-B","-c"]
    assert "--no-title" in captured["command"][4]
    assert "PYTHONPATH" not in captured["env"] and "PYTHONHOME" not in captured["env"]
    for key in ["HOME","USERPROFILE","APPDATA","LOCALAPPDATA","TEMP","TMP"]:
        assert Path(captured["env"][key]).is_relative_to(job)
    metadata=adapter.metadata_for(source,job)
    assert metadata["omittedStaffRegions"]==1 and metadata["maskedStaffRegions"]==1
    assert metadata["recognizer"]==adapter.name
    assert metadata["warnings"][-1]["code"]=="recognition-auxiliary-regions-omitted"
    assert len(adapter.warnings)==2
    assert metadata["timeSignatureProvenance"]=="may-be-inferred-from-recognized-bar-durations"

@pytest.mark.parametrize("failure",[TimeoutError,InterruptedError])
def test_native_timeout_and_cancellation_propagate(prepared,tmp_path,monkeypatch,failure):
    bundle,_=prepared
    adapter=homr.Homr(bundle)
    job=tmp_path/"job";job.mkdir()
    source=job/"input.png";source.write_bytes(b"source")
    def run(*args):
        raise failure("bounded native failure")
    monkeypatch.setattr(homr,"run_process",run)
    with pytest.raises(failure):
        adapter(source,job,threading.Event())
    assert not (job/"result.musicxml").exists()

def test_cancelled_job_never_launches(prepared,tmp_path,monkeypatch):
    bundle,_=prepared
    adapter=homr.Homr(bundle)
    source=tmp_path/"input.png";source.write_bytes(b"source")
    event=threading.Event();event.set()
    monkeypatch.setattr(homr,"run_process",lambda *args:pytest.fail("must not launch"))
    with pytest.raises(InterruptedError):
        adapter(source,tmp_path,event)

def test_pdf_is_dispatched_elsewhere(prepared,tmp_path):
    bundle,_=prepared
    adapter=homr.Homr(bundle)
    source=tmp_path/"input.pdf";source.write_bytes(b"%PDF-")
    with pytest.raises(ValueError,match="PDF recognizer"):
        adapter(source,tmp_path,threading.Event())


@pytest.fixture
def pillow_python():
    candidates=[Path(sys.executable),Path("research/omr/results/photo-options/toolchain/venv/Scripts/python.exe").resolve()]
    for python in candidates:
        if python.is_file() and subprocess.run([str(python),"-I","-c","import PIL"],capture_output=True,timeout=10).returncode==0:
            return str(python)
    pytest.skip("Optional HOMR Python/Pillow runtime is not prepared")

def write_png(path,width=1,height=1):
    import struct,zlib
    def chunk(kind,data):
        return struct.pack(">I",len(data))+kind+data+struct.pack(">I",zlib.crc32(kind+data)&0xffffffff)
    path.write_bytes(b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",width,height,8,0,0,0,0))+chunk(b"IDAT",zlib.compress(b"\x00\x00"))+chunk(b"IEND",b""))

def test_python_network_is_disabled_before_vendor_entry(tmp_path,pillow_python):
    package=tmp_path/"homr";package.mkdir()
    (package/"__init__.py").write_text("")
    (package/"main.py").write_text('import socket\ndef main():\n    socket.create_connection(("example.com",443))\n')
    image=tmp_path/"input.png";write_png(image)
    result=subprocess.run([pillow_python,"-I","-B","-c",homr.BOOTSTRAP,str(tmp_path),str(image)],capture_output=True,text=True,timeout=10)
    assert result.returncode!=0
    assert "Network disabled during local music recognition" in result.stderr

@pytest.mark.parametrize("dimensions",[(5001,5000),(100000,100000)])
def test_large_decoded_image_rejected_before_vendor_entry(tmp_path,pillow_python,dimensions):
    package=tmp_path/"homr";package.mkdir()
    (package/"__init__.py").write_text("")
    (package/"main.py").write_text('def main():\n    raise AssertionError("vendor must not execute")\n')
    image=tmp_path/"huge.png";write_png(image,*dimensions)
    result=subprocess.run([pillow_python,"-I","-B","-c",homr.BOOTSTRAP,str(tmp_path),str(image)],capture_output=True,text=True,timeout=10)
    assert result.returncode!=0
    assert "local recognition budget" in result.stderr
    assert "vendor must not execute" not in result.stderr

def test_metadata_available_before_a_job_directory_exists(prepared,tmp_path):
    bundle,_=prepared
    adapter=homr.Homr(bundle)
    metadata=adapter.metadata_for(tmp_path/"input.png")
    assert metadata["recognizer"]==adapter.name
    assert metadata["capabilities"]["keySignatureMayBeInferred"] is True
