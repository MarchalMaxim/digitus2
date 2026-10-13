"""Regression test for the LilyPond -> MusicXML converter (needs the `lilypond` wheel)."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import ly2musicxml as L  # noqa: E402
import validate  # noqa: E402
import xmlcheck as xc  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "features.ly"


@pytest.fixture(scope="module")
def converted(tmp_path_factory):
    d = tmp_path_factory.mktemp("features")
    res = L.compile_lilypond([FIXTURE], FIXTURE.name, d / "build")
    stripped, warns = L.convert_dump(res["dump"], 1, L.Options(title="Features", midi_tempo=100))
    fingered, _ = L.convert_dump(res["dump"], 1, L.Options(title="Features", include_fingering=True))
    (d / "features.musicxml").write_bytes(stripped)
    (d / "features.fingered.musicxml").write_bytes(fingered)
    return d, res, warns


def test_validates(converted):
    d, _, _ = converted
    for name in ("features.musicxml", "features.fingered.musicxml"):
        r = validate.check_file(d / name, None)
        assert r["ok"], r["errors"]


def test_notes_match_lilypond_midi(converted):
    d, res, _ = converted
    xs = xc.parse_musicxml(d / "features.musicxml")
    r = xc.best_midi_match(xs, res["midi"][0])
    assert r["exact"], r


def test_structure(converted):
    d, _, _ = converted
    root = ET.parse(d / "features.musicxml").getroot()
    measures = root.find("part").findall("measure")
    numbers = [m.get("number") for m in measures]
    assert numbers[0] == "0" and measures[0].get("implicit") == "yes"  # pickup
    assert any(n.endswith("a") for n in numbers)  # bar split by the mid-bar repeat sign
    assert root.find(".//staves").text == "2"
    assert len(root.findall("part")) == 1
    xml = ET.tostring(root, encoding="unicode")
    for needle in ('<grace slash="yes"', '<tuplet type="start"', "<actual-notes>3</actual-notes>",
                   '<tie type="start"', '<slur type="start"', '<wedge type="crescendo"', "<staccato",
                   '<ending number="1" type="start"', '<ending number="2" type="start"',
                   '<repeat direction="backward"', '<repeat direction="forward"', "<sign>G</sign>",
                   "<p />", "<f />", '<sound tempo="100"'):
        assert needle in xml, needle
    assert "<fingering" not in xml
    # two voices with explicit stems in bar 3
    bar3 = measures[3]
    voices = {n.findtext("voice") for n in bar3.findall("note")}
    assert {"1", "2"} <= voices
    # mid-measure clef change in the left hand (treble, then back to bass)
    clefs = [c.findtext("sign") for c in root.iter("clef") if c.get("number") == "2"]
    assert clefs[:3] == ["F", "G", "F"]


def test_fingered_copy_keeps_editorial_fingering(converted):
    d, _, _ = converted
    root = ET.parse(d / "features.fingered.musicxml").getroot()
    digits = [f.text for f in root.iter("fingering")]
    assert digits == ["3", "1", "1", "3"]
