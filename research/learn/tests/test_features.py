"""Rule-term port checks (the expectations mirror packages/engine/src/fingering/rules.test.ts
and the M3 plan's Task 1 tests) and the dot-product identity."""
import json
from pathlib import Path

import numpy as np
import pytest

from learn.corpus import piece_from_files
from learn.decoder import solve_full, solve_hand
from learn.features import (
    FAMILY_IDS, FAMILY_ORDER, PARNCUTT_WEIGHTS, FeatureSet, build_tensors, costs, pair_terms,
    path_features, span, tables_for_profile, triple_terms, unary_terms, x14,
)
from learn.sequence import InputNote, SeqNote, build_hand_sequence, is_black

ROOT = Path(__file__).resolve().parents[3]
PIG = ROOT / "research" / "data" / "pig" / "FingeringFiles"


def note(pitch: int, slc: int, ioi: float = 0.5, rest: bool = False) -> SeqNote:
    return SeqNote(0, str(slc), pitch, pitch, is_black(pitch), slc * ioi, slc * ioi + ioi, slc, rest, ioi, False)


def points(terms, rule):
    return sum(p for r, p in terms if r == rule)


FULL = FeatureSet(FAMILY_ORDER)
RULES = FeatureSet(["rules"])


def test_parncutt_weights_match_the_engine_file():
    f = ROOT / "packages" / "engine" / "src" / "fingering" / "params" / "weights-parncutt.json"
    if not f.exists():
        pytest.skip("engine weights file missing")
    w = json.loads(f.read_text(encoding="utf-8"))["weights"]
    assert w == PARNCUTT_WEIGHTS


def test_span_tables():
    t = tables_for_profile("large")
    assert span(t, "maxComf", 1, 2) == 8
    assert span(t, "minComf", 1, 2) == -3
    assert span(t, "maxPrac", 1, 5) == 15
    assert span(t, "minRel", 2, 3) == 1  # -maxRel[3][2] = -(-1)
    small = tables_for_profile("small")
    assert small["maxComf"][0][1] == 6  # round(8 * 0.8)


def test_unary_terms():
    ctx = RULES.ctx
    assert points(unary_terms(ctx, note(60, 0), 4, None, None), "weakFinger") == 1
    assert points(unary_terms(ctx, note(60, 0), 5, None, None), "weakFifth") == 1
    # thumb on a black key between two white neighbours: 1 + 2 + 2
    assert points(unary_terms(ctx, note(61, 1), 1, note(60, 0), note(62, 2)), "thumbOnBlack") == 5
    assert points(unary_terms(ctx, note(61, 1), 1, None, note(63, 2)), "thumbOnBlack") == 1
    assert points(unary_terms(ctx, note(61, 1), 5, note(60, 0), None), "fiveOnBlack") == 2
    full = FULL.ctx
    assert points(unary_terms(full, note(61, 0), 2, None, None), "on:2:black") == 1
    assert points(unary_terms(full, note(60, 0), 5, None, None), "on:5:white") == 1


def test_pair_terms_melodic_and_chord():
    ctx = RULES.ctx
    # C4 -> C5 with 1-2: 12 semitones against maxComf(1,2) = 8 -> stretch 4, largeSpan 7 (theta 1)
    t = pair_terms(ctx, note(60, 0), 1, note(72, 1), 2)
    assert points(t, "stretch") == 4
    assert points(t, "largeSpan") == 7
    assert points(t, "beyondPractical") == 2  # 12 - maxPrac(1,2) = 10
    assert points(t, "handPositionShift") == abs((x14(72) / 2 - 1) - (x14(60) / 2 - 0))
    # hop: same finger, different slices
    assert points(pair_terms(ctx, note(60, 0), 2, note(64, 1, 0.1), 2), "hop") == 2
    assert points(pair_terms(ctx, note(60, 0), 2, note(64, 1, 0.5), 2), "hop") == 0.5
    assert points(pair_terms(ctx, note(60, 0), 2, note(64, 1, 0.5, True), 2), "hop") == 0
    # repeated notes
    assert points(pair_terms(ctx, note(60, 0), 3, note(60, 1, 0.1), 3), "repeatedNoteSameFinger") == 2
    assert points(pair_terms(ctx, note(60, 0), 3, note(60, 1, 0.5), 2), "repeatedNoteFingerChange") == 1
    # three-to-four and four on black
    assert points(pair_terms(ctx, note(60, 0), 3, note(62, 1), 4), "threeToFour") == 1
    assert points(pair_terms(ctx, note(60, 0), 3, note(61, 1), 4), "fourOnBlack") == 1
    assert points(pair_terms(ctx, note(61, 0), 4, note(60, 1), 3), "fourOnBlack") == 1
    # thumb passing: 3 then 1 going up (thumb under); white to white -> 1 point
    assert points(pair_terms(ctx, note(64, 0), 3, note(65, 1), 1), "thumbPassing") == 1
    # white lower (finger 2), black upper with the thumb -> 3 points
    assert points(pair_terms(ctx, note(60, 0), 2, note(61, 1), 1), "thumbPassing") == 3
    # chord pair: doubled span terms, theta 2 for non-thumb pairs
    c = pair_terms(ctx, note(60, 0), 2, note(72, 0), 3)
    assert points(c, "chordStretch") == 12 - 3
    assert points(c, "chordLargeSpan") == 2 * (12 - 2)
    assert points(c, "chordBeyondPractical") == 12 - 5
    assert points(c, "stretch") == 0


def test_new_pair_families():
    ctx = FULL.ctx
    assert points(pair_terms(ctx, note(60, 0), 1, note(64, 1), 3), "tr:13:up") == 1
    assert points(pair_terms(ctx, note(64, 0), 3, note(60, 1), 1), "tr:31:down") == 1
    assert points(pair_terms(ctx, note(60, 0), 1, note(60, 1), 1), "tr:11:up") == 0
    assert points(pair_terms(ctx, note(60, 0), 1, note(64, 0), 3), "tr:13:up") == 0
    assert points(pair_terms(ctx, note(60, 0), 1, note(64, 0), 3), "ch:13") == 1
    assert points(pair_terms(ctx, note(60, 0), 1, note(64, 1), 3), "latticeStep") == 0
    assert points(pair_terms(ctx, note(60, 0), 1, note(64, 1), 2), "latticeStep") == 1
    assert points(pair_terms(ctx, note(60, 0), 1, note(61, 1), 2), "levelChange") == 1
    assert points(pair_terms(ctx, note(60, 0), 1, note(62, 1), 2), "levelChange") == 0
    slow = pair_terms(ctx, note(60, 0), 1, note(72, 1, 1.0), 2)
    fast = pair_terms(ctx, note(60, 0), 1, note(72, 1, 0.1), 2)
    assert points(slow, "stretchFast") == 0
    assert points(fast, "stretchFast") == points(fast, "stretch")
    assert points(fast, "shiftFast") == pytest.approx(points(fast, "handPositionShift"))
    assert points(slow, "shiftFast") == pytest.approx(points(slow, "handPositionShift") * 0.25)
    assert points(pair_terms(ctx, note(60, 0), 1, note(60, 1, 0.1), 2), "repeatFast") == 1
    assert points(pair_terms(ctx, note(60, 0), 1, note(60, 1, 0.5), 2), "repeatFast") == 0
    rest = pair_terms(ctx, note(60, 0), 1, note(72, 1, 1.0, True), 2)
    assert points(rest, "restRelax:stretch") == points(rest, "stretch") == 4
    assert points(slow, "restRelax:stretch") == 0
    assert points(pair_terms(ctx, note(60, 0), 1, note(64, 1), 3), "tr:13:up:white") == 1
    assert points(pair_terms(ctx, note(60, 0), 1, note(63, 1), 3), "tr:13:up:black") == 1
    assert points(pair_terms(ctx, note(60, 0), 1, note(64, 1), 3), "lb:13:4") == 1
    assert points(pair_terms(ctx, note(60, 0), 1, note(62, 1), 2), "cm:12:up") == pytest.approx(2.35)
    assert points(pair_terms(ctx, note(60, 0), 1, note(62, 1), 2), "fitts") == pytest.approx(0.0)


def test_triple_terms():
    ctx = RULES.ctx
    # position change: C4 (1) E4 (2) C5 (5): 12 semitones with 1-5 is within comfort (13) -> none
    assert triple_terms(ctx, note(60, 0), 1, note(64, 1), 2, note(72, 2), 5) == []
    # C4 (1) D4 (2) D5 (2): i13 = 14 with 1-2 beyond maxComf 8 -> count 1, size 6
    t = triple_terms(ctx, note(60, 0), 1, note(62, 1), 2, note(74, 2), 2)
    assert points(t, "positionChangeCount") == 1
    assert points(t, "positionChangeSize") == 6
    # thumb in between and beyond practical -> count 2
    t = triple_terms(ctx, note(60, 0), 2, note(64, 1), 1, note(79, 2), 3)
    assert points(t, "positionChangeCount") == 2
    assert points(triple_terms(ctx, note(60, 0), 3, note(62, 1), 4, note(64, 2), 5), "threeFourFive") == 1
    assert points(triple_terms(ctx, note(60, 0), 5, note(62, 1), 4, note(64, 2), 3), "threeFourFive") == 1
    assert points(triple_terms(ctx, note(60, 0), 3, note(62, 1), 1, note(64, 2), 3), "sameFingerPivot") == 1
    assert points(triple_terms(ctx, note(60, 0), 3, note(62, 1), 1, note(60, 2), 3), "sameFingerPivot") == 0
    # same slice anywhere -> nothing
    assert triple_terms(ctx, note(60, 0), 1, note(64, 0), 2, note(79, 1), 3) == []


def test_hand_sequence_conventions():
    notes = [
        InputNote("0", 0.0, 0.5, 60, "R"), InputNote("1", 0.0, 0.5, 64, "R"),
        InputNote("2", 0.5, 1.0, 67, "R"), InputNote("3", 1.6, 2.0, 72, "R"),
        InputNote("4", 0.0, 0.5, 48, "L"), InputNote("5", 0.0, 0.5, 52, "L"),
    ]
    r = build_hand_sequence(notes, "R")
    assert [n.pitch for n in r] == [60, 64, 67, 72]
    assert [n.slice for n in r] == [0, 0, 1, 2]
    assert [round(n.ioi, 3) for n in r] == [0, 0, 0.5, 1.1]
    assert [n.rest_before for n in r] == [False, False, False, True]
    left = build_hand_sequence(notes, "L")
    assert [n.midi for n in left] == [52, 48]  # arpeggiated order: mirrored pitch ascending
    assert [n.pitch for n in left] == [72, 76]


def test_family_ids_are_unique_and_counted():
    ids = [i for fam in FAMILY_ORDER for i in FAMILY_IDS[fam]]
    assert len(ids) == len(set(ids))
    assert len(FAMILY_IDS["trans"]) == 50 and len(FAMILY_IDS["chord"]) == 10
    assert len(FAMILY_IDS["colour"]) == 10 and len(FAMILY_IDS["trColour"]) == 100
    assert len(FAMILY_IDS["latticeBins"]) == 725


@pytest.mark.skipif(not PIG.exists(), reason="PIG data missing")
def test_dot_product_identity_on_pig_pieces():
    from fingering_eval.pig_io import read_pig

    for pid in ("064", "101"):
        piece = piece_from_files("pig", pid, {"1": read_pig(PIG / f"{pid}-1_fingering.txt")})
        for ex in piece.examples():
            for fs in (RULES, FULL):
                t = ex.tensors(fs)
                w = fs.parncutt_weights()
                fingers, cost = solve_hand(t, w)
                assert np.isfinite(cost)
                assert w @ path_features(t, fingers, fs.n) == pytest.approx(cost, abs=1e-9)
                worse = fingers.copy()
                worse[3::7] = (worse[3::7] % 5) + 1
                assert w @ path_features(t, worse, fs.n) >= cost - 1e-9
            # the family projection of the full tensors equals a direct build
            direct = build_tensors(ex.seq, RULES, ex.hand)
            w = RULES.parncutt_weights()
            f1, c1 = solve_hand(ex.tensors(RULES), w)
            f2, c2 = solve_hand(direct, w)
            assert c1 == pytest.approx(c2) and (f1 == f2).all()
            # the learned-feature set with zero new weights decodes exactly like the rules
            wf = FULL.parncutt_weights()
            f3, c3 = solve_hand(ex.tensors(FULL), wf)
            assert c3 == pytest.approx(c1) and (f3 == f1).all()
            full_fingers, full_cost, _, _ = solve_full(ex.seq, ex.tensors(FULL), wf)
            assert np.isfinite(full_cost)
