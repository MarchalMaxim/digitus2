"""Textbook templates for runs, ported from ``packages/engine/src/fingering/templates.ts``
(M2 Task 8). A note inside a matched run earns the ``template`` term (points -1) for the
template's finger. Entries come from ``benchmarks/textbook/{scales,arpeggios,chromatic}.json``
(the engine ships a deep-equal copy), at most two octaves, in file order.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .sequence import SeqNote

ROOT = Path(__file__).resolve().parents[2]
TEXTBOOK_DIR = ROOT / "benchmarks" / "textbook"


@dataclass
class Run:
    start: int
    end: int
    kind: str
    direction: int


@dataclass
class TemplateMatch:
    start: int
    end: int
    fingers: list[int]
    entry_id: str


def _hand(v) -> str | None:
    s = str(v or "").lower()
    if s in ("r", "rh", "right"):
        return "R"
    if s in ("l", "lh", "left"):
        return "L"
    return None


@lru_cache(maxsize=None)
def textbook_templates(textbook_dir: str = str(TEXTBOOK_DIR)) -> dict[str, list[dict]]:
    """``TEXTBOOK_TEMPLATES``: normalised entries with octaves <= 2 per hand, file order."""
    out: dict[str, list[dict]] = {"R": [], "L": []}
    for name in ("scales", "arpeggios", "chromatic"):
        raw = json.loads((Path(textbook_dir) / f"{name}.json").read_text(encoding="utf-8"))
        entries = raw if isinstance(raw, list) else raw.get("entries", [])
        for k, e in enumerate(entries):
            h = _hand(e.get("hand"))
            midi = e.get("midi") if isinstance(e.get("midi"), list) else []
            fingers = e.get("fingers") if isinstance(e.get("fingers"), list) else []
            if not h or not midi or len(midi) != len(fingers):
                continue
            octaves = e.get("octaves") if isinstance(e.get("octaves"), (int, float)) else 1
            if octaves > 2:
                continue
            out[h].append({"id": str(e.get("id", f"entry-{k}")), "midi": list(midi), "fingers": list(fingers)})
    return out


def detect_runs(seq: list[SeqNote]) -> list[Run]:
    n = len(seq)
    slice_size: dict[int, int] = {}
    for m in seq:
        slice_size[m.slice] = slice_size.get(m.slice, 0) + 1

    def single(i: int) -> bool:
        return slice_size[seq[i].slice] == 1 and not seq[i].is_grace

    def kind_of(s: int) -> str:
        return "step" if abs(s) <= 2 else "leap"

    runs: list[Run] = []
    i = 0
    while i < n:
        if not single(i):
            i += 1
            continue
        j = i
        direction = 0
        steps: list[int] = []
        while j + 1 < n and single(j + 1):
            step = seq[j + 1].midi - seq[j].midi
            d = 1 if step > 0 else -1 if step < 0 else 0
            if d == 0 or abs(step) > 5 or (direction != 0 and d != direction):
                break
            if steps and kind_of(steps[0]) != kind_of(step):
                break
            direction = d
            steps.append(step)
            j += 1
        length = j - i + 1
        if steps and abs(steps[0]) <= 2 and length >= 4:
            runs.append(Run(i, j, "chromatic" if all(abs(s) == 1 for s in steps) else "scale", direction))
        elif steps and abs(steps[0]) >= 3 and length >= 3:
            runs.append(Run(i, j, "arpeggio", direction))
        i = j if length > 1 else i + 1
    return runs


def _find_shifted(haystack: list[int], needle: list[int]) -> int:
    if len(needle) > len(haystack):
        return -1
    for at in range(len(haystack) - len(needle) + 1):
        shift = haystack[at] - needle[0]
        if shift % 12 != 0:
            continue
        if all(haystack[at + k] - needle[k] == shift for k in range(1, len(needle))):
            return at
    return -1


def match_templates(seq: list[SeqNote], runs: list[Run], entries: list[dict]) -> list[TemplateMatch]:
    matches: list[TemplateMatch] = []
    taken: set[int] = set()
    ordered = sorted(runs, key=lambda r: (-(r.end - r.start), r.start))
    for run in ordered:
        midi = [seq[k].midi for k in range(run.start, run.end + 1)]
        found = None
        for e in entries:
            at = _find_shifted(e["midi"], midi)
            if at < 0:
                continue
            found = TemplateMatch(run.start, run.end, e["fingers"][at: at + len(midi)], e["id"])
            break
        if found is None:
            continue
        rng = range(found.start, found.end + 1)
        if any(k in taken for k in rng):
            continue
        taken.update(rng)
        matches.append(found)
    return sorted(matches, key=lambda m: m.start)


def template_fingers(seq: list[SeqNote], hand: str) -> list[int]:
    """Template finger per sequence index (0 outside every match)."""
    out = [0] * len(seq)
    for m in match_templates(seq, detect_runs(seq), textbook_templates()[hand]):
        for k in range(m.start, m.end + 1):
            out[k] = int(m.fingers[k - m.start])
    return out
