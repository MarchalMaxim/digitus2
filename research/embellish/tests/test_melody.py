"""Finding the melody (the right hand's top voice) and the piece-level refusals."""
from __future__ import annotations

from embellish import core
from embellish.tests.fixtures import score


def test_single_voice_right_hand_is_the_melody():
    piece = core.analyse(score([[("C4", 1), ("E4", 1), ("G4", 2)], [("C4", 4)]]))
    assert piece.refusal is None and piece.melody_voice == "1"


def test_upper_of_two_right_hand_voices_is_the_melody_and_the_lower_is_untouched():
    xml = score([[("E5", 1), ("G5", 1), ("F5", 2)], [("E5", 4)]], rh2=[[("C5", 4)], [("C5", 4)]])
    piece = core.analyse(xml)
    assert piece.refusal is None and piece.melody_voice == "1"


def test_two_voices_that_trade_the_top_line_are_refused():
    xml = score([[("C5", 1), ("C4", 1), ("C5", 1), ("C4", 1)], [("C5", 1), ("C4", 1), ("C5", 1), ("C4", 1)],
                 [("C4", 4)]],
                rh2=[[("E4", 4)], [("E4", 4)], [("E5", 4)]])
    piece = core.analyse(xml)
    assert piece.refusal is not None and "top line" in piece.refusal
    res = core.embellish(xml, "playful")
    assert res.refusal == piece.refusal and res.inserted == [] and res.xml == xml


def test_a_chordal_right_hand_is_refused():
    chord = ("C4", "E4", "G4")
    xml = score([[(chord, 1), (chord, 1), (chord, 1), ("E4", 1)], [(chord, 4)]])
    piece = core.analyse(xml)
    assert piece.refusal is not None and "chord" in piece.refusal


def test_a_single_staff_score_is_refused():
    xml = score([[("C4", 1), ("E4", 1), ("G4", 2)]], staves=1)
    assert "staff" in core.analyse(xml).refusal


def test_a_melody_with_a_few_chords_is_kept_and_the_chords_are_left_alone():
    xml = score([[("C4", 1), ("E4", 1), (("C4", "G4"), 1), ("E4", 1)], [("C4", 1), ("E4", 1), ("G4", 2)],
                 [("C4", 4)]])
    piece = core.analyse(xml)
    assert piece.refusal is None
    res = core.embellish(xml, "playful")
    assert all(i["onset"] != 2 for i in res.inserted)
