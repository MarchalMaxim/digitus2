import itertools
import math
import random

import pytest

from fingering_eval import metrics as M


def brute_force_rec(est, gts, c_rec=1.0, rule="previous"):
    """Exhaustive minimum of E_rec over all ground-truth index sequences (single hand)."""
    n, g = len(est), len(gts)
    best = math.inf
    for z in itertools.product(range(g), repeat=n):
        cost = 0.0
        ok = True
        for i in range(n):
            if i > 0 and z[i] != z[i - 1]:
                ref = i - 1 if rule == "previous" else i
                if gts[z[i]][ref] != gts[z[i - 1]][ref]:
                    ok = False
                    break
                cost += c_rec
            cost += est[i] != gts[z[i]][i]
        if ok:
            best = min(best, cost)
    return best


# --- single ground truth: all four metrics collapse to the plain match rate ------------------

def test_single_gt_all_equal():
    gt = [1, 2, 3, 4, 5, -1, -2]
    est = [1, 2, 4, 4, 5, -1, -3]
    s = M.evaluate_piece([gt], est)
    assert s.m_gen == s.m_high == s.m_soft == s.m_rec == pytest.approx(5 / 7)


def test_perfect_and_zero():
    gt = [1, 2, 3]
    assert M.evaluate_piece([gt], gt).m_rec == 1.0
    s = M.evaluate_piece([gt], [5, 5, 5])
    assert (s.m_gen, s.m_high, s.m_soft, s.m_rec) == (0, 0, 0, 0)


# --- hand-computed multi-GT example ------------------------------------------------------------

def test_two_gt_hand_computed():
    g1 = [1, 2, 3, 4, 5, 4]
    g2 = [1, 3, 4, 5, 5, 4]
    est = [1, 3, 4, 4, 5, 4]
    # per-GT matches: g1 -> 4/6 (pos 0,3,4,5), g2 -> 5/6 (all but pos 3)
    assert M.general_match_rate([g1, g2], est) == pytest.approx((4 / 6 + 5 / 6) / 2)
    assert M.highest_match_rate([g1, g2], est) == pytest.approx(5 / 6)
    assert M.soft_match_rate([g1, g2], est) == pytest.approx(1.0)
    # rec: follow g2 for 0..2 (matches), switch to g1 requires g1==g2 at the previous note
    # (pos 2: 3 vs 4 -> not allowed). g1/g2 agree at pos 0, 4, 5 only, so the only useful
    # switch would be after pos 4 -> no gain; best = stay on g2: 1 error -> 5/6.
    assert M.recombination_match_rate([g1, g2], est) == pytest.approx(5 / 6)


def test_recombination_beats_highest():
    # ground truths agree on note 2 (finger 3); estimate = g1 before it and g2 after it
    g1 = [1, 2, 3, 4, 5]
    g2 = [2, 1, 3, 2, 1]
    est = [1, 2, 3, 2, 1]
    assert M.highest_match_rate([g1, g2], est) == pytest.approx(3 / 5)
    # one recombination (cost 1), zero substitutions -> (5 - 1) / 5
    assert M.recombination_match_rate([g1, g2], est) == pytest.approx(4 / 5)
    assert M.soft_match_rate([g1, g2], est) == 1.0


def test_paper_figure5_example():
    """Fig. 5 of Nakamura et al. (2020): 2 substitutions + 2 recombinations -> E_rec = 4."""
    g1 = [1, 4, 3, 2, 5, 2, 4, 3, 1, 3, 4, 3]
    g2 = [1, 3, 2, 1, 4, 2, 4, 3, 1, 2, 5, 3]
    g3 = [1, 4, 2, 1, 5, 2, 5, 2, 1, 2, 5, 2]
    est = [2, 3, 2, 1, 5, 3, 5, 2, 1, 3, 4, 3]
    err = M.multi_gt_error([g1, g2, g3], est, 1, 1, math.inf)
    assert err == 4
    assert M.recombination_match_rate([g1, g2, g3], est) == pytest.approx(8 / 12)


def test_dp_matches_brute_force_and_switch_rules_equivalent():
    rng = random.Random(1234)
    for _ in range(300):
        n = rng.randint(1, 7)
        g = rng.randint(1, 3)
        gts = [[rng.randint(1, 3) for _ in range(n)] for _ in range(g)]
        est = [rng.randint(1, 3) for _ in range(n)]
        for rule in ("previous", "current"):
            dp = M.multi_gt_error(gts, est, 1, 1, math.inf, switch_rule=rule)
            assert dp == brute_force_rec(est, gts, rule=rule)
        # the two formulations (official C++ vs Appendix A) give the same optimum
        assert M.multi_gt_error(gts, est, 1, 1, math.inf, switch_rule="previous") == \
               M.multi_gt_error(gts, est, 1, 1, math.inf, switch_rule="current")


def test_soft_equals_dp_with_free_switching():
    rng = random.Random(7)
    for _ in range(100):
        n = rng.randint(1, 20)
        gts = [[rng.choice([1, 2, 3, -1, -2]) for _ in range(n)] for _ in range(3)]
        est = [rng.choice([1, 2, 3, -1, -2]) for _ in range(n)]
        free = (n - M.multi_gt_error(gts, est, 1, 0, 0)) / n
        assert M.soft_match_rate(gts, est) == pytest.approx(free)


# --- per-hand behaviour of the official tool -------------------------------------------------

def test_highest_is_chosen_per_hand():
    # RH notes agree with g1, LH notes agree with g2
    g1 = [1, 2, 3, -1, -2, -3]
    g2 = [3, 2, 1, -3, -2, -1]
    est = [1, 2, 3, -3, -2, -1]
    assert M.highest_match_rate([g1, g2], est, per_hand=True) == 1.0
    assert M.highest_match_rate([g1, g2], est, per_hand=False) == pytest.approx(4 / 6)


def test_hand_split_uses_estimate_sign():
    # a gold note fingered with the other hand can never match
    g = [1, -2, 3]
    est = [1, 2, 3]
    assert M.recombination_match_rate([g], est) == pytest.approx(2 / 3)


# --- substitution handling ----------------------------------------------------------------------

def test_substitution_modes():
    g = ["3_1", "2", "-2_-1"]
    est = ["3", "2", "-2"]
    # paper protocol: key-press finger
    assert M.general_match_rate([g], est, mode="press") == 1.0
    # official C++: M_gen compares strings, the others use atoi
    assert M.general_match_rate([g], est, mode="official") == pytest.approx(1 / 3)
    assert M.highest_match_rate([g], est, mode="official") == 1.0
    assert M.soft_match_rate([g], est, mode="official") == 1.0
    assert M.recombination_match_rate([g], est, mode="official") == 1.0
    assert M.general_match_rate([g], est, mode="exact") == pytest.approx(1 / 3)


def test_accepts_notes_and_strings():
    from fingering_eval.pig_io import make_note
    gt = [make_note(i, i, i + 1, 60 + i, 0, f) for i, f in enumerate([1, 2, 3])]
    assert M.general_match_rate([gt], ["1", "2", "4"]) == pytest.approx(2 / 3)


def test_length_mismatch_raises():
    with pytest.raises(ValueError):
        M.evaluate_piece([[1, 2, 3]], [1, 2])
    with pytest.raises(ValueError):
        M.evaluate_piece([], [1, 2])


def test_leave_one_out_and_aggregate():
    anns = {"1": [1, 2, 3, 4], "2": [1, 2, 3, 5], "3": [1, 3, 3, 4]}
    loo = M.leave_one_out(anns, "p")
    assert len(loo) == 3
    # annotation 1 vs {2,3}: M_gen = (3/4 + 3/4)/2
    assert loo[0].m_gen == pytest.approx(0.75)
    agg = M.aggregate([M.PieceScore("a", 10, 1, 1, 1, 1, 1), M.PieceScore("b", 30, 1, 0.5, 0.5, 0.5, 0.5)])
    assert agg["macro_m_gen"] == pytest.approx(0.75)
    assert agg["micro_m_gen"] == pytest.approx((10 + 15) / 40)


def test_official_big_cost_equals_inf_for_short_sequences():
    rng = random.Random(3)
    for _ in range(50):
        n = rng.randint(1, 30)
        gts = [[rng.choice([1, 2, 3, 4, 5]) for _ in range(n)] for _ in range(4)]
        est = [rng.choice([1, 2, 3, 4, 5]) for _ in range(n)]
        assert M.recombination_match_rate(gts, est, mode="press") == \
               M.recombination_match_rate([[str(x) for x in g] for g in gts], [str(x) for x in est], mode="official")
