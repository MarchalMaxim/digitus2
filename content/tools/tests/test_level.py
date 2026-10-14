"""level.py: a documented, testable level proposal calibrated on the 30 labelled pieces (L1 plan, decision 5)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
CONTENT = TOOLS.parent
sys.path.insert(0, str(TOOLS))
import level  # noqa: E402

MANIFEST = json.loads((CONTENT / "manifest.json").read_text(encoding="utf-8"))
CORE = [e for e in MANIFEST if e["benchmarkSet"] == "core30"]


def rows():
    return [(e["level"], level.score(level.features(CONTENT / e["files"]["score"], e["tempoBpm"]))) for e in CORE]


def test_reproduces_the_labelled_levels_within_one():
    r = rows()
    within = sum(abs(level.propose(s) - lvl) <= 1 for lvl, s in r)
    exact = sum(level.propose(s) == lvl for lvl, s in r)
    assert len(r) == 30 and within >= 27, (within, exact)


def test_frozen_cuts_are_the_fit():
    assert tuple(round(c, 2) for c in level.calibrate(rows())) == level.CUTS


def test_leave_one_out_generalises():
    within, exact = level.leave_one_out(rows())
    assert within >= 25, (within, exact)


def test_features_of_twinkle():
    f = level.features(CONTENT / "scores" / "twinkle-twinkle-little-star.musicxml", 100)
    assert (f["span"], f["chord"], f["fifths"], f["accidentals"], f["leaps"]) == (0, 0, 0, 0, 0)
    assert f["nps"] == pytest.approx(2.22, abs=0.01) and f["seconds"] == pytest.approx(28.8)
    assert level.propose(level.score(f)) == 1


@pytest.mark.parametrize("name", ["nps", "shifts", "span", "chord", "fifths", "accidentals", "seconds", "leaps"])
def test_score_grows_with_every_feature(name):
    base = {"nps": 3, "shifts": 20, "span": 9, "chord": 0.2, "fifths": 1, "accidentals": 3, "seconds": 60, "leaps": 2}
    assert level.score({**base, name: base[name] * 2}) > level.score(base)


def test_proposals_are_recorded_for_every_piece():
    ver = json.loads((CONTENT / "verification.json").read_text(encoding="utf-8"))
    for e in MANIFEST:
        lp = ver[e["slug"]]["levelProposal"]
        assert lp["level"] == level.propose(lp["score"]), e["slug"]
