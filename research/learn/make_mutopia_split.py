"""Deterministic 70/30 split of the Mutopia editorial corpus by Mutopia piece id (M3 plan Task 2).

Method: keep ``status == "ok"`` parts of ``research/data/mutopia_fingering/manifest.json``, group
them by ``mutopia_id`` (a duet's primo and secondo stay together), sort the Mutopia ids as
strings, shuffle with ``random.Random(20261013)``, assign the first ``round(0.3 * n)`` ids to
``test`` and the rest to ``train``. Output uses the ``splits.<name>.<subset>.pieces`` shape of
``pig_official.json``.

    research/.venv/Scripts/python.exe -I -m learn.make_mutopia_split [--out research/data/splits/mutopia_split.json]

The file is written only when it does not exist yet (``--force`` overwrites).
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

SEED = 20261013
TEST_SHARE = 0.3
RESEARCH = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = RESEARCH / "data" / "mutopia_fingering" / "manifest.json"
DEFAULT_OUT = RESEARCH / "data" / "splits" / "mutopia_split.json"


def build(manifest_path: Path = DEFAULT_MANIFEST, seed: int = SEED, test_share: float = TEST_SHARE) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    ok = [m for m in manifest if m.get("status") == "ok"]
    by_id: dict[str, list[dict]] = {}
    for m in ok:
        by_id.setdefault(str(m["mutopia_id"]), []).append(m)
    ids = sorted(by_id)
    rng = random.Random(seed)
    rng.shuffle(ids)
    n_test = int(round(test_share * len(ids)))
    test_ids = sorted(ids[:n_test])
    train_ids = sorted(ids[n_test:])

    def subset(mids: list[str]) -> dict:
        parts = sorted(p["piece_id"] for mid in mids for p in by_id[mid])
        return {"pieces": parts, "mutopia_ids": mids}

    def counts(mids: list[str]) -> dict:
        ps = [p for mid in mids for p in by_id[mid]]
        return {"parts": len(ps), "notes": sum(p["n_notes"] for p in ps), "fingered": sum(p["n_fingered"] for p in ps)}

    return {
        "dataset": "Mutopia editorial fingerings (research/data/mutopia_fingering)",
        "default_split": "piece70_30",
        "seed": seed,
        "method": (
            "status == ok parts grouped by mutopia_id; mutopia ids sorted as strings, shuffled with "
            "random.Random(20261013); first round(0.3 * n) ids = test, rest = train; piece lists sorted"
        ),
        "splits": {"piece70_30": {"train": subset(train_ids), "test": subset(test_ids)}},
        "counts": {"train": counts(train_ids), "test": counts(test_ids)},
    }


def write(out: Path, data: dict) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    if args.out.exists() and not args.force:
        print(f"{args.out} exists; not overwritten (use --force)")
        return 0
    data = build(args.manifest)
    write(args.out, data)
    c = data["counts"]
    print(f"wrote {args.out}: train {c['train']} test {c['test']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
