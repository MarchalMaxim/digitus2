"""The PIG validation list is deterministic, drawn from the train split only, and committed."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

RESEARCH = Path(__file__).resolve().parents[1]
SCRIPT = RESEARCH / "scripts" / "make_pig_validation.py"
SPLIT = RESEARCH / "data" / "splits" / "pig_official.json"
OUT = RESEARCH / "data" / "splits" / "pig_validation.json"


def _load_module():
    spec = importlib.util.spec_from_file_location("make_pig_validation", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["make_pig_validation"] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.skipif(not SPLIT.exists(), reason="pig_official.json missing")
def test_validation_list_is_deterministic_and_from_train(tmp_path):
    mod = _load_module()
    a = mod.build(SPLIT)
    b = mod.build(SPLIT)
    assert a == b
    assert a["seed"] == 20261013
    assert len(a["pieces"]) == 20
    assert a["pieces"] == sorted(a["pieces"])
    assert len(set(a["pieces"])) == 20
    split = json.loads(SPLIT.read_text(encoding="utf-8"))
    train = set(split["splits"]["nakamura2020"]["train"]["pieces"])
    test = set(split["splits"]["nakamura2020"]["test"]["pieces"])
    assert set(a["pieces"]) <= train
    assert not (set(a["pieces"]) & test)
    assert all(int(p) >= 31 for p in a["pieces"])
    assert sorted(set(a["train_minus_validation"]) | set(a["pieces"])) == sorted(train)
    # two writes are byte-identical
    p1, p2 = tmp_path / "a.json", tmp_path / "b.json"
    mod.write(p1, a)
    mod.write(p2, mod.build(SPLIT))
    assert p1.read_bytes() == p2.read_bytes()


@pytest.mark.skipif(not (SPLIT.exists() and OUT.exists()), reason="split files missing")
def test_committed_file_matches_the_generator():
    mod = _load_module()
    committed = json.loads(OUT.read_text(encoding="utf-8"))
    assert committed == mod.build(SPLIT)
