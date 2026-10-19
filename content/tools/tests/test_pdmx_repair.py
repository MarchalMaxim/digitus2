"""Repairs for archive scores the build refused (issue #80). A voice that runs past its bar by a rounding of
tuplet durations is repaired by shortening one note; a backup that reaches before the bar start by a
rounding is repaired by one rest. Every pitch and onset stays where it was, every change is within
`pdmx_repair.TOLERANCE` of a quarter, and the repaired score is checked again."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
CONTENT = TOOLS.parent
sys.path.insert(0, str(TOOLS))

import pdmx_repair as pr  # noqa: E402


def score(*measures: str, divisions: int = 480, beats: int = 4, beat_type: int = 4) -> bytes:
    """A one-part score. The first bar carries the attributes."""
    attrs = (f"<attributes><divisions>{divisions}</divisions><key><fifths>0</fifths></key>"
             f"<time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time>"
             "<staves>2</staves></attributes>")
    body = "".join(f"<measure number=\"{i + 1}\">{attrs if i == 0 else ''}{m}</measure>"
                   for i, m in enumerate(measures))
    return (f"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<score-partwise version=\"4.0\">"
            f"<part-list><score-part id=\"P1\"/></part-list><part id=\"P1\">{body}</part></score-partwise>").encode()


def note(pitch: str = "C4", dur: int = 480, voice: int = 1, staff: int = 1, chord: bool = False) -> str:
    step, octave = pitch[0], pitch[-1]
    return (f"<note>{'<chord/>' if chord else ''}<pitch><step>{step}</step><octave>{octave}</octave></pitch>"
            f"<duration>{dur}</duration><voice>{voice}</voice><staff>{staff}</staff></note>")


def rest(dur: int, voice: int = 1, staff: int = 1) -> str:
    return f"<note><rest/><duration>{dur}</duration><voice>{voice}</voice><staff>{staff}</staff></note>"


def backup(dur: int) -> str:
    return f"<backup><duration>{dur}</duration></backup>"


def test_a_voice_past_its_bar_by_a_rounding_is_shortened_and_nothing_else_moves():
    # 4/4 at 480 divisions: the voice lasts 1929 ticks, nine past the bar (3/160 of a quarter)
    original = score(note("C4", 480) * 3 + note("D4", 489))
    repaired, record = pr.repair(original)
    assert record["trims"] == [{"measure": "1", "voice": "1", "staff": "1", "ticks": 9}]
    assert record["pads"] == []
    assert pr.verify_content(original, repaired) == []
    assert repaired != original


def test_a_backup_short_of_its_bar_gets_one_rest_before_it_and_the_second_staff_keeps_its_onsets():
    # the voice reaches 1919 ticks, so the backup to the bar start (1920) would run before the bar
    original = score(note("C4", 480) * 3 + note("D4", 479) + backup(1920) + note("G3", 1920, voice=5, staff=2))
    repaired, record = pr.repair(original)
    assert record["pads"] == [{"measure": "1", "voice": "1", "staff": "1", "ticks": 1}]
    assert record["trims"] == []
    assert b"<rest/><duration>1</duration>" in repaired
    assert pr.verify_content(original, repaired) == []


def test_a_defect_above_the_tolerance_is_refused():
    # half a quarter past the bar is not a rounding: the repair does not touch it
    original = score(note("C4", 480) * 3 + note("D4", 720))
    with pytest.raises(pr.RepairRefused):
        pr.repair(original)


def test_a_score_without_defects_comes_back_as_the_same_bytes():
    clean = score(note("C4", 480) * 4)
    repaired, record = pr.repair(clean)
    assert repaired is clean
    assert record == {"trims": [], "pads": []}


def test_the_content_check_catches_a_changed_pitch():
    original = score(note("C4", 480) * 3 + note("D4", 489))
    repaired, _ = pr.repair(original)
    tampered = repaired.replace(b"<step>D</step>", b"<step>E</step>")
    problems = pr.verify_content(original, tampered)
    assert problems and any("changed" in p or "differs" in p for p in problems)


def test_the_content_check_catches_a_duration_changed_beyond_the_tolerance():
    original = score(note("C4", 480) * 4)
    stretched = original.replace(b"<duration>480</duration><voice>1</voice><staff>1</staff></note></measure>",
                                 b"<duration>960</duration><voice>1</voice><staff>1</staff></note></measure>", 1)
    assert pr.verify_content(original, stretched)


def test_the_four_pinned_pieces_repair_validate_and_keep_their_content(tmp_path):
    import build
    import validate

    pinned = pr.pinned_shas()
    assert pinned, "content/tools/pdmx-repairs.json pins no piece"
    selected = CONTENT / "_raw" / "pdmx" / "selected"
    for sha in pinned:
        src = selected / f"{sha}.mxl"
        if not src.exists():
            pytest.skip("the PDMX selection is not present in this checkout")
        import pdmx_screen

        data = build.strip_fingerings(pdmx_screen.xml_from_mxl(src.read_bytes()))
        repaired, record = pr.repair(data)
        assert record["trims"] or record["pads"], sha
        plain = tmp_path / f"{sha[:8]}.musicxml"
        plain.write_bytes(repaired)
        checks = validate.check_file(plain, None, False, max_bytes=None)
        assert checks["errors"] == [], (sha[:8], checks["errors"][:3])
