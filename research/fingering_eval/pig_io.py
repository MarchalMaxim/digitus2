"""Reading and writing PIG-format fingering files.

PIG format (Nakamura, Saito & Yoshii 2020; README.pdf of PIG Dataset v1.2)
-------------------------------------------------------------------------
A fingering file is UTF-8 text. Lines starting with ``//`` are header/comment lines
(every PIG v1.2 file starts with ``//Version: PianoFingering_v170101``). Every other
non-empty line is one note, in order of onset time, with 8 whitespace (tab) separated
columns::

    (note ID) (onset time) (offset time) (spelled pitch) (onset velocity) (offset velocity) (channel) (finger number)
    0         0.156289     0.302811      C4              64               80                0         1

* note ID       0-based integer, consecutive within the file
* onset/offset  seconds (synthesised from score-editing software, not human timing)
* spelled pitch letter + accidentals (``#``, ``##``, ``b``, ``bb``; the official C++ also
                accepts ``+``/``-``) + octave, A4 = 440 Hz, i.e. C4 = MIDI 60. In v1.2 the
                spelling is effectively MIDI-derived (only C C# D Eb E F F# G G# A Bb B occur).
* velocities    MIDI-like integers
* channel       0 = right hand (RH), 1 = left hand (LH)
* finger        RH 1..5 (thumb..little), LH -1..-5. Substitutions are joined with ``_``:
                ``3_1`` = pressed with RH 3, then substituted by RH 1; LH ``-2_-1``.
                v1.2 also contains a few irregular strings (``4_``, ``-2_1``, ``-1_1``,
                ``2_4_5``) which :func:`parse_finger` handles and the validators flag.

The paper (Sec. 4) states that for analyses and experiments "only the finger firstly used
for pressing the piano key" is used; :attr:`Note.press_finger` gives that value.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Iterable, Sequence

PIG_VERSION_LINE = "//Version: PianoFingering_v170101"

_LETTER_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_ACC = {"": 0, "#": 1, "##": 2, "b": -1, "bb": -2, "+": 1, "++": 2, "-": -1, "--": -2, "x": 2}
_SPELLED_RE = re.compile(r"^([A-Ga-g])(##|bb|\+\+|--|#|b|\+|-|x)?(-?\d+)$")
_SHARP_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]  # PIG v1.2 convention


def spelled_to_midi(sp: str) -> int:
    """Convert a PIG spelled pitch (``C4``, ``F#3``, ``Bb5``, ``C##5``) to a MIDI number (C4=60).

    Mirrors ``SitchToPitch`` of the official C++ (BasicPitchCalculation_v170101.hpp) but
    also accepts multi-digit/negative octaves. Raises ``ValueError`` on malformed input.
    """
    m = _SPELLED_RE.match(sp.strip())
    if not m:
        raise ValueError(f"malformed spelled pitch: {sp!r}")
    letter, acc, octv = m.group(1).upper(), m.group(2) or "", int(m.group(3))
    return 12 * (octv + 1) + _LETTER_PC[letter] + _ACC[acc]


def midi_to_spelled(p: int) -> str:
    """MIDI number -> PIG-style spelling (sharps for C#/F#/G#, flats for Eb/Bb, as PIG v1.2)."""
    return f"{_SHARP_NAMES[p % 12]}{p // 12 - 1}"


@dataclass(frozen=True)
class ParsedFinger:
    """A parsed finger string.

    ``fingers`` holds the signed finger sequence (``(3, 1)`` for ``"3_1"``; ``(-2, -1)``
    for ``"-2_-1"``). ``hand`` is +1 (RH) / -1 (LH) taken from the first (key-press)
    finger. ``irregular`` explains anything non-canonical (empty substitution part,
    hand change inside a substitution, finger outside 1..5, ...).
    """

    raw: str
    fingers: tuple[int, ...]
    irregular: tuple[str, ...] = ()

    @property
    def press(self) -> int:
        """Signed finger that presses the key (first element)."""
        return self.fingers[0]

    @property
    def release(self) -> int:
        """Signed finger holding the key at the end (last element of a substitution)."""
        return self.fingers[-1]

    @property
    def is_substitution(self) -> bool:
        return len(self.fingers) > 1

    @property
    def hand(self) -> int:
        return 1 if self.press > 0 else -1


def parse_finger(s: str) -> ParsedFinger:
    """Parse a PIG finger field.

    Canonical forms: ``"1".."5"``, ``"-1".."-5"``, substitutions ``"a_b"`` (RH) and
    ``"-a_-b"`` (LH), chains ``"a_b_c"``. Tolerated irregular forms (flagged in
    ``irregular``): trailing/empty parts (``"4_"``), a substitution part with the other
    hand's sign (``"-2_1"``), unsigned LH substitution parts, values outside 1..5.
    Raises ``ValueError`` if no finger can be read at all.
    """
    raw = s.strip()
    parts = raw.split("_")
    fingers: list[int] = []
    irregular: list[str] = []
    for i, part in enumerate(parts):
        if part == "":
            irregular.append("empty substitution part")
            continue
        try:
            v = int(part)
        except ValueError as e:
            raise ValueError(f"malformed finger field {s!r}") from e
        if v == 0 or abs(v) > 5:
            irregular.append(f"finger out of range: {v}")
        fingers.append(v)
    if not fingers:
        raise ValueError(f"malformed finger field {s!r}")
    if any((f > 0) != (fingers[0] > 0) for f in fingers[1:]):
        irregular.append("substitution changes hand sign")
    if len(fingers) > 2:
        irregular.append("chained substitution (more than two fingers)")
    if len(fingers) >= 2 and any(fingers[i] == fingers[i + 1] for i in range(len(fingers) - 1)):
        irregular.append("substitution by the same finger")
    return ParsedFinger(raw, tuple(fingers), tuple(irregular))


@dataclass(frozen=True)
class Note:
    """One note of a PIG fingering file (all columns kept verbatim plus derived fields)."""

    id: str
    onset: float
    offset: float
    spelled_pitch: str
    onset_velocity: int
    offset_velocity: int
    channel: int
    finger: str  # raw finger field, e.g. "3", "-2", "3_1"
    line_no: int = 0  # 1-based line number in the source file (0 if synthetic)

    @property
    def pitch(self) -> int:
        """MIDI pitch number (C4 = 60)."""
        return spelled_to_midi(self.spelled_pitch)

    @property
    def parsed(self) -> ParsedFinger:
        return parse_finger(self.finger)

    @property
    def press_finger(self) -> int:
        """Signed key-press finger (first finger of a substitution) - what the paper evaluates."""
        return self.parsed.press

    @property
    def finger_number(self) -> int:
        """Unsigned key-press finger 1..5."""
        return abs(self.press_finger)

    @property
    def hand(self) -> str:
        """'R' or 'L' from the channel column (0 = RH, 1 = LH)."""
        return "R" if self.channel == 0 else "L"

    @property
    def duration(self) -> float:
        return self.offset - self.onset

    def with_finger(self, finger: str | int) -> "Note":
        return replace(self, finger=str(finger))


@dataclass
class PigFile:
    """A parsed fingering file: header lines + notes."""

    notes: list[Note]
    header: list[str] = field(default_factory=lambda: [PIG_VERSION_LINE])
    path: Path | None = None

    @property
    def piece_id(self) -> str | None:
        return pig_ids(self.path)[0] if self.path else None

    @property
    def annotation_id(self) -> str | None:
        return pig_ids(self.path)[1] if self.path else None

    def fingers(self) -> list[str]:
        return [n.finger for n in self.notes]

    def press_fingers(self) -> list[int]:
        return [n.press_finger for n in self.notes]

    def __len__(self) -> int:
        return len(self.notes)


_PIG_NAME_RE = re.compile(r"^(?P<piece>.+?)-(?P<ann>[^-_]+)_fingering\.txt$")


def pig_ids(path: str | os.PathLike | None) -> tuple[str | None, str | None]:
    """``.../001-5_fingering.txt`` -> ``("001", "5")``; non-matching names -> (stem, None)."""
    if path is None:
        return None, None
    name = Path(path).name
    m = _PIG_NAME_RE.match(name)
    if m:
        return m.group("piece"), m.group("ann")
    return Path(path).stem, None


def parse_pig_lines(lines: Iterable[str], path: Path | None = None, strict: bool = True) -> PigFile:
    """Parse PIG lines. ``strict`` raises on malformed note lines, otherwise skips them."""
    header: list[str] = []
    notes: list[Note] = []
    for ln, line in enumerate(lines, start=1):
        s = line.strip().lstrip("﻿")
        if not s:
            continue
        if s.startswith("//") or s.startswith("#"):
            header.append(s)
            continue
        parts = s.split()
        try:
            if len(parts) < 8:
                raise ValueError(f"expected 8 columns, got {len(parts)}")
            notes.append(Note(id=parts[0], onset=float(parts[1]), offset=float(parts[2]),
                              spelled_pitch=parts[3], onset_velocity=int(float(parts[4])),
                              offset_velocity=int(float(parts[5])), channel=int(parts[6]),
                              finger=parts[7], line_no=ln))
        except ValueError as e:
            if strict:
                raise ValueError(f"{path or '<input>'}:{ln}: cannot parse {line!r}: {e}") from e
    return PigFile(notes=notes, header=header or [PIG_VERSION_LINE], path=Path(path) if path else None)


def read_pig(path: str | os.PathLike, strict: bool = True) -> PigFile:
    """Read a PIG fingering file."""
    p = Path(path)
    with open(p, encoding="utf-8-sig") as f:
        return parse_pig_lines(f, path=p, strict=strict)


def format_note(n: Note) -> str:
    return (f"{n.id}\t{n.onset:.6f}\t{n.offset:.6f}\t{n.spelled_pitch}\t{n.onset_velocity}\t"
            f"{n.offset_velocity}\t{n.channel}\t{n.finger}")


def write_pig(path: str | os.PathLike, notes: Sequence[Note], header: Sequence[str] | None = None) -> None:
    """Write notes in PIG format (tab separated, ``//Version`` header first)."""
    hdr = list(header) if header else [PIG_VERSION_LINE]
    if not any(h.startswith("//Version:") for h in hdr):
        hdr.insert(0, PIG_VERSION_LINE)
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        for h in hdr:
            f.write(h.rstrip("\n") + "\n")
        for n in notes:
            f.write(format_note(n) + "\n")
    os.replace(tmp, p)


def make_note(idx: int, onset: float, offset: float, pitch: int | str, channel: int,
              finger: str | int | None, onset_velocity: int = 64, offset_velocity: int = 80) -> Note:
    """Convenience constructor (pitch may be MIDI int or spelled string; finger None -> '0')."""
    sp = midi_to_spelled(pitch) if isinstance(pitch, int) else pitch
    return Note(id=str(idx), onset=float(onset), offset=float(offset), spelled_pitch=sp,
                onset_velocity=onset_velocity, offset_velocity=offset_velocity, channel=int(channel),
                finger="0" if finger is None else str(finger))


# ---------------------------------------------------------------------------------------
# PIG dataset layout helpers
# ---------------------------------------------------------------------------------------

def fingering_dir(root: str | os.PathLike) -> Path:
    """Accept ``research/data/pig`` or ``research/data/pig/FingeringFiles``."""
    r = Path(root)
    if (r / "FingeringFiles").is_dir():
        return r / "FingeringFiles"
    return r


def list_pig_files(root: str | os.PathLike) -> list[Path]:
    d = Path(root)
    if d.is_file():
        return [d]
    return sorted(fingering_dir(d).glob("*_fingering.txt"))


def load_pig_dataset(root: str | os.PathLike, strict: bool = True) -> dict[str, dict[str, PigFile]]:
    """Return ``{piece_id: {annotation_id: PigFile}}`` for every ``*_fingering.txt`` under root."""
    out: dict[str, dict[str, PigFile]] = {}
    for p in list_pig_files(root):
        piece, ann = pig_ids(p)
        out.setdefault(piece, {})[ann or "0"] = read_pig(p, strict=strict)
    return dict(sorted(out.items()))


def read_pig_list_csv(root: str | os.PathLike) -> dict[str, dict]:
    """Parse ``List.csv`` of PIG: piece metadata + annotator initials per fingering slot.

    Returns ``{piece_id: {"composer", "piece", "bars", "notes", "n_fingerings",
    "annotators": {slot: initials}}}``.
    """
    import csv

    r = Path(root)
    path = r / "List.csv" if (r / "List.csv").exists() else r.parent / "List.csv"
    out: dict[str, dict] = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    head = rows[0]
    slot_cols = list(range(6, len(head)))
    for row in rows[1:]:
        if not row or not row[0].strip():
            continue
        pid = row[0].strip()
        ann = {}
        for k, col in enumerate(slot_cols, start=1):
            if col < len(row) and row[col].strip():
                ann[str(k)] = row[col].strip()
        out[pid] = {"composer": row[1], "piece": row[2], "bars": int(row[3]) if row[3].strip() else None,
                    "notes": int(row[4]) if row[4].strip() else None,
                    "n_fingerings": int(row[5]) if row[5].strip() else None, "annotators": ann}
    return out
