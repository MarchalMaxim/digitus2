#!/usr/bin/env python
"""Cross-check fingering_eval.metrics against Nakamura et al.'s official evaluation tool.

1. Reproduce Table 2 of Nakamura, Saito & Yoshii (2020) from the published HMM outputs
   (research/data/pig_hmm/Result_FHMM{1,2,3}) and the human leave-one-out reference.
2. If a C++ compiler is available (g++ on PATH, or C:/MinGW/bin/g++.exe), compile the
   official ``Evaluate_MultipleGroundTruth`` / ``Evaluate_SimpleMatchRate`` (from
   research/data/pig_hmm/SourceCode/Code, copied to a separate build directory first) and
   compare its output with ours on: the 90 HMM outputs, 150 human leave-one-out cases, all
   multi-annotation training pieces, and 90 random perturbations (incl. hand flips and
   substitution strings).

    research/.venv/Scripts/python.exe -I research/scripts/crosscheck_official_eval.py

Writes research/data/reports/official_eval_crosscheck.json.
"""
from __future__ import annotations

import json
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

RESEARCH = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RESEARCH))

from fingering_eval import metrics as M  # noqa: E402
from fingering_eval.datasets import DATA, load_pig  # noqa: E402
from fingering_eval.pig_io import read_pig, write_pig  # noqa: E402

TABLE2 = {"Result_FHMM1": (61.7, 68.3, 82.8, 74.0), "Result_FHMM2": (64.3, 70.8, 85.3, 77.6),
          "Result_FHMM3": (64.5, 71.0, 85.5, 77.8), "Human": (71.4, 79.1, 90.8, 84.3)}
SOURCES = ["Evaluate_MultipleGroundTruth.cpp", "Evaluate_SimpleMatchRate.cpp", "FingeringEvaluation_v190306.hpp",
           "PianoFingering_v170101_2.hpp", "PianoRoll_v170503.hpp", "BasicCalculation_v170122.hpp",
           "BasicPitchCalculation_v170101.hpp", "Midi_v170101.hpp"]


def table2() -> dict:
    gold = load_pig(DATA / "pig", split="test")
    out = {}
    for model in ("Result_FHMM1", "Result_FHMM2", "Result_FHMM3"):
        for mode in ("official", "press"):
            scores = [M.evaluate_piece([a for _, a in sorted(anns.items())],
                                       read_pig(DATA / "pig_hmm" / model / f"{p}-1_fingering.txt"), p, mode=mode)
                      for p, anns in gold.items()]
            agg = M.aggregate(scores)
            out[f"{model}/{mode}"] = [round(100 * agg[f"macro_{m}"], 3) for m in M.METRIC_NAMES]
    for mode in ("official", "press"):
        rows = []
        for p, anns in gold.items():
            loo = M.leave_one_out({k: v.notes for k, v in anns.items()}, p, mode=mode)
            rows.append([sum(getattr(s, m) for s in loo) / len(loo) for m in M.METRIC_NAMES])
        out[f"Human/{mode}"] = [round(100 * sum(r[i] for r in rows) / len(rows), 3) for i in range(4)]
    match = {k: all(abs(v - t) <= 0.05 + 1e-9 for v, t in zip(out[k], TABLE2[k.split("/")[0]]))
             for k in out}
    return {"ours": out, "paper": TABLE2, "rounds_to_paper": match}


def find_gpp() -> str | None:
    for c in (shutil.which("g++"), "C:/MinGW/bin/g++.exe", "C:/msys64/ucrt64/bin/g++.exe",
              "C:/msys64/mingw64/bin/g++.exe"):
        if c and Path(c).exists():
            return c
    return None


def build(gpp: str, build_dir: Path) -> dict[str, Path]:
    src_dir = DATA / "pig_hmm" / "SourceCode" / "Code"
    build_dir.mkdir(parents=True, exist_ok=True)
    for s in SOURCES:
        shutil.copyfile(src_dir / s, build_dir / s)
    exes = {}
    env = dict(**__import__("os").environ)
    env["PATH"] = str(Path(gpp).parent) + __import__("os").pathsep + env.get("PATH", "")
    for prog in ("Evaluate_MultipleGroundTruth", "Evaluate_SimpleMatchRate"):
        exe = build_dir / (prog + ".exe")
        subprocess.run([gpp, "-O2", "-static", "-static-libgcc", "-static-libstdc++", f"{prog}.cpp", "-o", exe.name],
                       cwd=build_dir, check=True, env=env, capture_output=True, timeout=300)
        exes[prog] = exe
    return exes


def cases(tmp: Path) -> list[tuple[str, list[str], str]]:
    gold = load_pig(DATA / "pig")
    out = []
    for p in [f"{i:03d}" for i in range(1, 31)]:
        for h in ("Result_FHMM1", "Result_FHMM2", "Result_FHMM3"):
            out.append((f"{h}:{p}", [str(f.path) for f in gold[p].values()],
                        str(DATA / "pig_hmm" / h / f"{p}-1_fingering.txt")))
    for p, anns in gold.items():
        if len(anns) > 1:
            for k, f in anns.items():
                out.append((f"loo:{p}-{k}", [str(g.path) for kk, g in anns.items() if kk != k], str(f.path)))
    rng = random.Random(0)
    for p in [f"{i:03d}" for i in range(1, 31)]:
        est = read_pig(DATA / "pig_hmm" / "Result_FHMM2" / f"{p}-1_fingering.txt")
        for r in range(3):
            notes = []
            for n in est.notes:
                f, u = n.finger, rng.random()
                s = 1 if n.channel == 0 else -1
                if u < 0.15:
                    f = str(rng.randint(1, 5) * s)
                elif u < 0.17:
                    f = str(-int(f))
                elif u < 0.19:
                    f = f"{f}_{rng.randint(1, 5) * s}"
                notes.append(n.with_finger(f))
            dst = tmp / f"{p}-r{r}_fingering.txt"
            write_pig(dst, notes)
            out.append((f"random:{p}-r{r}", [str(f.path) for f in gold[p].values()], str(dst)))
    return out


def compare(exes: dict[str, Path]) -> dict:
    with tempfile.TemporaryDirectory() as td:
        cs = cases(Path(td))
        maxdiff, n, bad = 0.0, 0, []
        simple_max, simple_n = 0.0, 0
        for name, gts, est in cs:
            res = subprocess.run([str(exes["Evaluate_MultipleGroundTruth"]), str(len(gts)), *gts, est],
                                 capture_output=True, text=True, timeout=60)
            line = [l for l in res.stdout.splitlines() if l.startswith("General")]
            if not line:
                bad.append({"case": name, "error": res.stdout[-200:] + res.stderr[-200:]})
                continue
            off = [float(x) for x in line[0].split(":")[1].split()]
            mine = M.evaluate_piece([read_pig(g) for g in gts], read_pig(est), mode="official")
            mv = [mine.m_gen, mine.m_high, mine.m_soft, mine.m_rec]
            d = max(abs(a - b) for a, b in zip(off, mv))
            n += 1
            maxdiff = max(maxdiff, d)
            if d > 5e-6:  # the C++ prints 6 significant digits
                bad.append({"case": name, "official": off, "ours": mv})
            # simple match rate against the first ground truth
            res = subprocess.run([str(exes["Evaluate_SimpleMatchRate"]), gts[0], est], capture_output=True,
                                 text=True, timeout=60)
            if res.stdout.startswith("MatchRate:"):
                frac = res.stdout.split("\t")[0].split(":")[1].strip().split("/")
                off_s = float(frac[0]) / float(frac[1])
                mine_s = M.match_rate(read_pig(gts[0]), read_pig(est), mode="exact")
                simple_max = max(simple_max, abs(off_s - mine_s))
                simple_n += 1
    return {"cases": len(cs), "compared": n, "max_abs_diff_4metrics": maxdiff, "disagreements": bad[:20],
            "n_disagreements": len(bad), "simple_match_rate_compared": simple_n,
            "simple_match_rate_max_abs_diff": simple_max}


def main() -> int:
    report = {"table2": table2()}
    print("Table 2 reproduction:")
    for k, v in report["table2"]["ours"].items():
        print(f"  {k:24s} {v}  rounds to paper: {report['table2']['rounds_to_paper'][k]}")
    gpp = find_gpp()
    if gpp is None:
        report["official_binary"] = "skipped: no g++ found"
        print("no g++ found; skipping binary cross-check")
    else:
        build_dir = DATA / "_build" / "official_eval"
        exes = build(gpp, build_dir)
        report["official_binary"] = {"compiler": gpp, "build_dir": str(build_dir), **compare(exes)}
        ob = report["official_binary"]
        print(f"official binary: {ob['compared']}/{ob['cases']} cases compared, max |diff| "
              f"{ob['max_abs_diff_4metrics']:.2e}, disagreements {ob['n_disagreements']}; simple match rate "
              f"{ob['simple_match_rate_compared']} cases, max |diff| {ob['simple_match_rate_max_abs_diff']:.2e}")
    dst = DATA / "reports" / "official_eval_crosscheck.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"wrote {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
