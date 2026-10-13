#!/usr/bin/env python
"""Build the per-note feature table for the readability study.

    research/.venv-readability/Scripts/python.exe -X utf8 research/readability/build_features.py

Writes ``research/data/readability/features.csv`` (one row per note of the 286 verified Mutopia
parts and the 8 fingered library pieces; gitignored, about 37 MB) and
``research/readability/results/features_summary.json`` (row counts).
Run ``enrich_mutopia.py`` first if ``research/data/mutopia_src`` is present, so that beats and
bar positions are exact; otherwise beats fall back to the default tempo and bar positions are
unknown.
"""
from __future__ import annotations

import json
import sys
import time
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
if str(RESEARCH) not in sys.path:
    sys.path.insert(0, str(RESEARCH))

from readability import corpus  # noqa: E402
from readability.features import write_feature_table  # noqa: E402

OUT = corpus.DATA / "readability" / "features.csv"


def main() -> int:
    t0 = time.time()
    parts = corpus.load_all()
    n = write_feature_table(parts, OUT)
    summary = {
        "rows": n,
        "parts": len(parts),
        "parts_by_group": dict(Counter(p.level_group for p in parts)),
        "notes_by_group": {g: sum(len(p.notes) for p in parts if p.level_group == g) for g in corpus.LEVEL_GROUPS + ("library",)},
        "printed_by_group": {g: sum(p.n_printed for p in parts if p.level_group == g) for g in corpus.LEVEL_GROUPS + ("library",)},
        "parts_with_beats": sum(p.beats_known for p in parts),
        "seconds": round(time.time() - t0, 1),
        "command": "research/.venv-readability/Scripts/python.exe -X utf8 research/readability/build_features.py",
    }
    (HERE / "results").mkdir(exist_ok=True)
    with open(HERE / "results" / "features_summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1)
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
