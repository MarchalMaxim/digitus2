"""Convert Mutopia Project LilyPond engravings with editorial fingerings into PIG-format notes.

Pipeline per main ``.ly`` file (see ``research/scripts/build_mutopia_fingering.py``):

1. tokenise (python-ly) + inline local includes, parse, resolve ``\\relative`` octaves,
   evaluate every *layout* ``\\score`` (MIDI-only scores are ignored) -> note events with
   musical time, MIDI pitch, staff, voice, raw fingering texts (:mod:`fingering_eval.lilypond`)
2. build *parts*: every ``PianoStaff``/``GrandStaff`` with two staves (or a score with exactly
   two un-grouped staves) is a two-hand part, upper staff = right hand (channel 0), lower staff
   = left hand (channel 1), cross-staff notes follow ``\\change Staff``; this is the same
   staff-to-hand convention PIG's authors used for their test inputs. Piano duets give two
   parts (primo, secondo).
3. fingering: per-note marks (``c-3``, ``<c-1 e-3>``, ``\\finger "4-1"``) are taken as is;
   fingerings written *after* a chord (``<c e g>-1-3-5``) are mapped to the chord notes only if
   their number equals the number of chord notes and exactly one of the two orders (bottom-up,
   top-down) is monotone for the hand; otherwise they are dropped and counted as ambiguous.
   Several marks on one note while other voices of the same hand sound at the same onset are
   mapped to that vertical chord the same way; two marks on a lone note are alternative
   fingerings (the first, primary one is kept). Explicit substitutions (``\\finger "4-1"``)
   become PIG ``4_1``.
4. times are converted to seconds at the score's first ``\\tempo`` (default quarter = 100).

Unfingered notes get finger ``"0"`` (PIG has no "unknown" value; our tools treat "0" as
unlabeled). Every part gets diagnostics (bar-check failures, staff-length mismatch, ambiguous
fingerings) used to decide whether it is trustworthy.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

from . import lilypond as L
from .pig_io import Note, midi_to_spelled

DEFAULT_BPM = 100.0
GRACE_SECONDS = 0.04

KEYBOARD_RX = re.compile(r"piano|harpsichord|clavichord|keyboard|clavier|fortepiano|spinet|virginal", re.I)
_SUBST_RX = re.compile(r"^\(?\s*([1-5])\s*(?:[-\u2013\u2014_~ ]|\\\\)\s*([1-5])\s*\)?$")
_SINGLE_RX = re.compile(r"^\(?\s*([1-5])\s*\)?$")


def normalize_finger_text(s: str) -> str | None:
    """'3' -> '3'; '(2)' -> '2'; '4-1' / '4 1' / '4–1' -> '4_1'; anything else -> None."""
    s = s.strip().strip('"')
    m = _SINGLE_RX.match(s)
    if m:
        return m.group(1)
    m = _SUBST_RX.match(s)
    if m:
        return f"{m.group(1)}_{m.group(2)}"
    return None


def _signed(f: str, channel: int) -> str:
    if channel == 0:
        return f
    return "_".join(f"-{x}" for x in f.split("_"))


@dataclass
class Part:
    key: str
    score_index: int
    label: str
    notes: list[Note]
    diagnostics: dict = field(default_factory=dict)


@dataclass
class Conversion:
    path: Path
    header: dict
    parts: list[Part]
    diagnostics: dict
    error: str | None = None


_INCLUDE_RX = re.compile(r'\\include\s+"([^"]+)"')
_SCORE_RX = re.compile(r"\\score\b|\\book\b|\\new\s+(?:Piano|Grand)Staff")


def _strip_ly_comments(txt: str) -> str:
    txt = re.sub(r"%\{.*?%\}", "", txt, flags=re.S)
    return re.sub(r"%[^\n]*", "", txt)


def find_main_files(piece_dir: Path) -> list[Path]:
    """Main .ly files of a Mutopia piece directory: files that contain a score (\\score,
    \\book or a top-level \\new PianoStaff) and are not \\include-d by another .ly file.
    Header-only files (``header.ly``) and included parts are therefore never main files."""
    lys = sorted(p for p in piece_dir.rglob("*.ly"))
    srcs = sorted(p for p in piece_dir.rglob("*") if p.suffix in (".ly", ".ily", ".lyi") and p.is_file())
    texts = {p.resolve(): _strip_ly_comments(p.read_text(encoding="utf-8", errors="replace")) for p in srcs}
    includes: dict = {}
    included = set()
    for p in srcs:
        rp = p.resolve()
        incs = [(p.parent / inc).resolve() for inc in _INCLUDE_RX.findall(texts[rp])]
        includes[rp] = incs
        if p.suffix == ".ly":
            included.update(incs)

    def has_score(rp, seen=None) -> bool:
        seen = seen or set()
        if rp in seen or rp not in texts:
            return False
        seen.add(rp)
        return bool(_SCORE_RX.search(texts[rp])) or any(has_score(i, seen) for i in includes.get(rp, []))

    mains = [p for p in lys if p.resolve() not in included and has_score(p.resolve())]
    if not mains:
        mains = [p for p in lys if has_score(p.resolve())]
    return mains


def _merge_headers(parser: L.Parser) -> dict:
    h = dict(parser.header)
    for s in parser.scores:
        for k, v in s.header.items():
            h.setdefault(k, v)
    return h


def _meter_grid_failures(ev: L.Evaluator) -> tuple[int, int, int]:
    """Check bar checks against the meter grid.

    The grid starts at the first anacrusis marker (``\\partial`` or ``measurePosition``) if
    there is one, else at the first bar check; measure lengths follow ``\\time`` changes (which
    take effect at barlines). Returns (n_checks, n_failures, n_breaks) where failures count every
    off-grid check (a time shift cascades) and breaks count discontinuities (re-anchoring after
    each failure), i.e. roughly the number of independent timing errors.
    """
    checks = [c[0] for c in ev.bar_checks]
    if not checks:
        return 0, 0, 0
    meters = sorted(set(ev.meter_events)) or [(Fraction(0), Fraction(1))]

    def meter_at(t: Fraction) -> Fraction:
        cur = meters[0][1]
        for mt, ml in meters:
            if mt <= t:
                cur = ml
            else:
                break
        return cur

    anchors = sorted([(t, t + d) for t, d in ev.partial_events if d > 0] +
                     [(t, t + meter_at(t) - p) for t, p in ev.measure_pos_events])
    uniq = sorted(set(checks))

    def run(reanchor: bool) -> set:
        bad = set()
        ai = 0
        if anchors and anchors[0][0] <= uniq[0]:
            barline = anchors[0][1]
            ai = 1
        else:
            barline = uniq[0]
        while barline > uniq[0]:
            barline -= meter_at(barline)
        for t in uniq:
            while ai < len(anchors) and anchors[ai][0] <= t:
                barline = anchors[ai][1]
                ai += 1
                while barline > t:
                    barline -= meter_at(barline)
            guard = 0
            while barline < t and guard < 100000:
                barline += meter_at(barline)
                guard += 1
            if barline != t:
                bad.add(t)
                if reanchor:
                    barline = t
        return bad

    bad_cascade = run(False)
    bad_breaks = run(True)
    n_fail = sum(1 for t in checks if t in bad_cascade)
    return len(checks), n_fail, len(bad_breaks)


def _assign_parts(ev: L.Evaluator, keyboard_only: bool) -> list[tuple[str, dict[str, int]]]:
    """Return [(label, {staff_key: channel})] for every two-hand (or single-staff) part."""
    groups: dict[str, list[L.StaffInfo]] = defaultdict(list)
    used = {e.staff for e in ev.events}
    for s in ev.staves.values():
        if s.key in used:
            groups[s.group].append(s)
    parts = []
    for g, staves in groups.items():
        staves = sorted(staves, key=lambda s: s.order)
        gtype = g.split(":")[1] if g else ""
        if g and gtype not in ("PianoStaff", "GrandStaff"):
            # nested piano groups inside StaffGroup are their own groups; other groups are skipped
            if not (keyboard_only and len(staves) == 2):
                continue
        if not g:
            # ungrouped staves: accept 2 staves for keyboard-only pieces, or a single staff
            if len(staves) == 2 and keyboard_only:
                parts.append(("staves", {staves[0].key: 0, staves[1].key: 1}))
            elif len(staves) == 1:
                clef = (staves[0].clef or "").lower()
                parts.append(("single", {staves[0].key: 1 if "bass" in clef or clef.startswith("f") else 0}))
            continue
        if len(staves) == 2:
            parts.append((g, {staves[0].key: 0, staves[1].key: 1}))
        elif len(staves) == 1:
            clef = (staves[0].clef or "").lower()
            parts.append((g, {staves[0].key: 1 if "bass" in clef else 0}))
        elif len(staves) == 3:
            mid = staves[1]
            mclef = (mid.clef or "").lower()
            parts.append((g + "#3", {staves[0].key: 0, mid.key: 1 if "bass" in mclef else 0, staves[2].key: 1}))
    return parts


def _resolve_chord_fingers(evs: list[L.NoteEvent], channel_of: dict[int, int], stats: Counter) -> dict[int, str]:
    """Map post-chord fingerings to chord notes; return {id(event): finger_text}."""
    out: dict[int, str] = {}
    by_chord: dict[int, list[L.NoteEvent]] = defaultdict(list)
    for e in evs:
        if e.in_chord > 1 and e.chord_post_fingers:
            by_chord[e.chord_id].append(e)
    for cid, notes in by_chord.items():
        post = [normalize_finger_text(f) for f in notes[0].chord_post_fingers]
        if any(n.fingers for n in notes):
            stats["chord_post_fingering_with_note_fingering"] += 1
            continue
        if None in post:
            stats["chord_post_fingering_unparsed"] += 1
            continue
        pitches = sorted({n.pitch for n in notes})
        if len(post) != len(pitches):
            stats["chord_post_fingering_count_mismatch"] += 1
            continue
        ch = channel_of.get(id(notes[0]), 0)
        nums = [int(p.split("_")[0]) for p in post]
        up_ok = all(a < b for a, b in zip(nums, nums[1:]))
        down_ok = all(a > b for a, b in zip(nums, nums[1:]))
        # RH: finger number increases with pitch; LH: decreases
        asc_ok = up_ok if ch == 0 else down_ok        # post given bottom-up
        desc_ok = down_ok if ch == 0 else up_ok       # post given top-down
        if asc_ok and not desc_ok:
            order = post
        elif desc_ok and not asc_ok:
            order = list(reversed(post))
        else:
            stats["chord_post_fingering_ambiguous_order"] += 1
            continue
        pmap = dict(zip(pitches, order))
        for n in notes:
            out[id(n)] = pmap[n.pitch]
        stats["chord_post_fingering_mapped"] += 1
    return out


def _monotone_assignment(marks: list[str], pitches: list[int], channel: int) -> list[str] | None:
    """Assign finger marks to ascending pitches: input order or reversed, whichever is
    monotone for the hand (RH: finger grows with pitch; LH: finger shrinks). None if ambiguous."""
    nums = [int(m.split("_")[0]) for m in marks]
    up_ok = all(a < b for a, b in zip(nums, nums[1:]))
    down_ok = all(a > b for a, b in zip(nums, nums[1:]))
    asc_ok = up_ok if channel == 0 else down_ok
    desc_ok = down_ok if channel == 0 else up_ok
    if asc_ok and not desc_ok:
        return list(marks)
    if desc_ok and not asc_ok:
        return list(reversed(marks))
    return None


def _resolve_multi_marks(evs: list, channel_of: dict, stats: Counter) -> dict[int, str]:
    """Notes carrying several finger marks (``c-5-3``) while other voices of the same hand
    sound at the same time: engravers often stack the fingering of the whole vertical chord on
    one voice. Map the marks to the simultaneous notes if the counts agree and exactly one
    order is anatomically monotone. A lone note with two marks is read as a substitution."""
    out: dict[int, str] = {}
    groups: dict[tuple, list] = defaultdict(list)
    for e in evs:
        if not e.grace:
            groups[(e.onset, channel_of[id(e)])].append(e)
    for e in evs:
        if len(e.fingers) < 2 or e.grace or id(e) in out:
            continue
        ch = channel_of[id(e)]
        marks = [normalize_finger_text(x) for x in e.fingers]
        if None in marks or any("_" in m for m in marks):
            continue
        grp = groups[(e.onset, ch)]
        pitches = sorted({n.pitch for n in grp})
        others_fingered = any(n.fingers for n in grp if n is not e)
        if len(grp) >= 2 and len(marks) == len(pitches) and not others_fingered:
            order = _monotone_assignment(marks, pitches, ch)
            if order is None:
                stats["multi_marks_ambiguous"] += 1
                continue
            pmap = dict(zip(pitches, order))
            for n in grp:
                out[id(n)] = pmap[n.pitch]
            stats["multi_marks_mapped_to_simultaneous_notes"] += 1
        elif len(grp) == 1 and len(marks) == 2:
            continue  # handled as substitution by the caller
        else:
            stats["multi_marks_ambiguous"] += 1
            out[id(e)] = "0"
    return out


def convert_file(path: Path, keyboard_only: bool = True, search_dirs: list[Path] | None = None) -> Conversion:
    warnings: list[str] = []
    try:
        toks = L.tokenize_file(path, warnings=warnings, search_dirs=search_dirs)
        parser = L.Parser(toks)
        parser.parse_file()
    except Exception as e:  # noqa: BLE001 - report any parser failure as a conversion error
        return Conversion(path, {}, [], {"stage": "parse"}, error=f"parse: {type(e).__name__}: {e}")
    header = _merge_headers(parser)
    diag: dict = {"parser_warnings": len(parser.warnings), "parser_warning_examples": parser.warnings[:5],
                  "unknown_commands": dict(Counter(parser.unknown_commands).most_common(10)),
                  "version": ".".join(map(str, parser.version)), "language": parser.language}
    scores = [s for s in parser.scores if s.has_layout or not s.has_midi]
    if not scores and parser.toplevel_music:
        scores = [L.ScoreN(L.SimN(parser.toplevel_music), True, False, {}, 0)]
    diag["n_scores"] = len(parser.scores)
    diag["n_layout_scores"] = len(scores)
    parts: list[Part] = []
    rel = L.Relativizer(parser.version)
    for s in scores:
        try:
            rel.resolve(s.music, None)
            ev = L.Evaluator()
            ev.run(s.music)
        except Exception as e:  # noqa: BLE001
            diag.setdefault("score_errors", []).append(f"score {s.index}: {type(e).__name__}: {e}")
            continue
        n_checks, n_fail, n_breaks = _meter_grid_failures(ev)
        bpm = ev.tempo or DEFAULT_BPM
        sec_per_whole = 4 * 60.0 / bpm
        for label, staff_map in _assign_parts(ev, keyboard_only):
            evs = [e for e in ev.events if e.staff in staff_map]
            if not evs:
                continue
            channel_of = {}
            for e in evs:
                ch = staff_map[e.staff]
                if e.autochange:
                    ch = 0 if e.pitch >= 60 else 1
                channel_of[id(e)] = ch
            stats: Counter = Counter()
            chord_map = _resolve_chord_fingers(evs, channel_of, stats)
            # staff lengths (end times) for consistency
            ends = defaultdict(Fraction)
            for e in evs:
                ends[e.staff] = max(ends[e.staff], e.offset)
            # dedupe unisons (same onset, pitch, channel)
            seen: dict[tuple, L.NoteEvent] = {}
            uniq = []
            for e in sorted(evs, key=lambda e: (e.onset, e.grace_order, channel_of[id(e)], e.pitch)):
                k = (e.onset, e.grace_order if e.grace else 0, e.pitch, channel_of[id(e)])
                if k in seen:
                    stats["duplicate_unison_merged"] += 1
                    if not seen[k].fingers and e.fingers:
                        seen[k].fingers = e.fingers
                    continue
                seen[k] = e
                uniq.append(e)
            # grace timing: spread grace groups just before (or after) their beat
            grace_groups: dict[tuple, list] = defaultdict(list)
            for e in uniq:
                if e.grace:
                    grace_groups[(e.onset, e.staff)].append(e)
            notes: list[Note] = []
            multi_map = _resolve_multi_marks(uniq, channel_of, stats)
            for idx, e in enumerate(uniq):
                ch = channel_of[id(e)]
                ftxts = e.fingers
                finger = "0"
                if id(e) in chord_map:
                    finger = chord_map[id(e)]
                elif id(e) in multi_map:
                    finger = multi_map[id(e)]
                elif len(ftxts) == 1:
                    f = normalize_finger_text(ftxts[0])
                    if f is None:
                        stats["finger_text_unparsed"] += 1
                    else:
                        finger = f
                elif len(ftxts) == 2:
                    # two stacked marks on a lone note: in Mutopia sources these are alternative
                    # fingerings (e.g. "4 / 5"), not substitutions (which are written \finger "4-1");
                    # keep the first (primary) one
                    a, b = (normalize_finger_text(x) for x in ftxts)
                    if a:
                        finger = a
                        stats["two_marks_first_kept" if a != b else "two_identical_marks"] += 1
                    else:
                        stats["finger_text_unparsed"] += 1
                elif len(ftxts) > 2:
                    stats["more_than_two_marks_on_note"] += 1
                if finger != "0":
                    finger = _signed(finger, ch)
                on = float(e.onset) * sec_per_whole
                off = float(e.offset) * sec_per_whole
                if e.grace:
                    grp = sorted({x.grace_order for x in grace_groups[(e.onset, e.staff)]})
                    pos = grp.index(e.grace_order)
                    if e.grace_order < 0:
                        on = on - (len(grp) - pos) * GRACE_SECONDS
                    else:
                        on = on + pos * GRACE_SECONDS
                    off = on + GRACE_SECONDS
                notes.append(Note(id="", onset=round(on, 6), offset=round(max(off, on), 6),
                                  spelled_pitch=midi_to_spelled(e.pitch), onset_velocity=64, offset_velocity=80,
                                  channel=ch, finger=finger, line_no=e.line))
            notes.sort(key=lambda n: (n.onset, n.channel, n.pitch))
            notes = [Note(id=str(i), onset=n.onset, offset=n.offset, spelled_pitch=n.spelled_pitch,
                          onset_velocity=n.onset_velocity, offset_velocity=n.offset_velocity, channel=n.channel,
                          finger=n.finger, line_no=n.line_no) for i, n in enumerate(notes)]
            n_f = sum(1 for n in notes if n.finger != "0")
            staff_ends = sorted(float(v) for v in ends.values())
            pdiag = {
                "n_notes": len(notes), "n_fingered": n_f,
                "fingered_fraction": round(n_f / len(notes), 4) if notes else 0.0,
                "n_rh": sum(1 for n in notes if n.channel == 0), "n_lh": sum(1 for n in notes if n.channel == 1),
                "n_fingered_rh": sum(1 for n in notes if n.channel == 0 and n.finger != "0"),
                "n_fingered_lh": sum(1 for n in notes if n.channel == 1 and n.finger != "0"),
                "bar_checks": n_checks, "bar_check_failures": n_fail, "bar_check_breaks": n_breaks,
                "staff_end_whole_notes": staff_ends,
                "staff_length_mismatch": (staff_ends[-1] - staff_ends[0]) if len(staff_ends) > 1 else 0.0,
                "tempo_bpm_quarter": bpm, "n_grace": sum(1 for e in uniq if e.grace),
                **dict(stats),
            }
            title = s.header.get("piece") or s.header.get("title") or ""
            parts.append(Part(key=f"s{s.index:02d}{'_' + str(len(parts)) if True else ''}", score_index=s.index,
                              label=f"{label} {title}".strip(), notes=notes, diagnostics=pdiag))
    return Conversion(path, header, parts, diag)
