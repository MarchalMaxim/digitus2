"""Score the blinded listening reviews of issue #38, per condition (plain, light, playful).

    research/.venv/Scripts/python.exe -I research/embellish/score.py

Reads ``listening/teacher/results/judgements.json`` (written by ``collect.py``) and writes
``summary.json`` and ``summary.md`` beside it:

- mean scores per criterion and the verdict distribution;
- objections per 100 notes (both hands) by kind and by severity, and per item;
- each objection's class: it names inserted notes only, inserted and original notes (mixed),
  original right-hand notes and no inserted one, or left-hand notes only. A hit names at least
  one inserted note; a false positive names original right-hand notes and no inserted note;
- per right-hand note: the share of inserted notes and of original notes that some objection names;
- per rule: inserted notes in the passages, and how many an objection names;
- per piece: the total score (0 to 9) per condition and which condition scored highest;
- paired per piece: plain against light, plain against playful and light against playful, with
  an exact two-sided sign test (ties dropped).

The functions are pure over the judgement list, so the tests feed synthetic data. License: MIT.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from math import comb
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
if str(RESEARCH) not in sys.path:
    sys.path.insert(0, str(RESEARCH))
from embellish.collect import CONDITIONS, CRITERIA, KINDS, RESULTS, SEVERITIES, VERDICTS  # noqa: E402

CLASSES = ("inserted_only", "mixed", "original_only", "left_only")
SERIOUS = {"warning", "error"}
PAIRS = (("plain", "light"), ("plain", "playful"), ("light", "playful"))


def classify(notes: list[str], inserted: set[str]) -> str:
    right = {n for n in notes if n.startswith("R")}
    ins = right & inserted
    if not right:
        return "left_only"
    if ins and ins == right:
        return "inserted_only"
    return "mixed" if ins else "original_only"


def sign_test(wins: int, losses: int) -> float:
    """Exact two-sided binomial sign test at p = 1/2 (ties already dropped)."""
    n = wins + losses
    if n == 0:
        return 1.0
    k = min(wins, losses)
    return min(1.0, 2 * sum(comb(n, i) for i in range(k + 1)) / 2 ** n)


def total(item: dict) -> int | None:
    vals = [item["scores"].get(c) for c in CRITERIA]
    return None if any(v is None for v in vals) else sum(vals)


def _mean(xs: list) -> float | None:
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _named(item: dict, serious: bool = False) -> set[str]:
    return {n for ob in item["objections"] if not serious or ob["severity"] in SERIOUS for n in ob["notes"]
            if n.startswith("R")}


def _note_rates(items: list[dict], serious: bool) -> dict:
    c = Counter()
    for it in items:
        ins = set(it["inserted_ids"])
        named = _named(it, serious)
        c["inserted"] += len(ins)
        c["inserted_named"] += len(named & ins)
        c["original"] += it["notes_R"] - len(ins)
        c["original_named"] += len(named - ins)
    out = {k: c[k] for k in ("inserted", "inserted_named", "original", "original_named")}
    out["inserted_share"] = out["inserted_named"] / out["inserted"] if out["inserted"] else None
    out["original_share"] = out["original_named"] / out["original"] if out["original"] else None
    return out


def condition_summary(items: list[dict]) -> dict:
    n_notes = sum(it["notes_R"] + it["notes_L"] for it in items)
    obs = [(ob, set(it["inserted_ids"])) for it in items for ob in it["objections"]]
    verdicts = Counter(it["verdict"] for it in items)
    classes = Counter(classify(ob["notes"], ins) for ob, ins in obs)
    serious = Counter(classify(ob["notes"], ins) for ob, ins in obs if ob["severity"] in SERIOUS)
    per100 = (lambda k: 100 * k / n_notes) if n_notes else (lambda k: None)
    kinds = Counter(ob["kind"] for ob, _ in obs)
    sevs = Counter(ob["severity"] for ob, _ in obs)
    means = {c: _mean([it["scores"].get(c) for it in items]) for c in CRITERIA}
    means["total"] = _mean([total(it) for it in items])
    return {
        "n": len(items), "means": means,
        "verdicts": {v: verdicts.get(v, 0) for v in VERDICTS},
        "natural_or_acceptable": verdicts.get("natural", 0) + verdicts.get("acceptable", 0),
        "objections": len(obs), "per_item": len(obs) / len(items) if items else None,
        "notes_total": n_notes,
        "per_100_notes": {"total": per100(len(obs)), "kind": {k: per100(kinds.get(k, 0)) for k in KINDS},
                          "severity": {s: per100(sevs.get(s, 0)) for s in SEVERITIES}},
        "kind_counts": {k: kinds.get(k, 0) for k in KINDS},
        "severity_counts": {s: sevs.get(s, 0) for s in SEVERITIES},
        "classes": {c: classes.get(c, 0) for c in CLASSES},
        "classes_warning": {c: serious.get(c, 0) for c in CLASSES},
        "hits": classes["inserted_only"] + classes["mixed"], "false_positives": classes["original_only"],
        "hits_warning": serious["inserted_only"] + serious["mixed"], "false_positives_warning": serious["original_only"],
        "notes": _note_rates(items, False), "notes_warning": _note_rates(items, True),
    }


def rule_summary(items: list[dict]) -> dict:
    out: dict[str, dict] = {"all": {}, "light": {}, "playful": {}}
    for it in items:
        if it["condition"] == "plain":
            continue
        named, serious = _named(it), _named(it, True)
        for nid, rule in it["inserted_rules"].items():
            for scope in ("all", it["condition"]):
                r = out[scope].setdefault(rule, {"inserted": 0, "named": 0, "named_warning": 0})
                r["inserted"] += 1
                r["named"] += nid in named
                r["named_warning"] += nid in serious
    return out


def piece_summary(items: list[dict]) -> list[dict]:
    by: dict[str, dict] = {}
    for it in items:
        row = by.setdefault(it["slug"], {"n": it["n"], "slug": it["slug"], "title": it["title"], "totals": {},
                                         "verdicts": {}})
        row["totals"][it["condition"]] = total(it)
        row["verdicts"][it["condition"]] = it["verdict"]
    rows = sorted(by.values(), key=lambda r: r["n"])
    for r in rows:
        vals = {c: v for c, v in r["totals"].items() if v is not None}
        top = max(vals.values()) if vals else None
        r["best"] = [c for c in CONDITIONS if c in vals and vals[c] == top]
    return rows


def paired(pieces: list[dict], a: str, b: str) -> dict:
    diffs = [r["totals"][a] - r["totals"][b] for r in pieces
             if r["totals"].get(a) is not None and r["totals"].get(b) is not None]
    wins, losses = sum(d > 0 for d in diffs), sum(d < 0 for d in diffs)
    return {"pieces": len(diffs), "wins": wins, "ties": len(diffs) - wins - losses, "losses": losses,
            "mean_diff": _mean(diffs), "p": sign_test(wins, losses)}


def summarise(items: list[dict]) -> dict:
    pieces = piece_summary(items)
    best = Counter(c for r in pieces for c in r["best"])
    sole = Counter(r["best"][0] for r in pieces if len(r["best"]) == 1)
    return {
        "n_items": len(items),
        "conditions": {c: condition_summary([it for it in items if it["condition"] == c]) for c in CONDITIONS},
        "rules": rule_summary(items),
        "pieces": pieces,
        "best_counts": {c: {"highest_or_tied": best.get(c, 0), "sole_highest": sole.get(c, 0)} for c in CONDITIONS},
        "paired": {f"{a} vs {b}": paired(pieces, a, b) for a, b in PAIRS},
    }


# ---- markdown ------------------------------------------------------------------------------------

def _f(x, nd=2) -> str:
    return "-" if x is None else f"{x:.{nd}f}"


def _pct(k: int, n: int) -> str:
    return "-" if not n else f"{k} of {n} ({100 * k / n:.0f}%)"


def _table(head: list[str], rows: list[list], align: str | None = None) -> list[str]:
    align = align or "l" + "r" * (len(head) - 1)
    sep = ["---:" if a == "r" else "---" for a in align]
    return ["| " + " | ".join(head) + " |", "| " + " | ".join(sep) + " |"] + \
           ["| " + " | ".join(str(x) for x in r) + " |" for r in rows]


def to_markdown(s: dict) -> str:
    C = s["conditions"]
    out = ["# Listening test (issue #38): blinded reviews scored", "",
           f"{s['n_items']} passages; scores 0 to 3, total 0 to 9. Written by `research/embellish/score.py`.", ""]
    out += ["## Mean scores", ""]
    out += _table(["Condition", "Passages", "musical", "fits_harmony", "beginner_friendly", "Total (0-9)"],
                  [[c, C[c]["n"]] + [_f(C[c]["means"][k]) for k in CRITERIA] + [_f(C[c]["means"]["total"])]
                   for c in CONDITIONS])
    out += ["", "## Verdicts", ""]
    out += _table(["Condition"] + list(VERDICTS) + ["natural or acceptable"],
                  [[c] + [C[c]["verdicts"][v] for v in VERDICTS] + [_pct(C[c]["natural_or_acceptable"], C[c]["n"])]
                   for c in CONDITIONS])
    out += ["", "## Objections per 100 notes", "",
            "Notes count both hands. Per item is the plain count of objections per passage.", ""]
    out += _table(["Condition", "Notes", "Objections", "Per item", "Per 100 notes"] + list(SEVERITIES),
                  [[c, C[c]["notes_total"], C[c]["objections"], _f(C[c]["per_item"]), _f(C[c]["per_100_notes"]["total"])]
                   + [_f(C[c]["per_100_notes"]["severity"][v]) for v in SEVERITIES] for c in CONDITIONS])
    out += [""]
    out += _table(["Condition"] + list(KINDS),
                  [[c] + [_f(C[c]["per_100_notes"]["kind"][k]) for k in KINDS] for c in CONDITIONS])
    out += ["", "## Hits and false positives", "",
            "A hit names at least one inserted note (inserted only, or mixed with original notes). A false "
            "positive names original right-hand notes and no inserted note. Left-hand-only objections are "
            "neither. In the plain passages nothing is inserted, so every right-hand objection there is a "
            "false positive by construction.", ""]
    out += _table(["Condition", "Objections", "Inserted only", "Mixed", "Original only", "Left hand only",
                   "Hits", "False positives", "Hits, warning or error", "False positives, warning or error"],
                  [[c, C[c]["objections"]] + [C[c]["classes"][k] for k in CLASSES]
                   + [C[c]["hits"], C[c]["false_positives"], C[c]["hits_warning"], C[c]["false_positives_warning"]]
                   for c in CONDITIONS])
    out += ["", "## Per note (right hand)", "",
            "The share of right-hand notes that at least one objection names.", ""]
    rows = []
    for c in CONDITIONS:
        n, w = C[c]["notes"], C[c]["notes_warning"]
        rows.append([c, _pct(n["inserted_named"], n["inserted"]), _pct(n["original_named"], n["original"]),
                     _pct(w["inserted_named"], w["inserted"]), _pct(w["original_named"], w["original"])])
    out += _table(["Condition", "Inserted named", "Original named", "Inserted named, warning or error",
                   "Original named, warning or error"], rows)
    out += ["", "## Rules", "",
            "Inserted notes per rule in the passages, and how many an objection names.", ""]
    rows = []
    for scope in ("light", "playful", "all"):
        for rule, r in sorted(s["rules"][scope].items(), key=lambda kv: -kv[1]["inserted"]):
            rows.append([rule, scope, r["inserted"], _pct(r["named"], r["inserted"]),
                         _pct(r["named_warning"], r["inserted"])])
    out += _table(["Rule", "Condition", "Inserted notes", "Named", "Named, warning or error"], rows, "llrrr")
    out += ["", "## Per piece", "", "Total score (0 to 9) per condition; each condition is a different reviewer.", ""]
    rows = [[r["n"], r["title"]] + [r["totals"].get(c, "-") for c in CONDITIONS] + [", ".join(r["best"])]
            for r in s["pieces"]]
    out += _table(["#", "Piece", "plain", "light", "playful", "Highest"], rows, "rlrrrl")
    out += [""]
    out += _table(["Condition", "Highest or tied", "Sole highest"],
                  [[c, s["best_counts"][c]["highest_or_tied"], s["best_counts"][c]["sole_highest"]] for c in CONDITIONS])
    out += ["", "## Paired comparison per piece", "",
            "First higher, tie and second higher count pieces by total score. The sign test is exact and "
            "two-sided, with ties dropped.", ""]
    out += _table(["Comparison", "Pieces", "First higher", "Tie", "Second higher", "Mean difference", "Sign test p"],
                  [[k, v["pieces"], v["wins"], v["ties"], v["losses"], _f(v["mean_diff"]), _f(v["p"], 3)]
                   for k, v in s["paired"].items()])
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    getattr(sys.stdout, "reconfigure", lambda **_: None)(encoding="utf-8")
    import argparse
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", type=Path, default=RESULTS)
    a = ap.parse_args(argv)
    data = json.loads((a.results / "judgements.json").read_text(encoding="utf-8"))
    s = summarise(data["items"])
    (a.results / "summary.json").write_text(json.dumps(s, indent=1, ensure_ascii=False) + "\n", encoding="utf-8",
                                            newline="\n")
    md = to_markdown(s)
    (a.results / "summary.md").write_text(md, encoding="utf-8", newline="\n")
    print(md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
