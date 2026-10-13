"""Common data model and loaders for the readability study.

Two sources feed the same structure:

* the Mutopia editorial corpus (``research/data/mutopia_fingering/FingeringFiles/*.txt`` in PIG
  format, hand in the channel column, finger ``0`` = nothing printed; metadata from
  ``manifest.json``), optionally enriched with beats and bar positions produced by
  :mod:`readability.enrich_mutopia` (``research/data/readability/mutopia_beats/<piece_id>.json``);
* the eight library pieces that carry the source edition's fingerings
  (``content/scores/<slug>.fingered.musicxml``), parsed by :mod:`readability.musicxml`.

A :class:`Part` is one two-hand part; its notes are in onset order. ``finger`` is the unsigned
key-press finger (1..5) or 0 when the edition prints nothing on that note.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

from fingering_eval.pig_io import parse_finger, read_pig

RESEARCH = Path(__file__).resolve().parents[1]
ROOT = RESEARCH.parent
DATA = RESEARCH / "data"
MUTOPIA_DIR = DATA / "mutopia_fingering"
BEATS_DIR = DATA / "readability" / "mutopia_beats"
LIBRARY_SCORES = ROOT / "content" / "scores"
LIBRARY_MANIFEST = ROOT / "content" / "manifest.json"

RH = 0
LH = 1
HAND_NAMES = {RH: "R", LH: "L"}

TEACHING_COMPOSERS = {"ClementiM", "DiabelliA", "CzernyC", "BurgmullerJFF", "KuhlauF"}
CONCERT_COMPOSERS = {"ChopinFF", "LisztF", "RachmaninoffS"}
LEVEL_GROUPS = ("teaching", "concert", "other")


@dataclass
class NoteRec:
    """One note of a part."""

    idx: int                 # index in the part (onset order, then hand, then pitch)
    onset: float             # seconds as given by the source (score tempo), used for density
    offset: float
    pitch: int               # MIDI
    hand: int                # 0 = RH, 1 = LH
    finger: int              # 0 = unprinted; 1..5 = printed key-press finger
    finger_raw: str = "0"
    substitution: bool = False
    grace: bool = False
    beat: float | None = None        # onset in quarter-note beats from the start of the part
    dur_beats: float | None = None   # duration in quarter-note beats
    bar: int | None = None           # 0-based bar index (anacrusis = -1)
    bar_pos: float | None = None     # quarter-note beats from the barline
    bar_len: float | None = None     # bar length in quarter-note beats

    @property
    def printed(self) -> bool:
        return self.finger > 0

    @property
    def duration(self) -> float:
        return self.offset - self.onset


@dataclass
class Part:
    id: str
    source: str              # "mutopia" | "library"
    composer: str
    title: str
    level_group: str         # teaching | concert | other (Mutopia) or "library"
    level: int | None        # library level 1..5, else None
    license: str
    notes: list[NoteRec]
    meta: dict = field(default_factory=dict)

    def hand_notes(self, hand: int) -> list[NoteRec]:
        return [n for n in self.notes if n.hand == hand]

    @property
    def n_printed(self) -> int:
        return sum(1 for n in self.notes if n.printed)

    @property
    def density(self) -> float:
        return self.n_printed / len(self.notes) if self.notes else 0.0

    @property
    def beats_known(self) -> bool:
        return all(n.beat is not None for n in self.notes)


def events(notes: list[NoteRec], tol: float = 1e-6) -> list[list[NoteRec]]:
    """Group notes of one hand into simultaneous events (chords), each sorted by pitch."""
    out: list[list[NoteRec]] = []
    for n in sorted(notes, key=lambda x: (x.onset, x.pitch)):
        if out and abs(out[-1][0].onset - n.onset) <= tol and not (n.grace or out[-1][0].grace):
            out[-1].append(n)
        else:
            out.append([n])
    for ev in out:
        ev.sort(key=lambda x: x.pitch)
    return out


# ---------------------------------------------------------------------------------------
# Level grouping
# ---------------------------------------------------------------------------------------

def level_group_of(composer: str, title: str, opus: str) -> str:
    if composer in TEACHING_COMPOSERS:
        return "teaching"
    if composer == "MozartWA" and re.search(r"\b545\b", f"{title} {opus}"):
        return "teaching"
    if composer in CONCERT_COMPOSERS:
        return "concert"
    return "other"


# ---------------------------------------------------------------------------------------
# Mutopia
# ---------------------------------------------------------------------------------------

def load_manifest(path: Path = MUTOPIA_DIR / "manifest.json") -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _read_beats(piece_id: str) -> dict | None:
    p = BEATS_DIR / f"{piece_id}.json"
    if not p.exists():
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def load_mutopia_part(row: dict, with_beats: bool = True) -> Part:
    pid = row["piece_id"]
    pf = read_pig(MUTOPIA_DIR / "FingeringFiles" / f"{pid}-0_fingering.txt")
    beats = _read_beats(pid) if with_beats else None
    if beats is not None and len(beats["notes"]) != len(pf.notes):
        beats = None
    notes: list[NoteRec] = []
    for i, n in enumerate(pf.notes):
        raw = n.finger
        if raw == "0":
            finger, sub = 0, False
        else:
            pf_ = parse_finger(raw)
            finger, sub = abs(pf_.press), pf_.is_substitution
            if not 1 <= finger <= 5:
                finger = 0
        rec = NoteRec(idx=i, onset=n.onset, offset=n.offset, pitch=n.pitch, hand=n.channel,
                      finger=finger, finger_raw=raw, substitution=sub,
                      grace=abs(n.duration - 0.04) < 1e-6)
        if beats is not None:
            b = beats["notes"][i]
            rec.beat, rec.dur_beats = b["beat"], b["dur_beats"]
            rec.bar, rec.bar_pos, rec.bar_len = b["bar"], b["bar_pos"], b["bar_len"]
        notes.append(rec)
    return Part(id=pid, source="mutopia", composer=row["composer"], title=row["title"],
                level_group=level_group_of(row["composer"], row["title"], row.get("opus", "")),
                level=None, license=row["license"], notes=notes,
                meta={"mutopia_id": row["mutopia_id"], "opus": row.get("opus", ""),
                      "source_url": row["source_url"], "ly_file": row["ly_file"],
                      "tempo_bpm_quarter": beats["tempo_bpm_quarter"] if beats else None})


def iter_mutopia(status: str = "ok", with_beats: bool = True, manifest: list[dict] | None = None) -> Iterator[Part]:
    for row in manifest or load_manifest():
        if status and row["status"] != status:
            continue
        yield load_mutopia_part(row, with_beats=with_beats)


# ---------------------------------------------------------------------------------------
# Library (MusicXML with editorial fingerings)
# ---------------------------------------------------------------------------------------

def load_library_manifest(path: Path = LIBRARY_MANIFEST) -> dict[str, dict]:
    with open(path, encoding="utf-8") as f:
        return {x["slug"]: x for x in json.load(f)}


def iter_library(scores_dir: Path = LIBRARY_SCORES) -> Iterator[Part]:
    from readability.musicxml import parse_fingered_musicxml

    man = load_library_manifest()
    for p in sorted(scores_dir.glob("*.fingered.musicxml")):
        slug = p.name.replace(".fingered.musicxml", "")
        m = man.get(slug, {})
        notes = parse_fingered_musicxml(p, tempo_bpm=m.get("tempoBpm") or 100)
        yield Part(id=f"lib:{slug}", source="library", composer=m.get("composer", ""),
                   title=m.get("title", slug), level_group="library", level=m.get("level"),
                   license=(m.get("source") or {}).get("license", ""), notes=notes,
                   meta={"slug": slug, "source": (m.get("source") or {}).get("name", "")})


def load_all(with_beats: bool = True) -> list[Part]:
    return list(iter_mutopia(with_beats=with_beats)) + list(iter_library())
