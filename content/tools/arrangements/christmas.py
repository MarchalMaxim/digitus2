"""Christmas carols and songs: the new own arrangements of the collection `christmas` (L1 plan, Task 9).

Catalog entries: tools/catalog.d/christmas.json. The core arrangement Jingle Bells stays in
arrange.CORE_PIECES.

# Arrangement rules (L1 plan, Task 5; checked by tests/test_arrangements.py):
# Level 1: right hand in one five-finger position with at most one extension (the Twinkle A),
#   single notes, range at most 10 semitones; left hand whole, half or quarter notes, single
#   notes or open fifths in one position (range at most 7 semitones, at most 2 keys at once);
#   keys C, G or F major or A or D minor (at most one sharp or flat), no note outside the key's
#   scale; 2/4, 3/4, 4/4 or 6/8; tempo at most 120 quarters per minute; at most 32 bars.
# Level 2: the right hand may move positions (range at most 19 semitones); left hand simple
#   triads within a fifth, broken fifths, or a waltz bass at moderate tempo (at most 3 keys at
#   once, spanning at most 9 semitones); keys with up to two sharps or flats.
# Both levels: no triplets, repeats, grace notes or voices (the spec language does not have
#   them); write repeats out. No minor or major second, tritone, or minor or major seventh between
#   the left hand and the melody on a strong beat (beat 1; beats 1 and 3 in 4/4; both beats in
#   6/8) unless allowedClashes gives the reason.

References: every melody was typed from a dated notated source (retrieved 2026-10-14) and is kept
with the page text or scan under content/_raw/references/ (gitignored):
  - Wikipedia scores (LilyPond in the article): Silent Night, Joy to the World, O Come, All Ye
    Faithful, O Tannenbaum.
  - Scans of public-domain song books on the Internet Archive: Franklin Square Song Collection
    (Harper & Brothers, 1881) for Jolly Old Saint Nicholas and Deck the Hall; Christmas Carols New
    and Old, first series (Bramley and Stainer, Novello) for Good King Wenceslas and The First
    Nowell.
A melody is the sung line, tied notes once. compare="intervals" marks a transposed arrangement.

License: MIT (this module). The arrangements are dedicated to the public domain (CC0 1.0).
"""
from __future__ import annotations

RETRIEVED = "2026-10-14"
FSQ = ("Franklin Square Song Collection [No. 1], selected by J. P. McCaskey (New York: Harper & "
       "Brothers, 1881)")
CCNO = ("Christmas Carols New and Old, first series, words ed. H. R. Bramley, music ed. J. Stainer "
        "(London: Novello; undated later printing of the 1871 edition)")

# ---------------------------------------------------------------------------
# References: the published melodies, typed from the sources (MIDI numbers)
# ---------------------------------------------------------------------------
_JOLLY_A = [73, 73, 73, 73, 71, 71, 71, 69, 69, 69, 69, 73, 66, 66, 66, 66, 64, 64, 69, 68, 69, 71, 73, 71]
_JOLLY_B = [73, 73, 73, 73, 71, 71, 71, 69, 69, 69, 69, 73, 66, 66, 66, 66, 64, 64, 69, 71, 69, 71, 73, 69]
_DECK_A = [72, 70, 69, 67, 65, 67, 69, 65, 67, 69, 70, 67, 69, 67, 65, 64, 65]
_DECK_B = [67, 69, 70, 67, 69, 70, 72, 67, 72, 70, 69, 67, 65, 67, 69, 65, 74, 74, 74, 74, 72, 70, 69, 67, 65]
_GKW_A = [69, 69, 69, 71, 69, 69, 64, 66, 64, 66, 68, 69, 69]
_TANNE_C = [62, 67, 67, 67, 69, 71, 71, 71, 71, 69, 71, 72, 66, 69, 67]
_TANNE_V = [74, 74, 71, 76, 74, 74, 72, 72, 72, 72, 69, 74, 72, 72, 71, 71]
_NOWELL_LINE = [69, 71, 73, 74, 73, 71, 69, 71, 73, 74, 69, 67]

REFERENCES: dict[str, dict] = {
    "jolly-old-saint-nicholas": dict(
        url="https://archive.org/details/franklinsquares04mccagoog/page/n84/mode/1up",
        retrieved=RETRIEVED, compare="intervals",
        description=(f"{FSQ}, p. 80, 'Jolly Old Saint Nicholas' (from School Chimes, by permission of "
                     "S. Brainard's Sons): A major, 2/4, the soprano line of verse 1. The same page is "
                     "on Wikimedia Commons as File:Jolly_old.gif."),
        note="Transposed from A major to G major, so compared by intervals. Rhythm as printed.",
        melody=_JOLLY_A + _JOLLY_B,
    ),
    "silent-night": dict(
        url="https://en.wikipedia.org/wiki/Silent_Night", retrieved=RETRIEVED, compare="intervals",
        description=("Score 'Contemporary' in the article's section on the melody: LilyPond written in "
                     "C major inside \\transpose c d, so it sounds in D major; 6/8. The melody is "
                     "recorded as it sounds (D major)."),
        note=("Arranged in C major, so compared by intervals. Rhythm simplified: in bar 10 ('peace') "
              "the quarter note and eighth rest become a dotted quarter, and the last bar is one "
              "dotted half instead of a tied dotted quarter and quarter with an eighth rest."),
        melody=[69, 71, 69, 66, 69, 71, 69, 66, 76, 76, 73, 74, 74, 69, 71, 71, 74, 73, 71, 69, 71, 69, 66,
                71, 71, 74, 73, 71, 69, 71, 69, 66, 76, 76, 79, 76, 73, 74, 78, 74, 69, 66, 69, 67, 64, 62],
    ),
    "joy-to-the-world": dict(
        url="https://en.wikipedia.org/wiki/Joy_to_the_World", retrieved=RETRIEVED, compare="exact",
        description=("Score in the article (its source comment: Lowell Mason, The Modern Psalmist, 1839, "
                     "No. 144), soprano line, D major, 2/4; the score's \\repeat unfold 2 of 'and "
                     "heav'n and nature sing' is unfolded."),
        note="",
        melody=[74, 73, 71, 69, 67, 66, 64, 62, 69, 71, 71, 73, 73, 74,
                74, 74, 73, 71, 69, 69, 67, 66, 74, 74, 73, 71, 69, 69, 67, 66,
                66, 66, 66, 66, 66, 67, 69, 67, 66, 64, 64, 64, 64, 66, 67,
                66, 64, 66, 74, 71, 69, 67, 66, 67, 66, 64, 62],
    ),
    "o-come-all-ye-faithful": dict(
        url="https://en.wikipedia.org/wiki/O_Come,_All_Ye_Faithful", retrieved=RETRIEVED, compare="exact",
        description=("Score in the article (four-part organ setting): the upper voice of the treble "
                     "staff, G major, 4/4 with a quarter-note pickup."),
        note="",
        melody=[67, 67, 62, 67, 69, 62, 71, 69, 71, 72, 71, 69, 67, 67, 66, 64, 66, 67, 69, 71, 66, 64, 62, 62,
                74, 72, 71, 72, 71, 69, 71, 67, 69, 66, 62, 67, 67, 66, 67, 69, 67, 62, 71,
                71, 69, 71, 72, 71, 69, 71, 72, 71, 69, 67, 66, 67, 72, 71, 69, 67, 67],
    ),
    "deck-the-halls": dict(
        url="https://archive.org/details/franklinsquares04mccagoog/page/n124/mode/1up",
        retrieved=RETRIEVED, compare="exact",
        description=(f"{FSQ}, p. 120, 'Deck the Hall with Boughs of Holly', Welsh air: F major, 4/4, "
                     "the soprano line; the second half (from 'Don we now our gay apparel') is printed "
                     "between repeat signs."),
        note="The printed repeat of the second half is written out (bars 9 to 14 are played twice).",
        melody=_DECK_A + _DECK_A + _DECK_B + _DECK_B,
    ),
    "good-king-wenceslas": dict(
        url="https://archive.org/details/christmascarolsn00bramuoft/page/n21/mode/1up",
        retrieved=RETRIEVED, compare="intervals",
        description=(f"{CCNO}, No. 10, p. 20, 'Good King Wenceslas' (the melody of Tempus adest "
                     "floridum, Piae Cantiones 1582): A major, cut time, the soprano line."),
        note="Transposed from A major to G major, so compared by intervals; written in 4/4 instead of cut time.",
        melody=_GKW_A + _GKW_A + [76, 74, 73, 71, 73, 71, 69, 66, 64, 66, 68, 69, 69]
        + [64, 64, 66, 68, 69, 69, 71, 76, 74, 73, 71, 69, 74, 69],
    ),
    "o-christmas-tree": dict(
        url="https://en.wikipedia.org/wiki/O_Tannenbaum", retrieved=RETRIEVED, compare="exact",
        description=("Score in the article's section on the melody (Anschütz 1824): the sung line, "
                     "sopranoC, sopranoV, then sopranoC again as the 'D.C. al fine' asks; G major, 3/4 "
                     "with an eighth-note pickup."),
        note="The da capo is written out; the last bar ends on a half note instead of a quarter and an eighth rest.",
        melody=_TANNE_C + _TANNE_V + _TANNE_C,
    ),
    "the-first-noel": dict(
        url="https://archive.org/details/christmascarolsn00bramuoft/page/n13/mode/1up",
        retrieved=RETRIEVED, compare="exact",
        description=(f"{CCNO}, No. 6, pp. 12 and 13, 'The First Nowell': verse 1 and the chorus, "
                     "D major, 3/4 with a quarter-note pickup, the soprano line."),
        note="The A of the last 'Nowell' (a half note tied to a quarter) is one dotted half.",
        melody=[66, 64, 62, 64, 66, 67, 69, 71, 73, 74, 73, 71] + _NOWELL_LINE
        + [66, 66, 64, 62, 64, 66, 67, 69, 71, 73, 74, 73, 71] + _NOWELL_LINE + [66]
        + [66, 64, 62, 64, 66, 67, 69, 74, 73, 71, 71, 69, 74, 73, 71, 69, 71, 73, 74, 69, 67, 66],
    ),
}

# ---------------------------------------------------------------------------
# The arrangements
# ---------------------------------------------------------------------------
PIECES: dict[str, dict] = {
    # Level 1, G major (the source is in A major). Right hand D4 to B4: one position on D with the
    # B as the one extension; left hand half notes in G position (G2 to D3), three open fifths.
    "jolly-old-saint-nicholas": dict(
        key="G", time="2/4", dynamic="mf",
        rh="""b'8 b' b' b' | a' a' a'4 | g'8 g' g' g' | b'2 |
              e'8 e' e' e' | d' d' g'4 | fis'8( g' a' b' | a'2) |
              b'8 b' b' b' | a' a' a'4 | g'8 g' g' g' | b'2 |
              e'8 e' e' e' | d' d' g'4 | a'8( g' a' b' | g'2) |""",
        lh="""<g, d>2 | d | g, | b, |
              c | g, | d | d4 a, |
              <g, d>2 | d | g, | b, |
              c | g, | d | <g, d> |""",
    ),
    # Level 2, C major (the reference sounds in D major), 6/8. Open fifths on C, G and F; D minor
    # (D and A) under 'sleep in heavenly', where a G-major fifth would clash with the F.
    "silent-night": dict(
        key="C", time="6/8", dynamic="mp",
        rh="""g'8.( a'16 g'8 e'4.) | g'8.( a'16 g'8 e'4.) | d''4 d''8 b'4. | c''4 c''8 g'4. |
              a'4 a'8 c''8.( b'16 a'8) | g'8.( a'16 g'8 e'4.) | a'4 a'8 c''8.( b'16 a'8) | g'8.( a'16 g'8 e'4.) |
              d''4 d''8 f''8.( d''16 b'8) | c''4.( e''4.) | c''8.( g'16 e'8 g'8. f'16 d'8) | c'2. |""",
        lh="""<c g>2. | <c g> | <g, d> | <c g> |
              <f, c> | <c g> | <f, c> | <c g> |
              <d a> | <c g> | <c g>4. <g, d> | <c g>2. |""",
    ),
    # Level 2, D major as in the reference. Left hand in D position (D3 to A3): open fifths on D,
    # single notes A, G and E; E under the G of bar 16, where an A would clash.
    "joy-to-the-world": dict(
        key="D", time="2/4", dynamic="f",
        rh="""d''4 cis''8. b'16 | a'4. g'8 | fis'4 e' | d'4. a'8 |
              b'4. b'8 | cis''4. cis''8 | d''2~ | d''4. d''8 |
              d''8( cis'' b' a') | a'8.( g'16 fis'8) d''8 | d''8( cis'' b' a') | a'8.( g'16 fis'8) fis'8 |
              fis'8 fis' fis' fis'16( g') | a'4. g'16( fis') | e'8 e' e' e'16( fis') | g'4. fis'16( e') |
              fis'8( d''4) b'8 | a'8.( g'16 fis'8) g' | fis'4 e' | d'2 |""",
        lh="""<d a>2 | <d a> | a | d |
              g | a | <d a> | <d a> |
              <d a> | <d a> | <d a> | <d a> |
              d | <d a> | a | e |
              <d a> | <d a> | a | <d a> |""",
    ),
    # Level 2, G major as in the reference, with its quarter-note pickup. Open fifths on G, D and C
    # change at most on beat 3; A alone under the F sharp and E of bar 7.
    "o-come-all-ye-faithful": dict(
        key="G", time="4/4", pickup="1/4", dynamic="mf",
        rh="""g'4 |
              g'2 d'4 g' | a'2 d' | b'4 a' b' c'' | b'2 a'4 g' |
              g'2 fis'4 e' | fis'4( g') a' b' | fis'2( e'4.) d'8 | d'1 |
              d''2 c''4 b' | c''2 b' | a'4 b' g' a' | fis'2 d'4 g' |
              g'4 fis' g' a' | g'2 d'4 b' | b'4 a' b' c'' | b'2 a'4 b' |
              c''4 b' a' g' | fis'2 g'4( c'') | b'2( a'4.) g'8 | g'1 |""",
        lh="""r4 |
              <g, d>1 | <d a> | <g, d> | <g, d>2 <d a> |
              <g, d> <d a> | <d a>1 | a, | <d a> |
              <g, d>2 <c g> | <c g> <g, d> | <d a> <c g> | <d a>1 |
              <g, d> | <g, d> | <g, d> | <g, d>2 <d a> |
              <c g> <d a> | d c | <g, d> <d a> | <g, d>1 |""",
    ),
    # Level 2, F major as in the 1881 source, whose repeated second half is written out. Open
    # fifths on F, C and B flat, G minor (G and D) under 'Don we now', C alone under the F of the
    # cadences.
    "deck-the-halls": dict(
        key="F", time="4/4", dynamic="mf",
        rh="""c''4. bes'8 a'4 g' | f'4 g' a' f' | g'8( a' bes' g' a'4.) g'8 | f'4 e' f'2 |
              c''4. bes'8 a'4 g' | f'4 g' a' f' | g'8( a' bes' g' a'4.) g'8 | f'4 e' f'2 |
              g'4. a'8 bes'4 g' | a'4. bes'8 c''4 g' | c''4. bes'8 a'4 g' | f'4 g' a' f' |
              d''8( d'' d'' d'' c''4.) bes'8 | a'4 g' f'2 |
              g'4. a'8 bes'4 g' | a'4. bes'8 c''4 g' | c''4. bes'8 a'4 g' | f'4 g' a' f' |
              d''8( d'' d'' d'' c''4.) bes'8 | a'4 g' f'2 |""",
        lh="""<f, c>1 | <f, c> | <c g>2 <f, c> | c <f, c> |
              <f, c>1 | <f, c> | <c g>2 <f, c> | c <f, c> |
              <c g> <g, d> | <f, c>1 | <f, c> | <f, c> |
              <bes, f>2 <f, c> | c <f, c> |
              <c g> <g, d> | <f, c>1 | <f, c> | <f, c> |
              <bes, f>2 <f, c> | c <f, c> |""",
    ),
    # Level 2, G major (the source is in A major), 4/4 for the source's cut time. Open fifths on G,
    # C, A and E; single notes G and C under the rising line of bar 13.
    "good-king-wenceslas": dict(
        key="G", time="4/4", dynamic="f",
        rh="""g'4 g' g' a' | g' g' d'2 | e'4 d' e' fis' | g'2 g' |
              g'4 g' g' a' | g' g' d'2 | e'4 d' e' fis' | g'2 g' |
              d''4 c'' b' a' | b' a' g'2 | e'4 d' e' fis' | g'2 g' |
              d'4 d' e' fis' | g' g' a'2 | d''4 c'' b' a' | g'2( c'') | g'1 |""",
        lh="""<g, d>1 | <g, d> | <c g>2 <a, e> | <g, d>1 |
              <g, d> | <g, d> | <c g>2 <a, e> | <g, d>1 |
              <g, d> | <e b> | <c g>2 <a, e> | <g, d>1 |
              g,2 c | <g, d> <d a> | <g, d>1 | <g, d>2 <c g> | <g, d>1 |""",
    ),
    # Level 2, G major as in the reference, 3/4 with its eighth-note pickup; the da capo is written
    # out. A minor (A and E) under the C of bar 7, where a D-major fifth would clash.
    "o-christmas-tree": dict(
        key="G", time="3/4", pickup="1/8", dynamic="mf",
        rh="""d'8 |
              g'8. g'16 g'4 a' | b'8. b'16 b'4. b'8 | a'8 b' c''4 fis' | a'4 g' r8 d''8 |
              d''8 b' e''4. d''8 | d''8 c'' c''4. c''8 | c''8 a' d''4. c''8 | c''8 b' b'4 r8 d'8 |
              g'8. g'16 g'4 a' | b'8. b'16 b'4. b'8 | a'8 b' c''4 fis' | a'4 g'2 |""",
        lh="""r8 |
              <g, d>2. | <g, d> | <a, e>2 d4 | d <g, d>2 |
              <g, d>4 <c g>2 | <d a>2. | <a, e> | <c g>4 <g, d>2 |
              <g, d>2. | <g, d> | <a, e>2 d4 | d <g, d>2 |""",
    ),
    # Level 2, D major as in the source, 3/4 with its quarter-note pickup: verse 1 and the chorus.
    # Open fifths on D, G, B and A.
    "the-first-noel": dict(
        key="D", time="3/4", pickup="1/4", dynamic="mf",
        rh="""fis'8( e' |
              d'4.) e'8( fis' g') | a'2 b'8( cis'') | d''4 cis'' b' | a'2 b'8( cis'') |
              d''4 cis'' b' | a'4 b' cis'' | d''4 a' g' | fis'2 fis'8( e' |
              d'4.) e'8( fis' g') | a'2 b'8( cis'') | d''4 cis'' b' | a'2 b'8( cis'') |
              d''4 cis'' b' | a'4 b' cis'' | d''4 a' g' | fis'2 fis'8( e' |
              d'4.) e'8( fis' g') | a'2 d''8( cis'') | b'2 b'4 | a'2. |
              d''4 cis'' b' | a'4 b' cis'' | d''4 a' g' | fis'2. |""",
        lh="""r4 |
              <d a>2. | <d a> | <g, d> | <d a> |
              <b, fis> | <d a> | <g, d> | <d a> |
              <d a> | <d a> | <g, d> | <d a> |
              <b, fis> | <d a> | <g, d> | <d a> |
              <d a> | <d a> | <g, d> | <a, e> |
              <b, fis> | <d a> | <g, d>2 <a, e>4 | <d a>2. |""",
    ),
}
