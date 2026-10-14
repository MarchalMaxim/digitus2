"""The first 30 pieces never change (L1 plan, Review Focus 1)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
CONTENT = TOOLS.parent
FIX = json.loads((TOOLS / "tests" / "fixtures" / "core30.json").read_text(encoding="utf-8"))
MANIFEST = json.loads((CONTENT / "manifest.json").read_text(encoding="utf-8"))
NEW_KEYS = {"collection", "collectionId", "benchmarkSet", "genre"}


def test_core30_scores_are_byte_identical():
    for name, digest in FIX["sha256"].items():
        assert hashlib.sha256((CONTENT / "scores" / name).read_bytes()).hexdigest() == digest, name


def test_exactly_the_core30_carry_the_benchmark_set():
    tagged = [e["slug"] for e in MANIFEST if e["benchmarkSet"] == "core30"]
    assert sorted(tagged) == sorted(FIX["slugs"]) and len(tagged) == 30
    assert all(e["benchmarkSet"] is None for e in MANIFEST if e["slug"] not in FIX["slugs"])


def test_core30_manifest_entries_only_gain_the_new_keys():
    before = {e["slug"]: e for e in json.loads((TOOLS / "tests" / "fixtures" / "core30-manifest.json").read_text(encoding="utf-8"))}
    for e in MANIFEST:
        if e["slug"] in before:
            assert {k: v for k, v in e.items() if k not in NEW_KEYS} == before[e["slug"]]


def test_twinkle_is_the_first_level_one_piece():
    assert next(e for e in MANIFEST if e["level"] == 1)["slug"] == "twinkle-twinkle-little-star"
