"""Write the fixed PIG validation list used by the M3 learning plan.

The 20 validation pieces are drawn from the ``nakamura2020`` *train* pieces (031-150) of
``research/data/splits/pig_official.json``: the sorted train piece ids are shuffled with
``random.Random(20261013)`` and the first 20 are kept, sorted. The PIG test split (001-030) is
never touched. Every consumer (Python experiments, the TypeScript trainer) must read the JSON
instead of recomputing the list, because Python's Mersenne Twister and the engine's LCG differ.

Usage (from the project root)::

    research/.venv/Scripts/python.exe -I research/scripts/make_pig_validation.py \
        [--split research/data/splits/pig_official.json] [--out research/data/splits/pig_validation.json]
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

SEED = 20261013
N_VALIDATION = 20
METHOD = (
    "sorted nakamura2020 train piece ids of pig_official.json, random.Random(20261013).shuffle, "
    "first 20 kept, output sorted"
)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPLIT = ROOT / "research" / "data" / "splits" / "pig_official.json"
DEFAULT_OUT = ROOT / "research" / "data" / "splits" / "pig_validation.json"


def validation_pieces(train_pieces: list[str], seed: int = SEED, n: int = N_VALIDATION) -> list[str]:
    """Deterministic validation subset: shuffle the sorted ids with ``random.Random(seed)``."""
    pieces = sorted(set(train_pieces))
    rng = random.Random(seed)
    rng.shuffle(pieces)
    return sorted(pieces[:n])


def build(split_path: Path, seed: int = SEED, n: int = N_VALIDATION) -> dict:
    split = json.loads(split_path.read_text(encoding="utf-8"))
    train = split["splits"]["nakamura2020"]["train"]["pieces"]
    test = set(split["splits"]["nakamura2020"]["test"]["pieces"])
    pieces = validation_pieces(train, seed, n)
    assert not (set(pieces) & test), "validation pieces must come from the train split only"
    train_rest = sorted(set(train) - set(pieces))
    return {
        "dataset": "PIG Dataset v1.2, nakamura2020 train pieces (031-150)",
        "seed": seed,
        "method": METHOD,
        "source_split": "research/data/splits/pig_official.json",
        "pieces": pieces,
        "train_minus_validation": train_rest,
    }


def write(out: Path, data: dict) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--split", type=Path, default=DEFAULT_SPLIT)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()
    data = build(args.split)
    write(args.out, data)
    print(f"wrote {args.out}: {len(data['pieces'])} validation pieces: {' '.join(data['pieces'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
