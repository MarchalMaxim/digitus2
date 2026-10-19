"""The Mutopia rule for releasing held bulk editions at level 6 (mutopia_advanced.py)."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import mutopia_advanced as M  # noqa: E402

BULK = json.loads((TOOLS / "catalog.d/expansion-bulk.json").read_text(encoding="utf-8"))
SHIPPED = {p["slug"]: p for p in BULK["pieces"]}
HELD = {p["slug"]: p for p in BULK["rejected"]}


def only_span_or_lint(reason: str) -> bool:
    parts = re.split(r"; (?=[A-Za-z0-9])", reason)
    return all(p.startswith("span flags") or re.match(r"\d+ lint law error", p) for p in parts)


def test_the_rule_places_each_of_the_66_editions_once():
    assert not set(M.CONCERT) & set(M.KEPT)
    assert len(M.CONCERT) + len(M.KEPT) == 66
    assert set(M.CONCERT.values()) <= set(M.CONCERT_CATEGORIES)
    assert set(M.KEPT.values()) <= set(M.CATEGORIES) - set(M.CONCERT_CATEGORIES)
    # every edition still held only for the span or lint gate has a place in the rule
    assert {s for s, p in HELD.items() if only_span_or_lint(p["reason"])} <= set(M.CONCERT) | set(M.KEPT)


def test_kept_editions_stay_held_and_released_ones_come_from_the_concert_list():
    assert set(M.KEPT) <= set(HELD)
    assert set(M.CONCERT) <= set(HELD) | set(SHIPPED)
    released = {s for s, p in SHIPPED.items() if p.get("relaxedGates")}
    assert released <= set(M.CONCERT)
    for slug in released:
        piece = SHIPPED[slug]
        assert piece["level"] == 6 and piece["levelNote"].startswith("Advanced by the Mutopia rule")
        assert "syllabus" in piece["levelNote"] and "No syllabus placement is claimed" in piece["levelNote"]


def test_a_concert_edition_still_held_says_why():
    for slug in set(M.CONCERT) & set(HELD):
        reason = HELD[slug]["reason"]
        assert "Mutopia rule" in reason or not only_span_or_lint(reason), (slug, reason)


def test_problems_name_a_piece_outside_the_concert_list():
    assert M.problems(next(iter(M.CONCERT))) == []
    assert any("concert list" in p for p in M.problems("bulk-not-on-the-list"))


def test_level_note_claims_no_syllabus_placement():
    slug = next(iter(M.CONCERT))
    note = M.level_note(slug, 3, 95.4, 812)
    assert "proposes 3" in note and "95 seconds, 812 notes" in note and "No syllabus placement is claimed" in note
