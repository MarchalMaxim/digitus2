"""Reproduce all source patches once, or verify an existing exact source tree."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

COMMIT = "ab369ac54277afab582afa4725441f7cbba76593"

def source_snapshot(root: Path) -> dict[str,str]:
    return {str(p.relative_to(root)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((root / "homr").rglob("*.py"))}

def verify_source(root: Path, expected: dict[str,str]) -> None:
    actual=source_snapshot(root)
    if actual != expected:
        changed=sorted(k for k in set(actual)|set(expected) if actual.get(k)!=expected.get(k))
        raise ValueError("Unknown source changes; refusing to overwrite or execute: " + ", ".join(changed[:20]))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--toolchain",type=Path,required=True)
    p.add_argument("--verify-pristine-only",action="store_true")
    args=p.parse_args()
    here=Path(__file__).resolve().parent
    toolchain=args.toolchain.resolve()
    manifest=json.loads((here/"source-manifests.json").read_text())
    patch_paths = {
        "upstream.patch": here/"upstream.patch",
        "upstream-accidentals.patch": here.parent/"photo-recovery/upstream-accidentals.patch",
        "upstream-boundaries.patch": here.parent/"photo-recovery/upstream-boundaries.patch",
        "upstream-coverage.patch": here.parent/"photo-recovery/upstream-coverage.patch",
        "upstream-speed.patch": here/"upstream-speed.patch",
    }
    for name, expected in manifest["patches"].items():
        retained = patch_paths[name].read_text(encoding="utf-8")
        if hashlib.sha256(retained.encode("utf-8")).hexdigest() != expected:
            raise ValueError("Retained upstream patch digest mismatch: " + name)
    original=toolchain/f"homr-{COMMIT}"
    patched=toolchain/f"homr-{COMMIT}-piano-cues"
    verify_source(original,manifest["pristine"])
    if args.verify_pristine_only:
        print("Pristine inference source verified before execution")
        return
    if patched.exists():
        verify_source(patched,manifest["patched"])
        print("Existing patched inference source verified")
    else:
        subprocess.run([sys.executable,str(here/"patch_source.py"),"--toolchain",str(toolchain)],check=True)
        subprocess.run([sys.executable,str(here.parent/"photo-recovery/patch_accidentals.py"),str(patched)],check=True)
        subprocess.run([sys.executable,str(here.parent/"photo-recovery/patch_boundaries.py"),str(patched)],check=True)
        subprocess.run([sys.executable,str(here.parent/"photo-recovery/patch_coverage.py"),str(patched)],check=True)
        subprocess.run([sys.executable,str(here/"patch_speed.py"),str(patched)],check=True)
    verify_source(patched,manifest["patched"])
    (toolchain/"setup-source-provenance.json").write_text(json.dumps({
        "commit":COMMIT,"inferencePythonFiles":len(manifest["patched"]),
        "pristineTreeSha256":hashlib.sha256(json.dumps(manifest["pristine"],sort_keys=True).encode()).hexdigest(),
        "patchedTreeSha256":hashlib.sha256(json.dumps(manifest["patched"],sort_keys=True).encode()).hexdigest(),
        "patches":manifest["patches"],
        "patchDigestEncoding":manifest["patchDigestEncoding"],
    },indent=2))
    print("Combined patched inference source verified")

if __name__=="__main__":
    main()

