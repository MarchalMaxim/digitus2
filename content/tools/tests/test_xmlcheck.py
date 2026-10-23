"""MusicXML against MIDI: grace notes inside a repeat (issue 49)."""
from __future__ import annotations

import struct
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import xmlcheck as xc  # noqa: E402

TPQ = 384


def note(step: str, octave: int, dur: int = 4, grace: bool = False) -> str:
    timing = '<grace slash="yes"/>' if grace else f"<duration>{dur}</duration>"
    kind = "eighth" if grace else "whole"
    return (f"<note>{timing}<pitch><step>{step}</step><octave>{octave}</octave></pitch>"
            f"<voice>1</voice><type>{kind}</type></note>")


# bar 1, then a repeated bar 2 that opens with a grace D5, then bar 3
SCORE = f"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef></attributes>
      {note("C", 5)}
    </measure>
    <measure number="2">
      <barline location="left"><repeat direction="forward"/></barline>
      {note("D", 5, grace=True)}{note("E", 5)}
      <barline location="right"><repeat direction="backward"/></barline>
    </measure>
    <measure number="3">{note("F", 5)}</measure>
  </part>
</score-partwise>
"""


def _varlen(v: int) -> bytes:
    out = [v & 0x7F]
    v >>= 7
    while v:
        out.append(0x80 | (v & 0x7F))
        v >>= 7
    return bytes(reversed(out))


def write_midi(path: Path, notes: list[tuple[float, int, float]]) -> None:
    """A one-track SMF with (onset quarters, pitch, duration quarters) notes."""
    events = []
    for on, p, d in notes:
        events.append((round(on * TPQ), 1, bytes([0x90, p, 64])))
        events.append((round((on + d) * TPQ), 0, bytes([0x80, p, 0])))
    body, t = b"", 0
    for tick, _, ev in sorted(events):
        body += _varlen(tick - t) + ev
        t = tick
    body += b"\x00\xff\x2f\x00"
    path.write_bytes(b"MThd" + struct.pack(">IHHH", 6, 0, 1, TPQ)
                     + b"MTrk" + struct.pack(">I", len(body)) + body)


def test_grace_in_repeat_counts_once_per_pass(tmp_path):
    (tmp_path / "s.musicxml").write_text(SCORE, encoding="utf-8")
    xs = xc.parse_musicxml(tmp_path / "s.musicxml")
    # the repeat plays bar 2 twice, and its grace note just before the beat each time
    write_midi(tmp_path / "s.mid", [(0, 72, 4), (3.75, 74, 0.25), (4, 76, 4), (7.75, 74, 0.25),
                                    (8, 76, 4), (12, 77, 4)])
    r = xc.best_midi_match(xs, tmp_path / "s.mid")
    assert r["mode"] == "unfolded" and r["exact"], r


def test_written_mode_counts_each_grace_once(tmp_path):
    (tmp_path / "s.musicxml").write_text(SCORE, encoding="utf-8")
    xs = xc.parse_musicxml(tmp_path / "s.musicxml")
    write_midi(tmp_path / "once.mid", [(0, 72, 4), (3.75, 74, 0.25), (4, 76, 4), (8, 77, 4)])
    assert xc.best_midi_match(xs, tmp_path / "once.mid")["exact"]
    # a second grace D5 is not in the score as written
    write_midi(tmp_path / "twice.mid", [(0, 72, 4), (3.75, 74, 0.25), (4, 76, 4), (7.75, 74, 0.25),
                                        (8, 77, 4)])
    r = xc.compare_notes(xc.written_notes(xs), xc.read_midi(tmp_path / "twice.mid"), xc.grace_pitches(xs))
    assert r["only_midi_count"] == 1, r
