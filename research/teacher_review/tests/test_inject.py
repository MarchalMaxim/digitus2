"""Fault injector: every planted fault changes exactly the recorded notes, in the recorded way,
and nothing else; faults do not overlap; each kind produces the condition it claims."""
import random

import pytest

from teacher_review.inject import KINDS, _cands_hop_at_speed, applicable_kinds, inject_faults
from teacher_review.model import is_black

from .conftest import make_passage


def _rich_passage():
    """RH: a stepwise run, a fast pair, a black key between whites, two chords (one wide)."""
    rh = [
        (0, 0.25, [60], [1]), (0.25, 0.25, [62], [2]), (0.5, 0.25, [64], [3]), (0.75, 0.25, [65], [1]),   # fast run
        (1, 0.25, [67], [2]), (1.25, 0.25, [69], [3]), (1.5, 0.25, [71], [4]), (1.75, 0.25, [72], [5]),
        (2, 0.5, [74], [5]), (2.5, 0.5, [72], [3]),
        (3, 0.5, [71], [2]), (3.5, 0.5, [70], [3]), (4, 0.5, [72], [4]),        # Bb4 between whites, finger 3
        (4.5, 0.5, [60, 64, 67], [1, 3, 5]),                                     # triad
        (5, 1, [60, 72], [1, 5]),                                                # octave
        (6, 1, [65, 69, 72], [1, 2, 5]), (7, 1, [67, 71, 74], [1, 3, 5]),
    ]
    return make_passage(rh, tempo=120)


def test_all_kinds_are_applicable_on_the_rich_passage():
    p = _rich_passage()
    counts = applicable_kinds(p)
    assert all(counts[k] > 0 for k in KINDS), counts


def test_faults_land_where_recorded_and_nowhere_else():
    p = _rich_passage()
    for seed in range(12):
        q, faults = inject_faults(p, random.Random(seed))
        assert 2 <= len(faults) <= 3
        assert len({f.kind for f in faults}) == len(faults)
        before, after = p.finger_map("R"), q.finger_map("R")
        changed = {i for i in before if before[i] != after[i]}
        recorded = set()
        for f in faults:
            for i in f.notes:
                assert before[i] == f.before[i]
                assert after[i] == f.after[i]
            recorded |= {i for i in f.notes if f.before[i] != f.after[i]}
            assert f.anchor in f.notes
        assert changed == recorded, (changed, recorded)
        # non-overlap with a margin of two notes
        idx = [sorted(int(i[1:]) for i in f.notes) for f in faults]
        for a in range(len(idx)):
            for b in range(a + 1, len(idx)):
                assert min(abs(x - y) for x in idx[a] for y in idx[b]) > 2


def test_each_kind_produces_its_condition():
    p = _rich_passage()
    for kind in KINDS:
        q, faults = inject_faults(p, random.Random(1), n_target=1, kinds=[kind], min_faults=1)
        f = [x for x in faults if x.kind == kind]
        assert f, kind
        f = f[0]
        fm = q.finger_map("R")
        notes = {i: pch for i, pch, _, _, _ in q.notes("R")}
        if kind == "chord_same_finger":
            a, b = f.notes
            assert fm[a] == fm[b]
        elif kind == "impossible_span":
            lo, hi = f.notes[0], f.notes[-1]
            assert notes[hi] - notes[lo] >= 8 and {fm[lo], fm[hi]} <= {2, 3, 4, 5}
        elif kind == "nonthumb_crossing":
            a, b = f.notes
            assert notes[b] > notes[a] and fm[b] < fm[a] and 1 not in (fm[a], fm[b])
        elif kind == "hop_at_speed":
            a, b = f.notes
            assert fm[a] == fm[b] and notes[a] != notes[b]
        elif kind == "run_345_reversed":
            assert [fm[i] for i in f.notes] == [5, 4, 3]
            pitches = [notes[i] for i in f.notes]
            assert pitches == sorted(pitches)
        elif kind == "thumb_on_black_between_whites":
            (a,) = f.notes
            assert fm[a] == 1 and is_black(notes[a])


def test_hop_requires_speed():
    slow = make_passage([(0, 1, [60], [1]), (1, 1, [62], [2]), (2, 1, [64], [3])], tempo=60)
    assert _cands_hop_at_speed(slow, "R") == []
    fast = make_passage([(0, 0.25, [60], [1]), (0.25, 0.25, [62], [2]), (0.5, 0.25, [64], [3])], tempo=120)
    assert _cands_hop_at_speed(fast, "R")


def test_left_hand_direction_is_mirrored():
    # LH descending stepwise run fingered 1-2-3 (outward): reversed run must be planted as 5-4-3
    lh = [(0, 0.5, [60], [1]), (0.5, 0.5, [59], [2]), (1, 0.5, [57], [3]), (1.5, 0.5, [55], [4]), (2, 1, [53], [5])]
    p = make_passage([], lh=lh, target=("L",))
    q, faults = inject_faults(p, random.Random(3), n_target=1, kinds=["run_345_reversed"], min_faults=1)
    kinds = {f.kind for f in faults}
    assert "run_345_reversed" in kinds
    f = next(f for f in faults if f.kind == "run_345_reversed")
    fm = q.finger_map("L")
    assert [fm[i] for i in f.notes] == [5, 4, 3]


def test_uninjectable_passage_raises():
    p = make_passage([(0, 4, [60], [1])])
    with pytest.raises(ValueError):
        inject_faults(p, random.Random(0))
