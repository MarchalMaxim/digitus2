"""Why the build refused archive scores the gate had passed (2026-10-16), and what stops it now: the
archive's `<fingering>` digits are stripped before the check, and a `<harmony>` chord symbol is not a
zero-length note."""

from __future__ import annotations

import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
CONTENT = TOOLS.parent
sys.path.insert(0, str(TOOLS))

import build  # noqa: E402
import validate  # noqa: E402

PLAIN = b"<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>\n"


def test_a_score_without_fingerings_comes_back_as_the_same_bytes():
    data = b"<measure>\n" + PLAIN + b"</measure>\n"
    assert build.strip_fingerings(data) is data


def test_fingerings_go_and_the_empty_technical_and_notations_with_them():
    note = (b"  <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>\n"
            b"    <notations>\n      <technical>\n        <fingering>3</fingering>\n      </technical>\n"
            b"    </notations>\n  </note>\n")
    out = build.strip_fingerings(note)
    assert b"fingering" not in out and b"technical" not in out and b"notations" not in out
    assert out.startswith(b"  <note>") and out.rstrip().endswith(b"</note>")


def test_other_technical_marks_and_notations_stay():
    note = (b"<note><notations><technical><fingering substitution=\"yes\">2</fingering><up-bow/>"
            b"<fingering/></technical><slur type=\"start\"/></notations></note>")
    out = build.strip_fingerings(note)
    assert b"fingering" not in out
    assert b"<technical><up-bow/></technical>" in out and b"<slur type=\"start\"/>" in out


def test_the_chord_symbol_of_a_lead_sheet_is_not_a_zero_duration_note(tmp_path):
    source = (CONTENT / "scores" / "alle-meine-entchen.musicxml").read_text(encoding="utf-8")
    harmony = ("<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>")
    assert "<note>" in source and "<harmony" not in source
    marked = source.replace("<note>", harmony + "<note>", 1)
    path = tmp_path / "with-chord-symbol.musicxml"
    path.write_text(marked, encoding="utf-8")
    res = validate.check_file(path, None, False)
    assert not [e for e in res["errors"] if "zero duration" in e], res["errors"]
