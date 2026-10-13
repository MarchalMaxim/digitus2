#!/usr/bin/env python
"""Item 1 and item 5 of the readability study: what editors print, and density targets.

    research/.venv-readability/Scripts/python.exe -X utf8 research/readability/stats.py

Reads the per-note feature table (``research/data/readability/features.csv``, built by
``build_features.py``) and writes small summaries to ``research/readability/results/``:

* ``density.json``        printed-digit density per level group, composer, hand, part (spread)
* ``print_rate_by_context.csv``  print rate (printed / notes) per score-only context value, by level group
* ``printed_contexts.json`` what the printed digits themselves reveal: crossings, position changes
                            (anchor model), gaps between digits, coverage of the spec's reduction list
"""
from __future__ import annotations

import csv
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
if str(RESEARCH) not in sys.path:
    sys.path.insert(0, str(RESEARCH))

from readability import corpus  # noqa: E402
from readability.features import read_feature_table  # noqa: E402

RESULTS = HERE / "results"
FEATURES_CSV = corpus.DATA / "readability" / "features.csv"
GROUPS = ("teaching", "concert", "other", "library")

CONTEXT_COLUMNS = [
    "first_of_piece", "first_of_hand", "after_rest", "after_rest_beat", "after_long_note",
    "leap_bin", "direction", "black", "prev_black", "is_chord", "chord_pos", "chord_outer",
    "repeated", "in_run", "run_pos", "density_bin", "bar_pos_bin", "downbeat", "hand", "grace",
]


def quantiles(xs: list[float]) -> dict:
    if not xs:
        return {}
    xs = sorted(xs)
    q = statistics.quantiles(xs, n=20, method="inclusive") if len(xs) >= 2 else [xs[0]] * 19
    return {"n": len(xs), "mean": round(statistics.fmean(xs), 4), "min": round(xs[0], 4),
            "p10": round(q[1], 4), "p25": round(q[4], 4), "median": round(statistics.median(xs), 4),
            "p75": round(q[14], 4), "p90": round(q[17], 4), "max": round(xs[-1], 4)}


def density_tables(parts: list[corpus.Part]) -> dict:
    out: dict = {"by_group": {}, "by_composer": {}, "by_hand": {}, "library_by_piece": [], "library_by_level": {}}
    for g in GROUPS:
        ps = [p for p in parts if p.level_group == g]
        notes = sum(len(p.notes) for p in ps)
        printed = sum(p.n_printed for p in ps)
        out["by_group"][g] = {"parts": len(ps), "notes": notes, "printed": printed,
                              "density_note_weighted": round(printed / notes, 4) if notes else None,
                              "part_density": quantiles([p.density for p in ps])}
        for hand, name in ((corpus.RH, "R"), (corpus.LH, "L")):
            hn = [n for p in ps for n in p.notes if n.hand == hand]
            hp = sum(1 for n in hn if n.printed)
            out["by_hand"][f"{g}/{name}"] = {"notes": len(hn), "printed": hp,
                                              "density": round(hp / len(hn), 4) if hn else None}
    # teaching repertoire without Clementi's Op. 42 lessons (exercise-style, often fully fingered)
    ps = [p for p in parts if p.level_group == "teaching" and p.composer != "ClementiM"]
    notes = sum(len(p.notes) for p in ps)
    printed = sum(p.n_printed for p in ps)
    out["by_group"]["teaching_excl_clementi"] = {"parts": len(ps), "notes": notes, "printed": printed,
                                                 "density_note_weighted": round(printed / notes, 4) if notes else None,
                                                 "part_density": quantiles([p.density for p in ps])}
    for g in list(out["by_group"]):
        ps = [p for p in parts if p.level_group == g] if g in GROUPS else             [p for p in parts if p.level_group == "teaching" and p.composer != "ClementiM"]
        out["by_group"][g]["parts_density_ge_90pct"] = sum(1 for p in ps if p.density >= 0.9)
        out["by_group"][g]["parts_density_lt_5pct"] = sum(1 for p in ps if p.density < 0.05)
    comp: dict[str, list[corpus.Part]] = defaultdict(list)
    for p in parts:
        comp[p.composer if p.source == "mutopia" else f"library:{p.composer}"].append(p)
    for c, ps in sorted(comp.items(), key=lambda kv: -sum(len(p.notes) for p in kv[1])):
        notes = sum(len(p.notes) for p in ps)
        printed = sum(p.n_printed for p in ps)
        out["by_composer"][c] = {"group": "/".join(sorted({p.level_group for p in ps})), "parts": len(ps), "notes": notes, "printed": printed,
                                 "density_note_weighted": round(printed / notes, 4),
                                 "part_density_median": round(statistics.median(p.density for p in ps), 4),
                                 "part_density_min": round(min(p.density for p in ps), 4),
                                 "part_density_max": round(max(p.density for p in ps), 4)}
    lib = [p for p in parts if p.source == "library"]
    for p in lib:
        rh = [n for n in p.notes if n.hand == corpus.RH]
        lh = [n for n in p.notes if n.hand == corpus.LH]
        out["library_by_piece"].append({"id": p.id, "level": p.level, "notes": len(p.notes), "printed": p.n_printed,
                                        "density": round(p.density, 4),
                                        "density_rh": round(sum(n.printed for n in rh) / len(rh), 4) if rh else None,
                                        "density_lh": round(sum(n.printed for n in lh) / len(lh), 4) if lh else None,
                                        "edition": p.meta.get("source", "")})
    for lv in sorted({p.level for p in lib}):
        ps = [p for p in lib if p.level == lv]
        notes = sum(len(p.notes) for p in ps)
        printed = sum(p.n_printed for p in ps)
        out["library_by_level"][str(lv)] = {"pieces": len(ps), "notes": notes, "printed": printed,
                                            "density_note_weighted": round(printed / notes, 4),
                                            "part_density": quantiles([p.density for p in ps])}
    return out


def print_rate_by_context(rows: list[dict]) -> list[dict]:
    base = {g: [0, 0] for g in GROUPS}
    for r in rows:
        base[r["level_group"]][0] += r["printed"]
        base[r["level_group"]][1] += 1
    out = []
    for col in CONTEXT_COLUMNS:
        agg: dict = defaultdict(lambda: {g: [0, 0] for g in GROUPS})
        for r in rows:
            v = r[col]
            v = "none" if v is None else v
            a = agg[v][r["level_group"]]
            a[0] += r["printed"]
            a[1] += 1
        for v in sorted(agg, key=str):
            rec = {"context": col, "value": v}
            for g in GROUPS:
                p, n = agg[v][g]
                rate = p / n if n else None
                rec[f"{g}_printed"] = p
                rec[f"{g}_notes"] = n
                rec[f"{g}_rate"] = round(100 * rate, 1) if rate is not None else None
                rec[f"{g}_lift"] = round(rate / (base[g][0] / base[g][1]), 2) if rate is not None and base[g][1] else None
            out.append(rec)
    return out


def _bucket_gap(k: int | None) -> str:
    if k is None:
        return "none"
    if k == 1:
        return "1"
    if k == 2:
        return "2"
    if k <= 4:
        return "3-4"
    if k <= 8:
        return "5-8"
    return "9+"


def printed_contexts(rows: list[dict]) -> dict:
    out: dict = {}
    for g in GROUPS:
        gr = [r for r in rows if r["level_group"] == g]
        printed = [r for r in gr if r["printed"]]
        adj = [r for r in printed if r["anchor_delta"] is not None]      # previous event printed too
        cross = Counter((r["crossing"] or "none") for r in adj)
        deltas = Counter()
        for r in adj:
            d = abs(r["anchor_delta"])
            deltas["0" if d < 0.25 else "0.5" if d < 0.75 else "1" if d < 1.25 else "1.5" if d < 1.75
                   else "2" if d < 2.25 else "2.5-3.5" if d < 3.75 else "4+"] += 1
        pos_change = sum(1 for r in adj if abs(r["anchor_delta"]) >= 0.75)
        # gaps between consecutive printed digits (events since the previous printed event)
        gaps = [r["since_printed"] for r in printed if r["since_printed"] is not None]
        gap_hist = Counter(_bucket_gap(k) for k in gaps)
        # unprinted stretches: for unprinted notes, events since the last printed digit
        unp = Counter(_bucket_gap(r["since_printed"]) for r in gr if not r["printed"])
        # coverage of the spec's reduction contexts among printed digits
        def spec_ctx(r: dict) -> list[str]:
            c = []
            if r["first_of_hand"]:
                c.append("first_of_hand")
            if r["after_rest_beat"]:
                c.append("after_rest_beat")
            if r["after_long_note"]:
                c.append("after_long_note")
            if r["leap_abs"] is not None and r["leap_abs"] >= 5:
                c.append("leap_ge_fourth")
            if r["chord_outer"]:
                c.append("chord_outer")
            if r["run_pos"] == "start":
                c.append("run_start")
            if r["crossing"]:
                c.append("crossing")
            if r["anchor_delta"] is not None and abs(r["anchor_delta"]) >= 0.75:
                c.append("position_change")
            return c
        ctx_counts = Counter()
        covered = 0
        covered_score_only = 0
        for r in printed:
            cs = spec_ctx(r)
            for c in cs:
                ctx_counts[c] += 1
            if cs:
                covered += 1
            if any(c not in ("crossing", "position_change") for c in cs):
                covered_score_only += 1
        # isolated digits (no printed digit on the previous event) versus digits continuing a
        # fingered passage: which score-only contexts do the isolated ones sit in?
        iso = [r for r in printed if r["since_printed"] is None or r["since_printed"] >= 2]
        iso_ctx = Counter()
        all_ctx = Counter()
        for r in gr:
            cs = [c for c in spec_ctx(r) if c not in ("crossing", "position_change")]
            for c in cs:
                all_ctx[c] += 1
        for r in iso:
            cs = [c for c in spec_ctx(r) if c not in ("crossing", "position_change")]
            for c in cs:
                iso_ctx[c] += 1
        iso_cov = sum(1 for r in iso if any(c not in ("crossing", "position_change") for c in spec_ctx(r)))
        out[g] = {
            "isolated_digits": {"n": len(iso), "share_of_printed": round(len(iso) / len(printed), 4) if printed else None,
                                "contexts": {k: {"n": v, "share": round(v / len(iso), 4),
                                                 "share_among_all_notes": round(all_ctx[k] / len(gr), 4)}
                                             for k, v in sorted(iso_ctx.items())} if iso else {},
                                "covered_by_score_only_context": {"n": iso_cov, "share": round(iso_cov / len(iso), 4) if iso else None}},
            "printed": len(printed),
            "printed_with_printed_previous_event": len(adj),
            "share_adjacent_pairs": round(len(adj) / len(printed), 4) if printed else None,
            "crossing_among_adjacent": {k: {"n": v, "share": round(v / len(adj), 4)} for k, v in sorted(cross.items())} if adj else {},
            "anchor_delta_among_adjacent": {k: {"n": v, "share": round(v / len(adj), 4)} for k, v in sorted(deltas.items())} if adj else {},
            "position_change_among_adjacent": {"n": pos_change, "share": round(pos_change / len(adj), 4) if adj else None},
            "events_since_previous_digit": {**quantiles([float(k) for k in gaps]), "hist": dict(sorted(gap_hist.items()))},
            "unprinted_notes_by_events_since_digit": dict(sorted(unp.items())),
            "spec_context_counts_among_printed": {k: {"n": v, "share": round(v / len(printed), 4)} for k, v in sorted(ctx_counts.items())} if printed else {},
            "printed_covered_by_any_spec_context": {"n": covered, "share": round(covered / len(printed), 4) if printed else None},
            "printed_covered_by_score_only_context": {"n": covered_score_only, "share": round(covered_score_only / len(printed), 4) if printed else None},
        }
    return out


def main() -> int:
    RESULTS.mkdir(parents=True, exist_ok=True)
    parts = corpus.load_all()
    rows = read_feature_table(FEATURES_CSV)
    dens = density_tables(parts)
    with open(RESULTS / "density.json", "w", encoding="utf-8") as f:
        json.dump(dens, f, indent=1)
    ctx = print_rate_by_context(rows)
    with open(RESULTS / "print_rate_by_context.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(ctx[0].keys()))
        w.writeheader()
        w.writerows(ctx)
    pc = printed_contexts(rows)
    with open(RESULTS / "printed_contexts.json", "w", encoding="utf-8") as f:
        json.dump(pc, f, indent=1)
    # readable summary
    for g in dens["by_group"]:
        d = dens["by_group"][g]
        print(f"{g:9s} parts={d['parts']:3d} notes={d['notes']:6d} printed={d['printed']:5d} "
              f"density={100 * d['density_note_weighted']:.1f}% part median={100 * d['part_density']['median']:.1f}% "
              f"IQR {100 * d['part_density']['p25']:.1f}-{100 * d['part_density']['p75']:.1f}")
    for rec in ctx:
        print(f"{rec['context']:16s} {str(rec['value']):13s} " +
              "  ".join(f"{g[:4]}={rec[f'{g}_rate']}%/{rec[f'{g}_notes']}" for g in GROUPS))
    for g in GROUPS:
        p = pc[g]
        print(g, "adjacent pairs", p["printed_with_printed_previous_event"], "crossing", p["crossing_among_adjacent"],
              "pos change", p["position_change_among_adjacent"], "covered", p["printed_covered_by_any_spec_context"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
