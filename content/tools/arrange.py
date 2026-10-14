"""Our own beginner arrangements, generated reproducibly with music21.

Each piece is written in a compact note spec (LilyPond-like *absolute* pitches):

    c'4      middle C (C4), quarter note        bes2.   B-flat 3, dotted half
    fis''8   F-sharp 5, eighth note             r4      quarter rest
    <c e g>1 chord (whole note)                 ~       tie to the next note
    (  )     slur start / end (after a note)    !mf     dynamic at this point
    ^fermata fermata on the note                |       bar line (checked)

A duration may be omitted: it is then inherited from the previous note, as in
LilyPond.  The right hand (rh) and left hand (lh) are separate strings with the
same number of bars; an optional pickup bar comes first.  build(slug) returns
MusicXML bytes (one part, two staves); build.py writes them to content/scores/.

CORE_PIECES below are the ten arrangements of the first library; their scores
must never change.  New arrangements live in arrangements/<collection>.py, one
module per collection, each with a reference per piece: the published melody
the built score must reproduce note for note (arrangements/__init__.py, checked
by tests/test_arrangements.py).  PIECES is CORE_PIECES followed by the pieces
of every collection module present.

The melodies are traditional or long in the public domain (see catalog.json
and the catalog.d/ fragments); the arrangements are original work of the
digitus2 project, dedicated to the public domain under CC0 1.0.  License of
this script: MIT.
"""
from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET
from fractions import Fraction as F
from pathlib import Path

ENCODING_DATE = "2026-10-13"  # fixed so that rebuilding gives byte-identical files

# ---------------------------------------------------------------------------
# The arrangements of the first library (new ones go to arrangements/<collection>.py)
# ---------------------------------------------------------------------------
CORE_PIECES: dict[str, dict] = {
    "twinkle-twinkle-little-star": dict(
        key="C", time="4/4", dynamic="mf",
        rh="""c'4 c' g' g' | a' a' g'2 | f'4 f' e' e' | d' d' c'2 |
              g'4 g' f' f' | e' e' d'2 | g'4 g' f' f' | e' e' d'2 |
              c'4 c' g' g' | a' a' g'2 | f'4 f' e' e' | d' d' c'2 |""",
        lh="""c1 | f2 c | f c | g c |
              c f | c g | c f | c g |
              c1 | f2 c | f c | g c |""",
    ),
    "mary-had-a-little-lamb": dict(
        key="C", time="4/4", dynamic="mf",
        rh="""e'4( d' c' d' | e' e' e'2) | d'4 d' d'2 | e'4( g' g'2) |
              e'4( d' c' d' | e' e' e' e') | d'( d' e' d' | c'1) |""",
        lh="""c1 | e | g | c |
              c | e | g | c |""",
    ),
    "ode-to-joy": dict(
        key="C", time="4/4", dynamic="mf",
        rh="""e'4( e' f' g' | g' f' e' d' | c' c' d' e' | e'4. d'8 d'2) |
              e'4( e' f' g' | g' f' e' d' | c' c' d' e' | d'4. c'8 c'2) |
              d'4( d' e' c' | d' e'8 f' e'4 c' | d' e'8 f' e'4 d' | c' d' g'2) |
              e'4( e' f' g' | g' f' e' d' | c' c' d' e' | d'4. c'8 c'2) |""",
        lh="""c1 | g | c | g |
              c | g | c | g2 c |
              g c | g c | g1 | c2 g |
              c1 | g | c | g2 c |""",
    ),
    "frere-jacques": dict(
        key="C", time="4/4", dynamic="mf",
        rh="""c'4( d' e' c') | c'( d' e' c') | e'( f' g'2) | e'4( f' g'2) |
              g'8( a' g' f' e'4 c') | g'8( a' g' f' e'4 c') | c'4( g c'2) | c'4( g c'2) |""",
        lh="""c2 g | c g | c g | c g |
              c g | c g | c1 | c |""",
    ),
    "jingle-bells": dict(
        key="C", time="4/4", dynamic="f",
        rh="""e'4 e' e'2 | e'4 e' e'2 | e'4 g' c'4. d'8 | e'1 |
              f'4 f' f'4. f'8 | f'4 e' e' e'8 e' | e'4 d' d' e' | d'2 g' |
              e'4 e' e'2 | e'4 e' e'2 | e'4 g' c'4. d'8 | e'1 |
              f'4 f' f' f' | f' e' e' e'8 e' | g'4 g' f' d' | c'1 |""",
        lh="""c2 g | c g | c g | c g |
              f c | c g | g d | g d |
              c g | c g | c g | c g |
              f c | c g | g d | c1 |""",
    ),
    "happy-birthday": dict(
        key="G", time="3/4", pickup="1/4", dynamic="mf",
        rh="""d'8. d'16 |
              e'4 d' g' | fis'2 d'8. d'16 | e'4 d' a' | g'2 d'8. d'16 |
              d''4 b' g' | fis' e'^fermata c''8. c''16 | b'4 g' a' | g'2. |""",
        lh="""r4 |
              <g, d>2. | <d a> | <d a> | <g, d> |
              <g, d> | <c g>2.^fermata | <g, d>2 <d a>4 | <g, d>2. |""",
    ),
    "amazing-grace": dict(
        key="G", time="3/4", pickup="1/4", dynamic="mp",
        rh="""d'4 |
              g'2( b'8 g') | b'2( a'4) | g'2( e'4) | d'2 d'4 |
              g'2( b'8 g') | b'2( a'4) | d''2 b'4 | d''4.( b'8) d''( b') |
              g'2 d'4 | e'4.( g'8) g'( e') | d'2 d'4 | g'2( b'8 g') |
              b'2( a'4) | g'2. |""",
        lh="""r4 |
              <g, d>2. | <g, d>2 <d a>4 | <c g>2. | <g, d> |
              <g, d> | <g, d>2 <d a>4 | <g, d>2. | <g, d> |
              <g, d> | <c g> | <g, d> | <g, d> |
              <d g>2 <d a>4 | <g, d>2. |""",
    ),
    "scarborough-fair": dict(
        key="d dorian", time="3/4", dynamic="mp",
        rh="""d'2 d'4 | a'8 a'4. a'4 | e'4.( f'8 e'4) | d'2. |
              r4 a' c'' | d''2 c''4 | a'( b' g') | a'2 d''4 |
              d''2 d''4 | c''2 a'4 | a'( g' f') | e'2. |
              d'2 a'4 | g'2 f'4 | e'( d' c') | d'2. |""",
        lh="""<d a>2. | <d a> | <a, e> | <d a> |
              <a, e> | <d a> | <d a>4 <g, d>2 | <d a>2. |
              <d a> | <a, e> | <d a> | <a, e> |
              <d a> | <a, e> | <a, e> | <d a> |""",
    ),
    "greensleeves": dict(
        key="a minor", time="6/8", pickup="1/8", dynamic="mp",
        rh="""a'8 |
              c''4 d''8 e''8. f''16 e''8 | d''4 b'8 g'8. a'16 b'8 | c''4 a'8 a'8. gis'16 a'8 | b'4 gis'8 e'4 a'8 |
              c''4 d''8 e''8. f''16 e''8 | d''4 b'8 g'8. a'16 b'8 | c''8. b'16 a'8 gis'8. fis'16 gis'8 | a'2. |
              g''4. g''8. fis''16 e''8 | d''4 b'8 g'8. a'16 b'8 | c''4 a'8 a'8. gis'16 a'8 | b'4 gis'8 e'4. |
              g''4. g''8. fis''16 e''8 | d''4 b'8 g'8. a'16 b'8 | c''8. b'16 a'8 gis'8. fis'16 gis'8 | a'2. |""",
        lh="""r8 |
              <a, e>2. | <g, d> | <a, e> | <e, b,> |
              <a, e> | <g, d> | <a, e>4. <e, b,> | <a, e>2. |
              <c g> | <g, d> | <a, e> | <e, b,> |
              <c g> | <g, d> | <a, e>4. <e, b,> | <a, e>2. |""",
    ),
    # Ground bass and first-violin lines in augmentation (half notes), as in most easy
    # editions: the melody keeps Pachelbel's 3rds/5ths against the bass note for note.
    "pachelbel-canon-in-d": dict(
        key="D", time="4/4", dynamic="mp",
        rh="""r1 | r1 | r1 | r1 |
              fis''2( e'' | d'' cis'' | b' a' | b' cis'') |
              d''2( cis'' | b' a' | g' fis' | g' e') | d'1 |""",
        lh="""d2 a, | b, fis, | g, d | g, a, |
              d a, | b, fis, | g, d | g, a, |
              d a, | b, fis, | g, d | g, a, | d1 |""",
    ),
}

# The new arrangements, one module per collection. arrange.py may run as a script under -I, which
# leaves this directory off sys.path.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
import arrangements  # noqa: E402

PIECES: dict[str, dict] = {**CORE_PIECES, **arrangements.load(core=CORE_PIECES)[0]}

STEPS = "cdefgab"
DUR = {"1": F(4), "2": F(2), "4": F(1), "8": F(1, 2), "16": F(1, 4), "32": F(1, 8)}
TOKEN = re.compile(r"""
    (?P<bar>\|)
  | (?P<dyn>!(?P<dname>[a-z]+))
  | (?:
      (?: <(?P<chord>[^>]+)> | (?P<pitch>[a-g](?:isis|eses|is|es|s)?[',]*|r) )
      (?P<dur>16|32|1|2|4|8)?(?P<dots>\.*)
      (?P<post>(?:~|\(|\)|\^fermata)*)
    )
""", re.X)


def lily_pitch(tok: str) -> str:
    """'fis'' -> 'F#5' (absolute LilyPond octave: c' = C4)."""
    m = re.fullmatch(r"([a-g])(isis|eses|is|es|s)?([',]*)", tok)
    if not m:
        raise ValueError(f"bad pitch {tok!r}")
    step, acc, octs = m.groups()
    alter = {"is": "#", "isis": "##", "es": "-", "s": "-", "eses": "--", None: ""}[acc]
    octave = 3 + octs.count("'") - octs.count(",")
    return f"{step.upper()}{alter}{octave}"


def parse(spec: str) -> list[list[dict]]:
    """Return bars, each a list of events {pitches|None, ql, tie, slur_start, slur_end, fermata, dyn}."""
    bars: list[list[dict]] = [[]]
    last = F(1)
    last_dots = 0
    pending_dyn = None
    pos = 0
    spec = spec.strip()
    while pos < len(spec):
        if spec[pos].isspace():
            pos += 1
            continue
        m = TOKEN.match(spec, pos)
        if not m or m.end() == pos:
            raise ValueError(f"cannot parse spec at: {spec[pos:pos + 30]!r}")
        pos = m.end()
        if m.group("bar"):
            bars.append([])
            continue
        if m.group("dyn"):
            pending_dyn = m.group("dname")
            continue
        if m.group("dur"):  # as in LilyPond, a missing duration repeats the previous one (dots included)
            last = DUR[m.group("dur")]
            last_dots = len(m.group("dots"))
        dots = last_dots
        ql = last * (2 - F(1, 2 ** dots))
        post = m.group("post") or ""
        if m.group("chord"):
            pitches = [lily_pitch(p) for p in m.group("chord").split()]
        elif m.group("pitch") == "r":
            pitches = None
        else:
            pitches = [lily_pitch(m.group("pitch"))]
        bars[-1].append(dict(pitches=pitches, ql=ql, tie="~" in post, slur_start="(" in post,
                             slur_end=")" in post, fermata="^fermata" in post, dyn=pending_dyn))
        pending_dyn = None
    if not bars[-1]:
        bars.pop()
    return bars


def _key(spec: str):
    from music21 import key

    parts = spec.split()
    tonic = parts[0]
    mode = parts[1] if len(parts) > 1 else ("minor" if tonic.islower() else "major")
    k = key.Key(tonic.upper() if mode == "major" else tonic.lower(), mode)
    return k


def build_score(slug: str, piece: dict, meta: dict):
    from music21 import (bar, clef, duration, dynamics, expressions, key, layout, meter, metadata, note,
                         chord, spanner, stream, tempo, tie)

    spec = PIECES[slug]
    ts_str = spec["time"]
    num, den = (int(x) for x in ts_str.split("/"))
    bar_ql = F(num * 4, den)
    pickup = F(spec["pickup"]) * 4 if spec.get("pickup") else None
    k = _key(spec["key"])
    score = stream.Score()
    md = metadata.Metadata()
    md.title = meta["title"]
    md.composer = meta["composer"]
    md.add("arranger", meta.get("arranger") or "digitus2 project")
    score.metadata = md
    parts = []
    for hand, clef_obj in (("rh", clef.TrebleClef()), ("lh", clef.BassClef())):
        bars = parse(spec[hand])
        part = stream.PartStaff(id=f"P1-{hand}")
        open_slur = None
        prev_tied: list | None = None
        notes_in_order = []
        for i, events in enumerate(bars):
            number = i if pickup else i + 1
            m = stream.Measure(number=number)
            total = sum((e["ql"] for e in events), F(0))
            expect = pickup if (pickup and i == 0) else bar_ql
            if total != expect:
                raise ValueError(f"{slug} {hand} bar {number}: {total} quarters, expected {expect}")
            if i == 0:
                m.insert(0, clef_obj)
                m.insert(0, k.__class__(k.tonic, k.mode))  # Key (not KeySignature): keeps the mode
                m.insert(0, meter.TimeSignature(ts_str))
                if hand == "rh":
                    if den == 8 and num % 3 == 0:  # compound metre: beat = dotted quarter
                        mm = tempo.MetronomeMark(number=round(meta["tempoBpm"] / 1.5),
                                                 referent=duration.Duration(1.5))
                    else:
                        mm = tempo.MetronomeMark(number=meta["tempoBpm"], referent=duration.Duration(1.0))
                    mm.placement = "above"
                    m.insert(0, mm)
                if pickup:
                    m.paddingLeft = float(bar_ql - pickup)
            off = F(0)
            for e in events:
                if e["pitches"] is None:
                    n = note.Rest(quarterLength=float(e["ql"]))
                elif len(e["pitches"]) == 1:
                    n = note.Note(e["pitches"][0], quarterLength=float(e["ql"]))
                else:
                    n = chord.Chord(e["pitches"], quarterLength=float(e["ql"]))
                if e["fermata"]:
                    n.expressions.append(expressions.Fermata())
                if e["dyn"]:
                    m.insert(float(off), dynamics.Dynamic(e["dyn"]))
                elif i == 0 and off == 0 and hand == "rh" and spec.get("dynamic"):
                    m.insert(0, dynamics.Dynamic(spec["dynamic"]))
                if prev_tied is not None and e["pitches"] is not None:
                    n.tie = tie.Tie("stop" if not e["tie"] else "continue")
                    prev_tied = None
                if e["tie"] and e["pitches"] is not None:
                    if n.tie is None:
                        n.tie = tie.Tie("start")
                    prev_tied = e["pitches"]
                m.insert(float(off), n)
                if e["slur_start"]:
                    open_slur = n
                if e["slur_end"] and open_slur is not None:
                    part.insert(0, spanner.Slur(open_slur, n))
                    open_slur = None
                notes_in_order.append(n)
                off += e["ql"]
            if i == len(bars) - 1:
                m.rightBarline = bar.Barline("final")
            part.append(m)
        if open_slur is not None:
            raise ValueError(f"{slug} {hand}: unclosed slur")
        parts.append(part)
    if len(parts[0].getElementsByClass("Measure")) != len(parts[1].getElementsByClass("Measure")):
        raise ValueError(f"{slug}: hands have different numbers of bars")
    for p in parts:
        score.insert(0, p)
    grp = layout.StaffGroup(parts, name="Piano", abbreviation="Pno.", symbol="brace")
    grp.barTogether = True
    score.insert(0, grp)
    return score


def to_musicxml(score) -> bytes:
    from music21.musicxml.m21ToXml import GeneralObjectExporter

    gex = GeneralObjectExporter(score)
    return gex.parse()


def postprocess(data: bytes, slug: str, meta: dict) -> bytes:
    """Normalise music21's output: fixed encoding date, our metadata, no credit blocks."""
    text = data.decode("utf-8")
    m = re.search(r"<score-partwise[^>]*>", text)
    head, body = text[:m.start()], text[m.start():]
    root = ET.fromstring(body)
    for c in root.findall("credit"):
        root.remove(c)
    for tag in ("movement-title", "movement-number"):
        for el in root.findall(tag):
            root.remove(el)
    work = root.find("work")
    if work is None:
        work = ET.Element("work")
        root.insert(0, work)
    for el in list(work):
        work.remove(el)
    ET.SubElement(work, "work-title").text = meta["title"]
    ident = root.find("identification")
    if ident is None:
        ident = ET.Element("identification")
        root.insert(1, ident)
    for el in list(ident):
        ident.remove(el)
    comp = meta["composer"] + (f" ({meta['composerDates']})" if meta.get("composerDates") else "")
    ET.SubElement(ident, "creator", type="composer").text = comp
    ET.SubElement(ident, "creator", type="arranger").text = meta.get("arranger") or "digitus2 project"
    ET.SubElement(ident, "rights").text = (
        "Melody in the public domain. Arrangement by the digitus2 project, dedicated to the public "
        "domain (CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/).")
    enc = ET.SubElement(ident, "encoding")
    import music21

    ET.SubElement(enc, "software").text = f"digitus2 arrange.py (music21 {music21.__version__})"
    ET.SubElement(enc, "encoding-date").text = ENCODING_DATE
    for el, val in (("accidental", "yes"), ("beam", "yes"), ("stem", "yes")):
        ET.SubElement(enc, "supports", element=el, type=val)
    # music21 writes the part name from the StaffGroup and a random part id; make both
    # consistent with the other library files (and the output reproducible)
    for sp in root.iter("score-part"):
        pn = sp.find("part-name")
        if pn is not None:
            pn.text = "Piano"
        if sp.find("part-abbreviation") is None:
            ab = ET.Element("part-abbreviation")
            ab.text = "Pno."
            sp.insert(list(sp).index(pn) + 1 if pn is not None else 0, ab)
        sp.set("id", "P1")
    for p in root.iter("part"):
        p.set("id", "P1")
    # pickup measure: MusicXML convention number="0" implicit="yes"
    part = root.find("part")
    first = part.find("measure")
    if first is not None and first.get("number") == "0":
        first.set("implicit", "yes")
    # rebuild ids to be deterministic (music21 uses random ids for some elements)
    for el in root.iter():
        if "id" in el.attrib and el.tag not in ("score-part", "part", "score-instrument", "midi-instrument"):
            del el.attrib["id"]
    ET.indent(root, space="  ")
    out = ET.tostring(root, encoding="unicode")
    doctype = ('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
               '"http://www.musicxml.org/dtds/partwise.dtd">')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + doctype + "\n" + out + "\n").encode("utf-8")


def build(slug: str, meta: dict) -> bytes:
    score = build_score(slug, PIECES[slug], meta)
    return postprocess(to_musicxml(score), slug, meta)


if __name__ == "__main__":
    from build import load_catalog  # catalog.json, then the catalog.d/ fragments

    sys.stdout.reconfigure(encoding="utf-8")
    here = Path(__file__).resolve().parent
    cat = {p["slug"]: p for p in load_catalog()}
    outdir = Path(sys.argv[1]) if len(sys.argv) > 1 else here.parent / "scores"
    for slug in (sys.argv[2:] or PIECES):
        data = build(slug, cat[slug])
        (outdir / f"{slug}.musicxml").write_bytes(data)
        print(f"{slug}: {len(data)} bytes")
