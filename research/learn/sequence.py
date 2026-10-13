"""Hand sequences, ported from ``packages/engine/src/fingering/sequence.ts`` and
``packages/engine/src/score/build.ts`` (``sortNotes``, ``handEvents``) and the PIG reader
(``packages/engine/src/io/pig/read.ts``).

Conventions reproduced exactly:

* PIG onset/offset seconds are kept verbatim; ticks for grouping are ``round(sec * 960)`` with
  JavaScript's ``Math.round`` (half up).
* Score order: (onsetTick, hand R before L, midi, id string compare); a hand event is a run of
  the hand's notes with the same onset tick.
* Inside an event the notes are ordered by the *viewed* pitch (left hand mirrored: ``124 - midi``)
  then id, i.e. arpeggiated order; one event = one slice (grace notes form their own slice first).
* ``ioi`` = seconds since the previous slice's onset (0 for the first slice, 0.05 after a grace
  slice), ``rest_before`` = every earlier note of the hand has ended more than 1 ms before this
  slice's onset.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

MIRROR_SUM = 124
GRACE_IOI_SEC = 0.05
EPS = 1e-3
TICKS_PER_SECOND = 960  # PIG: divisions 480 at 120 qpm
_BLACK = {1, 3, 6, 8, 10}


def is_black(midi: int) -> bool:
    return (midi % 12) in _BLACK


def mirror_pitch(midi: int) -> int:
    return MIRROR_SUM - midi


def js_round(x: float) -> int:
    """JavaScript ``Math.round``: halves round towards +infinity."""
    return int(math.floor(x + 0.5))


@dataclass
class InputNote:
    """One note as read from a PIG-format file (or built from a textbook entry)."""

    id: str
    onset: float
    offset: float
    midi: int
    hand: str  # 'R' or 'L'
    is_grace: bool = False
    onset_tick: int | None = None
    offset_tick: int | None = None

    def __post_init__(self) -> None:
        if self.onset_tick is None:
            self.onset_tick = js_round(self.onset * TICKS_PER_SECOND)
        if self.offset_tick is None:
            self.offset_tick = js_round(self.offset * TICKS_PER_SECOND)


@dataclass
class SeqNote:
    index: int
    note_id: str
    midi: int
    pitch: int  # mirrored for the left hand
    black: bool
    onset: float
    offset: float
    slice: int
    rest_before: bool
    ioi: float
    is_grace: bool


def sort_notes(notes: list[InputNote]) -> list[InputNote]:
    """``sortNotes`` of build.ts (string comparison of ids like ``localeCompare`` on digits)."""
    return sorted(notes, key=lambda n: (n.onset_tick, 0 if n.hand == "R" else 1, n.midi, n.id))


def hand_events(sorted_notes: list[InputNote], hand: str) -> list[list[InputNote]]:
    events: list[list[InputNote]] = []
    current_tick: int | None = None
    for n in sorted_notes:
        if n.hand != hand:
            continue
        if not events or current_tick != n.onset_tick:
            events.append([])
            current_tick = n.onset_tick
        events[-1].append(n)
    for ev in events:
        ev.sort(key=lambda n: n.midi)
    return events


def build_hand_sequence(notes: list[InputNote], hand: str) -> list[SeqNote]:
    """``buildHandSequence`` for one hand from the piece's notes (any order)."""
    view = (lambda n: mirror_pitch(n.midi)) if hand == "L" else (lambda n: n.midi)
    out: list[SeqNote] = []
    slice_index = 0
    prev_onset: float | None = None
    prev_was_grace = False
    max_offset = -math.inf
    for ev in hand_events(sort_notes(notes), hand):
        groups: list[tuple[list[InputNote], bool]] = []
        graces = [n for n in ev if n.is_grace]
        mains = [n for n in ev if not n.is_grace]
        if graces:
            groups.append((graces, True))
        if mains:
            groups.append((mains, False))
        for group, grace in groups:
            ordered = sorted(group, key=lambda n: (view(n), n.id))
            onset = ordered[0].onset
            ioi = 0.0
            if prev_onset is not None:
                ioi = GRACE_IOI_SEC if prev_was_grace else max(0.0, onset - prev_onset)
            rest_before = len(out) > 0 and max_offset < onset - EPS
            for n in ordered:
                out.append(
                    SeqNote(
                        index=len(out),
                        note_id=n.id,
                        midi=n.midi,
                        pitch=view(n),
                        black=is_black(n.midi),
                        onset=n.onset,
                        offset=n.offset,
                        slice=slice_index,
                        rest_before=rest_before,
                        ioi=ioi,
                        is_grace=n.is_grace,
                    )
                )
            for n in ordered:
                max_offset = max(max_offset, n.offset)
            prev_onset = onset
            prev_was_grace = grace
            slice_index += 1
    return out
