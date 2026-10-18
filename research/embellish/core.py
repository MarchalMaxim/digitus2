"""Deterministic diminution of a library melody: passing, neighbour and anticipation notes (issue #38).

The embellisher reads a partwise MusicXML score, finds the melody (the top voice of staff 1, the
right hand), and splits some melody notes in place: the note keeps its onset and pitch and gives the
end of its length to one or two new notes in the same voice and staff. No other note, measure length
or direction changes in content; the plain file is never written to. When the score's <divisions>
cannot write an eighth (a file with divisions 1), every <divisions>, <duration> and <offset>, and the
attack and release attributes of a note, are multiplied by the same factor first: the numbers change,
the music does not.

The file is written back by ElementTree, which re-emits the whole tree. Its content is the same
(elements, attributes, text, comments and processing instructions are kept, and the XML declaration
and DOCTYPE are copied from the input), but the bytes are not: an empty element is written as
`<x />` whatever its input form (`<x></x>`, `<x/>`), whitespace inside tags and the quoting of
attributes are normalised, character references are written as characters, and attributes in a
namespace other than `xml:` would get a generated prefix (MusicXML uses none).

Rules (each inserted note is diatonic in the key signature in force at its onset, never starts on
or holds across a strong position, and is the highest note sounding while it lasts):

  passing             A then B a third apart (both in the key, B starts where A ends): the weak end
                      of A becomes the scale step between them (C-E -> C-D-E).
  neighbour-repeated  A then B on the same pitch: the weak end of A becomes the upper scale step,
                      and B is the return (E-E -> E-F-E).
  neighbour-long      A of a half note or longer: A, its upper scale step, A again (G -> G-A-G).
  anticipation        A, a quarter or dotted quarter, before a downbeat note B (a different pitch
                      within a fifth, in the key): the last eighth of A sounds B early
                      (E | A -> E-A | A). Not from a half note or longer: such a note before a
                      downbeat usually ends a phrase, and the breath stays.

Where a note may be split: a single note of the melody voice (no chord, tie, tuplet, fermata or
grace), not in the last bar and not the last melody note, not in a bar whose time signature changes
after its first position, of a length the split table holds. The weak end is half the note
(quarter, half), a third (dotted half: 2 + 1), a quarter (whole: 3 + 1) or the last eighth (dotted
quarter: 1 + 1/2); no new note is shorter than an eighth. Strong positions are the downbeat and, in
4/4, 2/2, 4/2, 6/4, 4/8, 6/8 and 12/8, the middle of the bar; a pickup bar is counted from its end.
The key is the key signature's major scale (a minor key uses its relative major's notes, the
natural minor); a key change inside a bar applies from its position.

Densities: `none` returns the input unchanged; `light` uses passing and neighbour-repeated, at most
one figure per bar and never in two neighbouring bars; `playful` uses all four rules, at most two
figures per bar. Candidates are taken in rule order (passing, neighbour-repeated, anticipation,
neighbour-long), then by onset; a note carries at most one figure. No randomness.

Refusals (the piece is returned unchanged with a reason): not one partwise part, not two staves, no
melody voice owning at least 90% of the right hand's top line, or a melody voice of which more than
a quarter of the onsets are chords.

Standard library only. License: MIT.
"""
from __future__ import annotations

import copy
import re
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass, field
from fractions import Fraction as F
from math import gcd

DENSITIES = ("none", "light", "playful")
RULES = ("passing", "neighbour-repeated", "anticipation", "neighbour-long")  # priority order
DENSITY_RULES = {"none": (), "light": ("passing", "neighbour-repeated"), "playful": RULES}
DENSITY_PER_BAR = {"none": 0, "light": 1, "playful": 2}
SPACED = {"light"}  # no figure in a bar next to a bar that has one
OWNER_MIN = 0.90
CHORD_MAX = 0.25
STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
MAJOR = (0, 2, 4, 5, 7, 9, 11)
HALF_BAR_STRONG = {(4, 4), (2, 2), (4, 2), (6, 4), (4, 8), (6, 8), (12, 8)}
TYPE_OF = {F(4): ("whole", 0), F(3): ("half", 1), F(2): ("half", 0), F(3, 2): ("quarter", 1),
           F(1): ("quarter", 0), F(3, 4): ("eighth", 1), F(1, 2): ("eighth", 0)}
H = F(1, 2)
# A's length -> the lengths of A and the new note(s); simple meters and compound meters
SPLIT_END = {False: {F(1): (H, H), F(3, 2): (F(1), H), F(2): (F(1), F(1)), F(3): (F(2), F(1)), F(4): (F(3), F(1))},
             True: {F(1): (H, H), F(3, 2): (F(1), H)}}
SPLIT_LONG = {False: {F(2): (F(1), H, H), F(3): (F(1), F(1), F(1)), F(4): (F(3), H, H)}, True: {}}
# no anticipation from a half note or longer: a long note before a downbeat usually ends a phrase
SPLIT_LAST_EIGHTH = {False: {F(1): (H, H), F(3, 2): (F(1), H)},
                     True: {F(1): (H, H), F(3, 2): (F(1), H)}}


@dataclass
class Measure:
    idx: int
    number: str
    el: ET.Element
    start: F           # quarters from the start of the score, as written
    length: F          # actual length (the furthest position reached)
    time: tuple[int, int] | None
    fifths: int
    offset: F = F(0)   # added to a position to get the metric position (a pickup bar counts from its end)
    inner_time_change: bool = False  # a <time> inside the bar, after its first position

    @property
    def nominal(self) -> F | None:
        return F(self.time[0] * 4, self.time[1]) if self.time else None

    @property
    def compound(self) -> bool:
        return bool(self.time) and self.time[1] == 8 and self.time[0] % 3 == 0 and self.time[0] >= 6

    @property
    def beat_q(self) -> F:
        if not self.time:
            return F(1)
        return F(3, 2) if self.compound else F(4, self.time[1])

    def strong(self, metric: F) -> bool:
        if metric == 0:
            return True
        return bool(self.time) and tuple(self.time) in HALF_BAR_STRONG and metric == self.nominal / 2

    def sounds_through_strong(self, start: F, end: F) -> bool:
        """A note from metric position `start` to `end` holds across a strong position (not starting on it)."""
        if not self.time:
            return False
        marks = [self.nominal / 2] if tuple(self.time) in HALF_BAR_STRONG else []
        return any(start < s < end for s in marks + [self.nominal])


@dataclass
class Note:
    el: ET.Element
    measure: Measure
    onset: F
    rel: F
    dur: F
    divisions: int
    pitch: int | None
    voice: str
    staff: str
    chord: bool
    grace: bool
    tie: bool
    tuplet: bool
    fermata: bool
    fifths: int = 0  # the key signature in force at the note's onset

    @property
    def end(self) -> F:
        return self.onset + self.dur


@dataclass
class Group:
    """The notes of one voice that start together (a single note or a chord)."""
    notes: list[Note]

    @property
    def onset(self) -> F:
        return self.notes[0].onset

    @property
    def top(self) -> Note:
        return max(self.notes, key=lambda n: n.pitch)

    @property
    def single(self) -> bool:
        return len(self.notes) == 1


@dataclass
class Piece:
    root: ET.Element | None
    measures: list[Measure] = field(default_factory=list)
    notes: list[Note] = field(default_factory=list)
    staves: int = 1
    parts: int = 0
    melody_voice: str | None = None
    melody: list[Group] = field(default_factory=list)
    refusal: str | None = None
    owner_share: float | None = None
    chord_share: float | None = None


@dataclass
class Result:
    xml: str
    inserted: list[dict]
    refusal: str | None
    skipped: Counter
    melody_voice: str | None = None
    candidates: Counter = field(default_factory=Counter)


def _int(text: str | None, default: int = 0) -> int:
    try:
        return int(float(text)) if text is not None else default
    except ValueError:
        return default


def _pitch(el: ET.Element) -> int | None:
    p = el.find("pitch")
    if p is None:
        return None
    alter = p.findtext("alter")
    return 12 * (int(p.findtext("octave")) + 1) + STEPS[p.findtext("step").strip()] + int(round(float(alter or 0)))


def parse(text: str) -> ET.Element:
    parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True, insert_pis=True))
    parser.feed(text)
    return parser.close()


def analyse(text: str) -> Piece:
    """The piece's timeline, its melody voice, or the reason it is refused."""
    root = parse(text)
    piece = Piece(root)
    if root.tag != "score-partwise":
        piece.refusal = f"not a partwise score ({root.tag})"
        return piece
    parts = root.findall("part")
    piece.parts = len(parts)
    if len(parts) != 1:
        piece.refusal = f"{len(parts)} parts: the hands are not one piano part"
        return piece
    divisions, fifths, time, staves = 1, 0, None, 1
    abs_start = F(0)
    key_changes: list[tuple[F, int]] = []  # (onset, fifths) in document order
    for mi, m in enumerate(parts[0].findall("measure")):
        pos = F(0)
        maxpos = F(0)
        last_start = F(0)
        meas = Measure(mi, m.get("number", ""), m, abs_start, F(0), time, fifths)
        for el in m:
            if el.tag == "attributes":
                if el.find("divisions") is not None:
                    divisions = _int(el.findtext("divisions"), 1) or 1
                if el.find("staves") is not None:
                    staves = _int(el.findtext("staves"), 1)
                k = el.find("key/fifths")
                if k is not None:
                    fifths = _int(k.text)
                    key_changes.append((abs_start + pos, fifths))
                    if pos == 0:
                        meas.fifths = fifths
                t = el.find("time")
                if t is not None and t.find("beats") is not None:
                    beats = t.findtext("beats")
                    if re.fullmatch(r"\d+", (beats or "").strip()):
                        time = (int(beats), _int(t.findtext("beat-type"), 4))
                    else:
                        time = None
                    if pos == 0:
                        meas.time = time
                    else:
                        meas.inner_time_change = True
            elif el.tag == "backup":
                pos -= F(_int(el.findtext("duration")), divisions)
            elif el.tag == "forward":
                pos += F(_int(el.findtext("duration")), divisions)
                maxpos = max(maxpos, pos)
            elif el.tag == "note":
                grace = el.find("grace") is not None
                chord = el.find("chord") is not None
                dur = F(0) if grace else F(_int(el.findtext("duration")), divisions)
                start = last_start if chord else pos
                if not chord and not grace:
                    last_start = pos
                n = Note(el, meas, abs_start + start, start, dur, divisions, _pitch(el),
                         (el.findtext("voice") or "1").strip(), (el.findtext("staff") or "1").strip(), chord, grace,
                         el.find("tie") is not None or el.find("notations/tied") is not None,
                         el.find("time-modification") is not None, el.find("notations/fermata") is not None)
                piece.notes.append(n)
                if not chord and not grace:
                    pos += dur
                maxpos = max(maxpos, pos)
        meas.length = maxpos
        nominal = meas.nominal
        if nominal is not None and meas.length < nominal and (mi == 0 or m.get("implicit") == "yes"):
            meas.offset = nominal - meas.length
        piece.measures.append(meas)
        abs_start += meas.length
    for n in piece.notes:  # a key change applies from its position, whatever the document order
        n.fifths = next((f for t, f in reversed(key_changes) if t <= n.onset), 0)
    piece.staves = staves
    if staves != 2:
        piece.refusal = f"{staves} staff/staves: the right hand is not a staff of its own"
        return piece
    _find_melody(piece)
    return piece


def _sounding(notes: list[Note], t: F) -> list[Note]:
    return [n for n in notes if n.onset <= t < n.end]


def _find_melody(piece: Piece) -> None:
    rh = [n for n in piece.notes if n.staff == "1" and n.pitch is not None and not n.grace and n.dur > 0]
    if not rh:
        piece.refusal = "no right-hand notes"
        return
    instants = sorted({n.onset for n in rh})
    owners: Counter = Counter()
    by_start = sorted(rh, key=lambda n: n.onset)
    for t in instants:
        sounding = [n for n in by_start if n.onset <= t < n.end]
        top = max(sounding, key=lambda n: (n.pitch, n.onset == t))
        owners[top.voice] += 1
    voice, owned = owners.most_common(1)[0]
    piece.owner_share = owned / len(instants)
    if piece.owner_share < OWNER_MIN:
        piece.refusal = (f"no voice owns the right hand's top line: voice {voice} has it at "
                         f"{100 * piece.owner_share:.0f}% of the onsets (needs {100 * OWNER_MIN:.0f}%)")
        return
    groups: dict[F, list[Note]] = {}
    for n in rh:
        if n.voice == voice:
            groups.setdefault(n.onset, []).append(n)
    melody = [Group(groups[t]) for t in sorted(groups)]
    chords = sum(1 for g in melody if not g.single)
    piece.chord_share = chords / len(melody)
    if piece.chord_share > CHORD_MAX:
        piece.refusal = (f"the melody voice plays chords at {100 * piece.chord_share:.0f}% of its onsets "
                         f"(at most {100 * CHORD_MAX:.0f}%)")
        return
    piece.melody_voice = voice
    piece.melody = melody


# ---- pitch helpers ------------------------------------------------------------------------------

def scale(fifths: int) -> set[int]:
    tonic = (7 * fifths) % 12
    return {(tonic + d) % 12 for d in MAJOR}


def key_alters(fifths: int) -> dict[str, int]:
    alters = {s: 0 for s in STEPS}
    if fifths > 0:
        for s in "FCGDAEB"[:fifths]:
            alters[s] = 1
    elif fifths < 0:
        for s in "BEADGCF"[:-fifths]:
            alters[s] = -1
    return alters


def spell(midi: int, fifths: int) -> tuple[str, int, int]:
    """(step, alter, octave) of a pitch of the key's scale, spelled as the key signature spells it."""
    alters = key_alters(fifths)
    for step, semis in STEPS.items():
        if (semis + alters[step]) % 12 == midi % 12:
            return step, alters[step], (midi - alters[step]) // 12 - 1
    raise ValueError(f"{midi} is not in the scale of {fifths} fifths")


def pitch_name(midi: int, fifths: int) -> str:
    step, alter, octave = spell(midi, fifths)
    return step + ("#" * alter if alter > 0 else "b" * -alter) + str(octave)


def step_above(p: int, sc: set[int]) -> int | None:
    if p % 12 not in sc:
        return None
    for k in (1, 2):
        if (p + k) % 12 in sc:
            return p + k
    return None


def between(a: int, b: int, sc: set[int]) -> int | None:
    lo, hi = min(a, b), max(a, b)
    inside = [p for p in range(lo + 1, hi) if p % 12 in sc]
    return inside[0] if len(inside) == 1 else None


def fmt_beat(b: F) -> str:
    if b.denominator == 1:
        return str(b.numerator)
    return f"{float(b):.3f}".rstrip("0").rstrip(".")


# ---- candidates ---------------------------------------------------------------------------------

@dataclass
class Candidate:
    rule: str
    a: Note
    parts: list[tuple[F, int | None, str]]  # (length, pitch or None for A itself, role)

    @property
    def priority(self) -> int:
        return RULES.index(self.rule)


def _candidates(piece: Piece, skipped: Counter) -> list[Candidate]:
    out: list[Candidate] = []
    melody = piece.melody
    last_measure = piece.measures[-1].idx
    others = [n for n in piece.notes if n.pitch is not None and not n.grace and n.dur > 0]
    graces = {n.onset for n in piece.notes if n.grace and n.staff == "1"}
    for i, g in enumerate(melody):
        if not g.single:
            skipped["chord"] += 1
            continue
        a = g.notes[0]
        m = a.measure
        reason = None
        if i == len(melody) - 1 or m.idx == last_measure:
            reason = "last bar"
        elif a.tie:
            reason = "tied"
        elif a.tuplet:
            reason = "tuplet"
        elif a.fermata:
            reason = "fermata"
        elif m.time is None:
            reason = "no time signature"
        elif m.inner_time_change:
            reason = "time change inside the bar"
        if reason:
            skipped[reason] += 1
            continue
        nxt = melody[i + 1]
        b = nxt.top
        contiguous = nxt.onset == a.end and nxt.onset not in graces
        sc = scale(a.fifths)
        same_key = b.fifths == a.fifths
        found = []
        if contiguous and same_key and abs(b.pitch - a.pitch) in (3, 4) and a.pitch % 12 in sc and b.pitch % 12 in sc:
            mid = between(a.pitch, b.pitch, sc)
            if mid is not None:
                found.append(("passing", SPLIT_END[m.compound], [mid]))
        if contiguous and b.pitch == a.pitch:
            up = step_above(a.pitch, sc)
            if up is not None:
                found.append(("neighbour-repeated", SPLIT_END[m.compound], [up]))
        if (contiguous and same_key and b.pitch != a.pitch and abs(b.pitch - a.pitch) <= 7 and b.pitch % 12 in sc
                and b.rel + b.measure.offset == 0 and b.measure.idx == m.idx + 1):
            found.append(("anticipation", SPLIT_LAST_EIGHTH[m.compound], [b.pitch]))
        up = step_above(a.pitch, sc)
        if up is not None:
            found.append(("neighbour-long", SPLIT_LONG[m.compound], [up, a.pitch]))
        reasons: list[str] = []  # why each matching rule could not be used, in rule order
        made = 0
        for rule, table, pitches in found:
            lengths = table.get(a.dur)
            if lengths is None:
                if rule != "neighbour-long":  # every note in the key "matches" it; only long notes qualify
                    reasons.append("too short or odd length")
                continue
            if any((x * a.divisions).denominator != 1 for x in lengths):
                reasons.append("divisions")
                continue
            t = a.onset + lengths[0]
            why = None
            for k, (length, p) in enumerate(zip(lengths[1:], pitches)):
                metric = t - m.start + m.offset
                if m.strong(metric) or m.sounds_through_strong(metric, metric + length):
                    why = "strong beat"
                    break
                role = "return" if rule == "neighbour-long" and k == 1 else "neighbour"
                if role != "return":
                    sound = [n for n in others if n is not a and n.onset < t + length and n.end > t]
                    if any(n.pitch >= p for n in sound):
                        why = "not the top line"
                        break
                    bar_notes = [n for n in others if n.measure is m]
                    if any(n.pitch % 12 not in sc and (n.pitch - p) % 12 in (1, 11) for n in bar_notes):
                        why = "accidental nearby"
                        break
                t += length
            if why:
                reasons.append(why)
                continue
            roles = {"passing": ["passing"], "neighbour-repeated": ["neighbour"], "anticipation": ["anticipation"],
                     "neighbour-long": ["neighbour", "return"]}[rule]
            parts = [(lengths[0], None, "melody")] + [(ln, p, r) for ln, p, r in zip(lengths[1:], pitches, roles)]
            out.append(Candidate(rule, a, parts))
            made += 1
        if not made:
            skipped[reasons[0] if reasons else "no rule fits"] += 1
    return out


def divisions_factor(piece: Piece) -> int:
    """The factor that lets every split of a melody note be written in the piece's divisions (1 if none
    is needed); 0 when a factor up to 12 does not suffice."""
    need = 1
    for g in piece.melody:
        if not g.single:
            continue
        a = g.notes[0]
        compound = a.measure.compound
        for table in (SPLIT_END[compound], SPLIT_LONG[compound], SPLIT_LAST_EIGHTH[compound]):
            for x in table.get(a.dur, ()):
                need = need * (x * a.divisions).denominator // gcd(need, (x * a.divisions).denominator)
    return need if need <= 12 else 0


def scale_divisions(root: ET.Element, factor: int) -> None:
    """Multiplies every <divisions>, <duration> and <offset>, and each note's attack and release, by
    `factor`: the same music in finer units."""
    for el in root.iter():
        if el.tag in ("divisions", "duration", "offset") and el.text and el.text.strip():
            v = F(el.text.strip()) * factor
            el.text = str(v.numerator) if v.denominator == 1 else str(float(v))
        if el.tag == "note":
            for attr in ("attack", "release"):
                if el.get(attr):
                    v = F(el.get(attr)) * factor
                    el.set(attr, str(v.numerator) if v.denominator == 1 else str(float(v)))


def _select(cands: list[Candidate], density: str) -> list[Candidate]:
    allowed = DENSITY_RULES[density]
    limit = DENSITY_PER_BAR[density]
    chosen, used, per_bar = [], set(), Counter()
    for c in sorted((c for c in cands if c.rule in allowed), key=lambda c: (c.priority, c.a.onset)):
        bar = c.a.measure.idx
        if id(c.a) in used or per_bar[bar] >= limit:
            continue
        if density in SPACED and (per_bar[bar - 1] or per_bar[bar + 1]):
            continue
        chosen.append(c)
        used.add(id(c.a))
        per_bar[c.a.measure.idx] += 1
    return sorted(chosen, key=lambda c: c.a.onset)


# ---- writing ------------------------------------------------------------------------------------

def _set_length(el: ET.Element, length: F, divisions: int) -> None:
    el.find("duration").text = str(int(length * divisions))
    typ, dots = TYPE_OF[length]
    for d in el.findall("dot"):
        el.remove(d)
    for b in el.findall("beam"):
        el.remove(b)
    t = el.find("type")
    if t is None:
        t = ET.Element("type")
        children = list(el)
        voice = el.find("voice")
        el.insert(children.index(voice) + 1 if voice is not None else len(children), t)
    t.text = typ
    at = list(el).index(t)
    for k in range(dots):
        el.insert(at + 1 + k, ET.Element("dot"))


def _new_note(a: Note, midi: int, length: F, fifths: int, same_spelling: bool) -> ET.Element:
    n = ET.Element("note")
    if same_spelling:
        n.append(copy.deepcopy(a.el.find("pitch")))
    else:
        step, alter, octave = spell(midi, fifths)
        p = ET.SubElement(n, "pitch")
        ET.SubElement(p, "step").text = step
        if alter:
            ET.SubElement(p, "alter").text = str(alter)
        ET.SubElement(p, "octave").text = str(octave)
    ET.SubElement(n, "duration").text = str(int(length * a.divisions))
    ET.SubElement(n, "voice").text = a.voice
    typ, dots = TYPE_OF[length]
    ET.SubElement(n, "type").text = typ
    for _ in range(dots):
        ET.SubElement(n, "dot")
    stem = a.el.find("stem")
    if stem is not None:
        ET.SubElement(n, "stem").text = stem.text
    if a.el.find("staff") is not None:
        ET.SubElement(n, "staff").text = a.staff
    n.tail = a.el.tail
    return n


def serialise(original: str, root: ET.Element) -> str:
    start = re.search(r"<score-partwise\b", original)
    end = original.rfind("</score-partwise>")
    head = original[:start.start()] if start else '<?xml version="1.0" encoding="UTF-8"?>\n'
    tail = original[end + len("</score-partwise>"):] if end >= 0 else "\n"
    return head + ET.tostring(root, encoding="unicode") + tail


def embellish(text: str, density: str) -> Result:
    if density not in DENSITIES:
        raise ValueError(f"density must be one of {DENSITIES}, not {density!r}")
    skipped: Counter = Counter()
    if density == "none":
        return Result(text, [], None, skipped)
    piece = analyse(text)
    if piece.refusal:
        return Result(text, [], piece.refusal, skipped)
    base = text
    factor = divisions_factor(piece)
    if factor > 1:
        scale_divisions(piece.root, factor)
        base = serialise(text, piece.root)
        piece = analyse(base)
    cands = _candidates(piece, skipped)
    chosen = _select(cands, density)
    inserted = []
    for c in chosen:
        a, m = c.a, c.a.measure
        parent = m.el
        _set_length(a.el, c.parts[0][0], a.divisions)
        at = list(parent).index(a.el)
        t = a.onset + c.parts[0][0]
        for k, (length, midi, role) in enumerate(c.parts[1:], start=1):
            el = _new_note(a, midi, length, a.fifths, same_spelling=(midi == a.pitch and role == "return"))
            parent.insert(at + k, el)
            metric = t - m.start + m.offset
            inserted.append({"bar": m.number, "beat": fmt_beat(metric / m.beat_q + 1), "onset": t,
                             "pitch": pitch_name(midi, a.fifths) if role != "return" else _name_of(a.el),
                             "midi": midi, "rule": c.rule, "role": role,
                             "length": fmt_beat(length)})
            t += length
    xml = serialise(text, piece.root) if inserted else text
    return Result(xml, inserted, None, skipped, piece.melody_voice, Counter(c.rule for c in cands))


def _name_of(el: ET.Element) -> str:
    p = el.find("pitch")
    alter = int(round(float(p.findtext("alter") or 0)))
    return p.findtext("step").strip() + ("#" * alter if alter > 0 else "b" * -alter) + p.findtext("octave").strip()
