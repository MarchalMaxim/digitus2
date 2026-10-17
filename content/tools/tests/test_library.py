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
import pdmx_fragments  # noqa: E402
import validate  # noqa: E402

MANIFEST = json.loads((CONTENT / "manifest.json").read_text(encoding="utf-8"))
CATALOG = build.load_catalog()  # catalog.json, then the catalog.d/ fragments
REQUIRED = ["slug", "title", "composer", "composerDates", "catalogue", "year", "level", "measures",
            "approxDurationSec", "timeSignature", "key", "tempoBpm", "source", "arranger",
            "hasEditorialFingering", "excerpt", "notes", "collection", "collectionId", "benchmarkSet", "genre"]
LICENSES = ("Public Domain", "CC0-1.0", "CC-BY-2.5", "CC-BY-3.0", "CC-BY-4.0", "CC-BY-SA-2.5", "CC-BY-SA-3.0",
            "CC-BY-SA-4.0")
# Reviewed corpus after the 2026-10-15 bulk expansion; core30 unchanged.
LEVEL_COUNTS = {1: 47, 2: 212, 3: 1415, 4: 784, 5: 45, 6: 199}  # 253 curated + 2,449 MuseScore archive (2026-10-16)


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
    counts = {lvl: sum(1 for e in MANIFEST if e["level"] == lvl) for lvl in LEVEL_COUNTS}
    assert counts == LEVEL_COUNTS
    assert len(MANIFEST) == 2702
    assert sum(counts[lvl] for lvl in (1, 2, 3)) > sum(counts[lvl] for lvl in (4, 5, 6))


@pytest.mark.parametrize("entry", MANIFEST, ids=lambda e: e["slug"])
def test_manifest_entry(entry):
    for k in REQUIRED:
        assert k in entry, k
    assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", entry["slug"])
    assert entry["level"] in (1, 2, 3, 4, 5, 6)
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
    elif src["name"].startswith("MuseScore"):
        # the PDMX archive (2026-10-16): public domain or CC0 as declared, a gzip-compressed score
        assert src["url"] == "https://zenodo.org/records/15571083" and src["license"] in ("Public Domain", "CC0-1.0")
        assert entry["files"]["score"].endswith(".musicxml.gz") and not entry["arranger"]
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
        expected.add(e["files"]["score"].removeprefix("scores/"))  # .musicxml, or .musicxml.gz (PDMX)
        if e["hasEditorialFingering"]:
            expected.add(f"{e['slug']}.fingered.musicxml")
    assert names == expected


def test_every_entry_carries_its_genre():
    genres = build.collection_genres()
    by_slug = {p["slug"]: p for p in CATALOG}
    for e in MANIFEST:
        assert e["genre"] == build.piece_genre(by_slug[e["slug"]], genres), e["slug"]
    assert list(MANIFEST[0])[list(MANIFEST[0]).index("collectionId") + 1] == "genre"


def decode_index(index: dict) -> list[dict]:
    """The reader's side of build.library_index (apps/web decodeLibraryIndex), to check the writer against."""
    assert index["v"] == 2
    cols = index["pieces"]
    out = []
    for i, stored in enumerate(cols["slug"]):
        cid, collection, genre = index["collections"][cols["collection"][i]]
        title = cols["title"][i]
        slug = f"pdmx-{pdmx_fragments.ascii_slug(title)}{stored}" if stored.startswith("-") else stored
        out.append({"slug": slug, "title": title, "composer": cols["composer"][i], "level": cols["level"][i],
                    "collection": collection, "collectionId": cid, "genre": index["genres"].get(str(i), genre),
                    "approxDurationSec": cols["duration"][i]})
    return out


def test_library_index_decodes_to_the_eight_fields_of_every_entry():
    fields = ("slug", "title", "composer", "level", "collection", "collectionId", "genre", "approxDurationSec")
    index = build.library_index(MANIFEST)
    assert decode_index(index) == [{k: e[k] for k in fields} for e in MANIFEST]
    assert set(index) == {"v", "collections", "pieces", "genres"}
    assert [c[0] for c in index["collections"]] == list(dict.fromkeys(e["collectionId"] for e in MANIFEST))


def test_library_index_file_is_the_manifest_index():
    written = json.loads((CONTENT / "library-index.json").read_text(encoding="utf-8"))
    assert written == build.library_index(MANIFEST)  # regenerate with build.write_library_index(MANIFEST)


def test_library_index_stores_archive_slugs_by_their_hash_and_genres_by_exception():
    entry = {"slug": "pdmx-someone-you-loved-0f933bca", "title": "Someone You Loved", "composer": "x",
             "level": 3, "collection": "Songs", "collectionId": "s", "genre": "songs", "approxDurationSec": 131.6}
    other = dict(entry, slug="amazing-grace", title="Amazing Grace", genre="modern", approxDurationSec=58)
    index = build.library_index([entry, entry | {"slug": "pdmx-someone-you-loved-11111111"}, other])
    assert index["pieces"]["slug"] == ["-0f933bca", "-11111111", "amazing-grace"]
    assert index["pieces"]["duration"] == [132, 132, 58]
    assert index["collections"] == [["s", "Songs", "songs"]]
    assert index["genres"] == {"2": "modern"}
    # a slug that is not "pdmx-" + the title's slug + a hash is kept whole
    assert build.index_slug("pdmx-other-name-0f933bca", "Someone You Loved") == "pdmx-other-name-0f933bca"


def test_genre_counts_match_the_design():
    # Reviewed bulk corpus; modern repertoire now occupies an existing genre.
    # The curated 253 (the archive pieces have their own genres: see test_archive_genres below).
    counts = collections.Counter(e["genre"] for e in MANIFEST if not e["collectionId"].startswith("pdmx-"))
    assert counts == {"songs": 65, "carols": 15, "baroque": 68, "classical": 29,
                      "romantic": 70, "ragtime": 5, "modern": 1}


def test_archive_genres():
    # MuseScore archive pieces (2026-10-16): the classical lane gives classical and folk, the songs lane
    # songs and, for jazz and blues, modern
    counts = collections.Counter(e["genre"] for e in MANIFEST if e["collectionId"].startswith("pdmx-"))
    assert set(counts) == {"classical", "folk", "songs", "modern"}
    assert counts["songs"] == sum(1 for e in MANIFEST if e["collectionId"] == "pdmx-songs")
    assert counts["modern"] == sum(1 for e in MANIFEST if e["collectionId"] == "pdmx-modern")
    assert counts["folk"] == sum(1 for e in MANIFEST if e["collectionId"] == "pdmx-folk")
