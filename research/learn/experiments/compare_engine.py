"""Parity check: the Python port against the TypeScript engine (Parncutt weights, large profile).

1. ``packages/engine/node_modules/.bin/tsx research/learn/experiments/engine_solve.ts
   research/data/learn/engine_reference.json <pig files...>`` writes the engine's fingers,
   per-hand costs and hand sequences (1.4 MB for 119 pieces: kept under the gitignored
   ``research/data/learn``, never under ``results``).
2. ``research/.venv/Scripts/python.exe -I -m learn.experiments.compare_engine`` decodes the same
   files with the Python port and writes ``research/learn/results/engine_parity.json``.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

RESEARCH = Path(__file__).resolve().parents[2]
ROOT = RESEARCH.parent
sys.path.insert(0, str(RESEARCH))

from fingering_eval.pig_io import read_pig  # noqa: E402
from learn.corpus import piece_from_files  # noqa: E402
from learn.decoder import solve_full  # noqa: E402
from learn.features import FeatureSet  # noqa: E402

REF = RESEARCH / "data" / "learn" / "engine_reference.json"
OUT = RESEARCH / "learn" / "results" / "engine_parity.json"
ENGINE_FILES = [
    "packages/engine/src/fingering/geometry.ts", "packages/engine/src/fingering/spans.ts",
    "packages/engine/src/fingering/rules.ts", "packages/engine/src/fingering/sequence.ts",
    "packages/engine/src/fingering/viterbi.ts", "packages/engine/src/fingering/solve.ts",
    "packages/engine/src/fingering/params/weights-parncutt.json", "packages/engine/src/score/build.ts",
    "packages/engine/src/io/pig/read.ts",
]


def main() -> int:
    ref = json.loads(REF.read_text(encoding="utf-8"))
    fs = FeatureSet(["rules"])
    w = fs.parncutt_weights()
    report = {"files": {}, "engine_sources": {}}
    for rel in ENGINE_FILES:
        p = ROOT / rel
        if p.exists():
            report["engine_sources"][rel] = hashlib.sha256(p.read_bytes()).hexdigest()[:16]
    total = agree = 0
    seq_ok = True
    for file, r in ref.items():
        pid = Path(file).name.split("-")[0]
        pig = read_pig(ROOT / file)
        piece = piece_from_files("pig", pid, {"1": pig})
        entry = {"notes": r["notes"], "hands": {}}
        for ex in piece.examples():
            # hand sequence parity
            ours = [[n.note_id, n.pitch, n.slice, 1 if n.rest_before else 0, n.ioi] for n in ex.seq]
            theirs = r["seqs"][ex.hand]
            same_seq = len(ours) == len(theirs) and all(
                a[0] == b[0] and a[1] == b[1] and a[2] == b[2] and a[3] == b[3] and abs(a[4] - b[4]) < 1e-9
                for a, b in zip(ours, theirs)
            )
            seq_ok = seq_ok and same_seq
            fingers, cost, it, relaxed = solve_full(ex.seq, ex.tensors(fs), w)
            eng = next(h for h in r["hands"] if h["hand"] == ex.hand)
            n_agree = sum(1 for n, f in zip(ex.seq, fingers) if r["fingers"].get(n.note_id) == int(f))
            total += ex.n
            agree += n_agree
            entry["hands"][ex.hand] = {
                "notes": ex.n, "agree": n_agree, "python_cost": float(cost), "engine_cost": eng["cost"],
                "cost_equal": bool(abs(float(cost) - eng["cost"]) < 1e-6),
                "python_iterations": it, "engine_iterations": eng["iterations"],
                "python_relaxed": relaxed, "engine_relaxed": eng["relaxed"], "sequence_identical": same_seq,
            }
        report["files"][file] = entry
    report["summary"] = {"notes": total, "agree": agree, "agreement": agree / total if total else None,
                         "sequences_identical": seq_ok}
    OUT.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps(report["summary"]))
    for file, e in report["files"].items():
        for h, d in e["hands"].items():
            print(f"{Path(file).name} {h}: {d['agree']}/{d['notes']} fingers, cost py {d['python_cost']:.2f} "
                  f"ts {d['engine_cost']:.2f}, iter {d['python_iterations']}/{d['engine_iterations']}, "
                  f"relaxed {d['python_relaxed']}/{d['engine_relaxed']}, seq {d['sequence_identical']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
