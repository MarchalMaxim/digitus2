#!/usr/bin/env python
"""Run the whole readability study end to end (about two minutes on one core).

    research/.venv-readability/Scripts/python.exe -X utf8 research/readability/run_all.py [--skip-enrich]

Steps: (1) enrich_mutopia (beats and bars; skipped when the LilyPond sources are absent),
(2) build_features, (3) stats (items 1 and 5), (4) repeats (item 2), (5) eval_player (item 3), (6) reduce (the minimal-sufficient reduction on fully fingered parts),
(7) predictor (item 4). Every step writes its summaries under research/readability/results/.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
SRC = RESEARCH / "data" / "mutopia_src" / "ftp"


def run(script: str, *args: str) -> None:
    cmd = [sys.executable, "-X", "utf8", str(HERE / script), *args]
    print(f"\n=== {' '.join(Path(c).name if i == 0 else c for i, c in enumerate(cmd))}", flush=True)
    env = dict(os.environ, OMP_NUM_THREADS="2")
    t0 = time.time()
    subprocess.run(cmd, check=True, env=env)
    print(f"=== done in {time.time() - t0:.1f} s", flush=True)


def main(argv: list[str]) -> int:
    if "--skip-enrich" not in argv and SRC.exists():
        run("enrich_mutopia.py")
    run("build_features.py")
    run("stats.py")
    run("repeats.py")
    run("eval_player.py")
    run("reduce.py")
    run("predictor.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
