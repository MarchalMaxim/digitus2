"""Exact second-order Viterbi decoder and the solver's constraint handling, ported from
``packages/engine/src/fingering/viterbi.ts`` and ``solve.ts``.

* State at note i = (f_{i-1}, f_i); ties go to the lexicographically smallest optimal path
  (forward read-out along the backward pass, first minimum wins), as in viterbi.ts.
* ``solve_hand`` applies pins (hard in every mode), forbidden fingers, the within-slice order
  rule, the still-sounding same-finger rule (pairs and triples), +Infinity or ``SOFT_PENALTY``
  (1000) when ``soft``, and an optional ``extra`` unary term (loss augmentation).
* ``solve_full`` is ``solveFingering`` for one hand: hard decode, then up to five rounds of
  forbidding held-note conflicts farther than two notes back, then a soft decode if no finite
  path exists.
"""
from __future__ import annotations

import numpy as np

from .features import HELD_EPS, Tensors, costs
from .sequence import SeqNote

INF = np.inf
SOFT_PENALTY = 1000.0
F = 5


def viterbi(cu: np.ndarray, cp: np.ndarray, ct: np.ndarray) -> tuple[np.ndarray, float]:
    """Minimise sum_i cu[i,f_i] + cp[i,f_{i-1},f_i] (i>=1) + ct[i,f_{i-2},f_{i-1},f_i] (i>=2).

    Returns fingers 0..4 and the path cost (+Infinity when no finite path exists; the returned
    path then follows the cheapest completion from state (0, 0) like the engine).
    """
    n = cu.shape[0]
    if n == 0:
        return np.zeros(0, dtype=np.int64), 0.0
    if n == 1:
        best = int(np.argmin(cu[0]))
        return np.array([best]), float(cu[0, best])
    # L[i][g,f] = cu[i,f] + cp[i,g,f]
    L = cu[:, None, :] + cp
    D = np.empty((n, F, F))
    D[1] = cu[0][:, None] + L[1]
    for i in range(2, n):
        # min over h of D[i-1][h,g] + ct[i][h,g,f]
        D[i] = (D[i - 1][:, :, None] + ct[i]).min(axis=0) + L[i]
    B = np.zeros((n, F, F))
    for i in range(n - 2, 0, -1):
        # B[i][g,f] = min over e of L[i+1][f,e] + ct[i+1][g,f,e] + B[i+1][f,e]
        B[i] = (L[i + 1][None, :, :] + ct[i + 1] + B[i + 1][None, :, :]).min(axis=2)
    fingers = np.zeros(n, dtype=np.int64)
    tot = (D[1] + B[1]).ravel()
    k1 = int(np.argmin(tot))  # first minimum: lowest g, then lowest f
    fingers[0], fingers[1] = divmod(k1, F)
    for i in range(2, n):
        g, f = fingers[i - 2], fingers[i - 1]
        cand = L[i][f] + ct[i][g, f] + B[i][f]
        fingers[i] = int(np.argmin(cand))
    cost = float(cu[0, fingers[0]])
    for i in range(1, n):
        c = L[i][fingers[i - 1], fingers[i]]
        if i >= 2:
            c = c + ct[i][fingers[i - 2], fingers[i - 1], fingers[i]]
        cost += c
    return fingers, cost


def solve_hand(
    t: Tensors,
    w: np.ndarray,
    pinned: dict[int, int] | None = None,
    forbidden: dict[int, set[int]] | None = None,
    soft: bool = False,
    extra: np.ndarray | None = None,
    pre: tuple | None = None,
) -> tuple[np.ndarray, float]:
    """``solveHand``: fingers 1..5 and the path cost (without ``extra``)."""
    cu, cp, ct = pre if pre is not None else costs(t, w)
    penalty = SOFT_PENALTY if soft else INF
    cu = cu.copy()
    if pinned:
        for i, f in pinned.items():
            keep = cu[i, f - 1]
            cu[i, :] = INF
            cu[i, f - 1] = keep
    if forbidden:
        # solve.ts returns the penalty *instead of* the unary terms for a forbidden finger
        for i, fs in forbidden.items():
            for f in fs:
                if not (i in (pinned or {}) and pinned[i] != f):
                    cu[i, f - 1] = penalty
    cp = cp.copy()
    cp[t.p_hard.reshape(t.n, 5, 5)] += penalty
    ct = ct.copy()
    ct[t.t_hard.reshape(t.n, 5, 5, 5)] += penalty
    if extra is not None:
        fingers, _ = viterbi(cu + extra, cp, ct)
        # cost without the extra, structural penalties included (as the engine reports it)
        cost = path_cost(cu, cp, ct, fingers)
        return fingers + 1, cost
    fingers, cost = viterbi(cu, cp, ct)
    return fingers + 1, cost


def path_cost(cu: np.ndarray, cp: np.ndarray, ct: np.ndarray, f0: np.ndarray) -> float:
    n = len(f0)
    if n == 0:
        return 0.0
    c = float(cu[np.arange(n), f0].sum())
    if n >= 2:
        c += float(cp[np.arange(1, n), f0[:-1], f0[1:]].sum())
    if n >= 3:
        c += float(ct[np.arange(2, n), f0[:-2], f0[1:-1], f0[2:]].sum())
    return c


def held_conflicts(seq: list[SeqNote], fingers: np.ndarray, pinned: dict[int, int]) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    v = seq
    for i in range(len(v)):
        for m in range(i - 3, -1, -1):
            if v[m].offset <= v[i].onset + HELD_EPS:
                continue
            if fingers[m] != fingers[i] or v[m].slice == v[i].slice:
                continue
            if i not in pinned:
                out.append((i, int(fingers[m])))
            elif m not in pinned:
                out.append((m, int(fingers[i])))
    return out


def solve_full(
    seq: list[SeqNote],
    t: Tensors,
    w: np.ndarray,
    pinned: dict[int, int] | None = None,
    max_iter: int = 5,
) -> tuple[np.ndarray, float, int, bool]:
    """``solveFingering`` for one hand: (fingers 1..5, cost, iterations, relaxed)."""
    pinned = pinned or {}
    pre = costs(t, w)
    forbidden: dict[int, set[int]] = {}
    fingers, cost = solve_hand(t, w, pinned, forbidden, False, pre=pre)
    iterations = 1
    while iterations < max_iter and np.isfinite(cost):
        added = False
        for i, f in held_conflicts(seq, fingers, pinned):
            s = forbidden.setdefault(i, set())
            if f not in s:
                added = True
            s.add(f)
        if not added:
            break
        fingers, cost = solve_hand(t, w, pinned, forbidden, False, pre=pre)
        iterations += 1
    relaxed = False
    if not np.isfinite(cost):
        fingers, cost = solve_hand(t, w, pinned, forbidden, True, pre=pre)
        relaxed = True
    return fingers, cost, iterations, relaxed


def brute_force(cu: np.ndarray, cp: np.ndarray, ct: np.ndarray) -> tuple[np.ndarray, float]:
    """Reference for tests: lexicographically first optimum by exhaustive enumeration."""
    import itertools

    n = cu.shape[0]
    best, best_path = INF, None
    for path in itertools.product(range(F), repeat=n):
        f0 = np.array(path)
        c = path_cost(cu, cp, ct, f0)
        if c < best:
            best, best_path = c, f0
    if best_path is None:
        return np.zeros(n, dtype=np.int64), INF
    return best_path, best
