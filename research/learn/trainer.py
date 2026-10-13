"""Averaged structured perceptron / passive-aggressive (PA-I) trainer with Hamming-augmented
decoding, latent (closest-annotator) targets, partial supervision (finger 0 = unknown), penalty
projection, sample weights and Parncutt or zero initialisation (M3 plan Task 3).

Per example and epoch:

1. target annotation ``k*``: ``latent`` = the annotation agreeing most with the current plain
   decode (ties: lowest slot); ``first`` = the lowest slot.
2. target path ``y+``: the gold where fingered; unfingered notes get the model's best fingers
   given the pins (pinned soft decode). An example whose target violates a structural hard
   constraint of the solver is counted as infeasible and skipped when ``skip_infeasible``.
3. most violating path ``y^``: hard decode with ``-rho`` on every wrong finger of a fingered
   note (soft decode if no finite path exists).
4. ``loss = max(0, w.Phi(y+) - w.Phi(y^) + rho * hamming)``; update ``w -= tau (Phi(y+) - Phi(y^))``
   with ``tau = min(C, loss / |d|^2)`` (PA-I) or ``tau = eta`` (perceptron), times the sample
   weight; penalty rules clamped at >= 0 when ``project``; running average over all steps.
"""
from __future__ import annotations

import random
import time
from dataclasses import asdict, dataclass, field

import numpy as np

from .corpus import HandExample, Piece
from .decoder import held_conflicts, solve_hand
from .features import FeatureSet, costs, path_features, path_hard_violations
from .scoring import macro, score_pieces


@dataclass
class TrainOptions:
    variant: str = "pa"  # 'pa' (PA-I) or 'perceptron' (fixed step eta)
    C: float = 0.05
    eta: float = 0.01
    rho: float = 1.0
    epochs: int = 12
    seed: int = 20261013
    init: str = "parncutt"  # 'parncutt' or 'zeros'
    project: bool = True
    target: str = "latent"  # 'latent' or 'first'
    skip_infeasible: bool = False
    average: bool = True
    select: str = "best"  # 'best' validation m_gen epoch or 'last'
    max_examples: int | None = None  # debugging


@dataclass
class EpochInfo:
    epoch: int
    updates: int
    skipped: int
    infeasible: int
    held_conflicts: int
    mean_loss: float
    hamming_rate: float
    seconds: float
    validation: dict | None = None
    extra: dict = field(default_factory=dict)


@dataclass
class TrainResult:
    weights: np.ndarray
    best_epoch: int
    epochs: list[EpochInfo]
    feature_ids: list[str]
    seconds: float

    def summary(self) -> dict:
        return {
            "best_epoch": self.best_epoch,
            "seconds": self.seconds,
            "epochs": [asdict(e) for e in self.epochs],
        }


def _agreement(pred: np.ndarray, gold: np.ndarray) -> int:
    m = gold != 0
    return int((pred[m] == gold[m]).sum())


def choose_target(ex: HandExample, t, w, pre, mode: str) -> int:
    if mode == "first" or ex.golds.shape[0] == 1:
        return 0
    fingers, cost = solve_hand(t, w, pre=pre)
    if not np.isfinite(cost):
        fingers, _ = solve_hand(t, w, soft=True, pre=pre)
    best, best_k = -1, 0
    for k in range(ex.golds.shape[0]):
        a = _agreement(fingers, ex.golds[k])
        if a > best:
            best, best_k = a, k
    return best_k


def target_path(ex: HandExample, t, w, pre, k: int) -> tuple[np.ndarray, int, int]:
    """(y+, structural violations, far held conflicts) for annotation k."""
    gold = ex.golds[k]
    pins = {int(i): int(f) for i, f in enumerate(gold) if f != 0}
    if len(pins) == ex.n:
        y = gold.astype(np.int64)
    else:
        y, _ = solve_hand(t, w, pinned=pins, soft=True, pre=pre)
    viol = path_hard_violations(t, y)
    held = len(held_conflicts(ex.seq, y, pins))
    return y, viol, held


def train(
    examples: list[HandExample],
    fs: FeatureSet,
    opts: TrainOptions,
    validation: list[Piece] | None = None,
    log=None,
    init_weights: np.ndarray | None = None,
) -> TrainResult:
    t_start = time.perf_counter()
    if init_weights is not None:
        w = np.array(init_weights, dtype=np.float64)
    elif opts.init == "parncutt":
        w = fs.parncutt_weights()
    elif opts.init == "zeros":
        w = np.zeros(fs.n)
    else:
        raise KeyError(opts.init)
    w_sum = np.zeros_like(w)
    steps = 0
    rng = random.Random(opts.seed)
    order = list(range(len(examples)))
    if opts.max_examples:
        order = order[: opts.max_examples]
    infos: list[EpochInfo] = []
    best_w = w.copy()
    best_epoch = 0
    best_gen = -1.0
    for epoch in range(1, opts.epochs + 1):
        t0 = time.perf_counter()
        rng.shuffle(order)
        updates = skipped = infeasible = held_total = 0
        loss_sum = 0.0
        ham_sum = 0
        fingered_sum = 0
        for idx in order:
            ex = examples[idx]
            t = ex.tensors(fs)
            pre = costs(t, w)
            k = choose_target(ex, t, w, pre, opts.target)
            gold = ex.golds[k]
            y_plus, viol, held = target_path(ex, t, w, pre, k)
            held_total += held
            if viol > 0:
                infeasible += 1
                if opts.skip_infeasible:
                    skipped += 1
                    steps += 1
                    w_sum += w
                    continue
            fingered = gold != 0
            extra = None
            if opts.rho > 0:
                extra = np.zeros((ex.n, 5))
                rows = np.nonzero(fingered)[0]
                extra[rows, :] = -opts.rho
                extra[rows, gold[rows] - 1] = 0.0
            y_hat, cost_hat = solve_hand(t, w, extra=extra, pre=pre)
            if not np.isfinite(cost_hat):
                y_hat, _ = solve_hand(t, w, soft=True, extra=extra, pre=pre)
            hamming = int((y_hat[fingered] != gold[fingered]).sum())
            ham_sum += hamming
            fingered_sum += int(fingered.sum())
            phi_plus = path_features(t, y_plus, fs.n)
            phi_hat = path_features(t, y_hat, fs.n)
            d = phi_plus - phi_hat
            loss = float(w @ d) + opts.rho * hamming
            steps += 1
            if loss > 1e-12:
                nd = float(d @ d)
                if nd > 0:
                    if opts.variant == "pa":
                        tau = min(opts.C, loss / nd)
                    elif opts.variant == "perceptron":
                        tau = opts.eta
                    else:
                        raise KeyError(opts.variant)
                    w = w - tau * ex.weight * d
                    if opts.project:
                        w[fs.penalty_mask] = np.maximum(w[fs.penalty_mask], 0.0)
                    updates += 1
                    loss_sum += loss
            w_sum += w
        w_avg = (w_sum / steps) if (opts.average and steps) else w.copy()
        val = None
        if validation:
            val = macro(score_pieces(validation, w_avg, fs))
        info = EpochInfo(
            epoch, updates, skipped, infeasible, held_total,
            loss_sum / max(1, updates), ham_sum / max(1, fingered_sum),
            time.perf_counter() - t0, val,
        )
        infos.append(info)
        if log:
            v = f" validation gen {val['m_gen']:.2f} high {val['m_high']:.2f} soft {val['m_soft']:.2f} rec {val['m_rec']:.2f}" if val else ""
            log(f"epoch {epoch}: {updates} updates, {infeasible} infeasible targets ({skipped} skipped), "
                f"loss {info.mean_loss:.3f}, hamming {100 * info.hamming_rate:.1f}%,{v}, {info.seconds:.1f} s")
        gen = val["m_gen"] if val else float(epoch)
        if opts.select == "last" or gen > best_gen:
            best_gen, best_epoch, best_w = gen, epoch, w_avg.copy()
    return TrainResult(best_w, best_epoch, infos, list(fs.ids), time.perf_counter() - t_start)
