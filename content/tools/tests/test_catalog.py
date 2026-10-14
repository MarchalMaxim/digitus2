"""The merged catalog: fragments, collections, required fields, licences of new arrangements."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import build  # noqa: E402

CAT = build.load_catalog()
COLL = {c["id"] for c in build.load_collections()}
NEW = [p for p in CAT if p.get("benchmarkSet") != "core30"]


def test_slugs_are_unique_and_collections_known():
    assert len({p["slug"] for p in CAT}) == len(CAT)
    assert all(p["collection"] in COLL for p in CAT)
    assert {p["collection"] for p in CAT} <= COLL


def test_fragments_load_in_file_name_order(tmp_path, monkeypatch):
    d = tmp_path / "catalog.d"
    d.mkdir()
    (d / "b.json").write_text(json.dumps({"task": "t", "pieces": [{"slug": "y"}], "rejected": []}), encoding="utf-8")
    (d / "a.json").write_text(json.dumps({"task": "t", "pieces": [{"slug": "x"}], "rejected": []}), encoding="utf-8")
    monkeypatch.setattr(build, "FRAGMENTS", d)
    assert [p["slug"] for p in build.load_fragments()] == ["x", "y"]


# Added after the L1 milestone review: every fragment has the documented shape {task, pieces,
# rejected} (README), with `task` the plan's task number as an integer, as in candidates.json.
def test_every_fragment_has_the_documented_shape():
    tasks = []
    for path in sorted(build.FRAGMENTS.glob("*.json")):
        d = json.loads(path.read_text(encoding="utf-8"))
        assert set(d) - {"_comment"} == {"task", "pieces", "rejected"}, path.name
        assert type(d["task"]) is int, (path.name, d["task"])
        assert isinstance(d["pieces"], list) and d["pieces"], path.name
        assert isinstance(d["rejected"], list), path.name
        assert all(r.get("slug") and r.get("reason") for r in d["rejected"]), path.name
        tasks.append(d["task"])
    assert tasks and len(set(tasks)) == len(tasks), tasks


@pytest.mark.parametrize("piece", NEW, ids=lambda p: p["slug"])
def test_new_pieces_have_the_required_fields(piece):
    for k in ("tempoBpm", "tempoSource", "levelNote", "collection", "notes"):
        assert piece.get(k), k
    if piece["source"] == "mutopia":
        assert piece["retrievedAt"] and len(piece["sourceSha256"]) == 64


@pytest.mark.parametrize("piece", [p for p in NEW if p["source"] == "own"], ids=lambda p: p["slug"])
def test_new_arrangements_are_public_domain_in_the_us_and_the_eu(piece):
    m = piece["melody"]
    if m["authors"] != "traditional":
        assert all(a["died"] <= 1955 for a in m["authors"]), m["authors"]
        assert m["firstPublished"] is not None and m["firstPublished"] <= 1928
    assert m["reference"]["url"].startswith("https://") and m["reference"]["retrieved"]


def test_build_refuses_an_unknown_licence():
    with pytest.raises(SystemExit, match="unknown licence"):
        build.license_id("Creative Commons Attribution-NonCommercial 3.0")


# Added in Task 1 beyond the plan's list: the merge and --manifest-only paths (Review Focus 2).
CONTENT = TOOLS.parent


def _scratch_library(tmp_path, monkeypatch, manifest, verification):
    import jsonio

    man, ver = tmp_path / "manifest.json", tmp_path / "verification.json"
    jsonio.write_json(man, manifest)
    jsonio.write_json(ver, verification)
    monkeypatch.setattr(build, "MANIFEST", man)
    monkeypatch.setattr(build, "VERIFICATION", ver)
    monkeypatch.setattr(jsonio, "LOCK", tmp_path / ".lock")
    return man, ver


def test_merge_keeps_other_entries_and_top_level_keys(tmp_path, monkeypatch):
    real = json.loads((CONTENT / "manifest.json").read_text(encoding="utf-8"))
    gone = {**real[0], "slug": "no-longer-in-the-catalog"}
    twinkle, mary = "twinkle-twinkle-little-star", "mary-had-a-little-lamb"
    man, ver = _scratch_library(tmp_path, monkeypatch, [gone] + real[::-1], {
        "no-longer-in-the-catalog": {"ok": True}, "spanFlags": ["kept"], mary: {"ok": True}})
    rebuilt = {**next(e for e in real if e["slug"] == twinkle), "measures": 99}
    out = build.merge_results({mary: (None, {"ok": False, "error": "x"}), twinkle: (rebuilt, {"ok": True})})
    assert [e["slug"] for e in out] == [e["slug"] for e in real if e["slug"] != mary]
    assert json.loads(man.read_text(encoding="utf-8")) == out and out[0]["measures"] == 99
    v = json.loads(ver.read_text(encoding="utf-8"))
    assert list(v) == [twinkle, mary, "spanFlags"] and v["spanFlags"] == ["kept"] and v[mary]["ok"] is False
    assert not (tmp_path / ".lock").exists()


def test_manifest_only_reproduces_the_committed_manifest(tmp_path, monkeypatch):
    committed = (CONTENT / "manifest.json").read_bytes()
    man, _ = _scratch_library(tmp_path, monkeypatch, json.loads(committed)[::-1],
                              json.loads((CONTENT / "verification.json").read_text(encoding="utf-8")))
    assert build.manifest_only() == 0
    assert man.read_bytes() == committed, "content/manifest.json is stale: run build.py --manifest-only"


# Added in Task 19 beyond the plan's list: --manifest-only keeps verification.json in manifest order.
def test_manifest_only_orders_verification_like_the_manifest(tmp_path, monkeypatch):
    # A level change moves a piece in the manifest; its verification record must move with it, so
    # that build.py --manifest-only leaves both files in (level, collection, catalog) order.
    real = json.loads((CONTENT / "verification.json").read_text(encoding="utf-8"))
    shuffled = {k: real[k] for k in reversed(list(real))}
    man, ver = _scratch_library(tmp_path, monkeypatch,
                                json.loads((CONTENT / "manifest.json").read_text(encoding="utf-8")), shuffled)
    assert build.manifest_only() == 0
    v = json.loads(ver.read_text(encoding="utf-8"))
    assert v == real
    pieces = [k for k, val in v.items() if build.is_piece_record(val)]
    assert pieces == [e["slug"] for e in json.loads(man.read_text(encoding="utf-8"))]
    assert not (tmp_path / ".lock").exists()


def test_manifest_only_needs_a_built_entry(tmp_path, monkeypatch):
    d = tmp_path / "catalog.d"
    d.mkdir()
    piece = {"slug": "not-built-yet", "source": "own", "level": 1, "collection": "children-songs"}
    (d / "x.json").write_text(json.dumps({"task": "t", "pieces": [piece], "rejected": []}), encoding="utf-8")
    monkeypatch.setattr(build, "FRAGMENTS", d)
    _scratch_library(tmp_path, monkeypatch, [], {})
    with pytest.raises(SystemExit, match="build it first"):
        build.manifest_only()
