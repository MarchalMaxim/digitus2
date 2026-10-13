"""PIG adapter: turn the 30 PIG test pieces into :class:`Passage` windows.

PIG files carry no meter and no bar lines, only synthesised onset/offset seconds (with a few
milliseconds of jitter and ornament notes off the grid). This module

* fixes the meter per piece (``PIECES``, from the scores; verified against the timing),
* estimates the quarter-note length and the time of bar 1 from the file (``estimate_grid``),
  with diagnostics so that a human can check the first bars against the score,
* quantises onsets and durations to a 1/24-quarter grid, merges simultaneous notes of one hand
  into chords, inserts rests, and numbers notes per hand,
* aligns every annotator's fingers and the authors' FHMM3 output to the same notes.

Bar numbers are therefore *estimated* for PIG passages (the report says so); with MusicXML
input they are exact and this module is not needed.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

from fingering_eval.datasets import DATA
from fingering_eval.pig_io import PigFile, read_pig, read_pig_list_csv

from .model import Event, Passage, number_events

GRID = 24  # subdivisions of a quarter for onset quantisation (16ths, 32nds, triplets)

# meter, style shown to the reviewer, position of the first note in quarters relative to bar 1
# beat 1 (negative = anacrusis), from the scores. ``check`` notes what the timing diagnostics
# showed (see research/teacher_review/results/grid_diagnostics.json).
PIECES: dict[str, dict] = {
    "001": {"meter": (4, 4), "style": "two-part invention", "first_pos": 0.25},
    "002": {"meter": (3, 4), "style": "two-part invention", "first_pos": 0.5},
    "003": {"meter": (4, 4), "style": "prelude", "first_pos": 0},
    "004": {"meter": (4, 4), "style": "fugue", "first_pos": 0},
    "005": {"meter": (4, 4), "style": "fugue", "first_pos": 0},
    "006": {"meter": (3, 8), "style": "corrente from a partita", "first_pos": 0},
    "007": {"meter": (4, 4), "style": "allemande from a suite", "first_pos": -0.25},
    "008": {"meter": (3, 4), "style": "sarabande from a suite", "first_pos": 0},
    "009": {"meter": (3, 8), "style": "prelude from a suite", "first_pos": 0},
    "010": {"meter": (3, 4), "style": "variation", "first_pos": 0},
    "011": {"meter": (3, 4), "style": "sonata, first movement", "first_pos": 0},
    "012": {"meter": (4, 4), "style": "sonata, first movement", "first_pos": 0},
    "013": {"meter": (2, 4), "style": "sonata, first movement", "first_pos": 0},
    "014": {"meter": (3, 4), "style": "sonata, slow movement", "first_pos": 0},
    "015": {"meter": (2, 4), "style": "sonata, rondo finale", "first_pos": 0},
    "016": {"meter": (3, 4), "style": "sonata, first movement", "first_pos": 0},
    "017": {"meter": (4, 4), "style": "sonata, first movement", "first_pos": 0},
    "018": {"meter": (3, 4), "style": "sonata, first movement", "first_pos": 0},
    "019": {"meter": (4, 4), "style": "sonata, slow movement", "first_pos": 0},
    "020": {"meter": (3, 4), "style": "sonata, slow movement", "first_pos": 0},
    "021": {"meter": (6, 8), "style": "ballade", "first_pos": 0},
    "022": {"meter": (2, 4), "style": "etude, slow", "first_pos": 0},
    "023": {"meter": (12, 8), "style": "nocturne", "first_pos": 0},
    "024": {"meter": (3, 4), "style": "mazurka", "first_pos": 0},
    "025": {"meter": (3, 4), "style": "waltz", "first_pos": 0},
    "026": {"meter": (3, 4), "style": "polonaise", "first_pos": 0},
    "027": {"meter": (3, 4), "style": "waltz", "first_pos": 0},
    "028": {"meter": (6, 8), "style": "prelude", "first_pos": 0},
    "029": {"meter": (3, 4), "style": "scherzo", "first_pos": 0},
    "030": {"meter": (4, 4), "style": "sonata, first movement", "first_pos": 0},
}


def quarters_per_bar(meter: tuple[int, int]) -> Fraction:
    return Fraction(meter[0] * 4, meter[1])


# ---------------------------------------------------------------------------------------
# grid estimation
# ---------------------------------------------------------------------------------------

@dataclass
class Grid:
    quarter_s: float
    bar1_s: float
    tempo_qpm: int
    residual: float         # mean distance of IOIs to the nearest 16th / triplet-8th grid point (16th units)
    align: float            # share of onsets within 20% of a 16th of the 16th or triplet-8th grid
    mode_ioi: float
    quarter_from_bars: float
    implied_bars: float     # bars covered by the quantised piece
    flags: list[str] = field(default_factory=list)


def _resid(iois: list[float], quarter: float) -> float:
    """Mean distance (in 16ths) of each IOI to the nearest point of the 16th grid or of the
    triplet-eighth grid; IOIs longer than two quarters are ignored."""
    tot = 0.0
    n = 0
    for d in iois:
        if d > 2 * quarter:
            continue
        r16 = d / (quarter / 4)
        r12 = d / (quarter / 3)
        tot += min(abs(r16 - round(r16)), abs(r12 - round(r12)) * 4 / 3)
        n += 1
    return tot / max(1, n)


def _align(onsets: list[float], q: float, phase: float) -> float:
    s16, s12 = q / 4, q / 3
    ok = 0
    for t in onsets:
        r = (t - phase) / s16
        d16 = abs(r - round(r)) * s16
        r = (t - phase) / s12
        d12 = abs(r - round(r)) * s12
        if min(d16, d12) <= 0.2 * s16:
            ok += 1
    return ok / max(1, len(onsets))


# snapping levels for onsets: (grid step in quarters, tolerance in quarters)
SNAP_LEVELS = [(Fraction(1, 4), 0.05), (Fraction(1, 3), 0.04), (Fraction(1, 6), 0.04), (Fraction(1, 8), 0.03)]


def snap_q(x: float) -> Fraction:
    """Quantise a time in quarters: nearest 16th if within 20% of one, else nearest triplet
    eighth, triplet 16th or 32nd within tolerance, else the nearest 1/GRID."""
    for step, tol in SNAP_LEVELS:
        cand = Fraction(round(x / step)) * step
        if abs(float(cand) - x) <= tol:
            return cand
    return Fraction(round(x * GRID), GRID)


def estimate_grid(pf: PigFile, bars: int, meter: tuple[int, int], first_pos: float) -> Grid:
    onsets = sorted(set(round(n.onset, 4) for n in pf.notes))
    end = max(n.offset for n in pf.notes)
    first = onsets[0]
    qpb = float(quarters_per_bar(meter))
    iois = [b - a for a, b in zip(onsets, onsets[1:]) if b - a > 0.02]
    bins = Counter(round(x / 0.005) for x in iois)
    mode = max(bins.items(), key=lambda kv: (kv[1], -kv[0]))[0] * 0.005
    flags: list[str] = []
    q_bars = (end - first) / (bars * qpb - first_pos) if bars else float("nan")
    cands = [mode * m for m in (0.5, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8, 12, 16)]
    q0 = min(cands, key=lambda c: abs(c - q_bars) / q_bars)
    if abs(q0 - q_bars) / q_bars > 0.06:
        flags.append(f"mode-based quarter {q0:.4f} differs from bar-based {q_bars:.4f} by more than 6%")
    best = (float("inf"), q0)
    for k in range(-40, 41):
        q = q0 * (1 + k * 0.002)
        r = _resid(iois, q)
        if r < best[0]:
            best = (r, q)
    resid, q1 = best
    # refine the quarter and find the 16th-grid phase by global alignment
    bestA = (-1.0, q1, first)
    for k in range(-15, 16):
        q = q1 * (1 + k * 0.001)
        for j in range(48):
            phase = first + j / 48 * q / 4
            a = _align(onsets, q, phase)
            if a > bestA[0]:
                bestA = (a, q, phase)
    align, q, phase = bestA
    if align < 0.85:
        flags.append(f"only {align:.0%} of onsets sit on the 16th/triplet grid (jitter or tempo drift)")
    bar1 = first - first_pos * q
    bar1 = phase + round((bar1 - phase) / (q / 4)) * (q / 4)
    implied = float(snap_q((end - bar1) / q)) / qpb
    if bars and abs(implied - bars) > 1.5:
        flags.append(f"quantised length covers {implied:.1f} bars, List.csv says {bars}")
    return Grid(quarter_s=q, bar1_s=bar1, tempo_qpm=int(round(60 / q)), residual=resid, align=align,
                mode_ioi=mode, quarter_from_bars=q_bars, implied_bars=implied, flags=flags)


# ---------------------------------------------------------------------------------------
# piece construction
# ---------------------------------------------------------------------------------------

@dataclass
class PieceData:
    piece_id: str
    composer: str
    title: str
    bars: int
    meter: tuple[int, int]
    style: str
    grid: Grid
    annotation: str                            # chosen annotator slot ("1", "2", ...)
    annotators: dict[str, str]                 # slot -> initials
    events: dict[str, list[Event]]             # per hand, numbered R1.., with the chosen annotator's fingers
    all_fingers: dict[str, dict[str, int]]     # source note id -> {slot: unsigned finger} (same hand only)
    fhmm3: dict[str, int | None]               # source note id -> FHMM3 finger (None if hand differs)
    source_hand: dict[str, str]                # source note id -> hand of the chosen annotation

    def bar_of(self, onset_q: Fraction) -> int:
        return int(onset_q // quarters_per_bar(self.meter)) + 1


def _snap_dur(d: Fraction) -> Fraction:
    cands = [Fraction(x) for x in (8, 6, 4, 3, 2, Fraction(3, 2), 1, Fraction(3, 4), Fraction(1, 2),
                                   Fraction(3, 8), Fraction(1, 4), Fraction(3, 16), Fraction(1, 8),
                                   Fraction(2, 3), Fraction(1, 3), Fraction(1, 6))]
    best = min(cands, key=lambda c: abs(float(c - d)))
    if d > 0 and abs(float(best - d)) / float(d) <= 0.34:
        return best
    return max(Fraction(1, GRID), Fraction(round(d * GRID), GRID))


def _quantise(t_s: float, grid: Grid) -> Fraction:
    return snap_q((t_s - grid.bar1_s) / grid.quarter_s)


def pig_test_root() -> Path:
    return DATA / "pig"


def fhmm3_root() -> Path:
    return DATA / "pig_hmm" / "Result_FHMM3"


def annotation_files(piece_id: str, root: Path | None = None) -> dict[str, Path]:
    d = (root or pig_test_root()) / "FingeringFiles"
    out = {}
    for p in sorted(d.glob(f"{piece_id}-*_fingering.txt")):
        slot = p.name.split("-")[1].split("_")[0]
        out[slot] = p
    return out


def build_piece(piece_id: str, annotation: str, root: Path | None = None, grid_override: Grid | None = None) -> PieceData:
    root = root or pig_test_root()
    lst = read_pig_list_csv(root)
    meta = lst[piece_id]
    info = PIECES[piece_id]
    files = annotation_files(piece_id, root)
    if annotation not in files:
        raise KeyError(f"piece {piece_id} has no annotation slot {annotation}; have {sorted(files)}")
    chosen = read_pig(files[annotation])
    others = {slot: read_pig(p) for slot, p in files.items()}
    grid = grid_override or estimate_grid(chosen, meta["bars"], tuple(info["meter"]), info["first_pos"])
    # fingers of every annotator on the same note (by note id; identical note lists per piece)
    all_fingers: dict[str, dict[str, int]] = {}
    source_hand: dict[str, str] = {}
    for n in chosen.notes:
        source_hand[n.id] = n.hand
    for slot, pf in others.items():
        for n in pf.notes:
            if n.hand == source_hand.get(n.id):
                all_fingers.setdefault(n.id, {})[slot] = n.finger_number
    fh = {}
    hp = fhmm3_root() / f"{piece_id}-1_fingering.txt"
    if hp.exists():
        hmm = read_pig(hp)
        assert len(hmm.notes) == len(chosen.notes)
        for a, b in zip(chosen.notes, hmm.notes):
            assert a.spelled_pitch == b.spelled_pitch and a.id == b.id, (piece_id, a, b)
            fh[a.id] = b.finger_number if b.hand == a.hand else None
    # events per hand: quantise, merge chords, insert rests, number
    events: dict[str, list[Event]] = {}
    for hand in ("R", "L"):
        notes = [n for n in chosen.notes if n.hand == hand]
        if not notes:
            continue
        raw: list[Event] = []
        for n in sorted(notes, key=lambda x: (x.onset, x.pitch)):
            oq = _quantise(n.onset, grid)
            dq = _snap_dur(Fraction(max(0.0, n.offset - n.onset) / grid.quarter_s).limit_denominator(GRID * 4))
            if raw and raw[-1].onset_q == oq and abs(raw[-1].onset_s - n.onset) < 0.03:
                raw[-1].pitches.append(n.pitch)
                raw[-1].fingers.append(n.finger_number)
                raw[-1].source_ids.append(n.id)
                raw[-1].dur_q = max(raw[-1].dur_q, dq)
            else:
                if raw and raw[-1].onset_q == oq:
                    # an ornament sits on the same grid point but not at the same time: keep order,
                    # push this note one grid step later so the rendering stays monotone
                    oq = oq + Fraction(1, GRID)
                raw.append(Event(hand, oq, n.onset, dq, [n.pitch], [n.finger_number], [], [n.id]))
        with_rests: list[Event] = []
        for e in raw:
            if with_rests:
                prev = with_rests[-1]
                gap = e.onset_q - (prev.onset_q + prev.dur_q)
                if gap >= Fraction(1, 2):
                    with_rests.append(Event(hand, prev.onset_q + prev.dur_q, prev.onset_s + float(prev.dur_q) * grid.quarter_s,
                                            _snap_dur(gap)))
            with_rests.append(e)
        events[hand] = number_events(with_rests, hand)
    return PieceData(piece_id=piece_id, composer=meta["composer"], title=meta["piece"], bars=meta["bars"],
                     meter=tuple(info["meter"]), style=info["style"], grid=grid, annotation=annotation,
                     annotators=meta["annotators"], events=events, all_fingers=all_fingers, fhmm3=fh,
                     source_hand=source_hand)


# ---------------------------------------------------------------------------------------
# windows
# ---------------------------------------------------------------------------------------

def extract_window(piece: PieceData, bar_first: int, bar_last: int, target_hands: list[str],
                    passage_id: str, fingers: str = "expert") -> Passage:
    """Passage for bars ``bar_first..bar_last`` (inclusive). ``fingers``: ``expert`` (chosen
    annotator), ``fhmm3`` (authors' output; raises if any target-hand note has a different hand
    there) or ``none``. Notes are renumbered R1.. / L1..; ``notes_meta['source']`` maps the new
    ids to PIG note ids."""
    qpb = quarters_per_bar(piece.meter)
    lo = (bar_first - 1) * qpb
    hi = bar_last * qpb
    p = Passage(passage_id=passage_id, composer=piece.composer, style=piece.style, meter=piece.meter,
                tempo_qpm=piece.grid.tempo_qpm, bar_first=bar_first, bar_last=bar_last,
                target_hands=list(target_hands))
    p.notes_meta["bar1_q"] = 0
    p.notes_meta["piece"] = piece.piece_id
    p.notes_meta["annotation"] = piece.annotation
    p.notes_meta["source"] = {}
    for hand, evs in piece.events.items():
        sel = [e for e in evs if lo <= e.onset_q < hi]
        # drop a leading rest
        while sel and sel[0].is_rest:
            sel = sel[1:]
        while sel and sel[-1].is_rest:
            sel = sel[:-1]
        fresh = []
        for e in sel:
            c = e.copy()
            if fingers == "fhmm3" and hand in target_hands:
                fs = []
                for sid in c.source_ids:
                    f = piece.fhmm3.get(sid)
                    if f is None:
                        raise ValueError(f"FHMM3 assigns note {sid} of {piece.piece_id} to the other hand")
                    fs.append(f)
                c.fingers = fs
            elif fingers == "none":
                c.fingers = [0] * len(c.pitches)
            fresh.append(c)
        numbered = number_events(fresh, hand)
        for e in numbered:
            for nid, sid in zip(e.ids, e.source_ids):
                p.notes_meta["source"][nid] = sid
        p.events[hand] = numbered
    return p


def grid_diagnostics(root: Path | None = None, include_notes: bool = False) -> dict[str, dict]:
    """Per piece: grid estimate (and, with ``include_notes``, the first two bars as a quick human
    check; those are PIG-derived and must stay out of the committed results)."""
    out = {}
    for pid in sorted(PIECES):
        files = annotation_files(pid, root)
        slot = sorted(files)[0]
        piece = build_piece(pid, slot, root)
        g = piece.grid
        first_bars = {}
        for hand, evs in piece.events.items():
            first_bars[hand] = [(str(e.onset_q), e.pitches, str(e.dur_q))
                                for e in evs if e.onset_q < 2 * quarters_per_bar(piece.meter) and not e.is_rest][:12]
        out[pid] = {"composer": piece.composer, "title": piece.title, "bars": piece.bars, "meter": piece.meter,
                    "quarter_s": round(g.quarter_s, 4), "tempo_qpm": g.tempo_qpm, "bar1_s": round(g.bar1_s, 3),
                    "residual_16ths": round(g.residual, 3), "align": round(g.align, 3), "mode_ioi": round(g.mode_ioi, 4),
                    "quarter_from_bars": round(g.quarter_from_bars, 4), "implied_bars": round(g.implied_bars, 2),
                    "flags": g.flags,
                    "n_notes": sum(len(e.pitches) for evs in piece.events.values() for e in evs),
                    "fhmm3_other_hand": sum(1 for v in piece.fhmm3.values() if v is None)}
        if include_notes:
            out[pid]["first_two_bars"] = first_bars
    return out
