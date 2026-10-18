"""Lossless normalisation of a recogniser's MusicXML before the app sees it.

One rule, checked on the file itself: a measure that holds no time (no note, rest, forward or
backup) is not a bar of music. homr writes the bracket that closes a first ending as such a measure
of its own, after the bar it belongs to, so every later bar is counted one too far. Its barlines
mark the boundary it stands on, which is the right barline of the bar before it; its attributes
and directions take effect at that same moment, which is the start of the bar after it. Moving them
there and dropping the empty measure changes no pitch, no duration and no onset. Anything that
would need a choice (two endings meeting in one barline, parts that disagree) leaves the file
exactly as it was.
"""
from __future__ import annotations

import copy
from fractions import Fraction
import xml.etree.ElementTree as ET

TIMED = {"note", "forward", "backup"}
# MusicXML's order of a barline's children.
BARLINE_ORDER = ["bar-style", "footnote", "level", "wavy-line", "segno", "coda", "fermata", "ending", "repeat"]
SINGLE = {"bar-style", "wavy-line", "segno", "coda", "ending", "repeat"}


def _empty(measure: ET.Element) -> bool:
    return not any(child.tag in TIMED for child in measure)


def _merge_barlines(target: ET.Element | None, barlines: list[ET.Element]) -> ET.Element | None:
    """One right barline holding the children of `target` and `barlines`, or None on a conflict."""
    children = list(target) if target is not None else []
    for barline in barlines:
        for child in barline:
            if child.tag in SINGLE and any(c.tag == child.tag for c in children):
                return None
            children.append(copy.deepcopy(child))
    merged = ET.Element("barline", target.attrib if target is not None else {})
    merged.set("location", "right")
    for tag in BARLINE_ORDER:
        merged.extend(c for c in children if c.tag == tag)
    if len(merged) != len(children):
        return None
    return merged


def merge_empty_measures(data: bytes) -> tuple[bytes, int]:
    """The file with each measure that holds no time merged into its neighbours, and how many."""
    # Keep comments: homr writes each note's image position as one.
    root = ET.fromstring(data, parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))
    parts = root.findall("part")
    if not parts:
        return data, 0
    counts = {len(part.findall("measure")) for part in parts}
    if len(counts) != 1:
        return data, 0
    total = counts.pop()
    # Only indices where every part's measure is empty, never the first or the last.
    indices = [
        i
        for i in range(1, total - 1)
        if all(_empty(part.findall("measure")[i]) for part in parts)
    ]
    if not indices:
        return data, 0
    for part in parts:
        bars = part.findall("measure")
        for i in indices:
            empty, before, after = bars[i], bars[i - 1], bars[i + 1]
            barlines = [c for c in empty if c.tag == "barline"]
            if barlines:
                right = [c for c in before if c.tag == "barline" and c.get("location") == "right"]
                if len(right) > 1:
                    return data, 0
                merged = _merge_barlines(right[0] if right else None, barlines)
                if merged is None:
                    return data, 0
                if right:
                    index = list(before).index(right[0])
                    before.remove(right[0])
                    before.insert(index, merged)
                else:
                    before.append(merged)
            # Everything else (attributes, directions, print) opens the next bar, in its order.
            moving = [copy.deepcopy(c) for c in empty if c.tag != "barline"]
            for offset, child in enumerate(moving):
                after.insert(offset, child)
    for part in parts:
        bars = part.findall("measure")
        for i in reversed(indices):
            part.remove(bars[i])
    # homr numbers its bars 1, 2, 3 ...: keep that sequence after a merge.
    for part in parts:
        bars = part.findall("measure")
        numbers = [b.get("number") for b in bars]
        expected = [str(i + 1) for i in range(total)]
        kept = [n for i, n in enumerate(expected) if i not in indices]
        if numbers == kept:
            for i, bar in enumerate(bars):
                bar.set("number", str(i + 1))
    out = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    return out, len(indices)


def _parse(data: bytes) -> ET.Element:
    # Keep comments: homr writes each note's image position as one.
    return ET.fromstring(data, parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))


def _timeline(root: ET.Element):
    """Every pitched note with its part, staff, pitch and exact onset and end in quarter notes."""
    parts = root.findall("part")
    lengths: list[Fraction] = []
    raw = []
    for p, part in enumerate(parts):
        divisions = 1
        for m, measure in enumerate(part.findall("measure")):
            cursor = Fraction(0)
            longest = Fraction(0)
            chord_onset = Fraction(0)
            for el in measure:
                if el.tag == "attributes" and el.findtext("divisions"):
                    divisions = int(el.findtext("divisions"))
                elif el.tag in ("backup", "forward"):
                    d = Fraction(int(el.findtext("duration", "0")), divisions)
                    cursor += -d if el.tag == "backup" else d
                    longest = max(longest, cursor)
                elif el.tag == "note":
                    grace = el.find("grace") is not None
                    d = Fraction(0) if grace else Fraction(int(el.findtext("duration", "0")), divisions)
                    chord = el.find("chord") is not None
                    onset = chord_onset if chord else cursor
                    if not chord:
                        chord_onset = cursor
                        if not grace:
                            cursor += d
                    longest = max(longest, cursor, onset + d)
                    pitch = el.find("pitch")
                    if pitch is not None and not grace:
                        key = (pitch.findtext("step"), pitch.findtext("alter", "0"), pitch.findtext("octave"))
                        raw.append((el, p, el.findtext("staff", "1"), key, m, onset, onset + d))
            while len(lengths) <= m:
                lengths.append(Fraction(0))
            lengths[m] = max(lengths[m], longest)
    starts = [Fraction(0)]
    for length in lengths:
        starts.append(starts[-1] + length)
    return [(el, p, staff, key, starts[m] + on, starts[m] + end) for el, p, staff, key, m, on, end in raw]


def _slurs(note: ET.Element, kind: str):
    return [(notations, slur) for notations in note.findall("notations") for slur in notations.findall("slur") if slur.get("type") == kind]


def _tie(note: ET.Element, kind: str, notations: ET.Element) -> None:
    """Writes the sounding <tie> after <duration> and the drawn <tied> first in the notations."""
    children = list(note)
    after = next((i + 1 for i, c in enumerate(children) if c.tag == "duration"), 0)
    while after < len(children) and children[after].tag == "tie":
        after += 1
    note.insert(after, ET.Element("tie", type=kind))
    notations.insert(0, ET.Element("tied", type=kind))


def ties_from_slurs(data: bytes) -> tuple[bytes, int]:
    """Slurs that join a note to the same pitch starting exactly where it ends, turned into ties.

    homr's model draws ties and slurs as one class and its exporter turns a slur into a tie when it
    joins a note to the next note of the same voice number. Its voice numbers can change across a
    held note, so the same rule is applied here by staff and exact time instead: a slur start and a
    slur stop on one staff, on the same pitch, the second starting exactly where the first ends.
    When more than one note could be the continuation, the slur is left as it is.
    """
    root = _parse(data)
    notes = _timeline(root)
    count = 0
    for start, part, staff, key, onset, end in notes:
        begins = _slurs(start, "start")
        if not begins:
            continue
        candidates = [n for n in notes if n[1] == part and n[2] == staff and n[3] == key and n[4] == end and n[0] is not start]
        if len(candidates) != 1:
            continue
        stop = candidates[0][0]
        ends = _slurs(stop, "stop")
        if not ends or stop.find("tie") is not None or start.find("tie") is not None:
            continue
        (begin_notations, begin_slur), (end_notations, end_slur) = begins[0], ends[0]
        begin_notations.remove(begin_slur)
        end_notations.remove(end_slur)
        _tie(start, "start", begin_notations)
        _tie(stop, "stop", end_notations)
        count += 1
    if not count:
        return data, 0
    return ET.tostring(root, encoding="utf-8", xml_declaration=True), count


def _unpaired_grand_staff(data: bytes) -> bool:
    """One part on one staff whose clef switches between treble and bass again and again.

    That is how a piano page reads when the recogniser did not pair its staves into grand staves:
    each staff of the page becomes the next run of one long staff. Detected, never repaired.
    """
    root = _parse(data)
    parts = root.findall("part")
    if len(parts) != 1 or root.find(".//staves") is not None:
        return False
    signs = [el.findtext("sign") for el in parts[0].iter("clef")]
    changes = sum(1 for a, b in zip(signs, signs[1:]) if {a, b} == {"G", "F"})
    return changes >= 3


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def normalize(data: bytes) -> tuple[bytes, dict, list[dict]]:
    """The worker's export step: both lossless rules, and the warnings the review shows."""
    data, merged = merge_empty_measures(data)
    data, tied = ties_from_slurs(data)
    warnings = []
    if merged or tied:
        done = []
        if merged:
            done.append(_plural(merged, "empty measure joined its neighbour", "empty measures joined their neighbours"))
        if tied:
            done.append(_plural(tied, "slur joining one pitch to its continuation was read as a tie", "slurs joining one pitch to its continuation were read as ties"))
        warnings.append({
            "code": "recognition-export-normalized",
            "message": "The worker adjusted the export without changing any note: " + "; ".join(done) + ".",
        })
    if _unpaired_grand_staff(data):
        warnings.append({
            "code": "recognition-grand-staff-unpaired",
            "message": "The staves were not paired into a grand staff, so the hands are not separated. Try a flatter, evenly lit photo or the original PDF.",
        })
    return data, {"emptyMeasuresMerged": merged, "slursReadAsTies": tied}, warnings
