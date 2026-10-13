"""Rule terms and feature families.

The M2 terms are a line-by-line port of ``packages/engine/src/fingering/rules.ts`` (Parncutt
span tables from ``spans.ts``, ``x14`` lattice from ``geometry.ts``). Every term is
``(rule_id, points)``; the cost of a path is ``sum(weight[rule] * points)``.

Feature *families* beyond the M2 rules (all weight 0 until learned):

* ``colour``     ``on:<f>:black|white`` (10)        unary colour indicators (M3 plan Task 1)
* ``trans``      ``tr:<g><f>:up|down`` (50)         melodic transition indicators, different slices,
                                                     ``i != 0``; emitted for ``g == f`` too (hops)
* ``chord``      ``ch:<g><f>`` g < f (10)           adjacent chord pair indicators
* ``lattice``    ``latticeStep``, ``levelChange``   plan Task 1 definitions
* ``timing``     ``stretchFast``, ``shiftFast``, ``repeatFast``
* ``rest``       ``restRelax:<rule>`` (4)           span points x [rest before b] (legato coupling
                                                     relaxes across rests; FingerFlow)
* ``fitts``      ``fitts``, ``fittsFast``           log2(1 + shift) relocation cost, and at speed
* ``geo``        ``cm:<g><f>:up|down`` (50)         physical key-centre distance in cm per pair
* ``trColour``   ``tr:<g><f>:up|down:black|white``  transition indicator by destination colour (100)
* ``latticeBins`` ``lb:<g><f>:<dx>`` (725)          lattice displacement bins (x14 units, clipped
                                                     to +-14) per finger pair, HMM-style

``FeatureSet(families)`` fixes the id order; ``build_tensors`` turns one hand sequence into the
sparse per-slot tensors the decoder and the trainer use.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .sequence import SeqNote

# --- geometry (geometry.ts) -----------------------------------------------------------------

_X14 = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12]
_WHITE_COL = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]


def x14(midi: int) -> int:
    return 14 * (midi // 12) + _X14[midi % 12]


def white_column(midi: int) -> int:
    return 7 * (midi // 12) + _WHITE_COL[midi % 12]


# Physical key-centre positions in millimetres from the left edge of each C (prototype only).
# White keys 23.5 mm wide (centres at 11.75 + 23.5 k). Black-key centres from the "equal back
# width" layout: the C-D-E group's 70.5 mm is split into 5 equal 14.1 mm backs (C# at 1.5 and
# D# at 3.5 of them), the F-G-A-B group's 94 mm into 7 equal 13.43 mm backs (F#, G#, A# at 1.5,
# 3.5, 5.5). Octave = 164.5 mm.
_OCTAVE_MM = 164.5
_X_MM = {
    0: 11.75, 2: 35.25, 4: 58.75, 5: 82.25, 7: 105.75, 9: 129.25, 11: 152.75,
    1: 14.1 * 1.5, 3: 14.1 * 3.5,
    6: 70.5 + (94 / 7) * 1.5, 8: 70.5 + (94 / 7) * 3.5, 10: 70.5 + (94 / 7) * 5.5,
}


def x_mm(midi: int) -> float:
    return _OCTAVE_MM * (midi // 12) + _X_MM[midi % 12]


# --- span tables (spans.ts) ------------------------------------------------------------------

PARNCUTT_TABLES = {
    "maxPrac": [[0, 10, 12, 14, 15], [5, 0, 5, 7, 10], [4, -1, 0, 4, 7], [3, -1, -1, 0, 5], [1, -2, -1, -1, 0]],
    "maxComf": [[0, 8, 10, 12, 13], [3, 0, 3, 5, 8], [2, -1, 0, 2, 5], [1, -1, -1, 0, 3], [-1, -2, -1, -1, 0]],
    "maxRel": [[0, 5, 7, 9, 10], [-1, 0, 2, 4, 6], [-3, -1, 0, 2, 4], [-5, -3, -1, 0, 2], [-7, -5, -3, -1, 0]],
}


def scale_tables(t: dict, factor: float) -> dict:
    # JavaScript Math.round (half up) as in spans.ts
    r = lambda v: int(math.floor(v * factor + 0.5))  # noqa: E731
    return {k: [[r(v) for v in row] for row in m] for k, m in t.items()}


PROFILE_SCALE = {"large": 1.0, "medium": 0.9, "small": 0.8, "child": 0.7}


def tables_for_profile(profile: str = "large") -> dict:
    s = PROFILE_SCALE[profile]
    return PARNCUTT_TABLES if s == 1 else scale_tables(PARNCUTT_TABLES, s)


def span(t: dict, kind: str, f: int, g: int) -> int:
    if kind == "maxPrac":
        return t["maxPrac"][f - 1][g - 1]
    if kind == "maxComf":
        return t["maxComf"][f - 1][g - 1]
    if kind == "maxRel":
        return t["maxRel"][f - 1][g - 1]
    if kind == "minPrac":
        return -t["maxPrac"][g - 1][f - 1]
    if kind == "minComf":
        return -t["maxComf"][g - 1][f - 1]
    if kind == "minRel":
        return -t["maxRel"][g - 1][f - 1]
    raise KeyError(kind)


# --- rule ids ---------------------------------------------------------------------------------

M2_RULE_IDS = [
    "weakFinger", "weakFifth", "thumbOnBlack", "fiveOnBlack",
    "stretch", "smallSpan", "largeSpan", "beyondPractical", "threeToFour", "fourOnBlack",
    "thumbPassing", "hop", "repeatedNoteSameFinger", "repeatedNoteFingerChange",
    "chordStretch", "chordSmallSpan", "chordLargeSpan", "chordBeyondPractical",
    "handPositionShift", "positionChangeCount", "positionChangeSize", "threeFourFive",
    "sameFingerPivot", "template",
]

PARNCUTT_WEIGHTS = {
    "weakFinger": 1, "weakFifth": 1, "thumbOnBlack": 1, "fiveOnBlack": 1, "stretch": 2,
    "smallSpan": 1, "largeSpan": 1, "beyondPractical": 10, "threeToFour": 1, "fourOnBlack": 1,
    "thumbPassing": 1, "hop": 3, "repeatedNoteSameFinger": 1, "repeatedNoteFingerChange": 1,
    "chordStretch": 2, "chordSmallSpan": 2, "chordLargeSpan": 2, "chordBeyondPractical": 10,
    "handPositionShift": 1, "positionChangeCount": 1, "positionChangeSize": 1,
    "threeFourFive": 1, "sameFingerPivot": 1, "template": 2,
}

PENALTY_RULES = {
    "stretch", "smallSpan", "largeSpan", "beyondPractical", "chordStretch", "chordSmallSpan",
    "chordLargeSpan", "chordBeyondPractical", "hop", "repeatedNoteSameFinger", "handPositionShift",
    "positionChangeSize", "stretchFast", "shiftFast",
}

FAMILY_IDS: dict[str, list[str]] = {
    "rules": list(M2_RULE_IDS),
    "colour": [f"on:{f}:{c}" for f in range(1, 6) for c in ("black", "white")],
    "trans": [f"tr:{g}{f}:{d}" for g in range(1, 6) for f in range(1, 6) for d in ("up", "down")],
    "chord": [f"ch:{g}{f}" for g in range(1, 6) for f in range(g + 1, 6)],
    "lattice": ["latticeStep", "levelChange"],
    "timing": ["stretchFast", "shiftFast", "repeatFast"],
    "rest": [f"restRelax:{r}" for r in ("stretch", "smallSpan", "largeSpan", "beyondPractical")],
    "fitts": ["fitts", "fittsFast"],
    "geo": [f"cm:{g}{f}:{d}" for g in range(1, 6) for f in range(1, 6) for d in ("up", "down")],
    "trColour": [
        f"tr:{g}{f}:{d}:{c}"
        for g in range(1, 6) for f in range(1, 6) for d in ("up", "down") for c in ("black", "white")
    ],
    "latticeBins": [f"lb:{g}{f}:{dx}" for g in range(1, 6) for f in range(1, 6) for dx in range(-14, 15)],
}
FAMILY_ORDER = list(FAMILY_IDS)

HOP_FAST_SEC = 0.25
REPEAT_FAST_SEC = 0.18


@dataclass
class Ctx:
    tables: dict
    families: frozenset
    hop_fast: float = HOP_FAST_SEC
    repeat_fast: float = REPEAT_FAST_SEC


def _over(v: float, mx: float) -> float:
    return max(0.0, v - mx)


def _under(v: float, mn: float) -> float:
    return max(0.0, mn - v)


def _white(n: SeqNote | None) -> bool:
    return n is not None and not n.black


def _push(terms: list, rule: str, points: float) -> None:
    if points != 0:
        terms.append((rule, points))


# --- the term functions (rules.ts) ----------------------------------------------------------

def unary_terms(ctx: Ctx, n: SeqNote, f: int, prev: SeqNote | None, nxt: SeqNote | None) -> list:
    terms: list = []
    if f == 4:
        _push(terms, "weakFinger", 1)
    if f == 5:
        _push(terms, "weakFifth", 1)
    if f == 1 and n.black:
        _push(terms, "thumbOnBlack", 1 + (2 if _white(prev) else 0) + (2 if _white(nxt) else 0))
    if f == 5 and n.black:
        _push(terms, "fiveOnBlack", (2 if _white(prev) else 0) + (2 if _white(nxt) else 0))
    if "colour" in ctx.families:
        _push(terms, f"on:{f}:{'black' if n.black else 'white'}", 1)
    return terms


def span_points(ctx: Ctx, i: int, g: int, f: int) -> tuple[float, float, float, float]:
    t = ctx.tables
    theta = 1 if (g == 1 or f == 1) else 2
    return (
        _over(i, span(t, "maxComf", g, f)) + _under(i, span(t, "minComf", g, f)),
        theta * _under(i, span(t, "minRel", g, f)),
        theta * _over(i, span(t, "maxRel", g, f)),
        _over(i, span(t, "maxPrac", g, f)) + _under(i, span(t, "minPrac", g, f)),
    )


def anchor(n: SeqNote, f: int) -> float:
    return x14(n.pitch) / 2 - (f - 1)


def pair_terms(ctx: Ctx, a: SeqNote, g: int, b: SeqNote, f: int) -> list:
    terms = _pair_terms_without_position(ctx, a, g, b, f)
    shift = abs(anchor(b, f) - anchor(a, g))
    _push(terms, "handPositionShift", shift / 2 if b.rest_before else shift)
    fam = ctx.families
    if a.slice != b.slice:
        if "timing" in fam:
            _push(terms, "shiftFast", (shift / 2 if b.rest_before else shift) * min(1.0, 0.25 / max(b.ioi, 0.01)))
        if "fitts" in fam:
            fitts = math.log2(1 + shift)
            _push(terms, "fitts", fitts)
            _push(terms, "fittsFast", fitts * min(1.0, 0.25 / max(b.ioi, 0.01)))
    return terms


def _pair_terms_without_position(ctx: Ctx, a: SeqNote, g: int, b: SeqNote, f: int) -> list:
    terms: list = []
    fam = ctx.families
    i = b.pitch - a.pitch
    if a.slice == b.slice:
        s = span_points(ctx, i, g, f)
        _push(terms, "chordStretch", s[0])
        _push(terms, "chordSmallSpan", s[1])
        _push(terms, "chordLargeSpan", s[2])
        _push(terms, "chordBeyondPractical", s[3])
        if "chord" in fam and g < f:
            _push(terms, f"ch:{g}{f}", 1)
        return terms
    # different slices: indicator families that apply to every melodic pair, repeated keys included
    if "latticeBins" in fam:
        dx = max(-14, min(14, x14(b.pitch) - x14(a.pitch)))
        _push(terms, f"lb:{g}{f}:{dx}", 1)
    if i == 0:
        if g == f and b.ioi < ctx.repeat_fast:
            _push(terms, "repeatedNoteSameFinger", 2)
        if g != f and b.ioi >= ctx.repeat_fast:
            _push(terms, "repeatedNoteFingerChange", 1)
        if "timing" in fam and b.ioi < ctx.repeat_fast:
            _push(terms, "repeatFast", 1)
        return terms
    direction = "up" if i > 0 else "down"
    if "trans" in fam:
        _push(terms, f"tr:{g}{f}:{direction}", 1)
    if "trColour" in fam:
        _push(terms, f"tr:{g}{f}:{direction}:{'black' if b.black else 'white'}", 1)
    if "lattice" in fam:
        dxw = (x14(b.pitch) - x14(a.pitch)) / 2
        _push(terms, "latticeStep", abs(dxw - (f - g)))
        _push(terms, "levelChange", 1 if a.black != b.black else 0)
    if "geo" in fam:
        _push(terms, f"cm:{g}{f}:{direction}", abs(x_mm(b.midi) - x_mm(a.midi)) / 10)
    if g == f:
        if not b.rest_before:
            _push(terms, "hop", 2 if b.ioi < ctx.hop_fast else 0.5)
        return terms
    s = span_points(ctx, i, g, f)
    _push(terms, "stretch", s[0])
    _push(terms, "smallSpan", s[1])
    _push(terms, "largeSpan", s[2])
    _push(terms, "beyondPractical", s[3])
    if "timing" in fam and b.ioi < ctx.hop_fast:
        _push(terms, "stretchFast", s[0])
    if "rest" in fam and b.rest_before:
        _push(terms, "restRelax:stretch", s[0])
        _push(terms, "restRelax:smallSpan", s[1])
        _push(terms, "restRelax:largeSpan", s[2])
        _push(terms, "restRelax:beyondPractical", s[3])
    if g == 3 and f == 4:
        _push(terms, "threeToFour", 1)
    if (g == 3 and f == 4) or (g == 4 and f == 3):
        note_of_3 = a if g == 3 else b
        note_of_4 = a if g == 4 else b
        if not note_of_3.black and note_of_4.black:
            _push(terms, "fourOnBlack", 1)
    if (g == 1 or f == 1) and (f - g) * i < 0:
        lower = b if i < 0 else a
        upper = a if i < 0 else b
        lower_finger = f if i < 0 else g
        upper_finger = g if i < 0 else f
        if lower.black == upper.black:
            _push(terms, "thumbPassing", 1)
        elif (not lower.black) and lower_finger != 1 and upper.black and upper_finger == 1:
            _push(terms, "thumbPassing", 3)
    return terms


def triple_terms(ctx: Ctx, a: SeqNote, h: int, b: SeqNote, g: int, c: SeqNote, f: int) -> list:
    terms: list = []
    if a.slice == b.slice or b.slice == c.slice or a.slice == c.slice:
        return terms
    t = ctx.tables
    i13 = c.pitch - a.pitch
    between = min(a.pitch, c.pitch) < b.pitch < max(a.pitch, c.pitch)
    if c.pitch == a.pitch:
        if h != f:
            _push(terms, "positionChangeCount", 1)
    else:
        max_c = span(t, "maxComf", h, f)
        min_c = span(t, "minComf", h, f)
        if i13 > max_c or i13 < min_c:
            outside_prac = i13 > span(t, "maxPrac", h, f) or i13 < span(t, "minPrac", h, f)
            _push(terms, "positionChangeCount", 2 if (g == 1 and between and outside_prac) else 1)
            _push(terms, "positionChangeSize", _over(i13, max_c) + _under(i13, min_c))
    if len({h, g, f}) == 3 and h + g + f == 12 and min(h, g, f) == 3:
        _push(terms, "threeFourFive", 1)
    if h == f and a.pitch != c.pitch and between:
        _push(terms, "sameFingerPivot", 1)
    return terms


# --- feature sets and tensors -----------------------------------------------------------------

class FeatureSet:
    """An ordered list of feature ids made of whole families (``rules`` is always first)."""

    def __init__(self, families: list[str] | tuple[str, ...] = ("rules",), profile: str = "large"):
        fams = ["rules"] + [f for f in FAMILY_ORDER if f in families and f != "rules"]
        unknown = set(families) - set(FAMILY_ORDER)
        if unknown:
            raise KeyError(f"unknown feature families {sorted(unknown)}")
        self.families = tuple(fams)
        self.ids: list[str] = [i for fam in fams for i in FAMILY_IDS[fam]]
        self.index = {i: k for k, i in enumerate(self.ids)}
        self.n = len(self.ids)
        self.profile = profile
        self.ctx = Ctx(tables=tables_for_profile(profile), families=frozenset(fams))
        self.penalty_mask = np.array([i in PENALTY_RULES for i in self.ids], dtype=bool)

    @property
    def key(self) -> str:
        return "+".join(self.families) + f"@{self.profile}"

    def parncutt_weights(self) -> np.ndarray:
        w = np.zeros(self.n, dtype=np.float64)
        for rid, v in PARNCUTT_WEIGHTS.items():
            w[self.index[rid]] = v
        return w

    def weights_from_dict(self, d: dict) -> np.ndarray:
        w = np.zeros(self.n, dtype=np.float64)
        for rid, v in d.items():
            if rid in self.index:
                w[self.index[rid]] = v
        return w

    def weights_to_dict(self, w: np.ndarray) -> dict:
        return {rid: float(round(float(w[k]), 6)) for k, rid in enumerate(self.ids)}


@dataclass
class Tensors:
    """Sparse per-slot features of one hand sequence.

    ``u_idx[i, f, k]`` / ``u_val`` list the (feature index, points) pairs of finger ``f`` (0..4)
    on note ``i``; ``p_*[i, g*5+f, k]`` those of the pair (g on i-1, f on i) for ``i >= 1``;
    ``t_*[i, h*25+g*5+f, k]`` those of the triple for ``i >= 2``. Padding entries point at
    index ``n_features`` (a zero weight slot). ``p_hard``/``t_hard`` mark the slots the solver
    penalises (+Infinity, or 1000 in soft mode) for a structural reason (within-slice order,
    same finger on a still-sounding note); ``chord_free`` slots (same finger in a slice of more
    than five notes) are free of charge, as in solve.ts.
    """

    n: int
    u_idx: np.ndarray
    u_val: np.ndarray
    p_idx: np.ndarray
    p_val: np.ndarray
    t_idx: np.ndarray
    t_val: np.ndarray
    p_hard: np.ndarray
    t_hard: np.ndarray


HELD_EPS = 1e-3


def sounding(a: SeqNote, b: SeqNote) -> bool:
    return a.slice != b.slice and a.offset > b.onset + HELD_EPS


def _pack(rows: list[list[tuple[int, float]]], width: int, pad: int):
    k = max((len(r) for r in rows), default=0)
    k = max(k, 1)
    idx = np.full((len(rows), k), pad, dtype=np.int32)
    val = np.zeros((len(rows), k), dtype=np.float32)
    for r, terms in enumerate(rows):
        for c, (j, v) in enumerate(terms):
            idx[r, c] = j
            val[r, c] = v
    return idx.reshape(-1, width, k), val.reshape(-1, width, k)


def build_tensors(seq: list[SeqNote], fs: FeatureSet, hand: str = "R", templates: bool = True) -> Tensors:
    """Sparse feature tensors of one hand sequence (``hand`` selects the textbook templates)."""
    from .templates import template_fingers

    n = len(seq)
    ctx = fs.ctx
    ix = fs.index
    pad = fs.n
    tmpl = template_fingers(seq, hand) if templates else [0] * n
    slice_size: dict[int, int] = {}
    for m in seq:
        slice_size[m.slice] = slice_size.get(m.slice, 0) + 1

    u_rows: list[list[tuple[int, float]]] = []
    for i, m in enumerate(seq):
        prev = seq[i - 1] if i >= 1 else None
        nxt = seq[i + 1] if i + 1 < n else None
        for f in range(1, 6):
            row = [(ix[r], p) for r, p in unary_terms(ctx, m, f, prev, nxt)]
            if tmpl[i] == f:
                row.append((ix["template"], -1.0))
            u_rows.append(row)
    u_idx, u_val = _pack(u_rows, 5, pad)

    p_rows: list[list[tuple[int, float]]] = []
    p_hard = np.zeros((n, 25), dtype=bool)
    for i in range(n):
        if i == 0:
            p_rows.extend([[] for _ in range(25)])
            continue
        a, b = seq[i - 1], seq[i]
        same = a.slice == b.slice
        big = slice_size[b.slice] > 5
        for g in range(1, 6):
            for f in range(1, 6):
                if same and f == g and big:
                    p_rows.append([])  # free, uncharged
                    continue
                if (not same) and g == f and sounding(a, b):
                    # solve.ts returns the penalty alone for this slot (no pair terms)
                    p_rows.append([])
                    p_hard[i, (g - 1) * 5 + (f - 1)] = True
                    continue
                terms = pair_terms(ctx, a, g, b, f)
                p_rows.append([(ix[r], p) for r, p in terms])
                if same and f <= g:
                    p_hard[i, (g - 1) * 5 + (f - 1)] = True  # penalty plus the chord terms
    p_idx, p_val = _pack(p_rows, 25, pad)

    t_rows: list[list[tuple[int, float]]] = []
    t_hard = np.zeros((n, 125), dtype=bool)
    for i in range(n):
        if i < 2:
            t_rows.extend([[] for _ in range(125)])
            continue
        a, b, c = seq[i - 2], seq[i - 1], seq[i]
        for h in range(1, 6):
            for g in range(1, 6):
                for f in range(1, 6):
                    if h == f and (sounding(a, c) or (a.slice == c.slice and slice_size[c.slice] <= 5)):
                        # penalty alone, no triple terms (solve.ts)
                        t_rows.append([])
                        t_hard[i, (h - 1) * 25 + (g - 1) * 5 + (f - 1)] = True
                        continue
                    terms = triple_terms(ctx, a, h, b, g, c, f)
                    t_rows.append([(ix[r], p) for r, p in terms])
    t_idx, t_val = _pack(t_rows, 125, pad)
    return Tensors(n, u_idx, u_val, p_idx, p_val, t_idx, t_val, p_hard, t_hard)


def costs(t: Tensors, w: np.ndarray):
    """Unweighted-by-constraints cost tensors ``(Cu (n,5), Cp (n,5,5), Ct (n,5,5,5))``."""
    wp = np.append(w, 0.0)
    cu = (wp[t.u_idx] * t.u_val).sum(-1)
    cp = (wp[t.p_idx] * t.p_val).sum(-1).reshape(t.n, 5, 5)
    ct = (wp[t.t_idx] * t.t_val).sum(-1).reshape(t.n, 5, 5, 5)
    return cu, cp, ct


def path_features(t: Tensors, fingers: np.ndarray, n_features: int) -> np.ndarray:
    """Phi(path): points per feature summed along a path of fingers 1..5 (unknown-free)."""
    f0 = np.asarray(fingers, dtype=np.int64) - 1
    n = t.n
    i = np.arange(n)
    idx = [t.u_idx[i, f0].ravel()]
    val = [t.u_val[i, f0].ravel()]
    if n >= 2:
        j = np.arange(1, n)
        slot = f0[:-1] * 5 + f0[1:]
        idx.append(t.p_idx[j, slot].ravel())
        val.append(t.p_val[j, slot].ravel())
    if n >= 3:
        j = np.arange(2, n)
        slot = f0[:-2] * 25 + f0[1:-1] * 5 + f0[2:]
        idx.append(t.t_idx[j, slot].ravel())
        val.append(t.t_val[j, slot].ravel())
    all_idx = np.concatenate(idx)
    all_val = np.concatenate(val).astype(np.float64)
    return np.bincount(all_idx, weights=all_val, minlength=n_features + 1)[:n_features]


def path_hard_violations(t: Tensors, fingers: np.ndarray) -> int:
    """Number of structurally penalised pair/triple slots along a path."""
    f0 = np.asarray(fingers, dtype=np.int64) - 1
    n = t.n
    v = 0
    if n >= 2:
        j = np.arange(1, n)
        v += int(t.p_hard[j, f0[:-1] * 5 + f0[1:]].sum())
    if n >= 3:
        j = np.arange(2, n)
        v += int(t.t_hard[j, f0[:-2] * 25 + f0[1:-1] * 5 + f0[2:]].sum())
    return v
