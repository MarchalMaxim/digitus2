"""Tests for the LilyPond -> notes+fingering interpreter used for the Mutopia corpus."""
from fractions import Fraction
from pathlib import Path

import pytest

from fingering_eval import lilypond as L
from fingering_eval import mutopia as MU


def events(src: str, tmp_path: Path, name: str = "t.ly"):
    f = tmp_path / name
    f.write_text(src, encoding="utf-8")
    toks = L.tokenize_file(f)
    p = L.Parser(toks)
    p.parse_file()
    music = p.scores[0].music if p.scores else L.SimN(p.toplevel_music)
    L.Relativizer(p.version).resolve(music, None)
    ev = L.Evaluator()
    ev.run(music)
    return sorted(ev.events, key=lambda e: (e.onset, e.grace_order, e.pitch)), ev, p


def pitches(evs):
    return [e.pitch for e in evs]


def test_relative_octaves(tmp_path):
    evs, _, _ = events(r"\relative c'' { c4 e g c, f b, g' }", tmp_path)
    # c''=72 e''=76 g''=79 c''=72 f''=77 b'=71 g''=79
    assert pitches(evs) == [72, 76, 79, 72, 77, 71, 79]


def test_relative_without_start_pitch_218(tmp_path):
    evs, _, _ = events('\\version "2.18.2"\n\\relative { c\'\' d }', tmp_path)
    assert pitches(evs) == [72, 74]


def test_absolute_and_fixed(tmp_path):
    evs, _, _ = events(r"{ c d' e,, \fixed c' { c e g } }", tmp_path)
    assert pitches(evs) == [48, 62, 28, 60, 64, 67]


def test_chords_relative_and_q(tmp_path):
    evs, _, _ = events(r"\relative c' { <c e g>4 q <a c e> }", tmp_path)
    assert pitches(evs) == [60, 64, 67, 60, 64, 67, 57, 60, 64]
    assert [float(e.onset) for e in evs][::3] == [0.0, 0.25, 0.5]


def test_durations_dots_scaling_tuplets(tmp_path):
    evs, _, _ = events(r"{ c'4. d'8 \times 2/3 { e'8 f' g' } \tuplet 3/2 { a'4 b' c'' } R1*2 d''2 }", tmp_path)
    on = [e.onset for e in evs]
    assert on[:5] == [0, Fraction(3, 8), Fraction(1, 2), Fraction(1, 2) + Fraction(1, 12), Fraction(1, 2) + Fraction(2, 12)]
    assert on[5:8] == [Fraction(3, 4), Fraction(3, 4) + Fraction(1, 6), Fraction(3, 4) + Fraction(2, 6)]
    assert on[8] == Fraction(3, 4) + Fraction(1, 2) + 2  # after two whole-bar rests


def test_default_duration_carries_in_input_order(tmp_path):
    src = "a = { c'8 }\nb = { d' e' }\n\\score { { \\b } \\layout {} }"
    evs, _, _ = events(src, tmp_path)
    assert [e.offset - e.onset for e in evs] == [Fraction(1, 8)] * 2


def test_ties_are_merged(tmp_path):
    evs, _, _ = events(r"{ c'2~ c'8 d' <e' g'>2~ <e' g'>4 }", tmp_path)
    assert pitches(evs) == [60, 62, 64, 67]
    assert evs[0].offset == Fraction(5, 8)
    assert evs[2].offset - evs[2].onset == Fraction(3, 4)


def test_grace_notes_come_first_and_take_no_time(tmp_path):
    evs, _, _ = events(r"{ c'4 \grace { d'16 e' } f'4 g' }", tmp_path)
    assert pitches(evs) == [60, 62, 64, 65, 67]
    assert evs[1].grace and evs[2].grace and evs[1].grace_order < evs[2].grace_order < 0
    assert evs[3].onset == Fraction(1, 4) and evs[4].onset == Fraction(1, 2)


def test_repeats_written_order_and_unfold(tmp_path):
    evs, _, _ = events(r"{ \repeat volta 2 { c'4 } \alternative { { d'4 } { e'4 } } \repeat unfold 3 { f'8 } }",
                       tmp_path)
    assert pitches(evs) == [60, 62, 64, 65, 65, 65]
    # tremolo: written form (each note once, durations stretched by the count), as engraved
    evs2, _, _ = events(r"""{ \repeat "tremolo" 2 { c'16 e'16 } g'4 }""", tmp_path)
    assert pitches(evs2) == [60, 64, 67]
    assert [e.onset for e in evs2] == [0, Fraction(1, 8), Fraction(1, 4)]
    # percent: printed once, the repeated bars take time
    evs3, _, _ = events(r"""{ \repeat percent 3 { c'4 } d'4 }""", tmp_path)
    assert pitches(evs3) == [60, 62] and evs3[1].onset == Fraction(3, 4)


def test_fingering_forms(tmp_path):
    src = r"""\relative c' { c4-1 d^2 e_3 <f-1 a-3 c-5>2 <c e g>-1-3-5 g'-\finger "4-1" a-\markup { \finger "2" } b4-. c-> }"""
    evs, _, _ = events(src, tmp_path)
    fing = {e.pitch: e.fingers for e in evs if e.fingers}
    assert fing[60] == ["1"] or fing[60] == []  # first c (the later chord c has post fingers only)
    assert [e.fingers for e in evs[:3]] == [["1"], ["2"], ["3"]]
    assert [e.fingers for e in evs[3:6]] == [["1"], ["3"], ["5"]]
    chord = evs[6:9]
    assert all(e.chord_post_fingers == ["1", "3", "5"] for e in chord)
    assert evs[9].fingers == ["4-1"] and evs[10].fingers == ["2"]
    assert evs[11].fingers == [] and evs[12].fingers == []


def test_normalize_finger_text():
    assert MU.normalize_finger_text("3") == "3"
    assert MU.normalize_finger_text("(2)") == "2"
    assert MU.normalize_finger_text("4-1") == "4_1"
    assert MU.normalize_finger_text("4 - 1") == "4_1"
    assert MU.normalize_finger_text("6") is None
    assert MU.normalize_finger_text("1/2") is None


def test_cross_staff_and_parts(tmp_path):
    src = r"""
upper = \relative c'' { c4-1 d e \change Staff = "lower" g,,-2 }
lower = \relative c { \clef bass c4-5 d e f }
\score { \new PianoStaff << \new Staff = "upper" \upper \new Staff = "lower" \lower >> \layout {} }
"""
    f = tmp_path / "x.ly"
    f.write_text(src, encoding="utf-8")
    conv = MU.convert_file(f)
    assert conv.error is None and len(conv.parts) == 1
    notes = conv.parts[0].notes
    rh = [(n.pitch, n.finger) for n in notes if n.channel == 0]
    lh = [(n.pitch, n.finger) for n in notes if n.channel == 1]
    assert rh == [(72, "1"), (74, "0"), (76, "0")]
    # the cross-staff g, (played by the LH) gets a negative finger
    assert (55, "-2") in lh and (48, "-5") in lh


def test_chord_post_fingering_order_by_hand(tmp_path):
    src = r"""
\score { \new PianoStaff <<
  \new Staff { <c' e' g'>4-1-3-5 <c' e' g'>4-5-3-1 }
  \new Staff { \clef bass <c e g>4-5-3-1 <c e g>4-1-3-5 }
>> \layout {} }
"""
    f = tmp_path / "y.ly"
    f.write_text(src, encoding="utf-8")
    part = MU.convert_file(f).parts[0]
    rh = [n.finger for n in part.notes if n.channel == 0]
    lh = [n.finger for n in part.notes if n.channel == 1]
    # RH: bottom-up input and top-down input both map to c=1 e=3 g=5
    assert rh == ["1", "3", "5", "1", "3", "5"]
    # LH: c=5 e=3 g=1 whatever the order of input
    assert lh == ["-5", "-3", "-1", "-5", "-3", "-1"]


def test_midi_only_scores_skipped_and_variables_with_change(tmp_path):
    src = r"""
staffDown = \change Staff = "lower"
m = \relative c'' { c4-1 \staffDown c,,-1 }
\score { \new PianoStaff << \new Staff = "upper" \m \new Staff = "lower" { s2 } >> \layout {} }
\score { \new PianoStaff << \new Staff \m >> \midi {} }
"""
    f = tmp_path / "z.ly"
    f.write_text(src, encoding="utf-8")
    conv = MU.convert_file(f)
    assert conv.diagnostics["n_layout_scores"] == 1
    notes = conv.parts[0].notes
    assert [(n.pitch, n.channel, n.finger) for n in notes] == [(72, 0, "1"), (48, 1, "-1")]


def test_bar_check_grid_with_anacrusis(tmp_path):
    src = r"""\score { \new PianoStaff << \new Staff { \time 3/4 \partial 4 c'4 | d'2. | e'2. | } \new Staff { r4 | r2. | r2. | } >> \layout {} }"""
    f = tmp_path / "b.ly"
    f.write_text(src, encoding="utf-8")
    d = MU.convert_file(f).parts[0].diagnostics
    assert d["bar_checks"] == 6 and d["bar_check_failures"] == 0
    src_bad = src.replace("d'2.", "d'2")
    f.write_text(src_bad, encoding="utf-8")
    d = MU.convert_file(f).parts[0].diagnostics
    assert d["bar_check_failures"] >= 1


@pytest.mark.parametrize("lang,music,expected", [
    ("english", "{ cs'4 ef' }", [61, 63]),
    ("deutsch", "{ h4 b }", [59, 58]),
    ("italiano", "{ do'4 sib }", [60, 58]),
])
def test_languages(tmp_path, lang, music, expected):
    evs, _, _ = events(chr(92) + f'language "{lang}" ' + music, tmp_path)
    assert pitches(evs) == expected


def test_transpose(tmp_path):
    evs, _, _ = events(r"\transpose c d { c'4 e' }", tmp_path)
    assert pitches(evs) == [62, 66]
