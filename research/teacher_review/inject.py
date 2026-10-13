"""Fault injector: plant fingering faults of known kinds at recorded positions.

Six kinds, each a hard or near-hard rule from the literature checklist (docs/research/
literature.md section 4.3): L01 same finger on two notes of a chord, L05 impossible span
inside a chord, L06 non-thumb crossing, L11 hop at speed, a 3-4-5 run reversed (several
crossings in a row), L08/L10 thumb on a black key between white keys. Faults never overlap
(two notes of margin) and every fault records the notes it changed and the finger values
before and after, so the scorer can check whether a reviewer's objection lands within one
note of the planted position.
"""
from __future__ import annotations

import random
from dataclasses import asdict, dataclass, field

from .model import Event, Passage, hand_sign, is_black

KINDS = ["chord_same_finger", "impossible_span", "nonthumb_crossing", "hop_at_speed",
         "run_345_reversed", "thumb_on_black_between_whites"]

# objection kinds (reviewer vocabulary) that count as naming the planted fault
ACCEPTED_KINDS = {
    "chord_same_finger": {"same_finger_chord", "impossible_span", "crossed_chord"},
    "impossible_span": {"impossible_span", "stretch", "crossed_chord"},
    "nonthumb_crossing": {"nonthumb_crossing", "reversed_run", "crossed_chord"},
    "hop_at_speed": {"hop", "repeated_note"},
    "run_345_reversed": {"reversed_run", "nonthumb_crossing"},
    "thumb_on_black_between_whites": {"thumb_on_black", "thumb_pass_onto_black"},
}

HOP_IOI_S = 0.30        # "at speed": inter-onset interval at or below this (literature L11: 250 ms)
LINE_IOI_S = 1.0        # neighbours further apart than this are not "consecutive" for crossings


@dataclass
class Fault:
    kind: str
    hand: str
    notes: list[str]                 # ids of the notes whose finger changed (or that define the fault)
    anchor: str                      # the position a reviewer should point at
    before: dict[str, int] = field(default_factory=dict)
    after: dict[str, int] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return asdict(self)


def _idx(note_id: str) -> int:
    return int(note_id[1:])


def _sounding_with_index(p: Passage, hand: str) -> list[tuple[int, Event]]:
    return [(i, e) for i, e in enumerate(p.events.get(hand, [])) if not e.is_rest]


def _neighbours(p: Passage, hand: str, i: int) -> tuple[Event | None, Event | None]:
    """Previous and next event in the hand's event list; None if a rest or the edge."""
    evs = p.events[hand]
    prev = evs[i - 1] if i > 0 and not evs[i - 1].is_rest else None
    nxt = evs[i + 1] if i + 1 < len(evs) and not evs[i + 1].is_rest else None
    return prev, nxt


def _free(touched: dict[str, set[int]], hand: str, ids: list[str], margin: int = 2) -> bool:
    t = touched.get(hand, set())
    return all(abs(_idx(i) - k) > margin for i in ids for k in t)


def _touch(touched: dict[str, set[int]], hand: str, ids: list[str]) -> None:
    touched.setdefault(hand, set()).update(_idx(i) for i in ids)


# --- candidate finders: each returns a list of (ids, after-fingers dict, anchor) -------------

def _cands_chord_same_finger(p: Passage, hand: str):
    out = []
    for _, e in _sounding_with_index(p, hand):
        if not e.is_chord or any(f == 0 for f in e.fingers):
            continue
        for k in range(len(e.pitches) - 1):
            a, b = e.pitches[k], e.pitches[k + 1]
            fa, fb = e.fingers[k], e.fingers[k + 1]
            if fa == fb:
                continue
            # the thumb on two close keys ("smear") is a legitimate technique: do not plant that
            if (fa == 1 or fb == 1) and b - a <= 4:
                continue
            ids = [e.ids[k], e.ids[k + 1]]
            out.append((ids, {e.ids[k + 1]: fa}, e.ids[k]))
    return out


def _cands_impossible_span(p: Passage, hand: str):
    out = []
    for _, e in _sounding_with_index(p, hand):
        n = len(e.pitches)
        if n < 2 or n > 4:
            continue
        need = 8 if n <= 3 else 11
        if e.span < need:
            continue
        rh = [2, 3, 4, 5][:n]
        fingers = rh if hand == "R" else list(reversed(rh))
        if fingers == e.fingers:
            continue
        out.append((list(e.ids), {i: f for i, f in zip(e.ids, fingers)}, e.ids[0]))
    return out


def _consecutive_singles(p: Passage, hand: str, n: int):
    """Runs of n consecutive single-note events with no rest between."""
    evs = p.events.get(hand, [])
    out = []
    for i in range(len(evs) - n + 1):
        win = evs[i:i + n]
        if all((not e.is_rest) and (not e.is_chord) for e in win):
            out.append((i, win))
    return out


def _cands_nonthumb_crossing(p: Passage, hand: str):
    out = []
    sg = hand_sign(hand)
    for i, (e1, e2) in _consecutive_singles(p, hand, 2):
        d = (e2.pitches[0] - e1.pitches[0]) * sg
        if not (1 <= d <= 4) or e2.onset_s - e1.onset_s > LINE_IOI_S:
            continue
        prev, _ = _neighbours(p, hand, i)
        _, nxt = _neighbours(p, hand, i + 1)
        pf = prev.fingers[-1] if prev else 0
        nf = nxt.fingers[0] if nxt else 0
        orig = (e1.fingers[0], e2.fingers[0])
        for a, b in [(3, 2), (4, 3), (4, 2), (5, 4), (5, 3)]:
            if (a, b) != orig and a != pf and b != nf:
                out.append(([e1.ids[0], e2.ids[0]], {e1.ids[0]: a, e2.ids[0]: b}, e2.ids[0]))
                break
    return out


def _cands_hop_at_speed(p: Passage, hand: str):
    out = []
    for i, (e1, e2) in _consecutive_singles(p, hand, 2):
        if e1.pitches[0] == e2.pitches[0] or abs(e1.pitches[0] - e2.pitches[0]) > 12:
            continue
        if e2.onset_s - e1.onset_s > HOP_IOI_S:
            continue
        f1, f2 = e1.fingers[0], e2.fingers[0]
        if f1 == 0 or f1 == f2:
            continue
        _, nxt = _neighbours(p, hand, i + 1)
        if nxt and nxt.fingers and nxt.fingers[0] == f1 and not nxt.is_chord:
            continue
        out.append(([e1.ids[0], e2.ids[0]], {e2.ids[0]: f1}, e2.ids[0]))
    return out


def _cands_run_345_reversed(p: Passage, hand: str):
    out = []
    sg = hand_sign(hand)
    for i, (e1, e2, e3) in _consecutive_singles(p, hand, 3):
        d1 = (e2.pitches[0] - e1.pitches[0]) * sg
        d2 = (e3.pitches[0] - e2.pitches[0]) * sg
        if not (1 <= d1 <= 2 and 1 <= d2 <= 2):
            continue
        if e3.onset_s - e1.onset_s > 2 * LINE_IOI_S:
            continue
        prev, _ = _neighbours(p, hand, i)
        _, nxt = _neighbours(p, hand, i + 2)
        if prev and prev.fingers and prev.fingers[-1] == 5:
            continue
        if nxt and nxt.fingers and nxt.fingers[0] == 3:
            continue
        ids = [e1.ids[0], e2.ids[0], e3.ids[0]]
        if [e.fingers[0] for e in (e1, e2, e3)] == [5, 4, 3]:
            continue
        out.append((ids, {ids[0]: 5, ids[1]: 4, ids[2]: 3}, ids[1]))
    return out


def _cands_thumb_on_black(p: Passage, hand: str):
    out = []
    for i, e in _sounding_with_index(p, hand):
        if e.is_chord or not is_black(e.pitches[0]) or e.fingers[0] in (0, 1):
            continue
        prev, nxt = _neighbours(p, hand, i)
        if prev is None or nxt is None:
            continue
        if any(is_black(x) for x in prev.pitches + nxt.pitches):
            continue
        if prev.is_chord or nxt.is_chord or 1 in prev.fingers or 1 in nxt.fingers:
            continue
        if e.onset_s - prev.onset_s > LINE_IOI_S or nxt.onset_s - e.onset_s > LINE_IOI_S:
            continue
        out.append(([e.ids[0]], {e.ids[0]: 1}, e.ids[0]))
    return out


FINDERS = {
    "chord_same_finger": _cands_chord_same_finger,
    "impossible_span": _cands_impossible_span,
    "nonthumb_crossing": _cands_nonthumb_crossing,
    "hop_at_speed": _cands_hop_at_speed,
    "run_345_reversed": _cands_run_345_reversed,
    "thumb_on_black_between_whites": _cands_thumb_on_black,
}


def applicable_kinds(p: Passage) -> dict[str, int]:
    """Number of candidate positions per fault kind over the passage's target hands."""
    return {k: sum(len(f(p, h)) for h in p.target_hands) for k, f in FINDERS.items()}


def inject_faults(p: Passage, rng: random.Random, n_target: int | None = None,
                  kinds: list[str] | None = None, attempts: int = 12,
                  prefer: dict[str, int] | None = None, min_faults: int = 2) -> tuple[Passage, list[Fault]]:
    """Return a corrupted copy of ``p`` with 2-3 faults of distinct kinds, or raise
    ``ValueError`` if fewer than two can be planted without overlapping (several kind orders
    are tried, because an early fault can block the candidates of a later kind). ``prefer``
    maps kinds to how often they were already used; rarer kinds are tried first so that the
    benchmark ends up balanced across kinds."""
    n_target = n_target or rng.choice([2, 3, 3])
    best: tuple[Passage, list[Fault]] | None = None
    for _ in range(attempts):
        q, faults = _inject_once(p, rng, n_target, kinds, prefer)
        if best is None or len(faults) > len(best[1]):
            best = (q, faults)
        if len(faults) >= n_target:
            break
    assert best is not None
    if len(best[1]) < min_faults:
        raise ValueError(f"only {len(best[1])} fault(s) can be planted in {p.passage_id}")
    return best


def _inject_once(p: Passage, rng: random.Random, n_target: int, kinds: list[str] | None,
                 prefer: dict[str, int] | None = None) -> tuple[Passage, list[Fault]]:
    q = p.copy()
    order = list(kinds or KINDS)
    rng.shuffle(order)
    if prefer:
        order.sort(key=lambda k: prefer.get(k, 0))
    touched: dict[str, set[int]] = {}
    faults: list[Fault] = []
    for kind in order:
        if len(faults) >= n_target:
            break
        cands = []
        for hand in q.target_hands:
            for ids, after, anchor in FINDERS[kind](q, hand):
                if _free(touched, hand, ids):
                    cands.append((hand, ids, after, anchor))
        if not cands:
            continue
        hand, ids, after, anchor = rng.choice(cands)
        before = {i: q.finger_map(hand)[i] for i in ids}
        for i, f in after.items():
            q.set_finger(i, f)
        _touch(touched, hand, ids)
        faults.append(Fault(kind=kind, hand=hand, notes=ids, anchor=anchor, before=before,
                            after={i: after.get(i, before[i]) for i in ids}))
    return q, faults
