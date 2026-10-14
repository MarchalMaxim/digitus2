"""gallery: bench error galleries, their agreement with the dump, PIG passages with engine fingers."""
from __future__ import annotations

import json

import pytest

from fingering_eval.pig_io import read_pig
from teacher_review.gallery import check_against_dump, parse_page, pig_engine_window, read_gallery, slot_of
from teacher_review.pig_passages import annotation_files, build_piece

from .weekly_fixtures import (REPO, bench_gallery, fake_dump, gallery_page, needs_engine, needs_pig, pig_dump_piece,
                              pig_piece, run_dump)

VALIDATION_SPLIT = REPO / "research" / "data" / "splits" / "pig_validation.json"


def test_read_gallery_reads_rows_and_hard_flags(tmp_path):
    rows = [(5, "R", "E4", 2, 41, [3, 3, 3], True), (7, "R", "G4", 5, 88, [5, 4, 5], False),
            (12, "L", "C3", 5, 55, [4, 4, 4], True)]
    (tmp_path / "900.md").write_text(gallery_page("900", rows), encoding="utf-8")
    (tmp_path / "notes.md").write_text("not a page", encoding="utf-8")
    g = read_gallery(tmp_path)
    assert list(g) == ["900"]
    assert [(r.index, r.hand, r.pitch, r.engine_finger, r.annotators, r.hard) for r in g["900"]] == [
        (5, "R", "E4", 2, (3, 3, 3), True), (7, "R", "G4", 5, (5, 4, 5), False), (12, "L", "C3", 5, (4, 4, 4), True)]
    assert (g["900"][0].confidence, g["900"][0].onset_s, g["900"][0].bar) == (0.41, 1.25, "-")


def test_parse_page_reads_bench_rows_verbatim():
    bench_row = ("| 12 | - | 3.00 | L | C3 | E3:3 D3:4 [C3] B2:1 A2:2 | 5 (55%) thumbPassing 2.0 | - | 4 4 4 "
                 "| 4: held note 9 (+1.5) | hard |")
    (row,) = parse_page("901", bench_row + "\n")
    assert (row.index, row.engine_finger, row.annotators, row.hard) == (12, 5, (4, 4, 4), True)
    unfingered = "| 3 | - | 0.50 | R | D4 | C4:1 [D4] E4:3 | - (0%) no cost | - | 2 - 2 | 2: +1.0 |  |"
    (row,) = parse_page("901", unfingered + "\n")
    assert row.engine_finger is None and row.annotators == (2, None, 2) and not row.hard


def test_gallery_and_dump_must_agree():
    piece = pig_piece("900", rh=[(i * 0.5, 0.5, 60 + i) for i in range(16)])
    fingers = {str(i): (i % 5) + 1 for i in range(16)}
    dump = fake_dump(pig_dump_piece("900", piece, fingers))
    good = {"900": parse_page("900", gallery_page("900", [(5, "R", "F4", 1, 40, [3, 3, 3], True)]))}
    assert check_against_dump(good, dump) == []
    bad = {"900": parse_page("900", gallery_page("900", [(5, "R", "F4", 4, 40, [3, 3, 3], True),
                                                         (99, "R", "C4", 1, 40, [2, 2, 2], True)]))}
    assert check_against_dump(bad, dump) == ["900 #5: gallery engine finger 4, dump 1", "900 #99: no such note in the dump"]
    missing = {"901": parse_page("901", gallery_page("901", [(1, "R", "C4", 1, 40, [2, 2], True)]))}
    assert check_against_dump(missing, dump) == ["901: the dump has no PIG piece 901"]
    assert slot_of(dump["pieces"][0]) == "1"


def test_pig_engine_window_sets_engine_fingers_on_reviewed_hands_only():
    rh = [(i * 0.5, 0.5, 60 + (i % 8)) for i in range(32)]
    lh = [(i * 2, 2, 48) for i in range(8)]
    piece = pig_piece("902", rh, lh)
    dp = pig_dump_piece("902", piece, {sid: 3 for sid in piece.source_hand})
    p = pig_engine_window(piece, 2, 3, ["R"], "t-0100", dp)
    assert (p.bar_first, p.bar_last, p.target_hands) == (2, 3, ["R"])
    assert len(p.notes("R")) == 16 and set(p.finger_map("R").values()) == {3}
    assert all(f == 0 for e in p.sounding("L") for f in e.fingers)
    assert p.notes_meta["engine"]["R1"] == {"id": p.notes_meta["source"]["R1"], "finger": 3, "confidence": 0.5, "lint": []}
    del dp["notes"][5]                 # note "5" sounds in bar 1
    with pytest.raises(KeyError):
        pig_engine_window(piece, 1, 2, ["R"], "t-0101", dp)


@needs_pig
@needs_engine
def test_build_piece_and_dump_share_note_ids(tmp_path):
    out = tmp_path / "pig.json"
    assert run_dump(out, "--pig-dir", "research/data/pig", "--pig-pieces", "001").returncode == 0
    (dp,) = json.loads(out.read_text(encoding="utf-8"))["pieces"]
    piece = build_piece("001", slot_of(dp))
    hand_of = {sid: hand for hand, evs in piece.events.items() for e in evs for sid in e.source_ids}
    assert set(hand_of) == {n["id"] for n in dp["notes"]}
    assert all(hand_of[n["id"]] == n["hand"] for n in dp["notes"])


@needs_pig
@needs_engine
def test_validation_gallery_and_dump_agree(tmp_path):
    """The hard-error set comes from the PIG validation pieces, never from the official test pieces 001 to 030
    (coordinator decision for M7-A). A hard row needs two or more annotations, so only four validation pieces
    can carry one. On them the dump keeps the PIG file's note ids and hands, a gallery of the same engine and
    profile agrees with the dump, and one of another profile does not."""
    pieces = json.loads(VALIDATION_SPLIT.read_text(encoding="utf-8"))["pieces"]
    assert len(pieces) == 20 and all(int(pid) > 30 for pid in pieces)
    two = [pid for pid in pieces if len(annotation_files(pid)) >= 2]
    assert two == ["046", "066", "076", "077"]
    out = tmp_path / "dump.json"
    r = run_dump(out, "--pig-dir", "research/data/pig", "--pig-pieces", ",".join(two))
    assert r.returncode == 0, r.stderr
    dump = json.loads(out.read_text(encoding="utf-8"))
    assert [dp["pigId"] for dp in dump["pieces"]] == two
    for dp in dump["pieces"]:
        first = read_pig(annotation_files(dp["pigId"])[slot_of(dp)])
        assert {n.id: n.hand for n in first.notes} == {n["id"]: n["hand"] for n in dp["notes"]}
    medium = bench_gallery(tmp_path, two, "medium")
    assert sorted(medium) == two and all(any(r.hard for r in medium[pid]) for pid in two)
    assert check_against_dump(medium, dump) == []
    assert check_against_dump(bench_gallery(tmp_path, two, "large"), dump) != []
