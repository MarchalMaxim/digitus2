"""hypotheses: consistent objections, groups by kind and lint rule, rows for docs/experiments.md."""
from __future__ import annotations

import json
from pathlib import Path

from teacher_review.collect import KINDS
from teacher_review.hypotheses import (KIND_LINT, KIND_TEXT, Member, experiments_rows, group_by, hypotheses, lint_key,
                                       members_from_pair, weekly_members)

RESULTS = Path(__file__).resolve().parents[1] / "results"


def _load(run):
    return (json.loads((RESULTS / run / "key.json").read_text(encoding="utf-8"))["items"],
            json.loads((RESULTS / run / "judgements.json").read_text(encoding="utf-8")))


def _fhmm3():
    (ka, ja), (kb, jb) = _load("A"), _load("B")
    return members_from_pair(ka, ja, kb, jb, include=lambda ki: ki["condition"] == "fhmm3")


def test_every_objection_kind_has_a_text_and_a_lint_mapping():
    assert set(KIND_TEXT) == KINDS and set(KIND_LINT) == KINDS


def test_consistent_objections_on_the_pilot():
    fh = _fhmm3()
    assert len(fh) == 42 and sum(m.basis == "both" for m in fh) == 33 and len({m.passage for m in fh}) == 27
    sizes = {k: len(v) for k, v in group_by(fh, "kind").items() if len(v) >= 3}
    assert sizes == {"hop": 9, "impossible_span": 6, "inconsistent": 6, "other": 4, "same_finger_chord": 4,
                     "stretch": 4, "position_change": 3}
    assert all(m.lint is None and m.lint_key == "n/a" for m in fh)
    (ka, ja), (kb, jb) = _load("A"), _load("B")
    ex = members_from_pair(ka, ja, kb, jb, include=lambda ki: ki["condition"] == "expert")
    assert len(ex) == 13 and {k: len(v) for k, v in group_by(ex, "kind").items() if len(v) >= 3} == {"hop": 3}


def test_hypotheses_and_rows_on_the_pilot():
    hs = hypotheses(_fhmm3(), "2026-10-14", "teacher-2026-10-14.md")
    assert [(h["id"], h["key"], h["members"], len(h["passages"])) for h in hs] == [
        ("K1", "hop", 9, 8), ("K2", "impossible_span", 6, 5), ("K3", "inconsistent", 6, 6), ("K4", "other", 4, 4),
        ("K5", "same_finger_chord", 4, 4), ("K6", "stretch", 4, 4), ("K7", "position_change", 3, 2)]
    rows = experiments_rows(hs).splitlines()
    assert len(rows) == 7
    assert rows[0].startswith(
        "| 2026-10-14 | Teacher review 2026-10-14 (K1): 9 consistent objections of kind hop in 8 passages (fhmm3 9); "
        "lint was not recorded. Hypothesis: the hop penalty is too weak at the inter-onset intervals of these passages. "
        "| None yet; proposed: ")
    assert "severities: error 2, warning 7" in rows[0]
    assert all(r.startswith("| ") and r.endswith(" |") and r.count(" | ") == 5 for r in rows)


def test_lint_key_uses_only_the_related_rule():
    assert lint_key("hop", ["L07", "L11", "L14"]) == "L11"
    assert lint_key("hop", ["L07", "L14"]) == "none"
    assert lint_key("position_change", ["L11"]) == "none"
    assert lint_key("hop", None) == "n/a"


def _m(passage, kind, key):
    return Member(passage=passage, set="lowconf", source="library", kind=kind, severity="warning", notes=["R1"],
                  basis="both", reviewers=["a", "b"], problems=["x"], fix={}, lint=[] if key == "none" else [key],
                  lint_key=key)


def test_lint_groups_need_two_kinds_and_none_is_its_own_group():
    ms = [_m("lc01", "hop", "L11"), _m("lc02", "hop", "L11"), _m("lc03", "hop", "L11"),
          _m("lc04", "stretch", "L07"), _m("lc05", "stretch", "L07"), _m("lc06", "impossible_span", "L07"),
          _m("lc07", "position_change", "none"), _m("lc08", "position_change", "none"), _m("lc09", "inconsistent", "none")]
    hs = hypotheses(ms, "2026-10-21", "teacher-2026-10-21.md", lint_titles={"L07": "Uncomfortable span", "L11": "Fast hop"})
    assert [(h["id"], h["key"]) for h in hs] == [("K1", "hop"), ("L1", "L07"), ("L2", "none")]
    rows = experiments_rows(hs).splitlines()
    assert "lint L11 fires at 3 of them" in rows[0]
    assert rows[1].split(" | ")[1].startswith(
        "Teacher review 2026-10-21 (L1): lint L07 (Uncomfortable span) also fires at 3 consistent objections of "
        "2 kinds (stretch 2, impossible_span 1) in 3 passages.")
    assert rows[2].split(" | ")[1].startswith(
        "Teacher review 2026-10-21 (L2): no related lint rule fires at 3 consistent objections of 2 kinds "
        "(position_change 2, inconsistent 1) in 3 passages.")


def _item(passage, set_name, reviewer, engine=None, condition="engine"):
    return {"passage": passage, "set": set_name, "source": "library", "condition": condition, "reviewer": reviewer,
            "hands": ["R"], "n_notes": {"R": 10}, "fingers": {"R": "1 2 3 4 5 1 2 3 4 5"}, "engine": engine or {}}


def _jd(obs):
    return {"scores": {}, "verdict": "good", "verdict_rank": 3, "objections": obs, "comment": "", "readback": {}}


def _o(notes, kind, sev="warning"):
    return {"notes": notes, "kind": kind, "severity": sev, "problem": f"{kind} at {notes[0]}", "fix": {}}


def test_weekly_members_pair_engine_sets_and_take_errors_from_controls():
    key = {"a1": _item("lc01", "lowconf", "a", engine={"R3": {"lint": ["L11"]}, "R4": {"lint": []}}),
           "b1": _item("lc01", "lowconf", "b", engine={"R3": {"lint": ["L11"]}, "R4": {"lint": []}}),
           "c1": _item("ct01", "control", "a"),
           "p1": _item("pf01", "planted", "b", condition="corrupted"),
           "r1": _item("rc01", "recall", "a")}
    js = {"a1": _jd([_o(["R3"], "hop"), _o(["R9"], "stretch", "info")]),
          "b1": _jd([_o(["R4"], "hop"), _o(["R1"], "impossible_span", "error")]),
          "c1": _jd([_o(["R2"], "hop"), _o(["R5"], "same_finger_chord", "error")]),
          "p1": _jd([_o(["R2"], "hop", "error")]), "r1": _jd([_o(["R2"], "hop", "error")])}
    ms = weekly_members(key, js)
    assert [(m.passage, m.kind, m.basis, m.lint_key) for m in ms] == [
        ("ct01", "same_finger_chord", "error", "none"), ("lc01", "hop", "both", "L11"),
        ("lc01", "impossible_span", "error", "none")]
    assert ms[1].problems == ["hop at R3", "hop at R4"] and ms[1].notes == ["R3", "R4"]
