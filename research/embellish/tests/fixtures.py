"""Tiny MusicXML fixtures for the embellisher tests.

`score(...)` writes a one-part, two-staff piano score from compact bar lists. A bar is a list of
events; an event is `(pitch, quarters)` with pitch a name such as "C4", "F#4", "Bb3", "r" for a
rest, or a tuple of names for a chord. Options on an event go in a third item, a dict:
`{"tie": "start"|"stop", "tuplet": True, "fermata": True, "voice": "2"}`.

Staff 1 notes are voice 1 unless the bar is given in `rh2` (a second right-hand voice, voice 2);
staff 2 notes are voice 5. Divisions default to 12, which writes every value the tests need.
"""
from __future__ import annotations

from fractions import Fraction as F

STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
TYPES = {F(4): ("whole", 0), F(3): ("half", 1), F(2): ("half", 0), F(3, 2): ("quarter", 1), F(1): ("quarter", 0),
         F(3, 4): ("eighth", 1), F(1, 2): ("eighth", 0), F(1, 4): ("16th", 0), F(1, 3): ("eighth", 0),
         F(6): ("whole", 1)}


def _pitch_xml(name: str) -> str:
    step = name[0]
    rest = name[1:]
    alter = 0
    while rest and rest[0] in "#b":
        alter += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    alt = f"<alter>{alter}</alter>" if alter else ""
    return f"<pitch><step>{step}</step>{alt}<octave>{int(rest)}</octave></pitch>"


def _note(pitch, q, staff: str, voice: str, divisions: int, opts: dict, chord: bool = False) -> str:
    q = F(q)
    dur = q * divisions
    assert dur.denominator == 1, (q, divisions)
    typ, dots = ("eighth", 0) if opts.get("tuplet") else TYPES[q]
    parts = ["<note>"]
    if chord:
        parts.append("<chord/>")
    parts.append("<rest/>" if pitch == "r" else _pitch_xml(pitch))
    parts.append(f"<duration>{int(dur)}</duration>")
    if opts.get("tie"):
        parts.append(f'<tie type="{opts["tie"]}"/>')
    parts.append(f"<voice>{voice}</voice><type>{typ}</type>" + "<dot/>" * dots)
    if opts.get("tuplet"):
        parts.append("<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>"
                     "</time-modification>")
    parts.append(f"<staff>{staff}</staff>")
    notations = []
    if opts.get("tie"):
        notations.append(f'<tied type="{opts["tie"]}"/>')
    if opts.get("fermata"):
        notations.append("<fermata/>")
    if notations:
        parts.append("<notations>" + "".join(notations) + "</notations>")
    parts.append("</note>")
    return "".join(parts)


def _voice(events, staff: str, voice: str, divisions: int) -> tuple[str, int]:
    out, total = [], 0
    for ev in events:
        pitch, q = ev[0], ev[1]
        opts = ev[2] if len(ev) > 2 else {}
        v = opts.get("voice", voice)
        if isinstance(pitch, tuple):
            for k, p in enumerate(pitch):
                out.append(_note(p, q, staff, v, divisions, opts, chord=k > 0))
        else:
            out.append(_note(pitch, q, staff, v, divisions, opts))
        total += int(F(q) * divisions)
    return "".join(out), total


def score(rh: list, lh: list | None = None, *, time=(4, 4), fifths: int = 0, mode: str = "major",
          divisions: int = 12, rh2: list | None = None, staves: int = 2, pickup: bool = False,
          title: str = "Fixture") -> str:
    bars = len(rh)
    lh = lh if lh is not None else [[("C3", F(time[0] * 4, time[1]))] for _ in range(bars)]
    out =['<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
           '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
           '"http://www.musicxml.org/dtds/partwise.dtd">\n'
           f'<score-partwise version="4.0"><work><work-title>{title}</work-title></work>'
           '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">']
    for i in range(bars):
        implicit = ' implicit="yes"' if pickup and i == 0 else ""
        number = "0" if pickup and i == 0 else str(i + 1 - (1 if pickup else 0))
        out.append(f'<measure number="{number}"{implicit}>')
        if i == 0:
            out.append(f"<attributes><divisions>{divisions}</divisions><key><fifths>{fifths}</fifths>"
                       f"<mode>{mode}</mode></key><time><beats>{time[0]}</beats><beat-type>{time[1]}</beat-type>"
                       f"</time><staves>{staves}</staves><clef number=\"1\"><sign>G</sign><line>2</line></clef>"
                       + ("<clef number=\"2\"><sign>F</sign><line>4</line></clef>" if staves > 1 else "")
                       + "</attributes>")
        body, total = _voice(rh[i], "1", "1", divisions)
        out.append(body)
        if rh2 is not None and rh2[i]:
            out.append(f"<backup><duration>{total}</duration></backup>")
            body2, total2 = _voice(rh2[i], "1", "2", divisions)
            out.append(body2)
            total = total2
        if staves > 1 and lh[i]:
            out.append(f"<backup><duration>{total}</duration></backup>")
            body3, _ = _voice(lh[i], "2", "5", divisions)
            out.append(body3)
        out.append("</measure>")
    out.append("</part></score-partwise>\n")
    return "".join(out)
