"""Compact text rendering of a passage for a language-model reviewer, and its parser.

Format (one block per passage)::

    PASSAGE it-4c1e
    Composer: Mozart (piano sonata). Meter: 4/4. Tempo: quarter = 120 (estimated). Bars 5-8.
    Review: RH fingering (column f). LH is shown for context, without fingering.
    id     bar beat  dur  pitch      f
    RH
    R1     5   1     h    C5         1
    R2     5   3     q    E5         3
    R3-5   6   1     q    C4+E4+G4   1+3+5
    -      6   2     e    rest       -
    LH (context)
    L1     5   1     e    C3         -

* ``id``: hand letter + 1-based note index in onset order; a chord lists its ids as a range
  ``R3-5`` and its pitches low to high, fingers aligned (``1+3+5``). Rests have no id.
* ``bar`` / ``beat``: notated bar number and 1-based beat within the bar (fractions allowed:
  ``2.5`` = the second half of beat 2; the beat is a quarter in x/4 meters, a dotted quarter
  in 6/8 and 12/8, an eighth in 3/8).
* ``dur``: sounding length — w h q e s t = whole, half, quarter, eighth, 16th, 32nd; a
  trailing dot = dotted; ``e3`` = triplet eighth; ``gr`` = grace note; otherwise a multiple of a
  quarter (``2.5q``).
* ``pitch``: scientific pitch, C4 = middle C; sharps except Eb and Bb.
* ``f``: finger 1 (thumb) .. 5 (little finger); ``-`` = not given.
"""
from __future__ import annotations

import re
from fractions import Fraction

from .model import Event, Passage, number_events, parse_pitch, pitch_name

LEGEND = """How to read a passage block
- One line per note, chord or rest; both hands in separate sections, each in time order.
- id = hand letter + note number (R1, R2, ... for the right hand; L1, L2, ... for the left). A chord
  shows a range (R3-5): its pitches are listed low to high and its fingers in the same order (1+3+5).
  Rests have no id. Refer to notes by these ids.
- bar / beat: bar number and beat within the bar, 1-based; 2.5 means half-way through beat 2. The beat
  is a quarter note in x/4 meters, a dotted quarter in 6/8 and 12/8, an eighth in 3/8.
- dur: w h q e s t = whole, half, quarter, eighth, 16th, 32nd; a trailing dot = dotted (q. = dotted
  quarter); e3 = triplet eighth; gr = grace note; otherwise a multiple of a quarter (2.5q). Rest lines
  mark gaps of an eighth or longer.
- pitch: scientific pitch names, C4 = middle C, sharps except Eb and Bb. Black keys: C# Eb F# G# Bb.
- f: finger, 1 = thumb ... 5 = little finger, for both hands. "-" = no fingering given for that note.
- Tempo is given as quarter notes per minute. Bar numbers and tempo come from the performance timing
  and may be off by a beat or two; the order, the rhythm and the pitches are exact.
"""

_DUR_LABELS: list[tuple[Fraction, str]] = [
    (Fraction(8), "2w"), (Fraction(6), "w."), (Fraction(4), "w"), (Fraction(3), "h."), (Fraction(2), "h"),
    (Fraction(3, 2), "q."), (Fraction(1), "q"), (Fraction(3, 4), "e."), (Fraction(1, 2), "e"),
    (Fraction(3, 8), "s."), (Fraction(1, 4), "s"), (Fraction(3, 16), "t."), (Fraction(1, 8), "t"),
    (Fraction(2, 3), "q3"), (Fraction(1, 3), "e3"), (Fraction(1, 6), "s3"),
]
_LABEL_DUR = {lab: q for q, lab in _DUR_LABELS}


def dur_label(dur_q: Fraction) -> str:
    for q, lab in _DUR_LABELS:
        if dur_q == q:
            return lab
    if dur_q < Fraction(1, 8):
        return "gr"
    return f"{float(dur_q):.2f}".rstrip("0").rstrip(".") + "q"


def parse_dur(label: str) -> Fraction:
    if label in _LABEL_DUR:
        return _LABEL_DUR[label]
    if label == "gr":
        return Fraction(1, 24)
    m = re.fullmatch(r"([0-9.]+)q", label)
    if not m:
        raise ValueError(f"bad duration label {label!r}")
    return Fraction(m.group(1)).limit_denominator(96)


def fmt_beat(beat: Fraction) -> str:
    if beat.denominator == 1:
        return str(beat.numerator)
    s = f"{float(beat):.3f}".rstrip("0").rstrip(".")
    return s


def parse_beat(s: str) -> Fraction:
    return Fraction(s).limit_denominator(48)


def _ids_label(e: Event) -> str:
    if e.is_rest:
        return "-"
    if len(e.ids) == 1:
        return e.ids[0]
    first, last = e.ids[0], e.ids[-1]
    return f"{first}-{last[1:]}"


def render_passage(p: Passage, with_fingers: list[str] | None = None, header: bool = True) -> str:
    """Render ``p``; fingers are printed only for hands in ``with_fingers`` (default: the
    passage's ``target_hands``)."""
    with_fingers = list(p.target_hands if with_fingers is None else with_fingers)
    lines: list[str] = []
    if header:
        lines.append(f"PASSAGE {p.passage_id}")
        bars = f"Bars {p.bar_first}-{p.bar_last}." if p.bar_last != p.bar_first else f"Bar {p.bar_first}."
        lines.append(f"Composer: {p.composer} ({p.style}). Meter: {p.meter[0]}/{p.meter[1]}. "
                     f"Tempo: quarter = {p.tempo_qpm} (estimated). {bars}")
        hands_txt = {"R": "RH", "L": "LH"}
        reviewed = " and ".join(hands_txt[h] for h in with_fingers)
        others = [h for h in ("R", "L") if h in p.events and h not in with_fingers]
        ctx = (f" {' and '.join(hands_txt[h] for h in others)} shown for context, without fingering."
               if others else "")
        lines.append(f"Review: {reviewed} fingering (column f).{ctx}")
    lines.append(f"{'id':<7}{'bar':<4}{'beat':<6}{'dur':<6}{'pitch':<16}f")
    for hand in ("R", "L"):
        if hand not in p.events:
            continue
        show = hand in with_fingers
        lines.append(("RH" if hand == "R" else "LH") + ("" if show else " (context)"))
        for e in p.events[hand]:
            bar, beat = p.bar_beat(e.onset_q)
            if e.is_rest:
                lines.append(f"{'-':<7}{bar:<4}{fmt_beat(beat):<6}{dur_label(e.dur_q):<6}{'rest':<16}-")
                continue
            pitches = "+".join(pitch_name(x) for x in e.pitches)
            if show:
                fingers = "+".join(str(f) if f else "-" for f in e.fingers)
            else:
                fingers = "-"
            lines.append(f"{_ids_label(e):<7}{bar:<4}{fmt_beat(beat):<6}{dur_label(e.dur_q):<6}{pitches:<16}{fingers}")
    return "\n".join(lines) + "\n"


_HEAD_RE = re.compile(r"Composer: (?P<composer>[^(]+?) \((?P<style>[^)]*)\)\. Meter: (?P<num>\d+)/(?P<den>\d+)\. "
                      r"Tempo: quarter = (?P<tempo>\d+) \(estimated\)\. Bars? (?P<b1>\d+)(?:-(?P<b2>\d+))?\.")


def parse_rendering(text: str) -> Passage:
    """Parse a rendered block back into a :class:`Passage` (seconds are reconstructed from the
    tempo). Used by the round-trip tests and by the scorer to check reviewer read-backs."""
    lines = [ln.rstrip("\n") for ln in text.strip("\n").splitlines()]
    assert lines[0].startswith("PASSAGE "), lines[0]
    pid = lines[0].split(None, 1)[1].strip()
    m = _HEAD_RE.match(lines[1])
    if not m:
        raise ValueError(f"cannot parse header: {lines[1]!r}")
    composer, style = m.group("composer").strip(), m.group("style")
    meter = (int(m.group("num")), int(m.group("den")))
    tempo = int(m.group("tempo"))
    b1 = int(m.group("b1"))
    b2 = int(m.group("b2") or b1)
    rev = lines[2]
    target = []
    if rev.startswith("Review: "):
        head = rev[len("Review: "):].split(" fingering")[0]
        target = ["R" if h == "RH" else "L" for h in head.split(" and ")]
    p = Passage(passage_id=pid, composer=composer, style=style, meter=meter, tempo_qpm=tempo,
                bar_first=b1, bar_last=b2, target_hands=target)
    hand = None
    raw: dict[str, list[Event]] = {}
    qsec = 60.0 / tempo
    for ln in lines[3:]:
        if not ln.strip() or ln.startswith("id "):
            continue
        if ln.startswith("RH"):
            hand = "R"
            raw[hand] = []
            continue
        if ln.startswith("LH"):
            hand = "L"
            raw[hand] = []
            continue
        parts = ln.split()
        if len(parts) != 6:
            raise ValueError(f"bad line {ln!r}")
        _id, bar_s, beat_s, dur_s, pitch_s, f_s = parts
        bar, beat = int(bar_s), parse_beat(beat_s)
        onset_q = (bar - 1) * p.bar_q + (beat - 1) * p.beat_q
        dur_q = parse_dur(dur_s)
        if pitch_s == "rest":
            raw[hand].append(Event(hand, onset_q, float(onset_q) * qsec, dur_q))
            continue
        pitches = [parse_pitch(x) for x in pitch_s.split("+")]
        fingers = [0 if x == "-" else int(x) for x in f_s.split("+")]
        if len(fingers) == 1 and len(pitches) > 1:
            fingers = fingers * len(pitches)
        raw[hand].append(Event(hand, onset_q, float(onset_q) * qsec, dur_q, pitches, fingers))
    for h, evs in raw.items():
        p.events[h] = number_events(evs, h)
    return p
