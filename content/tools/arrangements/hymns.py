"""Hymns, spirituals and national anthems: own arrangements for the built-in library (L1 plan, Task 10).

Collections `hymns` and `anthems`. Each piece is written in arrange.py's note language (absolute
LilyPond pitches) and has a reference: the published melody it reproduces note for note
(tests/test_arrangements.py). The catalog entries are in tools/catalog.d/hymns.json.

Sources, in the plan's order of preference: the score in a Wikipedia article of the tune (the English
article; the German one for When the Saints, whose English article has no notation; the English
article of Bach's cantata BWV 80 for Ein feste Burg), then a hymnary.org tune page (God Save the
King), then a dated public-domain edition on Mutopia (the 1792 first edition of La Marseillaise).
The retrieved texts are kept under content/_raw/references/ (gitignored). Simple Gifts and Swing
Low, Sweet Chariot are replaced by the spares Austrian Hymn and A Mighty Fortress: no notated text
source could be read for them (see `rejected` in the fragment).

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

The melodies are traditional or long in the public domain (every author died in 1955 or earlier and
every melody was published in 1928 or earlier); the arrangements are original work of the digitus2
project, dedicated to the public domain under CC0 1.0. License of this file: MIT.
"""
from __future__ import annotations

RETRIEVED = "2026-10-14"

PIECES: dict[str, dict] = {
    # The reference's 2/4 in eighths, written in 4/4 with every value doubled: the right hand reads
    # quarters and halves in C position (C4 to G4); the left hand stays on C to G, with F under the
    # IV chord of bar 12.
    "when-the-saints-go-marching-in": dict(
        key="C", time="4/4", dynamic="mf",
        rh="""r4 c'( e' f' | g'1) | r4 c'( e' f' | g'1) |
              r4 c'( e' f' | g'2 e' | c' e' | d'1) |
              r4 e'( e' d' | c'1) | e'2( g' | g'4 f'2.) |
              r2 e'4( f' | g'2 e' | c' d' | c'1) |""",
        lh="""c1 | <c g> | c | <c g> |
              c | c2 g | e c | g1 |
              c2 g | c1 | <c g> | c2 f |
              c1 | <c g> | c2 g | <c g>1 |""",
    ),
    # One verse, right hand C4 to A4 (the A a small stretch, as in Twinkle); left hand I, IV, V roots.
    "michael-row-the-boat-ashore": dict(
        key="C", time="4/4", pickup="1/2", dynamic="mp",
        rh="""c'4( e' |
              g'4. e'8 g'4 a' | g'2) e'4( g' | a'1) | g'2 e'4( g' |
              g'4. e'8 f'4 e' | d'2) c'4( d' | e'2 d' | c'1) |""",
        lh="""r2 |
              c1 | c2 g | f1 | c |
              c | g | c2 g | <c g>1 |""",
    ),
    # The Genevan rhythm barred in 4/4: every line starts on a downbeat with its long first note.
    # One triad per half bar (G, C/G, D/F#, Em/G, Am), kept around G2 to E3.
    "old-hundredth": dict(
        key="G", time="4/4", dynamic="mf",
        rh="""g'2( g'4 fis' | e' d' g'2 | a' b') |
              b'2( b'4 b' | a' g' c''2 | b' a') |
              g'2( a'4 b' | a' g' e'2 | fis' g') |
              d''2( b' | g' a'4 c'' | b'2 a' | g'1) |""",
        lh="""<g, b, d>1 | <g, c e>2 <g, b, d> | <fis, a, d> <g, b, d> |
              <g, b, d> <g, b, e> | <a, c e> <g, c e> | <g, b, d> <fis, a, d> |
              <g, b, d> <fis, a, d> | <a, c e> <g, b, e> | <fis, a, d> <g, b, d> |
              <g, b, d> <g, b, e> | <g, c e> <fis, a, d> | <g, b, d> <fis, a, d> | <g, b, d>1 |""",
    ),
    # The New English Hymnal setting with its 4/2 values halved; the left hand reduces the lower
    # three voices to one triad per half bar (D, Bm, A, G, E, C#-A).
    "holy-holy-holy": dict(
        key="D", time="4/4", dynamic="mf",
        rh="""d'4( d' fis' fis' | a'2 a') | b'2( b'4 b' | a'2 fis') |
              a'4.( a'8 a'4 a' | d''2 cis''4 a' | e' a' b'4. a'8 | a'1) |
              d'4( d' fis' fis' | a'2 a') | b'4.( b'8 b'4 b' | a'2 a') |
              d''2( a'4 a' | b'2 fis') | g'4( e' e'4. d'8 | d'1) |""",
        lh="""<d fis a>2 <b, d fis> | <a, cis e> <d fis a> | <g, b, d>1 | <d fis a> |
              <a, cis e>2 <d fis a> | <b, d fis> <cis e a>4 <d fis a> | <a, cis e>2 <e gis b> | <a, cis e>1 |
              <d fis a>2 <b, d fis> | <a, cis e> <d fis a> | <g, b, d>1 | <d fis a> |
              <b, d fis>2 <fis, a, d> | <g, b, d> <d fis a> | <g, b, d> <a, cis e> | <d fis a>1 |""",
    ),
    # Bach's even rhythm of Luther's chorale (BWV 80), the first two lines written out twice.
    "a-mighty-fortress": dict(
        key="D", time="4/4", pickup="1/4", dynamic="f",
        rh="""d''4 |
              d''4( d'' a'8 b' cis''4 | d''8 cis'' b'4 a') d'' |
              cis''4( b' a' b'8 a' | g' fis' e'4 d') d'' |
              d''4( d'' a'8 b' cis''4 | d''8 cis'' b'4 a') d'' |
              cis''4( b' a' b'8 a' | g' fis' e'4 d') d' |
              a'4( b' a' gis' | a'2) d'4( a' | b' cis'' d'') cis'' |
              d''4( cis'' b'2) | a'4( b' b' a' | b'8 a' g'4 fis') d'' |
              cis''4( b' a' b'8 a' | g' fis' e'4 d'2) |""",
        lh="""r4 |
              <d fis a>2 <a, cis e> | <b, d fis> <d fis a> |
              <a, cis e> <fis, a, d> | <g, b, d>4 <a, cis e> <d fis a>2 |
              <d fis a> <a, cis e> | <b, d fis> <d fis a> |
              <a, cis e> <fis, a, d> | <g, b, d>4 <a, cis e> <d fis a>2 |
              <a, cis e>2. <e gis b>4 | <a, cis e>2 <d fis a> | <e g b>4 <a, cis e> <d fis a> <a, cis e> |
              <d fis a>2 <b, d fis> | <d fis a> <g, b, d> | <g, b, d> <d fis a> |
              <a, cis e> <fis, a, d> | <g, b, d>4 <a, cis e> <d fis a>2 |""",
    ),
    # The 1792 melody with the sixteenth-note pickups straightened; half-bar triads in C, C minor
    # for "Entendez-vous", single G and D bass notes where the melody spells the dominant seventh.
    "la-marseillaise": dict(
        key="C", time="4/4", pickup="1/2", dynamic="f",
        rh="""r8 g'8 e'8. g'16 |
              c''4 c'' d'' d'' | g''4.( f''8 e'') c'' e''8. c''16 | a'4 f''2 d''8. b'16 | c''2 r4 c''8. d''16 |
              e''4 e'' e'' f''8. e''16 | e''4 d''8 r r4 d''8. e''16 | f''4 f'' f'' g''8. f''16 | e''2 r4 g''8. g''16 |
              g''4( e''8.) c''16 g''4 e''8. c''16 | g'2 r8 g' g'8. g'16 | b'4. d''8 f''4. d''8 | d''8 c'' c''4 r aes' |
              g'4 c''8. c''16 c''4 b'8. c''16 | d''2 r4 d'' | ees''4. ees''8 ees'' ees'' f'' g'' | d''2 r4 ees''8 d'' |
              c''4 c'' ees'' d''8. c''16 | c''4 b'8 r r4 r8 g'' | g''2~ g''8 e'' c''8. c''16 | d''2 r4 r8 g'' |
              g''2~ g''8 e'' c''8. c''16 | d''2 r4 g' | c''2 r4 c'' | e''2 r |
              f''2 g''4 a'' | b'2 r4 r8 a'' | g''2~ g''8 e'' f'' d'' | c''1 |""",
        lh="""r2 |
              <c e g>2 <g, b, d> | <c e g>1 | <c f a>2. <g, b, d>4 | <c e g>2 <g, b, d> |
              <c e g>1 | <c e g>2 <g, b, d> | <d f a>1 | <c e g> |
              <c e g> | <g, b, d> | g,2 d | <f a> <c e> |
              <c e g>1 | <g, b, d> | <c ees g> | <g, b, d> |
              <c ees g> | g,2 <g, b, d> | <c e g>1 | <g, b, d> |
              <c e g> | <g, b, d> | <c e g> | <c e g> |
              <c f a>2 <c e g> | <g, b, d>1 | <c e g>2 <g, b, d> | <c e g>1 |""",
    ),
    # In F, one triad per bar (F, C, Gm, Bb), two or three in the cadences.
    "god-save-the-king": dict(
        key="F", time="3/4", dynamic="mf",
        rh="""f'4( f' g' | e'4. f'8 g'4 | a'4 a' bes' | a'4. g'8 f'4 | g'4 f' e' | f'2.) |
              c''4( c'' c'' | c''4. bes'8 a'4 | bes'4 bes' bes' | bes'4. a'8 g'4 |
              a'4 bes'8 a' g' f' | a'4. bes'8 c''4 | d''8 bes' a'4 g' | f'2.) |""",
        lh="""<f a c'>2. | <c e g> | <f a c'>2 <f bes d'>4 | <f a c'>2. | <c e g> | <f a c'> |
              <f a c'> | <f a c'> | <d g bes> | <d g bes>2 <c e g>4 |
              <f a c'>2. | <f a c'> | <f bes d'>4 <f a c'> <c e g> | <f a c'>2. |""",
    ),
    # Haydn's hymn with both repeats written out; triads on G, C/G, D/F#, Am and A (for the C#).
    "austrian-hymn": dict(
        key="G", time="4/4", pickup="1/2", dynamic="mp",
        rh="""g'4.( a'8 |
              b'4 a' c'' b' | a'8 fis' g'4 e'' d'' | c''4 b' a' b'8 g' | d''2) g'4.( a'8 |
              b'4 a' c'' b' | a'8 fis' g'4 e'' d'' | c''4 b' a' b'8 g' | d''2) a'4( b' |
              a'8 fis' d'4) c''( b' | a'8 fis' d'4) d''( c'' | b'4. b'8 cis''4 cis''8 d'' | d''2) g''4.( fis''8 |
              fis''8 e'' d''4 e''4. d''8 | d''8 c'' b'4 a'4. b'16 c'' | d''8 e'' c'' a' g'4 a'8 g' | g'2) g''4.( fis''8 |
              fis''8 e'' d''4 e''4. d''8 | d''8 c'' b'4 a'4. b'16 c'' | d''8 e'' c'' a' g'4 a'8 g' | g'1) |""",
        lh="""r2 |
              <g, b, d>2 <g, c e> | <fis, a, d> <g, c e> | <g, c e> <fis, a, d> | <g, b, d>1 |
              <g, b, d>2 <g, c e> | <fis, a, d> <g, c e> | <g, c e> <fis, a, d> | <g, b, d> <fis, a, d> |
              <fis, a, d> <a, c e> | <fis, a, d>1 | <g, b, d>2 <a, cis e> | <fis, a, d> <g, b, d> |
              <fis, a, d> <g, c e> | <g, b, d> <fis, a, d> | <g, b, d>4 <a, c e> <g, b, d> <fis, a, d> | <g, b, d>1 |
              <fis, a, d>2 <g, c e> | <g, b, d> <fis, a, d> | <g, b, d>4 <a, c e> <g, b, d> <fis, a, d> | <g, b, d>1 |""",
    ),
}

REFERENCES: dict[str, dict] = {
    "when-the-saints-go-marching-in": dict(
        url="https://de.wikipedia.org/wiki/When_the_Saints_Go_Marching_In", retrieved=RETRIEVED, compare="exact",
        description="ABC score in the German article (section Melodie), C major, 2/4 in eighths; the English "
                    "article has no notation",
        note="Written in 4/4 with every value doubled; the rests that open bars 1, 3, 5, 9 and 13 are kept.",
        melody=[60, 64, 65, 67, 60, 64, 65, 67, 60, 64, 65, 67, 64, 60, 64, 62,
                64, 64, 62, 60, 64, 67, 67, 65, 64, 65, 67, 64, 60, 62, 60],
    ),
    "michael-row-the-boat-ashore": dict(
        url="https://en.wikipedia.org/wiki/Michael,_Row_the_Boat_Ashore", retrieved=RETRIEVED, compare="exact",
        description="Score in the article (after the Belafonte verses), C major, 4/4 with a half-bar pickup",
        note="The last note is a whole note, to fill the final bar.",
        melody=[60, 64, 67, 64, 67, 69, 67, 64, 67, 69, 67, 64, 67, 67, 64, 65, 64, 62, 60, 62, 64, 62, 60],
    ),
    "old-hundredth": dict(
        url="https://en.wikipedia.org/wiki/Old_100th", retrieved=RETRIEVED, compare="exact",
        description="First score in the article: the Genevan Psalter rhythm (Psalm 134), G major, unbarred 2/2",
        note="Barred in 4/4 (the reference has no bar lines inside its lines); every value kept.",
        melody=[67, 67, 66, 64, 62, 67, 69, 71, 71, 71, 71, 69, 67, 72, 71, 69,
                67, 69, 71, 69, 67, 64, 66, 67, 74, 71, 67, 69, 72, 71, 69, 67],
    ),
    "holy-holy-holy": dict(
        url="https://en.wikipedia.org/wiki/Holy,_Holy,_Holy!_Lord_God_Almighty", retrieved=RETRIEVED,
        compare="exact",
        description="Score in the article, the setting of The New English Hymnal: the soprano, D major, 4/2",
        note="Every value halved, in 4/4: halves as quarters, wholes as halves, breves as whole notes.",
        melody=[62, 62, 66, 66, 69, 69, 71, 71, 71, 69, 66, 69, 69, 69, 69, 74, 73, 69, 64, 69, 71, 69, 69,
                62, 62, 66, 66, 69, 69, 71, 71, 71, 71, 69, 69, 74, 69, 69, 71, 66, 67, 64, 64, 62, 62],
    ),
    "la-marseillaise": dict(
        url="https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1891", retrieved=RETRIEVED, compare="exact",
        description="Mutopia 1891, 'Chant de guerre pour l'Armée du Rhin' after the first edition (Bignon, "
                    "1792), public domain, typeset by Coyau: the voice part, C major, 2/2",
        note="Rhythm simplified: a sixteenth after an eighth and a sixteenth rest (the pickups of bars 1, 11, "
             "19, 21 and 27) is written as an eighth after an eighth rest, 'e8 r16 c16' in bar 2 as two "
             "eighths and 'c8 r8' in bar 12 as a quarter; the appoggiatura F before the E of bar 8 is left out; "
             "the last note is a whole note and the six-bar ritornello is left out.",
        melody=[67, 64, 67, 72, 72, 74, 74, 79, 77, 76, 72, 76, 72, 69, 77, 74, 71, 72, 72, 74,
                76, 76, 76, 77, 76, 76, 74, 74, 76, 77, 77, 77, 79, 77, 76, 79, 79, 79, 76, 72,
                79, 76, 72, 67, 67, 67, 67, 71, 74, 77, 74, 74, 72, 72, 68, 67, 72, 72, 72, 71,
                72, 74, 74, 75, 75, 75, 75, 77, 79, 74, 75, 74, 72, 72, 75, 74, 72, 72, 71, 79,
                79, 76, 72, 72, 74, 79, 79, 76, 72, 72, 74, 67, 72, 72, 76, 77, 79, 81, 71, 81,
                79, 76, 77, 74, 72],
    ),
    "god-save-the-king": dict(
        url="https://hymnary.org/tune/america_carey", retrieved=RETRIEVED, compare="exact",
        description="Tune AMERICA (Thesaurus Musicus, 1744) on hymnary.org: the soprano of The Cyber Hymnal's "
                    "score #49 linked there (public domain), F major, 3/4; the Wikipedia articles have no notation",
        note="",
        melody=[65, 65, 67, 64, 65, 67, 69, 69, 70, 69, 67, 65, 67, 65, 64, 65,
                72, 72, 72, 72, 70, 69, 70, 70, 70, 70, 69, 67, 69, 70, 69, 67, 65, 69, 70, 72, 74, 70, 69, 67, 65],
    ),
    "austrian-hymn": dict(
        url="https://en.wikipedia.org/wiki/Gott_erhalte_Franz_den_Kaiser", retrieved=RETRIEVED, compare="exact",
        description="Score in the article (section Lyrics and music), G major, 4/4 with a half-bar pickup",
        note="Both repeats written out; the appoggiatura B before the last A of the refrain (bars 15 and 19) "
             "is left out; the last note is a whole note.",
        melody=[67, 69, 71, 69, 72, 71, 69, 66, 67, 76, 74, 72, 71, 69, 71, 67, 74,
                67, 69, 71, 69, 72, 71, 69, 66, 67, 76, 74, 72, 71, 69, 71, 67, 74,
                69, 71, 69, 66, 62, 72, 71, 69, 66, 62, 74, 72, 71, 71, 73, 73, 74, 74,
                79, 78, 78, 76, 74, 76, 74, 74, 72, 71, 69, 71, 72, 74, 76, 72, 69, 67, 69, 67, 67,
                79, 78, 78, 76, 74, 76, 74, 74, 72, 71, 69, 71, 72, 74, 76, 72, 69, 67, 69, 67, 67],
    ),
    "a-mighty-fortress": dict(
        url="https://en.wikipedia.org/wiki/Ein_feste_Burg_ist_unser_Gott,_BWV_80", retrieved=RETRIEVED,
        compare="exact",
        description="Score of the closing chorale in the article on Bach's cantata BWV 80: the soprano, "
                    "Luther's melody as Bach set it, D major, 4/4 with a one-beat pickup",
        note="The repeat of the first two lines is written out; Bach's fermatas are left out; the last note "
             "is a half note, to fill the final bar.",
        melody=[74, 74, 74, 69, 71, 73, 74, 73, 71, 69, 74, 73, 71, 69, 71, 69, 67, 66, 64, 62,
                74, 74, 74, 69, 71, 73, 74, 73, 71, 69, 74, 73, 71, 69, 71, 69, 67, 66, 64, 62,
                62, 69, 71, 69, 68, 69, 62, 69, 71, 73, 74, 73, 74, 73, 71, 69, 71, 71, 69,
                71, 69, 67, 66, 74, 73, 71, 69, 71, 69, 67, 66, 64, 62],
    ),
}
