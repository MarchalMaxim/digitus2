"""MusicXML timeline walker, minimal Standard-MIDI-File reader and note comparison.

Used by validate.py.  Everything here is independent of music21 so that the
library is checked by two different readers (this one and music21).
License: MIT.
"""
from __future__ import annotations

import struct
from collections import Counter
from dataclasses import dataclass, field
from fractions import Fraction as F
from pathlib import Path
import xml.etree.ElementTree as ET

STEP_SEMIS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


@dataclass
class XNote:
    measure_idx: int
    number: str
    onset: F  # quarters from the start of the score (as written, no repeats)
    rel: F  # quarters from the start of the measure
    dur: F  # quarters (0 for grace notes)
    pitch: int | None  # MIDI number, None for rests
    voice: str
    staff: str
    grace: bool
    chord: bool
    tie_start: bool
    tie_stop: bool
    fingerings: list = field(default_factory=list)
    type: str | None = None
    has_duration: bool = True


@dataclass
class XMeasure:
    idx: int
    number: str
    implicit: bool
    start: F
    length: F  # actual (max position reached), quarters
    nominal: F | None  # from the time signature, quarters
    forward_repeat: bool = False
    backward_repeat: bool = False
    repeat_times: int = 2
    ending_start: list = field(default_factory=list)  # ending numbers starting here
    ending_stop: bool = False
    voice_overlaps: list = field(default_factory=list)
    voice_ends: dict = field(default_factory=dict)


@dataclass
class XScore:
    version: str
    parts: int
    staves: int
    measures: list
    notes: list
    keys: list
    times: list
    clefs: list
    tempos: list
    problems: list


def _int(el, default=0):
    try:
        return int(el.text.strip())
    except Exception:
        return default


def parse_musicxml(path: Path) -> XScore:
    tree = ET.parse(path)
    root = tree.getroot()
    problems = []
    parts = root.findall("part")
    version = root.get("version", "")
    if not parts:
        return XScore(version, 0, 0, [], [], [], [], [], [], ["no <part>"])
    part = parts[0]
    divisions = None
    pos = 0
    measures = []
    notes = []
    keys, times, clefs, tempos = [], [], [], []
    staves = 1
    abs_start = F(0)
    cur_time = None
    open_endings = []
    for mi, m in enumerate(part.findall("measure")):
        number = m.get("number", "")
        implicit = m.get("implicit") == "yes"
        pos = 0
        maxpos = 0
        last_start = 0
        voice_last_end: dict = {}
        voice_intervals: dict = {}
        xm = XMeasure(mi, number, implicit, abs_start, F(0), None)
        for el in m:
            tag = el.tag
            if tag == "attributes":
                d = el.find("divisions")
                if d is not None:
                    divisions = _int(d)
                st = el.find("staves")
                if st is not None:
                    staves = _int(st, 1)
                for k in el.findall("key"):
                    keys.append((mi, k.findtext("fifths"), k.findtext("mode")))
                for t in el.findall("time"):
                    cur_time = (_int(t.find("beats")), _int(t.find("beat-type")))
                    times.append((mi, cur_time))
                for c in el.findall("clef"):
                    clefs.append((mi, c.get("number", "1"), c.findtext("sign"), c.findtext("line")))
            elif tag == "backup":
                pos -= _int(el.find("duration"))
                if pos < 0:
                    problems.append(f"measure {number}: backup before measure start")
            elif tag == "forward":
                pos += _int(el.find("duration"))
                maxpos = max(maxpos, pos)
            elif tag == "note":
                if divisions is None:
                    problems.append("note before <divisions>")
                    divisions = 1
                grace = el.find("grace") is not None
                chord = el.find("chord") is not None
                dur_el = el.find("duration")
                has_duration = dur_el is not None
                dur = _int(dur_el) if has_duration else 0
                if grace:
                    dur = 0
                start = last_start if chord else pos
                if not chord:
                    last_start = pos
                pitch = None
                p = el.find("pitch")
                if p is not None:
                    alter = el.findtext("pitch/alter")
                    alt = float(alter) if alter else 0.0
                    pitch = 12 * (int(p.findtext("octave")) + 1) + STEP_SEMIS[p.findtext("step")] + int(round(alt))
                voice = el.findtext("voice") or "1"
                staff = el.findtext("staff") or "1"
                ties = [t.get("type") for t in el.findall("tie")]
                fings = [f.text for f in el.findall("notations/technical/fingering")]
                xn = XNote(mi, number, abs_start + F(start, divisions), F(start, divisions), F(dur, divisions),
                           pitch, voice, staff, grace, chord, "start" in ties, "stop" in ties, fings,
                           el.findtext("type"), has_duration or grace)
                notes.append(xn)
                if not chord and not grace:
                    s, e = start, start + dur
                    ivs = voice_intervals.setdefault(voice, [])
                    for (a, b) in ivs:
                        if s < b and a < e:
                            xm.voice_overlaps.append((voice, F(s, divisions)))
                            break
                    ivs.append((s, e))
                    pos += dur
                    voice_last_end[voice] = max(voice_last_end.get(voice, 0), pos)
                maxpos = max(maxpos, pos)
            elif tag == "direction":
                snd = el.find("sound")
                if snd is not None and snd.get("tempo"):
                    tempos.append((mi, F(pos, divisions or 1), float(snd.get("tempo"))))
            elif tag == "sound":
                if el.get("tempo"):
                    tempos.append((mi, F(pos, divisions or 1), float(el.get("tempo"))))
            elif tag == "barline":
                rep = el.find("repeat")
                if rep is not None:
                    if rep.get("direction") == "forward":
                        xm.forward_repeat = True
                    else:
                        xm.backward_repeat = True
                        if rep.get("times"):
                            xm.repeat_times = int(rep.get("times"))
                end = el.find("ending")
                if end is not None:
                    if end.get("type") == "start":
                        xm.ending_start = [int(x) for x in end.get("number", "1").replace(" ", "").split(",") if x.isdigit()]
                    else:
                        xm.ending_stop = True
        div = divisions or 1
        xm.length = F(maxpos, div)
        if cur_time:
            xm.nominal = F(cur_time[0] * 4, cur_time[1])
        xm.voice_ends = {v: F(e, div) for v, e in voice_last_end.items()}
        measures.append(xm)
        abs_start += xm.length
    return XScore(version, len(parts), staves, measures, notes, keys, times, clefs, tempos, problems)


def unfold_order(measures: list) -> list[int]:
    """Measure playback order following repeat barlines and volta endings."""
    n = len(measures)
    ending_of = {}
    cur = None
    for i, m in enumerate(measures):
        if m.ending_start:
            cur = m.ending_start
        if cur is not None:
            ending_of[i] = cur
        if m.ending_stop:
            cur = None
    order = []
    i = 0
    section_start = 0
    passes: dict[int, int] = {}
    current_pass = 1
    guard = 0
    while i < n and guard < 100000:
        guard += 1
        m = measures[i]
        if m.forward_repeat and current_pass == 1:
            section_start = i
        if i in ending_of and current_pass not in ending_of[i]:
            i += 1
            continue
        order.append(i)
        if m.backward_repeat:
            done = passes.get(i, 1)
            if done < m.repeat_times:
                passes[i] = done + 1
                current_pass = done + 1
                i = section_start
                continue
            current_pass = 1
            section_start = i + 1
        elif m.ending_stop and i in ending_of:
            # an open (last) ending finished: the repeated section is complete
            current_pass = 1
            section_start = i + 1
        i += 1
    return order


def unfolded_notes(xs: XScore) -> list[tuple[F, int, F]]:
    """(onset, pitch, tied duration) for sounding non-grace notes, repeats unfolded."""
    order = unfold_order(xs.measures)
    by_measure: dict[int, list[XNote]] = {}
    for nt in xs.notes:
        by_measure.setdefault(nt.measure_idx, []).append(nt)
    out = []
    t = F(0)
    for mi in order:
        for nt in by_measure.get(mi, []):
            if nt.pitch is not None and not nt.grace and not nt.tie_stop:
                out.append((t + nt.rel, nt.pitch, nt.dur, nt.staff))
        t += xs.measures[mi].length
    return out


def written_notes(xs: XScore) -> list[tuple[F, int, F]]:
    """(onset, pitch, total tied duration) of every sounding written note (no repeats)."""
    td = tied_durations(xs)
    out = []
    for i, nt in enumerate(xs.notes):
        if nt.pitch is not None and not nt.grace and i in td:
            out.append((nt.onset, nt.pitch, td[i], nt.staff))
    return out


def tied_durations(xs: XScore) -> dict[int, F]:
    """Index of note in xs.notes -> total duration of its tie chain (for chain heads)."""
    res = {}
    open_by_key: dict[tuple, int] = {}
    for i, nt in enumerate(xs.notes):
        if nt.pitch is None or nt.grace:
            continue
        key = (nt.voice, nt.pitch)
        if nt.tie_stop and key in open_by_key:
            head = open_by_key[key]
            res[head] += nt.dur
            if not nt.tie_start:
                del open_by_key[key]
            continue
        res[i] = nt.dur
        if nt.tie_start:
            open_by_key[key] = i
    return res


# ----------------------------------------------------------------------------
# MIDI
# ----------------------------------------------------------------------------

def _varlen(data: bytes, i: int) -> tuple[int, int]:
    v = 0
    while True:
        b = data[i]
        i += 1
        v = (v << 7) | (b & 0x7F)
        if not b & 0x80:
            return v, i


def read_midi(path: Path) -> list[tuple[F, int, F, int]]:
    """Return (onset quarters, pitch, duration quarters, track) for every note."""
    data = Path(path).read_bytes()
    if data[:4] != b"MThd":
        raise ValueError("not a MIDI file")
    hlen = struct.unpack(">I", data[4:8])[0]
    fmt, ntracks, division = struct.unpack(">HHH", data[8:14])
    if division & 0x8000:
        raise ValueError("SMPTE time division not supported")
    tpq = division
    i = 8 + hlen
    notes = []
    for tr in range(ntracks):
        if data[i:i + 4] != b"MTrk":
            break
        tlen = struct.unpack(">I", data[i + 4:i + 8])[0]
        j = i + 8
        end = j + tlen
        t = 0
        status = None
        on: dict[tuple, list] = {}
        while j < end:
            delta, j = _varlen(data, j)
            t += delta
            b = data[j]
            if b == 0xFF:
                mtype = data[j + 1]
                ln, j = _varlen(data, j + 2)
                j += ln
                continue
            if b in (0xF0, 0xF7):
                ln, j = _varlen(data, j + 1)
                j += ln
                continue
            if b & 0x80:
                status = b
                j += 1
            hi = status & 0xF0
            ch = status & 0x0F
            if hi in (0xC0, 0xD0):
                j += 1
                continue
            d1, d2 = data[j], data[j + 1]
            j += 2
            if hi == 0x90 and d2 > 0:
                on.setdefault((ch, d1), []).append(t)
            elif hi == 0x80 or (hi == 0x90 and d2 == 0):
                lst = on.get((ch, d1))
                if lst:
                    st = lst.pop(0)
                    notes.append((F(st, tpq), d1, F(t - st, tpq), tr))
        i = end
    notes.sort()
    return notes


def grace_pitches(xs: XScore) -> Counter:
    """(staff, pitch) -> number of grace notes, as written (no repeats)."""
    return Counter((n.staff, n.pitch) for n in xs.notes if n.grace and n.pitch is not None)


def unfolded_grace_pitches(xs: XScore) -> Counter:
    """(staff, pitch) -> number of grace notes played, once per pass of unfold_order."""
    passes = Counter(unfold_order(xs.measures))
    res = Counter()
    for n in xs.notes:
        if n.grace and n.pitch is not None and passes[n.measure_idx]:
            res[(n.staff, n.pitch)] += passes[n.measure_idx]
    return res


def compare_notes(xml_notes: list[tuple], midi_notes: list[tuple], grace: Counter | None = None,
                  _track_map: dict | None = None) -> dict:
    """Compare sounding notes of a MusicXML file with a MIDI rendering.

    xml_notes: (onset, pitch, duration, staff); midi_notes: (onset, pitch, duration, track).
    LilyPond writes one MIDI track per staff and merges simultaneous identical pitches
    within a track, so the comparison is per staff/track on *sets* of (onset, pitch):
    a unison between two voices of one staff counts once on both sides.  Unmatched MIDI
    notes are accepted as grace notes when the staff has a grace note of that pitch
    (LilyPond plays grace notes just before the beat).
    """
    staves = sorted({n[3] for n in xml_notes})
    tracks = sorted({n[3] for n in midi_notes})
    if staves and len(staves) == len(tracks) == 2 and not _track_map:
        # MIDI track order follows LilyPond's context creation order, which need not be
        # top-to-bottom: try both assignments and keep the better one
        a = compare_notes(xml_notes, midi_notes, grace, _track_map={tracks[0]: staves[0], tracks[1]: staves[1]})
        b = compare_notes(xml_notes, midi_notes, grace, _track_map={tracks[0]: staves[1], tracks[1]: staves[0]})
        return a if a["matched"] >= b["matched"] else b
    if _track_map:
        tmap = _track_map
        gmap = Counter(grace or {})
    elif staves and len(staves) == len(tracks):
        tmap = dict(zip(tracks, staves))
        gmap = Counter(grace or {})
    else:  # e.g. a format-0 MIDI file: compare everything as one group
        tmap = {t: "all" for t in tracks}
        xml_notes = [(o, p, d, "all") for o, p, d, _ in xml_notes]
        gmap = Counter()
        for (s, p), c in (grace or {}).items():
            gmap[("all", p)] += c
    xd: dict[tuple, F] = {}
    for o, p, d, s in xml_notes:
        k = (s, o, p)
        xd[k] = max(xd.get(k, F(0)), d)
    md: dict[tuple, F] = {}
    for o, p, d, t in midi_notes:
        k = (tmap[t], o, p)
        md[k] = max(md.get(k, F(0)), d)
    xset, mset = set(xd), set(md)
    common = xset & mset
    only_x = xset - mset
    only_m = mset - xset
    for k in sorted(only_m):
        s, o, p = k
        if gmap.get((s, p), 0) > 0:
            gmap[(s, p)] -= 1
            only_m.discard(k)
    dur_mismatch = sum(1 for k in common if xd[k] != md[k])
    return {
        "xml": len(xset),
        "midi": len(mset),
        "matched": len(common),
        "only_xml": [(s, float(o), p) for s, o, p in sorted(only_x)[:12]],
        "only_midi": [(s, float(o), p) for s, o, p in sorted(only_m)[:12]],
        "only_xml_count": len(only_x),
        "only_midi_count": len(only_m),
        "duration_mismatches": dur_mismatch,
    }


def best_midi_match(xs: XScore, midi_path: Path) -> dict:
    """Compare against a MIDI file both as written and with repeats unfolded; keep the better."""
    mn = read_midi(midi_path)
    r1 = compare_notes(written_notes(xs), mn, grace_pitches(xs))
    r1["mode"] = "written"
    r2 = compare_notes(unfolded_notes(xs), mn, unfolded_grace_pitches(xs))
    r2["mode"] = "unfolded"
    def bad(r):
        return r["only_xml_count"] + r["only_midi_count"]
    best = r1 if bad(r1) <= bad(r2) else r2
    best["midiFile"] = Path(midi_path).name
    best["exact"] = bad(best) == 0
    return best
