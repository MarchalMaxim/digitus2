import pytest

from readability import player_model as PM
from readability import textbook as TB
from readability.corpus import LH, RH, NoteRec


def mk(pitches, printed, hand=RH):
    """printed: {position: finger}; other notes unprinted."""
    return [NoteRec(idx=i, onset=i * 0.25, offset=i * 0.25 + 0.25, pitch=p, hand=hand,
                    finger=printed.get(i, 0)) for i, p in enumerate(pitches)]


@pytest.fixture(scope="module")
def tb():
    return TB.default_index()


def run(notes, tb, model="rules_plus_textbook"):
    visible = {n.idx for n in notes if n.finger > 0}
    res = PM.infer_hand(notes, visible, model=model, textbook=tb)
    return [res[n.idx][0] for n in notes], [res[n.idx][1] for n in notes]


def test_index_loads_all_entries(tb):
    assert len({p.id.rsplit("#", 1)[0] for p in tb.patterns}) == 672


def test_c_major_rh_scale_completed_from_textbook(tb):
    notes = mk([60, 62, 64, 65, 67, 69, 71, 72], {0: 1})
    f, r = run(notes, tb)
    assert f == [1, 2, 3, 1, 2, 3, 4, 5]
    assert r == ["R0"] + ["textbook"] * 7
    # the plain rule reader cannot cross the thumb
    f_rules, _ = run(notes, tb, model="rules")
    assert f_rules == [1, 2, 3, 4, 5, None, None, None]


def test_octave_transposed_window_matches(tb):
    notes = mk([74, 76, 77, 79, 81], {0: 2})          # D5 E5 F5 G5 A5, inside C major one octave up
    f, r = run(notes, tb)
    assert f == [2, 3, 1, 2, 3]
    assert r[1:] == ["textbook"] * 4


def test_left_hand_descending(tb):
    notes = mk([60, 59, 57, 55, 53, 52, 50, 48], {0: 1}, hand=LH)
    f, _ = run(notes, tb)
    assert f == [1, 2, 3, 1, 2, 3, 4, 5]


def test_disagreeing_visible_digit_blocks_the_pattern(tb):
    notes = mk([60, 62, 64, 65, 67, 69, 71, 72], {0: 1, 3: 5})
    _, r = run(notes, tb)
    assert "textbook" not in r


def test_short_runs_do_not_match(tb):
    notes = mk([60, 62, 64], {0: 1})
    _, r = run(notes, tb)
    assert "textbook" not in r
