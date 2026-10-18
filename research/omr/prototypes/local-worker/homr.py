"""Verified optional HOMR CPU process adapter; no model downloads during jobs."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET
from audiveris import run_process
from normalize_export import normalize

COMMIT = "ab369ac54277afab582afa4725441f7cbba76593"
SOURCE_MANIFEST_PATH = Path(__file__).resolve().parent.parent / "homr-photo/source-manifests.json"
REQUIREMENTS_PATH = Path(__file__).resolve().parent.parent / "homr-photo/requirements-cpu.txt"
MODELS = {
    "homr/segmentation/segnet_308-3296ccd40960f90ca6ab9c035cca945675d30a0f.onnx": "6ed36640db4ef5d223098b6d5efe4eda97c66b24a2c72faab8a018c749003a8d",
    "homr/transformer/encoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6.onnx": "92bd18338dc8da3c9b00185008ab14719ff9f912efe785ca42d7b623e06e0c6b",
    "homr/transformer/decoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6.onnx": "18801c1e3657bdea1b031db90b10d66e15accfc1d607780f09a9e059133e886a",
}
# Isolated Python ignores inherited PYTHONPATH/PYTHONHOME. Only this verified source
# directory is added; socket hooks also prevent unexpected Python model-download
# code from contacting the network. No request contains the private source image.
BOOTSTRAP = """
import sys,socket,warnings
def offline(*args,**kwargs):
    raise RuntimeError("Network disabled during local music recognition")
socket.create_connection=offline
socket.getaddrinfo=offline
socket.socket.connect=offline
socket.socket.connect_ex=offline
source,input_path=sys.argv[1:3]
sys.path.insert(0,source)
from PIL import Image
Image.MAX_IMAGE_PIXELS=25_000_000
try:
    with warnings.catch_warnings():
        warnings.simplefilter("error",Image.DecompressionBombWarning)
        with Image.open(input_path) as image:
            width,height=image.size
            if image.format not in {"JPEG","PNG"} or width<=0 or height<=0 or width*height>25_000_000:
                raise ValueError("image budget")
except Exception as exc:
    raise RuntimeError("Image dimensions or encoding exceed the local recognition budget") from None
from homr.main import main
sys.argv=["homr","--gpu","no","--no-title","--write-staff-positions",input_path]
main()
"""

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def python_sources(root):
    return {p.relative_to(root).as_posix(): digest(p) for p in sorted((root/"homr").rglob("*.py"))}

def package_lines(path):
    return sorted(line.strip().lower() for line in path.read_text(encoding="utf-8-sig").splitlines()
                  if line.strip() and not line.lstrip().startswith("#"))

def read_audit(path):
    if path.stat().st_size > 1024 * 1024:
        raise ValueError("recognizer audit limit")
    value=json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value,dict):
        raise ValueError("invalid recognizer audit")
    return value

class Homr:
    def __init__(self, toolchain, *, timeout=180):
        self.toolchain=Path(toolchain).resolve()
        self.timeout=timeout
        if not 0 < timeout <= 600:
            raise ValueError("timeout must be in (0,600]")
        self.source=self.toolchain/f"homr-{COMMIT}-piano-cues"
        self.python=self.toolchain/"venv/Scripts/python.exe"
        self.manifest=json.loads(SOURCE_MANIFEST_PATH.read_text())
        if self.manifest.get("commit") != COMMIT:
            raise ValueError("HOMR source pin mismatch")
        self.name="HOMR/" + COMMIT[:12] + "/experimental-piano-photo-cpu"
        self.capabilities={
            "originalImageInput": True, "originalPdfInput": False,
            "experimentalPhotoRecognition": True, "localCpuRecognition": True,
            "auditedAuxiliaryExclusion": True, "timeSignatureMayBeInferred": True, "keySignatureMayBeInferred": True,
            "textModelConfigured": False,
        }
        self.warnings=[
            {"code":"recognition-experimental","message":"Photo recognition is experimental. Compare the recognized notes with the source before using fingerings."},
            {"code":"recognition-meter-unverified","message":"Missing key or time signatures may be inferred. Confirm them against the complete score."},
        ]
        self._verify_runtime()

    def _verify_runtime(self):
        if not self.python.is_file() or self.python.is_symlink():
            raise ValueError("HOMR Python runtime is missing")
        if python_sources(self.source) != self.manifest["patched"]:
            raise ValueError("HOMR source differs from prepared pins; rerun setup in a clean toolchain")
        if package_lines(self.toolchain/"installed.txt") != package_lines(REQUIREMENTS_PATH):
            raise ValueError("HOMR dependency manifest mismatch")
        actual=set(p.relative_to(self.source).as_posix() for p in (self.source/"homr").rglob("*.onnx"))
        if actual != set(MODELS):
            raise ValueError("HOMR model set mismatch")
        for name,expected in MODELS.items():
            path=self.source/name
            if path.is_symlink() or digest(path) != expected:
                raise ValueError("HOMR model hash mismatch")
        return hashlib.sha256(json.dumps(self.manifest["patched"],sort_keys=True).encode()).hexdigest()

    def metadata_for(self, source, destination=None):
        path=Path(destination)/"recognition.json" if destination is not None else None
        if path is not None and path.exists():
            return read_audit(path)
        return {"recognizer":self.name,"capabilities":dict(self.capabilities),
                "warnings":[dict(w) for w in self.warnings]}

    def __call__(self, source, destination, cancelled):
        source=Path(source).resolve()
        destination=Path(destination).resolve()
        if source.suffix.lower() not in {".png",".jpg",".jpeg"}:
            raise ValueError("HOMR accepts PNG/JPEG photos; use the PDF recognizer for PDFs")
        if cancelled.is_set():
            raise InterruptedError("cancelled")
        tree_hash=self._verify_runtime()
        for name in ["home","tmp","roaming","local"]:
            (destination/name).mkdir()
        local_input=destination/("recognize"+source.suffix.lower())
        shutil.copyfile(source,local_input)
        env=dict(os.environ)
        for key in list(env):
            if key.upper().startswith("PYTHON") or key.upper() in {"CUDA_VISIBLE_DEVICES","TESSDATA_PREFIX"}:
                env.pop(key,None)
        env.update(HOME=str(destination/"home"),USERPROFILE=str(destination/"home"),
                   APPDATA=str(destination/"roaming"),LOCALAPPDATA=str(destination/"local"),
                   TEMP=str(destination/"tmp"),TMP=str(destination/"tmp"),OMP_NUM_THREADS="4")
        command=[str(self.python),"-I","-B","-c",BOOTSTRAP,str(self.source),str(local_input)]
        (destination/"invocation.json").write_text(json.dumps({
            "command":command,"profile":self.name,"commit":COMMIT,
            "sourcePythonTreeSha256":tree_hash,"modelHashes":MODELS,
            "inputSha256":digest(source),"copiedInputSha256":digest(local_input),
            "titleDetection":False,"pythonNetworkDisabled":True,
        },indent=2),encoding="utf-8")
        run_process(command,destination,env,cancelled,self.timeout,destination/"execution.log")
        produced=local_input.with_suffix(".musicxml")
        if not produced.is_file() or produced.is_symlink() or produced.stat().st_size>20*1024*1024:
            raise ValueError("HOMR did not produce one bounded MusicXML result")
        data=produced.read_bytes()
        if b"<!ENTITY" in data.upper():
            raise ValueError("XML entities rejected")
        root=ET.fromstring(data)
        if root.tag!="score-partwise" or not root.findall("./part/measure/note/pitch"):
            raise ValueError("HOMR result contains no pitched music")
        cue_path=local_input.with_name(local_input.stem+"_piano-cues.json")
        if not cue_path.is_file():
            raise ValueError("HOMR result is missing its required geometry audit")
        cue=read_audit(cue_path)
        if not isinstance(cue.get("removed"),list):
            raise ValueError("HOMR geometry audit is invalid")
        foreign=[read_audit(p) for p in sorted(destination.glob("*foreign-staff*.json"))]
        omitted=len(cue.get("removed",[]))
        masked=sum(len(a.get("removed",[])) for a in foreign)
        warnings=[dict(w) for w in self.warnings]
        if omitted or masked:
            warnings.append({
                "code":"recognition-auxiliary-regions-omitted",
                "message":f"Recognition excluded {omitted} possible auxiliary staff regions and masked {masked} nearby staff regions. Check the source for any music that should be retained.",
            })
        metadata={
            "recognizer":self.name,"capabilities":dict(self.capabilities),"warnings":warnings,
            "sourceCommit":COMMIT,"sourcePythonTreeSha256":tree_hash,
            "modelHashes":dict(MODELS),"pianoCueAudit":cue,"foreignStaffAudits":foreign,
            "omittedStaffRegions":omitted,"maskedStaffRegions":masked,
            "timeSignatureProvenance":"may-be-inferred-from-recognized-bar-durations",
            "keySignatureProvenance":"may-be-assumed-when-absent-from-the-page",
        }
        # Lossless export rules and checks (normalize_export.py): their counts are audited and
        # shown in the review as warnings, so the downloaded file's differences are explained.
        data,audit,normalized=normalize(data)
        metadata.update(audit)
        warnings.extend(normalized)
        (destination/"recognition.json").write_text(json.dumps(metadata,indent=2),encoding="utf-8")
        output=destination/"result.musicxml"
        output.write_bytes(data)
        return output

