#!/usr/bin/env python3
"""MusicXML -> Standard MIDI File (format 1), deterministic, standard library only.

Writes test fixtures whose tracks carry the true hands: track 0 'Conductor' (time signatures,
key signature, tempos), track 1 'RH' (staff 1, channel index 0), track 2 'LH' (every other
staff, channel index 1). 480 ticks per quarter note; note-on velocity 80; note-offs are 0x80
events and come before note-ons at the same tick. Ties are merged into one note; grace and cue
notes are skipped; repeats are not expanded; only the first part is read (the library files have
one part with two staves).

Usage (from the repo root):
  content/.venv/Scripts/python.exe -I content/tools/musicxml2midi.py IN.musicxml OUT.mid
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from fractions import Fraction
from math import floor
from pathlib import Path

PPQ = 480
VELOCITY = 80
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def read_score(path: Path):
    """Notes [onset, offset, midi, staff] in quarter notes, tempos, time signatures, key."""
    root = ET.parse(path).getroot()
    if root.tag != "score-partwise":
        raise ValueError(f"{path}: not a partwise MusicXML score")
    part = root.find("part")
    if part is None:
        raise ValueError(f"{path}: no part")
    divisions = 1
    measure_start = Fraction(0)
    notes: list[list] = []
    open_ties: dict[tuple[int, int], list] = {}
    tempos: list[tuple[Fraction, float]] = []
    times: list[tuple[Fraction, int, int]] = []
    key: tuple[int, str] | None = None
    for measure in part.findall("measure"):
        cursor = Fraction(0)
        longest = Fraction(0)
        chord_onset = Fraction(0)
        last_duration = Fraction(0)
        for el in measure:
            at = measure_start + cursor
            if el.tag == "attributes":
                if el.findtext("divisions"):
                    divisions = int(el.findtext("divisions"))
                k = el.find("key")
                if k is not None and key is None:
                    key = (int(k.findtext("fifths") or 0), k.findtext("mode") or "major")
                t = el.find("time")
                if t is not None:
                    times.append((at, int(t.findtext("beats")), int(t.findtext("beat-type"))))
            elif el.tag in ("direction", "sound"):
                sound = el if el.tag == "sound" else el.find(".//sound")
                if sound is not None and sound.get("tempo"):
                    tempos.append((at, float(sound.get("tempo"))))
            elif el.tag == "backup":
                cursor -= Fraction(int(el.findtext("duration")), divisions)
            elif el.tag == "forward":
                cursor += Fraction(int(el.findtext("duration")), divisions)
                longest = max(longest, cursor)
            elif el.tag == "note":
                if el.find("grace") is not None or el.find("cue") is not None:
                    continue
                duration = Fraction(int(el.findtext("duration") or 0), divisions)
                is_chord = el.find("chord") is not None
                onset = chord_onset if is_chord else cursor
                if not is_chord:
                    chord_onset = cursor
                    last_duration = duration
                    cursor += duration
                    longest = max(longest, cursor)
                pitch = el.find("pitch")
                if el.find("rest") is not None or pitch is None:
                    continue
                midi = ((int(pitch.findtext("octave")) + 1) * 12 + STEP[pitch.findtext("step")]
                        + floor(float(pitch.findtext("alter") or 0) + 0.5))
                staff = int(el.findtext("staff") or 1)
                start = measure_start + onset
                end = start + (last_duration if is_chord else duration)
                ties = {t.get("type") for t in el.findall("tie")}
                tie_key = (staff, midi)
                if "stop" in ties and tie_key in open_ties:
                    open_ties[tie_key][1] = end
                    if "start" not in ties:
                        del open_ties[tie_key]
                    continue
                note = [start, end, midi, staff]
                notes.append(note)
                if "start" in ties:
                    open_ties[tie_key] = note
        measure_start += longest
    return notes, tempos, times, key


def vlq(value: int) -> bytes:
    out = [value & 0x7F]
    value >>= 7
    while value:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(out))


def ticks(quarters: Fraction) -> int:
    t = quarters * PPQ
    if t.denominator != 1:
        raise ValueError(f"{quarters} quarter notes is not a whole number of ticks at {PPQ} per quarter")
    return int(t)


def name_event(text: str) -> bytes:
    data = text.encode("ascii")
    return b"\xff\x03" + vlq(len(data)) + data


def track(events: list[tuple[int, int, bytes]]) -> bytes:
    """events: (tick, rank at equal ticks, payload); sorted stably by (tick, rank)."""
    body = bytearray()
    last = 0
    for tick, _rank, payload in sorted(events, key=lambda e: (e[0], e[1])):
        body += vlq(tick - last) + payload
        last = tick
    body += vlq(0) + b"\xff\x2f\x00"
    return b"MTrk" + len(body).to_bytes(4, "big") + bytes(body)


def convert(path: Path) -> bytes:
    notes, tempos, times, key = read_score(Path(path))
    conductor = [(0, 0, name_event("Conductor"))]
    for at, beats, beat_type in times:
        conductor.append((ticks(at), 1, bytes([0xFF, 0x58, 4, beats, beat_type.bit_length() - 1, 24, 8])))
    if key is not None:
        conductor.append((0, 2, bytes([0xFF, 0x59, 2, key[0] & 0xFF, 1 if key[1] == "minor" else 0])))
    for at, qpm in tempos or [(Fraction(0), 120.0)]:
        conductor.append((ticks(at), 3, b"\xff\x51\x03" + round(60_000_000 / qpm).to_bytes(3, "big")))
    out_tracks = [track(conductor)]
    for channel, name, right in ((0, "RH", True), (1, "LH", False)):
        events = [(0, 0, name_event(name))]
        for start, end, midi, staff in notes:
            if (staff == 1) == right:
                events.append((ticks(end), 1, bytes([0x80 | channel, midi, 0])))
                events.append((ticks(start), 2, bytes([0x90 | channel, midi, VELOCITY])))
        out_tracks.append(track(events))
    header = (b"MThd" + (6).to_bytes(4, "big") + (1).to_bytes(2, "big")
              + len(out_tracks).to_bytes(2, "big") + PPQ.to_bytes(2, "big"))
    return header + b"".join(out_tracks)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    Path(argv[1]).write_bytes(convert(Path(argv[0])))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
