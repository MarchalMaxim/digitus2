"""check_spans.py: library slices no single hand can play, and the report in verification.json."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
CONTENT = TOOLS.parent
ROOT = CONTENT.parent
sys.path.insert(0, str(TOOLS))
import check_spans as cs  # noqa: E402

SPANS_TS = ROOT / "packages" / "engine" / "src" / "fingering" / "spans.ts"


def note(name: str, staff: int, *, chord: bool = False, grace: bool = False, tie: str | None = None) -> str:
    """One quarter note (or a grace note) in a two-staff part with divisions 1; name like F#4."""
    alter = name.count("#")
    xml = "<note>" + ("<grace/>" if grace else "") + ("<chord/>" if chord else "")
    xml += f"<pitch><step>{name[0]}</step>" + (f"<alter>{alter}</alter>" if alter else "")
    xml += f"<octave>{name[-1]}</octave></pitch>" + ("" if grace else "<duration>1</duration>")
    xml += f'<tie type="{tie}"/>' if tie else ""
    return xml + f"<voice>{staff}</voice><staff>{staff}</staff></note>"


def events(staff: int, beats: list[list[str]]) -> str:
    """Four beats of one staff; each beat is a list of pitches struck together."""
    return "".join(note(p, staff, chord=k > 0) for beat in beats for k, p in enumerate(beat))


def score(tmp_path: Path, measures: list[str]) -> Path:
    body = "".join(
        f'<measure number="{i + 1}">'
        + ('<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>'
           "<staves>2</staves></attributes>" if i == 0 else "")
        + m + "</measure>"
        for i, m in enumerate(measures)
    )
    path = tmp_path / "piece.musicxml"
    path.write_text(
        '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list>'
        '<score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
        f'<part id="P1">{body}</part></score-partwise>',
        encoding="utf-8",
    )
    return path


BACKUP = "<backup><duration>4</duration></backup>"


def test_flags_each_reason_by_hand(tmp_path):
    right = events(1, [["C4", "E4", "G4", "E5"], ["C4", "E4", "G4", "C5"],
                       ["A#4", "C#5", "E5", "A#5", "C#6"], ["C4", "D4", "E4", "F4", "G4", "A4"]])
    left = events(2, [["F#1", "F#2", "F#3"], ["C3", "E3", "G3"], ["C2"], ["C3", "C4"]])
    flags = cs.span_flags(score(tmp_path, [right + BACKUP + left]), "p")
    assert [(f["bar"], f["hand"], f["quarter"], f["pitches"], f["span"], f["reasons"]) for f in flags] == [
        ("1", "R", 0.0, ["C4", "E4", "G4", "E5"], 16, ["span"]),
        ("1", "L", 0.0, ["F#1", "F#2", "F#3"], 24, ["span"]),
        # Chopin Op. 28 No. 7, bar 12: 15 semitones, but C#5 to C#6 needs 2-5 at an octave (max 10).
        ("1", "R", 2.0, ["A#4", "C#5", "E5", "A#5", "C#6"], 15, ["fingers"]),
        ("1", "R", 3.0, ["C4", "D4", "E4", "F4", "G4", "A4"], 9, ["notes"]),
    ]
    assert all(f["piece"] == "p" for f in flags)


def test_grace_notes_tie_continuations_and_the_other_hand_are_not_struck_with_a_slice(tmp_path):
    # Beat 1: a grace C3 before E5 (the engine gives the grace its own slice). Beat 2: C3 tied
    # into beat 3, where E5 is struck over the held C3. Beat 4: C5 over a left-hand C2.
    right = (note("C3", 1, grace=True) + note("E5", 1) + note("C3", 1, tie="start")
             + note("C3", 1, tie="stop") + note("E5", 1, chord=True) + note("C5", 1))
    left = events(2, [["C3"], ["C3"], ["C3"], ["C2"]])
    assert cs.span_flags(score(tmp_path, [right + BACKUP + left]), "p") == []


def test_a_score_with_more_than_one_part_is_refused(tmp_path):
    # The engine gives part 0 to the right hand and every other part to the left; xmlcheck reads
    # only the first part, so a multi-part score would be reported partly, or in the wrong hand.
    def part(pid: str, name: str) -> str:
        return (f'<part id="{pid}"><measure number="1"><attributes><divisions>1</divisions>'
                f"</attributes>{note(name, 1)}</measure></part>")

    path = tmp_path / "two-parts.musicxml"
    path.write_text(
        '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list>'
        '<score-part id="P1"><part-name>RH</part-name></score-part>'
        '<score-part id="P2"><part-name>LH</part-name></score-part></part-list>'
        + part("P1", "C5") + part("P2", "C3") + "</score-partwise>",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="2 parts"):
        cs.span_flags(path, "p")


def test_printed_position_is_a_quarter_offset_not_a_beat():
    flag = {"piece": "p", "bar": "3", "hand": "R", "quarter": 1.5, "pitches": ["C4", "E5"],
            "span": 16, "reasons": ["span"]}
    assert cs.format_flag(flag) == "p  bar 3  quarter 1.5  R  C4 E5  (16 semitones; span)"


def test_left_hand_is_checked_in_the_mirrored_view():
    # C4 C#4 C#5: the right hand needs 2-5 at an octave (thumb on C4), the left hand takes 5 4 1.
    assert cs.reasons_of([60, 61, 73], "R") == ["fingers"]
    assert cs.reasons_of([60, 61, 73], "L") == []
    # C4 C5 C#5 is the mirror image: 1 4 5 in the right hand, impossible in the left.
    assert cs.reasons_of([60, 72, 73], "R") == []
    assert cs.reasons_of([60, 72, 73], "L") == ["fingers"]
    assert cs.reasons_of([60, 75], "R") == [] and cs.reasons_of([60, 76], "L") == ["span"]


def test_practical_spans_are_the_engines():
    text = SPANS_TS.read_text(encoding="utf-8")
    block = re.search(r"maxPrac: \[(.*?)\],\s*maxComf", text, re.S)
    assert block, "PARNCUTT_TABLES.maxPrac not found in spans.ts"
    rows = [[int(v) for v in re.findall(r"-?\d+", row)] for row in re.findall(r"\[([^\[\]]*)\]", block.group(1))]
    assert rows == cs.MAX_PRAC
    assert cs.MAX_SPAN == 15


def test_library_flags_include_the_review_cases():
    flags = cs.library_flags()
    found = {(f["piece"], f["bar"], f["hand"], " ".join(f["pitches"])): f["reasons"] for f in flags}
    assert found[("satie-gymnopedie-no1", "5", "R", "B3 D4 F#4 F#5")] == ["span"]
    assert found[("beethoven-moonlight-sonata-mvt1", "14", "L", "F#1 F#2 F#3")] == ["span"]
    assert found[("chopin-prelude-op28-no7", "12", "R", "A#4 C#5 E5 A#5 C#6")] == ["fingers"]
    assert any(piece == "chopin-prelude-op28-no4" for piece, *_ in found)
    assert all(f["span"] > cs.MAX_SPAN for f in flags if "span" in f["reasons"])


def test_verification_report_is_current():
    verification = json.loads((CONTENT / "verification.json").read_text(encoding="utf-8"))
    assert verification.get("spanFlags") == cs.library_flags(), (
        "content/verification.json is stale: run python -I content/tools/check_spans.py")
