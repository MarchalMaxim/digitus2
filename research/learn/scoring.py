"""Official PIG metrics on decoded pieces (``fingering_eval.metrics``, mode ``official``) and the
paired bootstrap over pieces."""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

RESEARCH = Path(__file__).resolve().parents[1]
if str(RESEARCH) not in sys.path:
    sys.path.insert(0, str(RESEARCH))

from fingering_eval import metrics as M  # noqa: E402
from fingering_eval.validate import is_labeled  # noqa: E402

from .corpus import Piece  # noqa: E402
from .decoder import solve_full  # noqa: E402
from .features import FeatureSet  # noqa: E402

METRICS = ("m_gen", "m_high", "m_soft", "m_rec")


@dataclass
class PieceResult:
    piece: str
    corpus: str
    n_notes: int
    n_gt: int
    m_gen: float
    m_high: float
    m_soft: float
    m_rec: float
    relaxed: int
    iterations: int

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def decode_piece(piece: Piece, w: np.ndarray, fs: FeatureSet) -> tuple[dict[str, str], int, int]:
    """Predicted signed finger string per note id, plus relaxed-hand and iteration counts."""
    pred: dict[str, str] = {}
    relaxed = 0
    iterations = 0
    for ex in piece.examples():
        fingers, _cost, it, rel = solve_full(ex.seq, ex.tensors(fs), w)
        relaxed += int(rel)
        iterations += it
        sign = "" if ex.hand == "R" else "-"
        for sn, f in zip(ex.seq, fingers):
            pred[sn.note_id] = f"{sign}{int(f)}"
    return pred, relaxed, iterations


def score_piece(piece: Piece, pred: dict[str, str], relaxed: int = 0, iterations: int = 0) -> PieceResult | None:
    gts = [piece.annotations[s] for s in sorted(piece.annotations, key=lambda s: (0, int(s)) if s.isdigit() else (1, s))]
    est = [pred.get(n.id, "0") for n in piece.notes]
    keep = [i for i in range(len(est)) if all(is_labeled(g[i]) for g in gts)]
    if not keep:
        return None
    gts_k = [[g[i] for i in keep] for g in gts]
    est_k = [est[i] for i in keep]
    s = M.evaluate_piece(gts_k, est_k, piece=piece.id, mode="official")
    return PieceResult(piece.id, piece.corpus, s.n_notes, s.n_gt, s.m_gen, s.m_high, s.m_soft, s.m_rec,
                       relaxed, iterations)


def score_pieces(pieces: list[Piece], w: np.ndarray, fs: FeatureSet) -> list[PieceResult]:
    out = []
    for p in pieces:
        pred, relaxed, it = decode_piece(p, w, fs)
        r = score_piece(p, pred, relaxed, it)
        if r is not None:
            out.append(r)
    return out


def macro(results: list[PieceResult]) -> dict:
    if not results:
        return {m: float("nan") for m in METRICS} | {"pieces": 0, "notes": 0}
    out = {m: 100 * float(np.mean([getattr(r, m) for r in results])) for m in METRICS}
    out["pieces"] = len(results)
    out["notes"] = int(sum(r.n_notes for r in results))
    out["relaxed_hands"] = int(sum(r.relaxed for r in results))
    return out


def paired_bootstrap(a: list[float], b: list[float], resamples: int = 10000, seed: int = 1) -> dict:
    """delta = mean(a - b) with a percentile 95 percent interval over resampled piece sets."""
    if len(a) != len(b):
        raise ValueError("paired series must have equal length")
    d = np.asarray(a, dtype=float) - np.asarray(b, dtype=float)
    n = len(d)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(resamples, n))
    means = d[idx].mean(axis=1)
    lo, hi = np.percentile(means, [2.5, 97.5])
    return {"delta": float(d.mean()), "ci95": [float(lo), float(hi)], "n": n}
