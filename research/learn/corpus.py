"""Corpora as training/evaluation examples (one example per hand of a piece).

Loads PIG train/validation pieces, the textbook oracle, the Beringer corpus and the Mutopia
halves, builds the engine's hand sequences and gold finger arrays (``0`` = unfingered /
unknown), and caches the full-family feature tensors on disk (``research/learn/cache``,
gitignored) so every experiment process starts quickly.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import pickle
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

RESEARCH = Path(__file__).resolve().parents[1]
ROOT = RESEARCH.parent
DATA = RESEARCH / "data"
# Feature cache: outside the repository (hundreds of MB), overridable with DIGITUS2_LEARN_CACHE.
CACHE = Path(os.environ.get("DIGITUS2_LEARN_CACHE", Path(tempfile.gettempdir()) / "digitus2-learn-cache"))
if str(RESEARCH) not in sys.path:
    sys.path.insert(0, str(RESEARCH))

from fingering_eval.datasets import load_beringer, load_mutopia, load_pig  # noqa: E402
from fingering_eval.pig_io import Note, PigFile, parse_finger  # noqa: E402
from fingering_eval.validate import is_labeled  # noqa: E402

from .features import FAMILY_IDS, FAMILY_ORDER, FeatureSet, Tensors, build_tensors  # noqa: E402
from .sequence import InputNote, SeqNote, build_hand_sequence  # noqa: E402

PIG_SPLIT = DATA / "splits" / "pig_official.json"
PIG_VALIDATION = DATA / "splits" / "pig_validation.json"
MUTOPIA_SPLIT = DATA / "splits" / "mutopia_split.json"
TEXTBOOK = ROOT / "benchmarks" / "textbook"
BERINGER_EXCLUDED_SOURCE = "broken_chords/csharp_minor.abcd"


@dataclass
class HandExample:
    id: str
    corpus: str
    piece: str
    hand: str
    seq: list[SeqNote]
    golds: np.ndarray  # (K, n) int8, 0 = unknown
    slots: list[str]
    weight: float = 1.0
    full: Tensors | None = None  # tensors over the full family list
    _proj: dict = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.seq)

    def fingered(self) -> int:
        return int((self.golds != 0).any(axis=0).sum())

    def tensors(self, fs: FeatureSet) -> Tensors:
        """Tensors restricted to ``fs`` (index remapping of the full-family tensors)."""
        if self.full is None:
            self.full = build_tensors(self.seq, FULL_FS, self.hand)
        if fs.key == FULL_FS.key:
            return self.full
        t = self._proj.get(fs.key)
        if t is None:
            t = project_tensors(self.full, fs)
            self._proj[fs.key] = t
        return t


@dataclass
class Piece:
    corpus: str
    id: str
    notes: list[Note]  # file order of the base annotation
    annotations: dict[str, list[Note]]  # slot -> notes (same order)
    hands: dict[str, HandExample]
    license: str = ""

    def examples(self) -> list[HandExample]:
        return [self.hands[h] for h in ("R", "L") if h in self.hands]


FULL_FS = FeatureSet(FAMILY_ORDER)
_FULL_MAP_CACHE: dict[str, np.ndarray] = {}


def project_tensors(full: Tensors, fs: FeatureSet) -> Tensors:
    m = _FULL_MAP_CACHE.get(fs.key)
    if m is None:
        m = np.full(FULL_FS.n + 1, fs.n, dtype=np.int32)
        for k, rid in enumerate(FULL_FS.ids):
            j = fs.index.get(rid)
            if j is not None:
                m[k] = j
        _FULL_MAP_CACHE[fs.key] = m
    return Tensors(full.n, m[full.u_idx], full.u_val, m[full.p_idx], full.p_val, m[full.t_idx], full.t_val,
                   full.p_hard, full.t_hard)


# --- building examples ----------------------------------------------------------------------

def _slot_key(s: str):
    return (0, int(s)) if s.isdigit() else (1, s)


def _hand_of(n: Note) -> str:
    return "R" if n.channel == 0 else "L"


def _gold_finger(raw: str, hand: str) -> int:
    """Unsigned key-press finger for ``hand``; 0 when unlabeled or annotated for the other hand."""
    if not is_labeled(Note("", 0, 0, "C4", 0, 0, 0, raw)):
        return 0
    try:
        press = parse_finger(raw).press
    except ValueError:
        return 0
    if press == 0 or abs(press) > 5:
        return 0
    if (press > 0) != (hand == "R"):
        return 0
    return abs(press)


def piece_from_files(corpus: str, piece_id: str, files: dict[str, PigFile], weight: float = 1.0,
                     license: str = "") -> Piece:
    slots = sorted(files, key=_slot_key)
    base = files[slots[0]].notes
    annotations = {s: files[s].notes for s in slots}
    for s in slots[1:]:
        ns = annotations[s]
        if len(ns) != len(base) or any(a.pitch != b.pitch for a, b in zip(ns, base)):
            raise ValueError(f"{corpus}:{piece_id}: annotation {s} has different notes")
    inputs = [InputNote(n.id, n.onset, n.offset, n.pitch, _hand_of(n)) for n in base]
    by_id = {n.id: k for k, n in enumerate(base)}
    hands: dict[str, HandExample] = {}
    for hand in ("R", "L"):
        seq = build_hand_sequence(inputs, hand)
        if not seq:
            continue
        golds = np.zeros((len(slots), len(seq)), dtype=np.int8)
        for k, s in enumerate(slots):
            ns = annotations[s]
            for i, sn in enumerate(seq):
                golds[k, i] = _gold_finger(ns[by_id[sn.note_id]].finger, hand)
        keep = [k for k in range(len(slots)) if (golds[k] != 0).any()]
        if not keep:
            continue
        hands[hand] = HandExample(f"{corpus}:{piece_id}:{hand}", corpus, piece_id, hand, seq,
                                  golds[keep], [slots[k] for k in keep], weight)
    return Piece(corpus, piece_id, base, annotations, hands, license)


def piece_from_textbook(entry: dict, weight: float = 0.5) -> Piece:
    hand = "R" if str(entry["hand"]).lower() in ("r", "rh", "right") else "L"
    ch = 0 if hand == "R" else 1
    midi = entry["midi"]
    fings = [entry["fingers"]] + [a["fingers"] for a in entry.get("alternatives", []) if len(a.get("fingers", [])) == len(midi)]
    files: dict[str, PigFile] = {}
    from fingering_eval.pig_io import make_note

    for k, fs in enumerate(fings):
        notes = [make_note(i, i * 0.5, (i + 1) * 0.5, m, ch, (f if hand == "R" else -f)) for i, (m, f) in enumerate(zip(midi, fs))]
        files[str(k + 1)] = PigFile(notes=notes)
    return piece_from_files("textbook", entry["id"], files, weight)


# --- corpora ----------------------------------------------------------------------------------

def pig_pieces(subset: str) -> list[str]:
    """``train`` = PIG train minus validation, ``validation`` = the 20 fixed pieces, ``trainall``."""
    split = json.loads(PIG_SPLIT.read_text(encoding="utf-8"))["splits"]["nakamura2020"]
    val = json.loads(PIG_VALIDATION.read_text(encoding="utf-8"))["pieces"]
    train = split["train"]["pieces"]
    if subset == "validation":
        return list(val)
    if subset == "train":
        return [p for p in train if p not in set(val)]
    if subset == "trainall":
        return list(train)
    raise KeyError(subset)


def load_pig_corpus(subset: str) -> list[Piece]:
    wanted = set(pig_pieces(subset))
    data = load_pig(split="train")
    return [piece_from_files("pig", p, files) for p, files in data.items() if p in wanted]


def load_textbook_corpus() -> list[Piece]:
    out = []
    for name in ("scales", "arpeggios", "chromatic"):
        raw = json.loads((TEXTBOOK / f"{name}.json").read_text(encoding="utf-8"))
        for e in raw["entries"]:
            if not e.get("midi") or len(e["midi"]) != len(e.get("fingers", [])):
                continue
            out.append(piece_from_textbook(e))
    return out


def beringer_excluded_pieces() -> set[str]:
    out = set()
    with open(DATA / "beringer_fingering" / "manifest.csv", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if row["source"] == BERINGER_EXCLUDED_SOURCE:
                out.add(row["piece_id"])
    return out


def load_beringer_corpus(weight: float = 0.5) -> list[Piece]:
    excluded = beringer_excluded_pieces()
    data = load_beringer()
    return [piece_from_files("beringer", p, files, weight) for p, files in data.items() if p not in excluded]


def mutopia_manifest() -> list[dict]:
    return json.loads((DATA / "mutopia_fingering" / "manifest.json").read_text(encoding="utf-8"))


def load_mutopia_corpus(subset: str) -> list[Piece]:
    """``train`` / ``test`` halves of ``mutopia_split.json`` (status ok only)."""
    split = json.loads(MUTOPIA_SPLIT.read_text(encoding="utf-8"))
    wanted = set(split["splits"]["piece70_30"][subset]["pieces"])
    meta = {m["piece_id"]: m for m in mutopia_manifest()}
    data = load_mutopia()
    out = []
    for p, files in data.items():
        if p not in wanted or meta.get(p, {}).get("status") != "ok":
            continue
        piece = piece_from_files("mutopia", p, files, 1.0, meta[p].get("license", ""))
        for ex in piece.examples():
            ex.weight = min(1.0, ex.fingered() / 50)
        out.append(piece)
    return out


CV_FOLDS = 5


def pig_cv_pieces(fold: int, subset: str) -> list[str]:
    """5-fold split of all 120 PIG train pieces: sorted ids shuffled with random.Random(20261013),
    fold k = every 5th piece starting at k (24 pieces per fold)."""
    import random

    pieces = pig_pieces("trainall")
    rng = random.Random(20261013)
    rng.shuffle(pieces)
    val = sorted(pieces[fold::CV_FOLDS])
    if subset == "val":
        return val
    return sorted(set(pieces) - set(val))


def load_corpus(name: str) -> list[Piece]:
    if name.startswith("pig-cv"):
        k, subset = name[len("pig-cv"):].split("-")
        wanted = set(pig_cv_pieces(int(k), subset))
        data = load_pig(split="train")
        return [piece_from_files("pig", p, files) for p, files in data.items() if p in wanted]
    if name == "pig-train":
        return load_pig_corpus("train")
    if name == "pig-validation":
        return load_pig_corpus("validation")
    if name == "pig-trainall":
        return load_pig_corpus("trainall")
    if name == "textbook":
        return load_textbook_corpus()
    if name == "beringer":
        return load_beringer_corpus()
    if name == "mutopia-train":
        return load_mutopia_corpus("train")
    if name == "mutopia-test":
        return load_mutopia_corpus("test")
    raise KeyError(name)


# --- feature cache ----------------------------------------------------------------------------

def _families_hash() -> str:
    h = hashlib.sha1()
    for fam in FAMILY_ORDER:
        h.update(fam.encode())
        for i in FAMILY_IDS[fam]:
            h.update(i.encode())
    return h.hexdigest()[:10]


def load_corpus_with_features(name: str, log=None) -> list[Piece]:
    """Pieces with full-family tensors attached, cached under research/learn/cache."""
    import time

    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / ".gitignore").write_text("*\n", encoding="utf-8")
    cache_name = "pig-trainall" if name.startswith("pig-cv") else name
    path = CACHE / f"{cache_name}-{_families_hash()}.pkl"
    t0 = time.perf_counter()
    pieces = load_corpus(name)
    cached: dict[str, Tensors] = {}
    if path.exists():
        with open(path, "rb") as f:
            cached = pickle.load(f)
    missing = 0
    for piece in pieces:
        for ex in piece.examples():
            t = cached.get(ex.id)
            if t is None or t.n != ex.n:
                ex.full = build_tensors(ex.seq, FULL_FS, ex.hand)
                cached[ex.id] = ex.full
                missing += 1
            else:
                ex.full = t
    if missing:
        tmp = path.with_suffix(".tmp")
        with open(tmp, "wb") as f:
            pickle.dump(cached, f, protocol=pickle.HIGHEST_PROTOCOL)
        tmp.replace(path)
    if log:
        n_notes = sum(ex.n for p in pieces for ex in p.examples())
        log(f"{name}: {len(pieces)} pieces, {n_notes} notes, {missing} hands featurised, "
            f"{time.perf_counter() - t0:.1f} s")
    return pieces


def examples_of(pieces: list[Piece]) -> list[HandExample]:
    return [ex for p in pieces for ex in p.examples()]
