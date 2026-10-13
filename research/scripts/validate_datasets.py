#!/usr/bin/env python
"""Run the fingering_eval validators on every collected dataset and write reports.

    research/.venv/Scripts/python.exe -I research/scripts/validate_datasets.py [pig mutopia beringer pianovam ...]

Outputs (small, committed):
    research/data/reports/<dataset>_validation.json   summary, statistics, agreement
    research/data/reports/<dataset>_anomalies.csv     one row per flagged item (piece, annotation, note id, line)
"""
from __future__ import annotations

import csv
import json
import sys
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from statistics import mean, pstdev

RESEARCH = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RESEARCH))

from fingering_eval import metrics as M  # noqa: E402
from fingering_eval import validate as V  # noqa: E402
from fingering_eval.datasets import (DATA, load_beringer, load_generic, load_mutopia, load_pianovam,  # noqa: E402
                                     load_pig, pig_subset)
from fingering_eval.pig_io import parse_finger, read_pig_list_csv  # noqa: E402

REPORTS = DATA / "reports"


FULL_REPORTS = DATA / "_build" / "reports"     # gitignored: complete anomaly dumps
MAX_TRACKED_BYTES = 900 * 1024                  # repository rule: tracked files < 1 MB
ROWS_PER_CHECK_CAP = 300


def _write_csv(p: Path, anomalies: list[V.Anomaly]) -> None:
    with open(p, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["dataset", "piece", "annotation", "note_id", "line", "severity", "check", "message"])
        for a in sorted(anomalies, key=lambda a: (a.piece, a.annotation, {"error": 0, "warning": 1, "info": 2}
                                                  .get(a.severity, 3), a.check, int(a.line))):
            w.writerow([a.dataset, a.piece, a.annotation, a.note_id, a.line, a.severity, a.check, a.message])


def write_anomalies(name: str, anomalies: list[V.Anomaly]) -> Path:
    """Full list -> research/data/_build/reports/ (not committed). The committed copy in
    research/data/reports/ is the full list if it is small, otherwise errors + warnings with
    at most ROWS_PER_CHECK_CAP rows per check (counts per check are in *_validation.json)."""
    REPORTS.mkdir(parents=True, exist_ok=True)
    FULL_REPORTS.mkdir(parents=True, exist_ok=True)
    _write_csv(FULL_REPORTS / f"{name}_anomalies_full.csv", anomalies)
    p = REPORTS / f"{name}_anomalies.csv"
    _write_csv(p, anomalies)
    if p.stat().st_size > MAX_TRACKED_BYTES:
        kept, seen = [], Counter()
        for a in sorted(anomalies, key=lambda a: ({"error": 0, "warning": 1}.get(a.severity, 2), a.piece, int(a.line))):
            if a.severity == "info":
                continue
            seen[a.check] += 1
            if seen[a.check] <= ROWS_PER_CHECK_CAP:
                kept.append(a)
        _write_csv(p, kept)
    return p


def basic_validation(name: str, ds: dict) -> tuple[list[V.Anomaly], dict]:
    anomalies: list[V.Anomaly] = []
    stats = V.FingerStats()
    n_files = 0
    for piece, anns in ds.items():
        for ann, f in anns.items():
            n_files += 1
            anomalies += V.validate_notes(f.notes, piece, ann, name)
            stats.add(f.notes)
        anomalies += V.check_annotations_aligned({k: v.notes for k, v in anns.items()}, piece, name)
    summary = {"dataset": name, "pieces": len(ds), "files": n_files,
               "anomaly_counts": V.summarize(anomalies), "finger_stats": stats.as_dict()}
    return anomalies, summary


def j_player_match(anns: list[list]) -> dict[int, float]:
    """Fig. 1 of Nakamura et al.: mean over all j-subsets of the fraction of notes on which all j agree."""
    out = {}
    J = len(anns)
    keys = [[parse_finger(n.finger).press for n in a] for a in anns]
    for j in range(2, J + 1):
        vals = []
        for comb in combinations(range(J), j):
            n = len(keys[0])
            vals.append(sum(all(keys[c][i] == keys[comb[0]][i] for c in comb) for i in range(n)) / n)
        out[j] = mean(vals)
    return out


def pig_agreement(ds: dict) -> dict:
    meta = read_pig_list_csv(DATA / "pig")
    per_piece = {}
    pairs_all = []
    by_subset = defaultdict(list)
    by_annotator_pair = defaultdict(list)
    j_by_subset = defaultdict(lambda: defaultdict(list))
    for piece, anns in ds.items():
        if len(anns) < 2:
            continue
        pw = V.pairwise_agreement({k: v.notes for k, v in anns.items()})
        per_piece[piece] = {"n_annotations": len(anns), "n_notes": len(next(iter(anns.values()))),
                            "mean_pairwise": mean(pw.values()), "min_pairwise": min(pw.values()),
                            "max_pairwise": max(pw.values()),
                            "pairs": {f"{a}:{meta[piece]['annotators'].get(a, '?')}-{b}:"
                                      f"{meta[piece]['annotators'].get(b, '?')}": round(v, 4)
                                      for (a, b), v in pw.items()}}
        pairs_all += list(pw.values())
        by_subset[pig_subset(piece)].append(mean(pw.values()))
        for (a, b), v in pw.items():
            ia, ib = sorted([meta[piece]["annotators"].get(a, a), meta[piece]["annotators"].get(b, b)])
            by_annotator_pair[f"{ia}-{ib}"].append(v)
        if len(anns) >= 3:
            for j, v in j_player_match([anns[k].notes for k in sorted(anns)]).items():
                j_by_subset[pig_subset(piece)][j].append(v)
    # Human reference (Table 2) on the test split
    test = {p: a for p, a in ds.items() if int(p) <= 30}
    human = {}
    for mode in ("official", "press"):
        rows = []
        for piece, anns in test.items():
            loo = M.leave_one_out({k: v.notes for k, v in anns.items()}, piece, mode=mode)
            rows.append([mean(getattr(s, m) for s in loo) for m in M.METRIC_NAMES])
        human[mode] = {m: round(100 * mean(r[i] for r in rows), 2) for i, m in enumerate(M.METRIC_NAMES)}
    return {
        "pieces_with_multiple_annotations": len(per_piece),
        "pairwise_match_rate_mean_over_pairs": round(mean(pairs_all), 4),
        "pairwise_match_rate_mean_over_pieces": round(mean(p["mean_pairwise"] for p in per_piece.values()), 4),
        "pairwise_by_subset_mean_over_pieces": {k: {"mean": round(mean(v), 4), "sd": round(pstdev(v), 4),
                                                    "pieces": len(v)} for k, v in sorted(by_subset.items())},
        "j_player_match_by_subset": {s: {j: round(mean(v), 4) for j, v in sorted(d.items())}
                                     for s, d in sorted(j_by_subset.items())},
        "pairwise_by_annotator_pair": {k: {"mean": round(mean(v), 4), "pieces": len(v)}
                                       for k, v in sorted(by_annotator_pair.items(), key=lambda x: -len(x[1]))},
        "human_reference_test_split_percent": human,
        "human_reference_paper_table2": {"m_gen": 71.4, "m_high": 79.1, "m_soft": 90.8, "m_rec": 84.3},
        "per_piece": per_piece,
    }


def run_pig() -> None:
    ds = load_pig(DATA / "pig")
    anomalies, summary = basic_validation("pig", ds)
    meta = read_pig_list_csv(DATA / "pig")
    summary["annotators"] = dict(Counter(a for m in meta.values() for a in m["annotators"].values()).most_common())
    summary["annotations_per_piece"] = dict(sorted(Counter(len(a) for a in ds.values()).items()))
    summary["notes_total"] = sum(len(f) for a in ds.values() for f in a.values())
    summary["notes_unique_pieces"] = sum(len(next(iter(a.values()))) for a in ds.values())
    summary["list_csv_note_count_mismatch"] = {p: {"list_csv": m["notes"], "files": len(next(iter(ds[p].values())))}
                                               for p, m in meta.items()
                                               if m["notes"] != len(next(iter(ds[p].values())))}
    summary["finger_strings"] = dict(Counter(n.finger for a in ds.values() for f in a.values()
                                             for n in f.notes).most_common())
    summary["agreement"] = pig_agreement(ds)
    finish("pig", anomalies, summary)


def run_simple(name: str, ds: dict, extra: dict | None = None) -> None:
    anomalies, summary = basic_validation(name, ds)
    lab = sum(V.is_labeled(n) for a in ds.values() for f in a.values() for n in f.notes)
    tot = sum(len(f) for a in ds.values() for f in a.values())
    summary.update({"notes_total": tot, "notes_labeled": lab, "labeled_fraction": round(lab / tot, 4) if tot else 0})
    if extra:
        summary.update(extra)
    finish(name, anomalies, summary)


def finish(name: str, anomalies: list, summary: dict) -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    summary["errors_by_piece"] = dict(Counter(a.piece for a in anomalies if a.severity == "error").most_common())
    (REPORTS / f"{name}_validation.json").write_text(json.dumps(summary, indent=1, default=str), encoding="utf-8")
    p = write_anomalies(name, anomalies)
    print(f"{name}: {summary.get('pieces')} pieces, {summary.get('files')} files; anomalies "
          f"{summary['anomaly_counts']} -> {p.name}")


def main(argv: list[str]) -> int:
    which = argv or ["pig", "mutopia", "beringer", "pianovam"]
    for w in which:
        if w == "pig" and (DATA / "pig").exists():
            run_pig()
        elif w == "mutopia" and (DATA / "mutopia_fingering").exists():
            run_simple("mutopia", load_mutopia())
        elif w == "beringer" and (DATA / "beringer_fingering").exists():
            run_simple("beringer", load_beringer())
        elif w == "pianovam" and (DATA / "pianovam").exists():
            run_simple("pianovam_gt", load_pianovam(which="Fingering_GT"))
            run_simple("pianovam_auto", load_pianovam(which="Fingering"))
        elif Path(w).exists():
            run_simple(Path(w).name, load_generic(w))
        else:
            print(f"skip {w}: not present")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
