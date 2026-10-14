"""The Mutopia candidates of the L1 plan (Task 3): content/tools/candidates.json, the facts
fetch_mutopia.py --candidates writes back into it, and repro.py's byte comparison."""
from __future__ import annotations

import hashlib
import io
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import build  # noqa: E402
import fetch_mutopia as fm  # noqa: E402
import jsonio  # noqa: E402
import repro  # noqa: E402

CONTENT = TOOLS.parent
ROOT = CONTENT.parent
CANDIDATES = TOOLS / "candidates.json"
MIRROR = ROOT / "research" / "data" / "mutopia_src" / "ftp"
FETCH_LOG = CONTENT / "_raw" / "mutopia" / "fetch_log.json"
CORE30 = json.loads((TOOLS / "tests" / "fixtures" / "core30.json").read_text(encoding="utf-8"))["slugs"]


@pytest.fixture(scope="module")
def cands() -> list[dict]:
    return json.loads(CANDIDATES.read_text(encoding="utf-8"))["candidates"]


def test_slugs_are_unique_and_absent_from_the_core30(cands):
    slugs = [c["slug"] for c in cands]
    assert len(slugs) == len(set(slugs)) == 97
    assert not set(slugs) & set(CORE30)
    assert not set(slugs) & {p["slug"] for p in build.load_catalog() if p.get("benchmarkSet") == "core30"}


@pytest.mark.skipif(not MIRROR.is_dir(), reason="research/data/mutopia_src is missing")
def test_ftp_dirs_exist_in_the_mirror(cands):
    missing = [f"{c['slug']}: {c['ftpDir']}" for c in cands if not (MIRROR / c["ftpDir"]).is_dir()]
    assert not missing


def test_counts_per_level_match_the_plan(cands):
    main = Counter(c["level"] for c in cands if not c["spare"])
    spare = Counter(c["level"] for c in cands if c["spare"])
    assert dict(main) == {2: 10, 3: 34, 4: 20, 5: 12}
    assert dict(spare) == {2: 5, 3: 5, 4: 6, 5: 5}


def test_collections_are_known(cands):
    known = {c["id"] for c in build.load_collections()}
    assert {c["collection"] for c in cands} <= known


def test_planned_fields(cands):
    for c in cands:
        assert c["task"] in range(13, 19), c["slug"]
        assert isinstance(c["spare"], bool) and c["level"] in (2, 3, 4, 5), c["slug"]
        assert re.fullmatch(r"\d+", c["mutopiaId"]), c["slug"]
        assert build.license_id(c["expectedLicense"]), c["slug"]
        assert c["convert"] is None or isinstance(c["convert"], dict), c["slug"]
    by_slug = {c["slug"]: c for c in cands}
    assert by_slug["clementi-sonatina-op36-no1-mvt2"]["convert"] == {"score": 2}
    assert by_slug["clementi-sonatina-op36-no1-mvt3"]["convert"] == {"score": 3}
    assert by_slug["burgmuller-op100-no9-la-chasse"]["ftpDir"] == "BurgmullerJFF/O100/25EF-09"


@pytest.mark.skipif(not FETCH_LOG.exists(), reason="content/_raw/mutopia/fetch_log.json is missing (run the fetch)")
def test_fetched_facts(cands):
    log = json.loads(FETCH_LOG.read_text(encoding="utf-8"))
    core = {p["ftpDir"] for p in build.load_catalog() if p["source"] == "mutopia" and p.get("benchmarkSet") == "core30"}
    assert len(core) == 20 and core <= set(log)
    for c in cands:
        assert c["ftpDir"] in log, c["slug"]
        assert c["rdfLicense"] and c["lyFile"], c["slug"]
        assert re.fullmatch(r"[0-9a-f]{64}", c["mainSha256"]), c["slug"]
        assert isinstance(c["midiFiles"], list) and c["mirrorMatch"] in (True, False, None), c["slug"]
        assert c["pdfPages"] is None or c["pdfPages"] > 0, c["slug"]
        if "excluded" in c:
            # only a licence outside public domain, CC BY and CC BY-SA excludes a candidate
            with pytest.raises(SystemExit):
                build.license_id(c["rdfLicense"])
        else:
            assert build.license_id(c["rdfLicense"]), c["slug"]  # no unknown licence


@pytest.mark.skipif(not FETCH_LOG.exists(), reason="content/_raw/mutopia/fetch_log.json is missing (run the fetch)")
def test_core_mutopia_sources_match_their_pinned_sha256():
    core = [p for p in build.load_catalog() if p["source"] == "mutopia" and p.get("benchmarkSet") == "core30"]
    assert len(core) == 20
    for p in core:
        files, _ = build.source_files(p)
        assert hashlib.sha256(files[0].read_bytes()).hexdigest() == p["sourceSha256"], p["slug"]


def test_pdf_pages_counts_page_objects_not_the_page_tree():
    pdf = (b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
           b"2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj\n"
           b"3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n"
           b"4 0 obj <</Type/Page/Parent 2 0 R>> endobj\n"
           b"5 0 obj << /Type /Page\n/Parent 2 0 R >> endobj\n%%EOF\n")
    assert fm.pdf_pages(pdf) == 3
    assert fm.pdf_pages(b"%PDF-1.5 compressed object streams only") is None


RDF = """<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:mp="http://www.mutopiaproject.org/piece-data/0.1/">
  <rdf:Description rdf:about=".">
    <mp:title>Piece</mp:title>
    <mp:licence>{licence}</mp:licence>
    <mp:id>Mutopia-2013/01/06-{num}</mp:id>
    <mp:maintainer>A. Typesetter</mp:maintainer>
    <mp:lilypondVersion>2.16.1</mp:lilypondVersion>
    <mp:lyFile>{ly}</mp:lyFile>
    <mp:midFile>{mid}</mp:midFile>
  </rdf:Description>
</rdf:RDF>
"""
PDF2 = b"<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type /Page >>"


def _fake_piece(raw: Path, mirror: Path, ftp: str, licence: str, ly_bytes: bytes, mirror_bytes: bytes | None,
                mids_zip: bool) -> dict:
    """Write a fetched piece under raw/<ftp> (and its source under mirror/<ftp>); return its log record."""
    d = raw / ftp
    d.mkdir(parents=True)
    name = ftp.rsplit("/", 1)[-1]
    (d / f"{name}.rdf").write_text(RDF.format(licence=licence, num="74", ly=f"{name}.ly", mid=f"{name}.mid"),
                                   encoding="utf-8")
    (d / f"{name}.ly").write_bytes(ly_bytes)
    (d / f"{name}-a4.pdf").write_bytes(PDF2)
    files = [{"name": f"{name}-a4.pdf"}, {"name": f"{name}.ly"}, {"name": f"{name}.rdf"}]
    if mids_zip:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(f"{name}.mid", b"MThd")
            zf.writestr(f"{name}-2.mid", b"MThd")
        files.append({"name": f"{name}-mids.zip", "extracted": [f"{name}-2.mid", f"{name}.mid"]})
    else:
        (d / f"{name}.mid").write_bytes(b"MThd")
        files.append({"name": f"{name}.mid"})
    if mirror_bytes is not None:
        (mirror / ftp).mkdir(parents=True)
        (mirror / ftp / f"{name}.ly").write_bytes(mirror_bytes)
    return {"ftpDir": ftp, "files": sorted(files, key=lambda f: f["name"]), "retrievedAt": "2026-10-14T00:00:00Z"}


def test_write_back_records_the_fetched_facts(tmp_path, monkeypatch):
    raw, mirror = tmp_path / "raw", tmp_path / "mirror"
    mirror.mkdir()
    for mod in (fm, build):
        monkeypatch.setattr(mod, "RAW", raw)
    monkeypatch.setattr(jsonio, "LOCK", tmp_path / ".lock")
    log = {
        "A/same": _fake_piece(raw, mirror, "A/same", "Public Domain", b"\\version 1\n", b"\\version 1\n", False),
        "B/changed": _fake_piece(raw, mirror, "B/changed", "Creative Commons Attribution 2.5", b"new\n", b"old\n",
                                 True),
        "C/nonfree": _fake_piece(raw, mirror, "C/nonfree", "Creative Commons Attribution-NonCommercial 3.0",
                                 b"x\n", None, False),
    }
    path = tmp_path / "candidates.json"
    rows = [{"slug": s, "ftpDir": d, "expectedLicense": e} for s, d, e in [
        ("same", "A/same", "Public Domain"),
        ("changed", "B/changed", "Public Domain"),
        ("nonfree", "C/nonfree", "Public Domain"),
        ("unfetched", "D/missing", "Public Domain"),
    ]]
    jsonio.write_json(path, {"_comment": ["kept"], "candidates": rows})

    report = fm.write_back(path, log, mirror)

    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["_comment"] == ["kept"]
    got = {c["slug"]: c for c in data["candidates"]}
    same = got["same"]
    assert (same["rdfLicense"], same["lyFile"], same["maintainer"], same["lilypondVersion"]) == \
        ("Public Domain", "same.ly", "A. Typesetter", "2.16.1")
    assert same["midiFiles"] == ["same.mid"] and same["pdfPages"] == 2
    assert same["mainSha256"] == hashlib.sha256(b"\\version 1\n").hexdigest() and same["mirrorMatch"] is True
    assert "excluded" not in same
    changed = got["changed"]
    assert changed["midiFiles"] == ["changed-mids/changed-2.mid", "changed-mids/changed.mid"]
    assert changed["mirrorMatch"] is False and "excluded" not in changed
    assert "NonCommercial" in got["nonfree"]["excluded"] and got["nonfree"]["mirrorMatch"] is None
    assert "rdfLicense" not in got["unfetched"]
    text = "\n".join(report)
    assert "changed" in text and "licence" in text.lower()  # RDF licence differs from expectedLicense
    assert "nonfree" in text and "unfetched" in text


def test_write_back_without_the_mirror_records_null(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    for mod in (fm, build):
        monkeypatch.setattr(mod, "RAW", raw)
    monkeypatch.setattr(jsonio, "LOCK", tmp_path / ".lock")
    log = {"A/p": _fake_piece(raw, tmp_path, "A/p", "Public Domain", b"x\n", None, False)}
    path = tmp_path / "c.json"
    jsonio.write_json(path, {"candidates": [{"slug": "p", "ftpDir": "A/p", "expectedLicense": "Public Domain"}]})
    fm.write_back(path, log, tmp_path / "no-such-mirror")
    assert json.loads(path.read_text(encoding="utf-8"))["candidates"][0]["mirrorMatch"] is None


def test_write_back_compares_a_lys_zip_with_the_mirror_folder(tmp_path, monkeypatch):
    """A -lys.zip with its own top folder extracts to <name>-lys/<name>-lys/; the mirror has <name>-lys/."""
    raw, mirror = tmp_path / "raw", tmp_path / "mirror"
    for mod in (fm, build):
        monkeypatch.setattr(mod, "RAW", raw)
    monkeypatch.setattr(jsonio, "LOCK", tmp_path / ".lock")
    log = {}
    for ftp, mirror_main in (("Z/same", b"main\n"), ("Z/diff", b"older main\n")):
        name = ftp.rsplit("/", 1)[-1]
        d = raw / ftp
        (d / f"{name}-lys" / f"{name}-lys").mkdir(parents=True)
        (d / f"{name}.rdf").write_text(RDF.format(licence="Public Domain", num="469", ly=f"{name}-lys.zip",
                                                  mid=f"{name}.mid"), encoding="utf-8")
        (d / f"{name}-lys.zip").write_bytes(b"PK")
        for f, data in (("main.ly", b"main\n"), ("header.ly", b"header\n")):
            (d / f"{name}-lys" / f"{name}-lys" / f).write_bytes(data)
        (mirror / ftp / f"{name}-lys").mkdir(parents=True)
        (mirror / ftp / f"{name}-lys" / "main.ly").write_bytes(mirror_main)
        (mirror / ftp / f"{name}-lys" / "header.ly").write_bytes(b"header\n")
        log[ftp] = {"ftpDir": ftp, "files": [
            {"name": f"{name}-lys.zip", "extracted": [f"{name}-lys/header.ly", f"{name}-lys/main.ly"]},
            {"name": f"{name}.rdf"}]}
    path = tmp_path / "c.json"
    jsonio.write_json(path, {"candidates": [{"slug": s, "ftpDir": f"Z/{s}", "expectedLicense": "Public Domain"}
                                            for s in ("same", "diff")]})
    fm.write_back(path, log, mirror)
    got = {c["slug"]: c for c in json.loads(path.read_text(encoding="utf-8"))["candidates"]}
    assert got["same"]["lyFiles"] == ["same-lys/header.ly", "same-lys/main.ly"]
    assert got["same"]["mainSha256"] == hashlib.sha256(b"PK").hexdigest()
    assert got["same"]["mirrorMatch"] is True and got["diff"]["mirrorMatch"] is False
    assert got["same"]["pdfPages"] is None and got["same"]["midiFiles"] == []


def test_candidate_dirs_follow_the_catalog_and_skip_duplicates():
    rows = [{"ftpDir": "X/a"}, {"ftpDir": "BurgmullerJFF/O100/25EF-01"}, {"ftpDir": "X/a"}, {"ftpDir": "X/b"}]
    assert fm.merge_dirs(["BurgmullerJFF/O100/25EF-01"], rows) == ["BurgmullerJFF/O100/25EF-01", "X/a", "X/b"]


def test_first_difference():
    assert repro.first_difference(b"a\nb\n", b"a\nb\n") is None
    assert repro.first_difference(b"a\nb\nc\n", b"a\nB\nc\n").startswith("line 2:")
    assert repro.first_difference(b"a\nb\n", b"a\n").startswith("line 2:")


def test_compare_reports_missing_and_differing_files(tmp_path):
    scores, out = tmp_path / "scores", tmp_path / "out"
    scores.mkdir()
    out.mkdir()
    (scores / "p.musicxml").write_bytes(b"<a/>\n")
    (out / "p.musicxml").write_bytes(b"<a/>\n")
    (scores / "p.fingered.musicxml").write_bytes(b"<f/>\n")
    (scores / "q.musicxml").write_bytes(b"<q/>\n")
    (out / "q.musicxml").write_bytes(b"<Q/>\n")
    same, total, lines = repro.compare(["p", "q"], out, scores)
    assert (same, total) == (1, 3)
    text = "\n".join(lines)
    assert "identical" in text and "p.fingered.musicxml" in text and "q.musicxml" in text
