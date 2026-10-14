"""Library adapter: one engine-dump piece (engine_dump.mjs) -> Passage windows with exact bars and beats.

A window is a run of 2 to 8 regular measures: plain numeric, consecutive numbers, one meter, and the
nominal length, except an upbeat (measure index 0) opening the window or a short last measure of the
piece closing it. Notes and rests belong to the window by onset tick, so a grace note written at the
end of a bar (a trill termination: Mozart K.545 bars 25 and 70) is shown on the next downbeat, where it
sounds. Bars and beats come from ticks: the window's first full measure is the anchor, and an upbeat bar
is numbered one less and right-aligned, as on the page. Chords take their longest note (as the PIG
adapter does); grace notes are separate "gr" events before their main note, in document order.
"""
from __future__ import annotations

import bisect
import re
from fractions import Fraction

from .model import Event, Passage, number_events
from .render import dur_label, parse_rendering, render_passage

GRACE_Q = Fraction(1, 24)
REST_MIN_Q = Fraction(1, 2)
MAX_BARS = 8
HIDDEN = ("unknown", "piano piece")

# What the reviewer sees instead of the title: a surname and a genre word (as in the pilot, which showed
# "Mozart (sonata, first movement)"). No "(" in a composer, no ")" in a style: render.py's header parser.
LIBRARY_STYLE: dict[str, tuple[str, str]] = {
    "twinkle-twinkle-little-star": ("Traditional", "children's song, arranged"),
    "mary-had-a-little-lamb": ("Traditional", "children's song, arranged"),
    "ode-to-joy": ("Beethoven", "symphonic theme, simplified"),
    "frere-jacques": ("Traditional", "round, arranged"),
    "jingle-bells": ("Pierpont", "song, arranged"),
    "happy-birthday": ("Hill", "song, arranged"),
    "amazing-grace": ("Traditional", "hymn, arranged"),
    "scarborough-fair": ("Traditional", "folk song, arranged"),
    "greensleeves": ("Traditional", "folk song, arranged"),
    "pachelbel-canon-in-d": ("Pachelbel", "canon, simplified"),
    "bach-minuet-g-major-bwv-anh-114": ("Petzold", "minuet"),
    "bach-minuet-g-minor-bwv-anh-115": ("Petzold", "minuet"),
    "mozart-minuet-f-major-k2": ("Mozart", "minuet"),
    "schumann-op68-no1-melody": ("Schumann", "character piece for children"),
    "burgmuller-op100-no1-la-candeur": ("Burgmüller", "study"),
    "burgmuller-op100-no2-arabesque": ("Burgmüller", "study"),
    "burgmuller-op100-no3-pastorale": ("Burgmüller", "study"),
    "burgmuller-op100-no5-innocence": ("Burgmüller", "study"),
    "schumann-op68-no8-wild-rider": ("Schumann", "character piece for children"),
    "clementi-sonatina-op36-no1-mvt1": ("Clementi", "sonatina, first movement"),
    "bach-prelude-c-major-bwv-846": ("Bach", "prelude"),
    "satie-gymnopedie-no1": ("Satie", "slow dance"),
    "beethoven-fur-elise-woo-59": ("Beethoven", "bagatelle"),
    "mozart-sonata-k545-mvt1": ("Mozart", "sonata, first movement"),
    "chopin-prelude-op28-no7": ("Chopin", "prelude"),
    "chopin-prelude-op28-no4": ("Chopin", "prelude"),
    "bach-invention-no1-bwv-772": ("Bach", "two-part invention"),
    "joplin-the-entertainer": ("Joplin", "rag"),
    "beethoven-moonlight-sonata-mvt1": ("Beethoven", "sonata, first movement"),
    "chopin-waltz-op69-no2": ("Chopin", "waltz"),
}


class IrregularWindow(ValueError):
    """The measures cannot be shown with constant bar arithmetic (render.py's Passage model)."""


def _nominal(piece: dict, m: dict) -> Fraction:
    return Fraction(piece["divisions"] * 4 * m["beats"], m["beatType"])


def measure_at(piece: dict, tick: int) -> int:
    """Index of the last measure whose startTick <= tick; -1 before the first measure."""
    return bisect.bisect_right([m["startTick"] for m in piece["measures"]], tick) - 1


def window_ticks(piece: dict, i1: int, i2: int) -> tuple[int, int]:
    """[startTick of measure i1, end of measure i2)."""
    ms = piece["measures"]
    return ms[i1]["startTick"], ms[i2]["startTick"] + ms[i2]["lengthTicks"]


def regular_anchor(piece: dict, i1: int, i2: int) -> int:
    """Index of the window's first full measure; raises IrregularWindow when measures i1..i2 cannot be
    shown with constant bar arithmetic."""
    ms = piece["measures"]
    if not 0 <= i1 < i2 < len(ms):
        raise IrregularWindow(f"measures {i1}..{i2}: a window has at least two measures of the piece")
    if i2 - i1 + 1 > MAX_BARS:
        raise IrregularWindow(f"{i2 - i1 + 1} measures; at most {MAX_BARS}")
    if len({(ms[i]["beats"], ms[i]["beatType"]) for i in range(i1, i2 + 1)}) != 1:
        raise IrregularWindow("the meter changes inside the window")
    anchor, prev = None, None
    for i in range(i1, i2 + 1):
        m = ms[i]
        if not m["number"].isdigit():
            raise IrregularWindow(f"measure number {m['number']!r} is not a plain number")
        num = int(m["number"])
        if prev is not None and num != prev + 1:
            raise IrregularWindow(f"measure numbers jump from {prev} to {num}")
        prev = num
        nominal = _nominal(piece, m)
        if m["lengthTicks"] == nominal:
            anchor = i if anchor is None else anchor
        elif not (m["lengthTicks"] < nominal and ((i == i1 == 0) or (i == i2 == len(ms) - 1))):
            raise IrregularWindow(f"measure {m['number']} has {m['lengthTicks']} ticks, not {nominal}")
    if anchor is None:
        raise IrregularWindow("no full measure in the window")
    return anchor


def count_notes(piece: dict, i1: int, i2: int, hand: str) -> int:
    """Notes of the hand whose onset lies in the window (grace notes count)."""
    t1, t2 = window_ticks(piece, i1, i2)
    return sum(1 for n in piece["notes"] if n["hand"] == hand and t1 <= n["onsetTick"] < t2)


def _tempo_at(piece: dict, tick: int) -> int:
    qpm = 120.0
    for ev in sorted(piece.get("tempoMap") or [], key=lambda e: e["tick"]):
        if ev["tick"] <= tick:
            qpm = ev["qpm"]
    return int(round(qpm))


def _seconds(piece: dict, tick: int) -> float:
    tempo = sorted(piece.get("tempoMap") or [{"tick": 0, "qpm": 120}], key=lambda e: e["tick"])
    sec, cursor, qpm = 0.0, 0, tempo[0]["qpm"] if tempo[0]["tick"] <= 0 else 120
    for ev in tempo:
        if ev["tick"] >= tick:
            break
        sec += (ev["tick"] - cursor) / piece["divisions"] * 60 / qpm
        cursor, qpm = ev["tick"], ev["qpm"]
    return sec + (tick - cursor) / piece["divisions"] * 60 / qpm


def _fallback_composer(piece: dict) -> str:
    words = re.sub(r"\s*\(.*?\)", "", piece.get("composer") or "").split()
    return words[-1] if words else HIDDEN[0]


def _hand_events(piece: dict, hand: str, t1: int, t2: int, q, show: bool) -> list[Event]:
    div = piece["divisions"]
    keyed: list[tuple[tuple, Event]] = []
    by_tick: dict[int, list[dict]] = {}
    for n in piece["notes"]:
        if n["hand"] == hand and t1 <= n["onsetTick"] < t2:
            by_tick.setdefault(n["onsetTick"], []).append(n)
    for tick, group in by_tick.items():
        graces = sorted((n for n in group if n["isGrace"]), key=lambda n: n["sourceIndex"])
        for k, g in enumerate(graces):
            keyed.append(((q(tick), 1, k), Event(hand, q(tick), g["onsetSec"], GRACE_Q, [g["midi"]],
                                                 [g["finger"] if show else 0], [], [g["id"]])))
        mains = sorted((n for n in group if not n["isGrace"]), key=lambda n: n["midi"])
        if mains:
            dur = max(Fraction(n["offsetTick"] - n["onsetTick"], div) for n in mains)
            keyed.append(((q(tick), 2, 0), Event(hand, q(tick), min(n["onsetSec"] for n in mains), dur,
                                                 [n["midi"] for n in mains],
                                                 [n["finger"] if show else 0 for n in mains], [],
                                                 [n["id"] for n in mains])))
    for r in piece["rests"]:
        if r["hand"] == hand and t1 <= r["startTick"] < t2:
            end = min(r["endTick"], t2)
            keyed.append(((q(r["startTick"]), 0, 0), Event(hand, q(r["startTick"]), _seconds(piece, r["startTick"]),
                                                          Fraction(end - r["startTick"], div))))
    keyed.sort(key=lambda kv: kv[0])
    evs = [e for _, e in keyed]
    while evs and evs[0].is_rest:
        evs.pop(0)
    while evs and evs[-1].is_rest:
        evs.pop()
    return evs


def library_window(piece: dict, i1: int, i2: int, hands: list[str], passage_id: str, *, fingers: str = "engine",
                   composer: str | None = None, style: str | None = None, first_bar: int | None = None) -> Passage:
    """Passage for measures i1..i2 (indices) of a library dump piece. ``fingers``: ``engine`` (the
    engine's fingers on the reviewed hands) or ``none``. ``composer`` and ``style`` replace the
    LIBRARY_STYLE entry; ``first_bar`` renumbers the window so that its first full measure has that
    number (an upbeat then gets one less). ``notes_meta['source']`` maps passage ids to engine ids and
    ``notes_meta['engine']`` holds each note's engine finger, confidence and lint rule ids."""
    if fingers not in ("engine", "none"):
        raise ValueError(f"fingers must be 'engine' or 'none', not {fingers!r}")
    anchor = regular_anchor(piece, i1, i2)
    ms, div = piece["measures"], piece["divisions"]
    a = ms[anchor]
    bar_q = Fraction(4 * a["beats"], a["beatType"])
    shift = 0 if first_bar is None else first_bar - int(a["number"])
    n_anchor = int(a["number"]) + shift
    origin = a["startTick"]
    t1, t2 = window_ticks(piece, i1, i2)

    def q(tick: int) -> Fraction:
        return Fraction(tick - origin, div) + (n_anchor - 1) * bar_q

    default = LIBRARY_STYLE.get(piece.get("slug", piece["id"]), (_fallback_composer(piece), HIDDEN[1]))
    p = Passage(passage_id=passage_id, composer=composer or default[0], style=style or default[1],
                meter=(a["beats"], a["beatType"]), tempo_qpm=_tempo_at(piece, t1),
                bar_first=int(ms[i1]["number"]) + shift, bar_last=int(ms[i2]["number"]) + shift,
                target_hands=list(hands))
    p.notes_meta.update({"bar1_q": 0, "piece": piece["id"], "measures": [i1, i2], "source": {}, "engine": {}})
    for hand in ("R", "L"):
        evs = _hand_events(piece, hand, t1, t2, q, show=(fingers == "engine" and hand in hands))
        if not evs:
            continue
        numbered = number_events(evs, hand)
        for e in numbered:
            for nid, sid in zip(e.ids, e.source_ids):
                p.notes_meta["source"][nid] = sid
        p.events[hand] = numbered
    by_id = {n["id"]: n for n in piece["notes"]}
    for nid, sid in p.notes_meta["source"].items():
        n = by_id[sid]
        p.notes_meta["engine"][nid] = {"id": sid, "finger": n["finger"], "confidence": n["confidence"],
                                       "lint": sorted({x.split(":")[0] for x in n["lint"]})}
    return p


def derive_rests(piece: dict) -> list[dict]:
    """The rests engine_dump.mjs writes, recomputed: silences of an eighth or more per hand (R, then L).
    A silence starts when every earlier note of the hand has ended; grace notes are ignored."""
    out, div = [], piece["divisions"]
    for hand in ("R", "L"):
        until = None
        notes = sorted((n for n in piece["notes"] if n["hand"] == hand and not n["isGrace"]),
                       key=lambda n: (n["onsetTick"], n["midi"]))
        for n in notes:
            if until is not None and Fraction(n["onsetTick"] - until, div) >= REST_MIN_Q:
                mi = measure_at(piece, until)
                m = piece["measures"][mi] if mi >= 0 else None
                out.append({"hand": hand, "startTick": until, "endTick": n["onsetTick"], "measureIndex": mi,
                            "measure": m["number"] if m else None,
                            "beatQ": (until - m["startTick"]) / div if m else None,
                            "durQ": (n["onsetTick"] - until) / div})
            until = n["offsetTick"] if until is None else max(until, n["offsetTick"])
    return out


def _rows(p: Passage, hand: str, fingers: bool) -> list[tuple]:
    return [(e.onset_q, dur_label(e.dur_q), tuple(e.pitches), tuple(e.fingers) if fingers and not e.is_rest else ())
            for e in p.events.get(hand, [])]


def render_round_trips(p: Passage) -> bool:
    """True when render_passage(p) parses back to the same events. render.py's fixed columns merge
    when a chord's pitch list reaches 16 characters or an id range 7 (Satie bar 36: A3+C#4+F#4+A4+D5);
    such a passage cannot be shown and is skipped by the selection."""
    try:
        back = parse_rendering(render_passage(p))
    except (ValueError, KeyError, IndexError, AssertionError):
        return False
    if back.target_hands != list(p.target_hands) or (back.bar_first, back.bar_last) != (p.bar_first, p.bar_last):
        return False
    return all(_rows(back, h, h in p.target_hands) == _rows(p, h, h in p.target_hands) for h in ("R", "L"))
