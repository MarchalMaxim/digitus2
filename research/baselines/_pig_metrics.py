"""Fallback implementation of the four PIG match rates (M_gen, M_high, M_soft, M_rec).

This is a line-by-line Python port of Nakamura's ``Evaluate_MultipleGroundTruth``
(``FingeringEvaluation_v190306.hpp`` in SourceCode_v190921.zip, used for the
numbers in Nakamura, Saito & Yoshii 2020).  It is only used when the shared
``research/fingering_eval`` package is not importable, and to cross-check it.

Faithfully reproduced quirks of the reference implementation:
  * M_gen compares the finger *strings*, so a ground truth "3_1" (finger
    substitution) never matches an estimate "3";
  * the other three metrics use ``atoi`` on the finger string, so "3_1" counts
    as 3 there;
  * notes are split into hands by the sign of the *estimated* finger;
  * hands are scored independently, so M_high may pick a different
    ground truth for each hand.
"""
from __future__ import annotations

import re
from typing import Sequence

_ATOI = re.compile(r"^\s*([+-]?\d+)")


def _atoi(s: str) -> int:
    m = _ATOI.match(str(s))
    return int(m.group(1)) if m else 0


def average_pairwise_match_rate(gts: Sequence[Sequence[str]], est: Sequence[str]) -> float:
    n = len(est)
    rates = []
    for gt in gts:
        assert len(gt) == n
        rates.append(sum(1 for a, b in zip(gt, est) if str(a) == str(b)) / n)
    return sum(rates) / len(rates)


def multi_gt_error(gts: Sequence[Sequence[str]], est: Sequence[str], subst_cost: float = 1.0,
                   soft_switch_cost: float = 0.1, hard_switch_cost: float = 1000.0) -> float:
    n_gt = len(gts)
    seq_est: list[list[int]] = [[], []]
    seq_gt: list[list[list[int]]] = [[[] for _ in range(n_gt)], [[] for _ in range(n_gt)]]
    for i, e in enumerate(est):
        fn = _atoi(e)
        hand = 1 if fn < 0 else 0
        seq_est[hand].append(fn)
        for k in range(n_gt):
            seq_gt[hand][k].append(_atoi(gts[k][i]))
    total = 0.0
    for h in (0, 1):
        length = len(seq_est[h])
        if length == 0:  # the C++ code indexes out of bounds here; an empty hand costs nothing
            continue
        cost = [0.0] * n_gt
        for z in range(n_gt):
            if seq_est[h][0] != seq_gt[h][z][0]:
                cost[z] += subst_cost
        for n in range(1, length):
            pre = list(cost)
            for z in range(n_gt):
                best = pre[z]
                for zp in range(n_gt):
                    if zp == z:
                        continue
                    sw = soft_switch_cost if seq_gt[h][zp][n - 1] == seq_gt[h][z][n - 1] else hard_switch_cost
                    tmp = pre[zp] + sw
                    if tmp < best:
                        best = tmp
                cost[z] = best + (subst_cost if seq_est[h][n] != seq_gt[h][z][n] else 0.0)
        total += min(cost)
    return total


def match_rates(gts: Sequence[Sequence[str]], est: Sequence[str]) -> dict[str, float]:
    """All four metrics for one piece (fractions in [0, 1])."""
    n = len(est)
    return {
        "M_gen": average_pairwise_match_rate(gts, est),
        "M_high": (n - multi_gt_error(gts, est, 1, 10000, 10000)) / n,
        "M_soft": (n - multi_gt_error(gts, est, 1, 0, 0)) / n,
        "M_rec": (n - multi_gt_error(gts, est, 1, 1, 10000)) / n,
    }
