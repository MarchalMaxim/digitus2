"""Children's songs: own arrangements for the built-in library (L1 plan, Task 8).

Collection `children-songs`. Each piece is written in arrange.py's note language (absolute LilyPond
pitches) and has a reference: the published melody it reproduces note for note
(tests/test_arrangements.py). The catalog entries are in tools/catalog.d/children.json.

Sources, in the plan's order of preference: the score in the English or German Wikipedia article of
the tune (as the first ten arrangements used), otherwise a dated public-domain printing whose
Project Gutenberg edition carries a MusicXML transcription of every song. The retrieved texts and
files are kept under content/_raw/references/ (gitignored).

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

The melodies are traditional, except Schlaf, Kindlein, schlaf (Johann Friedrich Reichardt, 1781, after a
folk tune; he died in 1814); the arrangements are original work of the digitus2 project,
dedicated to the public domain under CC0 1.0. License of this file: MIT.
"""
from __future__ import annotations

RETRIEVED = "2026-10-14"
WIKI_EN = "https://en.wikipedia.org/wiki/"
WIKI_DE = "https://de.wikipedia.org/wiki/"
WIKI_FR = "https://fr.wikipedia.org/wiki/"
PG_61009 = "https://www.gutenberg.org/cache/epub/61009/music/"  # Our Old Nursery Rhymes (Augener, 1911)
PG_25432 = "https://www.gutenberg.org/cache/epub/25432/music/"  # The Baby's Bouquet (Walter and Lucy Crane, 1878)
PG_25418 = "https://www.gutenberg.org/cache/epub/25418/music/"  # The Baby's Opera (Walter Crane, 1877)

PIECES: dict[str, dict] = {
    # The street-cry tune that method books teach first: mi re do, in C position.
    "hot-cross-buns": dict(
        key="C", time="4/4", dynamic="mf",
        rh="""e'4( d' c'2) | e'4( d' c'2) | c'8 c' c' c' d' d' d' d' | e'4( d' c'2) |""",
        lh="""c1 | e | c2 g | c1 |""",
    ),
    "alle-meine-entchen": dict(
        key="C", time="4/4", dynamic="mf",
        rh="""c'8 d' e' f' g'4 g' | a'8 a' a' a' g'2 | a'8 a' a' a' g'2 |
              f'8 f' f' f' e'4 e' | d'8 d' d' d' c'2 |""",
        lh="""c1 | f2 c | f c | f c | g c |""",
    ),
    # Hänschen klein, in C as "Lightly Row" in English method books; the first strain's repeat is
    # written out with its second ending.
    "lightly-row": dict(
        key="C", time="2/4", dynamic="mf",
        rh="""g'8 e' e'4 | f'8 d' d'4 | c'8 d' e' f' | g' g' g'4 |
              g'8 e' e'4 | f'8 d' d'4 | c'8 e' g' g' | c'4 r |
              d'8 d' d' d' | d' e' f'4 | e'8 e' e' e' | e' f' g'4 |
              g'8 e' e'4 | f'8 d' d'4 | c'8 e' g' g' | c'2 |""",
        lh="""c2 | d | c | g |
              c | d | e | c |
              g | g | c | c |
              c | d | e | c |""",
    ),
    # The quarter-note rhythm of the French article's score (2/2 there), written in 4/4. The right
    # hand never moves: A position (A3 to E4) with G3, the low note of the middle phrase, as its one
    # extension. The left hand sits below it on G2, C3 and D3.
    "au-clair-de-la-lune": dict(
        key="C", time="4/4", dynamic="mp",
        rh="""c'4( c' c' d' | e'2 d') | c'4( e' d' d' | c'1) |
              c'4( c' c' d' | e'2 d') | c'4( e' d' d' | c'1) |
              d'4( d' d' d' | a2 a) | d'4( c' b a | g1) |
              c'4( c' c' d' | e'2 d') | c'4( e' d' d' | c'1) |""",
        lh="""c1 | c2 g, | c g, | c1 |
              c1 | c2 g, | c g, | c1 |
              g,1 | d | g, | g, |
              c1 | c2 g, | c g, | c1 |""",
    ),
    "london-bridge": dict(
        key="C", time="2/4", dynamic="mf",
        rh="""g'8.( a'16 g'8 f' | e' f' g'4) | d'8( e' f'4) | e'8( f' g'4) |
              g'8.( a'16 g'8 f' | e' f' g'4) | d'4( g' | e'8 c'4.) |""",
        lh="""c2 | c | g | c |
              c | c | g | c |""",
    ),
    # One verse; the "here a moo, there a moo" bars get open fifths.
    "old-macdonald-had-a-farm": dict(
        key="G", time="4/4", dynamic="f",
        rh="""g'4 g' g' d' | e' e' d'2 | b'4 b' a' a' | g'2. d'4 |
              g' g' g' d' | e' e' d'2 | b'4 b' a' a' | g'2. d'8 d' |
              g'4 g' g' d'8 d' | g'4 g' g'2 | g'8 g' g'4 g'8 g' g'4 | g'8 g' g' g' g'4 g' |
              g' g' g' d' | e' e' d'2 | b'4 b' a' a' | g'1 |""",
        lh="""g,1 | c2 g, | g, d | g,1 |
              g, | c2 g, | g, d | g,1 |
              g, | <g, d> | <g, d> | <g, d> |
              g, | c2 g, | g, d | <g, d>1 |""",
    ),
    # The melody (upper voice) of the German article's two-part setting.
    "kuckuck": dict(
        key="G", time="3/4", dynamic="mf",
        rh="""d''4 b' r | d'' b' r | a'( g' a' | g'2.) |
              a'4 a' b' | c''2 a'4 | b' b' c'' | d''2 b'4 |
              d''2 b'4 | d''2 b'4 | c''4( b' a' | g'2.) |""",
        lh="""g,2. | g, | d | g, |
              d | a, | g, | g, |
              b, | g, | c2 d4 | g,2. |""",
    ),
    "little-jack-horner": dict(
        key="F", time="6/8", dynamic="mf",
        rh="""bes'8 a' bes' g'4 g'8 | a' g' a' f'4 f'8 | bes' a' bes' g'4 g'8 | c''4.~ c''4 a'8 |
              bes' a' bes' g'4 g'8 | a' g' a' f'4 f'8 | g' bes' a' g' f' e' | f'4.~ f'4 r8 |""",
        lh="""g2. | f | g | c |
              g | f | c | f |""",
    ),
    "see-saw-margery-daw": dict(
        key="F", time="6/8", dynamic="mf",
        rh="""f'4. c'' | a'8 g' a' f'4. | f'4 f'8 c''4 c''8 | a' g' a' f'4. |
              a'4 f'8 c''4 c''8 | a'4 f'8 g'4 c''8 | c''4 a'8 d''4 bes'8 | a' bes' g' f'4. |""",
        lh="""f2. | f | f | c4. f |
              f2. | f4. c | f g | c f |""",
    ),
    # Reichardt's melody (1781) as the German article prints it, a fourth lower (C major instead of
    # F major); it stays in C position, C4 to G4. The left hand stays on C3, F3 and G3: F3 rather
    # than G3 under the F4s of bars 5, 7 and 9, so no seventh sounds on a downbeat.
    "schlaf-kindlein-schlaf": dict(
        key="C", time="2/4", dynamic="p",
        rh="""e'4 d'8 d' | c'4 r8 c'16 e' | g'8 g' f' f' | e'4 r8 e' |
              f' f' d' d' | g' g' e' e' | f' f' d' d' | g' g' e'4 |
              f'4 d'8 d' | c'4 r |""",
        lh="""c2 | c | g | c |
              f | c | f | c |
              f4 g | c2 |""",
    ),
    # Moffat's tune (1911) in its own key, F major: the right hand never leaves F position (F4 to C5).
    # Bar 4's thirds in the source (F4-A4, E4-G4) are played as their top notes. The left hand plays
    # single F3, C3 and G3 notes: G3 rather than C3 under the B-flat 4 of bar 6, so no seventh sounds
    # on a downbeat.
    "little-bo-peep": dict(
        key="F", time="6/8", dynamic="mf",
        rh="""f'8 f' f' f'4 f'8 | g'4 g'8 g'4 g'8 | a'8 bes' c'' c'' bes' a' | a'4. g'4 r8 |
              c''8 a' a' a'4 a'8 | bes'8 g' g' g'4 g'8 | a'8 bes' a' g' f' g' | f'4. f'4 r8 |""",
        lh="""f2. | c | f | c |
              f | g | f4. c | f2. |""",
    ),
    # Lucy Crane's tune (1878) a fourth lower than the source (F major instead of B-flat major): C
    # position with the A as the one extension, C4 to A4, as in Twinkle. The sixteenth-note pickup
    # and the sixteenths of bar 1 are kept; the last note is held for the whole bar (the source's
    # half note and eighth rest complete its pickup). The left hand plays single F3 and C3 notes.
    "three-little-kittens": dict(
        key="F", time="6/8", pickup="1/8", dynamic="mf",
        rh="""c'16 c' |
              f'4 f'16 f' c'8 c' c' | a'4 a'8 f' f' f' | g'4 g'8 e'4 e'8 | f'2. |
              f'4. c' | a'4. f' | g'4. e' | f'2. |""",
        lh="""r8 |
              f2. | f | c | f |
              f4. c | f2. | c | f |""",
    ),
    # Level 2: the melody spans an octave (D4 to D5). The printed claps on beat 4 are rests here.
    "pease-porridge-hot": dict(
        key="G", time="4/4", dynamic="mf",
        rh="""d'4 g'8 a' b'4 r | d'4 g'8 a' b'4 r | c''4 b'8 a' d'' b' g'4 | a'4 a'8 b' a'4. r8 |
              d'4 g'8 a' b'4 r | d'4 g'8 a' b'4 r | c''4 b'8 a' d'' b' g'4 | a'4 a'8 b' g'2 |""",
        lh="""<g, d>2 <g, d>4 r | <g, d>2 <g, d>4 r | <c e>2 d4 g, | <d a>2 <d a>4. r8 |
              <g, d>2 <g, d>4 r | <g, d>2 <g, d>4 r | <c e>2 d4 g, | <d a>2 <g, d> |""",
    ),
}

REFERENCES: dict[str, dict] = {
    "hot-cross-buns": dict(
        url=WIKI_EN + "Hot_Cross_Buns_(song)", retrieved=RETRIEVED, compare="intervals",
        description="Score in the article, the version marked 'Alternative' (B A G, in G); compared by "
                    "intervals because the arrangement is in C",
        note="The article's first tune (G D G, range D4 to D5) is the older street cry; the "
             "arrangement uses the 'Alternative' tune that method books teach. The article dates the "
             "cry to 1733 (Poor Robin's Almanack) and the words to 1767 (a round in the London "
             "Chronicle) but gives no first printing of the B A G tune, so firstPublished is null.",
        melody=[71, 69, 67, 71, 69, 67, 67, 67, 67, 67, 69, 69, 69, 69, 71, 69, 67],
    ),
    "alle-meine-entchen": dict(
        url=WIKI_DE + "Alle_meine_Entchen", retrieved=RETRIEVED, compare="exact",
        description="Score in the German article, C major, the one verse as notated",
        note="",
        melody=[60, 62, 64, 65, 67, 67, 69, 69, 69, 69, 67, 69, 69, 69, 69, 67,
                65, 65, 65, 65, 64, 64, 62, 62, 62, 62, 60],
    ),
    "lightly-row": dict(
        url=WIKI_DE + "H%C3%A4nschen_klein", retrieved=RETRIEVED, compare="intervals",
        description="Score of 'Hänschen klein' in the German article, F major, melody with the first "
                    "strain's repeat unfolded (first and second ending); compared by intervals because "
                    "the arrangement is in C",
        note="The repeat of bars 1 to 2 is written out with both endings, as the article's MIDI plays it.",
        melody=[72, 69, 69, 70, 67, 67, 65, 67, 69, 70, 72, 72, 72,
                72, 69, 69, 70, 67, 67, 65, 69, 72, 72, 65,
                67, 67, 67, 67, 67, 69, 70, 69, 69, 69, 69, 69, 70, 72,
                72, 69, 69, 70, 67, 67, 65, 69, 72, 72, 65],
    ),
    "au-clair-de-la-lune": dict(
        url=WIKI_EN + "Au_clair_de_la_lune", retrieved=RETRIEVED, compare="exact",
        description="The article's score image 'Ly au clair de la lune accords melodie paroles.png' "
                    "(C major, 4/4, middle C), first verse; the score in the French article "
                    "(fr.wikipedia.org/wiki/Au_clair_de_la_lune) has the same pitches an octave higher",
        note="Rhythm from the French article's score (quarter and half notes in 2/2, written here in "
             "4/4); the English article's image has the same notes in eighths and quarters.",
        melody=[60, 60, 60, 62, 64, 62, 60, 64, 62, 62, 60,
                60, 60, 60, 62, 64, 62, 60, 64, 62, 62, 60,
                62, 62, 62, 62, 57, 57, 62, 60, 59, 57, 55,
                60, 60, 60, 62, 64, 62, 60, 64, 62, 62, 60],
    ),
    "london-bridge": dict(
        url=WIKI_EN + "London_Bridge_Is_Falling_Down", retrieved=RETRIEVED, compare="intervals",
        description="Score in the article, F major, 2/4, the repeat unfolded with both endings; compared "
                    "by intervals because the arrangement is in C",
        note="",
        melody=[72, 74, 72, 70, 69, 70, 72, 67, 69, 70, 69, 70, 72,
                72, 74, 72, 70, 69, 70, 72, 67, 72, 69, 65],
    ),
    "old-macdonald-had-a-farm": dict(
        url=WIKI_FR + "Old_MacDonald_Had_a_Farm", retrieved=RETRIEVED, compare="exact",
        description="Score in the French article (the same score is in the Spanish, Swedish, Japanese and "
                    "Chinese articles; the English article has none), G major, one verse",
        note="The standard tune. The English article dates the song's variants to the 1880s to 1917 "
             "(Tommy's Tunes, 1917, prints the 'Ohio' variant) and names the Sam Patterson Trio's 1925 "
             "Edison recording as possibly the first known use of the now standard tune; its first "
             "printing is undocumented, so firstPublished is null.",
        melody=[67, 67, 67, 62, 64, 64, 62, 71, 71, 69, 69, 67, 62,
                67, 67, 67, 62, 64, 64, 62, 71, 71, 69, 69, 67, 62, 62,
                67, 67, 67, 62, 62, 67, 67, 67, 67, 67, 67, 67, 67, 67, 67, 67, 67, 67, 67, 67,
                67, 67, 67, 62, 64, 64, 62, 71, 71, 69, 69, 67],
    ),
    "kuckuck": dict(
        url=WIKI_DE + "Kuckuck,_Kuckuck,_ruft%E2%80%99s_aus_dem_Wald", retrieved=RETRIEVED, compare="exact",
        description="Score in the German article, G major, 3/4, upper voice of the two-part setting",
        note="",
        melody=[74, 71, 74, 71, 69, 67, 69, 67, 69, 69, 71, 72, 69, 71, 71, 72,
                74, 71, 74, 71, 74, 71, 72, 71, 69, 67],
    ),
    "little-jack-horner": dict(
        url=WIKI_EN + "Little_Jack_Horner", retrieved=RETRIEVED, compare="intervals",
        description="The article's score image 'The original melody, 1877' (File:The Baby's Opera A book "
                    "of old Rhymes and The Music by the Earliest Masters Book Cover 25.png; The Baby's "
                    "Opera, Walter Crane, 1877), E major, 6/8, the sung melody; compared by intervals "
                    "because the arrangement is in F",
        note="Pitches read from the image and checked against the MusicXML transcription of the same "
             "book (" + PG_25418 + "jackhorner.xml); Our Old Nursery Rhymes (Moffat, Augener 1911; "
             + PG_61009 + "jackhorner.mxl) prints the same tune a semitone higher, in F. The article "
             "also says the melody now commonly associated with the rhyme was first printed by J. W. "
             "Elliott (National Nursery Rhymes, 1870); Elliott's tune (McLoughlin printing, New York, "
             "1870s, archive.org mothergoosesnurs00elli, p. 22) is a different one, D4 to D5 in G major.",
        melody=[69, 68, 69, 66, 66, 68, 66, 68, 64, 64, 69, 68, 69, 66, 66, 71, 68,
                69, 68, 69, 66, 66, 68, 66, 68, 64, 64, 66, 69, 68, 66, 64, 63, 64],
    ),
    "see-saw-margery-daw": dict(
        url=PG_25432 + "margerydaw.xml", retrieved=RETRIEVED, compare="exact",
        description="The Baby's Bouquet, tunes arranged by Lucy Crane (first published 1878), Project "
                    "Gutenberg eBook 25432, MusicXML transcription, F major, 6/8, the sung melody",
        note="This is Lucy Crane's 1878 tune, not the one commonly sung. The English article "
             "(en.wikipedia.org/wiki/See_Saw_Margery_Daw, no score) says the commonly associated "
             "melody was first printed by J. W. Elliott (National Nursery Rhymes, 1870); Elliott's "
             "tune (McLoughlin printing, New York, 1870s, archive.org mothergoosesnurs00elli, p. 24: "
             "G major, 6/8, G4 D4 | G4 G4 G4 D4 ...) differs from the first bar on and spans D4 to D5, "
             "so it could only be a level-2 piece. "
             "Moffat's Little Songs of Long Ago (1912, eBook 55107) prints a third tune.",
        melody=[65, 72, 69, 67, 69, 65, 65, 65, 72, 72, 69, 67, 69, 65, 69, 65,
                72, 72, 69, 65, 67, 72, 72, 69, 74, 70, 69, 70, 67, 65],
    ),
    "schlaf-kindlein-schlaf": dict(
        url=WIKI_DE + "Schlaf,_Kindlein,_schlaf", retrieved=RETRIEVED, compare="intervals",
        description="Score in the German article, section 'Melodie': Johann Friedrich Reichardt's melody "
                    "of 1781, F major, 2/4, quarter = 80, ten bars; compared by intervals because the "
                    "arrangement is in C",
        note="The English article (en.wikipedia.org/wiki/Schlaf,_Kindlein,_schlaf) credits the same "
             "melody to Reichardt but prints bars 2 to 4 differently (F4 C4 | A4 A4 G4 G4 | F4 C4, "
             "dropping to the low dominant) and ends on a half note; the German article's version is "
             "used, as the plan prefers for German tunes. Lucy Crane's setting in The Baby's Bouquet "
             "(1878) is a different tune after its first four notes and is not used.",
        melody=[69, 67, 67, 65, 65, 69, 72, 72, 70, 70, 69, 69, 70, 70, 67, 67,
                72, 72, 69, 69, 70, 70, 67, 67, 72, 72, 69, 70, 67, 67, 65],
    ),
    "little-bo-peep": dict(
        url=PG_61009 + "bopeep.mxl", retrieved=RETRIEVED, compare="exact",
        description="Our Old Nursery Rhymes ('The original tunes harmonized by Alfred Moffat', Augener, "
                    "copyright 1911), Project Gutenberg eBook 61009, MusicXML transcription by Linda "
                    "Cantoni, F major, 6/8, eight bars: the top line of the right hand, which carries the "
                    "tune (the book prints no separate voice line)",
        note="Bar 4 sets 'find them' as thirds, F4-A4 then E4-G4; the top notes A4 and G4 are the "
             "melody, by the top-line rule of tests/test_arrangements.py. The lower voice of bar 3 (F4, "
             "F4) is accompaniment. The transcription's tempo (quarter = 138) is not used.",
        melody=[65, 65, 65, 65, 65, 67, 67, 67, 67, 69, 70, 72, 72, 70, 69, 69, 67,
                72, 69, 69, 69, 69, 70, 67, 67, 67, 67, 69, 70, 69, 67, 65, 67, 65, 65],
    ),
    "three-little-kittens": dict(
        url=PG_25432 + "threelittlekittens.xml", retrieved=RETRIEVED, compare="intervals",
        description="The Baby's Bouquet ('The tunes collected & arranged by L.C.', Lucy Crane; first "
                    "published 1878), Project Gutenberg eBook 25432, MusicXML transcription, B-flat major, "
                    "6/8 with a sixteenth-note pickup, the sung melody of verse 1 (every note carries a "
                    "syllable); compared by intervals because the arrangement is in F",
        note="The last note is a half note followed by an eighth rest in the source, completing the "
             "pickup; the arrangement holds it for the whole bar. The source's tempo (quarter = 120) is "
             "not used.",
        melody=[65, 65, 70, 70, 70, 65, 65, 65, 74, 74, 70, 70, 70, 72, 72, 69, 69,
                70, 70, 65, 74, 70, 72, 69, 70],
    ),
    "pease-porridge-hot": dict(
        url=WIKI_EN + "Pease_Porridge_Hot", retrieved=RETRIEVED, compare="exact",
        description="The article's infobox score 'PeasePorridgeHotMusic1922.png', from The Song Play Book "
                    "(Wollaston, 1922), G major, 4/4, melody (top line of the right hand)",
        note="The clap marked on beat 4 of bars 1, 2, 5 and 6 is a rest.",
        melody=[62, 67, 69, 71, 62, 67, 69, 71, 72, 71, 69, 74, 71, 67, 69, 69, 71, 69,
                62, 67, 69, 71, 62, 67, 69, 71, 72, 71, 69, 74, 71, 67, 69, 69, 71, 67],
    ),
}
