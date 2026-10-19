"""Verified repairs for archive scores the build refused (issue #80, 2026-10-19).

The validator refuses a score at its defects: a voice that lasts longer than its bar ('voice 1 lasts ...
quarters, time signature allows ...') or a backup that reaches before the bar start ('backup before measure
start'). Four of the fourteen advanced uploads refused that way have only rounding-sized defects: a voice runs
past its bar by at most 1/32 of a quarter, or a backup reaches before the bar start by that much. The repair
shortens the last note of an over-long voice by the excess, or inserts one rest of the missing length before a
backup. Nothing else changes. `verify_content` compares the pitched notes (pitch, voice, staff, onset and
duration) and the non-note elements of the two scores, and `repair` raises unless the check passes. The caller
must still run the validator on the result.

Only the pieces listed in `content/tools/pdmx-repairs.json` are repaired. The other refused advanced uploads have
bars that run over by a quarter or more, or overlapping notes in one voice; no change of this kind fixes them.
"""

from __future__ import annotations

import json
from fractions import Fraction as F
from pathlib import Path

from lxml import etree

TOOLS = Path(__file__).resolve().parent
REPAIRS = TOOLS / "pdmx-repairs.json"
TOLERANCE = F(1, 32)  # quarters: the largest change one repair makes to one note, rest or bar
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


class RepairRefused(ValueError):
    """The score has a defect that a rounding repair does not cover, or the repaired score fails the check."""


def pinned_repairs() -> dict[str, dict]:
    """Each archive score the repairs file names (SHA-256 -> its record: the reason it is repaired)."""
    return json.loads(REPAIRS.read_text(encoding="utf-8"))["repairs"]


def pinned_shas() -> list[str]:
    """The SHA-256 of each archive score the repairs file names, sorted."""
    return sorted(pinned_repairs())


def _midi(pitch) -> int:
    alter = pitch.findtext("alter")
    return 12 * (int(pitch.findtext("octave")) + 1) + STEP[pitch.findtext("step")] + int(round(float(alter or 0)))


def _bars(part) -> list[tuple[int, int]]:
    """(divisions, nominal bar length in ticks) for each bar in order; attributes carry over from bar to bar."""
    divisions = beats = beat_type = None
    out = []
    for bar in part.findall("measure"):
        for attributes in bar.findall("attributes"):
            if attributes.findtext("divisions"):
                divisions = int(attributes.findtext("divisions"))
            time = attributes.find("time")
            if time is not None:
                beats, beat_type = int(time.findtext("beats")), int(time.findtext("beat-type"))
        if divisions is None or beats is None:
            raise RepairRefused("no divisions or time signature before a bar")
        out.append((divisions, divisions * beats * 4 // beat_type))
    return out


def _walk(bar) -> dict:
    """The bar's notes with xmlcheck's cursor rules: a backup or forward moves the cursor, a chord shares its first
    note's onset, a grace note takes no time. `after` is the cursor after a note, where its voice ends when it is the
    voice's last note. `short` lists each backup that reaches before the bar start, with the missing length and the
    note element written just before it."""
    notes, short = [], []
    pos = last_start = 0
    furthest = 0
    last_note = None
    for el in bar:
        if el.tag == "backup":
            duration = int(el.findtext("duration"))
            if pos - duration < 0:
                short.append({"el": el, "deficit": duration - pos, "prev": last_note})
            pos -= duration
        elif el.tag == "forward":
            pos += int(el.findtext("duration"))
        elif el.tag == "note":
            grace = el.find("grace") is not None
            chord = el.find("chord") is not None
            duration = 0 if grace else int(el.findtext("duration") or 0)
            start = last_start if chord else pos
            if not chord:
                last_start = pos
            if not chord and not grace:
                pos += duration
            is_rest = el.find("rest") is not None
            pitch = el.find("pitch")
            notes.append({"el": el, "start": start, "dur": duration, "after": pos, "chord": chord, "grace": grace,
                          "voice": el.findtext("voice") or "1", "staff": el.findtext("staff") or "1",
                          "rest": is_rest, "midi": None if is_rest or pitch is None else _midi(pitch)})
            last_note = el
        furthest = max(furthest, pos)
    return {"notes": notes, "short": short, "furthest": furthest}


def _rest_element(duration: int, voice: str, staff: str):
    rest = etree.Element("note")
    etree.SubElement(rest, "rest")
    etree.SubElement(rest, "duration").text = str(duration)
    etree.SubElement(rest, "voice").text = voice
    etree.SubElement(rest, "staff").text = staff
    return rest


def _fix_bar(bar, divisions: int, nominal: int) -> tuple[list[dict], list[dict]]:
    """Repair one bar in place. Returns the rests added and the notes shortened; raises RepairRefused for a defect
    above the tolerance, or one the repair cannot place."""
    tol = TOLERANCE * divisions
    number = bar.get("number")
    pads, trims = [], []
    for _ in range(500):
        walked = _walk(bar)
        if walked["short"]:
            found = walked["short"][0]
            if found["prev"] is None or found["deficit"] > tol:
                raise RepairRefused(f"bar {number}: a backup {found['deficit']} ticks short, above the tolerance")
            prev = found["prev"]
            voice, staff = prev.findtext("voice") or "1", prev.findtext("staff") or "1"
            found["el"].addprevious(_rest_element(found["deficit"], voice, staff))
            pads.append({"measure": number, "voice": voice, "staff": staff, "ticks": found["deficit"]})
            continue
        last = {}
        for note in walked["notes"]:
            if not note["chord"] and not note["grace"]:
                last[note["voice"]] = note  # the voice's last note: its cursor is the voice's end
        over = [(voice, note) for voice, note in sorted(last.items()) if note["after"] > nominal]
        if over:
            voice, note = over[0]
            excess = note["after"] - nominal
            if excess > tol:
                raise RepairRefused(f"bar {number}: voice {voice} runs {excess} ticks past the bar, above the tolerance")
            duration = note["el"].find("duration")
            if note["dur"] - excess <= 0:
                raise RepairRefused(f"bar {number}: voice {voice}'s last note is too short to shorten")
            duration.text = str(note["dur"] - excess)
            trims.append({"measure": number, "voice": voice, "staff": note["staff"], "ticks": excess})
            continue
        if walked["furthest"] > nominal:
            raise RepairRefused(f"bar {number}: the cursor runs past the bar with no voice to shorten")
        return pads, trims
    raise RepairRefused(f"bar {number}: no repair converged")


def repair(data: bytes) -> tuple[bytes, dict]:
    """The score with its rounding defects repaired, and a record of each change. Returns the same bytes when the score
    has none. Raises RepairRefused when a defect is above the tolerance, or when the repaired score fails
    `verify_content`."""
    root = etree.fromstring(data)
    part = root.find("part")
    record = {"trims": [], "pads": []}
    for bar, (divisions, nominal) in zip(part.findall("measure"), _bars(part)):
        pads, trims = _fix_bar(bar, divisions, nominal)
        record["pads"].extend(pads)
        record["trims"].extend(trims)
    if not record["pads"] and not record["trims"]:
        return data, record
    repaired = etree.tostring(root, xml_declaration=True, encoding="UTF-8")
    problems = verify_content(data, repaired)
    if problems:
        raise RepairRefused("the repaired score changed its content: " + "; ".join(problems[:3]))
    return repaired, record


def verify_content(original: bytes, repaired: bytes) -> list[str]:
    """What the repair changed, as a list of problems: empty when every pitched note keeps its pitch, voice and staff,
    its onset and its duration within the tolerance, every non-note element is unchanged, and no rest is removed."""
    before = etree.fromstring(original).find("part")
    after = etree.fromstring(repaired).find("part")
    bars_before, bars_after = before.findall("measure"), after.findall("measure")
    if [b.get("number") for b in bars_before] != [a.get("number") for a in bars_after]:
        return ["the bar numbers changed"]
    problems = []
    for (divisions, _), bar_b, bar_a in zip(_bars(before), bars_before, bars_after):
        number = bar_b.get("number")
        other_b = [etree.tostring(el) for el in bar_b if el.tag != "note"]
        other_a = [etree.tostring(el) for el in bar_a if el.tag != "note"]
        if other_b != other_a:
            problems.append(f"bar {number}: a non-note element changed")
        walk_b, walk_a = _walk(bar_b), _walk(bar_a)
        tol = TOLERANCE * divisions
        key = lambda n: (n["staff"], n["voice"], n["midi"], n["start"])  # noqa: E731
        pitched_b = sorted((n for n in walk_b["notes"] if n["midi"] is not None), key=key)
        pitched_a = sorted((n for n in walk_a["notes"] if n["midi"] is not None), key=key)
        if len(pitched_b) != len(pitched_a):
            problems.append(f"bar {number}: the number of pitched notes changed")
            continue
        for x, y in zip(pitched_b, pitched_a):
            if (x["staff"], x["voice"], x["midi"]) != (y["staff"], y["voice"], y["midi"]):
                problems.append(f"bar {number}: a pitch, voice or staff changed")
                break
            if abs(x["start"] - y["start"]) > tol or abs(x["dur"] - y["dur"]) > tol:
                problems.append(f"bar {number}: a note's onset or duration moved beyond the tolerance")
                break
        if sum(n["rest"] for n in walk_a["notes"]) < sum(n["rest"] for n in walk_b["notes"]):
            problems.append(f"bar {number}: a rest was removed")
    return problems
