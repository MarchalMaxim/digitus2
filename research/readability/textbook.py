"""Textbook-pattern recognition for the ``rules_plus_textbook`` player model.

A reader who sees a scale, arpeggio or chromatic run plays the fingering of the method books once
a printed digit confirms it. The patterns are the generated textbook oracle in
``benchmarks/textbook/{scales,arpeggios,chromatic}.json`` (see its README): every entry has the
pitches in playing order (``midi``), the main fingering (``fingers``) and accepted
``alternatives``.

Matching, per hand:

* a *run* is a maximal stretch of at least ``MIN_RUN`` consecutive single-note events whose pitches
  equal a contiguous window of an entry's ``midi`` list, either exactly or transposed by whole
  octaves (the whole window moves together), in the direction the entry lists it, same hand;
* every fingering of the entry (main and alternatives) gives a candidate run with its own fingers;
* a candidate is *confirmed* for a visible set when the run holds at least one visible digit and
  every visible digit inside the run equals the candidate's finger at its position;
* for a note, the best confirmed candidate covering it wins. Order: confidence (``agreed`` first,
  then ``majority``, ``tie``, ``rule``), main fingering before alternatives, longer run, more run
  ends that coincide with the entry's own ends (a scale that stops on the tonic reads as the end of
  the pattern, finger 5, not as a thumb continuing), then file order.

The window index is keyed by (hand, pitch class of the first note, the three intervals), so a run
search is one dict lookup per event plus the extension of new alignments.
"""
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from readability.corpus import LH, RH, NoteRec

TEXTBOOK_DIR = Path(__file__).resolve().parents[2] / "benchmarks" / "textbook"
FILES = ("scales.json", "arpeggios.json", "chromatic.json")
CONF_RANK = {"agreed": 0, "majority": 1, "tie": 2, "rule": 3}
HAND = {"rh": RH, "lh": LH}
MIN_RUN = 4


@dataclass(frozen=True)
class Pattern:
    id: str                    # entry id + "#main" / "#alt<k>"
    hand: int
    midi: tuple[int, ...]
    fingers: tuple[int, ...]
    conf_rank: int
    alt: int                   # 0 = main fingering, k = k-th alternative
    order: int                 # position in the files (deterministic tie-break)


@dataclass
class Run:
    start: int                 # first event index (inclusive)
    end: int                   # last event index (inclusive)
    fingers: tuple[int, ...]   # finger per event start..end
    pattern: str
    rank: tuple
    checks: tuple[tuple[int, int, int], ...] = ()   # (note idx, printed finger, pattern finger)

    def finger_at(self, e: int) -> int:
        return self.fingers[e - self.start]


def _window_key(hand: int, pitches) -> tuple:
    return (hand, pitches[0] % 12) + tuple(pitches[i + 1] - pitches[i] for i in range(len(pitches) - 1))


class TextbookIndex:
    def __init__(self, entries: list[dict]):
        self.patterns: list[Pattern] = []
        self.index: dict[tuple, list[tuple[int, int]]] = defaultdict(list)
        for order, ent in enumerate(entries):
            hand = HAND[ent["hand"]]
            midi = tuple(int(p) for p in ent["midi"])
            conf = CONF_RANK.get(ent.get("confidence"), len(CONF_RANK))
            options = [ent["fingers"]] + [a["fingers"] for a in (ent.get("alternatives") or [])]
            for k, fing in enumerate(options):
                if len(fing) != len(midi) or len(midi) < MIN_RUN:
                    continue
                pid = len(self.patterns)
                self.patterns.append(Pattern(id=f"{ent['id']}#{'main' if k == 0 else f'alt{k}'}",
                                             hand=hand, midi=midi, fingers=tuple(int(f) for f in fing),
                                             conf_rank=conf, alt=k, order=order))
                for j in range(len(midi) - MIN_RUN + 1):
                    self.index[_window_key(hand, midi[j:j + MIN_RUN])].append((pid, j))
        self.index = dict(self.index)

    @classmethod
    def load(cls, directory: Path = TEXTBOOK_DIR, files: tuple[str, ...] = FILES) -> "TextbookIndex":
        entries: list[dict] = []
        for name in files:
            with open(Path(directory) / name, encoding="utf-8") as f:
                entries.extend(json.load(f)["entries"])
        return cls(entries)

    # ----------------------------------------------------------------------------------
    def find_runs(self, evs: list[list[NoteRec]], hand: int) -> list[Run]:
        """All distinct candidate runs of one hand's events (independent of what is visible)."""
        n = len(evs)
        pitch = [ev[0].pitch if len(ev) == 1 else None for ev in evs]
        seen: dict[tuple[int, int], int] = {}   # alignment -> last event of the run found for it
        best: dict[tuple, Run] = {}
        for i in range(n - MIN_RUN + 1):
            w = pitch[i:i + MIN_RUN]
            if None in w:
                continue
            cands = self.index.get(_window_key(hand, w))
            if not cands:
                continue
            for pid, j in cands:
                align = (pid, i - j)
                if seen.get(align, -1) >= i:
                    continue
                pat = self.patterns[pid]
                shift = w[0] - pat.midi[j]
                a, ja = i, j
                while a > 0 and ja > 0 and pitch[a - 1] is not None and pitch[a - 1] == pat.midi[ja - 1] + shift:
                    a -= 1
                    ja -= 1
                b, jb = i + MIN_RUN - 1, j + MIN_RUN - 1
                last = len(pat.midi) - 1
                while b + 1 < n and jb < last and pitch[b + 1] is not None and pitch[b + 1] == pat.midi[jb + 1] + shift:
                    b += 1
                    jb += 1
                seen[align] = b
                fingers = pat.fingers[ja:jb + 1]
                ends = int(ja == 0) + int(jb == last)
                rank = (pat.conf_rank, int(pat.alt > 0), -(b - a + 1), -ends, pat.order, pat.alt)
                key = (a, b, fingers)
                if key not in best or rank < best[key].rank:
                    best[key] = Run(start=a, end=b, fingers=fingers, pattern=pat.id, rank=rank)
        runs = list(best.values())
        for r in runs:
            r.checks = tuple((evs[e][0].idx, evs[e][0].finger, r.fingers[e - r.start])
                             for e in range(r.start, r.end + 1) if evs[e][0].finger > 0)
        return runs

    def candidates(self, evs: list[list[NoteRec]], hand: int) -> list[list[Run]]:
        """Per event, the candidate runs covering it, best first."""
        per: list[list[Run]] = [[] for _ in evs]
        for r in self.find_runs(evs, hand):
            for e in range(r.start, r.end + 1):
                per[e].append(r)
        for lst in per:
            if len(lst) > 1:
                lst.sort(key=lambda r: r.rank)
        return per


def pick(cands: list[Run], e: int, visible: set[int]) -> int | None:
    """Finger of the best candidate run (covering event ``e``) that the visible digits confirm."""
    for run in cands:
        ok = False
        for idx, printed, expected in run.checks:
            if idx in visible:
                if printed != expected:
                    ok = False
                    break
                ok = True
        if ok:
            return run.finger_at(e)
    return None


_DEFAULT: TextbookIndex | None = None


def default_index() -> TextbookIndex:
    global _DEFAULT
    if _DEFAULT is None:
        _DEFAULT = TextbookIndex.load()
    return _DEFAULT
