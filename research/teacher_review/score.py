"""Score the pilot: fault detection, false positives, ranking, expert-disagreement agreement,
self-consistency across runs, cost. Pure functions over the key and judgement dicts (so the
tests can feed synthetic data) plus a CLI that writes ``results/summary.json`` and
``results/summary.md``.

    research/.venv/Scripts/python.exe -I -m teacher_review.score --runs A B
"""
from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

from .collect import CRITERIA
from .inject import ACCEPTED_KINDS, KINDS as FAULT_KINDS

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
CONDITIONS = ["expert", "fhmm3", "corrupted"]


def _idx(nid: str) -> int:
    return int(nid[1:])


def overall(j: dict) -> float | None:
    vals = [j["scores"].get(c) for c in CRITERIA]
    if any(v is None for v in vals):
        return None
    return float(sum(vals))


def objection_notes(j: dict, severities: set[str] | None = None) -> set[str]:
    out = set()
    for ob in j["objections"]:
        if severities and ob["severity"] not in severities:
            continue
        out.update(ob["notes"])
    return out


def _near(nid: str, targets: list[str], tol: int = 1) -> bool:
    return any(nid[0] == t[0] and abs(_idx(nid) - _idx(t)) <= tol for t in targets)


# ---------------------------------------------------------------------------------------
# 1. fault detection and false positives
# ---------------------------------------------------------------------------------------

def fault_detection(key_items: dict, judgements: dict, tol: int = 1) -> dict:
    """Per fault kind: planted, detected by position (an objection names a note within ``tol``
    of a fault note), detected with a matching kind, detected with severity error."""
    per = {k: Counter() for k in FAULT_KINDS}
    rows = []
    for iid, j in judgements.items():
        ki = key_items[iid]
        if ki["condition"] != "corrupted":
            continue
        for f in ki["faults"]:
            hits = [ob for ob in j["objections"] if any(_near(n, f["notes"], tol) for n in ob["notes"])]
            kind_ok = any(ob["kind"] in ACCEPTED_KINDS[f["kind"]] for ob in hits)
            err = any(ob["severity"] == "error" for ob in hits)
            fix_ok = any(all(ob["fix"].get(n) == f["before"][n] for n in f["notes"] if n in ob["fix"]) and ob["fix"]
                         for ob in hits)
            c = per[f["kind"]]
            c["planted"] += 1
            c["detected_pos"] += bool(hits)
            c["detected_kind"] += kind_ok
            c["detected_error"] += err
            c["fix_restores_expert"] += fix_ok
            rows.append({"item": iid, "passage": ki["passage"], "kind": f["kind"], "notes": f["notes"],
                         "detected": bool(hits), "kind_ok": kind_ok, "error": err,
                         "hit_kinds": sorted({ob["kind"] for ob in hits})})
    total = Counter()
    for c in per.values():
        total.update(c)
    out = {"per_kind": {k: dict(v) for k, v in per.items()}, "total": dict(total), "rows": rows}
    for k, c in list(out["per_kind"].items()) + [("total", out["total"])]:
        n = c.get("planted", 0)
        c["sensitivity_pos"] = c.get("detected_pos", 0) / n if n else None
        c["sensitivity_kind"] = c.get("detected_kind", 0) / n if n else None
    return out


def false_positives(key_items: dict, judgements: dict, tol: int = 1) -> dict:
    """Objections on expert passages (false positives against the expert), on FHMM3 passages,
    and spurious objections on corrupted passages (not within ``tol`` of any planted fault)."""
    out = {}
    for cond in CONDITIONS:
        n_items = n_notes = 0
        objs = Counter()
        by_kind = Counter()
        items_with_error = 0
        items_with_any = 0
        for iid, j in judgements.items():
            ki = key_items[iid]
            if ki["condition"] != cond:
                continue
            n_items += 1
            n_notes += sum(ki["n_notes"][h] for h in ki["hands"])
            planted = [n for f in ki["faults"] for n in f["notes"]]
            cnt = 0
            err = False
            for ob in j["objections"]:
                if cond == "corrupted" and any(_near(n, planted, tol) for n in ob["notes"]):
                    continue
                cnt += 1
                objs[ob["severity"]] += 1
                by_kind[ob["kind"]] += 1
                err = err or ob["severity"] == "error"
            items_with_any += cnt > 0
            items_with_error += err
        tot = sum(objs.values())
        out[cond] = {"items": n_items, "notes": n_notes, "objections": tot, "by_severity": dict(objs),
                     "by_kind": dict(by_kind), "per_item": tot / n_items if n_items else None,
                     "per_100_notes": 100 * tot / n_notes if n_notes else None,
                     "share_items_with_error": items_with_error / n_items if n_items else None,
                     "share_items_with_any": items_with_any / n_items if n_items else None}
    return out


def per_kind_fp(key_items: dict, judgements: dict) -> dict:
    """For each fault kind: objections on expert passages whose kind would have counted as a
    detection of that fault kind, per 100 reviewed notes (the kind-specific false-positive rate)."""
    notes = 0
    cnt = Counter()
    for iid, j in judgements.items():
        ki = key_items[iid]
        if ki["condition"] != "expert":
            continue
        notes += sum(ki["n_notes"][h] for h in ki["hands"])
        for ob in j["objections"]:
            for k, acc in ACCEPTED_KINDS.items():
                if ob["kind"] in acc:
                    cnt[k] += 1
    return {k: {"objections": cnt[k], "per_100_notes": 100 * cnt[k] / notes if notes else None} for k in FAULT_KINDS}


# ---------------------------------------------------------------------------------------
# 2. ranking
# ---------------------------------------------------------------------------------------

def ranking(key_items: dict, judgements: dict) -> dict:
    by_passage: dict[str, dict[str, dict]] = defaultdict(dict)
    for iid, j in judgements.items():
        by_passage[key_items[iid]["passage"]][key_items[iid]["condition"]] = j
    pairs = Counter()
    n = 0
    mean_scores = {c: defaultdict(list) for c in CONDITIONS}
    verdicts = {c: Counter() for c in CONDITIONS}
    for pid, conds in by_passage.items():
        for c, j in conds.items():
            for crit in CRITERIA:
                if j["scores"].get(crit) is not None:
                    mean_scores[c][crit].append(j["scores"][crit])
            o = overall(j)
            if o is not None:
                mean_scores[c]["overall"].append(o)
            if j["verdict"]:
                verdicts[c][j["verdict"]] += 1
        if any(c not in conds for c in CONDITIONS):
            continue
        e, h, k = (overall(conds[c]) for c in CONDITIONS)
        if any(x is None for x in (e, h, k)):
            continue
        n += 1
        pairs["expert>corrupted"] += e > k
        pairs["expert>=corrupted"] += e >= k
        pairs["fhmm3>corrupted"] += h > k
        pairs["fhmm3>=corrupted"] += h >= k
        pairs["expert>fhmm3"] += e > h
        pairs["expert>=fhmm3"] += e >= h
        pairs["expert>=fhmm3>corrupted"] += (e >= h > k)
        pairs["expert>fhmm3>corrupted"] += (e > h > k)
        ve, vh, vk = (conds[c]["verdict_rank"] for c in CONDITIONS)
        if None not in (ve, vh, vk):
            pairs["verdict expert>corrupted"] += ve > vk
            pairs["verdict fhmm3>corrupted"] += vh > vk
            pairs["verdict expert>=fhmm3"] += ve >= vh
    return {"passages": n, "pairs": {k: {"count": v, "share": v / n if n else None} for k, v in sorted(pairs.items())},
            "mean_scores": {c: {crit: (sum(v) / len(v) if v else None) for crit, v in m.items()}
                            for c, m in mean_scores.items()},
            "verdicts": {c: dict(v) for c, v in verdicts.items()}}


# ---------------------------------------------------------------------------------------
# 3. agreement with expert disagreement
# ---------------------------------------------------------------------------------------

def disagreement(key_items: dict, judgements: dict) -> dict:
    """On expert passages: objection rate on notes where all other annotators agree with the
    reviewed annotator versus notes where at least one differs; and whether a proposed fix equals
    another annotator's finger."""
    agreed = Counter()
    disputed = Counter()
    fixes = Counter()
    for iid, j in judgements.items():
        ki = key_items[iid]
        if ki["condition"] != "expert":
            continue
        flagged = objection_notes(j)
        fix_map = {}
        for ob in j["objections"]:
            fix_map.update(ob["fix"])
        for nid, a in ki["alt"].items():
            if not a["others"]:
                continue
            bucket = agreed if all(o == a["expert"] for o in a["others"]) else disputed
            bucket["notes"] += 1
            bucket["flagged"] += nid in flagged
            if nid in fix_map:
                fixes["fixes"] += 1
                fixes["fix_matches_other_expert"] += fix_map[nid] in a["others"]
                fixes["fix_on_disputed_note"] += bucket is disputed
    return {"agreed": {"notes": agreed["notes"], "flagged": agreed["flagged"],
                       "rate": agreed["flagged"] / agreed["notes"] if agreed["notes"] else None},
            "disputed": {"notes": disputed["notes"], "flagged": disputed["flagged"],
                         "rate": disputed["flagged"] / disputed["notes"] if disputed["notes"] else None},
            "fixes": dict(fixes),
            "fix_matches_other_expert_share": (fixes["fix_matches_other_expert"] / fixes["fixes"]) if fixes["fixes"] else None}


# ---------------------------------------------------------------------------------------
# 4. self-consistency between two runs
# ---------------------------------------------------------------------------------------

def _pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx == 0 or sy == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def _rank(xs: list[float]) -> list[float]:
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(order):
        k = i
        while k + 1 < len(order) and xs[order[k + 1]] == xs[order[i]]:
            k += 1
        r = (i + k) / 2 + 1
        for m in range(i, k + 1):
            ranks[order[m]] = r
        i = k + 1
    return ranks


def spearman(xs: list[float], ys: list[float]) -> float | None:
    return _pearson(_rank(xs), _rank(ys))


def consistency(keyA: dict, jA: dict, keyB: dict, jB: dict) -> dict:
    """Match items across runs by (passage, condition)."""
    def index(key, js):
        return {(key[i]["passage"], key[i]["condition"]): js[i] for i in js}
    a, b = index(keyA, jA), index(keyB, jB)
    common = sorted(set(a) & set(b))
    xs, ys, diffs = [], [], []
    verdict_same = verdict_n = 0
    jacc = []
    fault_both = fault_one = fault_none = 0
    for k in common:
        oa, ob = overall(a[k]), overall(b[k])
        if oa is not None and ob is not None:
            xs.append(oa)
            ys.append(ob)
            diffs.append(abs(oa - ob))
        if a[k]["verdict"] and b[k]["verdict"]:
            verdict_n += 1
            verdict_same += a[k]["verdict"] == b[k]["verdict"]
        na, nb = objection_notes(a[k]), objection_notes(b[k])
        if na or nb:
            jacc.append(len(na & nb) / len(na | nb))
    # fault-level agreement
    fa = {(r["passage"], tuple(r["notes"])): r["detected"] for r in fault_detection(keyA, jA)["rows"]}
    fb = {(r["passage"], tuple(r["notes"])): r["detected"] for r in fault_detection(keyB, jB)["rows"]}
    for k in set(fa) & set(fb):
        s = fa[k] + fb[k]
        fault_both += s == 2
        fault_one += s == 1
        fault_none += s == 0
    return {"items": len(common), "overall_pearson": _pearson(xs, ys), "overall_spearman": spearman(xs, ys),
            "mean_abs_diff_overall": sum(diffs) / len(diffs) if diffs else None,
            "share_abs_diff_le_2": sum(d <= 2 for d in diffs) / len(diffs) if diffs else None,
            "verdict_agreement": verdict_same / verdict_n if verdict_n else None,
            "objection_note_jaccard_mean": sum(jacc) / len(jacc) if jacc else None,
            "faults": {"both_runs_detect": fault_both, "one_run_detects": fault_one, "neither": fault_none}}


# ---------------------------------------------------------------------------------------
# 5. read-back and cost
# ---------------------------------------------------------------------------------------

def readback(judgements: dict) -> dict:
    hands = exact = digits = errors = 0
    for j in judgements.values():
        for h, r in j["readback"].items():
            hands += 1
            exact += r["exact"]
            digits += r["n"]
            errors += r["errors"]
    return {"hands": hands, "exact": exact, "exact_share": exact / hands if hands else None,
            "digits": digits, "digit_errors": errors, "digit_error_rate": errors / digits if digits else None}


def cost(report: dict) -> dict:
    walls = [b["wall_s"] for b in report["batches"].values() if b.get("wall_s")]
    chars_in = sum(b["chars_in"] for b in report["batches"].values())
    chars_out = sum(b["chars_out"] for b in report["batches"].values())
    n_items = sum(b["n_items"] for b in report["batches"].values())
    n_batches = len(report["batches"])
    return {"batches": n_batches, "items": n_items, "wall_s_per_batch_median": (sorted(walls)[len(walls) // 2] if walls else None),
            "wall_s_per_item_mean": (sum(walls) / n_items if walls and n_items else None),
            "chars_in_per_item": chars_in / n_items if n_items else None,
            "chars_out_per_item": chars_out / n_items if n_items else None,
            "est_tokens_in_per_item": chars_in / 4 / n_items if n_items else None,
            "est_tokens_out_per_item": chars_out / 4 / n_items if n_items else None,
            "note": "tokens are estimated as characters / 4 of the batch file and the JSON output; "
                    "reasoning tokens inside the reviewer are not observable from here"}


# ---------------------------------------------------------------------------------------
# 6. qualitative sample
# ---------------------------------------------------------------------------------------

def qualitative(key_items: dict, judgements: dict, run: str) -> dict:
    hits, misses_on_expert, spurious, on_fhmm3 = [], [], [], []
    for iid, j in judgements.items():
        ki = key_items[iid]
        planted = [n for f in ki["faults"] for n in f["notes"]]
        for ob in j["objections"]:
            rec = {"run": run, "item": iid, "passage": ki["passage"], "piece": ki["piece"], "bars": ki["bars"],
                   "condition": ki["condition"], "notes": ob["notes"], "kind": ob["kind"], "severity": ob["severity"],
                   "problem": ob["problem"], "fix": ob["fix"]}
            if ki["condition"] == "corrupted" and any(_near(n, planted) for n in ob["notes"]):
                rec["planted"] = [f["kind"] for f in ki["faults"] if any(_near(n, f["notes"]) for n in ob["notes"])]
                hits.append(rec)
            elif ki["condition"] == "expert":
                a = ki["alt"]
                rec["other_experts"] = {n: a[n]["others"] for n in ob["notes"] if n in a}
                rec["expert_finger"] = {n: a[n]["expert"] for n in ob["notes"] if n in a}
                misses_on_expert.append(rec)
            elif ki["condition"] == "corrupted":
                spurious.append(rec)
            else:
                a = ki["alt"]
                rec["expert_fingers"] = {n: [a[n]["expert"]] + a[n]["others"] for n in ob["notes"] if n in a}
                on_fhmm3.append(rec)
    return {"hits": hits, "objections_on_expert": misses_on_expert, "spurious_on_corrupted": spurious,
            "objections_on_fhmm3": on_fhmm3}


# ---------------------------------------------------------------------------------------
# 7. weekly-run measurements (M7-A): rates per set, recall control, hard errors, seeds
# ---------------------------------------------------------------------------------------

def match_objections(obs_a: list[dict], obs_b: list[dict], tol: int = 1) -> list[tuple[int, int]]:
    """One-to-one matches between two reviewers' objections on one passage: same kind and a note of one
    within ``tol`` of a note of the other in the same hand. Greedy in the order of ``obs_a``; each takes
    the first unmatched objection of ``obs_b`` that matches."""
    used: set[int] = set()
    out = []
    for i, oa in enumerate(obs_a):
        for j, ob in enumerate(obs_b):
            if j in used or oa["kind"] != ob["kind"]:
                continue
            if any(_near(n, ob["notes"], tol) for n in oa["notes"]):
                used.add(j)
                out.append((i, j))
                break
    return out


def rates_by(key_items: dict, judgements: dict, field: str = "set", tol: int = 1) -> dict:
    """Objection rates per value of key_items[iid][field] (falling back to the condition). Objections
    within ``tol`` of a planted fault are left out, as in false_positives."""
    groups: dict[str, dict] = {}
    for iid, j in judgements.items():
        ki = key_items[iid]
        g = groups.setdefault(ki.get(field) or ki["condition"], {
            "items": 0, "notes": 0, "objections": 0, "by_severity": Counter(), "by_kind": Counter(),
            "items_with_error": 0, "overall": [], "verdicts": Counter()})
        g["items"] += 1
        g["notes"] += sum(ki["n_notes"][h] for h in ki["hands"])
        planted = [n for f in ki.get("faults", []) for n in f["notes"]]
        err = False
        for ob in j["objections"]:
            if ki["condition"] == "corrupted" and any(_near(n, planted, tol) for n in ob["notes"]):
                continue
            g["objections"] += 1
            g["by_severity"][ob["severity"]] += 1
            g["by_kind"][ob["kind"]] += 1
            err = err or ob["severity"] == "error"
        g["items_with_error"] += err
        o = overall(j)
        if o is not None:
            g["overall"].append(o)
        if j["verdict"]:
            g["verdicts"][j["verdict"]] += 1
    out = {}
    for name, g in sorted(groups.items()):
        n, notes = g["items"], g["notes"]
        out[name] = {"items": n, "notes": notes, "objections": g["objections"], "by_severity": dict(g["by_severity"]),
                     "by_kind": dict(g["by_kind"]), "per_item": g["objections"] / n if n else None,
                     "per_100_notes": 100 * g["objections"] / notes if notes else None,
                     "share_items_with_error": g["items_with_error"] / n if n else None,
                     "mean_overall": sum(g["overall"]) / len(g["overall"]) if g["overall"] else None,
                     "verdicts": dict(g["verdicts"])}
    return out


def _mean(xs: list) -> float | None:
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def recall_comparison(key_items: dict, judgements: dict, tol: int = 1) -> dict:
    """Each recall twin (set 'recall', 'twin_of' = its control) against its control: the share of notes
    fingered alike in both keys, objections, scores, verdicts, and matched objections (Dice)."""
    by_passage: dict[str, list] = {}
    for iid, j in judgements.items():
        by_passage.setdefault(key_items[iid]["passage"], []).append((key_items[iid], j))
    pairs = []
    for pid in sorted(by_passage):
        for ki, j in by_passage[pid]:
            if ki.get("set") != "recall" or not by_passage.get(ki.get("twin_of")):
                continue
            ko, jo = by_passage[ki["twin_of"]][0]
            notes = sum(ki["n_notes"][h] for h in ki["hands"])
            fo = " ".join(ko["fingers"][h] for h in ko["hands"]).split()
            ft = " ".join(ki["fingers"][h] for h in ki["hands"]).split()
            matched = match_objections(jo["objections"], j["objections"], tol)
            no, nt = len(jo["objections"]), len(j["objections"])
            pairs.append({"control": ki["twin_of"], "recall": pid, "notes": notes,
                          "finger_agreement": sum(a == b for a, b in zip(fo, ft)) / len(fo) if fo else None,
                          "objections": [no, nt],
                          "per_100_notes": [100 * no / notes, 100 * nt / notes] if notes else [None, None],
                          "overall": [overall(jo), overall(j)], "verdict": [jo["verdict"], j["verdict"]],
                          "matched": len(matched), "dice": 2 * len(matched) / (no + nt) if no + nt else None})
    return {"pairs": pairs, "n": len(pairs),
            "mean_overall_diff": _mean([p["overall"][1] - p["overall"][0] for p in pairs if None not in p["overall"]]),
            "mean_per_100_diff": _mean([p["per_100_notes"][1] - p["per_100_notes"][0] for p in pairs
                                        if None not in p["per_100_notes"]]),
            "verdict_agreement": _mean([float(p["verdict"][0] == p["verdict"][1]) for p in pairs if None not in p["verdict"]]),
            "mean_dice": _mean([p["dice"] for p in pairs]),
            "mean_finger_agreement": _mean([p["finger_agreement"] for p in pairs])}


def hard_error_agreement(key_items: dict, judgements: dict, tol: int = 1) -> dict:
    """On hard-error passages ('hard': note id -> the annotators' unanimous finger): how often an objection
    lands within ``tol`` of a hard-error note, and how often a fix gives the annotators' finger."""
    items = hard_notes = hit = fix_on = fix_match = 0
    for iid, j in judgements.items():
        ki = key_items[iid]
        hard = ki.get("hard") or {}
        if ki.get("set") != "harderr" or not hard:
            continue
        items += 1
        named = [n for ob in j["objections"] for n in ob["notes"]]
        fixes: dict = {}
        for ob in j["objections"]:
            fixes.update(ob["fix"])
        for nid, finger in sorted(hard.items()):
            hard_notes += 1
            hit += any(_near(n, [nid], tol) for n in named)
            if nid in fixes:
                fix_on += 1
                fix_match += fixes[nid] == finger
    return {"items": items, "hard_notes": hard_notes, "hit": hit, "hit_share": hit / hard_notes if hard_notes else None,
            "fix_on_hard": fix_on, "fix_match": fix_match, "fix_match_share": fix_match / fix_on if fix_on else None}


def seed_hits(key_items: dict, judgements: dict, tol: int = 1) -> dict:
    """On low-confidence passages: reviews with an objection within ``tol`` of the seed note."""
    n = hit = 0
    for iid, j in judgements.items():
        ki = key_items[iid]
        seed = ki.get("seed_note")
        if ki.get("set") != "lowconf" or not seed:
            continue
        n += 1
        hit += any(_near(x, [seed], tol) for ob in j["objections"] for x in ob["notes"])
    return {"reviews": n, "hit": hit, "share": hit / n if n else None}


# ---------------------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------------------

def load_run(run: str) -> tuple[dict, dict, dict]:
    key = json.loads((RESULTS / run / "key.json").read_text(encoding="utf-8"))
    js = json.loads((RESULTS / run / "judgements.json").read_text(encoding="utf-8"))
    rep = json.loads((RESULTS / run / "collect_report.json").read_text(encoding="utf-8"))
    return key["items"], js, rep


def score_runs(runs: list[str]) -> dict:
    out = {"runs": {}, "pooled": {}}
    loaded = {r: load_run(r) for r in runs}
    pooled_key, pooled_j = {}, {}
    for r, (k, js, rep) in loaded.items():
        out["runs"][r] = {"fault_detection": fault_detection(k, js), "false_positives": false_positives(k, js),
                          "per_kind_fp": per_kind_fp(k, js), "ranking": ranking(k, js),
                          "disagreement": disagreement(k, js), "readback": readback(js), "cost": cost(rep),
                          "n_items": len(js)}
        for iid in js:
            pooled_key[f"{r}:{iid}"] = k[iid]
            pooled_j[f"{r}:{iid}"] = js[iid]
    out["pooled"] = {"fault_detection": fault_detection(pooled_key, pooled_j),
                     "false_positives": false_positives(pooled_key, pooled_j),
                     "per_kind_fp": per_kind_fp(pooled_key, pooled_j),
                     "disagreement": disagreement(pooled_key, pooled_j), "readback": readback(pooled_j)}
    for p in out["pooled"]["fault_detection"], :
        p.pop("rows", None)
    for r in out["runs"].values():
        r["fault_detection"].pop("rows", None)
    if len(runs) >= 2:
        (kA, jA, _), (kB, jB, _) = loaded[runs[0]], loaded[runs[1]]
        out["consistency"] = consistency(kA, jA, kB, jB)
    qual = {}
    for r, (k, js, rep) in loaded.items():
        qual[r] = qualitative(k, js, r)
    (RESULTS / "qualitative.json").write_text(json.dumps(qual, indent=1), encoding="utf-8", newline="\n")
    (RESULTS / "summary.json").write_text(json.dumps(out, indent=1), encoding="utf-8", newline="\n")
    (RESULTS / "summary.md").write_text(summary_markdown(out, runs), encoding="utf-8", newline="\n")
    return out


def _pct(x) -> str:
    return "n/a" if x is None else f"{100 * x:.0f}%"


def _num(x, d=2) -> str:
    return "n/a" if x is None else f"{x:.{d}f}"


def summary_markdown(out: dict, runs: list[str]) -> str:
    L = ["# Teacher-review pilot: measured results", ""]
    L += ["## Fault detection (sensitivity by position, within one note; kind = an objection of a matching kind)", ""]
    L += ["| kind | planted (per run) | " + " | ".join(f"run {r} pos / kind" for r in runs) + " | pooled pos / kind | FP per 100 expert notes (pooled) |",
          "|---|---|" + "---|" * len(runs) + "---|---|"]
    pk = out["pooled"]["fault_detection"]["per_kind"]
    fp = out["pooled"]["per_kind_fp"]
    for k in FAULT_KINDS:
        cells = [f"{_pct(out['runs'][r]['fault_detection']['per_kind'][k]['sensitivity_pos'])} / "
                 f"{_pct(out['runs'][r]['fault_detection']['per_kind'][k]['sensitivity_kind'])}" for r in runs]
        L.append(f"| {k} | {out['runs'][runs[0]]['fault_detection']['per_kind'][k].get('planted', 0)} | " + " | ".join(cells)
                 + f" | {_pct(pk[k]['sensitivity_pos'])} / {_pct(pk[k]['sensitivity_kind'])} | {_num(fp[k]['per_100_notes'])} |")
    t = out["pooled"]["fault_detection"]["total"]
    L.append(f"| **all** | {out['runs'][runs[0]]['fault_detection']['total'].get('planted', 0)} | "
             + " | ".join(f"{_pct(out['runs'][r]['fault_detection']['total']['sensitivity_pos'])} / {_pct(out['runs'][r]['fault_detection']['total']['sensitivity_kind'])}" for r in runs)
             + f" | {_pct(t['sensitivity_pos'])} / {_pct(t['sensitivity_kind'])} | |")
    L += ["", "## Objections by condition (false positives on expert passages; spurious = not within one note of a planted fault)", ""]
    L += ["| run | condition | items | notes | objections | per item | per 100 notes | errors | items with an error objection |", "|---|---|---|---|---|---|---|---|---|"]
    for r in runs + ["pooled"]:
        f = out["runs"][r]["false_positives"] if r in out["runs"] else out["pooled"]["false_positives"]
        for c in CONDITIONS:
            v = f[c]
            L.append(f"| {r} | {c} | {v['items']} | {v['notes']} | {v['objections']} | {_num(v['per_item'])} | {_num(v['per_100_notes'], 1)} | "
                     f"{v['by_severity'].get('error', 0)} | {_pct(v['share_items_with_error'])} |")
    L += ["", "## Ranking of conditions by overall score (sum of five criteria, 0-15)", ""]
    L += ["| comparison | " + " | ".join(f"run {r}" for r in runs) + " |", "|---|" + "---|" * len(runs)]
    keys = list(out["runs"][runs[0]]["ranking"]["pairs"])
    for k in keys:
        L.append(f"| {k} | " + " | ".join(f"{out['runs'][r]['ranking']['pairs'][k]['count']}/{out['runs'][r]['ranking']['passages']} ({_pct(out['runs'][r]['ranking']['pairs'][k]['share'])})" for r in runs) + " |")
    L += ["", "| mean score | " + " | ".join(f"{c} ({r})" for r in runs for c in CONDITIONS) + " |", "|---|" + "---|" * (3 * len(runs))]
    for crit in CRITERIA + ["overall"]:
        L.append(f"| {crit} | " + " | ".join(_num(out["runs"][r]["ranking"]["mean_scores"][c].get(crit)) for r in runs for c in CONDITIONS) + " |")
    L += ["", "| verdicts | " + " | ".join(f"{c} ({r})" for r in runs for c in CONDITIONS) + " |", "|---|" + "---|" * (3 * len(runs))]
    for vd in ["good", "acceptable", "flawed", "unplayable"]:
        L.append(f"| {vd} | " + " | ".join(str(out["runs"][r]["ranking"]["verdicts"][c].get(vd, 0)) for r in runs for c in CONDITIONS) + " |")
    L += ["", "## Expert passages: objections where the other annotators agree vs disagree with the reviewed annotator", ""]
    L += ["| run | agreed notes | flagged | rate | disputed notes | flagged | rate | fixes | fix = another expert's finger |", "|---|---|---|---|---|---|---|---|---|"]
    for r in runs + ["pooled"]:
        d = out["runs"][r]["disagreement"] if r in out["runs"] else out["pooled"]["disagreement"]
        L.append(f"| {r} | {d['agreed']['notes']} | {d['agreed']['flagged']} | {_pct(d['agreed']['rate'])} | {d['disputed']['notes']} | {d['disputed']['flagged']} | {_pct(d['disputed']['rate'])} | {d['fixes'].get('fixes', 0)} | {_pct(d['fix_matches_other_expert_share'])} |")
    if "consistency" in out:
        c = out["consistency"]
        L += ["", "## Self-consistency between runs", "", "| items | Pearson (overall) | Spearman | mean abs diff | share abs diff <= 2 | verdict agreement | objection-note Jaccard | faults: both / one / neither |", "|---|---|---|---|---|---|---|---|",
              f"| {c['items']} | {_num(c['overall_pearson'])} | {_num(c['overall_spearman'])} | {_num(c['mean_abs_diff_overall'])} | {_pct(c['share_abs_diff_le_2'])} | {_pct(c['verdict_agreement'])} | {_num(c['objection_note_jaccard_mean'])} | {c['faults']['both_runs_detect']} / {c['faults']['one_run_detects']} / {c['faults']['neither']} |"]
    L += ["", "## Read-back accuracy", "", "| run | hands | exact | digits | digit errors |", "|---|---|---|---|---|"]
    for r in runs + ["pooled"]:
        rb = out["runs"][r]["readback"] if r in out["runs"] else out["pooled"]["readback"]
        L.append(f"| {r} | {rb['hands']} | {_pct(rb['exact_share'])} | {rb['digits']} | {rb['digit_errors']} ({_pct(rb['digit_error_rate'])}) |")
    L += ["", "## Cost (per passage-condition item)", "", "| run | batches | items | wall s per batch (median) | wall s per item | chars in | chars out | est. tokens in | est. tokens out |", "|---|---|---|---|---|---|---|---|---|"]
    for r in runs:
        c = out["runs"][r]["cost"]
        L.append(f"| {r} | {c['batches']} | {c['items']} | {_num(c['wall_s_per_batch_median'], 0)} | {_num(c['wall_s_per_item_mean'], 0)} | {_num(c['chars_in_per_item'], 0)} | {_num(c['chars_out_per_item'], 0)} | {_num(c['est_tokens_in_per_item'], 0)} | {_num(c['est_tokens_out_per_item'], 0)} |")
    return "\n".join(L) + "\n"


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--runs", nargs="+", default=["A", "B"])
    args = ap.parse_args(argv)
    out = score_runs(args.runs)
    print((RESULTS / "summary.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
