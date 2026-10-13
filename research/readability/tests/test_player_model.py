import random

import pytest

from readability import player_model as PM
from readability.corpus import LH, RH, NoteRec, Part


def mk(seq, hand=RH, start_idx=0):
    """seq: list of (pitch or tuple of pitches, finger or tuple of fingers). Finger = editor's digit."""
    notes, idx = [], start_idx
    for t, (p, f) in enumerate(seq):
        ps = p if isinstance(p, tuple) else (p,)
        fs = f if isinstance(f, tuple) else (f,) * len(ps)
        for pp, ff in zip(ps, fs):
            notes.append(NoteRec(idx=idx, onset=t * 0.5, offset=t * 0.5 + 0.5, pitch=pp, hand=hand, finger=ff))
            idx += 1
    return notes


def fingers(notes, res):
    return [res[n.idx][0] for n in notes]


def rules(notes, res):
    return [res[n.idx][1] for n in notes]


# --------------------------------------------------------------------------------------
def test_steps_rounds_half_away_from_zero():
    assert [PM.steps(60, 60 + d) for d in range(0, 9)] == [0, 1, 1, 2, 2, 3, 3, 4, 4]
    assert [PM.steps(60, 60 - d) for d in range(0, 5)] == [0, -1, -1, -2, -2]


def test_column_steps_differs_from_steps_on_white_tritone_and_minor_sixth():
    assert PM.steps(59, 65) == 3 and PM.column_steps(59, 65) == 4      # B-F
    assert PM.steps(64, 72) == 4 and PM.column_steps(64, 72) == 5      # E-C
    assert PM.steps(60, 67) == PM.column_steps(60, 67) == 4             # C-G


def test_c_position_stepwise_from_first_digit():
    notes = mk([(60, 1), (62, 2), (64, 3), (65, 4), (67, 5)])
    res = PM.infer_hand(notes, {0})
    assert fingers(notes, res) == [1, 2, 3, 4, 5]
    assert rules(notes, res) == ["R0", "R2", "R2", "R2", "R2"]


def test_skip_within_position_uses_r3():
    notes = mk([(60, 1), (64, 3), (67, 5)])
    res = PM.infer_hand(notes, {0})
    assert fingers(notes, res) == [1, 3, 5]
    assert rules(notes, res) == ["R0", "R3", "R3"]


def test_repeated_notes_r1():
    notes = mk([(64, 3), (64, 3), (65, 4), (65, 4)])
    res = PM.infer_hand(notes, {0})
    assert fingers(notes, res) == [3, 3, 4, 4]
    assert rules(notes, res) == ["R0", "R1", "R2", "R1"]


def test_stepwise_beyond_position_not_inferable():
    notes = mk([(60, 1), (62, 2), (64, 3), (65, 4), (67, 5), (69, 1)])
    res = PM.infer_hand(notes, {0})
    assert fingers(notes, res) == [1, 2, 3, 4, 5, None]
    assert res[5][1] == "none"


def test_left_hand_mirrors():
    notes = mk([(48, 5), (50, 4), (52, 3), (53, 2), (55, 1)], hand=LH)
    res = PM.infer_hand(notes, {0})
    assert fingers(notes, res) == [5, 4, 3, 2, 1]
    # LH skip: C3 (5) -> E3 by R3 -> 3
    notes = mk([(48, 5), (52, 3), (55, 1)], hand=LH)
    assert fingers(notes, PM.infer_hand(notes, {0})) == [5, 3, 1]


def test_black_keys():
    notes = mk([(62, 1), (64, 2), (66, 3), (67, 4), (69, 5)])        # D E F# G A
    assert fingers(notes, PM.infer_hand(notes, {0})) == [1, 2, 3, 4, 5]
    notes = mk([(60, 1), (62, 2), (63, 3), (65, 4), (67, 5)])        # C D Eb F G
    assert fingers(notes, PM.infer_hand(notes, {0})) == [1, 2, 3, 4, 5]
    notes = mk([(60, 1), (63, 3), (67, 5)])                          # C Eb G by R3
    assert fingers(notes, PM.infer_hand(notes, {0})) == [1, 3, 5]


def test_chord_fill():
    notes = mk([((60, 64, 67), (1, 3, 5))])
    res = PM.infer_hand(notes, {0})
    assert fingers(notes, res) == [1, 3, 5]
    assert rules(notes, res) == ["R0", "R4", "R4"]
    notes = mk([((48, 52, 55), (5, 3, 1))], hand=LH)
    assert fingers(notes, PM.infer_hand(notes, {0})) == [5, 3, 1]
    # visible top note of an RH chord anchors the others
    notes = mk([((60, 64, 67), (1, 3, 5))])
    assert fingers(notes, PM.infer_hand(notes, {2})) == [1, 3, 5]


def test_chord_from_ref_duplicates_and_range():
    notes = mk([(60, 1), ((62, 65), (2, 4))])
    res = PM.infer_hand(notes, {0})
    assert fingers(notes, res) == [1, 2, 4]
    assert rules(notes, res)[1:] == ["R4_ref", "R4_ref"]
    notes = mk([(60, 1), ((61, 62), (2, 3))])                      # both map to finger 2
    assert fingers(notes, PM.infer_hand(notes, {0}))[1:] == [None, None]
    notes = mk([(60, 1), ((60, 72), (1, 5))])                      # octave: top out of range
    assert fingers(notes, PM.infer_hand(notes, {0}))[1:] == [1, None]


def test_inferred_fingers_propagate_but_do_not_move_ref():
    # C(1) C# D by R2 (2, 3); the leap to F is placed from ref C (1 + 3 = 4), not from the
    # inferred D (3 + 2 = 5)
    notes = mk([(60, 1), (61, 2), (62, 3), (65, 4)])
    res = PM.infer_hand(notes, {0})
    assert fingers(notes, res) == [1, 2, 3, 4]
    assert rules(notes, res) == ["R0", "R2", "R2", "R3"]


def test_nothing_before_first_visible_digit():
    notes = mk([(60, 1), (62, 2), (64, 3)])
    res = PM.infer_hand(notes, {2})
    assert fingers(notes, res) == [None, None, 3]


def test_copy_previous_baseline():
    notes = mk([(60, 1), (62, 2), (64, 3), (65, 4), (67, 5)])
    res = PM.infer_hand(notes, {0, 2}, model="copy_previous")
    assert fingers(notes, res) == [1, 1, 3, 3, 3]
    assert rules(notes, res) == ["R0", "copy", "R0", "copy", "copy"]
    assert fingers(notes, PM.infer_hand(notes, {2}, model="copy_previous")) == [None, None, 3, 3, 3]


def _random_hand(rng, hand, n_events=60):
    seq, p = [], 60 if hand == RH else 48
    for _ in range(n_events):
        p = max(36, min(90, p + rng.choice([-7, -4, -2, -1, 0, 1, 2, 3, 5, 12])))
        if rng.random() < 0.25:
            ps = tuple(sorted({p, p + rng.choice([3, 4, 7]), p + rng.choice([7, 9, 12])}))
        else:
            ps = (p,)
        fs = tuple(rng.choice([0, 0, 1, 2, 3, 4, 5]) for _ in ps)
        seq.append((ps, fs))
    # embed a C major RH / LH scale with a printed start so the textbook path is exercised
    if hand == RH:
        seq += [((60,), (1,)), ((62,), (0,)), ((64,), (0,)), ((65,), (1,)), ((67,), (0,)), ((69,), (0,)),
                ((71,), (4,)), ((72,), (0,))]
    else:
        seq += [((60,), (1,)), ((59,), (0,)), ((57,), (3,)), ((55,), (0,)), ((53,), (0,)), ((52,), (0,))]
    return seq


@pytest.mark.parametrize("model", PM.MODELS)
def test_efficient_leave_one_out_equals_naive(model):
    from readability.textbook import default_index
    tb = default_index()
    rng = random.Random(7)
    for trial in range(6):
        hand = RH if trial % 2 == 0 else LH
        notes = mk(_random_hand(rng, hand), hand=hand)
        reader = PM.HandReader(notes, tb)
        assert reader.printed, "synthetic hand should have printed digits"
        assert reader.leave_one_out(model) == PM.naive_leave_one_out(reader, model)


def test_hide20_scoring_sanity():
    from readability import eval_player as EP
    rh = mk([(60, 1), (62, 2), (64, 3), (65, 4), (67, 5), (65, 4), (64, 3), (62, 2), (60, 1), (62, 2)])
    lh = mk([(48, 5), (50, 4), (52, 3), (53, 2), (55, 1)], hand=LH, start_idx=len(rh))
    part = Part(id="toy", source="mutopia", composer="X", title="toy", level_group="teaching", level=None,
                license="", notes=rh + lh)
    pd = EP.prepare([part], textbook_index=None, models=("copy_previous", "rules"))[0]
    hidden = EP.choose_hidden(part, random.Random(0), 0.2)
    assert len(hidden & {n.idx for n in rh}) == 2 and len(hidden & {n.idx for n in lh}) == 1
    recs = EP.run_hide(pd, hidden, ("copy_previous", "rules"))
    assert len(recs) == 2 * 3
    summ = EP.summarize_counts(recs)
    r = summ[("rules", "all")]
    assert r["n_hidden"] == 3
    # consistent five-finger position: whatever the rule reader infers is the editor's finger
    assert r["inferred"] >= 1 and r["correct"] == r["inferred"]
    c = summ[("copy_previous", "all")]
    assert c["correct"] == 0          # every step changes finger, so copying is always wrong
    m = EP.metrics(r)
    assert m["reconstruction"] == pytest.approx(m["coverage"] * m["accuracy"])
