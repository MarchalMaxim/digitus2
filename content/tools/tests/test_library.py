"""Consistency checks on the built library (content/manifest.json + content/scores/)."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
CONTENT = TOOLS.parent
sys.path.insert(0, str(TOOLS))
import validate  # noqa: E402

MANIFEST = json.loads((CONTENT / "manifest.json").read_text(encoding="utf-8"))
CATALOG = json.loads((TOOLS / "catalog.json").read_text(encoding="utf-8"))["pieces"]
REQUIRED = ["slug", "title", "composer", "composerDates", "catalogue", "year", "level", "measures",
            "approxDurationSec", "timeSignature", "key", "tempoBpm", "source", "arranger",
            "hasEditorialFingering", "excerpt", "notes"]


def test_manifest_matches_catalog():
    assert [e["slug"] for e in MANIFEST] == sorted(
        (p["slug"] for p in CATALOG), key=lambda s: (next(p["level"] for p in CATALOG if p["slug"] == s),
                                                     [p["slug"] for p in CATALOG].index(s)))
    assert len({e["slug"] for e in MANIFEST}) == len(MANIFEST)


@pytest.mark.parametrize("entry", MANIFEST, ids=lambda e: e["slug"])
def test_manifest_entry(entry):
    for k in REQUIRED:
        assert k in entry, k
    assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", entry["slug"])
    assert entry["level"] in (1, 2, 3, 4, 5)
    assert entry["measures"] > 0 and entry["approxDurationSec"] > 0 and entry["tempoBpm"] > 0
    src = entry["source"]
    for k in ("name", "url", "license", "retrievedAt"):
        assert k in src, k
    assert src["license"] in ("Public Domain", "CC0-1.0", "CC-BY-SA-2.5", "CC-BY-SA-3.0")
    score = CONTENT / entry["files"]["score"]
    assert score.exists()
    fingered = CONTENT / "scores" / f"{entry['slug']}.fingered.musicxml"
    assert fingered.exists() == entry["hasEditorialFingering"]
    if src["name"].startswith("digitus2"):
        assert entry["arranger"] and src["license"] == "CC0-1.0"
    else:
        assert src["url"].startswith("https://www.mutopiaproject.org/")


@pytest.mark.parametrize("path", sorted((CONTENT / "scores").glob("*.musicxml")), ids=lambda p: p.name)
def test_score_passes_validation(path):
    r = validate.check_file(path, None)
    assert r["ok"], r["errors"]


def test_no_stray_files():
    names = {p.name for p in (CONTENT / "scores").iterdir()}
    expected = set()
    for e in MANIFEST:
        expected.add(f"{e['slug']}.musicxml")
        if e["hasEditorialFingering"]:
            expected.add(f"{e['slug']}.fingered.musicxml")
    assert names == expected
