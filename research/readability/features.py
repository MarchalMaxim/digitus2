"""Per-note context features for the readability study.

Two families:

* **score-only** features, computable without any fingering (used for print rates by context
  and for the printed-digit predictor): first note of the piece / of the hand, rest before the
  note, length of the previous note, melodic interval to the previous event, key colour, chord
  size and voice position, repeated note, stepwise runs, note density, position in the bar;
* **printed-derived** features, available only where the note *and* the previous event carry a
  printed digit: the implied hand anchor (literature section 6.6), its change (a position
  change) and thumb crossings.

Every note of a hand belongs to one *event* (all notes of that hand with the same onset, i.e. a
chord or a single note). "Previous event" means the previous event of the same hand. The
interval of a note is measured to the nearest pitch of the previous event.
"""
from __future__ import annotations

import bisect
import csv
from pathlib import Path

from readability import keyboard as K
from readability.corpus import LH, RH, NoteRec, Part, events

DEFAULT_SEC_PER_BEAT = 0.6      # quarter = 100 (the converter's default tempo)
LONG_NOTE_BEATS = 2.0           # a half note or longer
REST_BEATS = 1.0                # a rest of at least one beat
RUN_MIN = 4                     # stepwise run: at least four single notes by 1-2 semitones, one direction
DENSITY_WINDOW_SEC = 1.0

LEAP_BINS = ("none", "repeat", "step", "third", "fourth_fifth", "sixth_octave", "over_octave")
CHORD_POS = ("single", "bottom", "inner", "top")
RUN_POS = ("none", "start", "mid", "end")
DENSITY_BINS = ("lt2", "2to4", "4to8", "ge8")
BAR_POS_BINS = ("unknown", "downbeat", "on_beat", "off_beat")

FEATURE_COLUMNS = [
    # identity
    "part_id", "source", "level_group", "level", "composer", "hand", "idx", "event_idx", "pitch",
    "printed", "finger", "substitution", "grace",
    # score-only
    "first_of_piece", "first_of_hand", "gap_beats", "after_rest", "after_rest_beat",
    "prev_dur_beats", "after_long_note", "interval", "leap_abs", "leap_bin", "direction",
    "black", "prev_black", "chord_size", "chord_pos", "chord_outer", "is_chord", "repeated",
    "in_run", "run_len", "run_pos", "notes_per_sec", "density_bin", "ioi_prev", "ioi_next",
    "dur_beats", "bar_pos", "bar_len", "bar_pos_bin", "downbeat", "on_beat", "beats_known",
    "rel_pos", "since_printed", "until_printed",
    # printed-derived
    "prev_printed", "prev_finger", "anchor", "prev_anchor", "anchor_delta", "crossing",
]


def leap_bin(interval: int | None) -> str:
    if interval is None:
        return "none"
    a = abs(interval)
    if a == 0:
        return "repeat"
    if a <= 2:
        return "step"
    if a <= 4:
        return "third"
    if a <= 7:
        return "fourth_fifth"
    if a <= 12:
        return "sixth_octave"
    return "over_octave"


def density_bin(nps: float) -> str:
    if nps < 2:
        return "lt2"
    if nps < 4:
        return "2to4"
    if nps < 8:
        return "4to8"
    return "ge8"


def crossing_kind(prev_finger: int, finger: int, interval: int, hand: int) -> str:
    """'thumb_under' (1 after 2-4 moving outward), 'finger_over' (2-4 after 1 moving inward), else ''."""
    outward = interval > 0 if hand == RH else interval < 0
    if finger == 1 and 2 <= prev_finger <= 4 and outward:
        return "thumb_under"
    if prev_finger == 1 and 2 <= finger <= 4 and interval != 0 and not outward:
        return "finger_over"
    return ""


def _beat(n: NoteRec) -> float:
    return n.beat if n.beat is not None else n.onset / DEFAULT_SEC_PER_BEAT


def _dur_beats(n: NoteRec) -> float:
    return n.dur_beats if n.dur_beats is not None else n.duration / DEFAULT_SEC_PER_BEAT


def _stepwise_runs(evs: list[list[NoteRec]]) -> dict[int, tuple[int, str]]:
    """event index -> (run length, position) for maximal stepwise runs of single notes."""
    out: dict[int, tuple[int, str]] = {}
    n = len(evs)
    i = 0
    while i < n:
        if len(evs[i]) != 1:
            i += 1
            continue
        j = i
        direction = 0
        while j + 1 < n and len(evs[j + 1]) == 1:
            d = evs[j + 1][0].pitch - evs[j][0].pitch
            if d == 0 or abs(d) > 2:
                break
            s = 1 if d > 0 else -1
            if direction and s != direction:
                break
            direction = s
            j += 1
        length = j - i + 1
        if length >= RUN_MIN:
            for k in range(i, j + 1):
                out[k] = (length, "start" if k == i else "end" if k == j else "mid")
        i = j if j > i else i + 1   # the last note of a run may start the next one (a turn)
    return out


def compute_features(part: Part) -> list[dict]:
    rows: list[dict] = []
    part_min_onset = min((n.onset for n in part.notes), default=0.0)
    beats_known = part.beats_known
    for hand in (RH, LH):
        notes = part.hand_notes(hand)
        if not notes:
            continue
        evs = events(notes)
        runs = _stepwise_runs(evs)
        onsets = [n.onset for n in sorted(notes, key=lambda x: x.onset)]
        ev_printed = [any(n.printed for n in ev) for ev in evs]
        # distance (in events) to the previous / next event with a printed digit
        since = [None] * len(evs)
        last = None
        for e in range(len(evs)):
            since[e] = (e - last) if last is not None else None
            if ev_printed[e]:
                last = e
        until = [None] * len(evs)
        nxt = None
        for e in range(len(evs) - 1, -1, -1):
            until[e] = (nxt - e) if nxt is not None else None
            if ev_printed[e]:
                nxt = e
        max_off_beat = None
        for e, ev in enumerate(evs):
            prev = evs[e - 1] if e > 0 else None
            onset_beat = _beat(ev[0])
            gap = (onset_beat - max_off_beat) if max_off_beat is not None else None
            prev_dur = max(_dur_beats(n) for n in prev) if prev else None
            ioi_prev = (onset_beat - _beat(prev[0])) if prev else None
            ioi_next = (_beat(evs[e + 1][0]) - onset_beat) if e + 1 < len(evs) else None
            lo = bisect.bisect_left(onsets, ev[0].onset - DENSITY_WINDOW_SEC / 2)
            hi = bisect.bisect_right(onsets, ev[0].onset + DENSITY_WINDOW_SEC / 2)
            nps = (hi - lo) / DENSITY_WINDOW_SEC
            run = runs.get(e)
            size = len(ev)
            for k, n in enumerate(ev):
                if prev:
                    pn = min(prev, key=lambda x: (abs(x.pitch - n.pitch), x.pitch))
                    interval = n.pitch - pn.pitch
                else:
                    pn, interval = None, None
                if size == 1:
                    cpos = "single"
                elif k == 0:
                    cpos = "bottom"
                elif k == size - 1:
                    cpos = "top"
                else:
                    cpos = "inner"
                bar_known = n.bar_pos is not None and n.bar_len is not None
                if not bar_known:
                    bpb = "unknown"
                elif abs(n.bar_pos) < 1e-6:
                    bpb = "downbeat"
                elif abs(n.bar_pos - round(n.bar_pos)) < 1e-6:
                    bpb = "on_beat"
                else:
                    bpb = "off_beat"
                row = {
                    "part_id": part.id, "source": part.source, "level_group": part.level_group,
                    "level": part.level, "composer": part.composer, "hand": "R" if hand == RH else "L",
                    "idx": n.idx, "event_idx": e, "pitch": n.pitch, "printed": int(n.printed),
                    "finger": n.finger, "substitution": int(n.substitution), "grace": int(n.grace),
                    "first_of_piece": int(e == 0 and abs(ev[0].onset - part_min_onset) < 1e-6),
                    "first_of_hand": int(e == 0),
                    "gap_beats": None if gap is None else round(gap, 4),
                    "after_rest": int(gap is not None and gap > 1e-6),
                    "after_rest_beat": int(gap is not None and gap >= REST_BEATS - 1e-6),
                    "prev_dur_beats": None if prev_dur is None else round(prev_dur, 4),
                    "after_long_note": int(prev_dur is not None and prev_dur >= LONG_NOTE_BEATS - 1e-6
                                           and (gap is None or gap <= 1e-6)),
                    "interval": interval, "leap_abs": None if interval is None else abs(interval),
                    "leap_bin": leap_bin(interval),
                    "direction": 0 if not interval else (1 if interval > 0 else -1),
                    "black": int(K.is_black(n.pitch)),
                    "prev_black": None if pn is None else int(K.is_black(pn.pitch)),
                    "chord_size": size, "chord_pos": cpos,
                    "chord_outer": int(size >= 2 and cpos in ("bottom", "top")), "is_chord": int(size >= 2),
                    "repeated": int(interval == 0),
                    "in_run": int(run is not None), "run_len": run[0] if run else 0,
                    "run_pos": run[1] if run else "none",
                    "notes_per_sec": round(nps, 3), "density_bin": density_bin(nps),
                    "ioi_prev": None if ioi_prev is None else round(ioi_prev, 4),
                    "ioi_next": None if ioi_next is None else round(ioi_next, 4),
                    "dur_beats": round(_dur_beats(n), 4),
                    "bar_pos": None if not bar_known else round(n.bar_pos, 4),
                    "bar_len": None if not bar_known else round(n.bar_len, 4),
                    "bar_pos_bin": bpb, "downbeat": int(bpb == "downbeat"),
                    "on_beat": int(bpb in ("downbeat", "on_beat")), "beats_known": int(beats_known),
                    "rel_pos": round(e / max(1, len(evs) - 1), 4),
                    "since_printed": since[e], "until_printed": until[e],
                    "prev_printed": int(pn is not None and pn.printed),
                    "prev_finger": pn.finger if pn is not None and pn.printed else None,
                    "anchor": None, "prev_anchor": None, "anchor_delta": None, "crossing": "",
                }
                if n.printed:
                    row["anchor"] = K.anchor(n.pitch, n.finger, hand)
                    if pn is not None and pn.printed:
                        row["prev_anchor"] = K.anchor(pn.pitch, pn.finger, hand)
                        row["anchor_delta"] = row["anchor"] - row["prev_anchor"]
                        row["crossing"] = crossing_kind(pn.finger, n.finger, interval, hand)
                rows.append(row)
            max_off_beat = max([max_off_beat if max_off_beat is not None else -1e9] +
                               [onset_beat + _dur_beats(x) for x in ev])
    rows.sort(key=lambda r: r["idx"])
    return rows


def write_feature_table(parts: list[Part], path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FEATURE_COLUMNS)
        w.writeheader()
        for part in parts:
            for row in compute_features(part):
                w.writerow(row)
                n += 1
    return n


def read_feature_table(path: Path) -> list[dict]:
    """Read the CSV back with numbers restored (None for empty cells)."""
    out = []
    with open(path, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            r = {}
            for k, v in row.items():
                if v == "" or v is None:
                    r[k] = None
                elif k in ("part_id", "source", "level_group", "composer", "hand", "leap_bin",
                           "chord_pos", "run_pos", "density_bin", "bar_pos_bin", "crossing"):
                    r[k] = v
                else:
                    try:
                        r[k] = int(v)
                    except ValueError:
                        r[k] = float(v)
            out.append(r)
    return out
