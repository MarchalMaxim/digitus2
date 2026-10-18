"""One test (or a few) per embellishment rule, on tiny fixtures, plus the guards every rule shares."""
from __future__ import annotations

from fractions import Fraction as F

import pytest

from embellish import core
from embellish.check import read_notes, verify
from embellish.tests.fixtures import score

C, E, G = 60, 64, 67


def rh(xml: str, voice: str = "1") -> list[tuple[F, int, F]]:
    return [(n.onset, n.pitch, n.dur) for n in read_notes(xml)
            if n.staff == "1" and n.voice == voice and n.pitch is not None and not n.grace]


def lh(xml: str) -> list[tuple[F, int, F]]:
    return [(n.onset, n.pitch, n.dur) for n in read_notes(xml) if n.staff == "2"]


def rules(res) -> list[str]:
    return [i["rule"] for i in res.inserted]


# ---- passing note -----------------------------------------------------------------------------

def test_passing_note_fills_a_third_on_the_weak_half_of_the_first_note():
    xml = score([[("C4", 1), ("E4", 1), ("D4", 1), ("C4", 1)], [("C4", 4)]])
    res = core.embellish(xml, "light")
    assert res.refusal is None
    assert rules(res) == ["passing"]
    assert rh(res.xml)[:3] == [(F(0), C, F(1, 2)), (F(1, 2), 62, F(1, 2)), (F(1), E, F(1))]
    ins = res.inserted[0]
    assert (ins["bar"], ins["beat"], ins["pitch"], ins["midi"]) == ("1", "1.5", "D4", 62)


def test_passing_note_descending_third():
    xml = score([[("G4", 1), ("E4", 1), ("D4", 2)], [("C4", 4)]])
    res = core.embellish(xml, "light")
    assert [p for _, p, _ in rh(res.xml)][:3] == [G, 65, E]


def test_no_passing_note_across_a_fourth_or_a_step():
    xml = score([[("C4", 1), ("F4", 1), ("G4", 2)], [("C4", 4)]])
    res = core.embellish(xml, "light")
    assert "passing" not in rules(res)


def test_passing_note_needs_both_ends_in_the_key():
    # C to Eb in C major: a third, but Eb is outside the key
    xml = score([[("C4", 1), ("Eb4", 1), ("D4", 2)], [("C4", 4)]])
    res = core.embellish(xml, "light")
    assert "passing" not in rules(res)


def test_passing_note_spelled_from_the_key_signature():
    # G major: E4 -> G4 is filled with F#4
    xml = score([[("E4", 1), ("G4", 1), ("A4", 2)], [("G4", 4)]], lh=[[("G2", 4)], [("G2", 4)]], fifths=1)
    res = core.embellish(xml, "light")
    assert rh(res.xml)[1][1] == 66
    assert res.inserted[0]["pitch"] == "F#4"
    assert "<alter>1</alter>" in res.xml


def test_passing_note_on_a_half_note_lands_on_the_weak_second_beat():
    xml = score([[("C4", 2), ("E4", 2)], [("C4", 4)]])
    res = core.embellish(xml, "light")
    assert rh(res.xml)[:2] == [(F(0), C, F(1)), (F(1), 62, F(1))]


def test_never_on_a_strong_beat():
    # a dotted half from beat 1 would put the passing note on beat 3 of 4/4: refused
    xml = score([[("C4", 3), ("E4", 1)], [("F4", 4)]])
    res = core.embellish(xml, "playful")
    assert res.inserted
    assert all(F(i["onset"]) % 4 not in (0, 2) for i in res.inserted)  # 4/4: downbeat and half bar
    assert "passing" not in rules(res)


def test_a_new_note_never_sounds_through_a_strong_position():
    # the syncopated half note C4 (beats 1.5 to 3.5) -> E4 is a third, but its weak end (beats 2.5 to 3.5)
    # would hold the passing D4 across beat 3; its long-note neighbour would return on beat 3: both refused
    xml = score([[("G4", F(1, 2)), ("C4", 2), ("E4", 1), ("D4", F(1, 2))], [("C4", 4)]])
    res = core.embellish(xml, "playful")
    for i in res.inserted:
        start, end = F(i["onset"]), F(i["onset"]) + F(i["length"])
        assert not any(start < s < end for s in (F(2), F(4)))
    assert "passing" not in rules(res) and "neighbour-long" not in rules(res)
    assert res.skipped["strong beat"] >= 1


def test_minor_key_uses_the_key_signature_scale():
    # A minor (no sharps or flats): A -> C is filled with B; E -> G# (the raised leading tone) is not filled
    xml = score([[("A4", 1), ("C5", 1), ("E4", 1), ("G#4", 1)], [("A4", 4)]],
                lh=[[("A2", 4)], [("A2", 4)]], mode="minor")
    res = core.embellish(xml, "playful")
    assert [i["pitch"] for i in res.inserted if i["rule"] == "passing"] == ["B4"]
    assert all(i["midi"] % 12 != 7 for i in res.inserted)  # no G natural next to the G#


def test_a_key_change_inside_a_bar_is_followed():
    # the key changes to G major at beat 3 of bar 1: E4 -> G4 there is filled with F#4, not F4
    xml = score([[("C4", 1), ("D4", 1), ("E4", 1), ("G4", 1)], [("A4", 4)]], lh=[[("r", 4)], [("D3", 4)]])
    at = xml.index("<note>", xml.index("<note>", xml.index("<note>") + 1) + 1)  # before the third note
    xml = xml[:at] + "<attributes><key><fifths>1</fifths></key></attributes>" + xml[at:]
    res = core.embellish(xml, "light")
    assert [(i["pitch"], i["midi"]) for i in res.inserted] == [("F#4", 66)]


def test_a_time_change_inside_a_bar_leaves_that_bar_alone():
    xml = score([[("C4", 1), ("E4", 1), ("C4", 1), ("E4", 1)], [("C4", 1), ("E4", 1), ("G4", 2)], [("C4", 4)]])
    at = xml.index("<note>", xml.index("<note>", xml.index("<note>") + 1) + 1)
    xml = xml[:at] + "<attributes><time><beats>2</beats><beat-type>4</beat-type></time></attributes>" + xml[at:]
    res = core.embellish(xml, "playful")
    assert all(F(i["onset"]) >= 4 for i in res.inserted)
    assert res.skipped["time change inside the bar"] >= 1


def test_serialisation_keeps_doctype_comments_and_processing_instructions():
    xml = score([[("C4", 1), ("E4", 1), ("D4", 2)], [("C4", 4)]])
    xml = xml.replace('<part id="P1">', '<part id="P1"><!-- a comment --><?app keep="yes"?>', 1)
    res = core.embellish(xml, "light")
    assert res.inserted
    assert res.xml.startswith(xml[:xml.index("<score-partwise")])
    assert "<!DOCTYPE score-partwise" in res.xml
    assert "<!-- a comment -->" in res.xml and '<?app keep="yes"?>' in res.xml


def test_divisions_scale_up_covers_attack_and_release():
    xml = score([[("C4", 1), ("E4", 1), ("D4", 2)], [("C4", 4)]], lh=[[("C3", 4)], [("C3", 4)]], divisions=1)
    xml = xml.replace("<note><pitch><step>C</step><octave>3</octave>", '<note attack="1" release="-1">'
                      "<pitch><step>C</step><octave>3</octave>", 1)
    res = core.embellish(xml, "light")
    assert '<note attack="2" release="-2">' in res.xml


def test_compound_meter_dotted_quarter_splits_into_quarter_and_eighth():
    xml = score([[("C4", F(3, 2)), ("E4", F(3, 2))], [("C4", 3)]], lh=[[("C3", 3)], [("C3", 3)]], time=(6, 8))
    res = core.embellish(xml, "light")
    assert rh(res.xml)[:2] == [(F(0), C, F(1)), (F(1), 62, F(1, 2))]


# ---- neighbour notes --------------------------------------------------------------------------

def test_neighbour_on_a_repeated_note_is_the_upper_step_and_returns():
    xml = score([[("E4", 1), ("E4", 1), ("D4", 2)], [("C4", 4)]])
    res = core.embellish(xml, "light")
    assert rules(res) == ["neighbour-repeated"]
    assert [p for _, p, _ in rh(res.xml)][:3] == [E, 65, E]


def test_neighbour_on_a_long_note_returns_to_it_in_playful_only():
    xml = score([[("G4", 2), ("A4", 1), ("G4", 1)], [("G4", 4)]])
    assert "neighbour-long" not in rules(core.embellish(xml, "light"))
    res = core.embellish(xml, "playful")
    assert rules(res)[:2] == ["neighbour-long", "neighbour-long"]
    assert [r["role"] for r in res.inserted[:2]] == ["neighbour", "return"]
    assert rh(res.xml)[:3] == [(F(0), G, F(1)), (F(1), 69, F(1, 2)), (F(3, 2), G, F(1, 2))]


# ---- anticipation -----------------------------------------------------------------------------

def test_anticipation_sounds_the_downbeat_note_on_the_last_eighth():
    xml = score([[("C4", 2), ("D4", 1), ("E4", 1)], [("A4", 4)]])
    res = core.embellish(xml, "playful")
    assert "anticipation" in rules(res)
    notes = rh(res.xml)
    assert (F(7, 2), 69, F(1, 2)) in notes and (F(4), 69, F(4)) in notes
    assert "anticipation" not in rules(core.embellish(xml, "light"))


def test_no_anticipation_from_a_long_note_so_a_phrase_end_keeps_its_breath():
    xml = score([[("C4", 2), ("D4", 2)], [("G4", 4)]])
    assert "anticipation" not in rules(core.embellish(xml, "playful"))


# ---- shared guards ----------------------------------------------------------------------------

def test_left_hand_is_untouched_and_the_checker_agrees():
    xml = score([[("C4", 1), ("E4", 1), ("E4", 1), ("C4", 1)], [("D4", 2), ("F4", 2)], [("C4", 4)]],
                lh=[[("C3", 2), ("G3", 2)], [("G2", 4)], [("C3", 4)]])
    for density in ("light", "playful"):
        res = core.embellish(xml, density)
        assert lh(res.xml) == lh(xml)
        rep = verify(xml, res.xml, res.inserted)
        assert rep.ok, rep.problems
        assert rep.strong_kept == rep.strong_total > 0


def test_checker_catches_a_moved_left_hand_note_and_a_displaced_strong_beat():
    xml = score([[("C4", 1), ("E4", 1), ("D4", 1), ("C4", 1)], [("C4", 4)]])
    res = core.embellish(xml, "light")
    broken = res.xml.replace("<step>C</step><octave>3</octave>", "<step>D</step><octave>3</octave>", 1)
    assert not verify(xml, broken, res.inserted).ok
    bad = score([[("D4", 1), ("E4", 1), ("D4", 1), ("C4", 1)], [("C4", 4)]])
    rep = verify(xml, bad, [])
    assert not rep.ok and rep.strong_kept < rep.strong_total


def test_skips_a_pitch_class_next_to_an_accidental_in_the_bar():
    # C major, the left hand plays F#3 in the bar: an F natural would clash
    xml = score([[("E4", 1), ("G4", 1), ("A4", 2)], [("C4", 4)]], lh=[[("D3", 2), ("F#3", 2)], [("C3", 4)]])
    res = core.embellish(xml, "playful")
    assert all(i["midi"] % 12 != 5 for i in res.inserted)
    assert res.skipped["accidental nearby"] >= 1


def test_tied_tuplet_fermata_and_last_notes_are_not_embellished():
    xml = score([[("C4", 1, {"tie": "start"}), ("C4", 1, {"tie": "stop"}), ("E4", 1, {"fermata": True}), ("G4", 1)],
                 [("E4", F(1, 3), {"tuplet": True}), ("F4", F(1, 3), {"tuplet": True}),
                  ("G4", F(1, 3), {"tuplet": True}), ("E4", 1), ("C4", 2)], [("C4", 4)]])
    res = core.embellish(xml, "playful")
    onsets = {i["onset"] for i in res.inserted}
    assert all(not (F(0) <= o < F(3)) for o in onsets)  # tie, fermata
    assert all(not (F(4) <= o < F(5)) for o in onsets)  # tuplet
    assert all(o < F(8) for o in onsets)               # last bar


def test_inserted_note_stays_above_every_other_sounding_note():
    # a lower right-hand voice holds A3 and the left hand holds D4 under the first half bar:
    # the passing D4 (C4 -> E4) would double the left hand's D4: refused; the passing F4 is above both
    xml = score([[("C4", 1), ("E4", 1), ("G4", 2)], [("C4", 4)]],
                lh=[[("D4", 2), ("C3", 2)], [("C3", 4)]], rh2=[[("A3", 4)], [("r", 4)]])
    res = core.embellish(xml, "light")
    assert [i["pitch"] for i in res.inserted] == ["F4"]
    assert res.skipped["not the top line"] >= 1
    assert rh(res.xml, "2") == rh(xml, "2")


def test_pickup_bar_counts_beats_from_the_end():
    # 3/4 with a one-beat pickup: the pickup's quarter is beat 3; a passing note on its weak half is fine,
    # and the next bar's first note is a downbeat that the checker protects
    xml = score([[("C4", 1)], [("E4", 2), ("D4", 1)], [("C4", 3)]], lh=[[("r", 1)], [("C3", 3)], [("C3", 3)]],
                time=(3, 4), pickup=True)
    res = core.embellish(xml, "light")
    assert res.inserted and res.inserted[0]["bar"] == "0" and res.inserted[0]["beat"] == "3.5"
    rep = verify(xml, res.xml, res.inserted)
    assert rep.ok, rep.problems


def test_coarse_divisions_are_scaled_up_without_changing_any_note():
    # divisions 1 cannot write an eighth: every duration of the piece is doubled, and nothing sounds different
    xml = score([[("C4", 1), ("E4", 1), ("D4", 2)], [("C4", 4)]], lh=[[("C3", 2), ("G3", 2)], [("C3", 4)]],
                divisions=1)
    res = core.embellish(xml, "light")
    assert rules(res) == ["passing"]
    assert "<divisions>2</divisions>" in res.xml
    assert lh(res.xml) == lh(xml)
    rep = verify(xml, res.xml, res.inserted)
    assert rep.ok, rep.problems


def test_every_melody_note_gets_at_most_one_skip_reason():
    xml = score([[("C4", 1), ("D4", 1), ("E4", F(1, 2)), ("G4", F(1, 2)), ("A4", 1)], [("G4", 4)]])
    res = core.embellish(xml, "light")
    # C-D, D-E, G-A: steps; E-G a third in eighths: too short; A-G: an anticipation candidate; G: last bar
    assert res.skipped == {"no rule fits": 3, "too short or odd length": 1, "last bar": 1}


# ---- density ----------------------------------------------------------------------------------

def test_density_none_returns_the_plain_bytes():
    xml = score([[("C4", 1), ("E4", 1), ("E4", 1), ("C4", 1)], [("C4", 4)]])
    res = core.embellish(xml, "none")
    assert res.xml == xml and res.inserted == []


def test_light_adds_at_most_one_figure_per_bar_and_playful_at_most_two():
    bar = [("C4", 1), ("E4", 1), ("E4", 1), ("C4", 1)]
    xml = score([bar, bar, bar, [("C4", 4)]])
    light = core.embellish(xml, "light")
    play = core.embellish(xml, "playful")
    per_bar = lambda res: {b: sum(1 for i in res.inserted if i["bar"] == b and i["role"] != "return")
                           for b in {i["bar"] for i in res.inserted}}
    assert max(per_bar(light).values()) == 1
    assert max(per_bar(play).values()) == 2
    light_bars = sorted(int(b) for b in per_bar(light))
    assert light_bars == [1, 3]  # never two neighbouring bars
    assert set(rules(light)) <= {"passing", "neighbour-repeated"}


def test_deterministic():
    bar = [("C4", 1), ("E4", 1), ("E4", 1), ("C4", 1)]
    xml = score([bar, bar, [("C4", 4)]])
    assert core.embellish(xml, "playful").xml == core.embellish(xml, "playful").xml


def test_unknown_density_is_an_error():
    with pytest.raises(ValueError):
        core.embellish(score([[("C4", 4)]]), "lots")
