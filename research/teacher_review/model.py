"""Passage model shared by the renderer, the fault injector and the scorer.

A :class:`Passage` is a short excerpt (two to eight bars) with one event list per hand.
An :class:`Event` is a note, a chord (several pitches with one onset) or a rest. Every
sounding note has a stable id ``R7`` / ``L3`` (hand letter + 1-based index in onset order,
chord notes numbered low to high); objections and injected faults refer to these ids.

Time is expressed in quarter notes from the start of the piece (``onset_q``), so that bars
and beats can be derived from the meter and the bar-1 offset without any float drift, and
in seconds (``onset_s``) so that "at speed" rules can use real inter-onset intervals.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from fractions import Fraction
from typing import Iterable, Iterator

BLACK_PCS = {1, 3, 6, 8, 10}
PC_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]
NAME_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def is_black(pitch: int) -> bool:
    return pitch % 12 in BLACK_PCS


def pitch_name(pitch: int) -> str:
    """MIDI number -> ``C4`` / ``F#3`` / ``Bb5`` (PIG v1.2 spelling: sharps except Eb and Bb)."""
    return f"{PC_NAMES[pitch % 12]}{pitch // 12 - 1}"


def parse_pitch(name: str) -> int:
    s = name.strip()
    letter = s[0].upper()
    rest = s[1:]
    acc = 0
    while rest and rest[0] in "#b":
        acc += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    return 12 * (int(rest) + 1) + NAME_PC[letter] + acc


def hand_sign(hand: str) -> int:
    """+1 for the right hand, -1 for the left: ``(p2 - p1) * hand_sign`` is positive when the
    motion goes from the thumb side towards the fifth finger ("outward")."""
    return 1 if hand == "R" else -1


@dataclass
class Event:
    hand: str                      # "R" or "L"
    onset_q: Fraction              # quarter notes from the start of the piece
    onset_s: float                 # seconds (from the source file)
    dur_q: Fraction                # sounding duration in quarter notes (quantised)
    pitches: list[int] = field(default_factory=list)   # ascending; empty = rest
    fingers: list[int] = field(default_factory=list)   # unsigned 1..5 aligned with pitches; 0 = unknown
    ids: list[str] = field(default_factory=list)       # "R7" ... aligned with pitches
    source_ids: list[str] = field(default_factory=list)  # ids in the source file (PIG note ids)

    @property
    def is_rest(self) -> bool:
        return not self.pitches

    @property
    def is_chord(self) -> bool:
        return len(self.pitches) > 1

    @property
    def span(self) -> int:
        return (self.pitches[-1] - self.pitches[0]) if self.pitches else 0

    def copy(self) -> "Event":
        return replace(self, pitches=list(self.pitches), fingers=list(self.fingers),
                       ids=list(self.ids), source_ids=list(self.source_ids))


@dataclass
class Passage:
    """One excerpt. ``events[hand]`` is in onset order and may contain rests."""

    passage_id: str
    composer: str
    style: str                          # free text shown to the reviewer ("two-part invention")
    meter: tuple[int, int]              # (numerator, denominator)
    tempo_qpm: int                      # quarter notes per minute (estimated for PIG)
    bar_first: int                      # first bar number of the excerpt
    bar_last: int
    events: dict[str, list[Event]] = field(default_factory=dict)
    target_hands: list[str] = field(default_factory=list)   # hands whose fingering is reviewed
    notes_meta: dict = field(default_factory=dict)          # anything the harness wants to keep

    # ---- derived helpers -------------------------------------------------------------
    @property
    def beat_q(self) -> Fraction:
        """Length of one notated beat in quarter notes (dotted quarter in 6/8 and 12/8)."""
        num, den = self.meter
        if den == 8 and num % 3 == 0 and num >= 6:
            return Fraction(3, 2)
        return Fraction(4, den)

    @property
    def beats_per_bar(self) -> int:
        num, den = self.meter
        if den == 8 and num % 3 == 0 and num >= 6:
            return num // 3
        return num

    @property
    def bar_q(self) -> Fraction:
        return self.beat_q * self.beats_per_bar

    def bar_beat(self, onset_q: Fraction) -> tuple[int, Fraction]:
        """(bar number, 1-based beat within the bar) for a time in quarters from the piece
        start, where bar 1 starts at ``self.notes_meta.get('bar1_q', 0)``."""
        bar1 = Fraction(self.notes_meta.get("bar1_q", 0))
        rel = onset_q - bar1
        bar = int(rel // self.bar_q) + 1
        beat = (rel - (bar - 1) * self.bar_q) / self.beat_q + 1
        return bar, beat

    def sounding(self, hand: str) -> list[Event]:
        return [e for e in self.events.get(hand, []) if not e.is_rest]

    def notes(self, hand: str) -> list[tuple[str, int, int, Event, int]]:
        """Flat list of (id, pitch, finger, event, index-in-event) for a hand in id order."""
        out = []
        for e in self.sounding(hand):
            for k, (i, p, f) in enumerate(zip(e.ids, e.pitches, e.fingers)):
                out.append((i, p, f, e, k))
        return out

    def finger_string(self, hand: str) -> str:
        return " ".join(str(f) for _, _, f, _, _ in self.notes(hand))

    def finger_map(self, hand: str) -> dict[str, int]:
        return {i: f for i, _, f, _, _ in self.notes(hand)}

    def set_finger(self, note_id: str, finger: int) -> None:
        hand = note_id[0]
        for e in self.events[hand]:
            if note_id in e.ids:
                e.fingers[e.ids.index(note_id)] = int(finger)
                return
        raise KeyError(note_id)

    def copy(self) -> "Passage":
        return replace(self, events={h: [e.copy() for e in evs] for h, evs in self.events.items()},
                       target_hands=list(self.target_hands), notes_meta=dict(self.notes_meta),
                       meter=tuple(self.meter))


def number_events(events: Iterable[Event], hand: str) -> list[Event]:
    """Assign ids ``<hand><n>`` to every sounding note in onset order, chord notes low to high."""
    out = []
    n = 0
    for e in events:
        e = e.copy()
        if e.is_rest:
            e.ids = []
        else:
            order = sorted(range(len(e.pitches)), key=lambda k: e.pitches[k])
            e.pitches = [e.pitches[k] for k in order]
            e.fingers = [e.fingers[k] for k in order] if e.fingers else [0] * len(e.pitches)
            e.source_ids = [e.source_ids[k] for k in order] if e.source_ids else []
            e.ids = []
            for _ in e.pitches:
                n += 1
                e.ids.append(f"{hand}{n}")
        out.append(e)
    return out


def iter_note_ids(passage: Passage, hand: str) -> Iterator[str]:
    for i, _, _, _, _ in passage.notes(hand):
        yield i
