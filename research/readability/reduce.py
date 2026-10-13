#!/usr/bin/env python
"""The minimal-sufficient reduction of verification spec section 3.6, applied to editorial digits.

    research/.venv-readability/Scripts/python.exe -X utf8 research/readability/reduce.py

Given a hand whose digits are known, a greedy forward pass keeps a digit only where the player
model (:mod:`readability.player_model`), reading with the digits kept so far, would infer a
different finger or none. Because the reader is deterministic and forward-only, every kept
digit is necessary given the earlier ones, and the kept set reconstructs 100 percent of the
known digits by construction.

Two uses:

* on the *fully fingered* parts (editorial density >= 90 percent: Clementi's lessons mostly) the
  kept density is what the spec's reduction would print for a real, complete fingering: an
  unbiased estimate, since almost every note carries a digit there;
* on every part, the ratio kept / printed says how much of what the editor printed a forward
  reader could have inferred ("editorial redundancy").

Writes ``results/reduction.json`` and ``results/reduction_by_part.csv``.
"""
from __future__ import annotations

import csv
import json
import statistics
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
if str(RESEARCH) not in sys.path:
    sys.path.insert(0, str(RESEARCH))

from readability import corpus  # noqa: E402
from readability.features import compute_features  # noqa: E402
from readability.player_model import HandReader  # noqa: E402
from readability.repeats import find_repeats, root_map  # noqa: E402
from readability.textbook import TextbookIndex  # noqa: E402

RESULTS = HERE / "results"
GROUPS = ("teaching", "concert", "other", "library")


def minimal_sufficient(reader: HandReader, model: str = "rules",
                       root: list[int] | None = None) -> tuple[set[int], dict[int, str]]:
    """Greedy forward reduction of one hand's printed digits.

    Returns the kept note indices and, for each kept note, the rule the reader applied when it
    went wrong without the digit (``none`` = not inferable, else the rule that gave the wrong
    finger).

    ``root`` (optional, from :func:`readability.repeats.root_map`) adds a *repeat memory* rule
    (R5) as a last resort: where the reader would be wrong or has nothing to say, and the event
    is a later occurrence of a repeated segment whose first statement the reader has already
    reconstructed (correctly, by construction), the reader remembers the finger it used there.
    The reader then continues from that finger as if it had been printed. Kept digits are only
    those the reader still gets wrong.
    """
    model = model.replace("_plus_repeats", "")
    kept: set[int] = set()
    known: set[int] = set()          # kept digits plus fingers recovered by the repeat memory
    why: dict[int, str] = {}
    start = 0
    for e, ev in enumerate(reader.evs):
        truth = {n.idx: n.finger for n in ev if n.finger > 0}
        if not truth:
            continue
        memory: dict[int, int] = {}
        if root is not None and root[e] != e:
            rev = reader.evs[root[e]]
            if len(rev) == len(ev):
                memory = {n.idx: r.finger for n, r in zip(ev, rev) if r.finger > 0}
        while True:
            res = reader.infer(known, model, start=start, stop=e + 1)
            wrong = [(i, res[i]) for i, f in truth.items() if i not in known and res[i][0] != f]
            if not wrong:
                break
            # add the lowest wrong note first (chord fill then reaches the others)
            i, (f, rule) = min(wrong, key=lambda w: w[0])
            known.add(i)
            if memory.get(i) == truth[i]:
                why[i] = "R5_recovered"      # remembered from the first statement, not printed
                continue
            kept.add(i)
            why[i] = rule if f is None else f"{rule}_wrong"
        if any(i in known for i in truth):
            start = e          # state after a visible event does not depend on earlier events
    return kept, why


def reduce_part(part: corpus.Part, model: str, tb: TextbookIndex | None) -> dict:
    out = {"id": part.id, "group": part.level_group, "composer": part.composer, "notes": len(part.notes),
           "printed": part.n_printed, "density": round(part.density, 4), "kept": 0, "kept_rh": 0, "kept_lh": 0,
           "why": Counter(), "kept_idx": set()}
    for hand in (corpus.RH, corpus.LH):
        notes = part.hand_notes(hand)
        if not notes:
            continue
        reader = HandReader(notes, tb if model.startswith("rules_plus_textbook") else None)
        root = root_map(len(reader.evs), find_repeats(reader.evs)) if model.endswith("_plus_repeats") else None
        kept, why = minimal_sufficient(reader, model, root)
        out["kept"] += len(kept)
        out["kept_rh" if hand == corpus.RH else "kept_lh"] += len(kept)
        out["why"].update(v for v in why.values() if v != "R5_recovered")
        out["recovered"] = out.get("recovered", 0) + sum(1 for v in why.values() if v == "R5_recovered")
        out["kept_idx"] |= kept
    out["kept_density"] = round(out["kept"] / out["notes"], 4) if out["notes"] else None
    out["kept_share_of_printed"] = round(out["kept"] / out["printed"], 4) if out["printed"] else None
    return out


def main(argv: list[str] | None = None) -> int:
    t0 = time.time()
    parts = corpus.load_all()
    tb = TextbookIndex.load()
    summary: dict = {"command": "research/.venv-readability/Scripts/python.exe -X utf8 research/readability/reduce.py",
                     "models": {}}
    rows = []
    for model in ("rules", "rules_plus_textbook", "rules_plus_repeats", "rules_plus_textbook_plus_repeats"):
        per_part = [reduce_part(p, model, tb) for p in parts]
        for r in per_part:
            rows.append({"model": model, **{k: v for k, v in r.items() if k not in ("why", "kept_idx")}})
        m: dict = {}
        for label, sel in (("all", lambda r: True), ("density_ge_90", lambda r: r["density"] >= 0.9),
                           ("density_ge_70", lambda r: r["density"] >= 0.7),
                           *[(g, (lambda g: lambda r: r["group"] == g)(g)) for g in GROUPS]):
            ps = [r for r in per_part if sel(r)]
            if not ps:
                continue
            notes = sum(r["notes"] for r in ps)
            printed = sum(r["printed"] for r in ps)
            kept = sum(r["kept"] for r in ps)
            why = Counter()
            for r in ps:
                why.update(r["why"])
            m[label] = {"parts": len(ps), "notes": notes, "printed": printed, "kept": kept,
                        "recovered_by_repeat_memory": sum(r.get("recovered", 0) for r in ps),
                        "editorial_density": round(printed / notes, 4),
                        "kept_density": round(kept / notes, 4),
                        "kept_share_of_printed": round(kept / printed, 4) if printed else None,
                        "part_kept_density_median": round(statistics.median(r["kept_density"] for r in ps), 4),
                        "part_kept_density_min": round(min(r["kept_density"] for r in ps), 4),
                        "part_kept_density_max": round(max(r["kept_density"] for r in ps), 4),
                        "why_kept": dict(why.most_common())}
        # context of the kept digits on the fully fingered parts (score-only features)
        ctx: dict = defaultdict(lambda: Counter())
        for p, r in zip(parts, per_part):
            if r["density"] < 0.9:
                continue
            feats = {f["idx"]: f for f in compute_features(p)}
            for n in p.notes:
                if n.finger == 0:
                    continue
                f = feats[n.idx]
                k = "kept" if n.idx in r["kept_idx"] else "dropped"
                for col in ("leap_bin", "chord_pos", "run_pos", "after_rest_beat", "first_of_hand", "hand", "black"):
                    ctx[col][(str(f[col]), k)] += 1
        m["kept_by_context_density_ge_90"] = {
            col: {v: {"kept": c[(v, "kept")], "dropped": c[(v, "dropped")],
                      "kept_rate": round(c[(v, "kept")] / (c[(v, "kept")] + c[(v, "dropped")]), 4)}
                  for v in sorted({v for v, _ in c})}
            for col, c in ctx.items()}
        summary["models"][model] = m
    summary["seconds"] = round(time.time() - t0, 1)
    RESULTS.mkdir(exist_ok=True)
    with open(RESULTS / "reduction.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1)
    with open(RESULTS / "reduction_by_part.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    for model, m in summary["models"].items():
        print(f"== {model}")
        for label in ("all", "density_ge_90", "density_ge_70", *GROUPS):
            if label in m:
                x = m[label]
                print(f"  {label:14s} parts={x['parts']:3d} notes={x['notes']:6d} printed={x['printed']:5d} kept={x['kept']:5d} "
                      f"editorial={100 * x['editorial_density']:.1f}% kept={100 * x['kept_density']:.1f}% "
                      f"(median part {100 * x['part_kept_density_median']:.1f}%, {100 * x['part_kept_density_min']:.1f}-{100 * x['part_kept_density_max']:.1f}) "
                      f"kept/printed={100 * x['kept_share_of_printed']:.1f}%")
    print(f"{summary['seconds']} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
