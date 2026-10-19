"""Prepare the pinned HOMR toolchain on Linux: the steps of homr-photo/setup.ps1, for the service image."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import zipfile

PROTOTYPES = Path(__file__).resolve().parent.parent / "prototypes"
sys.path.insert(0, str(PROTOTYPES / "local-worker"))
from homr import COMMIT, MODELS, venv_python  # noqa: E402

ARCHIVE_SHA256 = "23c81d6783c995866c256dba403bfa374639aeb20df64b738a0fc0034d160315"
ARCHIVE_URL = f"https://github.com/liebharc/homr/archive/{COMMIT}.zip"
HOMR_PHOTO = PROTOTYPES / "homr-photo"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_sha256(path: Path, expected: str) -> None:
    """Raise ValueError naming the file when its SHA-256 is not the pinned one."""
    actual = sha256(path)
    if actual != expected.lower():
        raise ValueError(f"Pinned digest mismatch for {path}: expected {expected.lower()}, found {actual}")


def run(command: list, **kwargs) -> None:
    print("+", " ".join(str(part) for part in command), flush=True)
    subprocess.run([str(part) for part in command], check=True, **kwargs)


def download(url: str, destination: Path) -> None:
    partial = destination.with_name(destination.name + ".part")
    with urllib.request.urlopen(url, timeout=120) as answer, partial.open("wb") as stream:
        shutil.copyfileobj(answer, stream)
    partial.replace(destination)


def extract(archive: Path, root: Path) -> None:
    """Extract the verified archive; every member must sit under homr-<commit>/."""
    with zipfile.ZipFile(archive) as bundle:
        for name in bundle.namelist():
            parts = Path(name).parts
            if not parts or parts[0] != f"homr-{COMMIT}" or ".." in parts or Path(name).is_absolute():
                raise ValueError(f"Unexpected member in {archive.name}: {name}")
        bundle.extractall(root)


def verify_models(source: Path) -> dict[str, str]:
    """Every downloaded .onnx is one of the pinned models, and every pinned model is there."""
    found = {p.relative_to(source).as_posix(): p for p in sorted((source / "homr").rglob("*.onnx"))}
    if set(found) != set(MODELS):
        raise ValueError(f"HOMR model set differs from the pins: {sorted(set(found) ^ set(MODELS))}")
    for name, path in found.items():
        if path.is_symlink():
            raise ValueError(f"HOMR model is a symbolic link: {path}")
        verify_sha256(path, MODELS[name])
    return dict(MODELS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="Toolchain directory (the service's --homr-toolchain)")
    parser.add_argument("--python", type=Path, default=Path(sys.executable), help="Interpreter that creates the virtual environment")
    args = parser.parse_args()
    root = args.root.resolve()
    downloads = root / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    archive = downloads / f"homr-{COMMIT}.zip"
    if not archive.is_file():
        download(ARCHIVE_URL, archive)
    verify_sha256(archive, ARCHIVE_SHA256)
    source = root / f"homr-{COMMIT}"
    if not source.exists():
        extract(archive, root)
    python = venv_python(root)
    if not python.is_file():
        # The adapter refuses a symlinked interpreter, and venv symlinks by default on Linux.
        run([args.python, "-m", "venv", "--copies", root / "venv"])
    run([python, "-m", "pip", "--disable-pip-version-check", "--cache-dir", root / "pip-cache",
         "install", "--only-binary=:all:", "-r", HOMR_PHOTO / "requirements-cpu.txt"])
    frozen = subprocess.run([str(python), "-m", "pip", "--disable-pip-version-check", "freeze"],
                            check=True, capture_output=True, text=True).stdout
    (root / "installed.txt").write_text(frozen, encoding="utf-8")
    (root / "source-archive.json").write_text(json.dumps(
        {"Algorithm": "SHA256", "Hash": ARCHIVE_SHA256, "Path": str(archive), "Url": ARCHIVE_URL}, indent=2), encoding="utf-8")
    run([python, HOMR_PHOTO / "prepare_patched.py", "--toolchain", root, "--verify-pristine-only"])
    env = dict(os.environ, PYTHONPATH=str(source))
    run([python, "-m", "homr.main", "--init", "--no-title", "--gpu", "no"], env=env, cwd=root)
    (root / "models.json").write_text(json.dumps(verify_models(source), indent=2), encoding="utf-8")
    run([python, HOMR_PHOTO / "prepare_patched.py", "--toolchain", root])
    print("HOMR toolchain prepared and verified at", root, flush=True)


if __name__ == "__main__":
    main()
