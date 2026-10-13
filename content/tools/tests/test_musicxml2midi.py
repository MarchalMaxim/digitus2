"""musicxml2midi.py writes a deterministic format-1 MIDI file whose tracks are the two staves."""
from __future__ import annotations

import struct
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
REPO = TOOLS.parents[1]
sys.path.insert(0, str(TOOLS))
import musicxml2midi  # noqa: E402

TWINKLE = REPO / "content" / "scores" / "twinkle-twinkle-little-star.musicxml"


def parse_smf(data: bytes):
    """A minimal Standard MIDI File reader for files without running status."""
    assert data[:4] == b"MThd"
    fmt, ntrks, division = struct.unpack(">HHH", data[8:14])
    pos = 14
    tracks = []
    for _ in range(ntrks):
        assert data[pos:pos + 4] == b"MTrk"
        length = int.from_bytes(data[pos + 4:pos + 8], "big")
        body = data[pos + 8:pos + 8 + length]
        pos += 8 + length
        events, i, tick = [], 0, 0
        while i < len(body):
            delta = 0
            while True:
                b = body[i]
                i += 1
                delta = (delta << 7) | (b & 0x7F)
                if b < 0x80:
                    break
            tick += delta
            status = body[i]
            i += 1
            if status == 0xFF:
                kind, size = body[i], body[i + 1]
                events.append((tick, "meta", kind, bytes(body[i + 2:i + 2 + size])))
                i += 2 + size
            else:
                events.append((tick, status & 0xF0, status & 0x0F, body[i], body[i + 1]))
                i += 2
        tracks.append(events)
    return fmt, division, tracks


def note_events(track):
    return [e for e in track if e[1] in (0x80, 0x90)]


def test_twinkle_has_a_conductor_and_two_hand_tracks():
    fmt, division, tracks = parse_smf(musicxml2midi.convert(TWINKLE))
    assert (fmt, division, len(tracks)) == (1, 480, 3)
    metas = {e[2]: e[3] for e in tracks[0] if e[1] == "meta"}
    assert metas[0x51] == (600_000).to_bytes(3, "big")  # 100 quarter notes per minute
    assert metas[0x58][:2] == bytes([4, 2])  # 4/4 (denominator as a power of two)
    assert metas[0x59] == bytes([0, 0])  # C major
    rh = [e for e in note_events(tracks[1]) if e[1] == 0x90]
    lh = [e for e in note_events(tracks[2]) if e[1] == 0x90]
    assert (len(rh), len(lh)) == (42, 22)
    assert {e[2] for e in rh} == {0} and {e[2] for e in lh} == {1}
    assert (rh[0][0], rh[0][3]) == (0, 60)
    assert (lh[0][0], lh[0][3]) == (0, 48)
    assert max(e[0] for t in tracks for e in t) == 12 * 4 * 480


def test_note_offs_come_before_note_ons_at_the_same_tick():
    _, _, tracks = parse_smf(musicxml2midi.convert(TWINKLE))
    for track in tracks[1:]:
        notes = note_events(track)
        for a, b in zip(notes, notes[1:]):
            assert not (a[0] == b[0] and a[1] == 0x90 and b[1] == 0x80), f"note-on before note-off at tick {a[0]}"


def test_output_is_deterministic_and_matches_the_committed_fixtures():
    data = musicxml2midi.convert(TWINKLE)
    assert data == musicxml2midi.convert(TWINKLE)
    for fixture in (REPO / "packages/engine/fixtures/twinkle.mid", REPO / "apps/web/fixtures/twinkle.mid"):
        assert fixture.read_bytes() == data, f"{fixture} is stale; regenerate it (M6 plan Task 0 step 4)"


def test_ties_merge_grace_notes_are_skipped_and_tempo_defaults_to_120(tmp_path):
    xml = tmp_path / "tie.musicxml"
    xml.write_text(
        '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">'
        '<part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">'
        '<measure number="1"><attributes><divisions>2</divisions><staves>2</staves>'
        "<time><beats>2</beats><beat-type>4</beat-type></time></attributes>"
        "<note><grace/><pitch><step>B</step><octave>3</octave></pitch><voice>1</voice><staff>1</staff></note>"
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><tie type="start"/>'
        "<voice>1</voice><staff>1</staff></note>"
        "<backup><duration>4</duration></backup>"
        "<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><staff>2</staff></note>"
        '</measure><measure number="2">'
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><tie type="stop"/>'
        "<voice>1</voice><staff>1</staff></note>"
        "<backup><duration>4</duration></backup>"
        "<note><rest/><duration>4</duration><voice>5</voice><staff>2</staff></note>"
        "</measure></part></score-partwise>",
        encoding="utf-8",
    )
    _, _, tracks = parse_smf(musicxml2midi.convert(xml))
    metas = {e[2]: e[3] for e in tracks[0] if e[1] == "meta"}
    assert metas[0x51] == (500_000).to_bytes(3, "big")
    assert [(e[0], e[1], e[3]) for e in note_events(tracks[1])] == [(0, 0x90, 60), (1920, 0x80, 60)]
    assert [(e[0], e[1], e[3]) for e in note_events(tracks[2])] == [(0, 0x90, 48), (960, 0x80, 48)]
