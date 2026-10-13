"""make_hand_motion.py: movement, span, position and pattern statistics of staff-labelled music."""
from __future__ import annotations

import json
import sys
from fractions import Fraction
from pathlib import Path

import pytest

RESEARCH = Path(__file__).resolve().parents[1]
REPO = RESEARCH.parent
sys.path.insert(0, str(RESEARCH / "scripts"))
import make_hand_motion as mhm  # noqa: E402

XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><tie type="start"/><voice>1</voice><staff>1</staff></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/><voice>1</voice><staff>1</staff></note>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>5</voice><staff>2</staff></note>
<forward><duration>1</duration></forward>
<note><pitch><step>G</step><octave>2</octave></pitch><duration>1</duration><voice>5</voice><staff>2</staff></note>
</measure></part></score-partwise>
"""


def nonzero(xs):
    return {i: v for i, v in enumerate(xs) if v}


def test_counts_follow_the_shared_definition(tmp_path):
    path = tmp_path / "piece.musicxml"
    path.write_text(XML, encoding="utf-8")
    notes = mhm.musicxml_notes(path)
    assert sorted(notes) == sorted([
        (Fraction(0), 60, "R"), (Fraction(0), 64, "R"), (Fraction(1), 62, "R"), (Fraction(3), 67, "R"),
        (Fraction(0), 48, "L"), (Fraction(3), 43, "L"),
    ])
    c = mhm.motion_counts(notes)
    assert nonzero(c["moveRight"]) == {24: 1, 29: 1}  # 62 -> 62, 62 -> 67
    assert nonzero(c["moveLeft"]) == {19: 1}  # 48 -> 43
    assert nonzero(c["spanRight"]) == {0: 2, 4: 1}
    assert nonzero(c["spanLeft"]) == {0: 2}
    assert nonzero(c["positionRight"]) == {41: 2, 46: 1}
    assert nonzero(c["positionLeft"]) == {22: 1, 27: 1}
    assert c["pattern"] == {
        "L": {"L": 0, "R": 0, "LR": 0},
        "R": {"L": 0, "R": 0, "LR": 1},
        "LR": {"L": 0, "R": 1, "LR": 1},
    }


def test_pig_files_use_the_channel_as_the_hand(tmp_path):
    path = tmp_path / "001-1_fingering.txt"
    path.write_text(
        "//Version: PianoFingering_v170101\n"
        "0\t0.0\t0.5\tC4\t64\t64\t0\t1\n"
        "1\t0.0\t1.0\tC3\t64\t64\t1\t-5\n"
        "2\t0.5\t1.0\tEb4\t64\t64\t0\t2\n",
        encoding="utf-8",
    )
    assert sorted(mhm.pig_notes(path)) == sorted([(0, 60, "R"), (0, 48, "L"), (500_000, 63, "R")])


def test_smoothing_adds_one_half_and_normalises():
    counts = mhm.empty_counts()
    counts["moveLeft"][24] = 3
    probs = mhm.smooth(counts, frozenset())
    assert probs["moveLeft"][24] == pytest.approx(3.5 / (3 + 0.5 * 49))
    assert sum(probs["moveLeft"]) == pytest.approx(1.0)
    for row in probs["pattern"].values():
        assert sum(row.values()) == pytest.approx(1.0)
        assert row["L"] == pytest.approx(1 / 3)


def test_the_script_is_deterministic_and_refuses_to_ship_pig_statistics(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    args = ["--library", str(REPO / "content/manifest.json"), "--date", "2026-10-14"]
    assert mhm.main(args + ["--out", str(a)]) == 0
    assert mhm.main(args + ["--out", str(b)]) == 0
    assert a.read_bytes() == b.read_bytes()
    data = json.loads(a.read_text(encoding="utf-8"))
    assert [(s["name"], s["files"]) for s in data["provenance"]["sources"]] == [("library", 30)]
    assert (len(data["moveLeft"]), len(data["spanRight"]), len(data["positionLeft"])) == (49, 25, 88)
    assert sum(data["counts"]["library"]["moveRight"]) > 500
    assert (data["mu"], data["nu"], data["idleSec"]) == (5.0, 0.5, 4.0)
    with pytest.raises(SystemExit) as err:
        mhm.main(["--pig", str(tmp_path), "--pig-split", str(tmp_path / "s.json"),
                  "--out", str(REPO / "packages/engine/x.json")])
    assert "research-only" in str(err.value)


def test_uniform_flattens_tables_for_ablations(tmp_path):
    out = tmp_path / "u.json"
    assert mhm.main(["--library", str(REPO / "content/manifest.json"), "--date", "2026-10-14",
                     "--uniform", "pattern,span", "--out", str(out)]) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["pattern"]["R"]["L"] == pytest.approx(1 / 3)
    assert data["spanLeft"][0] == pytest.approx(1 / 25)
    assert data["provenance"]["uniform"] == ["pattern", "span"]
    assert data["moveLeft"][24] != pytest.approx(1 / 49)
