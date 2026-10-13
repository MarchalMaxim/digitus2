#!/usr/bin/env python3
"""Generate the digitus2 TEXTBOOK ORACLE: scales, arpeggios and chromatic scales with the
fingering every piano method teaches, each table cited.

Run from anywhere (standard library only, Python 3.11):

    python benchmarks/textbook/generate.py

Writes scales.json, arpeggios.json and chromatic.json next to this file, refreshes the
generated tables inside docs/research/textbook-oracle.md (between the BEGIN/END GENERATED
markers), then runs the quality gates in check.py and exits non-zero if any gate fails.

Pitches here are built from interval patterns; check.py re-derives them from key signatures.
Fingerings are described per key as an octave-periodic CYCLE (one finger per scale degree or
chord tone) plus optional START / END substitutions on the first or last notes, which is how
every printed scale book is organised (the cycle is where the 4th finger falls; the ends are
where a book prints a different first or last finger).
"""
from __future__ import annotations

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DOC = os.path.join(ROOT, "docs", "research", "textbook-oracle.md")
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True  # keep benchmarks/textbook free of __pycache__
import check  # noqa: E402  (shared spelling helpers for the docs tables; gates)

PC = {"C": 0, "C#": 1, "Db": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "F#": 6, "G": 7,
      "G#": 8, "Ab": 8, "A": 9, "Bb": 10, "B": 11}
BLACK = {1, 3, 6, 8, 10}
OCTAVES = (1, 2, 3)

# --------------------------------------------------------------------------- sources
SOURCES = {
    "escadon": ("Fingering charts, piano scales: 4th-finger placement, both hands, for every major, natural, "
                "harmonic and melodic minor scale, plus a root-position arpeggio chart (chart of Prof. Escadon, "
                "University of Miami, c. 1999, published by B. Rosenberg)",
                "https://www.cs.miami.edu/~burt/music/finger-charts.html"),
    "ps_major": ("pianoscales.org, Piano Major Scales (RH and LH fingering per key)",
                 "https://www.pianoscales.org/major.html"),
    "ps_natural": ("pianoscales.org, Piano Minor Scales (natural minor, RH and LH fingering per key)",
                   "https://www.pianoscales.org/minor.html"),
    "ps_harmonic": ("pianoscales.org, Piano Harmonic Minor Scales (RH and LH fingering per key)",
                    "https://www.pianoscales.org/minor-harmonic.html"),
    "ps_fingerings": ("pianoscales.org, Fingerings: B-flat major RH may start on 2, 3 or 4; 4 suits many octaves",
                      "https://www.pianoscales.org/fingerings.html"),
    "cwu": ("Commonwealth University (Mansfield) Dept. of Music, piano handout for new students: scale and "
            "arpeggio fingering patterns (two-octave)",
            "https://commonwealthu.edu/documents/music-piano-handout-new-students-mansfield"),
    "mh_cgdae": ("R. Beauchamp, Music & Health piano syllabus: fingering for C, G, D, A, E major and minor "
                 "(two-octave)", "https://musicandhealth.co.uk/scales_examples/fingering.htm"),
    "mh_bfscs": ("R. Beauchamp, Music & Health piano syllabus: fingering for B, F-sharp and C-sharp major "
                 "(two-octave)", "https://musicandhealth.co.uk/scales_examples/fingering1.htm"),
    "mh_bf": ("R. Beauchamp, Music & Health piano syllabus: fingering for B and F major and minor, B-flat and "
              "E-flat minor (two-octave)", "https://musicandhealth.co.uk/scales_examples/fingering2.htm"),
    "mh_abgscs": ("R. Beauchamp, Music & Health piano syllabus: fingering for A-flat major, G-sharp minor and "
                  "C-sharp minor (two-octave)", "https://musicandhealth.co.uk/scales_examples/fingering3.htm"),
    "mh_ebfsbb": ("R. Beauchamp, Music & Health piano syllabus: fingering for E-flat major, F-sharp minor and "
                  "B-flat major (two-octave)", "https://musicandhealth.co.uk/scales_examples/fingering4.htm"),
    "mh_brokenchord": ("R. Beauchamp, Music & Health piano syllabus: broken-chord fingering (argues LH 5-4-2-1 "
                       "rather than 5-3-2-1 for C major)",
                       "https://musicandhealth.co.uk/scales_examples/example.htm"),
    "hoffman_ebmaj": ("Hoffman Academy, E-flat major scale (one-octave)",
                      "https://hoffmanacademy.com/blog/e-flat-major-scale-on-piano"),
    "hoffman_eb2": ("Hoffman Academy lesson: two-octave scales, arpeggios and chords in E-flat major",
                    "https://app.hoffmanacademy.com/lessons/piano/scales-arpeggios-chords-in-e-flat-major/video/"),
    "hoffman_bb2": ("Hoffman Academy lesson: B-flat major two-octave scale and arpeggio",
                    "https://app.hoffmanacademy.com/lessons/piano/b-flat-major-scale-arpeggio/video/"),
    "hoffman_f2": ("Hoffman Academy lesson: two-octave scales, arpeggios and chords in F major",
                   "https://app.hoffmanacademy.com/lessons/piano/scales-arpeggios-chords-in-f-major/video/"),
    "hoffman_d": ("Hoffman Academy lesson: D major scale and arpeggio",
                  "https://app.hoffmanacademy.com/lessons/piano/d-major-scale-arpeggio/video/"),
    "hoffman_e": ("Hoffman Academy lesson: E major scale, arpeggio and chords",
                  "https://app.hoffmanacademy.com/lessons/piano/e-major-scale-arpeggio-diatonic-chords/video/"),
    "hoffman_bm": ("Hoffman Academy lesson: B minor scales, arpeggios and chords",
                   "https://app.hoffmanacademy.com/lessons/piano/b-minor-scales-arpeggios-chords/video/"),
    "hoffman_cm": ("Hoffman Academy lesson: C minor scales and arpeggio",
                   "https://app.hoffmanacademy.com/lessons/piano/c-minor-scales-arpeggio/video/"),
    "hoffman_adg": ("Hoffman Academy lesson: two-octave minor scales and arpeggios in A, D and G",
                    "https://app.hoffmanacademy.com/lessons/piano/two-octave-minor-scales-and-arpeggios-in-a-d-g/video/"),
    "hoffman_gsm": ("Hoffman Academy, G-sharp minor scale (natural; states the harmonic/melodic LH change)",
                    "https://www.hoffmanacademy.com/blog/g-sharp-minor-scale-piano"),
    "hoffman_fsm": ("Hoffman Academy, F-sharp minor scale (natural, one-octave)",
                    "https://www.hoffmanacademy.com/blog/f-sharp-minor-scale-piano"),
    "hoffman_chromatic": ("Hoffman Academy lesson: chromatic scale",
                          "https://app.hoffmanacademy.com/lessons/piano/chromatic-scale/video/"),
    "pkg_bb": ("piano-keyboard-guide.com, B-flat major scale", "https://www.piano-keyboard-guide.com/b-flat-major-scale.html"),
    "pkg_ab": ("piano-keyboard-guide.com, A-flat major scale", "https://www.piano-keyboard-guide.com/a-flat-major-scale.html"),
    "pkg_csm": ("piano-keyboard-guide.com, C-sharp minor scale (natural)",
                "https://www.piano-keyboard-guide.com/c-sharp-minor-scale.html"),
    "pkg_ebm": ("piano-keyboard-guide.com, E-flat minor scale (natural)",
                "https://www.piano-keyboard-guide.com/e-flat-minor-scale.html"),
    "pkg_fsm": ("piano-keyboard-guide.com, F-sharp minor scale (natural)", "https://www.piano-keyboard-guide.com/?p=426"),
    "pkg_chromatic": ("piano-keyboard-guide.com, How to play the chromatic scale (RH 1313 123 1313 12, "
                      "LH 1313 213 1313 21 from C)", "https://www.piano-keyboard-guide.com/?p=254"),
    "oktav_bb": ("oktav.com, B-flat major scale (RH starts on 2 for one octave, on 4 for more than one)",
                 "https://www.oktav.com/en/c/b-flat-major-scale-piano"),
    "oktav_ab": ("oktav.com, A-flat major scale", "https://www.oktav.com/en/c/a-flat-major-scale-piano"),
    "oktav_csm": ("oktav.com, C-sharp minor scale (natural)", "https://www.oktav.com/en/c/c-sharp-minor-scale-piano"),
    "oktav_gsm": ("oktav.com, G-sharp minor scale (natural)", "https://www.oktav.com/en/c/g-sharp-minor-scale-piano"),
    "oktav_fsm": ("oktav.com, F-sharp minor scale (natural)", "https://www.oktav.com/en/c/f-sharp-minor-scale-piano"),
    "musicnotes_bb": ("Musicnotes, Scale guide: how to play B-flat major on piano (RH 2 1 2 3 1 2 3 4, LH 3 2 1 4 3 2 1 2)",
                      "https://www.musicnotes.com/blog/scale-guide-how-to-play-b-flat-major-on-piano"),
    "masterpiano": ("MasterPiano, Piano scales: fingering chart for all 12 major and 12 minor scales",
                    "https://www.masterpiano.com/piano-scales"),
    "kelley_arp": ("R. T. Kelley, Guide to Learning Piano: arpeggio fingering chart (standard accepted root-position "
                   "fingerings, all keys)", "https://robertkelleyphd.com/home/arpfing.htm"),
    "fergus_black": ("F. Black, Guide to Playing Diminished Seventh Arpeggios for ABRSM Grade 8 Piano (2011): Hanon's "
                     "diminished sevenths start on white notes with the thumbs together on the first note of each "
                     "group of four; black-note starts put the thumbs on different white notes",
                     "https://www.scribd.com/doc/264965107/Diminished-7th-Guide"),
    "roskell_dom7": ("P. Roskell, The Art of Piano Fingering, ch. 11, Arpeggios of the dominant seventh (basic "
                     "fingering 1 2 3 4; charts by key)",
                     "https://dfp.informance.biz/content/pages/6-the-art-of-piano-fingering/447-chapter-11-arpeggios-of-the-dominant-seventh"),
    "roskell_dim7": ("P. Roskell, The Art of Piano Fingering, ch. 12, Arpeggios of the diminished seventh (basic "
                     "fingering 1 2 3 4)",
                     "https://www.informance.biz/wiki/6-the-art-of-piano-fingering/448-chapter-12-arpeggios-of-the-diminished-seventh"),
    "hanon": ("C.-L. Hanon, The Virtuoso Pianist (1873), Part II: scales, arpeggios and seventh-chord arpeggios in "
              "all keys (No. 42 = diminished sevenths); public-domain scans",
              "https://imslp.org/wiki/The_Virtuoso_Pianist_(Hanon,_Charles-Louis)"),
}


def src(sid: str) -> dict:
    name, url = SOURCES[sid]
    return {"name": name, "url": url}


# --------------------------------------------------------------------------- spec helpers
def V(cycle, start=None, end=None, sources=(), primary=OCTAVES, only=OCTAVES):
    """One fingering variant: octave-periodic cycle + optional start/end substitutions.

    primary: octave counts for which this variant is the primary answer.
    only:    octave counts for which the variant applies at all (as primary or alternative).
    """
    return {"cycle": list(cycle), "start": list(start) if start else None,
            "end": list(end) if end else None, "sources": list(sources),
            "primary": set(primary), "only": set(only)}


def S(confidence, *variants, note=None):
    """A hand's spec. confidence: agreed | majority | tie | rule (see README)."""
    return {"confidence": confidence, "variants": list(variants), "note": note}


def alt(cycle, start=None, end=None, sources=(), only=OCTAVES):
    return V(cycle, start, end, sources, primary=(), only=only)


# Shared cycles (scale-degree order 1..7, ascending).
RH_WHITE = [1, 2, 3, 1, 2, 3, 4]   # 4th finger on degree 7; top tonic takes 5
LH_WHITE = [1, 4, 3, 2, 1, 3, 2]   # 4th finger on degree 2; bottom tonic takes 5
LH_B = [1, 3, 2, 1, 4, 3, 2]       # B major/minor LH: 4th finger on F-sharp; starts on 4
RH_F = [1, 2, 3, 4, 1, 2, 3]       # F major/minor RH: 4th finger on B-flat; top F takes 4

ANY_TWO_OCT = "two-octave table; the top-note variant applies at any length"

# --------------------------------------------------------------------------- scale data
MAJOR = {}
for k in ("C", "G", "D", "A", "E"):
    s = ["ps_major", "cwu", "mh_cgdae", "escadon"] + (["hoffman_d"] if k == "D" else []) + (["hoffman_e"] if k == "E" else [])
    MAJOR[k] = {"rh": S("agreed", V(RH_WHITE, end=[5], sources=s)),
                "lh": S("agreed", V(LH_WHITE, start=[5], sources=s))}
MAJOR["B"] = {"rh": S("agreed", V(RH_WHITE, end=[5], sources=["ps_major", "cwu", "mh_bfscs", "escadon"])),
              "lh": S("agreed", V(LH_B, start=[4], sources=["ps_major", "cwu", "mh_bfscs", "escadon"]))}
MAJOR["F"] = {"rh": S("agreed", V(RH_F, end=[4], sources=["ps_major", "cwu", "mh_bf", "hoffman_f2", "escadon"])),
              "lh": S("agreed", V(LH_WHITE, start=[5], sources=["ps_major", "cwu", "mh_bf", "hoffman_f2", "escadon"]))}
MAJOR["Bb"] = {
    "rh": S("majority",
            V([4, 1, 2, 3, 1, 2, 3], start=[2], primary=(1,),
              sources=["ps_major", "musicnotes_bb", "oktav_bb", "masterpiano", "mh_ebfsbb"]),
            V([4, 1, 2, 3, 1, 2, 3], primary=(2, 3),
              sources=["cwu", "hoffman_bb2", "oktav_bb", "pkg_bb", "ps_fingerings", "escadon"]),
            note="One-octave charts mostly start on 2 (pianoscales.org, Musicnotes, oktav, MasterPiano; "
                 "piano-keyboard-guide starts on 4); two-octave sources mostly start on 4 (Commonwealth "
                 "University, Hoffman, oktav's multi-octave advice; Beauchamp starts on 2). Primary follows "
                 "the majority for each length; the other start is listed as the alternative."),
    "lh": S("majority",
            V([3, 2, 1, 4, 3, 2, 1], sources=["ps_major", "cwu", "hoffman_bb2", "escadon"]),
            alt([3, 2, 1, 4, 3, 2, 1], end=[2], sources=["mh_ebfsbb", "musicnotes_bb"])),
}
MAJOR["Eb"] = {
    "rh": S("majority",
            V([3, 1, 2, 3, 4, 1, 2], sources=["ps_major", "cwu", "hoffman_ebmaj", "hoffman_eb2", "masterpiano", "escadon"]),
            alt([3, 1, 2, 3, 4, 1, 2], start=[2], sources=["mh_ebfsbb"])),
    "lh": S("majority",
            V([3, 2, 1, 4, 3, 2, 1], sources=["ps_major", "cwu", "hoffman_ebmaj", "hoffman_eb2", "escadon"]),
            alt([3, 2, 1, 4, 3, 2, 1], end=[2], sources=["mh_ebfsbb"])),
}
MAJOR["Ab"] = {
    "rh": S("majority",
            V([3, 4, 1, 2, 3, 1, 2], sources=["ps_major", "pkg_ab", "cwu", "masterpiano", "escadon"]),
            alt([3, 4, 1, 2, 3, 1, 2], start=[2, 3], sources=["oktav_ab", "mh_abgscs"])),
    "lh": S("majority",
            V([3, 2, 1, 4, 3, 2, 1], sources=["ps_major", "pkg_ab", "cwu", "escadon"]),
            alt([3, 2, 1, 4, 3, 2, 1], end=[2], sources=["mh_abgscs"])),
}
MAJOR["Db"] = {
    "rh": S("agreed", V([2, 3, 1, 2, 3, 4, 1], sources=["ps_major", "cwu", "mh_bfscs", "masterpiano", "escadon"])),
    "lh": S("tie",
            V([3, 2, 1, 4, 3, 2, 1], sources=["ps_major", "masterpiano", "escadon"]),
            alt([3, 2, 1, 4, 3, 2, 1], end=[2], sources=["mh_bfscs", "cwu"]),
            note="LH top note: 3 in the one-octave charts (pianoscales.org, MasterPiano), 2 in the two-octave "
                 "tables (Beauchamp, Commonwealth University). Tie broken toward the octave pattern."),
}
MAJOR["F#"] = {
    "rh": S("agreed", V([2, 3, 4, 1, 2, 3, 1], sources=["ps_major", "cwu", "mh_bfscs", "masterpiano", "escadon"])),
    "lh": S("tie",
            V([4, 3, 2, 1, 3, 2, 1], sources=["ps_major", "masterpiano", "escadon"]),
            alt([4, 3, 2, 1, 3, 2, 1], end=[2], sources=["mh_bfscs", "cwu"]),
            note="LH top note: 4 in the one-octave charts (pianoscales.org, MasterPiano), 2 in the two-octave "
                 "tables (Beauchamp, Commonwealth University). Tie broken toward the octave pattern."),
}

HARMONIC = {}
for k in ("A", "E", "D", "G", "C"):
    s = ["ps_harmonic", "cwu", "mh_cgdae", "escadon"] + (["hoffman_adg"] if k in "ADG" else []) + (["hoffman_cm"] if k == "C" else [])
    HARMONIC[k] = {"rh": S("agreed", V(RH_WHITE, end=[5], sources=s)),
                   "lh": S("agreed", V(LH_WHITE, start=[5], sources=s))}
HARMONIC["B"] = {"rh": S("agreed", V(RH_WHITE, end=[5], sources=["ps_harmonic", "cwu", "mh_bf", "hoffman_bm", "escadon"])),
                 "lh": S("agreed", V(LH_B, start=[4], sources=["ps_harmonic", "cwu", "mh_bf", "hoffman_bm", "escadon"]))}
HARMONIC["F"] = {"rh": S("agreed", V(RH_F, end=[4], sources=["ps_harmonic", "cwu", "mh_bf", "escadon"])),
                 "lh": S("agreed", V(LH_WHITE, start=[5], sources=["ps_harmonic", "cwu", "mh_bf", "escadon"]))}
HARMONIC["F#"] = {
    "rh": S("majority",
            V([3, 4, 1, 2, 3, 1, 2], start=[2, 3], sources=["ps_harmonic", "mh_ebfsbb", "masterpiano"]),
            alt([3, 4, 1, 2, 3, 1, 2], sources=["hoffman_fsm", "escadon"])),
    "lh": S("majority",
            V([4, 3, 2, 1, 3, 2, 1], sources=["ps_harmonic", "masterpiano", "escadon"]),
            alt([4, 3, 2, 1, 3, 2, 1], end=[2], sources=["mh_ebfsbb"])),
}
HARMONIC["C#"] = {
    "rh": S("majority",
            V([3, 4, 1, 2, 3, 1, 2], sources=["ps_harmonic", "masterpiano", "escadon"]),
            alt([3, 4, 1, 2, 3, 1, 2], start=[2, 3], sources=["mh_abgscs"])),
    "lh": S("majority",
            V([3, 2, 1, 4, 3, 2, 1], sources=["ps_harmonic", "masterpiano", "escadon"]),
            alt([3, 2, 1, 4, 3, 2, 1], end=[2], sources=["mh_abgscs"])),
}
HARMONIC["G#"] = {
    "rh": S("tie",
            V([3, 4, 1, 2, 3, 1, 2], sources=["hoffman_gsm", "masterpiano", "escadon"]),
            alt([3, 4, 1, 2, 3, 1, 2], start=[2, 3], sources=["ps_harmonic", "mh_abgscs"]),
            note="Two sources each; the tie is broken toward the start that keeps the octave pattern from the "
                 "first note (3-4 on G-sharp, A-sharp), which is also the primary for the natural and melodic forms."),
    "lh": S("majority",
            V([3, 2, 1, 4, 3, 2, 1], sources=["ps_harmonic", "hoffman_gsm", "masterpiano", "escadon"]),
            alt([3, 2, 1, 4, 3, 2, 1], end=[2], sources=["mh_abgscs"])),
}
HARMONIC["Eb"] = {
    "rh": S("majority",
            V([3, 1, 2, 3, 4, 1, 2], sources=["ps_harmonic", "masterpiano", "escadon"]),
            alt([3, 1, 2, 3, 4, 1, 2], start=[2], sources=["mh_bf"])),
    "lh": S("agreed", V([2, 1, 4, 3, 2, 1, 3], sources=["ps_harmonic", "mh_bf", "masterpiano", "escadon"])),
}
HARMONIC["Bb"] = {
    "rh": S("majority",
            V([4, 1, 2, 3, 1, 2, 3], start=[2], sources=["ps_harmonic", "mh_bf", "masterpiano"]),
            alt([4, 1, 2, 3, 1, 2, 3], sources=["escadon"]),
            note="Alternative starts on 4, the finger the octave pattern puts on B-flat (Escadon chart)."),
    "lh": S("agreed", V([2, 1, 3, 2, 1, 4, 3], sources=["ps_harmonic", "mh_bf", "masterpiano", "escadon"])),
}

MELODIC_ASC = {}
for k in ("A", "E", "D", "G", "C"):
    s = ["escadon", "masterpiano"]
    MELODIC_ASC[k] = {"rh": S("agreed", V(RH_WHITE, end=[5], sources=s)),
                      "lh": S("agreed", V(LH_WHITE, start=[5], sources=s))}
MELODIC_ASC["B"] = {"rh": S("agreed", V(RH_WHITE, end=[5], sources=["escadon", "masterpiano", "hoffman_bm"])),
                    "lh": S("agreed", V(LH_B, start=[4], sources=["escadon", "masterpiano", "hoffman_bm"]))}
MELODIC_ASC["F"] = {"rh": S("agreed", V(RH_F, end=[4], sources=["escadon", "masterpiano"])),
                    "lh": S("agreed", V(LH_WHITE, start=[5], sources=["escadon", "masterpiano"]))}
MELODIC_ASC["F#"] = {"rh": S("agreed", V([2, 3, 1, 2, 3, 4, 1], sources=["escadon", "masterpiano"])),
                     "lh": S("agreed", V([4, 3, 2, 1, 3, 2, 1], sources=["escadon", "masterpiano"]))}
MELODIC_ASC["C#"] = {
    "rh": S("tie",
            V([2, 3, 1, 2, 3, 4, 1], sources=["escadon"]),
            alt([2, 3, 1, 2, 3, 4, 1], start=[3, 4], sources=["masterpiano"]),
            note="Escadon puts the RH 4th finger on A-sharp ascending (start 2-3 keeps that pattern from the first "
                 "note); MasterPiano starts 3-4 like the harmonic form. One source each; tie broken toward the "
                 "octave pattern."),
    "lh": S("agreed", V([3, 2, 1, 4, 3, 2, 1], sources=["escadon", "masterpiano"])),
}
MELODIC_ASC["G#"] = {"rh": S("agreed", V([3, 4, 1, 2, 3, 1, 2], sources=["hoffman_gsm", "masterpiano", "escadon"])),
                     "lh": S("agreed", V([3, 2, 1, 4, 3, 2, 1], sources=["hoffman_gsm", "masterpiano", "escadon"]))}
MELODIC_ASC["Eb"] = {"rh": S("agreed", V([3, 1, 2, 3, 4, 1, 2], sources=["escadon", "masterpiano"])),
                     "lh": S("agreed", V([2, 1, 4, 3, 2, 1, 3], sources=["escadon", "masterpiano"]))}
MELODIC_ASC["Bb"] = {
    "rh": S("majority",
            V([4, 1, 2, 3, 1, 2, 3], start=[2], sources=["masterpiano"]),
            alt([4, 1, 2, 3, 1, 2, 3], sources=["escadon"]),
            note="Start on 2 as in the natural and harmonic forms (all sources there); 4 is the octave-pattern finger."),
    "lh": S("agreed", V([2, 1, 3, 2, 1, 4, 3], sources=["escadon", "masterpiano"])),
}

NATURAL = {}  # used for the descending melodic minor
for k in ("A", "E", "D", "G", "C"):
    s = ["ps_natural", "escadon", "masterpiano"] + (["hoffman_adg"] if k in "ADG" else []) + (["hoffman_cm"] if k == "C" else [])
    NATURAL[k] = {"rh": S("agreed", V(RH_WHITE, end=[5], sources=s)),
                  "lh": S("agreed", V(LH_WHITE, start=[5], sources=s))}
NATURAL["B"] = {"rh": S("agreed", V(RH_WHITE, end=[5], sources=["ps_natural", "escadon", "masterpiano", "hoffman_bm"])),
                "lh": S("agreed", V(LH_B, start=[4], sources=["ps_natural", "escadon", "masterpiano", "hoffman_bm"]))}
NATURAL["F"] = {"rh": S("agreed", V(RH_F, end=[4], sources=["ps_natural", "escadon", "masterpiano"])),
                "lh": S("agreed", V(LH_WHITE, start=[5], sources=["ps_natural", "escadon", "masterpiano"]))}
NATURAL["F#"] = {
    "rh": S("majority",
            V([3, 4, 1, 2, 3, 1, 2], start=[2, 3], sources=["ps_natural", "pkg_fsm", "oktav_fsm", "masterpiano"]),
            alt([3, 4, 1, 2, 3, 1, 2], sources=["hoffman_fsm", "escadon"])),
    "lh": S("agreed", V([4, 3, 2, 1, 3, 2, 1], sources=["ps_natural", "pkg_fsm", "masterpiano", "escadon"])),
}
NATURAL["C#"] = {
    "rh": S("majority",
            V([3, 4, 1, 2, 3, 1, 2], sources=["ps_natural", "pkg_csm", "masterpiano", "escadon"]),
            alt([3, 4, 1, 2, 3, 1, 2], start=[2, 3], sources=["oktav_csm"])),
    "lh": S("agreed", V([3, 2, 1, 4, 3, 2, 1], sources=["ps_natural", "pkg_csm", "masterpiano"])),
}
NATURAL["G#"] = {
    "rh": S("majority",
            V([3, 4, 1, 2, 3, 1, 2], sources=["ps_natural", "hoffman_gsm", "masterpiano", "escadon"]),
            alt([3, 4, 1, 2, 3, 1, 2], start=[2, 3], sources=["oktav_gsm"])),
    "lh": S("agreed", V([3, 2, 1, 3, 2, 1, 4], sources=["ps_natural", "hoffman_gsm", "masterpiano", "escadon"])),
}
NATURAL["Eb"] = {"rh": S("agreed", V([3, 1, 2, 3, 4, 1, 2], sources=["ps_natural", "pkg_ebm", "masterpiano", "escadon"])),
                 "lh": S("agreed", V([2, 1, 4, 3, 2, 1, 3], sources=["ps_natural", "pkg_ebm", "masterpiano", "escadon"]))}
NATURAL["Bb"] = {
    "rh": S("majority",
            V([4, 1, 2, 3, 1, 2, 3], start=[2], sources=["ps_natural", "masterpiano", "mh_bf"]),
            alt([4, 1, 2, 3, 1, 2, 3], sources=["escadon"])),
    "lh": S("agreed", V([2, 1, 3, 2, 1, 4, 3], sources=["ps_natural", "masterpiano", "mh_bf", "escadon"])),
}

STEPS = {
    "major": [2, 2, 1, 2, 2, 2, 1],
    "natural": [2, 1, 2, 2, 1, 2, 2],
    "harmonic": [2, 1, 2, 2, 1, 3, 1],
    "melodic_asc": [2, 1, 2, 2, 2, 2, 1],
}
MAJOR_KEYS = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"]
MINOR_KEYS = ["A", "E", "B", "F#", "C#", "G#", "Eb", "Bb", "F", "C", "G", "D"]

# --------------------------------------------------------------------------- arpeggio data
# Triad cycles are in chord-tone order (root, third, fifth).
ARP_W_RH = dict(cycle=[1, 2, 3], end=[5])          # 1 2 3 1 2 3 5
ARP_4_LH = dict(cycle=[1, 4, 2], start=[5])        # 5 4 2 1 4 2 1
ARP_3_LH = dict(cycle=[1, 3, 2], start=[5])        # 5 3 2 1 3 2 1
ARP_BLK_RH = [4, 1, 2]                             # root on 4, thumb on the white third
ARP_BLK_LH = dict(cycle=[2, 1, 4])                 # 2 1 4 2 1 4 2

TRIAD_MAJOR = {}
for k in ("C", "F", "G"):
    rh_s = ["escadon", "kelley_arp", "cwu"] + (["hoffman_f2"] if k == "F" else [])
    lh_s = ["escadon", "kelley_arp", "mh_brokenchord"] + (["hoffman_f2"] if k == "F" else [])
    TRIAD_MAJOR[k] = {"rh": S("agreed", V(**ARP_W_RH, sources=rh_s)),
                      "lh": S("majority", V(**ARP_4_LH, sources=lh_s),
                              alt(**ARP_3_LH, sources=["cwu"]))}
for k in ("D", "A", "E"):
    lh_s = ["escadon", "kelley_arp"] + (["hoffman_d"] if k == "D" else []) + (["hoffman_e"] if k == "E" else [])
    TRIAD_MAJOR[k] = {"rh": S("agreed", V(**ARP_W_RH, sources=["escadon", "kelley_arp"])),
                      "lh": S("agreed", V(**ARP_3_LH, sources=lh_s))}
TRIAD_MAJOR["B"] = {"rh": S("agreed", V(**ARP_W_RH, sources=["escadon", "kelley_arp"])),
                    "lh": S("agreed", V(**ARP_3_LH, sources=["escadon", "kelley_arp"]))}
TRIAD_MAJOR["F#"] = {
    "rh": S("agreed", V(**ARP_W_RH, sources=["escadon", "kelley_arp"]),
            note="All three notes are black keys, so the thumb necessarily plays a black key."),
    "lh": S("tie", V(**ARP_4_LH, sources=["escadon"]), alt(**ARP_3_LH, sources=["kelley_arp"]),
            note="One source each. Primary 5-4-2-1 follows Escadon, who groups F-sharp major with C, F and G "
                 "major (same interval shape, uniform key colour); Kelley gives 5-3-2-1."),
}
for k in ("Db", "Ab", "Eb"):
    rh_s = ["cwu"] + (["hoffman_eb2"] if k == "Eb" else [])
    lh_s = ["escadon", "kelley_arp", "cwu"] + (["hoffman_eb2"] if k == "Eb" else [])
    TRIAD_MAJOR[k] = {
        "rh": S("majority" if k == "Eb" else "tie",
                V(ARP_BLK_RH, sources=rh_s),
                alt(ARP_BLK_RH, start=[2], sources=["kelley_arp"]),
                alt(ARP_BLK_RH, start=[3], sources=["escadon"]),
                note="Start finger on the black root is disputed: 4 (Commonwealth University; Hoffman for E-flat), "
                     "2 (Kelley), 3 (Escadon). Primary keeps the octave pattern (root on 4) from the first note."),
        "lh": S("agreed", V(**ARP_BLK_LH, sources=lh_s)),
    }
TRIAD_MAJOR["Bb"] = {
    "rh": S("tie",
            V(ARP_BLK_RH, sources=["cwu", "hoffman_bb2"]),
            alt(ARP_BLK_RH, start=[2], sources=["escadon", "kelley_arp"]),
            note="Two sources each (4 1 2 4 vs 2 1 2 4); tie broken toward the octave pattern (root on 4)."),
    "lh": S("agreed", V([3, 2, 1], sources=["escadon", "kelley_arp", "cwu"])),
}

TRIAD_MINOR = {}
for k in ("A", "D", "E"):
    rh_s = ["escadon", "kelley_arp", "cwu"] + (["hoffman_adg"] if k in "AD" else [])
    lh_s = ["escadon", "kelley_arp", "cwu"] + (["hoffman_adg"] if k in "AD" else [])
    TRIAD_MINOR[k] = {"rh": S("agreed", V(**ARP_W_RH, sources=rh_s)),
                      "lh": S("majority", V(**ARP_4_LH, sources=lh_s),
                              alt(**ARP_3_LH, sources=["cwu"]),
                              note="Commonwealth University prints 5-4-2-1 and footnotes that some technique "
                                   "books use the third finger.")}
for k in ("C", "F", "G", "B"):
    s = ["escadon", "kelley_arp"] + (["hoffman_cm"] if k == "C" else []) + (["hoffman_adg"] if k == "G" else []) \
        + (["hoffman_bm"] if k == "B" else [])
    TRIAD_MINOR[k] = {"rh": S("agreed", V(**ARP_W_RH, sources=s)),
                      "lh": S("agreed", V(**ARP_4_LH, sources=s))}
TRIAD_MINOR["Eb"] = {
    "rh": S("agreed", V(**ARP_W_RH, sources=["escadon", "kelley_arp"]),
            note="All three notes are black keys, so the thumb necessarily plays a black key."),
    "lh": S("agreed", V(**ARP_4_LH, sources=["escadon", "kelley_arp"])),
}
for k in ("C#", "F#", "G#"):
    TRIAD_MINOR[k] = {
        "rh": S("tie",
                V(ARP_BLK_RH, start=[2], sources=["kelley_arp"]),
                alt(ARP_BLK_RH, start=[3], sources=["escadon"]),
                note="One source each (Kelley 2 1 2 4, Escadon 3 1 2 4); neither keeps the octave pattern from "
                     "the first note, so the primary follows Kelley's chart, which is labelled the standard accepted "
                     "fingering."),
        "lh": S("agreed", V(**ARP_BLK_LH, sources=["escadon", "kelley_arp"])),
    }
TRIAD_MINOR["Bb"] = {"rh": S("agreed", V([2, 3, 1], sources=["escadon", "kelley_arp"])),
                     "lh": S("agreed", V([3, 2, 1], sources=["escadon", "kelley_arp"]))}

# Seventh chords: cycles in chord-tone order (root, third, fifth, seventh).
SEVENTH_WHITE = {"rh": dict(cycle=[1, 2, 3, 4], end=[5]), "lh": dict(cycle=[1, 4, 3, 2], start=[5])}
DOM7_ROOT = {"C": "G", "G": "D", "D": "A", "A": "E", "E": "B", "B": "F#", "F#": "C#",
             "Db": "Ab", "Ab": "Eb", "Eb": "Bb", "Bb": "F", "F": "C"}
DOM7_BLACK = {  # key: (RH cycle, LH cycle, RH alt cycle, LH alt cycle)
    "B": ([2, 3, 4, 1], [4, 3, 2, 1], None, None),            # F#7: thumbs on E
    "F#": ([2, 3, 4, 1], [4, 3, 2, 1], [4, 1, 2, 3], [2, 1, 4, 3]),  # C#7: thumbs on B (alt: on E#)
    "Db": ([4, 1, 2, 3], [2, 1, 4, 3], None, None),           # Ab7: thumbs on C
    "Ab": ([4, 1, 2, 3], [2, 1, 4, 3], None, None),           # Eb7: thumbs on G
    "Eb": ([4, 1, 2, 3], [3, 2, 1, 4], None, None),           # Bb7: RH thumb on D, LH thumb on F
}
DIM7_START = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
DIM7_BLACK = {  # start: (RH cycle, LH cycle)
    "C#": ([4, 1, 2, 3], [3, 2, 1, 4]),   # RH thumb E, LH thumb G
    "Eb": ([3, 4, 1, 2], [4, 3, 2, 1]),   # RH thumb A, LH thumb C
    "F#": ([4, 1, 2, 3], [3, 2, 1, 4]),   # RH thumb A, LH thumb C
    "Ab": ([4, 1, 2, 3], [4, 3, 2, 1]),   # RH thumb B, LH thumb F
    "Bb": ([3, 4, 1, 2], [4, 3, 2, 1]),   # RH thumb E, LH thumb G
}
RULE_NOTE = ("Derived from the documented rule, not copied from a per-key printed table: the basic fingering is "
             "1 2 3 4 (Roskell); white-note starts put both thumbs on the root (Hanon, as described by Black); on a "
             "black-note start the RH thumb takes the white key reached from a black key and the LH thumb the white "
             "key that leads to a black key, so the thumbs land on different white notes (Black).")


DOM7_WHITE_NOTE = ("White-note root: basic fingering 1 2 3 4 with the thumb on the root (Roskell's example is the "
                   "dominant seventh on G); 5 only at the outer end.")


def build_dom7():
    out = {}
    for key, root in DOM7_ROOT.items():
        if key in DOM7_BLACK:
            rh, lh, rh_alt, lh_alt = DOM7_BLACK[key]
            note = RULE_NOTE
            rh_vars = [V(rh, sources=["roskell_dom7", "fergus_black"])]
            lh_vars = [V(lh, sources=["roskell_dom7", "fergus_black"])]
            if rh_alt:
                note = RULE_NOTE + (" C-sharp 7 has two candidate white keys (E-sharp, B); the primary puts both thumbs "
                                    "on B (smaller thumb crossings), the alternative on E-sharp.")
                rh_vars.append(alt(rh_alt, sources=["roskell_dom7"]))
                lh_vars.append(alt(lh_alt, sources=["roskell_dom7"]))
            out[key] = {"rh": S("rule", *rh_vars, note=note), "lh": S("rule", *lh_vars, note=note)}
        else:
            out[key] = {"rh": S("agreed", V(**SEVENTH_WHITE["rh"], sources=["roskell_dom7"]), note=DOM7_WHITE_NOTE),
                        "lh": S("agreed", V(**SEVENTH_WHITE["lh"], sources=["roskell_dom7"]), note=DOM7_WHITE_NOTE)}
    return out


def build_dim7():
    out = {}
    for start in DIM7_START:
        if start in DIM7_BLACK:
            rh, lh = DIM7_BLACK[start]
            out[start] = {"rh": S("rule", V(rh, sources=["fergus_black", "roskell_dim7"]), note=RULE_NOTE),
                          "lh": S("rule", V(lh, sources=["fergus_black", "roskell_dim7"]), note=RULE_NOTE)}
        else:
            out[start] = {"rh": S("agreed", V(**SEVENTH_WHITE["rh"], sources=["fergus_black", "hanon", "roskell_dim7"])),
                          "lh": S("agreed", V(**SEVENTH_WHITE["lh"], sources=["fergus_black", "hanon", "roskell_dim7"]))}
    return out


DOM7 = build_dom7()
DIM7 = build_dim7()
CHORD_STEPS = {"major": [4, 3, 5], "minor": [3, 4, 5], "dominant7": [4, 3, 3, 2], "diminished7": [3, 3, 3, 3]}


# --------------------------------------------------------------------------- builders
def anchor(pc: int, hand: str) -> int:
    """Tonic nearest middle C (C4 = 60; F-sharp ties go down to F#3) for RH, one octave lower for LH."""
    rh = 60 + ((pc + 6) % 12) - 6
    return rh if hand == "rh" else rh - 12


def run_midi(start: int, steps: list, octaves: int) -> list:
    notes = [start]
    for _ in range(octaves):
        for s in steps:
            notes.append(notes[-1] + s)
    return notes


def realize(variant: dict, n: int) -> list:
    cyc = variant["cycle"]
    f = [cyc[i % len(cyc)] for i in range(n)]
    if variant["start"]:
        f[:len(variant["start"])] = variant["start"]
    if variant["end"]:
        f[n - len(variant["end"]):] = variant["end"]
    return f


def choose(spec: dict, octaves: int, n: int):
    """(primary fingers, primary sources, [(alt fingers, alt sources)]) for one length."""
    prim = [v for v in spec["variants"] if octaves in v["primary"] and octaves in v["only"]]
    if len(prim) != 1:
        raise ValueError(f"need exactly one primary variant for {octaves} octaves, got {len(prim)}")
    p = prim[0]
    pf = realize(p, n)
    alts = []
    for v in spec["variants"]:
        if v is p or octaves not in v["only"]:
            continue
        af = realize(v, n)
        if af == pf:
            continue
        for existing in alts:
            if existing[0] == af:
                existing[1].extend(s for s in v["sources"] if s not in existing[1])
                break
        else:
            alts.append((af, list(v["sources"])))
    return pf, list(p["sources"]), alts


def make_entry(family, mode, key, hand, direction, octaves, midi, fingers, sources, alts,
               confidence, note, chord=None, id_mode=None):
    d = "asc" if direction == "ascending" else "desc"
    return {
        "id": f"{family}.{id_mode or mode}.{key}.{hand}.{d}.{octaves}oct",
        "family": family,
        "key": key,
        "mode": mode,
        "chord": chord,
        "hand": hand,
        "direction": direction,
        "octaves": octaves,
        "startMidi": midi[0],
        "midi": midi,
        "fingers": fingers,
        "source": src(sources[0]),
        "sources": [src(s) for s in sources],
        "alternatives": [{"fingers": f, "source": src(s[0]), "sources": [src(x) for x in s]} for f, s in alts],
        "confidence": confidence,
        "note": note,
    }


def pair(family, mode, key, hand, octaves, asc_midi, asc_spec, desc_midi_asc=None, desc_spec=None,
         chord=None, extra_note=None):
    """Ascending entry plus descending entry. The descending entry is the exact reverse of
    the ascending one unless desc_spec/desc_midi_asc are given (melodic minor)."""
    n = len(asc_midi)
    pf, ps, alts = choose(asc_spec, octaves, n)
    note_a = " ".join(x for x in (asc_spec.get("note"), extra_note) if x) or None
    out = [make_entry(family, mode, key, hand, "ascending", octaves, asc_midi, pf, ps, alts,
                      asc_spec["confidence"], note_a, chord)]
    if desc_spec is None:
        out.append(make_entry(family, mode, key, hand, "descending", octaves, asc_midi[::-1], pf[::-1], ps,
                              [(f[::-1], s) for f, s in alts], asc_spec["confidence"], note_a, chord))
    else:
        dpf, dps, dalts = choose(desc_spec, octaves, len(desc_midi_asc))
        note_d = "Descending melodic minor uses the natural-minor notes and the natural-minor fingering."
        if desc_spec.get("note"):
            note_d += " " + desc_spec["note"]
        out.append(make_entry(family, mode, key, hand, "descending", octaves, desc_midi_asc[::-1], dpf[::-1], dps,
                              [(f[::-1], s) for f, s in dalts], desc_spec["confidence"], note_d, chord))
    return out


def build_scales() -> list:
    entries = []
    for mode, table, keys, steps in (("major", MAJOR, MAJOR_KEYS, STEPS["major"]),
                                     ("harmonic_minor", HARMONIC, MINOR_KEYS, STEPS["harmonic"])):
        for key in keys:
            for hand in ("rh", "lh"):
                for o in OCTAVES:
                    midi = run_midi(anchor(PC[key], hand), steps, o)
                    entries += pair("scale", mode, key, hand, o, midi, table[key][hand])
    for key in MINOR_KEYS:
        for hand in ("rh", "lh"):
            for o in OCTAVES:
                start = anchor(PC[key], hand)
                up = run_midi(start, STEPS["melodic_asc"], o)
                down_asc = run_midi(start, STEPS["natural"], o)
                entries += pair("scale", "melodic_minor", key, hand, o, up, MELODIC_ASC[key][hand],
                                desc_midi_asc=down_asc, desc_spec=NATURAL[key][hand])
    return entries


def chord_name(mode, key):
    if mode == "major":
        return key
    if mode == "minor":
        return key + "m"
    if mode == "dominant7":
        return DOM7_ROOT[key] + "7"
    return key + "dim7"


def build_arpeggios() -> list:
    entries = []
    for mode, table, keys in (("major", TRIAD_MAJOR, MAJOR_KEYS), ("minor", TRIAD_MINOR, MINOR_KEYS),
                              ("dominant7", DOM7, MAJOR_KEYS), ("diminished7", DIM7, DIM7_START)):
        for key in keys:
            root = DOM7_ROOT[key] if mode == "dominant7" else key
            for hand in ("rh", "lh"):
                midi = run_midi(anchor(PC[root], hand), CHORD_STEPS[mode], 2)
                entries += pair("arpeggio", mode, key, hand, 2, midi, table[key][hand], chord=chord_name(mode, key))
    return entries


def chromatic_fingers(midi_asc: list, hand: str) -> list:
    """3 on black keys, 1 on white keys; in the E-F and B-C pairs RH plays 1-2 and LH 2-1."""
    f = []
    for i, m in enumerate(midi_asc):
        if m % 12 in BLACK:
            f.append(3)
        elif hand == "rh":
            f.append(2 if i > 0 and midi_asc[i - 1] % 12 not in BLACK else 1)
        else:
            f.append(2 if i + 1 < len(midi_asc) and midi_asc[i + 1] % 12 not in BLACK else 1)
    return f


CHROMATIC_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def build_chromatic() -> list:
    entries = []
    for key in CHROMATIC_NAMES:
        for hand in ("rh", "lh"):
            midi = [anchor(PC[key], hand) + i for i in range(25)]
            f = chromatic_fingers(midi, hand)
            spec = S("agreed", V(f, sources=["pkg_chromatic", "hoffman_chromatic"]))
            entries += pair("chromatic", "chromatic", key, hand, 2, midi, spec)
    return entries


# --------------------------------------------------------------------------- output
FAMILY_DOC = {
    "scales.json": "Major, harmonic minor and melodic minor scales in all 12 keys, both hands, ascending and "
                   "descending, over 1, 2 and 3 octaves.",
    "arpeggios.json": "Root-position major and minor triad arpeggios, dominant seventh arpeggios (named by key; the "
                      "chord is built on the dominant) and diminished seventh arpeggios (named by starting note), "
                      "all 12 keys, both hands, ascending and descending, two octaves.",
    "chromatic.json": "Chromatic scales starting on every pitch class, both hands, ascending and descending, two "
                      "octaves.",
}
CONVENTIONS = {
    "fingers": "1 = thumb ... 5 = little finger, positive for both hands",
    "anchor": "lowest note = tonic/root nearest middle C (MIDI 60; F-sharp ties go down to 54) for RH, one octave "
              "lower for LH; descending entries cover the same range from the top",
    "startMidi": "always equal to midi[0] (the top note for descending entries)",
    "descending": "exact reverse of the ascending entry (notes, fingers, alternatives), except melodic minor, whose "
                  "descending entry uses the natural-minor notes and fingering",
    "confidence": "agreed = all consulted sources give this fingering; majority = sources disagree and the primary "
                  "has more of them; tie = equal support, broken by the rule stated in the entry note; rule = "
                  "derived from a documented fingering rule rather than a per-key printed table",
    "alternatives": "other fingerings printed by at least one cited source; a scorer should accept them",
}


def write_json(fname: str, entries: list) -> None:
    used = []
    for e in entries:
        for s in e["sources"] + [x for a in e["alternatives"] for x in a["sources"]]:
            if s not in used:
                used.append(s)
    doc = {
        "schemaVersion": 1,
        "oracle": "digitus2 textbook fingering oracle",
        "description": FAMILY_DOC[fname],
        "generatedBy": "benchmarks/textbook/generate.py",
        "conventions": CONVENTIONS,
        "count": len(entries),
        "sourcesUsed": used,
        "entries": entries,
    }
    text = json.dumps(doc, indent=1, ensure_ascii=False)
    # keep number arrays (midi, fingers) on one line so the files stay auditable by eye
    text = re.sub(r"\[\s*(-?\d+(?:,\s*-?\d+)*)\s*\]",
                  lambda m: "[" + ", ".join(x.strip() for x in m.group(1).split(",")) + "]", text)
    with open(os.path.join(HERE, fname), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text + "\n")


# --------------------------------------------------------------------------- docs tables
def fmt(f: list) -> str:
    return " ".join(str(x) for x in f)


def scale_note_names(key: str, form: str) -> str:
    notes = check.spelled_scale(key, form)
    return " ".join(check.note_name(n) for n in notes + [notes[0]])


def doc_tables(scales: list, arps: list, chrom: list) -> str:
    idx = {e["id"]: e for e in scales + arps + chrom}
    lines = []
    tag = {"agreed": "", "majority": " (majority)", "tie": " (tie)", "rule": " (rule)"}

    def alt_txt(e):
        if not e["alternatives"]:
            return ""
        return "; ".join(f"{fmt(a['fingers'])} [{', '.join(SHORT[s['url']] for s in a['sources'])}]"
                         for a in e["alternatives"])

    def srcs(e):
        return ", ".join(SHORT[s["url"]] for s in e["sources"])

    for mode, title, form, keys in (("major", "Major scales", "major", MAJOR_KEYS),
                                    ("harmonic_minor", "Harmonic minor scales", "harmonic_minor", MINOR_KEYS),
                                    ("melodic_minor", "Melodic minor scales, ascending (raised 6th and 7th)",
                                     "melodic_minor_asc", MINOR_KEYS)):
        lines += [f"### {title}", "",
                  "One octave ascending, then two octaves ascending. Descending is the exact reverse. "
                  "Source keys are listed under Sources below.", "",
                  "| Key | Notes | RH 1 oct | RH 2 oct | LH 1 oct | LH 2 oct | Sources (RH / LH) | Alternatives (RH / LH, 1 oct unless noted) |",
                  "|---|---|---|---|---|---|---|---|"]
        for key in keys:
            r1 = idx[f"scale.{mode}.{key}.rh.asc.1oct"]
            r2 = idx[f"scale.{mode}.{key}.rh.asc.2oct"]
            l1 = idx[f"scale.{mode}.{key}.lh.asc.1oct"]
            l2 = idx[f"scale.{mode}.{key}.lh.asc.2oct"]
            alts = []
            if r1["alternatives"]:
                alts.append("RH " + alt_txt(r1))
            if r2["alternatives"] and r2["fingers"][0] != r1["fingers"][0]:
                # the primary start differs by length (B-flat major RH): show the 2-octave alternative too
                alts.append("RH 2 oct " + alt_txt(r2))
            if l1["alternatives"]:
                alts.append("LH " + alt_txt(l1))
            lines.append(f"| {key} | {scale_note_names(key, form)} | {fmt(r1['fingers'])}{tag[r1['confidence']]} | "
                         f"{fmt(r2['fingers'])} | {fmt(l1['fingers'])}{tag[l1['confidence']]} | {fmt(l2['fingers'])} | "
                         f"{srcs(r1)} / {srcs(l1)} | {' ; '.join(alts)} |")
        lines.append("")
    lines += ["### Melodic minor scales, descending (natural-minor notes)", "",
              "Shown in descending order from the top tonic, one octave and two octaves.", "",
              "| Key | Notes (descending) | RH 1 oct | RH 2 oct | LH 1 oct | LH 2 oct | Sources (RH / LH) | Alternatives (RH / LH) |",
              "|---|---|---|---|---|---|---|---|"]
    for key in MINOR_KEYS:
        r1 = idx[f"scale.melodic_minor.{key}.rh.desc.1oct"]
        r2 = idx[f"scale.melodic_minor.{key}.rh.desc.2oct"]
        l1 = idx[f"scale.melodic_minor.{key}.lh.desc.1oct"]
        l2 = idx[f"scale.melodic_minor.{key}.lh.desc.2oct"]
        names = scale_note_names(key, "natural_minor").split()[::-1]
        alts = []
        if r1["alternatives"]:
            alts.append("RH " + alt_txt(r1))
        if l1["alternatives"]:
            alts.append("LH " + alt_txt(l1))
        lines.append(f"| {key} | {' '.join(names)} | {fmt(r1['fingers'])}{tag[r1['confidence']]} | {fmt(r2['fingers'])} | "
                     f"{fmt(l1['fingers'])}{tag[l1['confidence']]} | {fmt(l2['fingers'])} | {srcs(r1)} / {srcs(l1)} | "
                     f"{' ; '.join(alts)} |")
    lines.append("")

    for mode, title, keys in (("major", "Major triad arpeggios (root position)", MAJOR_KEYS),
                              ("minor", "Minor triad arpeggios (root position)", MINOR_KEYS),
                              ("dominant7", "Dominant seventh arpeggios (by key; chord on the dominant)", MAJOR_KEYS),
                              ("diminished7", "Diminished seventh arpeggios (by starting note)", DIM7_START)):
        lines += [f"### {title}", "", "Two octaves ascending; descending is the exact reverse.", "",
                  "| Key | Chord | RH | LH | Sources (RH / LH) | Alternatives |", "|---|---|---|---|---|---|"]
        for key in keys:
            r = idx[f"arpeggio.{mode}.{key}.rh.asc.2oct"]
            l = idx[f"arpeggio.{mode}.{key}.lh.asc.2oct"]
            alts = []
            if r["alternatives"]:
                alts.append("RH " + alt_txt(r))
            if l["alternatives"]:
                alts.append("LH " + alt_txt(l))
            lines.append(f"| {key} | {r['chord']} | {fmt(r['fingers'])}{tag[r['confidence']]} | "
                         f"{fmt(l['fingers'])}{tag[l['confidence']]} | {srcs(r)} / {srcs(l)} | {' ; '.join(alts)} |")
        lines.append("")

    lines += ["### Chromatic scales", "", "Two octaves ascending from each starting note; descending is the exact reverse.", "",
              "| Start | RH | LH |", "|---|---|---|"]
    for key in CHROMATIC_NAMES:
        r = idx[f"chromatic.chromatic.{key}.rh.asc.2oct"]
        l = idx[f"chromatic.chromatic.{key}.lh.asc.2oct"]
        lines.append(f"| {key} | {fmt(r['fingers'])} | {fmt(l['fingers'])} |")
    lines.append("")
    lines += ["### Source keys used in the tables", "", "| Key | Source |", "|---|---|"]
    for sid, (name, url) in SOURCES.items():
        lines.append(f"| {sid} | [{name}]({url}) |")
    lines.append("")
    return "\n".join(lines)


SHORT = {url: sid for sid, (name, url) in SOURCES.items()}
BEGIN = "<!-- BEGIN GENERATED TABLES (benchmarks/textbook/generate.py) -->"
END = "<!-- END GENERATED TABLES -->"


def update_doc(tables: str) -> None:
    if not os.path.exists(DOC):
        print(f"note: {DOC} not found; skipping docs tables")
        return
    with open(DOC, encoding="utf-8") as fh:
        text = fh.read()
    if BEGIN not in text or END not in text:
        print("note: generated-table markers not found in the doc; skipping")
        return
    new = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END), lambda m: BEGIN + "\n\n" + tables + "\n" + END,
                 text, flags=re.S)
    with open(DOC, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(new)


def main() -> int:
    scales = build_scales()
    arps = build_arpeggios()
    chrom = build_chromatic()
    write_json("scales.json", scales)
    write_json("arpeggios.json", arps)
    write_json("chromatic.json", chrom)
    update_doc(doc_tables(scales, arps, chrom))
    print(f"wrote scales.json ({len(scales)}), arpeggios.json ({len(arps)}), chromatic.json ({len(chrom)})")
    return check.run()


if __name__ == "__main__":
    sys.exit(main())
