"""Piano-fingering evaluation metrics of Nakamura, Saito & Yoshii (2020).

Reference: E. Nakamura, Y. Saito, K. Yoshii, "Statistical learning and estimation of piano
fingering", Information Sciences 517:68-85, 2020 (arXiv:1904.10237), Sec. 6.2 and Appendix A,
and the authors' evaluation tool ``Evaluate_MultipleGroundTruth`` (SourceCode_v190921.zip,
``FingeringEvaluation_v190306.hpp``) from https://statpianofingering.github.io/demo.html.

Notation: one piece has ``N`` notes, an estimated finger sequence ``est`` and ``G >= 1`` ground
truth (gold) sequences ``gt[1..G]`` aligned note by note (same notes, same order).

M_gen  - general match rate. Mean over ground truths of the plain match rate
         ``#{n : est[n] == gt_g[n]} / N``.
M_high - highest match rate. The match rate w.r.t. the closest ground truth. NOTE: the
         official tool computes this *per hand*: ``(N - sum_h min_g mismatches_h(g)) / N``,
         i.e. the closest ground truth is chosen independently for the right-hand and the
         left-hand note sequences (``per_hand=True``, default, reproduces Table 2).
M_soft - soft match rate. Fraction of notes whose estimated finger equals the finger of at
         least one ground truth.
M_rec  - recombination match rate. ``(N - E_rec) / N`` where ``E_rec`` is the minimum edit
         cost to turn a *recombined ground truth* into the estimate. The recombined ground
         truth follows one ground truth ``z_n`` per note; it may switch from ground truth
         ``z'`` to ``z`` only at a place where the two ground truths assign the same finger,
         paying ``C_rec = 1`` per switch, and every mismatch with the estimate costs
         ``C_sub = 1``. Appendix A writes the transition cost as
             C(z_{n-1}, z_n) = 0                if z_n == z_{n-1}
                             = C_rec            if z_n != z_{n-1} and f^(z_n)_n == f^(z_{n-1})_n
                             = C'_rec (= inf)   otherwise,
         i.e. the two ground truths must agree on note ``n``; the official C++ instead tests
         agreement on the *previous* note ``n-1`` of the same hand. Both rules generate the
         same set of recombined sequences at the same cost (a switch adjacent to a note on
         which the two ground truths agree can be moved across that note), so the optimum is
         identical; ``switch_rule`` selects either and the test-suite checks the equivalence.
         Like the official tool the dynamic programme runs separately on the RH and the LH
         subsequences (``per_hand=True``) and the costs are added.

Hands: as in the official tool the RH/LH split used by M_high/M_soft/M_rec is taken from the
sign of the *estimated* finger (negative = left hand). M_gen and M_soft do not depend on it.

Finger comparison (``mode``):
* ``"official"`` (default): bit-for-bit behaviour of ``Evaluate_MultipleGroundTruth``, which
  produced the paper's Table 2: M_gen compares the raw strings (``"3_1" != "3"``) while
  M_high/M_soft/M_rec use C ``atoi`` (= key-press finger).
* ``"press"`` (the paper's *stated* protocol, Sec. 4: "we use for analysis only the finger
  firstly used for pressing the piano key"): substitutions ``3_1`` are reduced to their
  key-press finger 3 before every comparison. Differs from ``"official"`` only in M_gen and only
  for gold notes with substitutions (0.32% of PIG notes; Table 2 M_gen +0.1).
* ``"exact"``: raw-string comparison everywhere.

Piece-level scores are averaged *over pieces* (macro average) for the paper's Table 2
("the match rates are averaged over the 30 pieces in the test data"); :func:`aggregate`
also returns note-weighted (micro) averages.
"""
from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass, field
from itertools import combinations
from typing import Iterable, Sequence

from .pig_io import Note, PigFile, parse_finger

OFFICIAL_BIG = 10000.0  # the "infinite" switch cost used by the official C++ tool

FingerLike = "str | int | Note"
_ATOI_RE = re.compile(r"^\s*([+-]?\d+)")


def _atoi(s: str) -> int:
    """C ``atoi``: leading integer, 0 if none."""
    m = _ATOI_RE.match(s)
    return int(m.group(1)) if m else 0


def _raw(x) -> str:
    if isinstance(x, Note):
        return x.finger
    if isinstance(x, (int,)):
        return str(x)
    return str(x).strip()


def _press(x) -> int:
    if isinstance(x, int):
        return x
    s = _raw(x)
    try:
        return parse_finger(s).press
    except ValueError:
        return _atoi(s)


def as_sequence(seq) -> list:
    """Accept a PigFile, a list of Notes, finger strings or ints."""
    if isinstance(seq, PigFile):
        return list(seq.notes)
    return list(seq)


def keys(seq, mode: str, metric: str) -> list:
    """Comparison keys for one sequence under ``mode`` for ``metric`` ('gen' or 'dp')."""
    seq = as_sequence(seq)
    if mode == "press":
        return [_press(x) for x in seq]
    if mode == "official":
        if metric == "gen":
            return [_raw(x) for x in seq]
        return [_atoi(_raw(x)) if not isinstance(x, int) else x for x in seq]
    if mode == "exact":
        return [_raw(x) for x in seq]
    raise ValueError(f"unknown mode {mode!r}")


def _hands_from_estimate(est) -> list[int]:
    """0 = RH, 1 = LH, from the sign of the estimated (atoi'ed) finger, as the official tool."""
    out = []
    for x in as_sequence(est):
        v = x if isinstance(x, int) else _atoi(_raw(x))
        out.append(1 if v < 0 else 0)
    return out


def _check(gts: Sequence, est) -> tuple[list[list], list]:
    est_l = as_sequence(est)
    gts_l = [as_sequence(g) for g in gts]
    if not gts_l:
        raise ValueError("need at least one ground truth")
    for i, g in enumerate(gts_l):
        if len(g) != len(est_l):
            raise ValueError(f"length mismatch: ground truth #{i} has {len(g)} notes, estimate has {len(est_l)}")
    return gts_l, est_l


# ---------------------------------------------------------------------------------------
# core dynamic programme (MultiGTError in the official tool)
# ---------------------------------------------------------------------------------------

def _dp_cost(est: list, gts: list[list], subst: float, soft: float, hard: float,
             switch_rule: str = "previous") -> float:
    """Minimum edit cost of a recombined ground truth against ``est`` (one hand)."""
    L = len(est)
    G = len(gts)
    if L == 0:
        return 0.0
    cost = [(subst if est[0] != g[0] else 0.0) for g in gts]
    for n in range(1, L):
        pre = cost
        cost = [0.0] * G
        ref = n - 1 if switch_rule == "previous" else n
        for z in range(G):
            best = pre[z]
            gz = gts[z][ref]
            for zp in range(G):
                if zp == z:
                    continue
                c = pre[zp] + (soft if gts[zp][ref] == gz else hard)
                if c < best:
                    best = c
            cost[z] = best + (subst if est[n] != gts[z][n] else 0.0)
    return min(cost)


def multi_gt_error(gts: Sequence, est, subst_cost: float = 1.0, soft_switch_cost: float = 1.0,
                   hard_switch_cost: float = math.inf, mode: str = "official", per_hand: bool = True,
                   switch_rule: str = "previous") -> float:
    """Total recombination edit cost (official ``MultiGTError``), summed over hands."""
    gts_l, est_l = _check(gts, est)
    ek = keys(est_l, mode, "dp")
    gk = [keys(g, mode, "dp") for g in gts_l]
    if not per_hand:
        return _dp_cost(ek, gk, subst_cost, soft_switch_cost, hard_switch_cost, switch_rule)
    hands = _hands_from_estimate(est_l)
    total = 0.0
    for h in (0, 1):
        idx = [i for i, hh in enumerate(hands) if hh == h]
        if not idx:
            continue
        total += _dp_cost([ek[i] for i in idx], [[g[i] for i in idx] for g in gk],
                          subst_cost, soft_switch_cost, hard_switch_cost, switch_rule)
    return total


# ---------------------------------------------------------------------------------------
# the four metrics
# ---------------------------------------------------------------------------------------

def match_rate(gt, est, mode: str = "official") -> float:
    """Plain match rate between one ground truth and an estimate."""
    (g,), e = _check([gt], est)
    gk, ek = keys(g, mode, "gen"), keys(e, mode, "gen")
    if not ek:
        return float("nan")
    return sum(a == b for a, b in zip(gk, ek)) / len(ek)


def general_match_rate(gts: Sequence, est, mode: str = "official") -> float:
    """M_gen: mean over ground truths of the plain match rate."""
    gts_l, est_l = _check(gts, est)
    return sum(match_rate(g, est_l, mode) for g in gts_l) / len(gts_l)


def highest_match_rate(gts: Sequence, est, mode: str = "official", per_hand: bool = True) -> float:
    """M_high: match rate w.r.t. the closest ground truth (chosen per hand by default)."""
    gts_l, est_l = _check(gts, est)
    n = len(est_l)
    if n == 0:
        return float("nan")
    if per_hand:
        big = OFFICIAL_BIG if mode == "official" else math.inf
        err = multi_gt_error(gts_l, est_l, 1.0, big, big, mode=mode, per_hand=True)
        return (n - err) / n
    return max(match_rate(g, est_l, mode) for g in gts_l)


def soft_match_rate(gts: Sequence, est, mode: str = "official") -> float:
    """M_soft: fraction of notes matching at least one ground truth."""
    gts_l, est_l = _check(gts, est)
    n = len(est_l)
    if n == 0:
        return float("nan")
    ek = keys(est_l, mode, "dp")
    gk = [keys(g, mode, "dp") for g in gts_l]
    hit = sum(any(g[i] == ek[i] for g in gk) for i in range(n))
    return hit / n


def recombination_match_rate(gts: Sequence, est, mode: str = "official", c_rec: float = 1.0,
                             c_rec_mismatch: float | None = None, per_hand: bool = True,
                             switch_rule: str = "previous") -> float:
    """M_rec = (N - E_rec) / N with C_sub = 1, C_rec = ``c_rec`` (paper: 1), C'_rec = inf.

    ``c_rec_mismatch`` defaults to ``inf`` (``10000`` in ``mode="official"``, like the C++).
    ``switch_rule``: ``"previous"`` (official C++: ground truths must agree on the previous
    note of the hand) or ``"current"`` (Appendix A formula: agree on the current note).
    """
    gts_l, est_l = _check(gts, est)
    n = len(est_l)
    if n == 0:
        return float("nan")
    if c_rec_mismatch is None:
        c_rec_mismatch = OFFICIAL_BIG if mode == "official" else math.inf
    err = multi_gt_error(gts_l, est_l, 1.0, c_rec, c_rec_mismatch, mode=mode, per_hand=per_hand,
                         switch_rule=switch_rule)
    return (n - err) / n


@dataclass
class PieceScore:
    piece: str
    n_notes: int
    n_gt: int
    m_gen: float
    m_high: float
    m_soft: float
    m_rec: float
    extra: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return asdict(self)


def evaluate_piece(gts: Sequence, est, piece: str = "", mode: str = "official",
                   per_hand: bool = True) -> PieceScore:
    """All four metrics for one piece."""
    gts_l, est_l = _check(gts, est)
    return PieceScore(piece=piece, n_notes=len(est_l), n_gt=len(gts_l),
                      m_gen=general_match_rate(gts_l, est_l, mode),
                      m_high=highest_match_rate(gts_l, est_l, mode, per_hand=per_hand),
                      m_soft=soft_match_rate(gts_l, est_l, mode),
                      m_rec=recombination_match_rate(gts_l, est_l, mode, per_hand=per_hand))


METRIC_NAMES = ("m_gen", "m_high", "m_soft", "m_rec")


def aggregate(scores: Iterable[PieceScore]) -> dict:
    """Macro (mean over pieces, as in the paper) and micro (note-weighted) averages."""
    sc = [s for s in scores if s.n_notes > 0]
    out: dict = {"n_pieces": len(sc), "n_notes": sum(s.n_notes for s in sc)}
    if not sc:
        return out
    for m in METRIC_NAMES:
        out[f"macro_{m}"] = sum(getattr(s, m) for s in sc) / len(sc)
        out[f"micro_{m}"] = sum(getattr(s, m) * s.n_notes for s in sc) / out["n_notes"]
    return out


# ---------------------------------------------------------------------------------------
# human agreement
# ---------------------------------------------------------------------------------------

def pairwise_match_rates(annotations: dict[str, Sequence], mode: str = "official") -> dict[tuple[str, str], float]:
    """Plain match rate for every unordered pair of annotations of one piece."""
    out = {}
    for a, b in combinations(sorted(annotations), 2):
        out[(a, b)] = match_rate(annotations[a], annotations[b], mode)
    return out


def leave_one_out(annotations: dict[str, Sequence], piece: str = "", mode: str = "official",
                  per_hand: bool = True) -> list[PieceScore]:
    """'Human' reference of Table 2: each annotation scored against all the others."""
    out = []
    ids = sorted(annotations)
    for k in ids:
        others = [annotations[j] for j in ids if j != k]
        if not others:
            continue
        s = evaluate_piece(others, annotations[k], piece=piece, mode=mode, per_hand=per_hand)
        s.extra["held_out"] = k
        out.append(s)
    return out


def finger_strings(seq) -> list[str]:
    return [_raw(x) for x in as_sequence(seq)]
