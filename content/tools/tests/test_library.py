"""Consistency checks on the built library (content/manifest.json + content/scores/)."""
from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
CONTENT = TOOLS.parent
sys.path.insert(0, str(TOOLS))
import build  # noqa: E402
import validate  # noqa: E402

MANIFEST = json.loads((CONTENT / "manifest.json").read_text(encoding="utf-8"))
CATALOG = build.load_catalog()  # catalog.json, then the catalog.d/ fragments
REQUIRED = ["slug", "title", "composer", "composerDates", "catalogue", "year", "level", "measures",
            "approxDurationSec", "timeSignature", "key", "tempoBpm", "source", "arranger",
            "hasEditorialFingering", "excerpt", "notes", "collection", "collectionId", "benchmarkSet", "genre"]
LICENSES = ("Public Domain", "CC0-1.0", "CC-BY-2.5", "CC-BY-3.0", "CC-BY-4.0", "CC-BY-SA-2.5", "CC-BY-SA-3.0",
            "CC-BY-SA-4.0")
# Pieces per level: the L1 targets (25, 45, 40, 25, 15) with some slack (L1 plan, Task 19).
LEVEL_RANGES = {1: (24, 28), 2: (42, 48), 3: (37, 43), 4: (22, 28), 5: (13, 17)}


def test_manifest_matches_catalog():
    # (level, collection display order, position in the merged catalog): L1 plan, decision 3
    catalog_index = {p["slug"]: i for i, p in enumerate(CATALOG)}
    collection_index = {c["id"]: i for i, c in enumerate(build.load_collections())}
    expected = sorted(CATALOG, key=lambda p: build.sort_key(p, catalog_index, collection_index))
    assert [e["slug"] for e in MANIFEST] == [p["slug"] for p in expected]
    assert len({e["slug"] for e in MANIFEST}) == len(MANIFEST)
    titles = {c["id"]: c["title"] for c in build.load_collections()}
    for e, p in zip(MANIFEST, expected):
        assert (e["collectionId"], e["collection"]) == (p["collection"], titles[p["collection"]]), e["slug"]
        assert e["benchmarkSet"] == p.get("benchmarkSet"), e["slug"]


def test_verification_follows_the_manifest_order():
    # build.py keeps both files in (level, collection, catalog) order, --manifest-only included.
    verification = json.loads((CONTENT / "verification.json").read_text(encoding="utf-8"))
    pieces = [k for k, v in verification.items() if build.is_piece_record(v)]
    assert pieces == [e["slug"] for e in MANIFEST], "run build.py --manifest-only"


def test_level_counts_are_weighted_to_beginners():
    counts = {lvl: sum(1 for e in MANIFEST if e["level"] == lvl) for lvl in LEVEL_RANGES}
    for lvl, (lo, hi) in LEVEL_RANGES.items():
        assert lo <= counts[lvl] <= hi, counts
    assert 145 <= len(MANIFEST) <= 156


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
    assert src["license"] in LICENSES
    score = CONTENT / entry["files"]["score"]
    assert score.exists()
    fingered = CONTENT / "scores" / f"{entry['slug']}.fingered.musicxml"
    assert fingered.exists() == entry["hasEditorialFingering"]
    if src["name"].startswith("digitus2"):
        assert entry["arranger"] and src["license"] == "CC0-1.0"
    else:
        assert src["url"].startswith("https://www.mutopiaproject.org/")


@pytest.mark.parametrize("entry", [e for e in MANIFEST if e["source"]["license"].startswith("CC-BY")],
                         ids=lambda e: e["slug"])
def test_cc_by_engravings_are_credited(entry):
    # CC BY and CC BY-SA require attribution: typesetter, Mutopia id and the licence text (Review Focus 5).
    src = entry["source"]
    for k in ("typesetter", "mutopiaId", "licenseUrl"):
        assert src.get(k), k
    assert src["licenseUrl"].startswith("https://creativecommons.org/licenses/by")


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


def test_every_entry_carries_its_genre():
    genres = build.collection_genres()
    by_slug = {p["slug"]: p for p in CATALOG}
    for e in MANIFEST:
        assert e["genre"] == build.piece_genre(by_slug[e["slug"]], genres), e["slug"]
    assert list(MANIFEST[0])[list(MANIFEST[0]).index("collectionId") + 1] == "genre"


def test_genre_counts_match_the_design():
    # spec section 4.2 at 149 pieces; arrangements and folk tunes are songs
    counts = collections.Counter(e["genre"] for e in MANIFEST)
    assert counts == {"songs": 42, "carols": 15, "baroque": 27, "classical": 18, "romantic": 44, "ragtime": 3}
