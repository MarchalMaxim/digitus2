"""Musical details from the source engravings that MIDI comparisons cannot verify."""
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest

SCORES = Path(__file__).resolve().parents[2] / "scores"


@pytest.mark.parametrize("slug,bar,expected", [
    ("bach-minuet-b-flat-major-bwv-anh-118", "26", [
        ("1", False, "B", "-1", "4", "half", True, "upright"),
        ("2", False, "B", "-1", "2", "half", True, "inverted"),
    ]),
    ("bach-invention-no6-bwv-777", "62", [
        ("1", True, None, None, None, "eighth", False, "upright"),
        ("2", False, "E", None, "3", "eighth", False, "inverted"),
    ]),
])
def test_terminal_fermatas_match_the_source_engraving(slug, bar, expected):
    # Mutopia 1014 and 159 draw these as rehearsal-mark glyphs. They must survive
    # conversion on the correct note/rest, staff and side, not become plain text.
    tree = ET.parse(SCORES / f"{slug}.musicxml")
    last = tree.findall("./part/measure")[-1]
    assert last.get("number") == bar
    assert len(tree.findall(".//fermata")) == 2
    actual = []
    for note in last.findall("note"):
        fermata = note.find("notations/fermata")
        if fermata is not None:
            actual.append((
                note.findtext("staff"), note.find("rest") is not None,
                note.findtext("pitch/step"), note.findtext("pitch/alter"),
                note.findtext("pitch/octave"), note.findtext("type"),
                note.find("dot") is not None, fermata.get("type"),
            ))
    assert actual == expected
