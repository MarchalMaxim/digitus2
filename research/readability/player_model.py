"""Deterministic forward-reader player model for the readability study.

The model reads one hand of a score from left to right and, for every note without a visible
digit, either infers the finger a reader would play or gives up (the reader would need a digit
there). It is the operational meaning of "a printed digit is redundant": a digit is redundant
when the reader infers the editor's finger without it.

State while reading one hand:

* ``ref``: the visible (printed and seen) notes of the last event that had a visible digit,
  as ``(pitch, finger)`` pairs (the hand position anchor; a single note in most cases);
* ``prev``: the notes of the previous event whose finger is known (printed or inferred).

Direction sign ``s = +1`` for the right hand and ``-1`` for the left hand (in the left hand,
moving up in pitch moves towards the thumb, i.e. to a lower finger number).
``steps(a, b) = round_half_away_from_zero((b - a) / 2)`` converts semitones to scale steps.

Rules for a note ``q`` (first that applies wins):

* ``R0`` printed: a visible digit is taken as is; the event becomes ``ref``.
* ``textbook`` (only in ``rules_plus_textbook``): the note lies in a run of at least four
  single-note events that matches a window of a textbook scale/arpeggio/chromatic pattern and
  the visible digits inside that run agree with the pattern (see :mod:`readability.textbook`).
* ``R1`` repeated note: ``q == prev.pitch`` -> ``prev.finger``.
* ``R2`` stepwise: ``1 <= |q - prev.pitch| <= 2`` -> ``prev.finger + s*sign(q - prev.pitch)``;
  falls through when the result leaves 1..5.
* ``R3`` position continuation: ``ref.finger + s*steps(ref.pitch, q)``; not inferable outside 1..5.
* ``R4`` chord fill (events with two or more notes): a visible chord note is the reference for
  the others, ``f_vis + s*steps(p_vis, q)``; without a visible digit in the chord every note is
  placed from ``ref`` as in R3 (reported as ``R4_ref``). Notes outside 1..5 and inferred notes
  that duplicate another finger of the chord are not inferable. R1/R2 do not apply to chords.
* ``none``: not inferable.

``prev`` and ``ref`` are matched to ``q`` by the nearest pitch (ties to the lower pitch, the
same convention as :mod:`readability.features`). Inferred fingers propagate through ``prev``
but never become ``ref``. Grace notes are ordinary single-note events.

Two comparison models: ``copy_previous`` (every unprinted note gets the finger of the last
visible digit of the hand, read in onset-then-pitch order) and ``rules_plus_textbook``.
"""
from __future__ import annotations

import bisect
from collections import Counter
from typing import Callable, Iterable

from readability import keyboard as K
from readability.corpus import RH, NoteRec, Part, events
from readability.textbook import pick as _tb_pick

MODELS = ("copy_previous", "rules", "rules_plus_textbook")
RULES = ("R0", "textbook", "R1", "R2", "R3", "R4", "R4_ref", "copy", "none")

Inference = dict[int, tuple[int | None, str]]   # note idx -> (finger or None, rule)


def steps(a: int, b: int) -> int:
    """Semitones from ``a`` to ``b`` as scale steps: ``round_half_away_from_zero((b - a) / 2)``."""
    d = b - a
    m = (abs(d) + 1) // 2
    return m if d >= 0 else -m


def column_steps(a: int, b: int) -> int:
    """Sensitivity variant: white-key column difference (keyboard.column), rounded half away from zero.

    Differs from :func:`steps` on white keys for the diminished fifth (B-F: 3 vs 4) and the minor
    sixth (E-C, A-F, B-G: 4 vs 5), where :func:`steps` undercounts the white-key columns.
    """
    d = K.column(b) - K.column(a)
    m = int(abs(d) + 0.5)
    return m if d >= 0 else -m


def _nearest(pairs: list[tuple[int, int]], pitch: int) -> tuple[int, int]:
    return min(pairs, key=lambda pf: (abs(pf[0] - pitch), pf[0]))


class HandReader:
    """One hand's events, pre-computed once so that many visible sets can be read cheaply."""

    def __init__(self, notes: Iterable[NoteRec], textbook_index=None,
                 step_fn: Callable[[int, int], int] = steps):
        notes = list(notes)
        hands = {n.hand for n in notes}
        if len(hands) > 1:
            raise ValueError("HandReader expects the notes of one hand")
        self.hand = notes[0].hand if notes else RH
        self.s = 1 if self.hand == RH else -1
        self.step_fn = step_fn
        self.evs = events(notes)
        self.ev_of = {n.idx: e for e, ev in enumerate(self.evs) for n in ev}
        self.printed = [n for ev in self.evs for n in ev if n.finger > 0]
        self.printed_events = sorted({self.ev_of[n.idx] for n in self.printed})
        self.tb_cands = (textbook_index.candidates(self.evs, self.hand)
                         if textbook_index is not None else None)

    # ----------------------------------------------------------------------------------
    def infer(self, visible: set[int], model: str = "rules", start: int = 0,
              stop: int | None = None) -> Inference:
        """Read events ``start .. stop-1`` (fresh state at ``start``) with ``visible`` digits seen."""
        stop = len(self.evs) if stop is None else stop
        if model == "copy_previous":
            return self._copy(visible, start, stop)
        if model == "rules":
            return self._rules(visible, start, stop, False)
        if model == "rules_plus_textbook":
            if self.tb_cands is None:
                raise ValueError("rules_plus_textbook needs a textbook index")
            return self._rules(visible, start, stop, True)
        raise ValueError(f"unknown model {model!r}")

    def start_for(self, e: int) -> int:
        """Event to restart reading from when the digit(s) of event ``e`` are hidden.

        The state after an event with a visible digit does not depend on anything before it, so
        reading can restart at the last printed event before ``e`` (all printed digits other than
        the hidden one are visible in leave-one-out).
        """
        k = bisect.bisect_left(self.printed_events, e) - 1
        return self.printed_events[k] if k >= 0 else 0

    def leave_one_out(self, model: str = "rules") -> Inference:
        """Hide each printed digit alone (every other one visible) and read it; idx -> result."""
        visible = {n.idx for n in self.printed}
        out: Inference = {}
        for n in self.printed:
            e = self.ev_of[n.idx]
            visible.discard(n.idx)
            try:
                res = self.infer(visible, model, start=self.start_for(e), stop=e + 1)
            finally:
                visible.add(n.idx)
            out[n.idx] = res[n.idx]
        return out

    # ----------------------------------------------------------------------------------
    def _copy(self, visible: set[int], start: int, stop: int) -> Inference:
        out: Inference = {}
        last = None
        for e in range(start, stop):
            for n in self.evs[e]:
                if n.finger > 0 and n.idx in visible:
                    last = n.finger
                    out[n.idx] = (n.finger, "R0")
                else:
                    out[n.idx] = (last, "copy") if last else (None, "none")
        return out

    def _single(self, n: NoteRec, e: int, ref, prev, visible: set[int], use_tb: bool):
        q = n.pitch
        if use_tb and self.tb_cands[e]:
            f = _tb_pick(self.tb_cands[e], e, visible)
            if f is not None:
                return f, "textbook"
        if prev:
            pp, pf = _nearest(prev, q)
            d = q - pp
            if d == 0:
                return pf, "R1"
            if -2 <= d <= 2:
                f = pf + self.s * (1 if d > 0 else -1)
                if 1 <= f <= 5:
                    return f, "R2"
        if ref:
            rp, rf = _nearest(ref, q)
            f = rf + self.s * self.step_fn(rp, q)
            if 1 <= f <= 5:
                return f, "R3"
        return None, "none"

    def _rules(self, visible: set[int], start: int, stop: int, use_tb: bool) -> Inference:
        s, stp = self.s, self.step_fn
        out: Inference = {}
        ref: list[tuple[int, int]] | None = None
        prev: list[tuple[int, int]] | None = None
        for e in range(start, stop):
            ev = self.evs[e]
            if len(ev) == 1:
                n = ev[0]
                if n.finger > 0 and n.idx in visible:
                    f, rule = n.finger, "R0"
                    ref = [(n.pitch, f)]
                else:
                    f, rule = self._single(n, e, ref, prev, visible, use_tb)
                out[n.idx] = (f, rule)
                prev = [(n.pitch, f)] if f else None
                continue
            # chord (R4)
            vis = [(n.pitch, n.finger) for n in ev if n.finger > 0 and n.idx in visible]
            res: Inference = {}
            for n in ev:
                if n.finger > 0 and n.idx in visible:
                    res[n.idx] = (n.finger, "R0")
                    continue
                if vis:
                    vp, vf = _nearest(vis, n.pitch)
                    f, rule = vf + s * stp(vp, n.pitch), "R4"
                elif ref:
                    rp, rf = _nearest(ref, n.pitch)
                    f, rule = rf + s * stp(rp, n.pitch), "R4_ref"
                else:
                    res[n.idx] = (None, "none")
                    continue
                res[n.idx] = (f, rule) if 1 <= f <= 5 else (None, "none")
            counts = Counter(f for f, _ in res.values() if f)
            for n in ev:
                f, rule = res[n.idx]
                if f and rule != "R0" and counts[f] > 1:
                    res[n.idx] = (None, "none")
            out.update(res)
            if vis:
                ref = vis
            known = [(n.pitch, res[n.idx][0]) for n in ev if res[n.idx][0]]
            prev = known or None
        return out


# ---------------------------------------------------------------------------------------
# Convenience wrappers
# ---------------------------------------------------------------------------------------

def infer_hand(notes: list[NoteRec], visible: set[int], model: str = "rules", textbook=None,
               step_fn: Callable[[int, int], int] = steps) -> Inference:
    """Read one hand; ``visible`` = idx of the printed digits the reader sees. idx -> (finger|None, rule)."""
    if not notes:
        return {}
    return HandReader(notes, textbook, step_fn).infer(visible, model)


def infer_part(part: Part, visible: set[int], model: str = "rules", textbook=None,
               step_fn: Callable[[int, int], int] = steps) -> Inference:
    out: Inference = {}
    for hand in (0, 1):
        out.update(infer_hand(part.hand_notes(hand), visible, model, textbook, step_fn))
    return out


def naive_leave_one_out(reader: HandReader, model: str = "rules") -> Inference:
    """Reference implementation of :meth:`HandReader.leave_one_out` (full re-read per digit)."""
    visible = {n.idx for n in reader.printed}
    out: Inference = {}
    for n in reader.printed:
        out[n.idx] = reader.infer(visible - {n.idx}, model)[n.idx]
    return out
