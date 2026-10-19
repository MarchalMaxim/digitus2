"""The owner's relaxation for the four composers the library was asked to grow (issue #80, 2026-10-19): an archive
piece by Liszt, Tchaikovsky, Rachmaninoff or Prokofiev may be advanced at proposal 4 without the score floor, with
sustained fast notes from 4 a second, and under a ceiling of 60 law errors and 30 slices per 1,000 notes. Every other
composer keeps the archive rule, and a proposal of 3 or below never qualifies, so no beginner piece is advanced."""

from __future__ import annotations

import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

import pdmx_advanced as pa  # noqa: E402


def level(proposal: int, score: float, nps: float = 5.0, seconds: float = 120.0, span: float = 14.0) -> dict:
    return {"level": proposal, "score": score,
            "features": {"nps": nps, "seconds": seconds, "span": span, "chord": 0.0}}


def test_a_requested_proposal_four_below_the_score_floor_is_advanced():
    assert pa.advanced(level(4, 9.0), 400, requested=True)
    assert not pa.advanced(level(4, 9.0), 400)


def test_a_requested_piece_at_proposal_three_is_never_advanced():
    assert not pa.advanced(level(3, 12.0), 400, requested=True)


def test_the_requested_fast_notes_floor_is_four_a_second():
    assert pa.advanced(level(4, 11.0, nps=4.5), 400, requested=True)
    assert not pa.advanced(level(4, 11.0, nps=4.5), 400)  # the archive rule keeps 6 a second


def test_the_requested_ceiling_is_sixty_law_errors_and_thirty_slices_per_thousand_notes():
    facts = {"spans": 25, "lint": {"medium": 55, "large": 50}}
    assert pa.within_ceiling(facts, 1000, requested=True)
    assert not pa.within_ceiling(facts, 1000)  # 55 is over the archive's 40
    assert not pa.within_ceiling({"spans": 31, "lint": {"medium": 10, "large": 10}}, 1000, requested=True)


def test_usable_lets_a_requested_piece_through_the_relaxed_gates_only_when_requested():
    gate = {"ok": False, "reasons": ["55 lint law error(s) at medium"], "spanFlags": 25,
            "level": level(4, 9.0),
            "lint": {"medium": {"errors": 55, "notes": 1000}, "large": {"errors": 50, "notes": 1000}}}
    assert pa.usable(gate, 1000, requested=True)
    assert not pa.usable(gate, 1000)


def test_the_four_composers_are_requested_and_the_others_are_not():
    for name in ("Franz Liszt", "Pyotr Ilyich Tchaikovsky", "Tschaikowsky", "Sergei Rachmaninoff",
                 "Rachmaninov", "Sergei Prokofiev", "Prokofieff"):
        assert pa.requested(name), name
    for name in ("Frederic Chopin", "Johann Sebastian Bach", "Unknown", "NA", "", None):
        assert not pa.requested(name), name
