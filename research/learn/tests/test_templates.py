"""detectRuns / matchTemplates port (expectations from packages/engine/src/fingering/templates.test.ts)."""
from pathlib import Path

import pytest

from learn.sequence import InputNote, build_hand_sequence
from learn.templates import TEXTBOOK_DIR, detect_runs, match_templates, template_fingers, textbook_templates

NAMES = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def midi(name: str) -> int:
    return 12 * (int(name[-1]) + 1) + NAMES[name[:-1]]


def melody(names, hand="R", dur=0.5):
    return [InputNote(str(i), i * dur, (i + 1) * dur, midi(n), hand) for i, n in enumerate(names)]


def test_detect_runs():
    seq = build_hand_sequence(melody(["C4", "D4", "E4", "F4", "G4", "E4", "C4", "A3", "C4", "C#4", "D4", "D#4", "E4"]), "R")
    runs = detect_runs(seq)
    assert [(r.kind, r.start, r.end, r.direction) for r in runs] == [
        ("scale", 0, 4, 1), ("arpeggio", 4, 7, -1), ("chromatic", 8, 12, 1),
    ]


def test_runs_ignore_chords_and_short_fragments():
    notes = melody(["C4", "D4", "E4"]) + [InputNote("3", 1.5, 2.0, 65, "R"), InputNote("4", 1.5, 2.0, 69, "R")]
    seq = build_hand_sequence(notes, "R")
    assert detect_runs(seq) == []


@pytest.mark.skipif(not TEXTBOOK_DIR.exists(), reason="textbook oracle missing")
def test_c_major_scale_gets_the_textbook_fingers_in_both_hands():
    names = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"]
    seq = build_hand_sequence(melody(names), "R")
    assert template_fingers(seq, "R") == [1, 2, 3, 1, 2, 3, 4, 5]
    low = ["C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4"]
    seq_l = build_hand_sequence(melody(low, "L"), "L")
    assert template_fingers(seq_l, "L") == [5, 4, 3, 2, 1, 3, 2, 1]
    # an octave shift of the entry still matches
    seq_hi = build_hand_sequence(melody([n[:-1] + str(int(n[-1]) + 1) for n in names]), "R")
    assert template_fingers(seq_hi, "R") == [1, 2, 3, 1, 2, 3, 4, 5]
    assert len(textbook_templates()["R"]) > 100
