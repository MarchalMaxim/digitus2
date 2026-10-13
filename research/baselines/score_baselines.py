"""Score every baseline under outputs/ on a PIG split and write results.json.

    python score_baselines.py                       # official test split, all outputs/*
    python score_baselines.py --split-name all      # all 150 pieces (only meaningful for
                                                    # models that never saw them in training)
    python score_baselines.py --names nakamura_fhmm1,pianoplayer --crosscheck-cpp

Metrics: M_gen, M_high, M_soft, M_rec of Nakamura et al. (2020), computed with the shared
``research/fingering_eval`` package when importable: mode="official" (primary; bit-for-bit the
C++ ``Evaluate_MultipleGroundTruth`` used for the paper's Table 2) and mode="press" (finger
substitutions such as "3_1" reduced to the pressing finger everywhere; differs by ~0.1).  If the package is
not importable, ``_pig_metrics.py`` (a port of the C++ tool, official mode only) is used.
``--crosscheck-cpp`` additionally runs the original C++ evaluator on every piece and reports
the largest deviation.

Averages are over pieces (macro; the paper's Table 2) and over notes (micro).  A baseline
that failed on some pieces is scored on the pieces it produced; ``coverage`` says how many.
"""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import (OUTPUTS, RESEARCH_DIR, THIRD_PARTY, default_pig_dir, gt_files, input_file,  # noqa: E402
                     load_split, read_pig, resolve_pieces)
import _pig_metrics  # noqa: E402

try:
    sys.path.insert(0, str(RESEARCH_DIR))
    from fingering_eval import metrics as fe_metrics  # type: ignore  # noqa: E402
    HAVE_FE = True
except Exception as _exc:  # pragma: no cover
    fe_metrics = None
    HAVE_FE = False

CPP_EVAL = THIRD_PARTY / "nakamura_hmm" / "SourceCode" / "Binary" / "Evaluate_MultipleGroundTruth.exe"
METRICS = ("m_gen", "m_high", "m_soft", "m_rec")


def score_piece(gts: list[list[str]], est: list[str]) -> dict:
    out = {}
    if HAVE_FE:
        for mode in ("press", "official"):
            s = fe_metrics.evaluate_piece(gts, est, mode=mode)
            out[mode] = {m: getattr(s, m) for m in METRICS}
    else:
        r = _pig_metrics.match_rates(gts, est)
        out["official"] = {"m_gen": r["M_gen"], "m_high": r["M_high"], "m_soft": r["M_soft"],
                           "m_rec": r["M_rec"]}
    return out


def cpp_scores(gt_paths: list[Path], est_path: Path) -> dict | None:
    if not CPP_EVAL.is_file():
        return None
    cmd = [str(CPP_EVAL), str(len(gt_paths))] + [str(p) for p in gt_paths] + [str(est_path)]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    vals = [float(x) for x in res.stdout.split(":")[1].split()]
    return dict(zip(METRICS, vals))


def runtime_summary(out_dir: Path, pieces: list[str]) -> dict:
    log_path = out_dir / "run_log.json"
    if not log_path.is_file():
        return {}
    log = json.loads(log_path.read_text(encoding="utf-8"))
    ent = [log["pieces"][p] for p in pieces if p in log.get("pieces", {}) and log["pieces"][p]["status"] == "ok"]
    if not ent:
        return {"meta": log.get("meta", {})}
    secs = [e["seconds"] for e in ent]
    notes = sum(e.get("n_notes", 0) for e in ent)
    return {
        "mean_seconds_per_piece": round(sum(secs) / len(secs), 4),
        "max_seconds_per_piece": round(max(secs), 4),
        "total_seconds": round(sum(secs), 3),
        "notes_per_second": round(notes / sum(secs), 1) if sum(secs) > 0 else None,
        "meta": log.get("meta", {}),
        "failed_pieces": sorted(p for p in pieces if log["pieces"].get(p, {}).get("status") == "error"),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--split-name", default="test", help="test (default) | train | val | all | ids")
    ap.add_argument("--split", default=None, help="split json")
    ap.add_argument("--pig-dir", default=None)
    ap.add_argument("--outputs", default=str(OUTPUTS))
    ap.add_argument("--names", default=None, help="comma-separated baseline output dirs (default: all)")
    ap.add_argument("--results", default=str(HERE / "results.json"))
    ap.add_argument("--per-piece-csv", default=None, help="default: results_per_piece_<split>.csv")
    ap.add_argument("--crosscheck-cpp", action="store_true", help="also run the original C++ evaluator")
    args = ap.parse_args()

    pig_dir = Path(args.pig_dir) if args.pig_dir else default_pig_dir()
    split = load_split(args.split)
    pieces = resolve_pieces(args.split_name, split)
    out_root = Path(args.outputs)
    names = args.names.split(",") if args.names else sorted(
        p.name for p in out_root.iterdir() if p.is_dir() and not p.name.startswith("_"))

    gts_cache: dict[str, tuple[list[Path], list[list[str]]]] = {}
    for piece in pieces:
        paths = gt_files(piece, pig_dir)
        gts_cache[piece] = (paths, [[n.finger for n in read_pig(p)] for p in paths])

    results_path = Path(args.results)
    results = json.loads(results_path.read_text(encoding="utf-8")) if results_path.is_file() else {}
    results.setdefault("baselines", {})
    per_piece_rows = []
    for name in names:
        out_dir = out_root / name
        scored, missing, max_dev = {}, [], 0.0
        for piece in pieces:
            est_path = out_dir / input_file(piece, pig_dir).name
            if not est_path.is_file():
                missing.append(piece)
                continue
            est = [n.finger for n in read_pig(est_path)]
            gt_paths, gts = gts_cache[piece]
            if any(len(g) != len(est) for g in gts):
                missing.append(piece)
                print(f"[{name}] {piece}: length mismatch, skipped", file=sys.stderr)
                continue
            sc = score_piece(gts, est)
            sc["n_notes"] = len(est)
            if args.crosscheck_cpp:
                cpp = cpp_scores(gt_paths, est_path)
                if cpp:
                    dev = max(abs(cpp[m] - sc["official"][m]) for m in METRICS)
                    max_dev = max(max_dev, dev)
            scored[piece] = sc
            per_piece_rows.append([name, piece, len(est)] + [round(sc[k][m], 6) for k in sc if k != "n_notes"
                                                                for m in METRICS])
        entry = {"split": args.split_name, "n_pieces_in_split": len(pieces), "n_scored": len(scored),
                 "coverage": round(len(scored) / len(pieces), 4) if pieces else 0, "missing": missing}
        if scored:
            n_tot = sum(s["n_notes"] for s in scored.values())
            for mode in [k for k in next(iter(scored.values())) if k != "n_notes"]:
                entry[mode] = {}
                for m in METRICS:
                    vals = [s[mode][m] for s in scored.values()]
                    entry[mode][f"macro_{m}"] = round(100 * sum(vals) / len(vals), 2)
                    entry[mode][f"micro_{m}"] = round(
                        100 * sum(s[mode][m] * s["n_notes"] for s in scored.values()) / n_tot, 2)
        if args.crosscheck_cpp:
            entry["cpp_crosscheck_max_abs_dev"] = max_dev
        entry["runtime"] = runtime_summary(out_dir, pieces)
        entry["scorer"] = "fingering_eval" if HAVE_FE else "_pig_metrics (fallback port of C++ tool)"
        results["baselines"].setdefault(name, {})[args.split_name] = entry
        mode = "official"
        if scored:
            e = entry[mode]
            print(f"{name:32s} n={len(scored):3d}/{len(pieces):3d}  "
                  f"M_gen {e['macro_m_gen']:5.1f}  M_high {e['macro_m_high']:5.1f}  "
                  f"M_soft {e['macro_m_soft']:5.1f}  M_rec {e['macro_m_rec']:5.1f}"
                  + (f"  (cpp dev {max_dev:.2e})" if args.crosscheck_cpp else ""))
        else:
            print(f"{name:32s} no outputs for split {args.split_name}")

    results["_meta"] = {
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "pig_dir": str(pig_dir),
        "split_source": split.get("_source"),
        "primary_mode": "official",
        "note": "metrics in percent; macro = mean over pieces (paper Table 2), micro = over notes",
    }
    results_path.write_text(json.dumps(results, indent=1), encoding="utf-8")
    csv_path = Path(args.per_piece_csv) if args.per_piece_csv else HERE / f"results_per_piece_{args.split_name}.csv"
    modes = ["press", "official"] if HAVE_FE else ["official"]
    header = ["baseline", "piece", "n_notes"] + [f"{mo}_{m}" for mo in modes for m in METRICS]
    kept = []
    if csv_path.is_file():  # keep rows of baselines not re-scored in this run
        with open(csv_path, newline="", encoding="utf-8") as fh:
            old = list(csv.reader(fh))
        if old and old[0] == header:
            kept = [r for r in old[1:] if r and r[0] not in set(names)]
    with open(csv_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(sorted(kept + [[str(x) for x in r] for r in per_piece_rows], key=lambda r: (r[0], r[1])))
    print(f"wrote {results_path} and {csv_path}")


if __name__ == "__main__":
    main()
