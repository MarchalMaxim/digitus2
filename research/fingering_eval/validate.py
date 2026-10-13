"""Reusable data-quality validators for fingering ground truth in PIG format.

Every validator works on a list of :class:`fingering_eval.pig_io.Note` (one annotation of one
piece) or on all annotations of a piece, and yields :class:`Anomaly` records that carry the
piece id, the annotation id, the note id and the source line, so that every flagged item can
be located in the raw file.

Conventions
-----------
* Finger field ``"0"`` (or ``"x"``/``"?"``) marks an *unannotated* note (partially fingered
  sources such as Mutopia editions). Such notes are skipped by finger checks and counted.
* Hands: channel 0 = right hand (positive fingers), channel 1 = left hand (negative fingers).
* "Simultaneous" means onsets within ``tol`` seconds (default 1 ms; PIG chords are exact).

Severities: ``error`` (physically impossible / format violation), ``warning`` (implausible or
irregular but possible), ``info`` (worth knowing, e.g. annotators disagree on the hand).
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from itertools import combinations
from typing import Iterable, Sequence

from .pig_io import Note, parse_finger

UNLABELED = {"0", "x", "X", "?", "-0"}

# Plausible pitch ranges (MIDI). Piano range is 21..108. Hands can of course cross, so
# these only produce warnings: RH notes below C2 / LH notes above C6 are rare.
PIANO_LOW, PIANO_HIGH = 21, 108
RH_MIN_PLAUSIBLE = 36   # C2
LH_MAX_PLAUSIBLE = 84   # C6

# Max span (semitones) between simultaneously *struck* notes of one hand.
STRETCH_WARN = 15       # a tenth (15 = minor, 16 = major): playable only by large hands -> warning
STRETCH_ERROR = 17      # more than a major tenth: beyond virtually every hand -> error


@dataclass
class Anomaly:
    check: str
    severity: str
    message: str
    piece: str = ""
    annotation: str = ""
    note_id: str = ""
    line: int = 0
    dataset: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


def is_labeled(n: Note) -> bool:
    return n.finger.strip() not in UNLABELED


def _sign_hand(channel: int) -> int:
    return 1 if channel == 0 else -1


def onset_clusters(notes: Sequence[Note], tol: float = 1e-3) -> list[list[int]]:
    """Group note indices whose onsets are within ``tol`` of the cluster's first onset."""
    order = sorted(range(len(notes)), key=lambda i: (notes[i].onset, i))
    clusters: list[list[int]] = []
    for i in order:
        if clusters and abs(notes[i].onset - notes[clusters[-1][0]].onset) <= tol:
            clusters[-1].append(i)
        else:
            clusters.append([i])
    return clusters


# ---------------------------------------------------------------------------------------
# file-level validators
# ---------------------------------------------------------------------------------------

def check_note_ids(notes: Sequence[Note]) -> Iterable[Anomaly]:
    seen = set()
    for k, n in enumerate(notes):
        if n.id in seen:
            yield Anomaly("note_id_duplicate", "error", f"note id {n.id} repeated", note_id=n.id, line=n.line_no)
        seen.add(n.id)
        if n.id.lstrip("-").isdigit() and int(n.id) != k:
            yield Anomaly("note_id_sequence", "warning", f"note id {n.id} at position {k} (expected {k})",
                          note_id=n.id, line=n.line_no)
            break  # one report per file is enough


def check_fingers(notes: Sequence[Note]) -> Iterable[Anomaly]:
    """Finger field syntax and range (1..5, signed by hand, substitutions ``a_b``)."""
    for n in notes:
        if not is_labeled(n):
            continue
        try:
            pf = parse_finger(n.finger)
        except ValueError:
            yield Anomaly("finger_malformed", "error", f"unparseable finger field {n.finger!r}",
                          note_id=n.id, line=n.line_no)
            continue
        for msg in pf.irregular:
            sev = "error" if msg.startswith("finger out of range") else "warning"
            yield Anomaly("finger_irregular", sev, f"{n.finger!r}: {msg}", note_id=n.id, line=n.line_no)


def check_hand_channel(notes: Sequence[Note]) -> Iterable[Anomaly]:
    """Sign of the key-press finger must agree with the channel (0 = RH +, 1 = LH -)."""
    for n in notes:
        if n.channel not in (0, 1):
            yield Anomaly("channel_invalid", "error", f"channel {n.channel} not in {{0,1}}", note_id=n.id,
                          line=n.line_no)
            continue
        if not is_labeled(n):
            continue
        try:
            pf = parse_finger(n.finger)
        except ValueError:
            continue
        if (pf.press > 0) != (n.channel == 0):
            yield Anomaly("hand_channel_mismatch", "error",
                          f"finger {n.finger!r} but channel {n.channel} ({'RH' if n.channel == 0 else 'LH'})",
                          note_id=n.id, line=n.line_no)


def check_times(notes: Sequence[Note]) -> Iterable[Anomaly]:
    """Onsets non-decreasing in file order; offsets after onsets."""
    prev = -math.inf
    for n in notes:
        if n.onset < prev - 1e-9:
            yield Anomaly("onset_not_monotone", "error", f"onset {n.onset} < previous onset {prev}",
                          note_id=n.id, line=n.line_no)
        prev = max(prev, n.onset)
        if n.offset <= n.onset:
            yield Anomaly("nonpositive_duration", "warning", f"offset {n.offset} <= onset {n.onset}",
                          note_id=n.id, line=n.line_no)


def check_pitch_ranges(notes: Sequence[Note]) -> Iterable[Anomaly]:
    for n in notes:
        try:
            p = n.pitch
        except ValueError:
            yield Anomaly("pitch_malformed", "error", f"bad spelled pitch {n.spelled_pitch!r}", note_id=n.id,
                          line=n.line_no)
            continue
        if not PIANO_LOW <= p <= PIANO_HIGH:
            yield Anomaly("pitch_out_of_piano_range", "error", f"pitch {n.spelled_pitch} ({p})", note_id=n.id,
                          line=n.line_no)
        elif n.channel == 0 and p < RH_MIN_PLAUSIBLE:
            yield Anomaly("pitch_range_hand", "warning", f"RH note {n.spelled_pitch} ({p}) below C2",
                          note_id=n.id, line=n.line_no)
        elif n.channel == 1 and p > LH_MAX_PLAUSIBLE:
            yield Anomaly("pitch_range_hand", "warning", f"LH note {n.spelled_pitch} ({p}) above C6",
                          note_id=n.id, line=n.line_no)


def check_duplicates(notes: Sequence[Note], tol: float = 1e-3) -> Iterable[Anomaly]:
    """Same pitch struck twice at the same time (in either hand)."""
    for cl in onset_clusters(notes, tol):
        seen: dict[int, Note] = {}
        for i in cl:
            n = notes[i]
            try:
                p = n.pitch
            except ValueError:
                continue
            if p in seen:
                o = seen[p]
                yield Anomaly("duplicate_note", "warning",
                              f"pitch {n.spelled_pitch} struck twice at t={n.onset} (ids {o.id}, {n.id}; "
                              f"channels {o.channel},{n.channel}; fingers {o.finger},{n.finger})",
                              note_id=n.id, line=n.line_no)
            else:
                seen[p] = n


def _hand_cluster_notes(notes: Sequence[Note], tol: float) -> Iterable[tuple[int, list[Note]]]:
    for cl in onset_clusters(notes, tol):
        by_hand: dict[int, list[Note]] = defaultdict(list)
        for i in cl:
            by_hand[notes[i].channel].append(notes[i])
        for ch, ns in by_hand.items():
            yield ch, ns


def check_chords(notes: Sequence[Note], tol: float = 1e-3) -> Iterable[Anomaly]:
    """Simultaneous notes of one hand: distinct fingers, monotone finger order, span.

    * same press finger on two different simultaneous pitches -> error
    * finger order not monotone in pitch (RH: higher pitch -> higher finger; LH: higher pitch
      -> lower finger number) -> warning (crossing inside a chord is practically impossible,
      but this also fires on annotation slips)
    * span > a major tenth (17+ semitones) -> error; 15-16 semitones -> warning
    """
    for ch, ns in _hand_cluster_notes(notes, tol):
        lab = [n for n in ns if is_labeled(n)]
        try:
            pitches = sorted({n.pitch for n in ns})
        except ValueError:
            continue
        if len(pitches) >= 2:
            span = pitches[-1] - pitches[0]
            if span >= STRETCH_ERROR:
                yield Anomaly("chord_span_impossible", "error",
                              f"{'RH' if ch == 0 else 'LH'} simultaneous span {span} semitones "
                              f"({', '.join(n.spelled_pitch for n in ns)})", note_id=ns[0].id, line=ns[0].line_no)
            elif span >= STRETCH_WARN:
                yield Anomaly("chord_span_large", "warning",
                              f"{'RH' if ch == 0 else 'LH'} simultaneous span {span} semitones "
                              f"({', '.join(n.spelled_pitch for n in ns)})", note_id=ns[0].id, line=ns[0].line_no)
        if len(lab) < 2:
            continue
        try:
            pf = [(n.pitch, abs(parse_finger(n.finger).press), n) for n in lab]
        except ValueError:
            continue
        cnt = Counter((f) for p, f, n in pf)
        for f, c in cnt.items():
            if c > 1:
                ps = sorted({p for p, ff, n in pf if ff == f})
                if len(ps) > 1:
                    bad = [n for p, ff, n in pf if ff == f]
                    width = ps[-1] - ps[0]
                    # One thumb pressing two keys a (half/whole) step apart is an accepted
                    # technique; a thumb on a minor third is a stretch; anything else is impossible.
                    if f == 1 and len(ps) == 2 and width <= 2:
                        chk, sev = "thumb_two_keys", "info"
                    elif f == 1 and len(ps) == 2 and width == 3:
                        chk, sev = "same_finger_simultaneous", "warning"
                    else:
                        chk, sev = "same_finger_simultaneous", "error"
                    yield Anomaly(chk, sev,
                                  f"finger {f} on {len(ps)} simultaneous pitches {width} semitones apart "
                                  f"({', '.join(f'{n.id}:{n.spelled_pitch}' for n in bad)})",
                                  note_id=bad[-1].id, line=bad[-1].line_no)
        srt = sorted(pf, key=lambda t: (t[0], t[1]))
        fingers = [f for p, f, n in srt]
        ok = all(a < b for a, b in zip(fingers, fingers[1:])) if ch == 0 else \
            all(a > b for a, b in zip(fingers, fingers[1:]))
        distinct_pitch = len({p for p, f, n in srt}) == len(srt)
        if not ok and distinct_pitch and len(set(fingers)) == len(fingers):
            yield Anomaly("chord_finger_order", "warning",
                          f"{'RH' if ch == 0 else 'LH'} chord fingers not ordered by pitch: "
                          + ", ".join(f"{n.spelled_pitch}={n.finger}" for p, f, n in srt),
                          note_id=srt[0][2].id, line=srt[0][2].line_no)


def check_held_same_finger(notes: Sequence[Note], tol: float = 1e-3) -> Iterable[Anomaly]:
    """A new note is struck with a finger that is still holding a different key (per score
    durations). Common and often harmless (early release / pedal), hence ``info``."""
    by_hand: dict[int, list[Note]] = defaultdict(list)
    for n in notes:
        if is_labeled(n):
            by_hand[n.channel].append(n)
    for ch, ns in by_hand.items():
        ns = sorted(ns, key=lambda n: n.onset)
        active: list[Note] = []
        for n in ns:
            active = [a for a in active if a.offset > n.onset + tol]
            try:
                f = abs(parse_finger(n.finger).press)
            except ValueError:
                continue
            for a in active:
                try:
                    fa = abs(parse_finger(a.finger).release)
                except ValueError:
                    continue
                if fa == f and a.pitch != n.pitch and n.onset - a.onset > tol:
                    yield Anomaly("held_key_finger_reuse", "info",
                                  f"finger {f} strikes {n.spelled_pitch} while note {a.id} ({a.spelled_pitch}) "
                                  f"is still held for {a.offset - n.onset:.3f}s", note_id=n.id, line=n.line_no)
                    break
            active.append(n)


FILE_CHECKS = (check_note_ids, check_fingers, check_hand_channel, check_times, check_pitch_ranges,
               check_duplicates, check_chords, check_held_same_finger)


def validate_notes(notes: Sequence[Note], piece: str = "", annotation: str = "", dataset: str = "",
                   checks=FILE_CHECKS) -> list[Anomaly]:
    out = []
    for chk in checks:
        for a in chk(notes):
            a.piece, a.annotation, a.dataset = piece, annotation, dataset
            out.append(a)
    return out


# ---------------------------------------------------------------------------------------
# piece-level (cross-annotation) validators
# ---------------------------------------------------------------------------------------

def check_annotations_aligned(annotations: dict[str, Sequence[Note]], piece: str = "",
                              dataset: str = "") -> list[Anomaly]:
    """All annotations of a piece must describe the same notes in the same order."""
    out = []
    ids = sorted(annotations)
    if len(ids) < 2:
        return out
    ref_id = ids[0]
    ref = annotations[ref_id]
    for k in ids[1:]:
        other = annotations[k]
        if len(other) != len(ref):
            out.append(Anomaly("note_count_mismatch", "error",
                               f"{len(other)} notes vs {len(ref)} in annotation {ref_id}", piece, k,
                               dataset=dataset))
            continue
        n_pitch = n_onset = n_chan = 0
        first_pitch = first_chan = None
        for a, b in zip(ref, other):
            if a.pitch != b.pitch:
                n_pitch += 1
                first_pitch = first_pitch or b
            if abs(a.onset - b.onset) > 1e-4:
                n_onset += 1
            if a.channel != b.channel:
                n_chan += 1
                first_chan = first_chan or b
        if n_pitch:
            out.append(Anomaly("pitch_mismatch_across_annotations", "error",
                               f"{n_pitch} notes differ in pitch from annotation {ref_id}", piece, k,
                               first_pitch.id, first_pitch.line_no, dataset))
        if n_onset:
            out.append(Anomaly("onset_mismatch_across_annotations", "warning",
                               f"{n_onset} notes differ in onset from annotation {ref_id}", piece, k,
                               dataset=dataset))
        if n_chan:
            out.append(Anomaly("hand_assignment_differs", "info",
                               f"{n_chan} notes assigned to the other hand than in annotation {ref_id}",
                               piece, k, first_chan.id, first_chan.line_no, dataset))
    return out


# ---------------------------------------------------------------------------------------
# statistics
# ---------------------------------------------------------------------------------------

@dataclass
class FingerStats:
    n_notes: int = 0
    n_labeled: int = 0
    n_substitutions: int = 0
    usage: dict = field(default_factory=lambda: {"R": Counter(), "L": Counter()})
    transitions: dict = field(default_factory=lambda: {"R": Counter(), "L": Counter()})
    interval_transitions: dict = field(default_factory=lambda: {"R": Counter(), "L": Counter()})

    def add(self, notes: Sequence[Note], tol: float = 1e-3) -> None:
        """Accumulate usage (every labeled note) and *melodic* transitions: consecutive onset
        groups of the same hand that both contain exactly one note (chord-to-chord moves are
        excluded because their serialisation order is arbitrary)."""
        self.n_notes += len(notes)
        for n in notes:
            if not is_labeled(n):
                continue
            try:
                pf = parse_finger(n.finger)
            except ValueError:
                continue
            self.n_labeled += 1
            self.n_substitutions += pf.is_substitution
            self.usage[n.hand][abs(pf.press)] += 1
        for ch in (0, 1):
            hand_notes = [n for n in notes if n.channel == ch]
            groups = [[hand_notes[i] for i in cl] for cl in onset_clusters(hand_notes, tol)]
            for prev, cur in zip(groups, groups[1:]):
                if len(prev) != 1 or len(cur) != 1:
                    continue
                a, b = prev[0], cur[0]
                if not (is_labeled(a) and is_labeled(b)):
                    continue
                try:
                    fa, fb = abs(parse_finger(a.finger).release), abs(parse_finger(b.finger).press)
                    d = b.pitch - a.pitch
                except ValueError:
                    continue
                h = "R" if ch == 0 else "L"
                self.transitions[h][(fa, fb)] += 1
                self.interval_transitions[h][(fa, fb, d)] += 1

    def as_dict(self, top: int = 15) -> dict:
        def norm(c: Counter) -> dict:
            tot = sum(c.values()) or 1
            return {str(k): round(v / tot, 4) for k, v in sorted(c.items())}
        return {
            "n_notes": self.n_notes, "n_labeled": self.n_labeled, "n_substitutions": self.n_substitutions,
            "usage_counts": {h: dict(sorted(c.items())) for h, c in self.usage.items()},
            "usage_fraction": {h: norm(c) for h, c in self.usage.items()},
            "top_transitions": {h: [(f"{a}->{b}", v) for (a, b), v in c.most_common(top)]
                                for h, c in self.transitions.items()},
            "top_interval_transitions": {h: [(f"{a}->{b} ({d:+d})", v) for (a, b, d), v in c.most_common(top)]
                                         for h, c in self.interval_transitions.items()},
        }


def summarize(anomalies: Iterable[Anomaly]) -> dict:
    c = Counter((a.severity, a.check) for a in anomalies)
    out: dict = defaultdict(dict)
    for (sev, chk), v in sorted(c.items()):
        out[sev][chk] = v
    return dict(out)


def pairwise_agreement(annotations: dict[str, Sequence[Note]]) -> dict[tuple[str, str], float]:
    """Plain (key-press finger) match rate for each annotator pair of one piece."""
    out = {}
    for a, b in combinations(sorted(annotations), 2):
        x, y = annotations[a], annotations[b]
        if len(x) != len(y) or not x:
            continue
        m = sum(parse_finger(p.finger).press == parse_finger(q.finger).press for p, q in zip(x, y))
        out[(a, b)] = m / len(x)
    return out
