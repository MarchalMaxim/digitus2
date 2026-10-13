"""Renderer: the compact text block round-trips through the parser, and every rendered
line is unambiguous (one event per line, ids, chords, rests, durations, beats)."""
from fractions import Fraction

import pytest

from teacher_review.model import Passage
from teacher_review.render import dur_label, fmt_beat, parse_beat, parse_dur, parse_rendering, render_passage

from .conftest import make_passage


def _events(p: Passage, hand: str):
    return [(e.onset_q, e.dur_q, tuple(e.pitches), tuple(e.fingers) if not e.is_rest else ()) for e in p.events[hand]]


def test_round_trip_scale(scale_passage):
    text = render_passage(scale_passage)
    back = parse_rendering(text)
    assert back.passage_id == scale_passage.passage_id
    assert back.meter == scale_passage.meter and back.tempo_qpm == scale_passage.tempo_qpm
    assert back.target_hands == ["R"]
    assert _events(back, "R") == _events(scale_passage, "R")
    # the context hand keeps pitches and rhythm; fingers are blanked (0)
    assert [(o, d, pi) for o, d, pi, _ in _events(back, "L")] == [(o, d, pi) for o, d, pi, _ in _events(scale_passage, "L")]
    assert all(f == 0 for e in back.events["L"] for f in e.fingers)
    assert back.finger_string("R") == "1 2 3 1 2 3 4 5 5 4 3 2 1 3 2 1"


def test_ids_are_stable_and_chords_numbered_low_to_high():
    p = make_passage([(0, 1, [67, 60, 64], [5, 1, 3]), (1, 1, [62], [2]), (2, 0.5, [], []), (2.5, 0.5, [65], [4])])
    text = render_passage(p)
    lines = text.splitlines()
    assert any(ln.startswith("R1-3 ") and "C4+E4+G4" in ln and ln.rstrip().endswith("1+3+5") for ln in lines)
    assert any(ln.startswith("R4 ") and "D4" in ln for ln in lines)
    assert any(ln.startswith("- ") and "rest" in ln for ln in lines)
    assert any(ln.startswith("R5 ") and "F4" in ln for ln in lines)
    back = parse_rendering(text)
    assert _events(back, "R") == _events(p, "R")


@pytest.mark.parametrize("q,label", [(4, "w"), (2, "h"), (1, "q"), (0.5, "e"), (0.25, "s"), (0.125, "t"),
                                     (1.5, "q."), (0.75, "e."), (Fraction(1, 3), "e3"), (Fraction(2, 3), "q3"),
                                     (Fraction(1, 6), "s3"), (2.5, "2.5q"), (Fraction(1, 24), "gr")])
def test_duration_labels_round_trip(q, label):
    q = Fraction(q).limit_denominator(48)
    assert dur_label(q) == label
    assert parse_dur(label) == q


@pytest.mark.parametrize("beat", [Fraction(1), Fraction(5, 2), Fraction(7, 4), Fraction(4, 3), Fraction(11, 6)])
def test_beat_round_trip(beat):
    assert parse_beat(fmt_beat(beat)) == beat


def test_compound_meter_bars_and_beats():
    # 6/8: beat = dotted quarter, two beats per bar; a note at quarter 4.5 is bar 2 beat 2
    p = make_passage([(0, 0.5, [60], [1]), (1.5, 0.5, [62], [2]), (3, 0.5, [64], [3]), (4.5, 0.5, [65], [4]),
                      (5, 0.5, [67], [5])], meter=(6, 8))
    text = render_passage(p)
    assert "R3     2   1     e     E4" in text
    assert "R4     2   2     e     F4" in text
    assert "R5     2   2.333 e     G4" in text
    back = parse_rendering(text)
    assert _events(back, "R") == _events(p, "R")


def test_both_hands_reviewed_render_fingers_for_both():
    p = make_passage([(0, 1, [72], [5])], lh=[(0, 1, [48], [5])], target=("R", "L"))
    text = render_passage(p)
    assert "Review: RH and LH fingering" in text
    assert "L1     1   1     q     C3              5" in text
    assert parse_rendering(text).target_hands == ["R", "L"]


def test_every_note_line_has_six_columns(scale_passage):
    for ln in render_passage(scale_passage).splitlines()[4:]:
        if ln in ("RH", "LH", "LH (context)", "RH (context)"):
            continue
        assert len(ln.split()) == 6, ln
