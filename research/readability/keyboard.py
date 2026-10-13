"""Keyboard geometry for the readability study.

Uses Balliauw's 14-unit octave (literature survey section 1.2): every white key sits on an even
unit, every black key on an odd unit, and two imaginary black keys fill the E-F and B-C gaps so
that ``x14 / 2`` is the white-key column with half-key resolution for black keys. The implied
hand anchor of literature section 6.6 is ``anchor = x14(pitch) / 2 - (finger - 1)`` for the right
hand (the column the thumb would occupy in a relaxed five-finger position); the left hand is
mirrored, ``anchor = x14(pitch) / 2 + (finger - 1)``.
"""
from __future__ import annotations

# pitch class -> unit inside the 14-unit octave
_PC_TO_X14 = {0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, 10: 11, 11: 12}
_BLACK_PCS = frozenset({1, 3, 6, 8, 10})

RH = 0
LH = 1


def x14(pitch: int) -> int:
    """14 units per octave; C4 (MIDI 60) -> 70."""
    return 14 * (pitch // 12) + _PC_TO_X14[pitch % 12]


def column(pitch: int) -> float:
    """White-key column with half-key resolution: ``x14 / 2`` (C4 -> 35.0, C#4 -> 35.5)."""
    return x14(pitch) / 2.0


def white_column(pitch: int) -> int:
    """Nakamura-style white-key column: a black key shares the column of the white key below."""
    return x14(pitch) // 2


def is_black(pitch: int) -> bool:
    return pitch % 12 in _BLACK_PCS


def anchor(pitch: int, finger: int, hand: int) -> float:
    """Implied hand anchor (thumb column) for ``finger`` (1..5) on ``pitch``.

    RH: ``column - (finger - 1)``; LH (mirrored): ``column + (finger - 1)``.
    """
    if not 1 <= finger <= 5:
        raise ValueError(f"finger out of range: {finger}")
    c = column(pitch)
    return c - (finger - 1) if hand == RH else c + (finger - 1)


def finger_from_anchor(pitch: int, anchor_value: float, hand: int) -> float:
    """The (possibly fractional) finger that keeps ``anchor_value`` on ``pitch``.

    RH: ``column - anchor + 1``; LH: ``anchor - column + 1``. Callers decide how to round
    (the player model floors black keys onto the finger of the white key below).
    """
    c = column(pitch)
    return (c - anchor_value + 1) if hand == RH else (anchor_value - c + 1)


def white_distance(p1: int, p2: int) -> float:
    """Signed distance in white-key columns from ``p1`` to ``p2`` (half units for black keys)."""
    return column(p2) - column(p1)
