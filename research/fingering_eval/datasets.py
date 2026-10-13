"""Dataset loaders and splits.

All loaders return ``{piece_id: {annotation_id: PigFile}}`` so that every corpus can be fed
to the same validators, metrics and CLI. Paths default to ``research/data/<name>``.

* PIG v1.2              :func:`load_pig` (+ official splits from ``splits/pig_official.json``)
* Mutopia-derived       :func:`load_mutopia` (editorial fingerings converted by
                        ``research/scripts/build_mutopia_fingering.py``; partial labels, "0" = none)
* PianoVAM v1.2         :func:`load_pianovam` (performance fingerings; "Fingering" = automatic,
                        "Fingering_GT" = manual, 1,800 notes)
* Beringer & Dunhill    :func:`load_beringer` (scales/arpeggios/broken chords from pydactyl,
                        converted by ``research/scripts/convert_pydactyl_beringer.py``)
"""
from __future__ import annotations

import json
from pathlib import Path

from .pig_io import PigFile, list_pig_files, load_pig_dataset, pig_ids, read_pig

RESEARCH = Path(__file__).resolve().parents[1]
DATA = RESEARCH / "data"
SPLITS_FILE = DATA / "splits" / "pig_official.json"

PIG_TEST_PIECES = [f"{i:03d}" for i in range(1, 31)]      # Bach 001-010, Mozart 011-020, Chopin 021-030
PIG_TRAIN_PIECES = [f"{i:03d}" for i in range(31, 151)]   # miscellaneous subset


def pig_subset(piece: str) -> str:
    i = int(piece)
    if 1 <= i <= 10:
        return "Bach"
    if 11 <= i <= 20:
        return "Mozart"
    if 21 <= i <= 30:
        return "Chopin"
    return "Miscellaneous"


def load_splits(path: str | Path | None = None) -> dict:
    return json.loads(Path(path or SPLITS_FILE).read_text(encoding="utf-8"))


def split_files(split: str, splits_path: str | Path | None = None) -> set[str] | None:
    """File names (``001-1_fingering.txt``) belonging to ``split``; None = everything.

    Split names: ``all``; ``test``/``train`` (Nakamura et al. 2020 = the official split);
    ``ramoneda_train``/``ramoneda_val``/``ramoneda_test`` (ArGNN, ACM MM 2022).
    """
    if split in (None, "", "all"):
        return None
    sp = load_splits(splits_path)["splits"]
    aliases = {"test": ("nakamura2020", "test"), "train": ("nakamura2020", "train"),
               "nakamura_test": ("nakamura2020", "test"), "nakamura_train": ("nakamura2020", "train"),
               "ramoneda_train": ("ramoneda2022", "train"), "ramoneda_val": ("ramoneda2022", "val"),
               "ramoneda_test": ("ramoneda2022", "test")}
    if split not in aliases:
        raise KeyError(f"unknown split {split!r}; choose from all, {', '.join(aliases)}")
    a, b = aliases[split]
    return set(sp[a][b]["files"])


def load_pig(root: str | Path | None = None, split: str = "all", strict: bool = True) -> dict[str, dict[str, PigFile]]:
    root = Path(root) if root else DATA / "pig"
    allowed = split_files(split)
    out: dict[str, dict[str, PigFile]] = {}
    for p in list_pig_files(root):
        if allowed is not None and p.name not in allowed:
            continue
        piece, ann = pig_ids(p)
        out.setdefault(piece, {})[ann or "0"] = read_pig(p, strict=strict)
    return dict(sorted(out.items()))


def load_generic(root: str | Path, strict: bool = True) -> dict[str, dict[str, PigFile]]:
    """Any directory of ``<piece>-<ann>_fingering.txt`` files (searches FingeringFiles/ too)."""
    return load_pig_dataset(root, strict=strict)


def load_mutopia(root: str | Path | None = None) -> dict[str, dict[str, PigFile]]:
    return load_generic(Path(root) if root else DATA / "mutopia_fingering")


def load_beringer(root: str | Path | None = None) -> dict[str, dict[str, PigFile]]:
    return load_generic(Path(root) if root else DATA / "beringer_fingering")


def load_pianovam(root: str | Path | None = None, which: str = "Fingering_GT") -> dict[str, dict[str, PigFile]]:
    """PianoVAM fingering TSVs converted on the fly to PIG notes ("Noinfo" -> finger "0")."""
    from .pig_io import make_note

    root = Path(root) if root else DATA / "pianovam"
    out: dict[str, dict[str, PigFile]] = {}
    for f in sorted((root / which).glob("*.tsv")):
        notes = []
        with open(f, encoding="utf-8") as fh:
            header = fh.readline().rstrip("\n").split("\t")
            col = {name: i for i, name in enumerate(header)}
            for k, line in enumerate(fh):
                parts = line.rstrip("\n").split("\t")
                if len(parts) < len(header):
                    continue
                hand, finger = parts[col["hand"]], parts[col["finger"]]
                pitch = int(parts[col["note"]])
                # "Noinfo" notes have no hand label: put them in the hand suggested by the pitch
                # (below middle C -> LH) and leave them unlabeled (finger "0")
                ch = 1 if hand == "L" else 0 if hand == "R" else (1 if pitch < 60 else 0)
                if hand in ("L", "R") and finger.isdigit():
                    fs = finger if hand == "R" else f"-{finger}"
                else:
                    fs = "0"
                notes.append(make_note(k, float(parts[col["onset"]]), float(parts[col["key_offset"]]),
                                       int(parts[col["note"]]), ch, fs, int(parts[col["velocity"]])))
        out[f.stem] = {"0": PigFile(notes=notes, path=f)}
    return out
