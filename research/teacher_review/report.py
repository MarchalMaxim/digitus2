"""The weekly teacher-review report: docs/reviews/teacher-<date>.md, results/weekly/<date>/summary.json and
the rows for docs/experiments.md. Library passages may be quoted; PIG passages appear only by opaque id and
counts (audit_no_pig). Never a gate and never a number to tune on (verification spec 3.12)."""
from __future__ import annotations

import json
import re
import statistics
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from .collect import CRITERIA, VERDICTS
from .hypotheses import SEVERITY_RANK, TESTED, experiments_rows, hypotheses, weekly_members
from .inject import KINDS as FAULT_KINDS
from .score import (consistency, cost, fault_detection, hard_error_agreement, rates_by, readback, recall_comparison,
                    seed_hits)

SET_ORDER = ["lowconf", "harderr", "control", "recall", "planted"]
SET_WHAT = {"lowconf": "around the engine's lowest-confidence library notes",
            "harderr": "around the hard errors of the PIG bench gallery",
            "control": "random level 1 to 3 library passages",
            "recall": "controls again, composer hidden, transposed by a tritone and re-fingered",
            "planted": "controls with two or three planted faults"}
SET_LABEL = {"lowconf": "low-confidence passage", "control": "control passage"}
INSTRUCTIVE_SETS = ("lowconf", "control")
PILOT_LABEL = "2026-10-13 (pilot)"
MIN_PROBLEM_CHARS = 24          # shorter PIG objection texts are generic enough to match template text by chance
_NOTE_LINE = re.compile(r"^[RL]\d")
_LABEL = re.compile(r"^([RL])(\d+)(?:-(\d+))?(?=\s|$)")


class PigLeak(RuntimeError):
    pass


@dataclass
class Day:
    date: str
    meta: dict
    key_items: dict
    judgements: dict
    collect_report: dict
    renders: dict
    dispatch_log: dict | None


def load_day(day: Path) -> Day:
    day = Path(day)
    key = json.loads((day / "key.json").read_text(encoding="utf-8"))
    log = day / "dispatch_log.json"
    return Day(date=key["date"], meta=key.get("meta", {}), key_items=key["items"],
               judgements=json.loads((day / "judgements.json").read_text(encoding="utf-8")),
               collect_report=json.loads((day / "collect_report.json").read_text(encoding="utf-8")),
               renders={p.stem: p.read_text(encoding="utf-8") for p in sorted((day / "items").glob("*.txt"))},
               dispatch_log=json.loads(log.read_text(encoding="utf-8")) if log.exists() else None)


# ---------------------------------------------------------------------------------------
# formats and tables
# ---------------------------------------------------------------------------------------

def _pct(x) -> str:
    return "n/a" if x is None else f"{100 * x:.0f}%"


def _num(x, d=2) -> str:
    return "n/a" if x is None else f"{x:.{d}f}"


def _share(c: int, n: int) -> str:
    return f"{c} ({100 * c / n:.0f}%)" if n else f"{c} (n/a)"


def _set(ki: dict) -> str:
    return ki.get("set") or ki["condition"]


def _source(ki: dict) -> str:
    return ki.get("source", "pig")          # the pilot's key items are all PIG and carry no source


def _note_key(n: str) -> tuple:
    return (n[0] != "R", int(n[1:]))


def _counts(c: Counter | dict) -> str:
    return ", ".join(f"{k} {v}" for k, v in sorted(dict(c).items(), key=lambda kv: (-kv[1], kv[0]))) or "none"


def _severities(c: Counter | dict) -> str:
    return ", ".join(f"{s} {dict(c).get(s, 0)}" for s in SEVERITY_RANK)


def _hands_text(hands) -> str:
    hs = set(hands)
    return "both hands" if hs == {"R", "L"} else "right hand" if hs == {"R"} else "left hand" if hs == {"L"} else "n/a"


def _bars_text(bars) -> str:
    if not bars:
        return "bars n/a"
    b1, b2 = bars
    return f"bar {b1}" if b1 == b2 else f"bars {b1}-{b2}"


def _set_order(names) -> list[str]:
    names = set(names)
    return [s for s in SET_ORDER if s in names] + sorted(s for s in names if s not in SET_ORDER)


def _split(day: Day):
    def side(r):
        ks = {i: k for i, k in day.key_items.items() if k.get("reviewer") == r and i in day.judgements}
        return ks, {i: day.judgements[i] for i in ks}
    return side("a"), side("b")


def planted_table(key_items: dict, judgements: dict) -> tuple[str, dict]:
    fd = fault_detection(key_items, judgements)
    lines = ["| kind | planted | by position | by kind | with severity error |", "|---|---|---|---|---|"]
    for k in FAULT_KINDS:
        c = fd["per_kind"][k]
        if c.get("planted"):
            lines.append(f"| {k} | {c['planted']} | {_share(c['detected_pos'], c['planted'])} | "
                         f"{_share(c['detected_kind'], c['planted'])} | {_share(c['detected_error'], c['planted'])} |")
    t = fd["total"]
    n = t.get("planted", 0)
    lines.append(f"| all | {n} | {_share(t.get('detected_pos', 0), n)} | {_share(t.get('detected_kind', 0), n)} | "
                 f"{_share(t.get('detected_error', 0), n)} |")
    fd.pop("rows", None)
    return "\n".join(lines), fd


def agreement_table(c: dict) -> str:
    return "\n".join(["| items | Pearson (overall) | Spearman | mean abs diff | verdict agreement | objection-note Jaccard |",
                      "|---|---|---|---|---|---|",
                      f"| {c['items']} | {_num(c['overall_pearson'])} | {_num(c['overall_spearman'])} | "
                      f"{_num(c['mean_abs_diff_overall'])} | {_pct(c['verdict_agreement'])} | "
                      f"{_num(c['objection_note_jaccard_mean'])} |"])


def rates_table(rates: dict) -> str:
    order = [s for s in SET_ORDER if s in rates] + sorted(s for s in rates if s not in SET_ORDER)
    lines = ["| set | items | notes | objections | per item | per 100 notes | error | warning | info | items with an error |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for s in order:
        r = rates[s]
        sev = r["by_severity"]
        lines.append(f"| {s} | {r['items']} | {r['notes']} | {r['objections']} | {_num(r['per_item'])} | "
                     f"{_num(r['per_100_notes'])} | {sev.get('error', 0)} | {sev.get('warning', 0)} | {sev.get('info', 0)} | "
                     f"{_pct(r['share_items_with_error'])} |")
    return "\n".join(lines)


def drift_row(label: str, d: dict) -> str:
    return (f"| {label} | {_pct(d.get('planted_pos'))} | {_pct(d.get('planted_kind'))} | "
            f"{_num(d.get('control_per_100'))} | {_pct(d.get('readback'))} | {_pct(d.get('verdict_agreement'))} |")


def pilot_drift(pilot: dict) -> dict:
    t = pilot["pooled"]["fault_detection"]["total"]
    return {"planted_pos": t["sensitivity_pos"], "planted_kind": t["sensitivity_kind"],
            "control_per_100": pilot["pooled"]["false_positives"]["expert"]["per_100_notes"],
            "readback": pilot["pooled"]["readback"]["exact_share"],
            "verdict_agreement": pilot["consistency"]["verdict_agreement"]}


# ---------------------------------------------------------------------------------------
# sections
# ---------------------------------------------------------------------------------------

def _header(day: Day) -> list[str]:
    meta = day.meta or {}
    bench = meta.get("bench") or {}
    sha = (bench.get("gitSha") or "")[:7] or "n/a"
    engine = (f"version {meta.get('engineVersion', 'n/a')}, commit {sha}, profile {meta.get('profile', 'n/a')}, "
              f"weight set {meta.get('weightSet', 'n/a')}, weights hash {meta.get('weightsHash', 'n/a')}")
    dump = meta.get("dump") or f"research/data/teacher_review/weekly/{day.date}/dump.json"
    if not bench:
        bench_text = "bench n/a"
    elif bench.get("label") is None:
        bench_text = "bench not run (an existing gallery was reused)"
    else:
        gen, her = bench.get("gen"), bench.get("hardErrorRate")
        bench_text = (f"bench {bench['label']} on the PIG validation pieces (research/data/splits/pig_validation.json; "
                      f"never the official test pieces): gen {_num(gen)}{'' if gen is None else '%'}, "
                      f"hard-error rate {_num(her)}{'' if her is None else '%'}")
    seed = meta.get("seed")
    rep = day.collect_report
    launches = len(rep.get("batches", {}))
    return [f"# Teacher review, {day.date}", "",
            f"- Date: {day.date}.",
            f"- Engine: {engine}.",
            f"- Inputs: engine dump {dump} (gitignored: the library, its tritone copies and the gallery's PIG pieces); "
            f"{bench_text}; seed {seed if seed is not None else 'n/a'}.",
            f"- Reviewers: {launches} launches, one fresh Opus subagent per batch file. Low-confidence and hard-error "
            "batches are read twice, under framing a and framing b, with the same passages, fresh item ids and an "
            "independent order; control batches (controls, planted and recall twins) once, framing a for odd and b "
            "for even batch numbers.",
            f"- Collection: {rep.get('n_items', len(day.judgements))} item reviews, {len(rep.get('missing_items', []))} "
            f"missing, {len(rep.get('problems', []))} validation problems.",
            "- Use: a qualitative oracle that proposes hypotheses for the quantitative loop; never a gate and never a "
            "number to tune on (verification spec 3.12, docs/research/teacher-review.md 6.2).", ""]


def _passage_stats(day: Day) -> dict:
    stats: dict[str, dict] = {}
    for iid in sorted(day.key_items):
        ki = day.key_items[iid]
        s = stats.setdefault(_set(ki), {"passages": set(), "reviews": 0, "notes": []})
        s["passages"].add(ki["passage"])
        if iid in day.judgements:
            s["reviews"] += 1
            s["notes"].append(sum(ki["n_notes"].get(h, 0) for h in ki["hands"]))
    for name in SET_ORDER:
        stats.setdefault(name, {"passages": set(), "reviews": 0, "notes": []})
    return stats


def _passages_section(stats: dict) -> list[str]:
    lines = ["## Passages", "",
             "| set | what it is | passages | item reviews | reviewed notes per review |", "|---|---|---|---|---|"]
    for name in _set_order(stats):
        s = stats[name]
        per = (f"{_num(sum(s['notes']) / len(s['notes']))} ({min(s['notes'])} to {max(s['notes'])})"
               if s["notes"] else "n/a")
        lines.append(f"| {name} | {SET_WHAT.get(name, 'n/a')} | {len(s['passages'])} | {s['reviews']} | {per} |")
    notes = [n for s in stats.values() for n in s["notes"]]
    per = f"{_num(sum(notes) / len(notes))} ({min(notes)} to {max(notes)})" if notes else "n/a"
    lines.append(f"| all | | {sum(len(s['passages']) for s in stats.values())} | "
                 f"{sum(s['reviews'] for s in stats.values())} | {per} |")
    return lines + [""]


def _rates_lines(rates: dict) -> list[str]:
    out = []
    for name in _set_order(rates):
        r = rates[name]
        verdicts = ", ".join(f"{v} {r['verdicts'].get(v, 0)}" for v in VERDICTS)
        out.append(f"- {name}: mean overall score {_num(r['mean_overall'])} of {3 * len(CRITERIA)}; "
                   f"verdicts {verdicts}.")
    return out


def _recall_section(day: Day, recall: dict) -> list[str]:
    lines = ["## Recall control", "",
             "Each recall twin is a control passage again with the composer hidden, transposed by a tritone, "
             "re-fingered by the engine in the new key and its bars renumbered from 1. If the reviewer objects less "
             "or scores higher when it cannot know the piece, it is recalling an edition rather than reading the "
             "passage (docs/research/teacher-review.md 6.4).", ""]
    if not recall["pairs"]:
        return lines + ["No recall pair was reviewed this run.", ""]
    first = {}
    for iid in sorted(day.key_items):
        first.setdefault(day.key_items[iid]["passage"], day.key_items[iid])
    lines += ["| control | recall | piece and bars | notes | fingers alike | objections per 100 notes (control / recall) | "
              "overall (control / recall) | verdicts (control / recall) | matched objections |",
              "|---|---|---|---|---|---|---|---|---|"]
    for p in recall["pairs"]:
        ko = first.get(p["control"], {})
        where = (f"{ko.get('title') or ko.get('piece') or 'n/a'}, {_bars_text(ko.get('bars'))}, "
                 f"{_hands_text(ko.get('hands', []))}")
        o = [_num(x, 0) for x in p["overall"]]
        v = [x or "n/a" for x in p["verdict"]]
        lines.append(f"| {p['control']} | {p['recall']} | {where} | {p['notes']} | {_pct(p['finger_agreement'])} | "
                     f"{_num(p['per_100_notes'][0])} / {_num(p['per_100_notes'][1])} | {o[0]} / {o[1]} | {v[0]} / {v[1]} | "
                     f"{p['matched']} (Dice {_num(p['dice'])}) |")
    d100, dov = recall["mean_per_100_diff"], recall["mean_overall_diff"]
    lines += ["",
              f"Means over {recall['n']} pairs: fingers alike {_pct(recall['mean_finger_agreement'])}; objections per "
              f"100 notes, recall minus control, {_signed(d100)}; overall score, recall minus control, {_signed(dov)}; "
              f"same verdict in {_pct(recall['verdict_agreement'])} of pairs; matched objections (Dice) "
              f"{_num(recall['mean_dice'])}.", "",
              _recall_reading(recall), ""]
    return lines


def _signed(x) -> str:
    return "n/a" if x is None else f"{x:+.2f}"


def _recall_reading(recall: dict) -> str:
    d100, dov = recall["mean_per_100_diff"], recall["mean_overall_diff"]
    if d100 is None or dov is None:
        return "Reading: too few complete pairs to read a direction."
    fewer = "fewer" if d100 < 0 else "more" if d100 > 0 else "as many"
    score = "higher" if dov > 0 else "lower" if dov < 0 else "the same"
    return (f"Reading: with {recall['n']} pairs this is a smoke check, not an estimate; the hidden, transposed twins "
            f"drew {fewer} objections per 100 notes and scored {score} than their controls, and since the engine "
            f"re-fingers the new key ({_pct(recall['mean_finger_agreement'])} of fingers alike), a difference is read "
            "against the change in fingering before it is read as recall.")


def _hard_section(day: Day, hard: dict, members: list) -> list[str]:
    lines = ["## Hard-error passages", "",
             "PIG passages around the hard errors of the bench gallery (every annotator agrees and the engine differs), "
             "from the PIG validation pieces only. Their bars, pitches, renderings and the reviewers' texts stay under "
             "research/data/teacher_review/ (PIG licence); this section gives counts and opaque passage ids only.", ""]
    items = {i: k for i, k in day.key_items.items() if _set(k) == "harderr"}
    if not items:
        return lines + ["No hard-error passage was reviewed this run.", ""]
    reviewed = [i for i in sorted(items) if i in day.judgements]
    obs = [o for i in reviewed for o in day.judgements[i]["objections"]]
    hm = [m for m in members if m.set == "harderr"]
    by_piece: dict[str, set] = {}
    for k in items.values():
        by_piece.setdefault(str(k.get("piece")), set()).add(k["passage"])
    groups = sorted((sorted(ps) for ps in by_piece.values()), key=lambda ps: (-len(ps), ps[0]))
    lines += [f"- Passages: {len({k['passage'] for k in items.values()})}, item reviews: {len(reviewed)}.",
              f"- Hard-error notes, summed over the reviews: {hard['hard_notes']}; an objection lands within one note of "
              f"{_share(hard['hit'], hard['hard_notes'])}.",
              f"- Fixes proposed on hard-error notes: {hard['fix_on_hard']}; the fix is the annotators' finger in "
              f"{_share(hard['fix_match'], hard['fix_on_hard'])}.",
              f"- Objections: {len(obs)} ({_severities(Counter(o['severity'] for o in obs))}); by kind: "
              f"{_counts(Counter(o['kind'] for o in obs))}.",
              f"- Consistent objections (hypothesis members): {len(hm)} ({_counts(Counter(m.kind for m in hm))}).",
              "- Passages per piece, pieces unnamed: "
              + "; ".join(f"{len(ps)} ({', '.join(ps)})" for ps in groups) + ".", ""]
    return lines


def _hypothesis_bullet(h: dict) -> str:
    text = h["cells"][0].split("): ", 1)[1]
    proposal = h["cells"][1]
    if proposal.startswith("None yet; proposed: "):
        proposal = proposal[len("None yet; proposed: "):]
    if proposal.endswith(" " + TESTED):
        proposal = proposal[: -len(TESTED) - 1]
    return (f"- **{h['id']}** ({h['basis']} {h['key']}): {text} Proposed: {proposal} Members: {h['both']} raised by "
            f"both reviewers, {h['members'] - h['both']} error-only; passages {', '.join(h['passages'])}.")


def _first_note(m) -> tuple:
    return _note_key(m.notes[0]) if m.notes else (False, 0)


def _covers(line: str, notes: list[str]) -> bool:
    m = _LABEL.match(line)
    if not m:
        return False
    hand, a = m.group(1), int(m.group(2))
    b = int(m.group(3) or a)
    return any(n[0] == hand and a <= int(n[1:]) <= b for n in notes)


def instructive(day: Day, members: list, k: int = 3) -> list[dict]:
    """The k most instructive library objections, at most one per passage."""
    lib = [m for m in members if m.source == "library" and m.set in INSTRUCTIVE_SETS]
    lib.sort(key=lambda m: (SEVERITY_RANK[m.severity], m.basis != "both", m.lint_key != "none", not m.fix, m.passage,
                            _first_note(m)))
    rules = (day.meta or {}).get("lintRules") or {}
    titles = {r: (v["title"] if isinstance(v, dict) else v) for r, v in rules.items()}
    out, seen = [], set()
    for m in lib:
        if m.passage in seen:
            continue
        seen.add(m.passage)
        iids = [i for i in sorted(day.key_items) if day.key_items[i]["passage"] == m.passage]
        ki = day.key_items[iids[0]]
        render = next((day.renders[i] for i in iids if i in day.renders), "")
        rlines = render.splitlines()
        head = [ln for ln in rlines if ln.startswith("id ")][:1]
        notes_lines = [ln for ln in rlines if _covers(ln, m.notes)]
        engine = ki.get("engine") or {}
        out.append({"rank": len(out) + 1, "passage": m.passage, "set": m.set, "piece": ki.get("piece"),
                    "title": ki.get("title", ""), "bars": ki.get("bars"), "hands": ki.get("hands", []),
                    "kind": m.kind, "severity": m.severity, "basis": m.basis, "notes": m.notes,
                    "lines": head + notes_lines if notes_lines else [],
                    "engine": {n: {"finger": (engine.get(n) or {}).get("finger"),
                                   "confidence": (engine.get(n) or {}).get("confidence")} for n in m.notes},
                    "lint": m.lint, "lint_titles": {r: titles[r] for r in (m.lint or []) if r in titles},
                    "problems": [{"reviewer": r, "problem": p} for r, p in zip(m.reviewers, m.problems)],
                    "fix": dict(sorted(m.fix.items(), key=lambda kv: _note_key(kv[0])))})
        if len(out) == k:
            break
    return out


def _quote_lines(q: dict) -> list[str]:
    head = (f"### {q['rank']}. {q['passage']}: {q['title'] or 'n/a'}, {_bars_text(q['bars'])}, "
            f"{_hands_text(q['hands'])} ({SET_LABEL.get(q['set'], q['set'])})")
    raised = "both reviewers" if q["basis"] == "both" else f"reviewer {q['problems'][0]['reviewer']} (error severity)"
    lines = [head, "", f"Objection of kind `{q['kind']}`, severity {q['severity']}, raised by {raised}.", ""]
    if q["lines"]:
        lines += ["```text", *q["lines"], "```", ""]
    else:
        lines += ["(No rendered line names these notes.)", ""]
    eng = ", ".join(f"{n} {e['finger'] if e['finger'] is not None else 'n/a'} (confidence {_num(e['confidence'])})"
                    for n, e in q["engine"].items()) or "n/a"
    if q["lint"] is None:
        lint = "n/a"
    else:
        lint = ", ".join(f"{r} ({q['lint_titles'][r]})" if r in q["lint_titles"] else r for r in q["lint"]) or "none"
    lines += [f"Engine: {eng}; lint at these notes: {lint}.", ""]
    # verbatim, with runs of white space (a line break inside a problem) shown as one space so the bullet holds
    lines += [f"- Reviewer {p['reviewer']}: \"{' '.join(p['problem'].split())}\"" for p in q["problems"]]
    fix = ", ".join(f"{n}→{f}" for n, f in q["fix"].items()) or "none given"
    return lines + ["", f"Fix: {fix}", ""]


def _cost_section(day: Day) -> tuple[list[str], dict]:
    c = cost(day.collect_report)
    lines = ["## Cost", "",
             f"- Batches: {c['batches']}, item reviews: {c['items']}; wall time per batch (median) "
             f"{_num(c['wall_s_per_batch_median'], 0)} s, per item review (mean) {_num(c['wall_s_per_item_mean'], 0)} s.",
             f"- Characters per item review: {_num(c['chars_in_per_item'], 0)} in, {_num(c['chars_out_per_item'], 0)} out; "
             f"estimated tokens per item review {_num(c['est_tokens_in_per_item'], 0)} in, "
             f"{_num(c['est_tokens_out_per_item'], 0)} out (characters / 4; the reviewer's reasoning is not observable "
             "from the files)."]
    summary = dict(c)
    if day.dispatch_log is not None:
        batches = (day.dispatch_log.get("batches") or {}).values()
        tokens = [b.get("subagent_tokens") for b in batches if isinstance(b, dict)]
        known = [t for t in tokens if t is not None]
        total = sum(known) if known else None
        median = statistics.median(known) if known else None
        lines.append(f"- Subagent tokens (dispatch_log.json): total {'n/a' if total is None else f'{total:,}'}, median "
                     f"per batch {'n/a' if median is None else f'{median:,.0f}'}, over {len(known)} batches with a "
                     "usage block"
                     f"{f' ({len(tokens) - len(known)} without)' if len(tokens) > len(known) else ''}.")
        summary["dispatch"] = {"batches_with_usage": len(known), "batches_without_usage": len(tokens) - len(known),
                               "subagent_tokens_total": total, "subagent_tokens_median_per_batch": median}
    else:
        lines.append("- Subagent tokens: no dispatch_log.json for this run.")
    return lines + [""], summary


def _limits(day: Day, stats: dict, planted: dict, pilot_d: dict) -> list[str]:
    n_planted = len(stats.get("planted", {}).get("passages", ()))
    n_recall = len(stats.get("recall", {}).get("passages", ()))
    lines = ["## Limits of this run", "",
             f"- Small control samples: {n_planted} planted-fault passages and {n_recall} recall pairs are smoke checks "
             "for drift of the reviewer, not estimates.",
             "- One model family: the reviewer is an Opus model, the family that also writes the engine's rules, so "
             "blind spots can be shared (docs/research/teacher-review.md section 8).",
             "- PIG bars are estimated from the performance timing (docs/research/teacher-review.md 2.2); hard-error "
             "passages are counted here and never quoted.",
             "- User-edited passages (verification spec 3.12 item d) are out of scope until M5 stores edits in the app.",
             "- The brief still tells reviewers that some fingerings are by expert pianists, although none are this run; "
             "the sentence is kept verbatim so the numbers stay comparable with the pilot "
             "(docs/research/teacher-review.md 6.3).",
             "- Never a gate: no floor reads these numbers, pnpm verify never runs this job, and nothing is tuned on "
             "them (verification spec 3.12)."]
    pos = planted["total"].get("sensitivity_pos")
    if pos is not None:
        lines.append(f"- Planted faults found by position: {_pct(pos)} this run against {_pct(pilot_d['planted_pos'])} "
                     "in the pilot; a drop is a finding about the reviewer, not about the engine.")
    missing = list(dict.fromkeys(day.collect_report.get("missing_items") or []))
    if missing:                                 # only reachable with weekly.py report --allow-missing
        batches = sorted({str(day.key_items[i].get("batch")) for i in missing
                          if i in day.key_items and day.key_items[i].get("batch")})
        where = f" ({'batch' if len(batches) == 1 else 'batches'} {', '.join(batches)})" if batches else ""
        collected = sum(1 for i in day.key_items if i in day.judgements)
        lines.append(f"- Missing reviews: {len(missing)} of {len(day.key_items)} item reviews were not collected{where}; "
                     f"the report was written with --allow-missing, so every number above covers the {collected} "
                     "collected reviews only.")
    return lines


# ---------------------------------------------------------------------------------------
# the report
# ---------------------------------------------------------------------------------------

def build_report(day: Day, pilot: dict, prior: list[dict]) -> tuple[str, dict, str]:
    """Markdown report, summary (committed as summary.json) and the rows for docs/experiments.md. Pure: the same
    day gives the same three strings."""
    ki, js = day.key_items, day.judgements
    stats = _passage_stats(day)
    planted_keys = {i: k for i, k in ki.items() if _set(k) == "planted"}
    planted_md, planted = planted_table(planted_keys, {i: j for i, j in js.items() if i in planted_keys})
    (ka, ja), (kb, jb) = _split(day)
    agreement = consistency(ka, ja, kb, jb)
    rb = readback(js)
    rates = rates_by(ki, js)
    drift = {"planted_pos": planted["total"].get("sensitivity_pos"),
             "planted_kind": planted["total"].get("sensitivity_kind"),
             "control_per_100": rates["control"]["per_100_notes"] if "control" in rates else None,
             "readback": rb["exact_share"], "verdict_agreement": agreement["verdict_agreement"]}
    seeds = seed_hits(ki, js)
    recall = recall_comparison(ki, js)
    hard = hard_error_agreement(ki, js)
    members = weekly_members(ki, js)
    hyps = hypotheses(members, day.date, f"teacher-{day.date}.md", (day.meta or {}).get("lintRules"))
    rows = experiments_rows(hyps)
    quotes = instructive(day, members)
    pilot_d = pilot_drift(pilot)
    pt = pilot["pooled"]["fault_detection"]["total"]
    earlier = sorted((p for p in prior if p.get("date", "") < day.date and p.get("drift")), key=lambda p: p["date"])

    md = _header(day)
    md += _passages_section(stats)
    md += ["## Reviewer controls", "",
           "### Planted faults", "",
           "Faults planted by inject.py into library control passages. Found by position: an objection names a note "
           "within one note of the fault; by kind: such an objection has a matching kind; with severity error: such "
           "an objection is an error. The last row is the pilot's pooled result on PIG expert passages, for reference.",
           "", planted_md,
           f"| pilot {PILOT_LABEL.split()[0]}, all | {pt['planted']} | {_share(pt['detected_pos'], pt['planted'])} | "
           f"{_share(pt['detected_kind'], pt['planted'])} | {_share(pt['detected_error'], pt['planted'])} |", "",
           "### Agreement between the two reviewers", "",
           "Passages reviewed under both framings (low-confidence and hard-error), paired by passage; overall = the "
           f"sum of the {len(CRITERIA)} criteria (0 to {3 * len(CRITERIA)}).", "",
           agreement_table(agreement), "",
           "### Read-back", "",
           f"{rb['hands']} hands read back, {_share(rb['exact'], rb['hands'])} exactly; {rb['digit_errors']} digit "
           f"errors in {rb['digits']} digits.", "",
           "### Drift over time", "",
           "Tracked only to notice drift of the reviewer (a model or prompt change), never as an engine metric. The "
           "pilot's control column is its objection rate on PIG expert fingerings.", "",
           "| run | planted found by position | by kind | control objections per 100 notes | read-back exact | "
           "reviewer verdict agreement |", "|---|---|---|---|---|---|",
           drift_row(PILOT_LABEL, pilot_d)]
    md += [drift_row(p["date"], p["drift"]) for p in earlier]
    md += [drift_row(day.date, drift), ""]
    md += ["## Objection rates per set", "",
           "Objections within one note of a planted fault are left out of the planted set's rates.", "",
           rates_table(rates), ""]
    md += _rates_lines(rates) + [""]
    md += ["## Low-confidence notes", "",
           f"An objection names the low-confidence note (within one note) in {seeds['hit']} of {seeds['reviews']} "
           f"reviews ({_pct(seeds['share'])}).", ""]
    md += _recall_section(day, recall)
    md += _hard_section(day, hard, members)
    md += ["## Hypotheses", "",
           "Groups of three or more consistent objections: both reviewers name the same kind within one note, or one "
           "reviewer raises an error (controls contribute errors only; planted and recall twins never). Each is a "
           "hypothesis for the quantitative loop (verification spec section 4), not a finding.", ""]
    md += [_hypothesis_bullet(h) for h in hyps] or ["No group reached three consistent objections this run."]
    md += ["", f"Rows for docs/experiments.md: research/teacher_review/results/weekly/{day.date}/hypotheses.md "
               "(the coordinator appends them).", ""]
    md += ["## Three instructive objections", "",
           "Library passages only (low-confidence and control sets), ranked by severity, then objections both "
           "reviewers raised, then those where no related lint rule fires, then those with a fix; at most one per "
           "passage. The reviewers' texts are quoted verbatim.", ""]
    if quotes:
        for q in quotes:
            md += _quote_lines(q)
    else:
        md += ["No library passage had a consistent objection this week.", ""]
    cost_md, cost_summary = _cost_section(day)
    md += cost_md
    md += _limits(day, stats, planted, pilot_d)

    library, pig = {}, {}
    consistent = Counter(m.passage for m in members)
    for iid in sorted(ki):
        k = ki[iid]
        if _source(k) == "library":
            library.setdefault(k["passage"], {"passage": k["passage"], "set": _set(k),
                                              "slug": k.get("slug") or str(k.get("piece") or "").split("@")[0],
                                              "title": k.get("title", ""), "bars": k.get("bars"),
                                              "hands": k.get("hands", [])})
            continue
        e = pig.setdefault(k["passage"], {"passage": k["passage"], "notes": sum(k["n_notes"].get(h, 0) for h in k["hands"]),
                                          "hard_errors": len(k.get("hard") or {}), "objections": 0, "errors": 0,
                                          "consistent": consistent.get(k["passage"], 0)})
        obs = (js.get(iid) or {}).get("objections", [])
        e["objections"] += len(obs)
        e["errors"] += sum(o["severity"] == "error" for o in obs)
    summary = {"date": day.date, "meta": day.meta,
               "sets": {s: {"passages": len(stats[s]["passages"]), "item_reviews": stats[s]["reviews"]}
                        for s in _set_order(stats)},
               "rates": rates, "planted": planted, "agreement": agreement, "readback": rb, "drift": drift,
               "seed_hits": seeds, "recall": recall, "hard_errors": hard, "hypotheses": hyps, "instructive": quotes,
               "library_passages": [library[p] for p in sorted(library)], "pig_passages": [pig[p] for p in sorted(pig)],
               "cost": cost_summary}
    return "\n".join(md).rstrip("\n") + "\n", summary, rows


# ---------------------------------------------------------------------------------------
# the PIG audit
# ---------------------------------------------------------------------------------------

def _forbidden(day: Day) -> list[tuple[str, str, str]]:
    out = []
    for iid in sorted(day.key_items):
        if _source(day.key_items[iid]) != "pig":
            continue
        for o in (day.judgements.get(iid) or {}).get("objections", []):
            text = str(o.get("problem", "")).strip()
            if len(text) >= MIN_PROBLEM_CHARS:
                out.append((iid, "a reviewer's objection text", text))
        lines = [ln for ln in day.renders.get(iid, "").splitlines() if _NOTE_LINE.match(ln)]
        out += [(iid, "two consecutive note lines of its rendering", a + "\n" + b) for a, b in zip(lines, lines[1:])]
    return out


def _variants(s: str) -> list[str]:
    """The string as written and as it reads inside a JSON string (escaped quotes, backslashes, newlines and, with
    ensure_ascii, non-ASCII characters), so a leak into summary.json is caught however it was dumped."""
    return list(dict.fromkeys([s, json.dumps(s, ensure_ascii=False)[1:-1], json.dumps(s)[1:-1]]))


def audit_no_pig(day: Day, *texts: str) -> None:
    """Raise PigLeak when any text holds a PIG item's objection text (24 characters or more) or two consecutive
    note lines of a PIG item's rendering."""
    for iid, what, s in _forbidden(day):
        for v in _variants(s):
            for n, t in enumerate(texts, 1):
                if v in t:
                    raise PigLeak(f"{iid}: {what} appears in text {n}")
