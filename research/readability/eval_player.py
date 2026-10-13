"""Evaluate the player model on the editorial corpus (Mutopia ``ok`` parts + library pieces).

Protocols
---------
1. **Hide-20** (primary): per part and hand, hide a random 20 percent of the printed digits
   (``random.Random(seed)``, one generator per seed, parts in corpus order, RH then LH), read the
   hand with the remaining digits visible, and score every hidden note against the editor's digit.
2. **Leave-one-out** (secondary): hide each printed digit alone, everything else visible.

Metrics: ``coverage = inferred / hidden``, ``accuracy = correct / inferred``,
``reconstruction = correct / hidden``. Hide-20 headline numbers are the mean over seeds with the
min and max across seeds; the per-rule, per-context, distance and confusion tables sum the counts
over all seeds.

Usage::

    OMP_NUM_THREADS=2 research/.venv-readability/Scripts/python.exe -X utf8 \\
        research/readability/eval_player.py --seeds 0 1 2 3 4
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import sys
import time
from bisect import bisect_left
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import NamedTuple

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from readability import corpus, features  # noqa: E402
from readability import player_model as PM  # noqa: E402
from readability import textbook as TB  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"
GROUPS = ("teaching", "concert", "other", "library")
MAIN_MODELS = ("copy_previous", "rules", "rules_plus_textbook")
SENSITIVITY_MODELS = ("rules_column_steps",)
# model name -> (reader kind, model passed to HandReader.infer)
MODEL_SPECS = {
    "copy_previous": ("std", "copy_previous"),
    "rules": ("std", "rules"),
    "rules_plus_textbook": ("std", "rules_plus_textbook"),
    "rules_column_steps": ("col", "rules"),
}
CONTEXTS = ("leap_bin", "chord_pos", "black", "in_run", "run_pos", "after_rest_beat",
            "after_long_note", "repeated", "density_bin", "hand", "since_printed")
RULE_ORDER = ("R0", "textbook", "R1", "R2", "R3", "R4", "R4_ref", "copy", "none")
DIST_BUCKETS = ("0", "1", "2", "3", "4", "5-8", "9-16", "17+", "none")


def since_bucket(v) -> str:
    if v is None:
        return "none"
    v = int(v)
    if v <= 1:
        return "1"
    if v == 2:
        return "2"
    if v <= 4:
        return "3-4"
    if v <= 8:
        return "5-8"
    return "9+"


def dist_bucket(d) -> str:
    if d is None:
        return "none"
    if d <= 4:
        return str(d)
    if d <= 8:
        return "5-8"
    if d <= 16:
        return "9-16"
    return "17+"


class Rec(NamedTuple):
    model: str
    group: str
    part: int          # index into the prepared list
    idx: int
    hand: int
    true: int
    pred: int | None
    rule: str
    dist: int | None   # events since the last event with a visible digit (0 = same chord)


@dataclass
class PartData:
    k: int
    part: corpus.Part
    readers: dict = field(default_factory=dict)      # (kind, hand) -> HandReader
    ctx: dict = field(default_factory=dict)          # idx -> {context: value} (printed notes only)

    @property
    def group(self) -> str:
        return self.part.level_group


def prepare(parts: list[corpus.Part], textbook_index=None, models=MAIN_MODELS) -> list[PartData]:
    kinds = {MODEL_SPECS[m][0] for m in models}
    out = []
    for k, part in enumerate(parts):
        pd = PartData(k=k, part=part)
        for hand in (corpus.RH, corpus.LH):
            notes = part.hand_notes(hand)
            if not notes:
                continue
            if "std" in kinds:
                pd.readers[("std", hand)] = PM.HandReader(notes, textbook_index)
            if "col" in kinds:
                pd.readers[("col", hand)] = PM.HandReader(notes, None, step_fn=PM.column_steps)
        for row in features.compute_features(part):
            if row["printed"]:
                c = {name: row[name] for name in CONTEXTS}
                c["since_printed"] = since_bucket(row["since_printed"])
                pd.ctx[row["idx"]] = c
        out.append(pd)
    return out


def n_hide(n_printed: int, frac: float) -> int:
    return int(frac * n_printed + 0.5)


def choose_hidden(part: corpus.Part, rng: random.Random, frac: float) -> set[int]:
    hidden: set[int] = set()
    for hand in (corpus.RH, corpus.LH):
        printed = sorted(n.idx for n in part.notes if n.hand == hand and n.printed)
        hidden.update(rng.sample(printed, n_hide(len(printed), frac)))
    return hidden


def run_hide(pd: PartData, hidden: set[int], models=MAIN_MODELS) -> list[Rec]:
    recs: list[Rec] = []
    for hand in (corpus.RH, corpus.LH):
        base = pd.readers.get(("std", hand)) or pd.readers.get(("col", hand))
        if base is None:
            continue
        hid = [n for n in base.printed if n.idx in hidden]
        if not hid:
            continue
        visible = {n.idx for n in base.printed if n.idx not in hidden}
        vis_events = sorted({base.ev_of[i] for i in visible})
        dist = {}
        for n in hid:
            e = base.ev_of[n.idx]
            k = bisect_left(vis_events, e + 1) - 1
            dist[n.idx] = None if k < 0 else e - vis_events[k]
        for m in models:
            kind, name = MODEL_SPECS[m]
            res = pd.readers[(kind, hand)].infer(visible, name)
            for n in hid:
                f, rule = res[n.idx]
                recs.append(Rec(m, pd.group, pd.k, n.idx, hand, n.finger, f, rule, dist[n.idx]))
    return recs


def run_loo(pd: PartData, models=MAIN_MODELS) -> list[Rec]:
    recs: list[Rec] = []
    for hand in (corpus.RH, corpus.LH):
        for m in models:
            kind, name = MODEL_SPECS[m]
            reader = pd.readers.get((kind, hand))
            if reader is None:
                continue
            res = reader.leave_one_out(name)
            for n in reader.printed:
                f, rule = res[n.idx]
                recs.append(Rec(m, pd.group, pd.k, n.idx, hand, n.finger, f, rule, None))
    return recs


# ---------------------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------------------

def _empty():
    return {"n_hidden": 0, "inferred": 0, "correct": 0}


def summarize_counts(recs) -> dict[tuple[str, str], dict]:
    out: dict[tuple[str, str], dict] = defaultdict(_empty)
    for r in recs:
        for g in (r.group, "all"):
            c = out[(r.model, g)]
            c["n_hidden"] += 1
            if r.pred is not None:
                c["inferred"] += 1
                c["correct"] += int(r.pred == r.true)
    return dict(out)


def _ratio(a, b):
    return a / b if b else None


def metrics(c: dict) -> dict:
    return {"coverage": _ratio(c["inferred"], c["n_hidden"]),
            "accuracy": _ratio(c["correct"], c["inferred"]),
            "reconstruction": _ratio(c["correct"], c["n_hidden"])}


def _stat(values):
    vals = [v for v in values if v is not None]
    if not vals:
        return {"mean": None, "min": None, "max": None}
    return {"mean": round(sum(vals) / len(vals), 4), "min": round(min(vals), 4), "max": round(max(vals), 4)}


def seed_stats(per_seed: list[dict], models) -> dict:
    out = {}
    for m in models:
        out[m] = {}
        for g in GROUPS + ("all",):
            rows = [s.get((m, g), _empty()) for s in per_seed]
            mets = [metrics(c) for c in rows]
            out[m][g] = {"n_hidden": _stat([c["n_hidden"] for c in rows]),
                         **{k: _stat([x[k] for x in mets]) for k in ("coverage", "accuracy", "reconstruction")}}
    return out


def by_rule(recs) -> dict[tuple[str, str, str], list[int]]:
    out: dict = defaultdict(lambda: [0, 0])
    for r in recs:
        for g in (r.group, "all"):
            c = out[(r.model, g, r.rule)]
            c[0] += 1
            c[1] += int(r.pred is not None and r.pred == r.true)
    return out


def by_context(recs, pds: list[PartData]) -> dict[tuple, list[int]]:
    out: dict = defaultdict(lambda: [0, 0, 0])
    for r in recs:
        ctx = pds[r.part].ctx[r.idx]
        inf = r.pred is not None
        ok = inf and r.pred == r.true
        for g in (r.group, "all"):
            for name in CONTEXTS:
                c = out[(r.model, g, name, str(ctx[name]))]
                c[0] += 1
                c[1] += int(inf)
                c[2] += int(ok)
    return out


def by_distance(recs) -> dict:
    out: dict = defaultdict(lambda: [0, 0, 0])
    for r in recs:
        c = out[(r.model, dist_bucket(r.dist))]
        c[0] += 1
        c[1] += int(r.pred is not None)
        c[2] += int(r.pred is not None and r.pred == r.true)
    return out


def confusion(recs, model: str) -> list[list[int]]:
    mat = [[0] * 5 for _ in range(5)]
    for r in recs:
        if r.model == model and r.pred is not None and 1 <= r.true <= 5:
            mat[r.true - 1][r.pred - 1] += 1
    return mat


def _r(x, nd=4):
    return None if x is None else round(x, nd)


# ---------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2, 3, 4])
    ap.add_argument("--frac", type=float, default=0.2)
    ap.add_argument("--out", type=Path, default=RESULTS)
    ap.add_argument("--no-sensitivity", action="store_true", help="skip the column-steps variant")
    args = ap.parse_args(argv)
    t0 = time.time()

    parts = corpus.load_all()
    tb = TB.TextbookIndex.load()
    models_all = MAIN_MODELS + (() if args.no_sensitivity else SENSITIVITY_MODELS)
    pds = prepare(parts, tb, models_all)
    t_prep = time.time() - t0

    # -------------------------------------------------------------- hide-20
    per_seed, all_recs = [], []
    for seed in args.seeds:
        rng = random.Random(seed)
        recs: list[Rec] = []
        for pd in pds:
            recs.extend(run_hide(pd, choose_hidden(pd.part, rng, args.frac), models_all))
        per_seed.append(summarize_counts(recs))
        all_recs.extend(recs)
    t_hide = time.time() - t0 - t_prep

    # -------------------------------------------------------------- leave-one-out
    loo_recs: list[Rec] = []
    for pd in pds:
        loo_recs.extend(run_loo(pd, models_all))
    t_loo = time.time() - t0 - t_prep - t_hide

    main_recs = [r for r in all_recs if r.model in MAIN_MODELS]
    hide = seed_stats(per_seed, models_all)
    loo_counts = summarize_counts(loo_recs)
    loo = {m: {g: {**loo_counts.get((m, g), _empty()),
                   **{k: _r(v) for k, v in metrics(loo_counts.get((m, g), _empty())).items()}}
               for g in GROUPS + ("all",)} for m in models_all}

    rule_counts = by_rule(main_recs)
    loo_rule_counts = by_rule([r for r in loo_recs if r.model in MAIN_MODELS])
    ctx_counts = by_context(main_recs, pds)
    dist_counts = by_distance(main_recs)

    # worst contexts for the rule model (all groups pooled, >= 100 inferred over all seeds)
    ctx_rows = []
    for (m, g, name, val), (n, inf, ok) in ctx_counts.items():
        if m == "rules" and g == "all":
            ctx_rows.append({"context": name, "value": val, "n": n, "inferred": inf, "correct": ok,
                             "coverage": _r(_ratio(inf, n)), "accuracy": _r(_ratio(ok, inf))})
    worst_acc = sorted([r for r in ctx_rows if r["inferred"] >= 100], key=lambda r: r["accuracy"])[:10]
    worst_cov = sorted([r for r in ctx_rows if r["n"] >= 100], key=lambda r: r["coverage"])[:10]

    # -------------------------------------------------------------- outputs
    args.out.mkdir(parents=True, exist_ok=True)
    with open(args.out / "player_model_by_context.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["model", "level_group", "context", "value", "n", "inferred", "correct", "coverage", "accuracy"])
        for (m, g, name, val), (n, inf, ok) in sorted(
                ctx_counts.items(), key=lambda kv: (MAIN_MODELS.index(kv[0][0]), (GROUPS + ("all",)).index(kv[0][1]),
                                                    CONTEXTS.index(kv[0][2]), kv[0][3])):
            w.writerow([m, g, name, val, n, inf, ok, _r(_ratio(inf, n)), _r(_ratio(ok, inf))])
    with open(args.out / "player_model_by_rule.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["protocol", "model", "level_group", "rule", "n", "correct", "accuracy", "share"])
        for proto, counts in (("hide20", rule_counts), ("loo", loo_rule_counts)):
            totals = Counter()
            for (m, g, rule), (n, ok) in counts.items():
                totals[(m, g)] += n
            for (m, g, rule), (n, ok) in sorted(
                    counts.items(), key=lambda kv: (MAIN_MODELS.index(kv[0][0]), (GROUPS + ("all",)).index(kv[0][1]),
                                                    RULE_ORDER.index(kv[0][2]))):
                acc = None if rule == "none" else _r(_ratio(ok, n))
                w.writerow([proto, m, g, rule, n, ok, acc, _r(_ratio(n, totals[(m, g)]))])

    def rule_table(counts, m):
        tot = sum(n for (mm, g, _), (n, _) in counts.items() if mm == m and g == "all")
        return {rule: {"n": counts[(m, "all", rule)][0], "correct": counts[(m, "all", rule)][1],
                       "share": _r(_ratio(counts[(m, "all", rule)][0], tot)),
                       "accuracy": None if rule == "none" else _r(_ratio(counts[(m, "all", rule)][1],
                                                                         counts[(m, "all", rule)][0]))}
                for rule in RULE_ORDER if (m, "all", rule) in counts}

    corpus_stats = {g: {"parts": sum(1 for p in parts if p.level_group == g),
                        "notes": sum(len(p.notes) for p in parts if p.level_group == g),
                        "printed": sum(p.n_printed for p in parts if p.level_group == g)} for g in GROUPS}
    corpus_stats["all"] = {"parts": len(parts), "notes": sum(len(p.notes) for p in parts),
                           "printed": sum(p.n_printed for p in parts)}
    py = Path(sys.executable)
    try:
        py = py.relative_to(corpus.ROOT)
    except ValueError:
        pass
    script = Path(__file__).resolve()
    try:
        script = script.relative_to(corpus.ROOT)
    except ValueError:
        pass
    command = f"OMP_NUM_THREADS=2 {py.as_posix()} -X utf8 {script.as_posix()}" + \
        ("" if argv is None and len(sys.argv) <= 1 else " " + " ".join(sys.argv[1:] if argv is None else argv))
    result = {
        "command": command,
        "seeds": args.seeds,
        "hide_fraction": args.frac,
        "hidden_per_hand": "int(frac * n_printed_in_hand + 0.5), sampled with random.Random(seed).sample over "
                           "sorted printed idx, parts in corpus.load_all() order, RH then LH",
        "corpus": corpus_stats,
        "models": {
            "copy_previous": "every unprinted note gets the finger of the last visible digit of the hand",
            "rules": "forward reader R1 repeat, R2 step, R3 position from last visible digit, R4 chord fill "
                     "(steps = round_half_away_from_zero(semitones / 2))",
            "rules_plus_textbook": "rules, with confirmed textbook scale/arpeggio/chromatic runs taking precedence "
                                   "over R1-R3 for notes inside a matched run (>= 4 single-note events)",
            "rules_column_steps": "sensitivity only: rules with steps = rounded white-key column difference",
        },
        "metric_definitions": {"coverage": "inferred / hidden", "accuracy": "correct / inferred",
                               "reconstruction": "correct / hidden"},
        "hide20": hide,
        "hide20_by_rule_all_groups": {m: rule_table(rule_counts, m) for m in MAIN_MODELS},
        "hide20_by_distance_since_visible": {
            m: {b: {"n": dist_counts[(m, b)][0], "inferred": dist_counts[(m, b)][1], "correct": dist_counts[(m, b)][2],
                    "coverage": _r(_ratio(dist_counts[(m, b)][1], dist_counts[(m, b)][0])),
                    "accuracy": _r(_ratio(dist_counts[(m, b)][2], dist_counts[(m, b)][1]))}
                for b in DIST_BUCKETS if (m, b) in dist_counts} for m in MAIN_MODELS},
        "hide20_confusion_rules": {"rows": "editor finger 1..5", "cols": "inferred finger 1..5",
                                   "counts": confusion(main_recs, "rules")},
        "hide20_confusion_rules_plus_textbook": {"rows": "editor finger 1..5", "cols": "inferred finger 1..5",
                                                 "counts": confusion(main_recs, "rules_plus_textbook")},
        "hide20_worst_contexts_rules_by_accuracy": worst_acc,
        "hide20_worst_contexts_rules_by_coverage": worst_cov,
        "loo": loo,
        "loo_by_rule_all_groups": {m: rule_table(loo_rule_counts, m) for m in MAIN_MODELS},
        "notes": [
            "Hide-20 headline numbers: mean over seeds, with min and max across seeds.",
            "Tables by rule, context, distance and the confusion matrices sum counts over all seeds.",
            "since_printed is the score's own distance (events) to the previous printed event; the distance "
            "table uses the reader's view (previous event with a visible digit after hiding).",
        ],
        "runtime_sec": {"prepare": round(t_prep, 1), "hide20": round(t_hide, 1), "loo": round(t_loo, 1),
                        "total": round(time.time() - t0, 1)},
    }
    with open(args.out / "player_model.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1)
        f.write("\n")

    print_summary(result)
    return 0


def _fmt(st):
    if st["mean"] is None:
        return "    -              "
    return f"{st['mean']:.3f} [{st['min']:.3f}-{st['max']:.3f}]"


def print_summary(res: dict) -> None:
    print(f"command: {res['command']}")
    print(f"corpus: {res['corpus']['all']}")
    print(f"\nHide-{int(res['hide_fraction'] * 100)} (seeds {res['seeds']}): mean [min-max]")
    print(f"{'model':22s} {'group':9s} {'hidden':>7s}  {'coverage':21s} {'accuracy':21s} {'reconstruction':21s}")
    for m, groups in res["hide20"].items():
        for g, st in groups.items():
            print(f"{m:22s} {g:9s} {st['n_hidden']['mean'] or 0:7.0f}  {_fmt(st['coverage'])} "
                  f"{_fmt(st['accuracy'])} {_fmt(st['reconstruction'])}")
    print("\nLeave-one-out")
    print(f"{'model':22s} {'group':9s} {'n':>7s} {'coverage':>9s} {'accuracy':>9s} {'recon':>9s}")
    for m, groups in res["loo"].items():
        for g, st in groups.items():
            f = lambda x: "    -" if x is None else f"{x:9.3f}"  # noqa: E731
            print(f"{m:22s} {g:9s} {st['n_hidden']:7d} {f(st['coverage'])} {f(st['accuracy'])} {f(st['reconstruction'])}")
    print("\nHide-20 by rule (all groups, summed over seeds)")
    for m, rules in res["hide20_by_rule_all_groups"].items():
        cells = ", ".join(f"{k}: n={v['n']} share={v['share']} acc={v['accuracy']}" for k, v in rules.items())
        print(f"  {m}: {cells}")
    print("\nHide-20, rules model, by events since the last visible digit")
    for b, v in res["hide20_by_distance_since_visible"]["rules"].items():
        print(f"  {b:>5s}: n={v['n']:6d} coverage={v['coverage']} accuracy={v['accuracy']}")
    print("\nConfusion (rules, hide-20; rows editor 1..5, cols inferred 1..5)")
    for row in res["hide20_confusion_rules"]["counts"]:
        print("  " + " ".join(f"{x:6d}" for x in row))
    print("\nWorst contexts by accuracy (rules, all groups, >= 100 inferred)")
    for r in res["hide20_worst_contexts_rules_by_accuracy"]:
        print(f"  {r['context']}={r['value']}: n={r['n']} coverage={r['coverage']} accuracy={r['accuracy']}")
    print("\nWorst contexts by coverage (rules, all groups, n >= 100)")
    for r in res["hide20_worst_contexts_rules_by_coverage"]:
        print(f"  {r['context']}={r['value']}: n={r['n']} coverage={r['coverage']} accuracy={r['accuracy']}")
    print(f"\nruntime: {res['runtime_sec']}")


if __name__ == "__main__":
    raise SystemExit(main())
