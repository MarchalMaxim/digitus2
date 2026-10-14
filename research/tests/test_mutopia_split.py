"""The committed Mutopia split (M3 plan Task 2, learning-prototype correction 3).

``research/data/splits/mutopia_split.json`` was written by ``research/learn/make_mutopia_split.py``
(the learning prototype); the plan's separate script step is replaced by this test, which runs that
generator twice into a temporary directory, checks that both runs are byte-identical, that they
reproduce the committed file byte for byte from the manifest, and the split's properties: no
Mutopia id on both sides, every ``ok`` part assigned exactly once, a 25 to 35 percent test share of
pieces, and the counts the M3 plan relies on (112 / 48 ids, 224 / 62 parts).
"""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

RESEARCH = Path(__file__).resolve().parents[1]
SCRIPT = RESEARCH / "learn" / "make_mutopia_split.py"
MANIFEST = RESEARCH / "data" / "mutopia_fingering" / "manifest.json"
OUT = RESEARCH / "data" / "splits" / "mutopia_split.json"


def _load_module():
    spec = importlib.util.spec_from_file_location("make_mutopia_split_under_test", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["make_mutopia_split_under_test"] = mod
    spec.loader.exec_module(mod)
    return mod


def _run(out: Path) -> bytes:
    """Run the generator as a script (isolated mode, its own process) and return the file bytes."""
    r = subprocess.run(
        [sys.executable, "-I", str(SCRIPT), "--manifest", str(MANIFEST), "--out", str(out)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert r.returncode == 0, r.stderr
    return out.read_bytes()


def _canonical(data: dict) -> bytes:
    # The bytes write() hands to the text layer; git checks the file out with LF (.gitattributes).
    return (json.dumps(data, indent=1) + "\n").encode("utf-8")


@pytest.mark.skipif(not MANIFEST.exists(), reason="Mutopia manifest missing")
def test_generator_is_deterministic_and_reproduces_the_committed_file(tmp_path):
    first = _run(tmp_path / "a.json")
    second = _run(tmp_path / "b.json")
    assert first == second
    data = _load_module().build(MANIFEST)
    canonical = _canonical(data)
    # The script writes in text mode, so on Windows its newlines are CRLF; undo only that.
    assert first.replace(os.linesep.encode("ascii"), b"\n") == canonical
    if OUT.exists():
        assert OUT.read_bytes() == canonical


@pytest.mark.skipif(not MANIFEST.exists(), reason="Mutopia manifest missing")
def test_split_properties():
    data = _load_module().build(MANIFEST)
    assert data["seed"] == 20261013
    assert data["default_split"] == "piece70_30"
    s = data["splits"]["piece70_30"]
    train_ids, test_ids = s["train"]["mutopia_ids"], s["test"]["mutopia_ids"]
    # no Mutopia piece on both sides (a duet's primo and secondo stay together)
    assert not (set(train_ids) & set(test_ids))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    ok = [m for m in manifest if m.get("status") == "ok"]
    side = {}
    for name in ("train", "test"):
        for part in s[name]["pieces"]:
            assert part not in side, f"{part} assigned twice"
            side[part] = name
    # every ok part assigned exactly once, and nothing else
    assert sorted(side) == sorted(m["piece_id"] for m in ok)
    for m in ok:
        ids = train_ids if side[m["piece_id"]] == "train" else test_ids
        assert str(m["mutopia_id"]) in ids
    share = len(test_ids) / (len(train_ids) + len(test_ids))
    assert 0.25 <= share <= 0.35
    # counts the M3 plan relies on (learning-prototype report, section 7 item 3)
    assert (len(train_ids), len(test_ids)) == (112, 48)
    assert (len(s["train"]["pieces"]), len(s["test"]["pieces"])) == (224, 62)
    assert data["counts"]["train"]["parts"] == 224 and data["counts"]["test"]["parts"] == 62
    # shape shared with pig_official.json, so `bench --split` reads it unchanged
    for name in ("train", "test"):
        assert s[name]["pieces"] == sorted(s[name]["pieces"])
