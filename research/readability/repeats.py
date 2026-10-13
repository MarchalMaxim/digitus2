"""Do editors print fingerings again on repeated passages?

For each part and hand the notes are grouped into events (:func:`readability.corpus.events`).
An event is described by its pitch tuple (sorted), the duration of each of its notes in beats and
the inter-onset interval (IOI) to the next event, all beat values rounded to 1/48 of a quarter.

Two segments of ``k >= 4`` consecutive events *match up to transposition* when every event of the
second is the corresponding event of the first shifted by the same number of semitones, the note
durations agree, and the IOIs between consecutive events agree (the IOI after the last event is
not compared). This is implemented with two integer tokens per event:

* ``shape[t]``: (pitch offsets from the event's lowest pitch, quantised note durations);
* ``link[t]`` (``t > 0``): (``shape[t]``, step from the lowest pitch of event ``t-1`` to that of
  event ``t``, quantised IOI from event ``t-1`` to ``t``).

Segments ``i..i+L-1`` and ``j..j+L-1`` match iff ``shape[i] == shape[j]`` and
``link[i+m] == link[j+m]`` for ``m = 1..L-1``.

Search (greedy, left to right, hashing 4-event windows): at each position ``j`` not already inside
a later occurrence, the candidates are the earlier window starts with the same 4-event key
(``shape[j], link[j+1], link[j+2], link[j+3]``); each candidate ``i`` is extended as far as the
tokens agree without the two occurrences overlapping (``i + L <= j``). The longest extension wins
(earliest ``i`` on ties); if it reaches 4 events, ``j..j+L-1`` becomes a later occurrence of
``i..i+L-1`` (maximal under the greedy scan) and the scan continues after it. Later occurrences
never overlap each other or their own first occurrence. Window starts inside later occurrences are
never registered, and at most ``MAX_CANDIDATES`` candidates are tried per key, which keeps the
scan linear in practice.

A first occurrence may itself contain events of an earlier later occurrence (a phrase that
already repeats a motif internally). Each event therefore gets a *root*: itself if it is in no
later occurrence, else the root of the aligned event of its first occurrence. Roots are the
earliest statement of that material, and matching composes (shifts add up, shapes are equal), so
every later note is compared with the note of the same chord rank in its root event. "First
occurrence notes" are the root notes that some later note is aligned with.

Each later occurrence is classified against its root events: ``exact`` (all shifts 0),
``transposed_same_pattern`` (one constant nonzero shift, same black/white key pattern over all
its notes), ``transposed_diff_pattern`` (constant nonzero shift, different pattern) or
``mixed_shift`` (roots reached through different shifts); and against its direct first occurrence
as ``adjacent`` (starts right where it ends) or ``distant``; and by length (``len_ge_8``,
``len_ge_16`` events).

Usage (from ``research/``)::

    .venv-readability/Scripts/python.exe -X utf8 -m readability.repeats
"""
from __future__ import annotations

import json
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from readability import keyboard as K
from readability.corpus import LH, RH, NoteRec, Part, events
from readability.features import DEFAULT_SEC_PER_BEAT

MIN_EVENTS = 4
GRID = 48                       # beats are rounded to 1/48 of a quarter note
MAX_CANDIDATES = 64
RESULTS_DIR = Path(__file__).resolve().parent / "results"
GROUPS = ("overall", "teaching", "concert", "other", "library")
KINDS = ("exact", "transposed_same_pattern", "transposed_diff_pattern", "mixed_shift")
CATEGORIES = ("all",) + KINDS + ("adjacent", "distant", "len_ge_8", "len_ge_16", "exact_len_ge_8")
COMMAND = "cd research && OMP_NUM_THREADS=2 .venv-readability/Scripts/python.exe -X utf8 -m readability.repeats"


@dataclass(frozen=True)
class Occurrence:
    """A later occurrence ``later..later+length-1`` of the segment ``first..first+length-1`` (event indices)."""

    first: int
    later: int
    length: int
    shift: int        # semitones, later minus direct first occurrence
    kind: str         # one of KINDS, relative to the root events

    @property
    def adjacent(self) -> bool:
        return self.later == self.first + self.length

    def in_category(self, cat: str) -> bool:
        if cat == "all":
            return True
        if cat == "adjacent":
            return self.adjacent
        if cat == "distant":
            return not self.adjacent
        if cat == "len_ge_8":
            return self.length >= 8
        if cat == "len_ge_16":
            return self.length >= 16
        if cat == "exact_len_ge_8":
            return self.kind == "exact" and self.length >= 8
        return self.kind == cat


def _q(x: float) -> int:
    return int(round(x * GRID))


def _beat(n: NoteRec) -> float:
    return n.beat if n.beat is not None else n.onset / DEFAULT_SEC_PER_BEAT


def _dur(n: NoteRec) -> float:
    return n.dur_beats if n.dur_beats is not None else n.duration / DEFAULT_SEC_PER_BEAT


def event_tokens(evs: list[list[NoteRec]]) -> tuple[list[int], list[int], list[int]]:
    """Integer ``shape`` and ``link`` tokens per event plus each event's lowest pitch.

    ``link[0]`` is -1 (the first event has no predecessor).
    """
    ids: dict[tuple, int] = {}
    shape: list[int] = []
    link: list[int] = []
    low: list[int] = []
    prev_low = prev_beat = None
    for ev in evs:
        lo = ev[0].pitch
        s = ("s", tuple(n.pitch - lo for n in ev), tuple(_q(_dur(n)) for n in ev))
        sid = ids.setdefault(s, len(ids))
        b = _beat(ev[0])
        if prev_low is None:
            lid = -1
        else:
            lid = ids.setdefault(("l", sid, lo - prev_low, _q(b - prev_beat)), len(ids))
        shape.append(sid)
        link.append(lid)
        low.append(lo)
        prev_low, prev_beat = lo, b
    return shape, link, low


def _black(ev: list[NoteRec]) -> tuple[bool, ...]:
    return tuple(K.is_black(n.pitch) for n in ev)


def root_map(n_events: int, occs: list[Occurrence]) -> list[int]:
    """Root event of every event: itself, or (through the chain of matches) its earliest statement."""
    root = list(range(n_events))
    for o in sorted(occs, key=lambda x: x.later):
        for t in range(o.length):
            root[o.later + t] = root[o.first + t]
    return root


def find_repeats(evs: list[list[NoteRec]], min_len: int = MIN_EVENTS,
                 max_candidates: int = MAX_CANDIDATES) -> list[Occurrence]:
    """Greedy non-overlapping maximal repeated segments of at least ``min_len`` events (see module doc)."""
    n = len(evs)
    if n < 2 * min_len:
        return []
    shape, link, low = event_tokens(evs)
    root = list(range(n))
    table: dict[tuple, list[int]] = {}
    out: list[Occurrence] = []
    j = 0
    while j + min_len <= n:
        key = (shape[j],) + tuple(link[j + 1:j + min_len])
        best_len, best_i = 0, -1
        for i in table.get(key, ())[:max_candidates]:
            if i + min_len > j:
                break                       # candidates are in increasing order
            limit = min(j - i, n - j)       # no overlap; stay inside the sequence
            L = min_len                     # the key guarantees the first min_len events match
            while L < limit and link[i + L] == link[j + L]:
                L += 1
            if L > best_len:
                best_len, best_i = L, i
        if best_len >= min_len:
            for t in range(best_len):
                root[j + t] = root[best_i + t]
            shifts = {low[j + t] - low[root[j + t]] for t in range(best_len)}
            if shifts == {0}:
                kind = "exact"
            elif len(shifts) > 1:
                kind = "mixed_shift"
            elif all(_black(evs[j + t]) == _black(evs[root[j + t]]) for t in range(best_len)):
                kind = "transposed_same_pattern"
            else:
                kind = "transposed_diff_pattern"
            out.append(Occurrence(first=best_i, later=j, length=best_len, shift=low[j] - low[best_i], kind=kind))
            j += best_len
        else:
            table.setdefault(key, []).append(j)
            j += 1
    return out


# ---------------------------------------------------------------------------------------
# Bookkeeping
# ---------------------------------------------------------------------------------------

def _new_cat() -> dict:
    return {"n_later_occurrences": 0, "len_events": [], "len_notes": [],
            "first_n": 0, "first_printed": 0, "later_n": 0, "later_printed": 0,
            "pairs": 0, "pairs_first_printed": 0, "pairs_both_printed": 0,
            "pairs_first_unprinted": 0, "pairs_later_printed_first_unprinted": 0, "pairs_same_digit": 0}


def _new_tally() -> dict:
    return {"n_parts": 0, "n_notes": 0, "n_printed": 0, "none_n": 0, "none_printed": 0,
            "cats": {c: _new_cat() for c in CATEGORIES}}


def tally_hand(evs: list[list[NoteRec]], occs: list[Occurrence], tally: dict) -> None:
    """Add one hand's notes, occurrences and aligned (root, later) note pairs to ``tally``."""
    root = root_map(len(evs), occs)
    later_events = {o.later + t for o in occs for t in range(o.length)}
    root_events = {root[e] for e in later_events}
    for e, ev in enumerate(evs):
        if e in later_events or e in root_events:
            continue
        tally["none_n"] += len(ev)
        tally["none_printed"] += sum(int(nt.printed) for nt in ev)
    tally["n_notes"] += sum(len(ev) for ev in evs)
    tally["n_printed"] += sum(int(nt.printed) for ev in evs for nt in ev)
    for cat in CATEGORIES:
        sel = [o for o in occs if o.in_category(cat)]
        if not sel:
            continue
        c = tally["cats"][cat]
        firsts: set[int] = set()
        for o in sel:
            c["n_later_occurrences"] += 1
            c["len_events"].append(o.length)
            c["len_notes"].append(sum(len(evs[t]) for t in range(o.later, o.later + o.length)))
            for t in range(o.later, o.later + o.length):
                r = root[t]
                firsts.add(r)
                for nf, nl in zip(evs[r], evs[t]):
                    c["later_n"] += 1
                    c["later_printed"] += int(nl.printed)
                    c["pairs"] += 1
                    if nf.printed:
                        c["pairs_first_printed"] += 1
                        if nl.printed:
                            c["pairs_both_printed"] += 1
                            c["pairs_same_digit"] += int(nf.finger == nl.finger)
                    else:
                        c["pairs_first_unprinted"] += 1
                        c["pairs_later_printed_first_unprinted"] += int(nl.printed)
        for e in firsts:
            c["first_n"] += len(evs[e])
            c["first_printed"] += sum(int(nt.printed) for nt in evs[e])


def hand_events(part: Part, hand: int) -> list[list[NoteRec]]:
    notes = part.hand_notes(hand)
    return events(notes) if notes else []


def analyse_parts(parts: list[Part]) -> dict[str, dict]:
    """Raw tallies per level group (and ``overall``)."""
    tallies = {g: _new_tally() for g in GROUPS}
    for part in parts:
        targets = [tallies["overall"], tallies[part.level_group]]
        for t in targets:
            t["n_parts"] += 1
        for hand in (RH, LH):
            evs = hand_events(part, hand)
            if not evs:
                continue
            occs = find_repeats(evs)
            for t in targets:
                tally_hand(evs, occs, t)
    return tallies


def _rate(k: int, n: int) -> dict:
    return {"n": n, "k": k, "p": round(k / n, 4) if n else None}


def _dist(xs: list[int]) -> dict:
    if not xs:
        return {"n": 0, "median": None, "p90": None, "max": None, "mean": None}
    s = sorted(xs)
    return {"n": len(s), "median": float(statistics.median(s)), "p90": s[min(len(s) - 1, int(0.9 * len(s)))],
            "max": s[-1], "mean": round(sum(s) / len(s), 2)}


def summarise(tally: dict) -> dict:
    out = {"n_parts": tally["n_parts"], "notes": _rate(tally["n_printed"], tally["n_notes"]),
           "baseline_no_repeat": _rate(tally["none_printed"], tally["none_n"]), "categories": {}}
    for cat in CATEGORIES:
        c = tally["cats"][cat]
        out["categories"][cat] = {
            "n_later_occurrences": c["n_later_occurrences"],
            "length_events": _dist(c["len_events"]),
            "length_notes": _dist(c["len_notes"]),
            "first_occurrence_notes": _rate(c["first_printed"], c["first_n"]),
            "later_occurrence_notes": _rate(c["later_printed"], c["later_n"]),
            "aligned_pairs": c["pairs"],
            "p_later_printed_given_first_printed": _rate(c["pairs_both_printed"], c["pairs_first_printed"]),
            "p_later_printed_given_first_unprinted": _rate(c["pairs_later_printed_first_unprinted"],
                                                           c["pairs_first_unprinted"]),
            "same_digit_given_both_printed": _rate(c["pairs_same_digit"], c["pairs_both_printed"]),
        }
    return out


def _fmt(r: dict) -> str:
    return "     -" if r["p"] is None else f"{r['p']:6.3f}"


def print_summary(result: dict) -> None:
    print(f"Repeated passages (k >= {MIN_EVENTS} events, up to transposition), "
          f"{result['n_parts']} parts, {result['runtime_sec']} s")
    print(f"{'group':9} {'category':24} {'occ':>6} {'medL':>5} {'maxL':>5} {'n_first':>7} {'p_first':>7} "
          f"{'n_later':>7} {'p_later':>7} {'P(L|F)':>7} {'P(L|~F)':>7} {'same':>6}")
    for g in GROUPS:
        s = result["groups"][g]
        b = s["baseline_no_repeat"]
        print(f"{g:9} all notes n={s['notes']['n']} p={_fmt(s['notes']).strip()}; "
              f"notes in no repeat n={b['n']} p={_fmt(b).strip()}")
        for cat in CATEGORIES:
            c = s["categories"][cat]
            le = c["length_events"]
            print(f"{'':9} {cat:24} {c['n_later_occurrences']:6d} "
                  f"{'-' if le['median'] is None else le['median']:>5} {'-' if le['max'] is None else le['max']:>5} "
                  f"{c['first_occurrence_notes']['n']:7d} {_fmt(c['first_occurrence_notes'])} "
                  f"{c['later_occurrence_notes']['n']:7d} {_fmt(c['later_occurrence_notes'])} "
                  f"{_fmt(c['p_later_printed_given_first_printed'])} "
                  f"{_fmt(c['p_later_printed_given_first_unprinted'])} "
                  f"{_fmt(c['same_digit_given_both_printed'])}")


def main(argv: list[str] | None = None) -> int:
    from readability.corpus import load_all

    t0 = time.time()
    parts = load_all()
    t1 = time.time()
    tallies = analyse_parts(parts)
    t2 = time.time()
    result = {
        "command": COMMAND,
        "params": {"min_events": MIN_EVENTS, "beat_grid": f"1/{GRID} quarter", "max_candidates": MAX_CANDIDATES,
                   "match": "same pitch tuple up to one constant semitone shift, same per-note durations, "
                            "same IOIs between consecutive events (IOI after the last event not compared)",
                   "search": "greedy left to right; longest non-overlapping extension of any earlier window "
                             "with the same 4-event key (earliest on ties); later occurrences are disjoint",
                   "alignment": "each later note is paired with the note of the same chord rank in its root "
                                "event (earliest statement, through chains of matches)"},
        "n_parts": len(parts),
        "runtime_sec": round(t2 - t0, 1),
        "load_sec": round(t1 - t0, 1),
        "groups": {g: summarise(tallies[g]) for g in GROUPS},
        "column_legend": {
            "first_occurrence_notes": "distinct root notes (earliest statements) that later notes of this "
                                      "category are aligned with; k = printed",
            "later_occurrence_notes": "notes in later occurrences of this category; k = printed",
            "p_later_printed_given_first_printed": "aligned note pairs; n = pairs whose root note is printed, "
                                                   "k = of those, later note printed",
            "p_later_printed_given_first_unprinted": "n = pairs whose root note is unprinted, k = later printed",
            "same_digit_given_both_printed": "share of pairs with both printed whose digits are equal",
            "baseline_no_repeat": "notes in no repeated segment (neither a later note nor a root of one)",
            "categories": "kinds (exact, transposed_*, mixed_shift) are relative to the root events; adjacent/"
                          "distant relative to the direct first occurrence; len_* by occurrence length in events",
        },
        "caveats": [
            "The Mutopia converter keeps volta/segno repeats in written order (printed once) and expands "
            "\\repeat unfold; a passage written with repeat signs is therefore not a repeat here, and an "
            "unfolded block carries the editor's digits on every copy by construction (LilyPond engraves "
            "them on every copy too, so that is what the reader sees).",
            "Matching is chromatic (constant semitone shift); diatonic sequences whose interval qualities "
            "change are not detected.",
            "Four-event matches include generic figuration (Alberti cells, scale fragments, repeated chords); "
            "the len_ge_8 / len_ge_16 / exact_len_ge_8 rows are closer to 'repeated passage' in the musical sense. "
            "Periodic figuration produces doubling segments (4, 8, 16, ... events), so long segments are not "
            "always phrases.",
            "Greedy left-to-right search: a short match at j can pre-empt a longer one starting at j+1.",
            "Library pieces are excerpts of pieces also present in the Mutopia corpus.",
        ],
    }
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(RESULTS_DIR / "repeats.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1)
    print_summary(result)
    print(f"wrote {RESULTS_DIR / 'repeats.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
