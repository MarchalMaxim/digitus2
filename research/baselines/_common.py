"""Shared helpers for the baseline wrappers (PIG I/O, splits, run bookkeeping).

Every ``run_<name>.py`` wrapper in this directory reads PIG fingering files
(the finger column of the input is ignored / blanked before it reaches the
third-party code) and writes one PIG file per input piece with the predicted
fingers to ``research/baselines/outputs/<name>/``.  A ``run_log.json`` next to
the predictions records per-piece wall-clock runtime and failures.

Only the standard library is used here so that every wrapper (and every
virtual environment) can import it.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Sequence

BASELINES_DIR = Path(__file__).resolve().parent
RESEARCH_DIR = BASELINES_DIR.parent
THIRD_PARTY = BASELINES_DIR / "third_party"
OUTPUTS = BASELINES_DIR / "outputs"

PIG_HEADER = "//Version: PianoFingering_v170101"

# Candidate locations of PIG v1.2 FingeringFiles, in order of preference.
PIG_DIR_CANDIDATES = [
    RESEARCH_DIR / "data" / "pig" / "FingeringFiles",
    THIRD_PARTY / "_pig_copy" / "PianoFingeringDataset_v1.2" / "FingeringFiles",
]

# Split files, in order of preference.  The first one is produced by the
# datasets agent; the second ships with Ramoneda et al. (2022).
SPLIT_CANDIDATES = [
    RESEARCH_DIR / "data" / "splits" / "pig_official.json",
    THIRD_PARTY / "PRamoneda__Automatic-Piano-Fingering" / "PianoFingeringDataset_v1.02" / "official_split.json",
]


def default_pig_dir() -> Path:
    env = os.environ.get("PIG_FINGERING_DIR")
    if env:
        return Path(env)
    for cand in PIG_DIR_CANDIDATES:
        if cand.is_dir() and any(cand.glob("*_fingering.txt")):
            return cand
    raise FileNotFoundError(
        "PIG FingeringFiles not found; looked in: " + ", ".join(map(str, PIG_DIR_CANDIDATES))
    )


# --------------------------------------------------------------------------- PIG I/O

_SPELLED_RE = re.compile(r"^([A-Ga-g])([#b]*)(-?\d+)$")
_STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def spelled_to_midi(spelled: str) -> int:
    """'C4' -> 60, 'Bb3' -> 58, 'B#3' -> 60, 'Cb4' -> 59 (A4 = 69)."""
    m = _SPELLED_RE.match(spelled)
    if not m:
        raise ValueError(f"bad spelled pitch {spelled!r}")
    step, acc, octave = m.groups()
    alter = acc.count("#") - acc.count("b")
    return (int(octave) + 1) * 12 + _STEP[step.upper()] + alter


_PC_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]


def midi_to_spelled(midi: int) -> str:
    """60 -> 'C4' using the PIG v1.2 canonical spellings (C#, Eb, F#, G#, Bb)."""
    return f"{_PC_NAMES[midi % 12]}{midi // 12 - 1}"


@dataclass
class PigNote:
    idx: int            # 0-based row index in the file (output order is preserved)
    note_id: str
    onset_str: str
    offset_str: str
    spelled: str
    onset_vel: str
    offset_vel: str
    channel: int        # 0 = right hand, 1 = left hand
    finger: str         # as written, e.g. "3", "-2", "3_1"

    @property
    def onset(self) -> float:
        return float(self.onset_str)

    @property
    def offset(self) -> float:
        return float(self.offset_str)

    @property
    def pitch(self) -> int:
        return spelled_to_midi(self.spelled)

    @property
    def hand(self) -> str:
        return "right" if self.channel == 0 else "left"


def read_pig(path: os.PathLike | str) -> list[PigNote]:
    notes: list[PigNote] = []
    with open(path, "r", encoding="utf-8-sig") as fh:
        for line in fh:
            if not line.strip() or line.startswith("//") or line.startswith("#"):
                continue
            cols = line.split()
            if len(cols) < 7:
                raise ValueError(f"{path}: malformed line {line!r}")
            finger = cols[7] if len(cols) > 7 else "0"
            notes.append(PigNote(len(notes), cols[0], cols[1], cols[2], cols[3], cols[4], cols[5],
                                 int(cols[6]), finger))
    return notes


def strike_finger(finger: str) -> int:
    """First (striking) finger of a PIG finger token: '3_1' -> 3, '-5_-1' -> -5."""
    m = re.match(r"^(-?\d+)", str(finger).strip())
    return int(m.group(1)) if m else 0


def signed_finger(finger: int, channel: int) -> int:
    """Map an unsigned finger 1..5 to PIG convention for the given channel."""
    f = abs(int(finger))
    return f if channel == 0 else -f


def write_pig(path: os.PathLike | str, notes: Sequence[PigNote], fingers: Sequence[int | str]) -> None:
    """Write ``notes`` with predicted ``fingers`` (PIG sign convention, LH negative)."""
    if len(fingers) != len(notes):
        raise ValueError(f"{len(fingers)} fingers for {len(notes)} notes")
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(PIG_HEADER + "\n")
        for n, f in zip(notes, fingers):
            fh.write("\t".join([n.note_id, n.onset_str, n.offset_str, n.spelled, n.onset_vel,
                                n.offset_vel, str(n.channel), str(f)]) + "\n")


def write_blanked_input(path: os.PathLike | str, notes: Sequence[PigNote], blank: str = "0",
                        signed: bool = False) -> None:
    """Copy of the input with the finger column overwritten (third-party code must never see GT).

    With ``signed=True`` the blank is written as ``blank`` for right-hand notes and
    ``-blank`` for left-hand notes, because some programs (e.g. Nakamura's 2nd/3rd-order
    HMM) derive the hand from the sign of the input finger instead of the channel column.
    """
    if signed:
        write_pig(path, notes, [blank if n.channel == 0 else "-" + blank for n in notes])
    else:
        write_pig(path, notes, [blank] * len(notes))


# --------------------------------------------------------------------------- splits

def piece_files(pig_dir: os.PathLike | str | None = None) -> dict[str, list[str]]:
    pig_dir = Path(pig_dir) if pig_dir else default_pig_dir()
    out: dict[str, list[str]] = {}
    for p in sorted(pig_dir.glob("*_fingering.txt")):
        out.setdefault(p.name[:3], []).append(p.name)
    return out


def _pieces_from_names(names: Iterable) -> list[str]:
    out = set()
    for n in names:
        n = str(n)
        m = re.match(r"^(\d{3})", os.path.basename(n))
        if m:
            out.add(m.group(1))
        elif n.isdigit():
            out.add(f"{int(n):03d}")
    return sorted(out)


def _split_part_pieces(val) -> list[str]:
    if isinstance(val, dict):  # e.g. {"pieces": [...], "files": [...]}
        val = val.get("pieces") or val.get("files") or list(val.keys())
    return _pieces_from_names(val)


def load_split(split_path: os.PathLike | str | None = None, name: str | None = None) -> dict[str, list[str]]:
    """Return {'train': [...], 'val': [...], 'test': [...]} as 3-digit piece ids.

    Understands the datasets agent's research/data/splits/pig_official.json
    ({"default_split": "nakamura2020", "splits": {"nakamura2020": {...}, "ramoneda2022": {...}}};
    ``name`` picks one, default = its default_split) and flat files with train/val/test lists
    (Ramoneda et al.'s official_split.json).  Both official splits have the same 30 test
    pieces (001-030) and the same 120 training pieces (031-150); ramoneda2022 additionally
    holds 20 of the 120 out as a validation set.
    """
    cands = [Path(split_path)] if split_path else SPLIT_CANDIDATES
    for cand in cands:
        if not cand.is_file():
            continue
        data = json.loads(cand.read_text(encoding="utf-8"))
        chosen = None
        if isinstance(data, dict) and isinstance(data.get("splits"), dict):
            splits = data["splits"]
            key = name or data.get("default_split") or next(iter(splits))
            if key not in splits:
                if name:
                    continue
                key = next(iter(splits))
            data, chosen = splits[key], key
        elif name and name != "ramoneda2022" and "official_split" in cand.name:
            continue
        split: dict[str, list[str]] = {}
        for key in ("train", "val", "validation", "test"):
            if key in data:
                split["val" if key == "validation" else key] = _split_part_pieces(data[key])
        if split.get("test"):
            split.setdefault("val", [])
            if not split.get("train"):
                split["train"] = sorted(set(f"{i:03d}" for i in range(1, 151))
                                        - set(split["test"]) - set(split["val"]))
            split["_source"] = [str(cand) + (f"#{chosen}" if chosen else "")]
            return split
    # Fallback: Nakamura et al. (2020): test = Bach/Mozart/Chopin sets (001-030), train = 031-150.
    return {"train": [f"{i:03d}" for i in range(31, 151)], "val": [],
            "test": [f"{i:03d}" for i in range(1, 31)], "_source": ["builtin:Nakamura2020"]}


def resolve_pieces(spec: str, split: dict[str, list[str]] | None = None) -> list[str]:
    split = split or load_split()
    spec = spec.strip()
    if spec == "all":
        return [f"{i:03d}" for i in range(1, 151)]
    if spec in ("test", "train", "val"):
        return list(split[spec])
    if spec == "trainval":
        return sorted(set(split["train"]) | set(split["val"]))
    out = []
    for tok in spec.split(","):
        tok = tok.strip()
        if "-" in tok:
            a, b = tok.split("-")
            out += [f"{i:03d}" for i in range(int(a), int(b) + 1)]
        elif tok:
            out.append(f"{int(tok):03d}")
    return out


def input_file(piece: str, pig_dir: os.PathLike | str | None = None) -> Path:
    """The file whose notes (and hand/channel assignment) are used as model input.

    Convention (same as Nakamura's released results): the lowest-numbered
    annotator file of the piece, normally ``<piece>-1_fingering.txt``.
    """
    pig_dir = Path(pig_dir) if pig_dir else default_pig_dir()
    files = sorted(pig_dir.glob(f"{piece}-*_fingering.txt"),
                   key=lambda p: int(p.name.split("-")[1].split("_")[0]))
    if not files:
        raise FileNotFoundError(f"no fingering file for piece {piece} in {pig_dir}")
    return files[0]


def gt_files(piece: str, pig_dir: os.PathLike | str | None = None) -> list[Path]:
    pig_dir = Path(pig_dir) if pig_dir else default_pig_dir()
    return sorted(pig_dir.glob(f"{piece}-*_fingering.txt"),
                  key=lambda p: int(p.name.split("-")[1].split("_")[0]))


# --------------------------------------------------------------------------- run bookkeeping

@dataclass
class RunLog:
    name: str
    out_dir: Path
    meta: dict = field(default_factory=dict)
    pieces: dict = field(default_factory=dict)

    def record(self, piece: str, seconds: float, status: str = "ok", n_notes: int | None = None,
               error: str | None = None, **extra) -> None:
        entry = {"seconds": round(seconds, 4), "status": status}
        if n_notes is not None:
            entry["n_notes"] = n_notes
        if error:
            entry["error"] = error[-4000:]
        entry.update(extra)
        self.pieces[piece] = entry

    def save(self) -> Path:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        ok = [v for v in self.pieces.values() if v["status"] == "ok"]
        summary = {
            "n_pieces": len(self.pieces),
            "n_ok": len(ok),
            "total_seconds": round(sum(v["seconds"] for v in ok), 3),
            "mean_seconds_per_piece": round(sum(v["seconds"] for v in ok) / len(ok), 4) if ok else None,
        }
        path = self.out_dir / "run_log.json"
        path.write_text(json.dumps({"name": self.name, "meta": self.meta, "summary": summary,
                                    "pieces": self.pieces}, indent=1), encoding="utf-8")
        return path


def base_arg_parser(description: str, default_name: str) -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=description)
    ap.add_argument("--pieces", default="test",
                    help="'test' (default), 'train', 'val', 'all', or ids like '1-30' / '001,005'")
    ap.add_argument("--pig-dir", default=None, help="PIG FingeringFiles directory")
    ap.add_argument("--split", default=None, help="split json (default: research/data/splits/pig_official.json)")
    ap.add_argument("--out-dir", default=None, help=f"output dir (default outputs/{default_name})")
    ap.add_argument("--name", default=default_name, help="baseline name used for the output dir")
    ap.add_argument("--skip-existing", action="store_true", help="skip pieces whose output exists")
    return ap


def resolve_common(args) -> tuple[Path, list[str], Path]:
    pig_dir = Path(args.pig_dir) if args.pig_dir else default_pig_dir()
    pieces = resolve_pieces(args.pieces, load_split(args.split))
    out_dir = Path(args.out_dir) if args.out_dir else OUTPUTS / args.name
    out_dir.mkdir(parents=True, exist_ok=True)
    return pig_dir, pieces, out_dir


def run_pieces(name: str, pieces: Sequence[str], pig_dir: Path, out_dir: Path,
               predict: Callable[[list[PigNote], Path], list], meta: dict | None = None,
               skip_existing: bool = False, verbose: bool = True) -> RunLog:
    """Generic per-piece loop: ``predict(notes, input_path) -> signed fingers``.

    ``predict`` receives the notes with their original finger column; wrappers
    must not pass that column to third-party code (use write_blanked_input).
    """
    log = RunLog(name, out_dir, meta=meta or {})
    old_log = out_dir / "run_log.json"
    if skip_existing and old_log.is_file():
        try:
            log.pieces.update(json.loads(old_log.read_text(encoding="utf-8")).get("pieces", {}))
        except Exception:
            pass
    for piece in pieces:
        inp = input_file(piece, pig_dir)
        outp = out_dir / inp.name
        if skip_existing and outp.is_file() and log.pieces.get(piece, {}).get("status") == "ok":
            continue
        notes = read_pig(inp)
        t0 = time.perf_counter()
        try:
            fingers = predict(notes, inp)
            dt = time.perf_counter() - t0
            if len(fingers) != len(notes):
                raise RuntimeError(f"predicted {len(fingers)} fingers for {len(notes)} notes")
            write_pig(outp, notes, fingers)
            log.record(piece, dt, "ok", n_notes=len(notes))
            if verbose:
                print(f"[{name}] {piece}: {len(notes)} notes in {dt:.2f}s", flush=True)
        except Exception as exc:  # keep going; failures are part of the benchmark
            dt = time.perf_counter() - t0
            log.record(piece, dt, "error", n_notes=len(notes),
                       error=f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}")
            if verbose:
                print(f"[{name}] {piece}: FAILED after {dt:.2f}s: {type(exc).__name__}: {exc}",
                      file=sys.stderr, flush=True)
        log.save()
    log.save()
    return log
