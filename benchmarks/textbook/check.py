#!/usr/bin/env python3
"""Quality gates for the digitus2 textbook fingering oracle (standard library only).

Run:  python benchmarks/textbook/check.py        (exit code 1 if any gate fails)

The pitch content of every entry is re-derived here from KEY SIGNATURES (letters plus
sharps/flats), independently of generate.py, which builds pitches from interval patterns.
The fingering gates encode the textbook rules stated in docs/research/textbook-oracle.md.
"""
from __future__ import annotations

import json
import os
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ("scales.json", "arpeggios.json", "chromatic.json")

LETTERS = "CDEFGAB"
LETTER_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SHARP_ORDER = "FCGDAEB"
FLAT_ORDER = "BEADGCF"
# Key signatures: positive = number of sharps, negative = number of flats.
MAJOR_SIG = {"C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6,
             "Db": -5, "Ab": -4, "Eb": -3, "Bb": -2, "F": -1}
MINOR_SIG = {"A": 0, "E": 1, "B": 2, "F#": 3, "C#": 4, "G#": 5,
             "Eb": -6, "Bb": -5, "F": -4, "C": -3, "G": -2, "D": -1}
PC_TO_MINOR_KEY = {0: "C", 1: "C#", 2: "D", 3: "Eb", 4: "E", 5: "F", 6: "F#",
                   7: "G", 8: "G#", 9: "A", 10: "Bb", 11: "B"}
NAME_PC = {"C": 0, "C#": 1, "Db": 1, "D": 2, "Eb": 3, "D#": 3, "E": 4, "F": 5, "F#": 6,
           "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "Bb": 10, "A#": 10, "B": 11}
BLACK = {1, 3, 6, 8, 10}
ACC_TXT = {-2: "bb", -1: "b", 0: "", 1: "#", 2: "x"}

# Entries allowed to put the thumb on a black key. Scales and chromatic scales: none.
# Arpeggios: only the two triads that have no white key at all (Kelley: "except where
# there are no white keys (F# major and D#/Eb minor)").
THUMB_ON_BLACK_ALLOWED = {("arpeggio", "major", "F#"), ("arpeggio", "minor", "Eb")}


# ---------------------------------------------------------------- pitch derivation
def signature_alterations(n: int) -> dict:
    alt = {letter: 0 for letter in LETTERS}
    if n > 0:
        for letter in SHARP_ORDER[:n]:
            alt[letter] = 1
    elif n < 0:
        for letter in FLAT_ORDER[:-n]:
            alt[letter] = -1
    return alt


def spelled_scale(tonic: str, form: str) -> list:
    """Seven [letter, alteration] pairs for tonic/form, read off the key signature.

    form: major | natural_minor | harmonic_minor | melodic_minor_asc
    """
    sig = MAJOR_SIG[tonic] if form == "major" else MINOR_SIG[tonic]
    alt = signature_alterations(sig)
    start = LETTERS.index(tonic[0])
    notes = [[LETTERS[(start + d) % 7], alt[LETTERS[(start + d) % 7]]] for d in range(7)]
    expected_acc = {"": 0, "#": 1, "b": -1}[tonic[1:]]
    if notes[0][1] != expected_acc:
        raise ValueError(f"key signature does not contain tonic {tonic}")
    if form == "harmonic_minor":
        notes[6][1] += 1
    elif form == "melodic_minor_asc":
        notes[5][1] += 1
        notes[6][1] += 1
    elif form not in ("major", "natural_minor"):
        raise ValueError(form)
    return notes


def note_name(n) -> str:
    return n[0] + ACC_TXT[n[1]]


def note_pc(n) -> int:
    return (LETTER_PC[n[0]] + n[1]) % 12


def expected_pitch_classes(e: dict) -> tuple[list, int]:
    """(ordered pitch classes starting at the root/tonic, root pc) for an entry."""
    fam, mode, key = e["family"], e["mode"], e["key"]
    if fam == "scale":
        if mode == "major":
            form = "major"
        elif mode == "harmonic_minor":
            form = "harmonic_minor"
        elif mode == "melodic_minor":
            form = "melodic_minor_asc" if e["direction"] == "ascending" else "natural_minor"
        else:
            raise ValueError(mode)
        notes = spelled_scale(key, form)
        pcs = [note_pc(n) for n in notes]
        return pcs, pcs[0]
    if fam == "arpeggio":
        if mode == "major":
            s = spelled_scale(key, "major")
            chord = [s[0], s[2], s[4]]
        elif mode == "minor":
            s = spelled_scale(key, "natural_minor")
            chord = [s[0], s[2], s[4]]
        elif mode == "dominant7":
            s = spelled_scale(key, "major")  # V7 of the key: degrees 5, 7, 2, 4
            chord = [s[4], s[6], s[1], s[3]]
        elif mode == "diminished7":
            # vii-o7 of the harmonic minor whose leading note is the starting note
            tonic = PC_TO_MINOR_KEY[(NAME_PC[key] + 1) % 12]
            s = spelled_scale(tonic, "harmonic_minor")
            chord = [s[6], s[1], s[3], s[5]]
        else:
            raise ValueError(mode)
        pcs = [note_pc(n) for n in chord]
        return pcs, pcs[0]
    if fam == "chromatic":
        root = NAME_PC[key]
        return [(root + i) % 12 for i in range(12)], root
    raise ValueError(fam)


# ---------------------------------------------------------------- fingering gates
def motion_errors(fam: str, hand: str, midi_asc: list, fingers_asc: list) -> list:
    """Finger-motion rules, applied to the ascending reading of the entry."""
    errs = []
    for i in range(len(fingers_asc) - 1):
        a, b = fingers_asc[i], fingers_asc[i + 1]
        if a == b:
            errs.append(f"finger {a} repeated on consecutive notes at index {i}")
            continue
        if fam == "scale":
            # adjacent fingers for adjacent steps, except at a thumb crossing
            if hand == "rh":
                ok = (b == a + 1) or (b == 1 and a in (2, 3, 4))
            else:
                ok = (b == a - 1) or (a == 1 and b in (2, 3, 4))
        elif fam == "arpeggio":
            # fingers move outward through the hand; the only reversals are thumb crossings
            if hand == "rh":
                ok = (b > a) or (b == 1 and a in (2, 3, 4))
            else:
                ok = (b < a) or (a == 1 and b in (2, 3, 4))
        else:
            ok = True  # chromatic: checked by chromatic_errors
        if not ok:
            errs.append(f"bad finger motion {a}->{b} (ascending reading) at index {i}")
    return errs


def chromatic_errors(hand: str, midi_asc: list, fingers_asc: list) -> list:
    """3 on every black key; thumb on white keys except the E-F / B-C pairs, where RH
    plays 1-2 and LH plays 2-1 (ascending): the second finger takes the white key that
    follows (RH) or precedes (LH) another white key."""
    errs = []
    n = len(midi_asc)
    for i, (m, f) in enumerate(zip(midi_asc, fingers_asc)):
        if m % 12 in BLACK:
            want = 3
        elif hand == "rh":
            want = 2 if i > 0 and midi_asc[i - 1] % 12 not in BLACK else 1
        else:
            want = 2 if i + 1 < n and midi_asc[i + 1] % 12 not in BLACK else 1
        if f != want:
            errs.append(f"chromatic rule wants finger {want} on midi {m} (index {i}), got {f}")
    return errs


def periodicity_errors(fam: str, mode: str, fingers_asc: list) -> list:
    """Interior notes repeat the octave pattern (start/end substitutions excluded)."""
    if fam == "scale":
        period, lo = 7, 2
    elif fam == "arpeggio":
        period, lo = (3 if mode in ("major", "minor") else 4), 1
    else:
        return []
    errs = []
    n = len(fingers_asc)
    for i in range(lo, n - 1 - period):
        if fingers_asc[i] != fingers_asc[i + period]:
            errs.append(f"octave pattern broken at index {i}: {fingers_asc[i]} vs {fingers_asc[i + period]}")
    return errs


def fingering_errors(e: dict, fingers: list, label: str) -> list:
    errs = []
    midi = e["midi"]
    if len(fingers) != len(midi):
        return [f"{label}: {len(fingers)} fingers for {len(midi)} notes"]
    if any((not isinstance(f, int)) or f < 1 or f > 5 for f in fingers):
        return [f"{label}: finger values must be integers 1..5"]
    asc = e["direction"] == "ascending"
    midi_asc = midi if asc else midi[::-1]
    fing_asc = fingers if asc else fingers[::-1]
    fam = e["family"]
    for i, m in enumerate(midi):
        if fingers[i] == 1 and m % 12 in BLACK and (fam, e["mode"], e["key"]) not in THUMB_ON_BLACK_ALLOWED:
            errs.append(f"{label}: thumb on black key midi {m} (index {i})")
    errs += [f"{label}: {x}" for x in motion_errors(fam, e["hand"], midi_asc, fing_asc)]
    if fam == "chromatic":
        errs += [f"{label}: {x}" for x in chromatic_errors(e["hand"], midi_asc, fing_asc)]
    errs += [f"{label}: {x}" for x in periodicity_errors(fam, e["mode"], fing_asc)]
    return errs


# ---------------------------------------------------------------- per-entry gates
REQUIRED = ("id", "family", "key", "mode", "hand", "direction", "octaves", "startMidi",
            "midi", "fingers", "source", "sources", "alternatives", "confidence", "chord", "note")


def entry_errors(e: dict) -> dict:
    """Returns {gate_name: [errors]} for one entry."""
    out = defaultdict(list)
    missing = [k for k in REQUIRED if k not in e]
    if missing:
        out["schema"].append(f"missing fields {missing}")
        return out
    midi, octaves = e["midi"], e["octaves"]
    if e["startMidi"] != midi[0]:
        out["schema"].append("startMidi != midi[0]")
    if not e["source"].get("url") or not e["source"].get("name"):
        out["schema"].append("source needs name and url")
    for s in e["sources"]:
        if not s.get("url") or not s.get("name"):
            out["schema"].append("every source needs name and url")
    # --- pitch gates
    asc = e["direction"] == "ascending"
    steps = [b - a for a, b in zip(midi, midi[1:])]
    if not all((s > 0) if asc else (s < 0) for s in steps):
        out["monotone"].append(f"midi not strictly monotone in direction {e['direction']}")
    lo, hi = min(midi), max(midi)
    if hi - lo != 12 * octaves:
        out["span"].append(f"span {hi - lo} semitones != {12 * octaves}")
    pcs, root = expected_pitch_classes(e)
    if midi[0] % 12 != root or midi[-1] % 12 != root:
        out["span"].append("first/last note is not the tonic/root")
    want = [m for m in range(lo, hi + 1) if m % 12 in set(pcs)]
    got = sorted(midi)
    if got != want:
        extra = sorted(set(got) - set(want))
        miss = sorted(set(want) - set(got))
        out["pitch_content"].append(f"pitch content mismatch: extra {extra}, missing {miss}")
    # anchor: tonic nearest middle C (ties downward) for RH, one octave lower for LH
    rh_anchor = 60 + ((root + 6) % 12) - 6
    want_lo = rh_anchor if e["hand"] == "rh" else rh_anchor - 12
    if lo != want_lo:
        out["anchor"].append(f"lowest note {lo} != expected anchor {want_lo}")
    # --- fingering gates
    out["fingering"] += fingering_errors(e, e["fingers"], "primary")
    seen = {tuple(e["fingers"])}
    for k, alt in enumerate(e["alternatives"]):
        if "fingers" not in alt or "source" not in alt:
            out["schema"].append(f"alternative {k} needs fingers and source")
            continue
        t = tuple(alt["fingers"])
        if t in seen:
            out["alternatives"].append(f"alternative {k} duplicates primary or another alternative")
        seen.add(t)
        out["alternatives"] += fingering_errors(e, alt["fingers"], f"alternative {k}")
    return out


# ---------------------------------------------------------------- source fidelity
# Literal transcriptions of the cited sources, as read on 2026-10-13 (ascending order, one digit
# per note). They are typed here independently of generate.py's cycle tables: every row must
# appear in the matching entry as `fingers` or as an alternative, and the source must be cited
# for exactly that fingering. Rows: (source key, family, mode, key, hand, octaves, fingers).
# Scale mode "natural" means the natural-minor table, checked against the descending melodic
# entry (reversed). Chromatic rows are one octave from C, checked against the start of the
# two-octave entry. Kelley's arpeggio chart prints 4-note patterns ("1231", "1421"); the rows
# below expand them to two octaves with 5 at the turnaround, as the chart instructs.
_WHITE_RH_1, _WHITE_LH_1 = "12312345", "54321321"
_WHITE_RH_2, _WHITE_LH_2 = "123123412312345", "543213214321321"
TRANSCRIPTIONS = (
    # pianoscales.org major (one octave)
    *[("ps_major", "scale", "major", k, "rh", 1, _WHITE_RH_1) for k in "CDEGAB"],
    *[("ps_major", "scale", "major", k, "lh", 1, _WHITE_LH_1) for k in "CDEFGA"],
    ("ps_major", "scale", "major", "F", "rh", 1, "12341234"),
    ("ps_major", "scale", "major", "B", "lh", 1, "43214321"),
    ("ps_major", "scale", "major", "Db", "rh", 1, "23123412"), ("ps_major", "scale", "major", "Db", "lh", 1, "32143213"),
    ("ps_major", "scale", "major", "Eb", "rh", 1, "31234123"), ("ps_major", "scale", "major", "Eb", "lh", 1, "32143213"),
    ("ps_major", "scale", "major", "F#", "rh", 1, "23412312"), ("ps_major", "scale", "major", "F#", "lh", 1, "43213214"),
    ("ps_major", "scale", "major", "Ab", "rh", 1, "34123123"), ("ps_major", "scale", "major", "Ab", "lh", 1, "32143213"),
    ("ps_major", "scale", "major", "Bb", "rh", 1, "21231234"), ("ps_major", "scale", "major", "Bb", "lh", 1, "32143213"),
    # pianoscales.org harmonic minor (one octave)
    *[("ps_harmonic", "scale", "harmonic_minor", k, "rh", 1, _WHITE_RH_1) for k in "ABCDEG"],
    *[("ps_harmonic", "scale", "harmonic_minor", k, "lh", 1, _WHITE_LH_1) for k in "ACDEFG"],
    ("ps_harmonic", "scale", "harmonic_minor", "F", "rh", 1, "12341234"),
    ("ps_harmonic", "scale", "harmonic_minor", "B", "lh", 1, "43214321"),
    ("ps_harmonic", "scale", "harmonic_minor", "Bb", "rh", 1, "21231234"), ("ps_harmonic", "scale", "harmonic_minor", "Bb", "lh", 1, "21321432"),
    ("ps_harmonic", "scale", "harmonic_minor", "C#", "rh", 1, "34123123"), ("ps_harmonic", "scale", "harmonic_minor", "C#", "lh", 1, "32143213"),
    ("ps_harmonic", "scale", "harmonic_minor", "Eb", "rh", 1, "31234123"), ("ps_harmonic", "scale", "harmonic_minor", "Eb", "lh", 1, "21432132"),
    ("ps_harmonic", "scale", "harmonic_minor", "F#", "rh", 1, "23123123"), ("ps_harmonic", "scale", "harmonic_minor", "F#", "lh", 1, "43213214"),
    ("ps_harmonic", "scale", "harmonic_minor", "G#", "rh", 1, "23123123"), ("ps_harmonic", "scale", "harmonic_minor", "G#", "lh", 1, "32143213"),
    # pianoscales.org natural minor (one octave) -> melodic minor descending
    *[("ps_natural", "scale", "natural", k, "rh", 1, _WHITE_RH_1) for k in "ABCDEG"],
    *[("ps_natural", "scale", "natural", k, "lh", 1, _WHITE_LH_1) for k in "ACDEFG"],
    ("ps_natural", "scale", "natural", "F", "rh", 1, "12341234"),
    ("ps_natural", "scale", "natural", "B", "lh", 1, "43214321"),
    ("ps_natural", "scale", "natural", "Bb", "rh", 1, "21231234"), ("ps_natural", "scale", "natural", "Bb", "lh", 1, "21321432"),
    ("ps_natural", "scale", "natural", "C#", "rh", 1, "34123123"), ("ps_natural", "scale", "natural", "C#", "lh", 1, "32143213"),
    ("ps_natural", "scale", "natural", "Eb", "rh", 1, "31234123"), ("ps_natural", "scale", "natural", "Eb", "lh", 1, "21432132"),
    ("ps_natural", "scale", "natural", "F#", "rh", 1, "23123123"), ("ps_natural", "scale", "natural", "F#", "lh", 1, "43213214"),
    ("ps_natural", "scale", "natural", "G#", "rh", 1, "34123123"), ("ps_natural", "scale", "natural", "G#", "lh", 1, "32132143"),
    # MasterPiano (one octave; minors apply to every form unless a melodic/harmonic line is given)
    ("masterpiano", "scale", "major", "Bb", "rh", 1, "21231234"), ("masterpiano", "scale", "major", "Eb", "rh", 1, "31234123"),
    ("masterpiano", "scale", "major", "Ab", "rh", 1, "34123123"), ("masterpiano", "scale", "major", "Db", "lh", 1, "32143213"),
    ("masterpiano", "scale", "major", "F#", "lh", 1, "43213214"),
    ("masterpiano", "scale", "harmonic_minor", "F#", "rh", 1, "23123123"),
    ("masterpiano", "scale", "harmonic_minor", "F#", "lh", 1, "43213214"),
    ("masterpiano", "scale", "natural", "F#", "rh", 1, "23123123"),
    ("masterpiano", "scale", "melodic_minor", "F#", "rh", 1, "23123412"),
    ("masterpiano", "scale", "harmonic_minor", "C#", "rh", 1, "34123123"),
    ("masterpiano", "scale", "melodic_minor", "C#", "rh", 1, "34123412"),
    ("masterpiano", "scale", "harmonic_minor", "G#", "rh", 1, "34123123"),
    ("masterpiano", "scale", "melodic_minor", "G#", "lh", 1, "32143213"),
    ("masterpiano", "scale", "natural", "G#", "lh", 1, "32132143"),
    ("masterpiano", "scale", "harmonic_minor", "Eb", "lh", 1, "21432132"),
    ("masterpiano", "scale", "melodic_minor", "Bb", "rh", 1, "21231234"),
    ("masterpiano", "scale", "melodic_minor", "Bb", "lh", 1, "21321432"),
    # piano-keyboard-guide.com (one octave)
    ("pkg_bb", "scale", "major", "Bb", "rh", 1, "41231234"), ("pkg_ab", "scale", "major", "Ab", "rh", 1, "34123123"),
    ("pkg_ab", "scale", "major", "Ab", "lh", 1, "32143213"),
    ("pkg_csm", "scale", "natural", "C#", "rh", 1, "34123123"), ("pkg_csm", "scale", "natural", "C#", "lh", 1, "32143213"),
    ("pkg_ebm", "scale", "natural", "Eb", "rh", 1, "31234123"), ("pkg_ebm", "scale", "natural", "Eb", "lh", 1, "21432132"),
    ("pkg_fsm", "scale", "natural", "F#", "rh", 1, "23123123"), ("pkg_fsm", "scale", "natural", "F#", "lh", 1, "43213214"),
    # oktav.com (RH, one octave), Musicnotes (one octave), Hoffman one-octave pages
    ("oktav_bb", "scale", "major", "Bb", "rh", 1, "21231234"), ("oktav_ab", "scale", "major", "Ab", "rh", 1, "23123123"),
    ("oktav_csm", "scale", "natural", "C#", "rh", 1, "23123123"), ("oktav_gsm", "scale", "natural", "G#", "rh", 1, "23123123"),
    ("oktav_fsm", "scale", "natural", "F#", "rh", 1, "23123123"),
    ("musicnotes_bb", "scale", "major", "Bb", "rh", 1, "21231234"), ("musicnotes_bb", "scale", "major", "Bb", "lh", 1, "32143212"),
    ("hoffman_ebmaj", "scale", "major", "Eb", "rh", 1, "31234123"), ("hoffman_ebmaj", "scale", "major", "Eb", "lh", 1, "32143213"),
    ("hoffman_gsm", "scale", "natural", "G#", "rh", 1, "34123123"), ("hoffman_gsm", "scale", "natural", "G#", "lh", 1, "32132143"),
    ("hoffman_gsm", "scale", "harmonic_minor", "G#", "lh", 1, "32143213"),
    ("hoffman_fsm", "scale", "natural", "F#", "rh", 1, "34123123"),
    # Beauchamp, Music & Health (two octaves)
    *[("mh_cgdae", "scale", m, k, "rh", 2, _WHITE_RH_2) for m in ("major", "harmonic_minor") for k in "CGDAE"],
    *[("mh_cgdae", "scale", m, k, "lh", 2, _WHITE_LH_2) for m in ("major", "harmonic_minor") for k in "CGDAE"],
    ("mh_bfscs", "scale", "major", "B", "rh", 2, _WHITE_RH_2), ("mh_bfscs", "scale", "major", "B", "lh", 2, "432143213214321"),
    ("mh_bfscs", "scale", "major", "F#", "rh", 2, "234123123412312"), ("mh_bfscs", "scale", "major", "F#", "lh", 2, "432132143213212"),
    ("mh_bfscs", "scale", "major", "Db", "rh", 2, "231234123123412"), ("mh_bfscs", "scale", "major", "Db", "lh", 2, "321432132143212"),
    ("mh_bf", "scale", "harmonic_minor", "B", "lh", 2, "432143213214321"),
    ("mh_bf", "scale", "major", "F", "rh", 2, "123412312341234"), ("mh_bf", "scale", "harmonic_minor", "F", "lh", 2, _WHITE_LH_2),
    ("mh_bf", "scale", "harmonic_minor", "Bb", "rh", 2, "212312341231234"), ("mh_bf", "scale", "harmonic_minor", "Bb", "lh", 2, "213214321321432"),
    ("mh_bf", "scale", "harmonic_minor", "Eb", "rh", 2, "212341231234123"), ("mh_bf", "scale", "harmonic_minor", "Eb", "lh", 2, "214321321432132"),
    *[("mh_abgscs", "scale", m, k, "rh", 2, "231231234123123") for m, k in (("major", "Ab"), ("harmonic_minor", "G#"), ("harmonic_minor", "C#"))],
    *[("mh_abgscs", "scale", m, k, "lh", 2, "321432132143212") for m, k in (("major", "Ab"), ("harmonic_minor", "G#"), ("harmonic_minor", "C#"))],
    ("mh_ebfsbb", "scale", "major", "Eb", "rh", 2, "212341231234123"), ("mh_ebfsbb", "scale", "major", "Eb", "lh", 2, "321432132143212"),
    ("mh_ebfsbb", "scale", "harmonic_minor", "F#", "rh", 2, "231231234123123"), ("mh_ebfsbb", "scale", "harmonic_minor", "F#", "lh", 2, "432132143213212"),
    ("mh_ebfsbb", "scale", "major", "Bb", "rh", 2, "212312341231234"), ("mh_ebfsbb", "scale", "major", "Bb", "lh", 2, "321432132143212"),
    # Commonwealth University handout (two octaves; V = 2-3 group, W = 2-3-4 group)
    *[("cwu", "scale", m, k, "rh", 2, _WHITE_RH_2) for m in ("major", "harmonic_minor") for k in "CGDAE"],
    *[("cwu", "scale", m, k, "lh", 2, _WHITE_LH_2) for m in ("major", "harmonic_minor") for k in "CGDAE"],
    *[("cwu", "scale", m, "B", "rh", 2, _WHITE_RH_2) for m in ("major", "harmonic_minor")],
    *[("cwu", "scale", m, "B", "lh", 2, "432143213214321") for m in ("major", "harmonic_minor")],
    *[("cwu", "scale", m, "F", "rh", 2, "123412312341234") for m in ("major", "harmonic_minor")],
    *[("cwu", "scale", m, "F", "lh", 2, _WHITE_LH_2) for m in ("major", "harmonic_minor")],
    ("cwu", "scale", "major", "Db", "rh", 2, "231234123123412"), ("cwu", "scale", "major", "Db", "lh", 2, "321432132143212"),
    ("cwu", "scale", "major", "F#", "rh", 2, "234123123412312"), ("cwu", "scale", "major", "F#", "lh", 2, "432132143213212"),
    ("cwu", "scale", "major", "Eb", "rh", 2, "312341231234123"), ("cwu", "scale", "major", "Eb", "lh", 2, "321432132143213"),
    ("cwu", "scale", "major", "Ab", "rh", 2, "341231234123123"), ("cwu", "scale", "major", "Ab", "lh", 2, "321432132143213"),
    ("cwu", "scale", "major", "Bb", "rh", 2, "412312341231234"), ("cwu", "scale", "major", "Bb", "lh", 2, "321432132143213"),
    # Hoffman Academy two-octave lessons
    ("hoffman_eb2", "scale", "major", "Eb", "rh", 2, "312341231234123"), ("hoffman_eb2", "scale", "major", "Eb", "lh", 2, "321432132143213"),
    ("hoffman_bb2", "scale", "major", "Bb", "rh", 2, "412312341231234"), ("hoffman_bb2", "scale", "major", "Bb", "lh", 2, "321432132143213"),
    ("hoffman_f2", "scale", "major", "F", "rh", 2, "123412312341234"), ("hoffman_f2", "scale", "major", "F", "lh", 2, _WHITE_LH_2),
    ("hoffman_e", "scale", "major", "E", "rh", 2, _WHITE_RH_2), ("hoffman_e", "scale", "major", "E", "lh", 2, _WHITE_LH_2),
    ("hoffman_bm", "scale", "harmonic_minor", "B", "rh", 2, _WHITE_RH_2), ("hoffman_bm", "scale", "harmonic_minor", "B", "lh", 2, "432143213214321"),
    ("hoffman_cm", "scale", "harmonic_minor", "C", "lh", 2, _WHITE_LH_2),
    ("hoffman_adg", "scale", "harmonic_minor", "A", "rh", 2, _WHITE_RH_2), ("hoffman_adg", "scale", "harmonic_minor", "A", "lh", 2, _WHITE_LH_2),
    # Arpeggios (two octaves)
    *[("escadon", "arpeggio", "major", k, "rh", 2, "1231235") for k in ("C", "F", "G", "F#", "A", "D", "E", "B")],
    *[("escadon", "arpeggio", "major", k, "lh", 2, "5421421") for k in ("C", "F", "G", "F#")],
    *[("escadon", "arpeggio", "major", k, "lh", 2, "5321321") for k in ("A", "D", "E", "B")],
    *[("escadon", "arpeggio", "minor", k, "rh", 2, "1231235") for k in ("A", "D", "E", "Eb", "C", "F", "G", "B")],
    *[("escadon", "arpeggio", "minor", k, "lh", 2, "5421421") for k in ("A", "D", "E", "Eb", "C", "F", "G", "B")],
    *[("escadon", "arpeggio", "major", k, "rh", 2, "3124124") for k in ("Ab", "Db", "Eb")],
    *[("escadon", "arpeggio", "minor", k, "rh", 2, "3124124") for k in ("C#", "F#", "G#")],
    *[("escadon", "arpeggio", m, k, "lh", 2, "2142142") for m, k in (("major", "Ab"), ("major", "Db"), ("major", "Eb"),
                                                                     ("minor", "C#"), ("minor", "F#"), ("minor", "G#"))],
    ("escadon", "arpeggio", "major", "Bb", "rh", 2, "2124124"), ("escadon", "arpeggio", "major", "Bb", "lh", 2, "3213213"),
    ("escadon", "arpeggio", "minor", "Bb", "rh", 2, "2312312"), ("escadon", "arpeggio", "minor", "Bb", "lh", 2, "3213213"),
    *[("kelley_arp", "arpeggio", "major", k, "rh", 2, "1231235") for k in ("C", "D", "E", "F", "G", "A", "B", "F#")],
    *[("kelley_arp", "arpeggio", "major", k, "lh", 2, "5421421") for k in ("C", "F", "G")],
    *[("kelley_arp", "arpeggio", "major", k, "lh", 2, "5321321") for k in ("D", "E", "A", "B", "F#")],
    *[("kelley_arp", "arpeggio", "major", k, "rh", 2, "2124124") for k in ("Db", "Eb", "Ab", "Bb")],
    *[("kelley_arp", "arpeggio", "major", k, "lh", 2, "2142142") for k in ("Db", "Eb", "Ab")],
    ("kelley_arp", "arpeggio", "major", "Bb", "lh", 2, "3213213"),
    *[("kelley_arp", "arpeggio", "minor", k, "rh", 2, "1231235") for k in ("A", "B", "C", "D", "E", "F", "G", "Eb")],
    *[("kelley_arp", "arpeggio", "minor", k, "lh", 2, "5421421") for k in ("A", "B", "C", "D", "E", "F", "G", "Eb")],
    *[("kelley_arp", "arpeggio", "minor", k, "rh", 2, "2124124") for k in ("C#", "F#", "G#")],
    *[("kelley_arp", "arpeggio", "minor", k, "lh", 2, "2142142") for k in ("C#", "F#", "G#")],
    ("kelley_arp", "arpeggio", "minor", "Bb", "rh", 2, "2312312"), ("kelley_arp", "arpeggio", "minor", "Bb", "lh", 2, "3213213"),
    *[("cwu", "arpeggio", "major", k, "rh", 2, "1231235") for k in ("C", "F", "G")],
    *[("cwu", "arpeggio", "major", k, "lh", 2, "5321321") for k in ("C", "F", "G")],
    *[("cwu", "arpeggio", "minor", k, "rh", 2, "1231235") for k in ("A", "D", "E")],
    *[("cwu", "arpeggio", "minor", k, "lh", 2, "5421421") for k in ("A", "D", "E")],
    *[("cwu", "arpeggio", "minor", k, "lh", 2, "5321321") for k in ("A", "D", "E")],  # footnoted variant
    *[("cwu", "arpeggio", "major", k, "rh", 2, "4124124") for k in ("Db", "Ab", "Eb", "Bb")],
    *[("cwu", "arpeggio", "major", k, "lh", 2, "2142142") for k in ("Db", "Ab", "Eb")],
    ("cwu", "arpeggio", "major", "Bb", "lh", 2, "3213213"),
    ("hoffman_eb2", "arpeggio", "major", "Eb", "rh", 2, "4124124"), ("hoffman_eb2", "arpeggio", "major", "Eb", "lh", 2, "2142142"),
    ("hoffman_bb2", "arpeggio", "major", "Bb", "rh", 2, "4124124"),
    ("hoffman_f2", "arpeggio", "major", "F", "rh", 2, "1231235"), ("hoffman_f2", "arpeggio", "major", "F", "lh", 2, "5421421"),
    ("hoffman_e", "arpeggio", "major", "E", "lh", 2, "5321321"),
    ("hoffman_cm", "arpeggio", "minor", "C", "lh", 2, "5421421"),
    ("hoffman_adg", "arpeggio", "minor", "A", "lh", 2, "5421421"),
    # Chromatic, one octave from C
    ("pkg_chromatic", "chromatic", "chromatic", "C", "rh", 1, "1313123131312"),
    ("pkg_chromatic", "chromatic", "chromatic", "C", "lh", 1, "1313213131321"),
    ("hoffman_chromatic", "chromatic", "chromatic", "C", "rh", 1, "1313123131312"),
    ("hoffman_chromatic", "chromatic", "chromatic", "C", "lh", 1, "1313213131321"),
)


# Source key -> URL, typed independently of generate.py so a mis-cited URL is caught.
SOURCE_URLS = {
    "escadon": "https://www.cs.miami.edu/~burt/music/finger-charts.html",
    "ps_major": "https://www.pianoscales.org/major.html",
    "ps_natural": "https://www.pianoscales.org/minor.html",
    "ps_harmonic": "https://www.pianoscales.org/minor-harmonic.html",
    "cwu": "https://commonwealthu.edu/documents/music-piano-handout-new-students-mansfield",
    "mh_cgdae": "https://musicandhealth.co.uk/scales_examples/fingering.htm",
    "mh_bfscs": "https://musicandhealth.co.uk/scales_examples/fingering1.htm",
    "mh_bf": "https://musicandhealth.co.uk/scales_examples/fingering2.htm",
    "mh_abgscs": "https://musicandhealth.co.uk/scales_examples/fingering3.htm",
    "mh_ebfsbb": "https://musicandhealth.co.uk/scales_examples/fingering4.htm",
    "hoffman_ebmaj": "https://hoffmanacademy.com/blog/e-flat-major-scale-on-piano",
    "hoffman_eb2": "https://app.hoffmanacademy.com/lessons/piano/scales-arpeggios-chords-in-e-flat-major/video/",
    "hoffman_bb2": "https://app.hoffmanacademy.com/lessons/piano/b-flat-major-scale-arpeggio/video/",
    "hoffman_f2": "https://app.hoffmanacademy.com/lessons/piano/scales-arpeggios-chords-in-f-major/video/",
    "hoffman_e": "https://app.hoffmanacademy.com/lessons/piano/e-major-scale-arpeggio-diatonic-chords/video/",
    "hoffman_bm": "https://app.hoffmanacademy.com/lessons/piano/b-minor-scales-arpeggios-chords/video/",
    "hoffman_cm": "https://app.hoffmanacademy.com/lessons/piano/c-minor-scales-arpeggio/video/",
    "hoffman_adg": "https://app.hoffmanacademy.com/lessons/piano/two-octave-minor-scales-and-arpeggios-in-a-d-g/video/",
    "hoffman_gsm": "https://www.hoffmanacademy.com/blog/g-sharp-minor-scale-piano",
    "hoffman_fsm": "https://www.hoffmanacademy.com/blog/f-sharp-minor-scale-piano",
    "hoffman_chromatic": "https://app.hoffmanacademy.com/lessons/piano/chromatic-scale/video/",
    "pkg_bb": "https://www.piano-keyboard-guide.com/b-flat-major-scale.html",
    "pkg_ab": "https://www.piano-keyboard-guide.com/a-flat-major-scale.html",
    "pkg_csm": "https://www.piano-keyboard-guide.com/c-sharp-minor-scale.html",
    "pkg_ebm": "https://www.piano-keyboard-guide.com/e-flat-minor-scale.html",
    "pkg_fsm": "https://www.piano-keyboard-guide.com/?p=426",
    "pkg_chromatic": "https://www.piano-keyboard-guide.com/?p=254",
    "oktav_bb": "https://www.oktav.com/en/c/b-flat-major-scale-piano",
    "oktav_ab": "https://www.oktav.com/en/c/a-flat-major-scale-piano",
    "oktav_csm": "https://www.oktav.com/en/c/c-sharp-minor-scale-piano",
    "oktav_gsm": "https://www.oktav.com/en/c/g-sharp-minor-scale-piano",
    "oktav_fsm": "https://www.oktav.com/en/c/f-sharp-minor-scale-piano",
    "musicnotes_bb": "https://www.musicnotes.com/blog/scale-guide-how-to-play-b-flat-major-on-piano",
    "masterpiano": "https://www.masterpiano.com/piano-scales",
    "kelley_arp": "https://robertkelleyphd.com/home/arpfing.htm",
}


def source_fidelity_errors(entries: list, sources_by_url: dict = SOURCE_URLS) -> tuple[int, list]:
    """Each transcription must equal the primary or an alternative of its entry, and that
    fingering must cite the transcribed source. Returns (rows checked, errors)."""
    idx = {e["id"]: e for e in entries}
    fam_of = {"scale", "arpeggio", "chromatic"}
    errs, n = [], 0
    for sid, fam, mode, key, hand, octs, digits in TRANSCRIPTIONS:
        want = [int(c) for c in digits]
        if fam == "scale" and mode == "natural":
            eid = f"scale.melodic_minor.{key}.{hand}.desc.{octs}oct"
            reverse = True
        elif fam == "chromatic":
            eid = f"chromatic.chromatic.{key}.{hand}.asc.2oct"
            reverse = False
        else:
            eid = f"{fam}.{mode}.{key}.{hand}.asc.{octs}oct"
            reverse = False
        if fam not in fam_of or eid not in idx:
            continue  # belongs to another file
        n += 1
        e = idx[eid]
        options = [(e["fingers"], e["sources"])] + [(a["fingers"], a["sources"]) for a in e["alternatives"]]
        hit = None
        for fingers, srcs in options:
            f = fingers[::-1] if reverse else fingers
            if fam == "chromatic":
                f = f[:len(want)]
            if f == want:
                hit = srcs
                break
        if hit is None:
            errs.append(f"{sid}: {digits} not found in {eid}")
        elif sources_by_url.get(sid) not in {s["url"] for s in hit}:
            errs.append(f"{sid}: {digits} found in {eid} but that fingering does not cite {sid}")
    return n, errs


# ---------------------------------------------------------------- cross-entry gates
def group_key(e: dict) -> tuple:
    return (e["family"], e["mode"], e["key"], e["hand"], e["octaves"])


def reverse_errors(entries: list) -> tuple[list, list]:
    """Descending == exact reverse of ascending (notes, fingers, alternatives), except
    melodic minor, whose descending form uses the natural-minor notes. Returns
    (errors, melodic_exceptions) where melodic_exceptions lists the melodic pairs whose
    descending fingering is NOT the reverse of the ascending fingering."""
    errs, melodic_diff = [], []
    by = defaultdict(dict)
    for e in entries:
        by[group_key(e)][e["direction"]] = e
    for gk, d in sorted(by.items()):
        if set(d) != {"ascending", "descending"}:
            errs.append(f"{gk}: needs exactly one ascending and one descending entry")
            continue
        a, b = d["ascending"], d["descending"]
        if gk[0] == "scale" and gk[1] == "melodic_minor":
            if b["midi"][0] != a["midi"][-1] or b["midi"][-1] != a["midi"][0]:
                errs.append(f"{gk}: melodic descending must cover the same range")
            if b["fingers"] != a["fingers"][::-1]:
                melodic_diff.append(gk)
            continue
        if b["midi"] != a["midi"][::-1]:
            errs.append(f"{gk}: descending notes are not the reverse of ascending")
        if b["fingers"] != a["fingers"][::-1]:
            errs.append(f"{gk}: descending fingers are not the reverse of ascending")
        alts_a = sorted(tuple(x["fingers"][::-1]) for x in a["alternatives"])
        alts_b = sorted(tuple(x["fingers"]) for x in b["alternatives"])
        if alts_a != alts_b:
            errs.append(f"{gk}: descending alternatives are not the reversed ascending ones")
    return errs, melodic_diff


def octave_consistency_errors(entries: list) -> list:
    """The same key/mode/hand/direction must use the same fingering pattern at every length:
    2- and 3-octave versions share their first and last 8 fingers; the 1-octave version
    shares the interior fingers (indices 2..6 in ascending reading) with the 2-octave one."""
    errs = []
    by = defaultdict(dict)
    for e in entries:
        if e["family"] != "scale":
            continue
        asc_f = e["fingers"] if e["direction"] == "ascending" else e["fingers"][::-1]
        by[(e["mode"], e["key"], e["hand"], e["direction"])][e["octaves"]] = asc_f
    for k, d in sorted(by.items()):
        if {1, 2, 3} - set(d):
            errs.append(f"{k}: missing octave counts")
            continue
        if d[2][:8] != d[3][:8] or d[2][-8:] != d[3][-8:]:
            errs.append(f"{k}: 2- and 3-octave fingerings disagree at the ends")
        if d[1][2:7] != d[2][2:7] or d[1][2:7] != d[2][9:14]:
            errs.append(f"{k}: 1-octave interior differs from the 2-octave pattern")
    return errs


def anchor_pair_errors(entries: list) -> list:
    errs = []
    by = defaultdict(dict)
    for e in entries:
        k = (e["family"], e["mode"], e["key"], e["direction"], e["octaves"])
        by[k][e["hand"]] = min(e["midi"])
    for k, d in sorted(by.items()):
        if set(d) != {"rh", "lh"}:
            errs.append(f"{k}: needs both hands")
        elif d["rh"] - d["lh"] != 12:
            errs.append(f"{k}: LH must sit exactly one octave below RH")
    return errs


# ---------------------------------------------------------------- driver
def load(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def run(verbose: bool = True) -> int:
    total_fail = 0
    gate_counts = Counter()
    gate_fail = Counter()
    report_lines = []
    all_entries = {}
    for fname in FILES:
        path = os.path.join(HERE, fname)
        doc = load(path)
        entries = doc["entries"]
        all_entries[fname] = entries
        ids = [e["id"] for e in entries]
        if len(ids) != len(set(ids)):
            report_lines.append(f"FAIL {fname}: duplicate ids")
            total_fail += 1
        if doc.get("count") != len(entries):
            report_lines.append(f"FAIL {fname}: count field {doc.get('count')} != {len(entries)}")
            total_fail += 1
        for e in entries:
            res = entry_errors(e)
            for gate in ("schema", "monotone", "span", "pitch_content", "anchor", "fingering", "alternatives"):
                gate_counts[gate] += 1
                if res.get(gate):
                    gate_fail[gate] += 1
                    total_fail += 1
                    for msg in res[gate][:3]:
                        report_lines.append(f"FAIL {e['id']} [{gate}] {msg}")
        rev_errs, melodic_diff = reverse_errors(entries)
        gate_counts["reverse"] += len({group_key(e) for e in entries})
        if rev_errs:
            gate_fail["reverse"] += len(rev_errs)
            total_fail += len(rev_errs)
            report_lines += [f"FAIL {fname} [reverse] {x}" for x in rev_errs[:20]]
        if melodic_diff:
            report_lines.append(f"INFO {fname}: melodic-minor pairs whose descending fingering is not the "
                                f"reverse of the ascending one (expected exception, natural-minor descent): "
                                + ", ".join(f"{k[2]} {k[3].upper()} {k[4]}oct" for k in melodic_diff))
        oc = octave_consistency_errors(entries)
        gate_counts["octave_consistency"] += len({(e["mode"], e["key"], e["hand"], e["direction"])
                                                  for e in entries if e["family"] == "scale"})
        if oc:
            gate_fail["octave_consistency"] += len(oc)
            total_fail += len(oc)
            report_lines += [f"FAIL {fname} [octave_consistency] {x}" for x in oc[:20]]
        n_rows, sf = source_fidelity_errors(entries)
        gate_counts["source_fidelity"] += n_rows
        if sf:
            gate_fail["source_fidelity"] += len(sf)
            total_fail += len(sf)
            report_lines += [f"FAIL {fname} [source_fidelity] {x}" for x in sf[:40]]
        ap = anchor_pair_errors(entries)
        gate_counts["hand_pairing"] += len({(e["family"], e["mode"], e["key"], e["direction"], e["octaves"])
                                            for e in entries})
        if ap:
            gate_fail["hand_pairing"] += len(ap)
            total_fail += len(ap)
            report_lines += [f"FAIL {fname} [hand_pairing] {x}" for x in ap[:20]]

    if verbose:
        print("Textbook oracle quality gates")
        for fname, entries in all_entries.items():
            c = Counter((e["family"], e["mode"]) for e in entries)
            conf = Counter(e["confidence"] for e in entries)
            n_alt = sum(1 for e in entries if e["alternatives"])
            thumbs_black = sorted({f"{e['mode']} {e['key']}" for e in entries
                                   if any(f == 1 and m % 12 in BLACK for f, m in zip(e["fingers"], e["midi"]))})
            print(f"  {fname}: {len(entries)} entries; " + ", ".join(f"{m}={n}" for (_, m), n in sorted(c.items())))
            print(f"    confidence: " + ", ".join(f"{k}={v}" for k, v in sorted(conf.items()))
                  + f"; entries with alternatives: {n_alt}")
            print(f"    thumb on a black key (primary): {thumbs_black or 'none'}")
        print("  gates (entries or groups checked / failures):")
        for gate in ("schema", "monotone", "span", "pitch_content", "anchor", "fingering", "alternatives",
                     "reverse", "octave_consistency", "hand_pairing", "source_fidelity"):
            print(f"    {gate:20s} {gate_counts[gate]:5d} checked, {gate_fail[gate]} failing")
        for line in report_lines[:200]:
            print("  " + line)
        print("RESULT: " + ("PASS" if total_fail == 0 else f"FAIL ({total_fail} problems)"))
    return 0 if total_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(run())
