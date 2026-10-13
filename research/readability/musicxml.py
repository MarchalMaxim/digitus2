"""Minimal MusicXML reader for the library's ``*.fingered.musicxml`` files.

Handles what those files use (checked on all eight): one part, two staves (staff 1 = right
hand, staff 2 = left hand), several voices with ``<backup>``/``<forward>``, ``<chord/>``,
grace notes, ties, rests, ``<divisions>`` and ``<time>`` changes, and
``<notations><technical><fingering substitution="yes">``. Tied continuations are merged into
the note that starts the tie (one key press, as the Mutopia converter does).
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path

from readability.corpus import NoteRec

_STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _pitch(el: ET.Element) -> int:
    step = el.findtext("step")
    octave = int(el.findtext("octave"))
    alter = el.findtext("alter")
    return 12 * (octave + 1) + _STEP[step] + (int(float(alter)) if alter else 0)


def parse_fingered_musicxml(path: Path, tempo_bpm: float = 100.0) -> list[NoteRec]:
    root = ET.parse(path).getroot()
    parts = root.findall("part")
    if len(parts) != 1:
        raise ValueError(f"{path}: expected one part, found {len(parts)}")
    part = parts[0]
    divisions = Fraction(1)
    beats_per_bar = Fraction(4)
    t_bar_start = Fraction(0)                 # quarter-note beats
    raw: list[dict] = []
    bar_index = 0
    for measure in part.findall("measure"):
        cursor = Fraction(0)                  # divisions within the measure
        last_onset = Fraction(0)
        max_cursor = Fraction(0)
        implicit = measure.get("implicit") == "yes"
        for el in measure:
            tag = el.tag
            if tag == "attributes":
                d = el.findtext("divisions")
                if d:
                    divisions = Fraction(int(d))
                tm = el.find("time")
                if tm is not None:
                    beats_per_bar = Fraction(int(tm.findtext("beats"))) * 4 / int(tm.findtext("beat-type"))
            elif tag == "backup":
                cursor -= Fraction(int(el.findtext("duration")))
            elif tag == "forward":
                cursor += Fraction(int(el.findtext("duration")))
            elif tag == "note":
                is_chord = el.find("chord") is not None
                is_grace = el.find("grace") is not None
                is_rest = el.find("rest") is not None
                dur = Fraction(int(el.findtext("duration") or 0))
                onset = last_onset if is_chord else cursor
                if not is_chord:
                    last_onset = onset
                if not is_rest:
                    staff = int(el.findtext("staff") or 1)
                    fing_el = el.find("notations/technical/fingering")
                    finger_txt = (fing_el.text or "").strip() if fing_el is not None else ""
                    tie_stop = any(t.get("type") == "stop" for t in el.findall("tie"))
                    tie_start = any(t.get("type") == "start" for t in el.findall("tie"))
                    raw.append({
                        "pitch": _pitch(el.find("pitch")),
                        "hand": 0 if staff == 1 else 1,
                        "beat": t_bar_start + onset / divisions,
                        "dur_beats": dur / divisions,
                        "grace": is_grace,
                        "finger_txt": finger_txt,
                        "substitution": fing_el is not None and fing_el.get("substitution") == "yes",
                        "tie_stop": tie_stop, "tie_start": tie_start,
                        "bar": -1 if implicit and bar_index == 0 else bar_index,
                        "bar_pos": onset / divisions, "bar_len": beats_per_bar,
                    })
                if not is_chord and not is_grace:
                    cursor += dur
                max_cursor = max(max_cursor, cursor)
        bar_len_actual = max_cursor / divisions
        if implicit and bar_index == 0:
            # anacrusis: positions count back from the next barline
            for r in raw:
                if r["bar"] == -1:
                    r["bar_pos"] = beats_per_bar - bar_len_actual + r["bar_pos"]
            t_bar_start += bar_len_actual
        else:
            t_bar_start += bar_len_actual if bar_len_actual > 0 else beats_per_bar
            bar_index += 1
    # merge tie continuations into the note that starts the tie (same hand, same pitch,
    # onset at the end of the previous note)
    raw.sort(key=lambda r: (r["beat"], r["hand"], r["pitch"]))
    merged: list[dict] = []
    open_ties: dict[tuple[int, int], dict] = {}
    for r in raw:
        key = (r["hand"], r["pitch"])
        if r["tie_stop"] and key in open_ties:
            prev = open_ties[key]
            if abs(prev["beat"] + prev["dur_beats"] - r["beat"]) < Fraction(1, 64):
                prev["dur_beats"] += r["dur_beats"]
                if not prev["finger_txt"] and r["finger_txt"]:
                    prev["finger_txt"], prev["substitution"] = r["finger_txt"], r["substitution"]
                if not r["tie_start"]:
                    del open_ties[key]
                continue
        merged.append(r)
        if r["tie_start"]:
            open_ties[key] = r
        elif key in open_ties:
            del open_ties[key]
    sec_per_beat = 60.0 / float(tempo_bpm)
    out: list[NoteRec] = []
    for i, r in enumerate(merged):
        txt = r["finger_txt"]
        finger = 0
        if txt:
            head = txt.replace("-", "_").split("_")[0].strip()
            if head.isdigit() and 1 <= int(head) <= 5:
                finger = int(head)
        out.append(NoteRec(idx=i, onset=float(r["beat"]) * sec_per_beat,
                           offset=float(r["beat"] + r["dur_beats"]) * sec_per_beat,
                           pitch=r["pitch"], hand=r["hand"], finger=finger,
                           finger_raw=txt or "0", substitution=r["substitution"], grace=r["grace"],
                           beat=float(r["beat"]), dur_beats=float(r["dur_beats"]), bar=r["bar"],
                           bar_pos=float(r["bar_pos"]), bar_len=float(r["bar_len"])))
    return out
