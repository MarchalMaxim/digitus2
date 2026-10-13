import pytest

from fingering_eval.pig_io import (Note, make_note, midi_to_spelled, parse_finger, parse_pig_lines, pig_ids,
                                   read_pig, spelled_to_midi, write_pig)


@pytest.mark.parametrize("sp,midi", [
    ("C4", 60), ("A4", 69), ("A0", 21), ("C8", 108), ("C#4", 61), ("Db4", 61), ("Bb5", 82),
    ("Cb4", 59), ("B#3", 60), ("C##5", 74), ("Ebb3", 50), ("F+4", 66), ("G-4", 66), ("c4", 60),
])
def test_spelled_to_midi(sp, midi):
    assert spelled_to_midi(sp) == midi


def test_spelled_roundtrip_pig_convention():
    for p in range(21, 109):
        assert spelled_to_midi(midi_to_spelled(p)) == p
    assert midi_to_spelled(70) == "Bb4" and midi_to_spelled(63) == "Eb4" and midi_to_spelled(66) == "F#4"


@pytest.mark.parametrize("bad", ["H4", "C", "4", "C#", ""])
def test_spelled_malformed(bad):
    with pytest.raises(ValueError):
        spelled_to_midi(bad)


def test_parse_finger_simple_and_substitution():
    f = parse_finger("3")
    assert f.fingers == (3,) and f.press == 3 and f.hand == 1 and not f.is_substitution and not f.irregular
    f = parse_finger("-5")
    assert f.press == -5 and f.hand == -1
    f = parse_finger("3_1")
    assert f.fingers == (3, 1) and f.press == 3 and f.release == 1 and f.is_substitution and not f.irregular
    f = parse_finger("-2_-1")
    assert f.fingers == (-2, -1) and f.hand == -1 and not f.irregular


@pytest.mark.parametrize("raw,flag", [
    ("4_", "empty substitution part"),
    ("-2_1", "substitution changes hand sign"),
    ("2_4_5", "chained substitution (more than two fingers)"),
    ("6", "finger out of range: 6"),
    ("0", "finger out of range: 0"),
    ("3_3", "substitution by the same finger"),
])
def test_parse_finger_irregular(raw, flag):
    assert flag in parse_finger(raw).irregular


def test_parse_finger_garbage():
    with pytest.raises(ValueError):
        parse_finger("a")
    with pytest.raises(ValueError):
        parse_finger("_")


SAMPLE = """//Version: PianoFingering_v170101
0\t0.156289\t0.302811\tC4\t64\t80\t0\t1
1\t0.312579\t0.4591\tD4\t64\t80\t0\t2
2\t1.25032\t1.54397\tG4\t64\t80\t0\t4_1
3\t1.40661\t1.55313\tC3\t64\t80\t1\t-5
"""


def test_parse_and_note_properties(tmp_path):
    f = parse_pig_lines(SAMPLE.splitlines())
    assert len(f) == 4 and f.header == ["//Version: PianoFingering_v170101"]
    n = f.notes[2]
    assert n.pitch == 67 and n.press_finger == 4 and n.finger_number == 4 and n.hand == "R"
    assert f.notes[3].hand == "L" and f.notes[3].press_finger == -5 and f.notes[3].line_no == 5
    assert f.press_fingers() == [1, 2, 4, -5]


def test_roundtrip(tmp_path):
    f = parse_pig_lines(SAMPLE.splitlines())
    out = tmp_path / "007-3_fingering.txt"
    write_pig(out, f.notes, f.header)
    g = read_pig(out)
    assert [(n.id, n.spelled_pitch, n.channel, n.finger) for n in g.notes] == \
           [(n.id, n.spelled_pitch, n.channel, n.finger) for n in f.notes]
    assert all(abs(a.onset - b.onset) < 1e-6 and abs(a.offset - b.offset) < 1e-6 for a, b in zip(f.notes, g.notes))
    assert g.piece_id == "007" and g.annotation_id == "3"


def test_strict_parsing():
    with pytest.raises(ValueError):
        parse_pig_lines(["0\t0.1\t0.2\tC4\t64\t80\t0"])
    assert len(parse_pig_lines(["0\t0.1\t0.2\tC4\t64\t80\t0", "1 0.1 0.2 D4 64 80 0 2"], strict=False)) == 1


def test_pig_ids():
    assert pig_ids("x/001-5_fingering.txt") == ("001", "5")
    assert pig_ids("BachJS-BWV772-0_fingering.txt") == ("BachJS-BWV772", "0")
    assert pig_ids("foo.txt") == ("foo", None)


def test_make_note():
    n = make_note(3, 1.0, 1.5, 61, 1, -2)
    assert isinstance(n, Note) and n.spelled_pitch == "C#4" and n.finger == "-2" and n.pitch == 61
