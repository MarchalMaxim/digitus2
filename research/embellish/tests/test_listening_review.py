"""The listening-test collector (schema checks, the join of inserted ids to their rules) and the scorer
(per-condition means, objection classes, per-note rates, the per-piece sign test)."""
from __future__ import annotations

import json
from fractions import Fraction as F

import pytest

from embellish import collect, score

BATCH = """# Batch batch-99

Brief text. An example block that must not be parsed as a passage:

```json
{"items": [{"objections": [{"notes": ["R7"]}]}]}
```

## Passages

```
PASSAGE em-0001
Composer: Traditional (songs). Meter: 4/4. Tempo: quarter = 100. Bars 2-3.
id     bar beat  dur   pitch
RH (melody)
R1     2   1     q     C4
R2     2   2     e     D4
R3     2   2.5   e     Eb4
-      2   3     h     rest
R4     3   1     w     F#4
LH (accompaniment)
L1-2   2   1     w     C3+G3
L3     3   1     w     C3
```

```
PASSAGE em-0002
Composer: Traditional (songs). Meter: 3/4. Tempo: quarter = 96. Bars 1-1.
id     bar beat  dur   pitch
RH (melody)
R1     1   1     h.    A4
LH (accompaniment)
L1     1   1     h.    A2
```
"""


def good_item(iid, objections=()):
    return {"item": iid, "scores": {"musical": 3, "fits_harmony": 2, "beginner_friendly": 3},
            "verdict": "acceptable", "objections": list(objections), "comment": "fine"}


def good_raw():
    return {"batch": "batch-99", "started_at": "2026-01-01T00:00:00Z", "finished_at": "2026-01-01T00:01:00Z",
            "items": [good_item("em-0001", [{"notes": ["R2", "L1"], "kind": "clash", "severity": "info",
                                             "problem": "rubs"}]),
                      good_item("em-0002")]}


# ---- collect ------------------------------------------------------------------------------------

def test_pitch_names_convert_to_midi():
    assert collect.pitch_midi("C4") == 60
    assert collect.pitch_midi("C#4") == 61
    assert collect.pitch_midi("Eb4") == 63
    assert collect.pitch_midi("Bb3") == 58
    assert collect.pitch_midi("B-1") == 11


def test_parse_batch_reads_passages_in_order_and_skips_the_brief_example():
    bid, passages = collect.parse_batch(BATCH)
    assert bid == "batch-99"
    assert [p["item"] for p in passages] == ["em-0001", "em-0002"]
    notes = passages[0]["notes"]
    assert set(notes) == {"R1", "R2", "R3", "R4", "L1", "L2", "L3"}
    assert "R7" not in notes
    assert notes["R3"]["beat"] == F(5, 2) and notes["R3"]["midi"] == 63 and notes["R3"]["bar"] == 2
    assert notes["L1"]["midi"] == 48 and notes["L2"]["midi"] == 55  # chord range, low to high
    assert passages[0]["bars"] == [2, 3]


def test_a_valid_result_has_no_problems():
    _, passages = collect.parse_batch(BATCH)
    items, problems = collect.validate(good_raw(), "batch-99", passages)
    assert problems == []
    assert [i["item"] for i in items] == ["em-0001", "em-0002"]
    assert items[0]["objections"][0]["notes"] == ["R2", "L1"]
    assert items[0]["scores"] == {"musical": 3, "fits_harmony": 2, "beginner_friendly": 3}


@pytest.mark.parametrize("mutate, needle", [
    (lambda r: r.update(batch="batch-01"), "batch id"),
    (lambda r: r["items"].reverse(), "order"),
    (lambda r: r["items"].pop(), "missing"),
    (lambda r: r["items"].append(good_item("em-0001")), "duplicate"),
    (lambda r: r["items"].append(good_item("em-9999")), "unexpected"),
    (lambda r: r["items"][0]["scores"].update(musical=4), "musical"),
    (lambda r: r["items"][0]["scores"].update(musical=2.5), "musical"),
    (lambda r: r["items"][0]["scores"].update(musical=True), "musical"),
    (lambda r: r["items"][0]["scores"].pop("fits_harmony"), "fits_harmony"),
    (lambda r: r["items"][0].update(verdict="good"), "verdict"),
    (lambda r: r["items"][0]["objections"][0].update(kind="fingering"), "kind"),
    (lambda r: r["items"][0]["objections"][0].update(severity="fatal"), "severity"),
    (lambda r: r["items"][0]["objections"][0].update(notes=["R9"]), "R9"),
    (lambda r: r["items"][1]["objections"].append({"notes": ["R2"], "kind": "clash", "severity": "info",
                                                   "problem": "x"}), "R2"),
    (lambda r: r["items"][0]["objections"][0].update(problem=" ".join(["word"] * 26)), "25 words"),
])
def test_each_schema_violation_is_reported(mutate, needle):
    _, passages = collect.parse_batch(BATCH)
    raw = good_raw()
    mutate(raw)
    _, problems = collect.validate(raw, "batch-99", passages)
    assert any(needle in p for p in problems), problems


def test_unknown_note_ids_are_dropped_from_the_normalised_objection():
    _, passages = collect.parse_batch(BATCH)
    raw = good_raw()
    raw["items"][0]["objections"][0]["notes"] = ["R2", "R9"]
    items, _ = collect.validate(raw, "batch-99", passages)
    assert items[0]["objections"][0]["notes"] == ["R2"]


def test_inserted_ids_join_to_their_rules_by_bar_beat_and_midi():
    _, passages = collect.parse_batch(BATCH)
    entries = [{"bar": "2", "beat": "2", "midi": 62, "rule": "passing"},
               {"bar": "2", "beat": "2.5", "midi": 63, "rule": "neighbour-repeated"},
               {"bar": "7", "beat": "1", "midi": 62, "rule": "passing"}]  # outside the passage
    rules, problems = collect.join_rules(passages[0], ["R2", "R3"], entries)
    assert problems == []
    assert rules == {"R2": "passing", "R3": "neighbour-repeated"}


def test_join_reports_an_unmatched_id_and_a_count_mismatch():
    _, passages = collect.parse_batch(BATCH)
    rules, problems = collect.join_rules(passages[0], ["R2"], [{"bar": "2", "beat": "2", "midi": 64, "rule": "passing"},
                                                             {"bar": "3", "beat": "1", "midi": 66, "rule": "passing"}])
    assert "R2" not in rules
    assert any("R2" in p for p in problems)
    assert any("in the passage's bars" in p for p in problems)


def test_the_shipped_key_joins_every_inserted_id_to_one_rule():
    """Every inserted id in key.json resolves to exactly one entry of its density's inserted.json."""
    key = json.loads((collect.TEACHER / "key.json").read_text(encoding="utf-8"))
    pieces = collect.load_pieces(collect.LISTEN)
    passages = {}
    for path in sorted(collect.TEACHER.glob("batch-*.md")):
        for p in collect.parse_batch(path.read_text(encoding="utf-8"))[1]:
            passages[p["item"]] = p
    n = 0
    for k in key:
        if k["condition"] == "plain":
            continue
        entries = pieces[k["slug"]]["inserted"][k["condition"]]
        rules, problems = collect.join_rules(passages[k["item"]], k["inserted_ids"], entries)
        assert problems == [], (k["item"], problems)
        assert set(rules) == set(k["inserted_ids"])
        n += len(rules)
    assert n > 0


# ---- score --------------------------------------------------------------------------------------

def judged(item, slug, cond, scores, verdict="natural", objections=(), inserted=(), rules=None,
           notes_r=10, notes_l=4, batch="b"):
    return {"item": item, "batch": batch, "slug": slug, "title": slug, "n": 1, "condition": cond,
            "scores": dict(zip(collect.CRITERIA, scores)), "verdict": verdict,
            "objections": [{"notes": o[0], "kind": o[1], "severity": o[2], "problem": ""} for o in objections],
            "inserted_ids": list(inserted), "inserted_rules": rules or {i: "passing" for i in inserted},
            "notes_R": notes_r, "notes_L": notes_l}


def test_objection_classes():
    ins = {"R2", "R4"}
    assert score.classify(["R2"], ins) == "inserted_only"
    assert score.classify(["R2", "L1"], ins) == "inserted_only"
    assert score.classify(["R1", "R2"], ins) == "mixed"
    assert score.classify(["R1", "L1"], ins) == "original_only"
    assert score.classify(["L1", "L2"], ins) == "left_only"


def test_sign_test_is_exact_and_two_sided():
    assert score.sign_test(0, 0) == 1.0
    assert score.sign_test(5, 0) == pytest.approx(2 / 32)
    assert score.sign_test(0, 5) == pytest.approx(2 / 32)
    assert score.sign_test(3, 3) == 1.0
    assert score.sign_test(9, 1) == pytest.approx(2 * 11 / 1024)


def test_condition_summary_means_verdicts_and_rates():
    items = [
        judged("a", "p1", "plain", (3, 3, 3)),
        judged("b", "p1", "light", (3, 2, 2), "acceptable", [(["R2"], "clash", "warning")], ["R2"]),
        judged("c", "p1", "playful", (1, 2, 1), "awkward",
               [(["R1", "R2"], "clutter", "warning"), (["R5"], "phrase", "info"), (["L1"], "rhythm", "info")],
               ["R2", "R3"], {"R2": "passing", "R3": "neighbour-long"}),
        judged("d", "p2", "plain", (2, 3, 3), "acceptable", [(["R1"], "repetitive", "info")]),
    ]
    s = score.summarise(items)
    c = s["conditions"]
    assert c["plain"]["n"] == 2 and c["plain"]["means"]["musical"] == pytest.approx(2.5)
    assert c["plain"]["verdicts"] == {"natural": 1, "acceptable": 1, "awkward": 0, "wrong": 0}
    assert c["plain"]["natural_or_acceptable"] == 2
    assert c["plain"]["per_100_notes"]["total"] == pytest.approx(100 * 1 / 28)
    pl = c["playful"]
    assert pl["classes"] == {"inserted_only": 0, "mixed": 1, "original_only": 1, "left_only": 1}
    assert pl["hits"] == 1 and pl["false_positives"] == 1
    assert pl["per_100_notes"]["kind"]["clutter"] == pytest.approx(100 / 14)
    assert pl["per_100_notes"]["severity"]["info"] == pytest.approx(200 / 14)
    # per note, right hand: inserted R2 named, R3 not -> 1/2; originals R1, R5 named of 8 -> 2/8
    assert pl["notes"]["inserted_named"] == 1 and pl["notes"]["inserted"] == 2
    assert pl["notes"]["original_named"] == 2 and pl["notes"]["original"] == 8
    assert pl["notes_warning"]["inserted_named"] == 1 and pl["notes_warning"]["original_named"] == 1
    assert c["light"]["hits"] == 1 and c["light"]["false_positives"] == 0


def test_rules_are_counted_against_their_exposure():
    items = [
        judged("c", "p1", "playful", (1, 2, 1), "awkward",
               [(["R2"], "clutter", "warning"), (["R3"], "phrase", "info")],
               ["R2", "R3", "R4"], {"R2": "passing", "R3": "neighbour-long", "R4": "passing"}),
    ]
    r = score.summarise(items)["rules"]["all"]
    assert r["passing"] == {"inserted": 2, "named": 1, "named_warning": 1}
    assert r["neighbour-long"] == {"inserted": 1, "named": 1, "named_warning": 0}


def test_per_piece_best_condition_and_paired_comparison():
    items = []
    for k, (p, l, y) in enumerate([(9, 8, 5), (9, 9, 6), (8, 9, 7), (9, 7, 9)]):
        slug = f"p{k}"
        for cond, total in (("plain", p), ("light", l), ("playful", y)):
            items.append(judged(f"{slug}{cond}", slug, cond, (3, 3, total - 6)))
    s = score.summarise(items)
    best = {row["slug"]: row["best"] for row in s["pieces"]}
    assert best == {"p0": ["plain"], "p1": ["plain", "light"], "p2": ["light"], "p3": ["plain", "playful"]}
    pv = s["paired"]["plain vs light"]
    assert (pv["wins"], pv["ties"], pv["losses"]) == (2, 1, 1)
    assert pv["p"] == pytest.approx(1.0)
    py = s["paired"]["plain vs playful"]
    assert (py["wins"], py["ties"], py["losses"]) == (3, 1, 0)
    assert py["mean_diff"] == pytest.approx((4 + 3 + 1 + 0) / 4)


def test_markdown_has_the_tables():
    items = [judged("a", "p1", "plain", (3, 3, 3)),
             judged("b", "p1", "light", (3, 2, 2), "acceptable", [(["R2"], "clash", "warning")], ["R2"]),
             judged("c", "p1", "playful", (1, 2, 1), "awkward", [(["R2"], "clutter", "warning")], ["R2"])]
    md = score.to_markdown(score.summarise(items))
    for heading in ("Mean scores", "Verdicts", "Objections per 100 notes", "Hits", "Per note", "Rules",
                    "Per piece", "Paired"):
        assert heading in md, heading
