"""Bench error galleries (written by packages/engine/cli/bench.ts) and PIG passages carrying the engine's fingers.

A gallery page benchmarks/errors/<label>/<piece>.md lists every note where the engine differs from at
least one annotator; '#' is the index into parsePig(<first gold file in name order>).score.notes, which
engine_dump.mjs reproduces, and 'hard' marks notes where every annotator (two or more) agrees and the
engine differs. PIG-derived: everything read here stays under research/data/.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .model import Passage
from .pig_passages import PieceData, extract_window

_ENGINE = re.compile(r"^(?P<f>[1-5]|-)\s*\((?P<c>\d+)%\)")
_PAGE = re.compile(r"^\d{3}$")


@dataclass(frozen=True)
class GalleryRow:
    piece: str
    index: int
    bar: str
    onset_s: float
    hand: str
    pitch: str
    engine_finger: int | None
    confidence: float | None
    annotators: tuple[int | None, ...]
    hard: bool


def parse_page(piece: str, text: str) -> list[GalleryRow]:
    rows = []
    for line in text.splitlines():
        if not line.startswith("| ") or line.startswith("| #"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 11 or not cells[0].isdigit():
            continue
        m = _ENGINE.match(cells[6])
        rows.append(GalleryRow(piece=piece, index=int(cells[0]), bar=cells[1], onset_s=float(cells[2]), hand=cells[3],
                               pitch=cells[4], engine_finger=int(m["f"]) if m and m["f"] != "-" else None,
                               confidence=int(m["c"]) / 100 if m else None,
                               annotators=tuple(None if a == "-" else int(a) for a in cells[8].split()),
                               hard=cells[10] == "hard"))
    return rows


def read_gallery(directory: Path) -> dict[str, list[GalleryRow]]:
    out: dict[str, list[GalleryRow]] = {}
    for page in sorted(Path(directory).glob("*.md")):
        if _PAGE.match(page.stem):
            out[page.stem] = parse_page(page.stem, page.read_text(encoding="utf-8"))
    return out


def slot_of(dump_piece: dict) -> str:
    return dump_piece["file"].split("-", 1)[1].split("_", 1)[0]


def check_against_dump(rows: dict[str, list[GalleryRow]], dump: dict) -> list[str]:
    """Every hard row must name the dump's note: same hand, pitch and engine finger. A mismatch means the
    gallery came from another engine build, profile or weight set."""
    pig = {p["pigId"]: p for p in dump["pieces"] if p["source"] == "pig"}
    problems = []
    for piece, rs in sorted(rows.items()):
        hard = [r for r in rs if r.hard]
        if not hard:
            continue
        if piece not in pig:
            problems.append(f"{piece}: the dump has no PIG piece {piece}")
            continue
        notes = pig[piece]["notes"]
        for r in hard:
            if not 0 <= r.index < len(notes):
                problems.append(f"{piece} #{r.index}: no such note in the dump")
                continue
            n = notes[r.index]
            for field, g, d in (("hand", r.hand, n["hand"]), ("pitch", r.pitch, n["pitch"]),
                                ("engine finger", r.engine_finger, n["finger"])):
                if g != d:
                    problems.append(f"{piece} #{r.index}: gallery {field} {g!r}, dump {d!r}")
    return problems


def pig_engine_window(piece: PieceData, b1: int, b2: int, hands: list[str], passage_id: str,
                      dump_piece: dict) -> Passage:
    """extract_window(fingers="none"), then the engine's fingers (by PIG note id) on the reviewed hands."""
    p = extract_window(piece, b1, b2, hands, passage_id, fingers="none")
    by_id = {n["id"]: n for n in dump_piece["notes"]}
    p.notes_meta["engine"] = {}
    for hand in hands:
        for e in p.sounding(hand):
            e.fingers = [by_id[sid]["finger"] for sid in e.source_ids]
            for nid, sid in zip(e.ids, e.source_ids):
                n = by_id[sid]
                p.notes_meta["engine"][nid] = {"id": sid, "finger": n["finger"], "confidence": n["confidence"],
                                               "lint": sorted({x.split(":")[0] for x in n["lint"]})}
    return p
