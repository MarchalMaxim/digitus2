"""Compile every result JSON into the tables of docs/research/learning-prototype.md (printed as
Markdown) and ``research/learn/results/summary.json`` with paired-bootstrap intervals.

    research/.venv/Scripts/python.exe -I -m learn.experiments.make_report
"""
from __future__ import annotations

import json
from pathlib import Path

from ._common import RESULTS, save_json
from learn.scoring import paired_bootstrap


def load_dir(sub: str) -> dict[str, dict]:
    out = {}
    for p in sorted((RESULTS / sub).glob("*.json")):
        out[p.stem] = json.loads(p.read_text(encoding="utf-8"))
    return out


def fmt(x: float | None, nd: int = 2) -> str:
    return "-" if x is None else f"{x:.{nd}f}"


def ci(a: dict[str, float], b: dict[str, float]) -> dict:
    keys = sorted(set(a) & set(b))
    return paired_bootstrap([a[k] for k in keys], [b[k] for k in keys])


def delta_str(d: dict) -> str:
    return f"{d['delta']:+.2f} [{d['ci95'][0]:+.2f}, {d['ci95'][1]:+.2f}]"


def val_row(name: str, r: dict, base: dict | None = None) -> str:
    v = r["validation"]
    d = delta_str(ci(r["validation_per_piece"], base)) if base else "-"
    return (f"| {name} | {fmt(v['m_gen'])} | {fmt(v['m_high'])} | {fmt(v['m_soft'])} | {fmt(v['m_rec'])} | "
            f"{r['best_epoch']} | {d} | {fmt(r['seconds_per_epoch'], 1)} |")


HEAD = "| run | M_gen | M_high | M_soft | M_rec | best epoch | delta gen vs Parncutt [95% CI] | s/epoch |\n|---|---|---|---|---|---|---|---|"


def main() -> int:
    lines: list[str] = []
    summary: dict = {}
    sweep = load_dir("sweep")
    base_pp = None
    base = None
    for r in sweep.values():
        base_pp = r.get("baseline_validation_per_piece")
        base = r.get("baseline_validation")
        break
    if base:
        lines.append(f"Parncutt baseline (engine rules + template, weight set on disk) on validation: "
                     f"M_gen {fmt(base['m_gen'])} / M_high {fmt(base['m_high'])} / M_soft {fmt(base['m_soft'])} / "
                     f"M_rec {fmt(base['m_rec'])} ({base['pieces']} pieces, {base['notes']} notes)")
        summary["baseline_validation"] = base
    # (a) sweep table rho x C
    if sweep:
        lines.append("\n### (a) PA-I sweep: validation M_gen by rho (rows) and C (columns), best epoch of 20\n")
        rhos = sorted({r["options"]["rho"] for r in sweep.values()})
        cs = sorted({r["options"]["C"] for r in sweep.values()})
        lines.append("| rho \\ C | " + " | ".join(str(c) for c in cs) + " |")
        lines.append("|---|" + "---|" * len(cs))
        for rho in rhos:
            cells = []
            for c in cs:
                r = next((x for x in sweep.values() if x["options"]["rho"] == rho and x["options"]["C"] == c), None)
                cells.append(f"{fmt(r['validation']['m_gen'])} (ep {r['best_epoch']})" if r else "-")
            lines.append(f"| {rho} | " + " | ".join(cells) + " |")
        lines.append("\n" + HEAD)
        for name, r in sorted(sweep.items(), key=lambda kv: -kv[1]["validation"]["m_gen"]):
            lines.append(val_row(name, r, base_pp))
        best_name = max(sweep, key=lambda k: sweep[k]["validation"]["m_gen"])
        summary["sweep"] = {k: {"validation": v["validation"], "best_epoch": v["best_epoch"], "options": v["options"],
                                "seconds_per_epoch": v["seconds_per_epoch"],
                                "delta_vs_parncutt": ci(v["validation_per_piece"], base_pp)} for k, v in sweep.items()}
        summary["sweep_best"] = best_name
        # epoch curve of the best run
        lines.append(f"\nEpoch curve of the best sweep run `{best_name}` (validation M_gen per epoch, averaged weights):\n")
        lines.append("| epoch | updates | infeasible targets | mean loss | aug. hamming | val M_gen | val M_high | val M_soft | val M_rec | s |")
        lines.append("|---|---|---|---|---|---|---|---|---|---|")
        for e in sweep[best_name]["epochs"]:
            v = e["validation"]
            lines.append(f"| {e['epoch']} | {e['updates']} | {e['infeasible']} | {fmt(e['mean_loss'], 1)} | "
                         f"{fmt(100 * e['hamming_rate'], 1)}% | {fmt(v['m_gen'])} | {fmt(v['m_high'])} | {fmt(v['m_soft'])} | "
                         f"{fmt(v['m_rec'])} | {fmt(e['seconds'], 1)} |")
    variants = load_dir("variants")
    if variants and sweep:
        best = sweep[summary["sweep_best"]]
        lines.append(f"\n### (a) trainer variants at the best (rho, C) = ({best['options']['rho']}, {best['options']['C']}); "
                     "delta is against that run (paired bootstrap over the 20 pieces)\n")
        lines.append("| run | M_gen | M_high | M_soft | M_rec | best epoch | delta gen vs best PA [95% CI] | s/epoch |")
        lines.append("|---|---|---|---|---|---|---|---|")
        lines.append(val_row("best PA (reference)", best, None))
        summary["variants"] = {}
        for name, r in variants.items():
            lines.append(val_row(name, r, best["validation_per_piece"]))
            summary["variants"][name] = {"validation": r["validation"], "best_epoch": r["best_epoch"],
                                         "options": r["options"], "delta_vs_best_pa": ci(r["validation_per_piece"], best["validation_per_piece"]),
                                         "delta_vs_parncutt": ci(r["validation_per_piece"], base_pp)}
    ablation = load_dir("ablation")
    if ablation:
        lines.append("\n### (b) feature family ablation (cumulative), validation; delta against the previous row\n")
        lines.append("| features | n | M_gen | M_high | M_soft | M_rec | best epoch | delta gen vs previous [95% CI] | delta gen vs Parncutt [95% CI] |")
        lines.append("|---|---|---|---|---|---|---|---|---|")
        prev = None
        summary["ablation"] = {}
        for name, r in ablation.items():
            v = r["validation"]
            d_prev = delta_str(ci(r["validation_per_piece"], prev["validation_per_piece"])) if prev else "-"
            d_base = delta_str(ci(r["validation_per_piece"], base_pp)) if base_pp else "-"
            lines.append(f"| {'+'.join(r['families'])} | {r['features']} | {fmt(v['m_gen'])} | {fmt(v['m_high'])} | "
                         f"{fmt(v['m_soft'])} | {fmt(v['m_rec'])} | {r['best_epoch']} | {d_prev} | {d_base} |")
            summary["ablation"][name] = {"families": r["families"], "features": r["features"], "validation": v,
                                         "best_epoch": r["best_epoch"],
                                         "delta_vs_previous": ci(r["validation_per_piece"], prev["validation_per_piece"]) if prev else None,
                                         "delta_vs_parncutt": ci(r["validation_per_piece"], base_pp) if base_pp else None}
            prev = r
        # leave-one-out style: full minus each family is not run; report the top weights of the last model
        last = list(ablation.values())[-1]
        w = sorted(last["weights"].items(), key=lambda kv: -abs(kv[1]))[:25]
        lines.append("\nLargest learned weights of the last ablation model (absolute value):\n")
        lines.append("| feature | weight |\n|---|---|")
        for k, v in w:
            lines.append(f"| `{k}` | {v:+.3f} |")
    partial = load_dir("partial")
    if partial:
        lines.append("\n### (c) partial supervision: PIG train with and without the Mutopia train half (finger 0 = unknown)\n")
        lines.append("| run | train notes (fingered) | PIG val M_gen | PIG val M_rec | Mutopia test M_gen (fingered notes) | delta PIG val vs pig_only [95% CI] | delta Mutopia test vs pig_only [95% CI] | s/epoch |")
        lines.append("|---|---|---|---|---|---|---|---|")
        ref = partial.get("pig_only")
        summary["partial"] = {}
        for name, r in partial.items():
            mt = r["evals"]["mutopia-test"]
            d1 = delta_str(ci(r["validation_per_piece"], ref["validation_per_piece"])) if ref and name != "pig_only" else "-"
            d2 = delta_str(ci(r["evals_per_piece"]["mutopia-test"], ref["evals_per_piece"]["mutopia-test"])) if ref and name != "pig_only" else "-"
            lines.append(f"| {name} | {r['train_notes']} ({r['train_fingered']}) | {fmt(r['validation']['m_gen'])} | "
                         f"{fmt(r['validation']['m_rec'])} | {fmt(mt['m_gen'])} ({mt['pieces']} parts, {mt['notes']} notes) | {d1} | {d2} | {fmt(r['seconds_per_epoch'], 1)} |")
            summary["partial"][name] = {"validation": r["validation"], "mutopia_test": mt, "train_notes": r["train_notes"],
                                        "train_fingered": r["train_fingered"], "best_epoch": r["best_epoch"],
                                        "seconds_per_epoch": r["seconds_per_epoch"]}
        if ref and ref.get("baseline_evals"):
            b = ref["baseline_evals"]["mutopia-test"]
            lines.append(f"\nParncutt baseline on the Mutopia test half: M_gen {fmt(b['m_gen'])} ({b['pieces']} parts, {b['notes']} fingered notes).")
            summary["baseline_mutopia_test"] = b
    open_ = load_dir("open")
    if open_:
        lines.append("\n### (d) open configuration (textbook + Beringer + Mutopia train): what the shippable set reaches on PIG validation\n")
        lines.append("| run | train notes (fingered) | PIG val M_gen | PIG val M_high | PIG val M_soft | PIG val M_rec | delta vs Parncutt [95% CI] | Mutopia test M_gen | best epoch |")
        lines.append("|---|---|---|---|---|---|---|---|---|")
        summary["open"] = {}
        for name, r in open_.items():
            v = r["validation"]
            mt = r["evals"]["mutopia-test"]
            d = delta_str(ci(r["validation_per_piece"], base_pp)) if base_pp else "-"
            lines.append(f"| {name} | {r['train_notes']} ({r['train_fingered']}) | {fmt(v['m_gen'])} | {fmt(v['m_high'])} | "
                         f"{fmt(v['m_soft'])} | {fmt(v['m_rec'])} | {d} | {fmt(mt['m_gen'])} | {r['best_epoch']} |")
            summary["open"][name] = {"validation": v, "mutopia_test": mt, "best_epoch": r["best_epoch"],
                                     "delta_vs_parncutt": ci(r["validation_per_piece"], base_pp) if base_pp else None,
                                     "train_notes": r["train_notes"], "train_fingered": r["train_fingered"]}
    seeds = load_dir("seeds")
    if seeds and sweep:
        import statistics

        best = sweep[summary["sweep_best"]]
        vals = [r["validation"]["m_gen"] for r in seeds.values()] + [best["validation"]["m_gen"]]
        eps = [r["best_epoch"] for r in seeds.values()] + [best["best_epoch"]]
        lines.append(f"\n### seed variance of the best PA setting (validation M_gen, best epoch of 20): "
                     f"{', '.join(fmt(v) for v in vals)} -> mean {fmt(statistics.mean(vals))}, "
                     f"sd {fmt(statistics.stdev(vals))}, best epochs {eps}\n")
        summary["seeds"] = {"values": vals, "mean": statistics.mean(vals), "sd": statistics.stdev(vals), "best_epochs": eps}
    cv = load_dir("cv")
    if cv:
        lines.append("\n### (f) 5-fold cross-validation over all 120 PIG train pieces (3 epochs, last averaged weights); "
                     "paired bootstrap over the 120 held-out pieces against the plan configuration\n")
        variants_cv: dict[str, dict[str, float]] = {}
        base_cv: dict[str, float] = {}
        for name, r in cv.items():
            v = name.split("_", 1)[1]
            variants_cv.setdefault(v, {}).update(r["validation_per_piece"])
            base_cv.update(r.get("baseline_validation_per_piece", {}))
        lines.append("| configuration | pieces | mean M_gen | delta vs plan [95% CI] | delta vs Parncutt [95% CI] |")
        lines.append("|---|---|---|---|---|")
        summary["cv"] = {}
        plan = variants_cv.get("plan", {})
        if base_cv:
            lines.append(f"| Parncutt (no learning) | {len(base_cv)} | {fmt(sum(base_cv.values()) / len(base_cv))} | "
                         f"{delta_str(ci(base_cv, plan)) if plan else '-'} | - |")
        for v, pp in variants_cv.items():
            mean = sum(pp.values()) / len(pp)
            d_plan = delta_str(ci(pp, plan)) if plan and v != "plan" else "-"
            d_base = delta_str(ci(pp, base_cv)) if base_cv else "-"
            lines.append(f"| {v} | {len(pp)} | {fmt(mean)} | {d_plan} | {d_base} |")
            summary["cv"][v] = {"pieces": len(pp), "mean_m_gen": mean,
                                "delta_vs_plan": ci(pp, plan) if plan and v != "plan" else None,
                                "delta_vs_parncutt": ci(pp, base_cv) if base_cv else None}
    pigc = load_dir("pigconfig")
    if pigc:
        lines.append("\n### the plan's `pig` configuration (PIG train + textbook + Beringer) and everything together\n")
        lines.append("| run | train notes (fingered) | PIG val M_gen | PIG val M_high | PIG val M_soft | PIG val M_rec | delta vs Parncutt [95% CI] | Mutopia test M_gen | best epoch |")
        lines.append("|---|---|---|---|---|---|---|---|---|")
        summary["pigconfig"] = {}
        for name, r in pigc.items():
            v = r["validation"]
            mt = r["evals"]["mutopia-test"]
            d = delta_str(ci(r["validation_per_piece"], base_pp)) if base_pp else "-"
            lines.append(f"| {name} | {r['train_notes']} ({r['train_fingered']}) | {fmt(v['m_gen'])} | {fmt(v['m_high'])} | "
                         f"{fmt(v['m_soft'])} | {fmt(v['m_rec'])} | {d} | {fmt(mt['m_gen'])} | {r['best_epoch']} |")
            summary["pigconfig"][name] = {"validation": v, "mutopia_test": mt, "best_epoch": r["best_epoch"],
                                          "train_notes": r["train_notes"], "train_fingered": r["train_fingered"]}
    # (e) timing
    lines.append("\n### (e) timing (Python prototype, one core, below-normal priority)\n")
    lines.append("| run | train notes | features | s/epoch | epochs | total s |\n|---|---|---|---|---|---|")
    summary["timing"] = {}
    for sub in ("sweep", "variants", "ablation", "partial", "open", "cv", "seeds", "pigconfig"):
        for name, r in load_dir(sub).items():
            lines.append(f"| {sub}/{name} | {r['train_notes']} | {r['features']} | {fmt(r['seconds_per_epoch'], 2)} | "
                         f"{len(r['epochs'])} | {fmt(r['total_seconds'], 1)} |")
            summary["timing"][f"{sub}/{name}"] = {"train_notes": r["train_notes"], "features": r["features"],
                                                  "seconds_per_epoch": r["seconds_per_epoch"], "epochs": len(r["epochs"]),
                                                  "total_seconds": r["total_seconds"]}
    text = "\n".join(lines) + "\n"
    (RESULTS / "report_tables.md").write_text(text, encoding="utf-8")
    save_json("summary.json", summary)
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
