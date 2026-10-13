"""Tests for the own arrangements (tools/arrange.py).

Reference melodies were checked against the LilyPond snippets in the English
Wikipedia articles (retrieved 2026-10-13) and are encoded here as MIDI pitch
sequences of the sung melody.
"""
from __future__ import annotations

import json
import sys
from fractions import Fraction as F
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import arrange  # noqa: E402
from music21 import pitch  # noqa: E402

CATALOG = {p["slug"]: p for p in json.loads((TOOLS / "catalog.json").read_text(encoding="utf-8"))["pieces"]}


def melody(slug: str) -> list[int]:
    """Top-voice MIDI pitches of the right hand (rests skipped)."""
    out = []
    for bar in arrange.parse(arrange.PIECES[slug]["rh"]):
        for e in bar:
            if e["pitches"]:
                out.append(max(pitch.Pitch(p).midi for p in e["pitches"]))
    return out


def intervals(seq: list[int]) -> list[int]:
    return [b - a for a, b in zip(seq, seq[1:])]


REFERENCES = {
    # Wikipedia "Twinkle, Twinkle, Little Star" (C major)
    "twinkle-twinkle-little-star": [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60,
                                    67, 67, 65, 65, 64, 64, 62, 67, 67, 65, 65, 64, 64, 62,
                                    60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60],
    # Wikipedia "Frère Jacques" (F major there; compared by intervals)
    "frere-jacques": [65, 67, 69, 65] * 2 + [69, 70, 72] * 2 + [72, 74, 72, 70, 69, 65] * 2 + [65, 60, 65] * 2,
    # Wikipedia "Happy Birthday to You" (G major)
    "happy-birthday": [62, 62, 64, 62, 67, 66, 62, 62, 64, 62, 69, 67, 62, 62, 74, 71, 67, 66, 64,
                       72, 72, 71, 67, 69, 67],
    # Wikipedia "Amazing Grace" (G major, 'New Britain')
    "amazing-grace": [62, 67, 71, 67, 71, 69, 67, 64, 62, 62, 67, 71, 67, 71, 69, 74, 71, 74, 71, 74, 71,
                      67, 62, 64, 67, 67, 64, 62, 62, 67, 71, 67, 71, 69, 67],
    # Wikipedia "Scarborough Fair (ballad)", 'version commonly used today' (D dorian)
    "scarborough-fair": [62, 62, 69, 69, 69, 64, 65, 64, 62, 69, 72, 74, 72, 69, 71, 67, 69, 74,
                         74, 74, 72, 69, 69, 67, 65, 64, 62, 69, 67, 65, 64, 62, 60, 62],
}


@pytest.mark.parametrize("slug", sorted(REFERENCES))
def test_melody_matches_reference(slug):
    ref = REFERENCES[slug]
    got = melody(slug)
    if slug == "frere-jacques":  # transposed: compare the interval sequence
        assert intervals(got) == intervals(ref)
    else:
        assert got == ref


def test_well_known_melodies():
    # not on Wikipedia as notation; standard versions written out by hand
    mary = [64, 62, 60, 62, 64, 64, 64, 62, 62, 62, 64, 67, 67, 64, 62, 60, 62, 64, 64, 64, 64, 62, 62, 64, 62, 60]
    assert melody("mary-had-a-little-lamb") == mary
    jingle_chorus_start = [64, 64, 64, 64, 64, 64, 64, 67, 60, 62, 64]
    assert melody("jingle-bells")[:11] == jingle_chorus_start
    ode_start = [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62]
    assert melody("ode-to-joy")[:15] == ode_start
    greensleeves_start = [69, 72, 74, 76, 77, 76, 74, 71, 67, 69, 71, 72, 69, 69, 68, 69, 71, 68, 64]
    assert melody("greensleeves")[:19] == greensleeves_start
    # Pachelbel: the first-violin line over the ground bass D A B F# G D G A
    assert melody("pachelbel-canon-in-d")[:8] == [78, 76, 74, 73, 71, 69, 71, 73]
    bass = [max(pitch.Pitch(p).midi for p in e["pitches"])
            for bar in arrange.parse(arrange.PIECES["pachelbel-canon-in-d"]["lh"]) for e in bar if e["pitches"]]
    assert [b % 12 for b in bass[:8]] == [2, 9, 11, 6, 7, 2, 7, 9]


@pytest.mark.parametrize("slug", sorted(arrange.PIECES))
def test_bars_are_complete_and_hands_aligned(slug):
    spec = arrange.PIECES[slug]
    num, den = (int(x) for x in spec["time"].split("/"))
    bar = F(num * 4, den)
    pickup = F(spec["pickup"]) * 4 if spec.get("pickup") else None
    lengths = {}
    for hand in ("rh", "lh"):
        bars = arrange.parse(spec[hand])
        lengths[hand] = len(bars)
        for i, events in enumerate(bars):
            total = sum((e["ql"] for e in events), F(0))
            assert total == (pickup if (pickup and i == 0) else bar), (hand, i)
    assert lengths["rh"] == lengths["lh"]


@pytest.mark.parametrize("slug", ["twinkle-twinkle-little-star", "mary-had-a-little-lamb", "ode-to-joy",
                                  "jingle-bells"])
def test_level_one_pieces_stay_near_c_position(slug):
    assert CATALOG[slug]["level"] == 1
    rh = melody(slug)
    assert min(rh) >= 60 and max(rh) <= 69  # C4..A4 (A4 = small stretch)
    lh = [pitch.Pitch(p).midi for bar in arrange.parse(arrange.PIECES[slug]["lh"]) for e in bar if e["pitches"]
          for p in e["pitches"]]
    assert min(lh) >= 48 and max(lh) <= 55  # C3..G3


def test_output_is_deterministic():
    slug = "greensleeves"
    a = arrange.build(slug, CATALOG[slug])
    b = arrange.build(slug, CATALOG[slug])
    assert a == b
    assert b'id="P1"' in a and b"<staves>2</staves>" in a
