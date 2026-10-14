"""select: the five sets of the weekly review."""
from __future__ import annotations

import json
from collections import Counter
from fractions import Fraction
from itertools import combinations

import pytest

from teacher_review.gallery import check_against_dump, parse_page
from teacher_review.musicxml_passages import library_window, render_round_trips
from teacher_review.pig_passages import PIECES, annotation_files
from teacher_review.render import render_passage
from teacher_review.select import (PER_PIECE_HARDERR, PIG_TEST, PIG_VALIDATION_META, USABLE_PIG, build_passages,
                                   load_pig, plant_and_twin, select_all, select_controls, select_harderr,
                                   select_lowconf, validation_bench_split)

from .weekly_fixtures import (REPO, bench_gallery, chords, eighths, fake_dump, gallery_page, lib_piece, needs_engine,
                              needs_pig, nt, pig_dump_piece, pig_piece, quarters, run_dump)

VALIDATION_SPLIT = REPO / "research" / "data" / "splits" / "pig_validation.json"
OFFICIAL_SPLIT = REPO / "research" / "data" / "splits" / "pig_official.json"


def test_lowconf_takes_the_lowest_seeds_two_per_piece_without_overlap():
    a = lib_piece("piece-a", rh=eighths(16, conf={(5, 0): 0.2, (12, 0): 0.25, (9, 0): 0.3}), bars=16, level=4)
    b = lib_piece("piece-b", rh=quarters(8, conf={(3, 0): 0.22}), bars=8, level=2)
    c = lib_piece("piece-c", lh=[nt(4 * i, 2, 48, 5, conf=0.1) for i in range(8)], bars=8, level=1)   # 2.4 s apart
    first3 = select_lowconf([a, b, c], seed=7, n=3)
    assert [(r["piece"], r["measures"], r["hands"]) for r in first3] == [
        ("piece-a", [4, 5], ["R"]), ("piece-b", [1, 4], ["R"]), ("piece-a", [11, 12], ["R"])]
    assert (first3[0]["seed_note"], first3[0]["seed_confidence"]) == ("R1", 0.2)
    full = select_lowconf([a, b, c], seed=7)
    assert Counter(r["piece"] for r in full) == {"piece-a": 2, "piece-b": 2}
    for x, y in combinations([r for r in full if r["piece"] == "piece-b"], 2):
        assert x["measures"][1] < y["measures"][0] or y["measures"][1] < x["measures"][0]
    assert select_lowconf([a, b, c], seed=7) == full


def test_lowconf_skips_a_literal_repeat():
    d = lib_piece("piece-d", rh=eighths(8, conf={(1, 0): 0.2, (5, 0): 0.21}, vary=False), bars=8)
    assert [r["measures"] for r in select_lowconf([d], seed=1)] == [[0, 1]]


def test_lowconf_window_is_the_shortest_centred_one_with_enough_notes():
    e = lib_piece("piece-e", rh=quarters(12, conf={(6, 0): 0.2}, beats=3), meter=(3, 4), bars=12)
    (r,) = select_lowconf([e], seed=1, n=1)
    assert r["measures"] == [3, 8]                       # 16 notes need six bars, centred on bar 6
    f = lib_piece("piece-f", rh=[nt(2 * k, 2, 60 + k % 5, 1 + k % 5, conf=0.2 if k == 4 else 0.95) for k in range(10)],
                  bars=5, tempo=120)
    (r,) = select_lowconf([f], seed=1, n=1)
    assert r["measures"] == [0, 4]                       # 16 is out of reach; ten notes in five bars


def _hard_setup():
    rh = [(i * 0.5, 0.5, 60 + (i % 8)) for i in range(64)]            # 8 bars of eighths
    lh = [(i * 1.0, 1.0, 48 + (i % 5)) for i in range(32)]            # 8 bars of quarters
    piece = pig_piece("950", rh, lh)
    dp = pig_dump_piece("950", piece, {sid: 1 for sid in piece.source_hand})
    idx = {(n["hand"], n["onsetSec"]): n for n in dp["notes"]}
    picks = [("R", s) for s in (4.0, 4.25, 4.5, 4.75, 5.0, 6.0, 6.25)] + [("L", 12.0)]   # bars 3 (5), 4 (2), 7 (L)
    rows = [(idx[k]["index"], k[0], idx[k]["pitch"], 1, 30, [2, 2, 2], True) for k in picks]
    return piece, dp, {"950": parse_page("950", gallery_page("950", rows))}


def test_harderr_ranks_windows_by_hard_errors_and_prefers_short_ones():
    piece, dp, rows = _hard_setup()
    recs, skipped = select_harderr({"950": dp}, rows, loader=lambda pid, slot: piece, usable={"950"})
    assert [(r["bars"], r["hands"], len(r["hard"])) for r in recs] == [([3, 4], ["R"], 7), ([5, 7], ["L"], 1)]
    assert skipped == {"unusable grid": 0, "not in the quantised piece": 0, "not covered": 0}
    one, skipped = select_harderr({"950": dp}, rows, loader=lambda pid, slot: piece, usable={"950"}, cap=1)
    assert len(one) == 1 and skipped["not covered"] == 1
    none, skipped = select_harderr({"950": dp}, rows, loader=lambda pid, slot: piece, usable=set())
    assert none == [] and skipped["unusable grid"] == 8


def _spread_setup(pid: str):
    """24 bars of RH eighths with one hard error on beat 1 of bars 2, 6, 10, 14, 18 and 22: no window of at
    most four bars holds two of them, so every hard error needs a window of its own."""
    piece = pig_piece(pid, [(i * 0.5, 0.5, 60 + (i % 8)) for i in range(8 * 24)], bars=24)
    dp = pig_dump_piece(pid, piece, {sid: 1 for sid in piece.source_hand})
    at = {n["onsetSec"]: n for n in dp["notes"]}
    rows = [(at[2.0 * (bar - 1)]["index"], "R", at[2.0 * (bar - 1)]["pitch"], 1, 30, [2, 2], True)
            for bar in (2, 6, 10, 14, 18, 22)]
    return piece, dp, parse_page(pid, gallery_page(pid, rows))


def test_harderr_takes_at_most_four_windows_per_piece():
    """Coordinator decision for M7-A: at most four windows per piece, besides the cap of 16 overall."""
    assert PER_PIECE_HARDERR == 4
    pieces, pig, rows = {}, {}, {}
    for pid in ("951", "952"):
        pieces[pid], pig[pid], rows[pid] = _spread_setup(pid)

    def loader(pid, slot):
        return pieces[pid]

    recs, skipped = select_harderr(pig, rows, loader=loader, usable={"951", "952"})
    assert [(r["passage"], r["pig"], r["bars"]) for r in recs] == [
        ("he01", "951", [1, 2]), ("he02", "951", [5, 6]), ("he03", "951", [9, 10]), ("he04", "951", [13, 14]),
        ("he05", "952", [1, 2]), ("he06", "952", [5, 6]), ("he07", "952", [9, 10]), ("he08", "952", [13, 14])]
    assert skipped == {"unusable grid": 0, "not in the quantised piece": 0, "not covered": 4}
    six, skipped = select_harderr({"951": pig["951"]}, {"951": rows["951"]}, loader=loader, usable={"951"}, per_piece=8)
    assert len(six) == 6 and skipped["not covered"] == 0
    five, _ = select_harderr(pig, rows, loader=loader, usable={"951", "952"}, cap=5)
    assert Counter(r["pig"] for r in five) == {"951": 4, "952": 1}


def test_harderr_never_takes_the_official_test_pieces():
    """Errors on the official PIG test pieces 001 to 030 must not seed hypotheses (coordinator decision)."""
    piece, dp, rows = _hard_setup()
    with pytest.raises(ValueError, match="test pieces 001"):
        select_harderr({"001": dp}, {"001": rows["950"]}, loader=lambda pid, slot: piece, usable={"001"})


def test_hard_errors_come_from_the_validation_pieces_only():
    validation = json.loads(VALIDATION_SPLIT.read_text(encoding="utf-8"))["pieces"]
    official = json.loads(OFFICIAL_SPLIT.read_text(encoding="utf-8"))
    assert PIG_TEST == set(official["splits"][official["default_split"]]["test"]["pieces"])
    assert USABLE_PIG == set(PIG_VALIDATION_META) and USABLE_PIG <= set(validation) and not USABLE_PIG & PIG_TEST
    split = validation_bench_split()
    assert split["splits"][split["default_split"]]["test"]["pieces"] == validation
    with pytest.raises(KeyError):
        load_pig("001", "1")


def _library(levels=(1, 2, 3, 3, 4, 5, 1, 2, 2, 3, 1, 2), tritone=True):
    lib = []
    for k, level in enumerate(levels):
        slug = f"c{k:02d}"
        lib.append(lib_piece(slug, rh=eighths(12, shift=k), lh=chords(12), bars=12, level=level))
        if tritone:
            tt = eighths(12, shift=k)
            tt[2] = dict(tt[2], finger=2)                                    # the engine fingers the new key differently
            lib.append(lib_piece(slug, rh=tt, lh=chords(12), bars=12, level=level, transpose=6))
    return lib


def test_controls_are_random_level_1_to_3_windows_one_per_piece_avoiding_lowconf():
    lib = _library()
    by_id = {p["id"]: p for p in lib}
    low = [{"piece": "c00", "measures": [2, 5]}]
    ctrl = select_controls(lib, low, seed=11)
    assert len(ctrl) == 10 and len({r["piece"] for r in ctrl}) == 10
    assert all(by_id[r["piece"]]["level"] <= 3 and by_id[r["piece"]]["transpose"] == 0 for r in ctrl)
    for r in ctrl:
        i1, i2 = r["measures"]
        assert 2 <= i2 - i1 + 1 <= 8
        if r["piece"] == "c00":
            assert i2 < 2 or i1 > 5
        p = library_window(by_id[r["piece"]], i1, i2, r["hands"], "x")
        assert all(10 <= len(p.notes(h)) <= 48 for h in r["hands"])
        assert sum(len(p.notes(h)) for h in p.events) <= 96
    assert select_controls(lib, low, seed=11) == ctrl and select_controls(lib, low, seed=12) != ctrl


def test_planted_twins_come_first_and_recall_twins_from_the_rest():
    lib = _library()
    ctrl = select_controls(lib, [], seed=11)
    planted, recall = plant_and_twin(ctrl, {p["id"]: p for p in lib}, seed=11)
    assert len(planted) == 4 and len(recall) == 4
    assert {r["twin_of"] for r in planted}.isdisjoint({r["twin_of"] for r in recall})
    by_pid = {r["passage"]: r for r in ctrl}
    for r in planted:
        assert 2 <= len(r["faults"]) <= 3 and r["measures"] == by_pid[r["twin_of"]]["measures"]
    for r in recall:
        assert r["piece"] == by_pid[r["twin_of"]]["piece"] + "@tritone" and r["transpose"] == 6
    passages = build_passages(ctrl + planted, fake_dump(*lib))
    for r in planted:
        before, after = passages[r["twin_of"]], passages[r["passage"]]
        changed = {nid for h in after.target_hands for nid, f in after.finger_map(h).items()
                   if before.finger_map(h)[nid] != f}
        recorded = {nid for f in r["faults"] for nid in f["notes"] if f["before"][nid] != f["after"][nid]}
        assert changed == recorded


def test_recall_twin_uses_transposed_engine_fingers():
    orig = lib_piece("tw", rh=eighths(4, vary=False), bars=4, level=1)
    tt_notes = [dict(n, finger=2) if n["midi"] == 64 else n for n in eighths(4, vary=False)]
    tt = lib_piece("tw", rh=tt_notes, bars=4, level=1, transpose=6)
    rec = {"passage": "rc01", "set": "recall", "source": "library", "piece": "tw@tritone", "slug": "tw", "title": "T",
           "level": 1, "measures": [2, 3], "hands": ["R"], "twin_of": "ct01", "transpose": 6}
    p = build_passages([rec], fake_dump(orig, tt))["rc01"]
    head = render_passage(p).splitlines()[1]
    assert head.startswith("Composer: unknown (piano piece).") and head.endswith("Bars 1-2.")
    assert [pitch for _, pitch, _, _, _ in p.notes("R")][:3] == [66, 68, 70]
    assert p.finger_string("R").split()[:3] == ["1", "2", "2"]          # the transposed piece's fingers, not 1 2 3


def test_select_all_numbers_sets_and_is_deterministic():
    dump = fake_dump(*_library())
    sel = select_all(dump, {}, seed=3)
    ids = [r["passage"] for r in sel["records"]]
    assert ids == sorted(ids, key=lambda x: (["lc", "he", "ct", "pf", "rc"].index(x[:2]), x))
    assert sel["counts"] == {s: sum(r["set"] == s for r in sel["records"])
                             for s in ("lowconf", "harderr", "control", "planted", "recall")}
    assert sel["counts"]["harderr"] == 0 and sel["counts"]["control"] == 10
    assert select_all(dump, {}, seed=3) == sel
    passages = build_passages(sel["records"], dump)
    assert set(passages) == set(ids)


# ---- the PIG validation pieces (needs the PIG dataset; the last test also needs the engine build) ----------

def _on_beat_one(piece, shift_beats: int) -> float:
    """Share of the sounding time (event durations) that starts on beat 1 when the bar line moves later by
    ``shift_beats`` beats."""
    beat = Fraction(4, piece.meter[1])
    bar = beat * piece.meter[0]
    evs = [e for es in piece.events.values() for e in es if not e.is_rest]
    on_one = sum(e.dur_q for e in evs if (e.onset_q + shift_beats * beat) % bar == 0)
    return float(on_one / sum(e.dur_q for e in evs))


@needs_pig
def test_validation_pieces_with_two_annotations_load_with_a_usable_grid():
    """bench marks a note hard only when two or more annotators agree, so the validation pieces with two
    annotations are exactly the ones that can give hard errors. Each loads with its meter and style and passes
    the pilot's grid criterion (85 percent of onsets on the grid); the upbeat read off the score puts the bar line
    where the playing does (more sounding time starts on beat 1 than with the bar line moved by one or two
    beats); and pig_passages.PIECES stays as it was."""
    validation = json.loads(VALIDATION_SPLIT.read_text(encoding="utf-8"))["pieces"]
    assert [pid for pid in validation if len(annotation_files(pid)) >= 2] == sorted(PIG_VALIDATION_META)
    before = dict(PIECES)
    for pid, meta in sorted(PIG_VALIDATION_META.items()):
        piece = load_pig(pid, sorted(annotation_files(pid))[0])
        assert (piece.piece_id, piece.meter, piece.style) == (pid, meta["meter"], meta["style"])
        assert piece.grid.align >= 0.85 and piece.grid.flags == []
        shares = [_on_beat_one(piece, k) for k in range(piece.meter[0])]
        assert shares[0] > max(shares[1:]), (pid, shares)
    assert PIECES == before


@needs_pig
@needs_engine
def test_harderr_on_the_validation_gallery(tmp_path):
    """The real path: bench (medium) on the validation pieces with two annotations, the engine dump of those
    pieces, and the default loader and usable set. Every window is 2 to 4 bars with 10 to 48 notes per reviewed
    hand, round-trips through the renderer, shows the engine's fingers and marks each hard note, where the
    engine's finger differs from the annotators'."""
    pids = sorted(PIG_VALIDATION_META)
    out = tmp_path / "dump.json"
    r = run_dump(out, "--pig-dir", "research/data/pig", "--pig-pieces", ",".join(pids))
    assert r.returncode == 0, r.stderr
    dump = json.loads(out.read_text(encoding="utf-8"))
    rows = bench_gallery(tmp_path, pids, "medium")
    assert check_against_dump(rows, dump) == []
    pig = {p["pigId"]: p for p in dump["pieces"]}
    recs, skipped = select_harderr(pig, rows)
    assert (recs, skipped) == select_harderr(pig, rows)
    n_hard = sum(r.hard for rs in rows.values() for r in rs)
    assert skipped["unusable grid"] == 0 and skipped["not in the quantised piece"] == 0
    assert sum(len(r["hard"]) for r in recs) + skipped["not covered"] == n_hard
    assert 1 <= len(recs) <= 16 and max(Counter(r["pig"] for r in recs).values()) <= PER_PIECE_HARDERR
    assert [r["passage"] for r in recs] == [f"he{k:02d}" for k in range(1, len(recs) + 1)]
    passages = build_passages(recs, dump)
    for rec in recs:
        p = passages[rec["passage"]]
        assert rec["pig"] in USABLE_PIG and rec["slot"] == "1" and 2 <= rec["bars"][1] - rec["bars"][0] + 1 <= 4
        assert render_round_trips(p) and (p.bar_first, p.bar_last) == tuple(rec["bars"])
        assert all(10 <= len(p.notes(h)) <= 48 for h in rec["hands"])
        assert sum(len(p.notes(h)) for h in p.events) <= 96
        engine = {n["id"]: n["finger"] for n in pig[rec["pig"]]["notes"]}
        for h in rec["hands"]:
            assert all(f == engine[p.notes_meta["source"][nid]] for nid, f in p.finger_map(h).items())
        assert len(p.notes_meta["hard"]) == len(rec["hard"]) >= 1
        for nid, finger in p.notes_meta["hard"].items():
            assert p.notes_meta["source"][nid] in rec["hard"] and p.finger_map(nid[0])[nid] != finger
