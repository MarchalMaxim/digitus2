"""musicxml_passages: library windows from the engine dump become Passages with exact bars and beats."""
from __future__ import annotations

import json
from pathlib import Path
import re
from fractions import Fraction

import pytest

from teacher_review.musicxml_passages import (HIDDEN, LIBRARY_STYLE, IrregularWindow, derive_rests, library_window,
                                              measure_at, regular_anchor, render_round_trips)
from teacher_review.render import parse_rendering, render_passage

from .weekly_fixtures import REPO, eighths, lib_piece, line, needs_engine, nt, run_dump


def _rows(p, hand="R"):
    return [ln.split() for ln in render_passage(p).splitlines() if re.match(rf"{hand}\d", ln)]


def test_pickup_is_bar_zero_and_right_aligned():
    # 3/4 with a one-quarter upbeat (Happy Birthday): D4 dotted eighth + D4 sixteenth | E4 D4 G4 | F#4 half
    rh = [nt(-1, Fraction(3, 4), 62, 1), nt(Fraction(-1, 4), Fraction(1, 4), 62, 1), nt(0, 1, 64, 2), nt(1, 1, 62, 1),
          nt(2, 1, 67, 4), nt(3, 2, 66, 3)]
    p = lib_piece("happy", rh=rh, meter=(3, 4), bars=4, pickup_q=1)
    assert [m["number"] for m in p["measures"]] == ["0", "1", "2", "3", "4"]
    w = library_window(p, 0, 2, ["R"], "t-0001", fingers="none")
    assert (w.bar_first, w.bar_last, w.meter) == (0, 2, (3, 4))
    text = render_passage(w)
    assert "R1     0   3     e.    D4              -" in text
    assert "R2     0   3.75  s     D4              -" in text
    assert "R3     1   1     q     E4              -" in text
    assert "R6     2   1     h     F#4             -" in text


def test_compound_meter_upbeat_eighth():
    # 6/8 with an eighth upbeat (Greensleeves): the upbeat sits on beat 2.667 of bar 0
    rh = [nt(Fraction(-1, 2), Fraction(1, 2), 69, 1), nt(0, 1, 72, 2), nt(1, Fraction(1, 2), 74, 3)]
    p = lib_piece("green", rh=rh, meter=(6, 8), bars=2, pickup_q=Fraction(1, 2))
    text = render_passage(library_window(p, 0, 2, ["R"], "t-0002", fingers="none"))
    assert "R1     0   2.667 e     A4              -" in text
    assert "R2     1   1     q     C5              -" in text
    assert "R3     1   1.667 e     D5              -" in text


def test_grace_notes_precede_their_main_note_in_document_order():
    rh = [nt(0, Fraction(3, 2), 74, 5), nt(Fraction(3, 2), 0, 78, 4, grace=True), nt(Fraction(3, 2), Fraction(1, 2), 76, 3),
          nt(2, Fraction(1, 2), 72, 1)]
    p = lib_piece("graces", rh=rh, meter=(6, 8), bars=2)
    # like the engine, the fixture lists the main E5 (76) before the grace F#5 (78)
    assert [n["midi"] for n in p["notes"] if n["onsetTick"] == 6] == [76, 78]
    w = library_window(p, 0, 1, ["R"], "t-0003")
    rows = _rows(w)
    assert rows[1] == ["R2", "1", "2", "gr", "F#5", "4"]
    assert rows[2] == ["R3", "1", "2", "e", "E5", "3"]
    assert (w.notes_meta["source"]["R2"], w.notes_meta["source"]["R3"]) == ("n1", "n2")


def test_chord_takes_its_longest_note_and_rests_mark_silences():
    lh = [nt(0, 2, 48, 5), nt(0, 1, 52, 3), nt(0, 1, 55, 1), nt(3, 1, 43, 5)]
    rh = line(0, 1, [72, 74, 76, 77, 79, 77, 76, 74], [1, 2, 3, 4, 5, 4, 3, 2])
    p = lib_piece("chords", rh=rh, lh=lh, bars=2)
    assert [(r["hand"], r["measure"], r["beatQ"], r["durQ"]) for r in p["rests"]] == [("L", "1", 2.0, 1.0)]
    w = library_window(p, 0, 1, ["L"], "t-0004")
    rows = [ln.split() for ln in render_passage(w).splitlines() if re.match(r"L\d|- ", ln)]
    assert rows[0] == ["L1-3", "1", "1", "h", "C3+E3+G3", "5+3+1"]
    assert rows[1] == ["-", "1", "3", "q", "rest", "-"]
    assert rows[2] == ["L4", "1", "4", "q", "G2", "5"]


def test_window_membership_follows_onset_ticks():
    # a trill termination written at the end of bar 1 sounds on the downbeat of bar 2 (K.545 bars 25 and 70)
    rh = line(0, 1, [60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65, 67, 65, 64, 62], [1, 2, 3, 4, 5, 4, 3, 2] * 2)
    rh.append(nt(4, 0, 59, 1, grace=True))
    p = lib_piece("trill", rh=rh, bars=4)
    grace = next(n for n in p["notes"] if n["isGrace"])
    grace["measureIndex"], grace["measure"], grace["beatQ"] = 0, "1", 4.0   # as the engine reports it
    w = library_window(p, 1, 2, ["R"], "t-0005")
    assert _rows(w)[0][:4] == ["R1", "2", "1", "gr"]
    assert grace["id"] not in library_window(p, 2, 3, ["R"], "t-0006").notes_meta["source"].values()


@pytest.mark.parametrize("numbers,lengths,i1,i2", [
    (["1", "2", "2a", "3"], [4, 4, 1, 3], 0, 3),          # split measure number (Wild Rider 8a)
    (["1", "2", "3", "4"], [4, 2, 4, 4], 0, 3),           # short measure inside (Für Elise bar 8)
    (["1", "2", "4", "5"], [4, 4, 4, 4], 0, 3),           # numbers jump
    (["1", "2", "3", "4"], [4, 4, 4, 4], 1, 1),           # one measure
    (["0", "1", "2", "3"], [5, 4, 4, 4], 0, 3),           # an upbeat longer than a bar
])
def test_irregular_windows_are_refused(numbers, lengths, i1, i2):
    p = lib_piece("irregular", rh=line(0, 1, [60] * 15, [1] * 15), numbers=numbers, lengths_q=lengths)
    with pytest.raises(IrregularWindow):
        regular_anchor(p, i1, i2)


def test_regular_windows_and_their_anchor():
    p = lib_piece("regular", rh=line(0, 1, [60] * 14, [1] * 14), numbers=["1", "2", "3", "4"], lengths_q=[4, 4, 4, 2])
    assert regular_anchor(p, 2, 3) == 2                   # a short last bar may close the window
    up = lib_piece("upbeat", rh=line(-1, 1, [60] * 9, [1] * 9), bars=2, pickup_q=1)
    assert regular_anchor(up, 0, 2) == 1                  # the upbeat may open it
    meter = lib_piece("meter", rh=line(0, 1, [60] * 12, [1] * 12), bars=3)
    meter["measures"][2]["beats"] = 3
    with pytest.raises(IrregularWindow):
        regular_anchor(meter, 0, 2)
    with pytest.raises(IrregularWindow):
        regular_anchor(lib_piece("long", rh=line(0, 1, [60] * 40, [1] * 40), bars=10), 0, 8)


def test_measure_at_and_rests_follow_ticks():
    p = lib_piece("gaps", rh=[nt(0, 1, 60, 1), nt(3, 1, 62, 2), nt(5, Fraction(1, 4), 64, 3), nt(Fraction(23, 4), 1, 65, 4)], bars=2)
    assert [measure_at(p, t) for t in (0, 15, 16, 31)] == [0, 0, 1, 1]
    assert [(r["measure"], r["beatQ"], r["durQ"]) for r in derive_rests(p)] == [
        ("1", 1.0, 2.0), ("2", 0.0, 1.0), ("2", 1.25, 0.5)]


def test_style_table_covers_the_core30_and_parses():
    # The table names composer and style for the core30 pieces; the pieces added by L1 fall back to
    # _fallback_composer and the hidden style (library_window) until the table is extended.
    manifest = json.loads((REPO / "content" / "manifest.json").read_text(encoding="utf-8"))
    core30 = {e["slug"] for e in manifest if e.get("benchmarkSet", "core30") == "core30"}
    assert len(core30) == 30
    assert core30 <= set(LIBRARY_STYLE)
    for composer, style in list(LIBRARY_STYLE.values()) + [HIDDEN]:
        assert composer and style and "(" not in composer and ")" not in style


def test_recall_options_hide_the_composer_and_renumber_bars():
    p = lib_piece("twinkle-twinkle-little-star", rh=line(0, 1, [60, 62, 64, 65] * 4, [1, 2, 3, 4] * 4), bars=4)
    w = library_window(p, 2, 3, ["R"], "t-0007", composer=HIDDEN[0], style=HIDDEN[1], first_bar=1)
    head = render_passage(w).splitlines()[1]
    assert head.startswith("Composer: unknown (piano piece). Meter: 4/4.") and head.endswith("Bars 1-2.")
    assert parse_rendering(render_passage(w)).bar_first == 1
    normal = render_passage(library_window(p, 2, 3, ["R"], "t-0007")).splitlines()[1]
    assert normal.startswith("Composer: Traditional (children's song, arranged).") and normal.endswith("Bars 3-4.")


def test_engine_fingers_only_on_reviewed_hands_with_engine_info():
    rh = [dict(n, lint=["L11"]) if k == 0 else n for k, n in enumerate(eighths(2))]
    p = lib_piece("fingers", rh=rh, lh=[nt(0, 4, 48, 5), nt(4, 4, 43, 5)], bars=2)
    w = library_window(p, 0, 1, ["R"], "t-0008")
    assert all(f > 0 for e in w.sounding("R") for f in e.fingers)
    assert all(f == 0 for e in w.sounding("L") for f in e.fingers)
    assert w.notes_meta["engine"]["R1"] == {"id": "n0", "finger": 1, "confidence": 0.95, "lint": ["L11"]}
    assert w.notes_meta["piece"] == "fingers" and w.notes_meta["measures"] == [0, 1]


def test_render_round_trips_flags_column_overflow():
    # a five-note chord A3+C#4+F#4+A4+D5 fills render.py's 16-character pitch column (Satie bar 36)
    rh = [nt(0, 2, m, f) for m, f in zip([57, 61, 66, 69, 74], [1, 2, 3, 4, 5])] + line(2, 1, [74, 73], [5, 4]) \
        + line(4, 1, [69, 71, 73, 74], [1, 2, 3, 4])
    w = library_window(lib_piece("satie-like", rh=rh, bars=2), 0, 1, ["R"], "t-0009")
    assert render_round_trips(w) is False
    ok = library_window(lib_piece("plain", rh=eighths(2), bars=2), 0, 1, ["R"], "t-0010")
    assert render_round_trips(ok) is True


# ---- against the real library (needs node and the engine build) -------------------------------

@pytest.fixture(scope="module")
def library(tmp_path_factory):
    out = tmp_path_factory.mktemp("lib") / "library.json"
    # The core30 benchmark set: the round-trip counts below were measured on the first 30 pieces
    # and must not move when the library grows (L1 plan, deferred item l).
    root = Path(__file__).resolve().parents[3]
    entries = json.loads((root / "content" / "manifest.json").read_text(encoding="utf-8"))
    core30 = [e["slug"] for e in entries if e.get("benchmarkSet", "core30") == "core30"]
    assert len(core30) == 30, len(core30)
    r = run_dump(out, "--manifest", "content/manifest.json", "--slugs", ",".join(core30))
    assert r.returncode == 0, r.stderr
    return {p["id"]: p for p in json.loads(out.read_text(encoding="utf-8"))["pieces"]}


def _expected_bar_beat(p, tick):
    mi = measure_at(p, tick)
    m = p["measures"][mi]
    beats, beat_type = m["beats"], m["beatType"]
    beat_q = Fraction(3, 2) if beat_type == 8 and beats % 3 == 0 and beats >= 6 else Fraction(4, beat_type)
    offset = Fraction(tick - m["startTick"], p["divisions"])
    nominal = Fraction(p["divisions"] * 4 * beats, beat_type)
    if mi == 0 and m["lengthTicks"] < nominal:
        offset += Fraction(nominal - m["lengthTicks"], p["divisions"])     # an upbeat is right-aligned
    return m["number"], offset / beat_q + 1


@needs_engine
def test_dump_rests_match_the_python_rule(library):
    for p in library.values():
        assert p["rests"] == derive_rests(p), p["id"]


@needs_engine
def test_every_regular_window_of_the_library_round_trips(library):
    clean = overflow = 0
    for p in library.values():
        notes = {n["id"]: n for n in p["notes"]}
        for i1 in range(len(p["measures"]) - 3):
            try:
                regular_anchor(p, i1, i1 + 3)
            except IrregularWindow:
                continue
            w = library_window(p, i1, i1 + 3, ["R", "L"], "t-0011")
            if not render_round_trips(w):
                overflow += 1
                continue
            clean += 1
            for evs in w.events.values():
                for e in evs:
                    if e.is_rest:
                        continue
                    bar, beat = w.bar_beat(e.onset_q)
                    for sid in e.source_ids:
                        assert (str(bar), beat) == _expected_bar_beat(p, notes[sid]["onsetTick"]), (p["id"], i1, sid)
    # measured while writing the plan: 779 regular four-bar windows, 10 of them overflow render.py's columns
    assert (clean, overflow) == (769, 10)


@needs_engine
def test_real_scores_render_as_on_the_page(library):
    hb = render_passage(library_window(library["happy-birthday"], 0, 2, ["R"], "t-0012", fingers="none"))
    assert "R1     0   3     e.    D4              -" in hb and "L1-2   1   1     h.    G2+D3           -" in hb
    pastorale = _rows(library_window(library["burgmuller-op100-no3-pastorale"], 2, 4, ["R"], "t-0013", fingers="none"))
    assert pastorale[3][:5] == ["R4", "3", "2.667", "gr", "F#5"] and pastorale[4][:5] == ["R5", "3", "2.667", "e", "E5"]
    assert [r[3] for r in pastorale[10:13]] == ["gr", "gr", "e"]
    waltz = render_passage(library_window(library["chopin-waltz-op69-no2"], 13, 15, ["L"], "t-0014", fingers="none"))
    assert "-      14  3     q     rest            -" in waltz
