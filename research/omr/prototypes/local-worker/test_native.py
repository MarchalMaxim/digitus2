"""Real child-process lifecycle tests, not recognition-accuracy evidence."""
import io
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import zipfile
import pytest
from audiveris import run_process, unwrap_mxl


def alive(pid):
    if os.name == "nt":
        import ctypes
        kernel = ctypes.windll.kernel32
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        code = ctypes.c_ulong()
        ok = kernel.GetExitCodeProcess(handle, ctypes.byref(code))
        kernel.CloseHandle(handle)
        return bool(ok and code.value == 259)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


@pytest.mark.parametrize("mode", ["cancel", "timeout"])
def test_real_process_and_descendant_are_stopped(tmp_path, mode):
    script = tmp_path / "sleeper.py"
    script.write_text('import os,subprocess,sys,time\n'
                      'from pathlib import Path\n'
                      'child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(120)"])\n'
                      'Path("pids.txt").write_text(str(os.getpid())+","+str(child.pid))\n'
                      'time.sleep(120)\n')
    cancelled = threading.Event()
    failures = []
    def run():
        try:
            run_process([sys.executable, "-I", str(script)], tmp_path, dict(os.environ),
                        cancelled, 0.5 if mode == "timeout" else 30, tmp_path / "process.log")
        except (InterruptedError, TimeoutError) as exc:
            failures.append(type(exc))
    thread = threading.Thread(target=run)
    thread.start()
    deadline = time.monotonic() + 5
    while not (tmp_path / "pids.txt").exists() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert (tmp_path / "pids.txt").exists()
    pids = [int(p) for p in (tmp_path / "pids.txt").read_text().split(",")]
    assert all(alive(pid) for pid in pids)
    if mode == "cancel":
        cancelled.set()
    thread.join(8)
    assert not thread.is_alive()
    assert failures == [InterruptedError if mode == "cancel" else TimeoutError]
    assert not any(alive(pid) for pid in pids)


def test_nonzero_exit_does_not_succeed(tmp_path):
    with pytest.raises(RuntimeError):
        run_process([sys.executable, "-I", "-c", "raise SystemExit(3)"], tmp_path,
                    dict(os.environ), threading.Event(), 5, tmp_path / "exit.log")


@pytest.mark.parametrize("target,maximum", [("../outside.xml", 1024), ("score.xml", 8)])
def test_mxl_paths_and_uncompressed_size_are_bounded(tmp_path, target, maximum):
    path = tmp_path / "score.mxl"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("META-INF/container.xml", f'<container><rootfiles><rootfile full-path="{target}"/></rootfiles></container>')
        archive.writestr(target, "<score-partwise/>")
    with pytest.raises(ValueError):
        unwrap_mxl(path, maximum)


def test_mxl_rootfile_is_read_without_extracting_paths(tmp_path):
    path = tmp_path / "score.mxl"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>')
        archive.writestr("score.xml", "<score-partwise/>")
    assert unwrap_mxl(path) == b"<score-partwise/>"
    assert not (tmp_path / "score.xml").exists()


@pytest.mark.parametrize("with_english", [False, True])
def test_native_argv_settings_and_model_isolation(tmp_path, monkeypatch, with_english):
    import audiveris
    import hashlib
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "audiveris-5.11.0.msi").write_bytes(b"pinned-test-release")
    monkeypatch.setattr(audiveris, "MSI_SHA256", hashlib.sha256(b"pinned-test-release").hexdigest())
    text_models = tmp_path / "models"
    text_models.mkdir()
    (text_models / "eng.traineddata").write_bytes(b"pinned-test-model")
    monkeypatch.setattr(audiveris, "ENGLISH_SHA256", hashlib.sha256(b"pinned-test-model").hexdigest())
    monkeypatch.setenv("TESSDATA_PREFIX", "do-not-inherit")
    monkeypatch.setenv("JAVA_TOOL_OPTIONS", "do-not-inherit")
    captured = {}
    def run(command, directory, env, cancelled, timeout, log):
        captured.update(command=command, env=env)
        log.write_text("Complete test export", encoding="utf-8")
        with zipfile.ZipFile(directory / "exports/input.mxl", "w") as archive:
            archive.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>')
            archive.writestr("score.xml", "<score-partwise/>")
    monkeypatch.setattr(audiveris, "run_process", run)
    job = tmp_path / "job"
    job.mkdir()
    source = job / "input.pdf"
    source.write_bytes(b"%PDF-original-vector-bytes")
    adapter = audiveris.Audiveris(bundle, short_staves=True, text_models=text_models if with_english else None)
    assert adapter(source, job, threading.Event()).read_bytes() == b"<score-partwise/>"
    assert source.read_bytes() == b"%PDF-original-vector-bytes"
    assert captured["command"][-1] == str(source)
    assert captured["command"][captured["command"].index("-cp") + 1] == str(bundle / "portable/Audiveris/app/*")
    for key, value in audiveris.job_environment(job).items():
        assert captured["env"][key] == value and Path(value).is_relative_to(job)
    assert "JAVA_TOOL_OPTIONS" not in captured["env"]
    import json
    invocation = json.loads((job / "invocation.json").read_text())
    assert invocation["textModelSha256"] == (audiveris.ENGLISH_SHA256 if with_english else None)
    assert adapter.capabilities["textModelConfigured"] is with_english
    if with_english:
        assert captured["env"]["TESSDATA_PREFIX"] == str(job / "tessdata")
        assert (job / "tessdata/eng.traineddata").read_bytes() == b"pinned-test-model"
    else:
        assert "TESSDATA_PREFIX" not in captured["env"]
        assert adapter.warnings[0]["code"] == "ocr-language-not-configured"


def test_log_limit_stops_real_child(tmp_path):
    with pytest.raises(RuntimeError, match="log limit"):
        run_process([sys.executable, "-I", "-c", "import sys,time;sys.stdout.write('x'*9437184);sys.stdout.flush();time.sleep(120)"],
                    tmp_path, dict(os.environ), threading.Event(), 10, tmp_path / "large.log")
