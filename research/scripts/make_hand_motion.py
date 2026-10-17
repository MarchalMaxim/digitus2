#!/usr/bin/env python3
"""Fit the hand-motion tables used by the MIDI hand separation (packages/engine/src/io/midi).

Definition, shared with motionCounts in packages/engine/src/io/midi/motion.ts (motion.test.ts
checks that both count the library identically): group notes by onset; the first onset follows
pattern LR; at each onset count the transition from the previous onset's pattern (L, R or LR:
which hands play). For each hand that plays: centre = (lowest + highest) / 2; span = highest -
lowest, capped at 24; position = centre rounded half up, clamped to MIDI 21..108; and, when the
hand played before, move = (centre - previous centre) rounded half up, clamped to [-24, 24].
Probabilities, per source: (count + 0.5) / (total + 0.5 * buckets), each pattern row separately.
The written tables are the equal-weight average of the sources' tables, not the smoothing of the
pooled counts: the Mutopia train half has about twelve times the library's onsets, and pooling let
it drown the beginner textures the app opens most (M6 plan, deviation recorded in Task 3).

Sources: the built-in library (content/manifest.json; staff 1 = right hand), the Mutopia train
half (channel = hand) and, for research only, the PIG train split. PIG statistics never go under
packages/ or apps/ (PIG licence: non-profit academic use; docs/PROGRESS.md "Decisions").

Usage, from the repo root:
  research/.venv/Scripts/python.exe -I research/scripts/make_hand_motion.py \\
      --library content/manifest.json \\
      --mutopia research/data/mutopia_fingering --mutopia-split research/data/splits/mutopia_split.json \\
      --out packages/engine/src/io/midi/params/hand-motion.json
  research/.venv/Scripts/python.exe -I research/scripts/make_hand_motion.py \\
      --library content/manifest.json \\
      --pig research/data/pig --pig-split research/data/splits/pig_official.json \\
      --out research/weights/hand-motion-pig.json
"""
from __future__ import annotations

import argparse
import datetime as _dt
import glob
import hashlib
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path

MOVE_RANGE = 24
SPAN_CAP = 24
POSITION_MIN, POSITION_MAX = 21, 108
PATTERNS = ("L", "R", "LR")
TABLES = {
    "moveLeft": 2 * MOVE_RANGE + 1, "moveRight": 2 * MOVE_RANGE + 1,
    "spanLeft": SPAN_CAP + 1, "spanRight": SPAN_CAP + 1,
    "positionLeft": POSITION_MAX - POSITION_MIN + 1, "positionRight": POSITION_MAX - POSITION_MIN + 1,
}
KINDS = ("move", "span", "position", "pattern")
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
PIG_PITCH = re.compile(r"^([A-G])(#{1,2}|b{1,2})?(-?\d+)$")
REPO = Path(__file__).resolve().parents[2]
SHIPPED_ROOTS = (REPO / "packages", REPO / "apps")
HALF = Fraction(1, 2)


def empty_counts() -> dict:
    counts = {name: [0] * size for name, size in TABLES.items()}
    counts["pattern"] = {a: {b: 0 for b in PATTERNS} for a in PATTERNS}
    return counts


def add_counts(into: dict, other: dict) -> None:
    for name in TABLES:
        into[name] = [x + y for x, y in zip(into[name], other[name])]
    for a in PATTERNS:
        for b in PATTERNS:
            into["pattern"][a][b] += other["pattern"][a][b]


def motion_counts(notes) -> dict:
    """notes: iterable of (onset key, midi, hand). Same definition as motionCounts in motion.ts."""
    counts = empty_counts()
    slices: dict = {}
    for onset, midi, hand in notes:
        slices.setdefault(onset, []).append((midi, hand))
    previous = {"L": None, "R": None}
    previous_pattern = "LR"
    for onset in sorted(slices):
        by_hand = {h: [m for m, hh in slices[onset] if hh == h] for h in ("L", "R")}
        pattern = "LR" if by_hand["L"] and by_hand["R"] else ("L" if by_hand["L"] else "R")
        counts["pattern"][previous_pattern][pattern] += 1
        previous_pattern = pattern
        for hand, side in (("L", "Left"), ("R", "Right")):
            pitches = by_hand[hand]
            if not pitches:
                continue
            centre = Fraction(min(pitches) + max(pitches), 2)
            counts["span" + side][min(max(pitches) - min(pitches), SPAN_CAP)] += 1
            position = min(max(math.floor(centre + HALF), POSITION_MIN), POSITION_MAX)
            counts["position" + side][position - POSITION_MIN] += 1
            if previous[hand] is not None:
                move = min(max(math.floor(centre - previous[hand] + HALF), -MOVE_RANGE), MOVE_RANGE)
                counts["move" + side][move + MOVE_RANGE] += 1
            previous[hand] = centre
    return counts


def smooth(counts: dict, uniform: frozenset) -> dict:
    out: dict = {}
    for name in TABLES:
        xs = counts[name]
        kind = name.replace("Left", "").replace("Right", "")
        if kind in uniform:
            out[name] = [1 / len(xs)] * len(xs)
        else:
            total = sum(xs) + 0.5 * len(xs)
            out[name] = [(x + 0.5) / total for x in xs]
    out["pattern"] = {}
    for a in PATTERNS:
        row = counts["pattern"][a]
        if "pattern" in uniform:
            out["pattern"][a] = {b: 1 / len(PATTERNS) for b in PATTERNS}
        else:
            total = sum(row.values()) + 0.5 * len(PATTERNS)
            out["pattern"][a] = {b: (row[b] + 0.5) / total for b in PATTERNS}
    return out


def mix(per_source: dict, uniform: frozenset) -> dict:
    """Smooth each source's counts on its own, then average the tables with equal weight per source
    (in the given source order, so the output is deterministic). One source gives smooth() exactly."""
    tables = [smooth(counts, uniform) for counts in per_source.values()]
    n = len(tables)
    out: dict = {name: [sum(t[name][i] for t in tables) / n for i in range(size)] for name, size in TABLES.items()}
    out["pattern"] = {a: {b: sum(t["pattern"][a][b] for t in tables) / n for b in PATTERNS} for a in PATTERNS}
    return out


def musicxml_notes(path: Path) -> list[tuple[Fraction, int, str]]:
    """(onset in quarter notes, midi, hand) of every sounding note, as parseMusicXml sees them:
    tie continuations are not onsets, grace notes sit at their principal's onset, and a second
    non-grace note with the same hand, onset and pitch is dropped."""
    root = ET.parse(path).getroot()
    if root.tag != "score-partwise":
        raise ValueError(f"{path}: not a partwise MusicXML score")
    raw = []
    lengths: dict[int, Fraction] = {}
    for part_index, part in enumerate(root.findall("part")):
        divisions = 1
        staves = 1
        open_ties: set[tuple[int, int]] = set()
        for m_index, measure in enumerate(part.findall("measure")):
            cursor = longest = chord_onset = Fraction(0)
            for el in measure:
                if el.tag == "attributes":
                    if el.findtext("divisions"):
                        divisions = int(el.findtext("divisions"))
                    if el.findtext("staves"):
                        staves = int(el.findtext("staves"))
                elif el.tag == "backup":
                    cursor -= Fraction(int(el.findtext("duration") or 0), divisions)
                elif el.tag == "forward":
                    cursor += Fraction(int(el.findtext("duration") or 0), divisions)
                    longest = max(longest, cursor)
                elif el.tag == "note":
                    is_chord = el.find("chord") is not None
                    is_grace = el.find("grace") is not None
                    duration = Fraction(0) if is_grace else Fraction(int(el.findtext("duration") or 0), divisions)
                    onset = chord_onset if is_chord else cursor
                    if not is_chord:
                        chord_onset = cursor
                        if not is_grace:
                            cursor += duration
                            longest = max(longest, cursor)
                    pitch = el.find("pitch")
                    if el.find("rest") is not None or el.find("cue") is not None or pitch is None:
                        continue
                    midi = ((int(pitch.findtext("octave") or 4) + 1) * 12 + STEP[pitch.findtext("step") or "C"]
                            + math.floor(float(pitch.findtext("alter") or 0) + 0.5))
                    staff = int(el.findtext("staff") or 1)
                    hand = ("R" if staff == 1 else "L") if staves >= 2 else ("R" if part_index == 0 else "L")
                    ties = [t.get("type") for t in el.findall("tie")]
                    tied = [t.get("type") for t in el.findall("notations/tied")]
                    stop = "stop" in ties or (not ties and "stop" in tied)
                    start = "start" in ties or (not ties and "start" in tied)
                    if stop and (staff, midi) in open_ties:
                        if not start:
                            open_ties.discard((staff, midi))
                        continue
                    raw.append((m_index, onset, midi, hand, is_grace))
                    if start:
                        open_ties.add((staff, midi))
            lengths[m_index] = max(lengths.get(m_index, Fraction(0)), longest)
    starts, at = {}, Fraction(0)
    for m_index in sorted(lengths):
        starts[m_index] = at
        at += lengths[m_index]
    notes, seen = [], set()
    for m_index, onset, midi, hand, is_grace in raw:
        absolute = starts[m_index] + onset
        if not is_grace:
            if (hand, absolute, midi) in seen:
                continue
            seen.add((hand, absolute, midi))
        notes.append((absolute, midi, hand))
    return notes


def pig_notes(path: Path) -> list[tuple[int, int, str]]:
    """(onset in microseconds, midi, hand) from a PIG-format file; channel 0 = right hand."""
    notes = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        cols = line.split()
        m = PIG_PITCH.match(cols[3])
        if m is None:
            raise ValueError(f"{path}: bad pitch {cols[3]!r}")
        acc = m.group(2) or ""
        midi = (int(m.group(3)) + 1) * 12 + STEP[m.group(1)] + (len(acc) if acc.startswith("#") else -len(acc))
        notes.append((round(float(cols[1]) * 1_000_000), midi, "R" if cols[6] == "0" else "L"))
    return notes


def library_files(manifest: Path, benchmark_set: str = "core30") -> list[Path]:
    """The library pieces of one benchmark set (default core30, the original 30).

    Entries without a ``benchmarkSet`` field belong to core30; pieces added later (L1 onwards)
    carry another value or null and are left out, so the shipped hand-motion fit and the
    research tests keep measuring the same 30 scores.
    """
    entries = json.loads(manifest.read_text(encoding="utf-8"))
    return [
        manifest.parent / e["files"]["score"]
        for e in entries
        if e.get("benchmarkSet", "core30") == benchmark_set
    ]


def split_files(gold: Path, split: Path, subset: str = "train") -> list[Path]:
    """The first annotation file of every piece in the split's subset."""
    data = json.loads(split.read_text(encoding="utf-8"))
    pieces = data["splits"][data["default_split"]][subset]["pieces"]
    folder = gold / "FingeringFiles" if (gold / "FingeringFiles").is_dir() else gold
    files = []
    for piece in pieces:
        found = sorted(folder.glob(f"{glob.escape(piece)}-*_fingering.txt"))
        if not found:
            raise SystemExit(f"no fingering file for {piece} in {folder} (see research/data/README.md)")
        files.append(found[0])
    return files


def checkout_relative(path: Path) -> str:
    """The path inside the checkout that holds it, with links left unresolved, so the name is the
    same whether the data sits in this checkout, behind a junction (git worktrees link the
    gitignored datasets to the main checkout) or is read in place from another checkout."""
    absolute = Path(os.path.abspath(path))
    try:
        return absolute.relative_to(REPO).as_posix()
    except ValueError:
        pass
    for parent in absolute.parents:
        if (parent / ".git").exists():
            return absolute.relative_to(parent).as_posix()
    return absolute.as_posix()


def file_list_sha(files: list[Path]) -> str:
    names = sorted(checkout_relative(f) for f in files)
    return hashlib.sha256("\n".join(names).encode("utf-8")).hexdigest()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Fit hand-motion.json for the MIDI hand separation.")
    ap.add_argument("--library", type=Path)
    ap.add_argument("--mutopia", type=Path)
    ap.add_argument("--mutopia-split", type=Path)
    ap.add_argument("--pig", type=Path)
    ap.add_argument("--pig-split", type=Path)
    ap.add_argument("--mu", type=float, default=5.0)
    ap.add_argument("--nu", type=float, default=0.5)
    ap.add_argument("--idle-sec", type=float, default=4.0)
    ap.add_argument("--uniform", default="", help="comma list of tables to flatten: move,span,position,pattern")
    ap.add_argument("--date", default=_dt.date.today().isoformat())
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)
    out = a.out.resolve()
    if a.pig is not None and any(root in out.parents for root in SHIPPED_ROOTS):
        raise SystemExit("PIG-derived statistics are research-only (PIG licence: non-profit academic use); "
                         "write them under research/weights/")
    uniform = sorted(x for x in a.uniform.split(",") if x)
    if set(uniform) - set(KINDS):
        raise SystemExit(f"--uniform: unknown table(s) {sorted(set(uniform) - set(KINDS))}")
    sources = []
    if a.library:
        sources.append(("library", library_files(a.library), musicxml_notes))
    if a.mutopia:
        if not a.mutopia_split:
            raise SystemExit("--mutopia needs --mutopia-split")
        sources.append(("mutopia-train", split_files(a.mutopia, a.mutopia_split), pig_notes))
    if a.pig:
        if not a.pig_split:
            raise SystemExit("--pig needs --pig-split")
        sources.append(("pig-train", split_files(a.pig, a.pig_split), pig_notes))
    if not sources:
        raise SystemExit("give at least one of --library, --mutopia, --pig")
    per_source, described, every_file = {}, [], []
    for name, files, reader in sources:
        counts = empty_counts()
        for f in files:
            add_counts(counts, motion_counts(reader(f)))
        per_source[name] = counts
        described.append({"name": name, "files": len(files), "fileListSha256": file_list_sha(files)})
        every_file += files
    pig = any(name == "pig-train" for name, _, _ in sources)
    doc = {
        "version": 1,
        "provenance": {
            "script": "research/scripts/make_hand_motion.py",
            "date": a.date,
            "definition": "see the script docstring; shared with motionCounts in packages/engine/src/io/midi/motion.ts",
            "smoothing": ("per source: add 0.5 to every count, then normalise, each pattern row separately; "
                          "the tables are the average of the sources' tables with equal weight per source"),
            "uniform": uniform,
            "sources": described,
            "fileListSha256": file_list_sha(every_file),
            "settings": "mu, nu and idleSec are hand-set defaults (M6 plan Task 2); docs/experiments.md records the sensitivity check",
            "licence": ("RESEARCH ONLY: includes PIG statistics (non-profit academic use)" if pig else
                        "statistics of the built-in library (CC0, public domain and CC BY-SA engravings) and the "
                        "Mutopia train half (public domain, CC BY and CC BY-SA engravings); no PIG data"),
        },
        "mu": a.mu,
        "nu": a.nu,
        "idleSec": a.idle_sec,
        **mix(per_source, frozenset(uniform)),
        "counts": per_source,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {out}: " + ", ".join(f"{s['name']} {s['files']} files" for s in described))
    return 0


if __name__ == "__main__":
    sys.exit(main())
