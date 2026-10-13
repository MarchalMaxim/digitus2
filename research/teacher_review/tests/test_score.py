"""Scorer: known synthetic key + judgements give known numbers."""
from teacher_review.collect import normalise_item
from teacher_review.score import (consistency, disagreement, fault_detection, false_positives, overall,
                                  per_kind_fp, ranking, readback, spearman)


def _key():
    faults = [{"kind": "hop_at_speed", "hand": "R", "notes": ["R3", "R4"], "anchor": "R4",
               "before": {"R3": 2, "R4": 3}, "after": {"R3": 2, "R4": 2}},
              {"kind": "thumb_on_black_between_whites", "hand": "R", "notes": ["R9"], "anchor": "R9",
               "before": {"R9": 3}, "after": {"R9": 1}}]
    alt = {f"R{i}": {"expert": 2, "others": [2, 2]} for i in range(1, 11)}
    alt["R5"] = {"expert": 2, "others": [3, 2]}      # disputed note
    alt["R6"] = {"expert": 2, "others": [4, 4]}      # disputed note
    base = {"passage": "p01", "piece": "001", "composer": "Bach", "slot": "1", "annotator": "YI", "bars": [1, 2],
            "hands": ["R"], "batch": "A-01", "n_notes": {"R": 10, "L": 0}, "fingers": {"R": "1 2 2 3 2 2 1 2 3 4"}}
    return {
        "e": dict(base, condition="expert", faults=[], alt=alt),
        "h": dict(base, condition="fhmm3", faults=[], alt=alt),
        "c": dict(base, condition="corrupted", faults=faults, alt={}),
    }


def _j(item, cond, scores, verdict, objections):
    sc = dict(zip(["possible", "idiomatic", "economical", "consistent", "beginner_friendly"], scores))
    vr = {"good": 3, "acceptable": 2, "flawed": 1, "unplayable": 0}[verdict]
    return {"item": item, "passage": "p01", "condition": cond, "scores": sc, "verdict": verdict, "verdict_rank": vr,
            "objections": objections, "comment": "", "readback": {"R": {"n": 10, "errors": 0, "exact": True, "length_ok": True}}}


def _ob(notes, kind, sev="warning", fix=None):
    return {"notes": notes, "kind": kind, "severity": sev, "problem": "x", "fix": fix or {}}


def test_fault_detection_position_and_kind():
    key = _key()
    js = {"c": _j("c", "corrupted", [1, 2, 2, 3, 2], "flawed",
                  [_ob(["R5"], "hop", "warning", {"R5": 3}),            # within one note of R4: position hit, kind ok
                   _ob(["R9"], "stretch", "error")])}                    # position hit, kind not accepted for thumb_on_black
    fd = fault_detection(key, js)
    assert fd["per_kind"]["hop_at_speed"]["detected_pos"] == 1
    assert fd["per_kind"]["hop_at_speed"]["detected_kind"] == 1
    assert fd["per_kind"]["thumb_on_black_between_whites"]["detected_pos"] == 1
    assert fd["per_kind"]["thumb_on_black_between_whites"]["detected_kind"] == 0
    assert fd["per_kind"]["thumb_on_black_between_whites"]["detected_error"] == 1
    assert fd["total"]["sensitivity_pos"] == 1.0 and fd["total"]["sensitivity_kind"] == 0.5
    # two notes away is a miss
    js2 = {"c": _j("c", "corrupted", [1, 2, 2, 3, 2], "flawed", [_ob(["R6"], "hop")])}
    assert fault_detection(key, js2)["total"]["detected_pos"] == 0


def test_false_positives_and_spurious():
    key = _key()
    js = {"e": _j("e", "expert", [3, 3, 3, 3, 3], "good", [_ob(["R2"], "hop", "error")]),
          "h": _j("h", "fhmm3", [3, 2, 2, 3, 2], "acceptable", []),
          "c": _j("c", "corrupted", [1, 1, 2, 3, 1], "flawed", [_ob(["R4"], "hop"), _ob(["R7"], "stretch")])}
    fp = false_positives(key, js)
    assert fp["expert"]["objections"] == 1 and fp["expert"]["per_100_notes"] == 10.0
    assert fp["expert"]["share_items_with_error"] == 1.0
    assert fp["fhmm3"]["objections"] == 0
    assert fp["corrupted"]["objections"] == 1          # R7 is spurious, R4 is planted
    pk = per_kind_fp(key, js)
    assert pk["hop_at_speed"]["objections"] == 1 and pk["impossible_span"]["objections"] == 0


def test_ranking_counts_pairs():
    key = _key()
    js = {"e": _j("e", "expert", [3, 3, 3, 3, 3], "good", []),
          "h": _j("h", "fhmm3", [3, 2, 2, 3, 2], "acceptable", []),
          "c": _j("c", "corrupted", [1, 1, 2, 3, 1], "flawed", [])}
    r = ranking(key, js)
    assert r["passages"] == 1
    assert r["pairs"]["expert>fhmm3>corrupted"]["count"] == 1
    assert r["pairs"]["verdict expert>corrupted"]["count"] == 1
    assert r["mean_scores"]["corrupted"]["overall"] == 8.0
    assert overall(js["e"]) == 15.0


def test_disagreement_buckets_and_fix_match():
    key = _key()
    js = {"e": _j("e", "expert", [3, 3, 3, 3, 3], "good",
                  [_ob(["R5"], "hop", "warning", {"R5": 3}), _ob(["R1"], "weak_finger", "info", {"R1": 4})])}
    d = disagreement(key, js)
    assert d["disputed"]["notes"] == 2 and d["disputed"]["flagged"] == 1
    assert d["agreed"]["notes"] == 8 and d["agreed"]["flagged"] == 1
    assert d["fixes"]["fixes"] == 2 and d["fixes"]["fix_matches_other_expert"] == 1
    assert d["fix_matches_other_expert_share"] == 0.5


def test_consistency_between_runs():
    key = _key()
    jA = {"e": _j("e", "expert", [3, 3, 3, 3, 3], "good", []),
          "c": _j("c", "corrupted", [1, 1, 2, 3, 1], "flawed", [_ob(["R4"], "hop")])}
    keyB = {"x": key["e"], "y": key["c"]}
    jB = {"x": _j("x", "expert", [3, 3, 2, 3, 3], "good", []),
          "y": _j("y", "corrupted", [1, 2, 2, 3, 1], "flawed", [_ob(["R4"], "hop"), _ob(["R9"], "thumb_on_black")])}
    c = consistency(key, jA, keyB, jB)
    assert c["items"] == 2
    assert c["verdict_agreement"] == 1.0
    assert c["faults"] == {"both_runs_detect": 1, "one_run_detects": 1, "neither": 0}
    assert c["mean_abs_diff_overall"] == 1.0
    assert abs(c["objection_note_jaccard_mean"] - 0.5) < 1e-9


def test_spearman_handles_ties():
    assert abs(spearman([1, 2, 3, 4], [1, 2, 3, 4]) - 1.0) < 1e-9
    assert abs(spearman([1, 2, 3, 4], [4, 3, 2, 1]) + 1.0) < 1e-9
    assert spearman([1, 1, 1, 1], [1, 2, 3, 4]) is None


def test_normalise_item_validates_and_checks_readback():
    key = _key()["e"]
    problems = []
    raw = {"item": "e", "readback": {"R": "1 2 2 3 2 2 1 2 3 5"}, "scores": {"possible": 3, "idiomatic": 2, "economical": 2,
           "consistent": 3, "beginner_friendly": 7}, "verdict": "Acceptable",
           "objections": [{"notes": ["R2", "R99"], "kind": "bogus", "severity": "error", "problem": "p", "fix": {"R2": "3"}}]}
    j = normalise_item(raw, key, problems)
    assert j["scores"]["beginner_friendly"] is None
    assert j["verdict"] == "acceptable"
    assert j["objections"][0]["notes"] == ["R2"] and j["objections"][0]["kind"] == "other"
    assert j["objections"][0]["fix"] == {"R2": 3}
    assert j["readback"]["R"] == {"n": 10, "errors": 1, "exact": False, "length_ok": True}
    assert any("out of range" in p for p in problems) and any("unknown notes" in p for p in problems)
    rb = readback({"e": j})
    assert rb["digit_errors"] == 1 and rb["exact"] == 0
