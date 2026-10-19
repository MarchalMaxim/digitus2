"""Independent checks of an embellished score against its plain score.

The score is read with the content pipeline's own reader (`content/tools/xmlcheck.py`), not with the
embellisher's parser, and the strong positions are derived again here, so that a fault in the
embellisher's timeline does not hide itself.

`verify(plain, embellished, inserted)` checks that:
  * the measures have the same number and lengths, and the reader finds no new structural problem;
  * every note outside the melody voice (left hand, lower right-hand voices, grace notes, rests) is
    unchanged: the multiset of (onset, pitch, duration, staff, voice, grace) is identical;
  * every plain melody note still starts at its onset with its pitch, and every other melody note in
    the embellished score is one of the recorded insertions (onset and pitch);
  * no inserted note starts on a strong position or holds across one (a record's `length`), and at
    every strong position the notes struck are the same as in the plain score;
  * "melody pitches kept on strong positions": every (strong position, melody pitch) that sounds in
    the plain score sounds in the embellished one, and is struck there when it is struck in the plain
    score. `strong_total` counts those pairs and `strong_kept` the ones kept. (The rules treat these
    pitches as chord tones; the check does not analyse harmony.)

License: MIT.
"""
from __future__ import annotations

import io
import sys
from collections import Counter
from dataclasses import dataclass, field
from fractions import Fraction as F
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "content" / "tools"
if str(TOOLS) not in sys.path:
    sys.path.append(str(TOOLS))
import xmlcheck as xc  # noqa: E402

from . import core  # noqa: E402

HALF_BAR_STRONG = {(4, 4), (2, 2), (4, 2), (6, 4), (4, 8), (6, 8), (12, 8)}


def read(text: str):
    return xc.parse_musicxml(io.BytesIO(text.encode("utf-8")))


def read_notes(text: str) -> list:
    return read(text).notes


def strong_positions(xs) -> list[F]:
    """Absolute onsets (quarters) of the downbeats and, in the even meters, the half bars."""
    times = {mi: t for mi, t in xs.times}
    cur = None
    out = []
    for m in xs.measures:
        cur = times.get(m.idx, cur)
        if cur is None:
            continue
        nominal = F(cur[0] * 4, cur[1])
        offset = nominal - m.length if (m.length < nominal and (m.idx == 0 or m.implicit)) else F(0)
        marks = [F(0)] + ([nominal / 2] if tuple(cur) in HALF_BAR_STRONG else [])
        for mark in marks:
            pos = mark - offset
            if 0 <= pos < m.length:
                out.append(m.start + pos)
    return out


@dataclass
class Report:
    ok: bool
    problems: list[str] = field(default_factory=list)
    strong_total: int = 0
    strong_kept: int = 0


def verify(plain: str, embellished: str, inserted: list[dict], melody_voice: str | None = None) -> Report:
    if melody_voice is None:
        melody_voice = core.analyse(plain).melody_voice or "1"
    a, b = read(plain), read(embellished)
    problems: list[str] = []
    if [(m.start, m.length) for m in a.measures] != [(m.start, m.length) for m in b.measures]:
        problems.append("measure starts or lengths differ")
    new_problems = set(b.problems) - set(a.problems)
    if new_problems:
        problems.append(f"new reader problems: {sorted(new_problems)[:3]}")

    def is_melody(n) -> bool:
        return n.staff == "1" and n.voice == melody_voice and n.pitch is not None and not n.grace

    def key(n) -> tuple:
        return (n.onset, n.pitch, n.dur, n.staff, n.voice, n.grace, n.tie_start, n.tie_stop)

    rest_a = Counter(key(n) for n in a.notes if not is_melody(n))
    rest_b = Counter(key(n) for n in b.notes if not is_melody(n))
    if rest_a != rest_b:
        diff = list((rest_a - rest_b).elements())[:2] + list((rest_b - rest_a).elements())[:2]
        problems.append(f"non-melody notes changed: {diff}")
    mel_a = [n for n in a.notes if is_melody(n)]
    mel_b = [n for n in b.notes if is_melody(n)]
    struck_b = {(n.onset, n.pitch) for n in mel_b}
    missing = [(n.onset, n.pitch) for n in mel_a if (n.onset, n.pitch) not in struck_b]
    if missing:
        problems.append(f"plain melody notes lost: {missing[:3]}")
    extra = Counter((n.onset, n.pitch) for n in mel_b) - Counter((n.onset, n.pitch) for n in mel_a)
    recorded = Counter((F(i["onset"]), i["midi"]) for i in inserted)
    if extra != recorded:
        problems.append(f"unrecorded or missing insertions: {list((extra - recorded).elements())[:3]}"
                        f" / {list((recorded - extra).elements())[:3]}")

    strong = strong_positions(a)
    strong_set = set(strong)
    for o, _ in recorded.elements():
        if o in strong_set:
            problems.append(f"an inserted note starts on a strong position ({o})")
    for i in inserted:
        if "length" in i:
            start = F(i["onset"])
            end = start + F(i["length"])
            if any(start < s < end for s in strong):
                problems.append(f"an inserted note sounds through a strong position ({start} to {end})")
    struck_all_a = Counter((n.onset, n.pitch) for n in a.notes if n.pitch is not None and not n.grace
                           and n.onset in strong_set)
    struck_all_b = Counter((n.onset, n.pitch) for n in b.notes if n.pitch is not None and not n.grace
                           and n.onset in strong_set)
    if struck_all_a != struck_all_b:
        problems.append("the notes struck on a strong position differ")
    total = kept = 0
    for t in strong:
        for n in mel_a:
            if not (n.onset <= t < n.onset + n.dur):
                continue
            total += 1
            if n.onset == t:
                kept += any(m.onset == t and m.pitch == n.pitch for m in mel_b)
            else:
                kept += any(m.onset <= t < m.onset + m.dur and m.pitch == n.pitch for m in mel_b)
    if kept < total:
        problems.append(f"melody pitches on strong positions kept: {kept} of {total}")
    return Report(not problems, problems, total, kept)
