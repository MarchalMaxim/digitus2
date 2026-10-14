"""report: the weekly report, its summary, the drift table and the PIG audit."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from teacher_review.render import render_passage
from teacher_review.report import Day, PigLeak, audit_no_pig, build_report

from .conftest import make_passage

RESULTS = Path(__file__).resolve().parents[1] / "results"
PILOT = json.loads((RESULTS / "summary.json").read_text(encoding="utf-8"))


def _pilot_day():
    """The pilot's committed results seen as a weekly run: run A = reviewer a, run B = reviewer b; FHMM3 passages
    play the low-confidence set, corrupted passages the planted control, expert passages stay 'expert'."""
    sets = {"expert": "expert", "fhmm3": "lowconf", "corrupted": "planted"}
    items, js, batches = {}, {}, {}
    for run, rev in (("A", "a"), ("B", "b")):
        key = json.loads((RESULTS / run / "key.json").read_text(encoding="utf-8"))["items"]
        jud = json.loads((RESULTS / run / "judgements.json").read_text(encoding="utf-8"))
        for iid, ki in key.items():
            items[f"{run}:{iid}"] = dict(ki, set=sets[ki["condition"]], source="pig", reviewer=rev)
            js[f"{run}:{iid}"] = jud[iid]
        batches.update(json.loads((RESULTS / run / "collect_report.json").read_text(encoding="utf-8"))["batches"])
    report = {"batches": batches, "problems": [], "missing_items": [], "n_items": len(js)}
    return Day(date="2026-10-14", meta={}, key_items=items, judgements=js, collect_report=report, renders={},
               dispatch_log=None)


def test_report_on_the_pilot_results():
    day = _pilot_day()
    md, summary, rows = build_report(day, PILOT, [])
    assert "| all | 184 | 183 (99%) | 174 (95%) | 124 (67%) |" in md
    assert "| 120 | 0.95 | 0.95 | 0.67 | 81% | 0.65 |" in md
    assert "| expert | 80 | 2014 | 51 | 0.64 | 2.53 | 3 | 28 | 20 | 4% |" in md
    assert "| 2026-10-13 (pilot) | 99% | 95% | 2.53 | 100% | 81% |" in md
    assert "| 2026-10-14 | 99% | 95% | n/a | 100% | 81% |" in md
    assert [h["key"] for h in summary["hypotheses"]] == [
        "hop", "impossible_span", "inconsistent", "other", "same_finger_chord", "stretch", "position_change"]
    assert "(K1): 9 consistent objections of kind hop in 8 passages (lowconf 9)" in rows
    assert [ln for ln in md.splitlines() if ln.startswith("## ")] == [
        "## Passages", "## Reviewer controls", "## Objection rates per set", "## Low-confidence notes",
        "## Recall control", "## Hard-error passages", "## Hypotheses", "## Three instructive objections", "## Cost",
        "## Limits of this run"]
    assert "No library passage had a consistent objection this week." in md
    blob = md + json.dumps(summary, ensure_ascii=False) + rows
    assert "Octave B1-B2 fingered 5-4; the 4-5 pair cannot span more than a third." not in blob
    audit_no_pig(day, md, json.dumps(summary, ensure_ascii=False), rows)
    assert len(md.encode("utf-8")) < 900_000 and len(json.dumps(summary).encode("utf-8")) < 900_000


def _library_item(pid, rev, p, engine_lint=None, set_name="lowconf"):
    hands = ["R"]
    engine = {nid: {"id": f"n{i}", "finger": f, "confidence": 0.4, "lint": (engine_lint or {}).get(nid, [])}
              for i, (nid, _, f, _, _) in enumerate(p.notes("R"))}
    return {"passage": pid, "set": set_name, "source": "library", "condition": "engine", "reviewer": rev, "piece": f"slug-{pid}",
            "title": f"Title {pid}", "level": 2, "bars": [3, 4], "hands": hands, "n_notes": {"R": len(p.notes("R"))},
            "fingers": {"R": p.finger_string("R")}, "faults": [], "alt": {}, "engine": engine, "hard": {}, "seed_note": "R2"}


def _j(obs):
    return {"scores": {"possible": 3, "idiomatic": 3, "economical": 2, "consistent": 3, "beginner_friendly": 3},
            "verdict": "acceptable", "verdict_rank": 2, "objections": obs, "comment": "",
            "readback": {"R": {"n": 8, "errors": 0, "exact": True, "length_ok": True}}}


def _o(notes, kind, sev, problem, fix=None):
    return {"notes": notes, "kind": kind, "severity": sev, "problem": problem, "fix": fix or {}}


def _synthetic_day():
    p = make_passage([(i * 0.5, 0.5, [60 + i], [1 + i % 5]) for i in range(8)], pid="it-0000")
    pp = make_passage([(i * 0.5, 0.5, [74 + i], [5 - i % 5]) for i in range(8)], pid="it-0000")   # the PIG passage
    items, js, renders = {}, {}, {}

    def add(iid, ki, obs, passage=p):
        items[iid], js[iid] = ki, _j(obs)
        q = passage.copy()
        q.passage_id = iid
        renders[iid] = render_passage(q)

    # lc01: a shared warning hop where lint L11 fires, with a fix
    add("it-0101", _library_item("lc01", "a", p, {"R3": ["L11"]}), [_o(["R3"], "hop", "warning", "Hop from R3 to R4 at speed.", {"R4": 2})])
    add("it-0102", _library_item("lc01", "b", p, {"R3": ["L11"]}), [_o(["R4"], "hop", "warning", "Finger 3 hops to R4.", {"R4": 2})])
    # lc02: one reviewer's error with a fix (lint silent)
    add("it-0201", _library_item("lc02", "a", p), [_o(["R5"], "same_finger_chord", "error", "Finger 1 is still holding C4.", {"R5": 2})])
    add("it-0202", _library_item("lc02", "b", p), [])
    # lc03: a shared warning where lint is silent, with a fix
    add("it-0301", _library_item("lc03", "a", p), [_o(["R2"], "position_change", "warning", "Needless shift at R2.", {"R2": 2})])
    add("it-0302", _library_item("lc03", "b", p), [_o(["R2"], "position_change", "warning", "The hand shifts for nothing.", {"R2": 2})])
    # lc04: a shared info without a fix
    add("it-0401", _library_item("lc04", "a", p), [_o(["R1"], "other", "info", "A matter of taste here.")])
    add("it-0402", _library_item("lc04", "b", p), [_o(["R1"], "other", "info", "Could also start with 2.")])
    # he01: a PIG passage both reviewers object to
    pig = dict(_library_item("he01", "a", pp), set="harderr", source="pig", title="", hard={"R3": 2})
    add("it-0901", pig, [_o(["R3"], "hop", "warning", "PIGSECRET: finger 2 hops from D5 to E5 at speed.")], pp)
    add("it-0902", dict(pig, reviewer="b"), [_o(["R3"], "hop", "warning", "PIGSECRET: the same hop again, D5 to E5.")], pp)
    rep = {"batches": {"01a": {"wall_s": 540.0, "chars_in": 20000, "chars_out": 7000, "n_items": 5},
                       "01b": {"wall_s": 600.0, "chars_in": 20000, "chars_out": 6000, "n_items": 5}},
           "problems": [], "missing_items": [], "n_items": len(js)}
    return Day(date="2099-01-01", meta={"engineVersion": "test"}, key_items=items, judgements=js, collect_report=rep,
               renders=renders, dispatch_log=None)


def test_instructive_objections_rank_and_quote_library_only():
    md, summary, _ = build_report(_synthetic_day(), PILOT, [])
    section = md.split("## Three instructive objections", 1)[1].split("## Cost", 1)[0]
    heads = [ln for ln in section.splitlines() if ln.startswith("### ")]
    assert [h.split()[2].rstrip(":,") for h in heads] == ["lc02", "lc03", "lc01"]
    assert "Finger 1 is still holding C4." in section and "A matter of taste here." not in section
    assert [q["passage"] for q in summary["instructive"]] == ["lc02", "lc03", "lc01"]


def test_pig_items_appear_only_as_counts():
    day = _synthetic_day()
    md, summary, rows = build_report(day, PILOT, [])
    blob = md + json.dumps(summary, ensure_ascii=False) + rows
    assert "PIGSECRET" not in blob
    (pig,) = summary["pig_passages"]
    assert set(pig) == {"passage", "notes", "hard_errors", "objections", "errors", "consistent"}
    audit_no_pig(day, md, json.dumps(summary, ensure_ascii=False), rows)
    lines = [ln for ln in day.renders["it-0901"].splitlines() if ln[:1] in "RL" and ln[1:2].isdigit()]
    with pytest.raises(PigLeak):
        audit_no_pig(day, md + "\n" + "\n".join(lines[2:4]))
    with pytest.raises(PigLeak):
        audit_no_pig(day, md, "PIGSECRET: finger 2 hops from D5 to E5 at speed.")


def test_missing_reviews_are_named_in_the_last_section():
    """A run reported with --allow-missing says so in "Limits of this run" (plan Task 9 step 6); a complete run
    does not."""
    day = _synthetic_day()
    md, _, _ = build_report(day, PILOT, [])
    assert "Missing reviews" not in md
    for iid, batch in (("it-0101", "01a"), ("it-0201", "01a"), ("it-0102", "01b"), ("it-0402", "01b")):
        day.key_items[iid] = dict(day.key_items[iid], batch=batch)
    for iid in ("it-0102", "it-0402"):
        day.judgements.pop(iid)
    day.collect_report = dict(day.collect_report, missing_items=["it-0102", "it-0402"], n_items=len(day.judgements))
    md, _, _ = build_report(day, PILOT, [])
    last = md.split("## Limits of this run", 1)[1]
    assert ("- Missing reviews: 2 of 10 item reviews were not collected (batch 01b); the report was written with "
            "--allow-missing, so every number above covers the 8 collected reviews only.") in last
    assert md.count("Missing reviews") == 1


def test_drift_table_lists_earlier_weeks_in_date_order():
    prior = [{"date": "2026-10-07", "drift": {"planted_pos": 0.9, "planted_kind": 0.8, "control_per_100": 3.1,
                                              "readback": 1.0, "verdict_agreement": 0.75}}]
    md, summary, _ = build_report(_synthetic_day(), PILOT, prior)
    table = [ln for ln in md.split("### Drift over time", 1)[1].splitlines() if ln.startswith("| 20")]
    assert [ln.split(" | ")[0] for ln in table] == ["| 2026-10-13 (pilot)", "| 2026-10-07", "| 2099-01-01"]
    assert table[1] == "| 2026-10-07 | 90% | 80% | 3.10 | 100% | 75% |"
    assert summary["drift"]["control_per_100"] is None
