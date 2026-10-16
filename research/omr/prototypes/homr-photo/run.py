"""Bounded isolated homr photo trial. Outputs and private inputs remain ignored."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET

COMMIT = "ab369ac54277afab582afa4725441f7cbba76593"

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("job")
    parser.add_argument("--toolchain", type=Path, default=Path("research/omr/results/photo-options/toolchain"))
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--piano-cues", action="store_true")
    args = parser.parse_args()
    toolchain = args.toolchain.resolve()
    root = Path("research/omr/results/photo-options").resolve()
    job = (root / args.job).resolve()
    if not job.is_relative_to(root) or job == root:
        raise ValueError("Job must be inside the photo-options evidence directory")
    job.mkdir(parents=True, exist_ok=False)
    original = args.input.resolve()
    photo = job / ("original" + original.suffix.lower())
    shutil.copyfile(original, photo)
    python = toolchain / "venv/Scripts/python.exe"
    source = toolchain / (f"homr-{COMMIT}-piano-cues" if args.piano_cues else f"homr-{COMMIT}")
    command = [str(python), "-m", "homr.main", "--gpu", "no", "--no-title", "--debug", "--cache", "--write-staff-positions", str(photo)]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(source)
    env["OMP_NUM_THREADS"] = "4"
    result = {
        "recognitionExecuted": True, "candidate": "homr-current-cpu", "commit": COMMIT,
        "upstreamModified": args.piano_cues, "pianoCueProfile": args.piano_cues, "inputSource": str(original),
        "inputSha256": digest(original), "copiedInputSha256": digest(photo),
        "inputBytes": original.stat().st_size, "command": command,
        "timeoutSeconds": args.timeout, "titleDetection": False,
        "modelHashes": json.loads((toolchain / "models.json").read_text(encoding="utf-8-sig")),
    }
    source_files = {p.relative_to(source).as_posix(): digest(p) for p in sorted((source / "homr").rglob("*.py"))}
    (job / "source-python-files.json").write_text(json.dumps(source_files, indent=2), encoding="utf-8")
    result["sourcePythonTreeSha256"] = hashlib.sha256(json.dumps(source_files, sort_keys=True).encode()).hexdigest()
    result["installedDependenciesSha256"] = digest(toolchain / "installed.txt")
    started = time.monotonic()
    with (job / "execution.log").open("wb") as log:
        try:
            child = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, env=env, timeout=args.timeout, check=False)
            result["returncode"] = child.returncode
        except subprocess.TimeoutExpired:
            result["timedOut"] = True
    result["elapsedSeconds"] = round(time.monotonic() - started, 3)
    if args.piano_cues:
        result["patchSha256"] = (source / "patch-sha256.txt").read_text().strip()
        audit = photo.with_name(photo.stem + "_piano-cues.json")
        if audit.exists():
            result["pianoCueAudit"] = json.loads(audit.read_text())
    output = photo.with_suffix(".musicxml")
    if output.exists():
        result["output"] = str(output)
        result["outputSha256"] = digest(output)
        try:
            tree = ET.parse(output)
            parts = tree.findall("./part")
            result["parts"] = len(parts)
            result["measuresByPart"] = [len(p.findall("measure")) for p in parts]
            result["notesByPart"] = [len(p.findall("./measure/note")) for p in parts]
            result["pitchedNotesByPart"] = [len(p.findall("./measure/note/pitch")) for p in parts]
        except ET.ParseError as exc:
            result["xmlError"] = str(exc)
    (job / "result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

