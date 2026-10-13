"""The Mutopia split and the PIG validation list as the experiments read them."""
import json
from pathlib import Path

import pytest

from learn import make_mutopia_split as mms

RESEARCH = Path(__file__).resolve().parents[2]
MANIFEST = RESEARCH / "data" / "mutopia_fingering" / "manifest.json"
OUT = RESEARCH / "data" / "splits" / "mutopia_split.json"
VAL = RESEARCH / "data" / "splits" / "pig_validation.json"


@pytest.mark.skipif(not MANIFEST.exists(), reason="Mutopia manifest missing")
def test_mutopia_split_properties(tmp_path):
    a = mms.build(MANIFEST)
    b = mms.build(MANIFEST)
    assert a == b
    p1, p2 = tmp_path / "a.json", tmp_path / "b.json"
    mms.write(p1, a)
    mms.write(p2, b)
    assert p1.read_bytes() == p2.read_bytes()
    s = a["splits"]["piece70_30"]
    train_ids, test_ids = set(s["train"]["mutopia_ids"]), set(s["test"]["mutopia_ids"])
    assert not (train_ids & test_ids)
    ok = [m for m in json.loads(MANIFEST.read_text(encoding="utf-8")) if m["status"] == "ok"]
    parts = s["train"]["pieces"] + s["test"]["pieces"]
    assert sorted(parts) == sorted(m["piece_id"] for m in ok)
    assert len(parts) == len(set(parts))
    n = len(train_ids) + len(test_ids)
    assert 0.25 <= len(test_ids) / n <= 0.35
    if OUT.exists():
        assert json.loads(OUT.read_text(encoding="utf-8")) == a


@pytest.mark.skipif(not VAL.exists(), reason="pig_validation.json missing")
def test_pig_validation_file_shape():
    d = json.loads(VAL.read_text(encoding="utf-8"))
    assert d["seed"] == 20261013 and len(d["pieces"]) == 20
    assert all(31 <= int(p) <= 150 for p in d["pieces"])
