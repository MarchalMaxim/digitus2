"""The Linux HOMR setup's pins; the downloads themselves run only in the image build."""
import importlib.util
from pathlib import Path
import sys
import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "prototypes" / "local-worker"))
import homr  # noqa: E402

spec = importlib.util.spec_from_file_location("setup_homr", HERE / "setup-homr.py")
setup_homr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup_homr)


def test_verify_sha256_names_the_file_on_mismatch(tmp_path):
    f = tmp_path / "a.zip"; f.write_bytes(b"x")
    with pytest.raises(ValueError, match="a.zip"):
        setup_homr.verify_sha256(f, "00" * 32)


def test_verify_sha256_accepts_the_matching_digest(tmp_path):
    f = tmp_path / "a.zip"; f.write_bytes(b"x")
    setup_homr.verify_sha256(f, "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881")


def test_setup_pins_the_archive_and_models():
    assert setup_homr.ARCHIVE_SHA256 == "23c81d6783c995866c256dba403bfa374639aeb20df64b738a0fc0034d160315"
    assert setup_homr.ARCHIVE_URL == f"https://github.com/liebharc/homr/archive/{homr.COMMIT}.zip"
    assert setup_homr.MODELS is homr.MODELS
