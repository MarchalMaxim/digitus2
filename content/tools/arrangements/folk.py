"""Folk songs: own arrangements for the collection "Folk songs" (L1 plan, Task 11).

Yankee Doodle, Auld Lang Syne, Sakura Sakura, Korobeiniki, La Cucaracha, Red River Valley and Loch
Lomond, all at level 2. Catalog entries: tools/catalog.d/folk.json, which also records the tunes this
task did not arrange and why (rejected). The melodies are traditional, Korobeiniki's in the 1898
setting attributed to Yakov Prigozhy (died 1920); see the fragment's melody fields.

The references were read on 2026-10-14; the notation of each (lyrics left out) is kept in
content/_raw/references/<slug>.txt (gitignored). Two come from the Chinese Wikipedia because the
English articles have only a score image: Yankee Doodle and Sakura Sakura. Loch Lomond's is the
score image in the English article (a Wikimedia Commons file), read from the image.
License: MIT.
"""

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

from __future__ import annotations

# One stanza of each strophic tune, as MIDI numbers; the references below repeat them as sung.
_YANKEE_DOODLE_VERSE = [64, 69, 69, 71, 73, 69, 73, 71, 68, 69, 69, 71, 73, 69, 68, 64,
                        69, 69, 71, 73, 74, 73, 71, 69, 68, 64, 66, 68, 69, 69]
_YANKEE_DOODLE_CHORUS = [66, 68, 66, 64, 66, 68, 69, 64, 66, 64, 62, 61, 62, 64,
                         66, 68, 66, 64, 66, 68, 69, 66, 64, 69, 68, 71, 69, 69]
# Loch Lomond: verse and chorus share this tune after their upbeats (C D for the verse, C for the chorus).
_LOCH_LOMOND_TUNE = [65, 65, 67, 69, 67, 65, 67, 67, 65, 62, 60, 62, 65, 65, 65, 65, 69, 72, 74, 72, 72,
                     74, 74, 72, 69, 69, 72, 70, 69, 67, 65, 62, 60, 62, 65, 65, 69, 72, 74, 72, 69, 67, 65]
_RED_RIVER_VALLEY_STANZA = [62, 67, 71, 71, 71, 71, 69, 71, 69, 67, 71, 71, 71, 67, 71, 74, 72, 71,
                            69, 74, 72, 71, 71, 69, 67, 69, 71, 74, 72, 64, 64, 62, 66, 67, 69, 71, 69, 67]
_KOROBEINIKI_A = [64, 68, 71, 68, 64, 69, 72, 76, 74, 72, 71, 72, 74, 76, 72, 69, 69]
_KOROBEINIKI_B = [77, 79, 81, 79, 77, 76, 77, 76, 74, 72, 71, 72, 74, 76, 72, 69, 69]
_CUCARACHA_CHORUS = [60, 60, 60, 65, 69, 60, 60, 60, 65, 69, 65, 65, 64, 64, 62, 62, 60, 60, 60, 60,
                     64, 67, 60, 60, 60, 64, 67, 72, 74, 72, 70, 69, 67, 65]
_CUCARACHA_VERSE = [60, 60, 65, 65, 69, 69, 72, 69, 72, 74, 72, 70, 69, 72, 70, 67, 60, 60, 64, 64, 67, 67,
                    70, 67, 72, 74, 72, 70, 69, 67, 69, 65]

REFERENCES: dict[str, dict] = {
    "yankee-doodle": dict(
        url="https://zh.wikipedia.org/wiki/%E6%B4%8B%E5%9F%BA%E6%AD%8C", retrieved="2026-10-14",
        compare="intervals",
        description="Score in the Chinese Wikipedia article (revision 87230830; the English article has only an "
                    "image), A major, 2/4: the verse (upbeat and bars 1-8) and the chorus (bars 9-16), E4 to D5 "
                    "and C#4 to B4. The verse is the version A. W. Thayer gave Grove's Dictionary (vol. 4, 1889, "
                    "p. 510) except bar 4.",
        note="Transposed from A to G major (A major's three sharps are beyond level 2), note values doubled "
             "(2/4 eighths become 4/4 quarters, the chorus's dotted eighth and sixteenth a dotted quarter and "
             "an eighth).",
        melody=_YANKEE_DOODLE_VERSE + _YANKEE_DOODLE_CHORUS,
    ),
    "auld-lang-syne": dict(
        url="https://en.wikipedia.org/wiki/Auld_Lang_Syne", retrieved="2026-10-14", compare="exact",
        description="Score in the English Wikipedia article (revision 1380084234), F major, 4/4, upbeat and "
                    "16 bars: the tune as sung today, first printed in Thomson's Select Songs of Scotland (1799).",
        note="",
        melody=[60, 65, 65, 65, 69, 67, 65, 67, 69, 65, 65, 69, 72, 74, 74, 72, 69, 69, 65, 67, 65, 67, 69,
                65, 62, 62, 60, 65, 74, 72, 69, 69, 65, 67, 65, 67, 74, 72, 69, 69, 72, 74, 74, 72, 69, 69, 65,
                67, 65, 67, 69, 65, 62, 62, 60, 65],
    ),
    "sakura-sakura": dict(
        url="https://zh.wikipedia.org/wiki/%E6%A8%B1%E8%8A%B1_(%E6%B0%91%E8%B0%A3)", retrieved="2026-10-14",
        compare="exact",
        description="Score in the Chinese Wikipedia article (revision 91594626; the English article has only an "
                    "image), no key signature (A minor), 4/4, 14 bars, set to the text of the first print, the "
                    "Ministry of Education's Sokyokushu (1888). Its 50 pitches equal that print's, checked note "
                    "by note on 2026-10-14: Sokyokushu, Monbusho Ongaku Torishirabegakari, October 1888, No. 2 "
                    "'Sakura', National Diet Library Digital Collections pid 857651 "
                    "(https://dl.ndl.go.jp/pid/857651), frames 22-23, public domain mark. The Japanese article "
                    "(revision 107569914) says three versions differ from bar 13 on: in bars 13-14 the score has "
                    "the rhythm of the 1941 school-song version, E F B-A F | E, the 1888 print a quarter rest, "
                    "E, F | B-A F E, on the same pitches.",
        note="Bars 13-14 follow the 1888 print's rhythm (quarter rest, E quarter, F half | B-A eighths, F "
             "quarter, E half), not the reference score's; the pitches are the same.",
        melody=[69, 69, 71, 69, 69, 71, 69, 71, 72, 71, 69, 71, 69, 65, 64, 60, 64, 65, 64, 64, 60, 59,
                69, 71, 72, 71, 69, 71, 69, 65, 64, 60, 64, 65, 64, 64, 60, 59, 69, 69, 71, 69, 69, 71,
                64, 65, 71, 69, 65, 64],
    ),
    "korobeiniki": dict(
        url="https://en.wikipedia.org/wiki/Korobeiniki", retrieved="2026-10-14", compare="exact",
        description="Score in the 'Melody' section of the English Wikipedia article (revision 1373187891), "
                    "A minor, 4/4, 8 bars with the second strain repeated: the folk song, not the 1989 "
                    "video-game arrangement. The Russian article (Korobushka, revision 154398704) dates the "
                    "music to 1898 and calls Yakov Prigozhy's setting (Prigozhy 1840-1920) the most popular "
                    "version; it also names settings by A. N. Chernyavsky (1898), A. Dagmarov (1903) and "
                    "V. S. Ruzhitsky (1905). The catalog credits the melody to Prigozhy (attributed).",
        note="The repeat of bars 5-8 is written out (bars 9-12).",
        melody=_KOROBEINIKI_A + _KOROBEINIKI_B * 2,
    ),
    "la-cucaracha": dict(
        url="https://en.wikipedia.org/wiki/La_Cucaracha", retrieved="2026-10-14", compare="exact",
        description="Score in the 'Melody' section of the English Wikipedia article (revision 1376650501), "
                    "F major, 3/4: chorus, verse and the chorus again, as the score's repeat unfolds.",
        note="The repeat is written out (chorus, verse, chorus). In the last bar of the verse the F is an eighth "
             "instead of a half note, so that the chorus's upbeat fits the bar; the pitches are unchanged.",
        melody=_CUCARACHA_CHORUS + _CUCARACHA_VERSE + _CUCARACHA_CHORUS,
    ),
    "red-river-valley": dict(
        url="https://en.wikipedia.org/wiki/Red_River_Valley_(song)", retrieved="2026-10-14", compare="exact",
        description="Score in the English Wikipedia article (revision 1378721571), G major, 4/4: one stanza "
                    "(upbeat and 8 bars), sung twice (verse and refrain share the tune). Authorship per the "
                    "article: the first sheet music, 'In the Bright Mohawk Valley' (New York, 1896), names "
                    "James J. Kerrigan as writer (his dates are unknown); the song circulated earlier: a lyric "
                    "manuscript annotated 'Nemaha 1879' and 'Harlan 1885', a readers' request for the words in "
                    "The Weekly Wisconsin (June 1887) and a version printed there in September 1887. The "
                    "article calls it a folk song of uncertain origins and its infobox gives the writer as "
                    "'Traditional'.",
        note="The stanza is written out twice; the closing G of the first is a half note followed by a rest and "
             "the second stanza's upbeat.",
        melody=_RED_RIVER_VALLEY_STANZA * 2,
    ),
    "loch-lomond": dict(
        url="https://en.wikipedia.org/wiki/The_Bonnie_Banks_o%27_Loch_Lomond", retrieved="2026-10-14",
        compare="exact",
        description="Score image in the English Wikipedia article (revision 1378516938), Wikimedia Commons "
                    "'File:The Bonnie Banks o' Loch Lomond.png' (file page revision 1120198809, image SHA-1 "
                    "c24fdc64a6a44f8b421f7248fb3f4a62342cd1cc): the song as edited by Robert Ford (the "
                    "article's caption gives 1904, the Commons description 1909), F major, C time, verse and "
                    "chorus, each with its upbeat. Read from the image; where verses split a note the first "
                    "verse's notes are taken (bar 5).",
        note="The Scotch snaps (bars 7 and 15) and the dotted eighth and sixteenth pairs (bars 1 and 9) are "
             "played as even eighths; the fermatas are left out.",
        melody=[60, 62] + _LOCH_LOMOND_TUNE + [60] + _LOCH_LOMOND_TUNE,
    ),
}

PIECES: dict[str, dict] = {
    # Verse and chorus in G major, note values doubled: the right hand D4-C5, then B3-A4. Verse over G and
    # D half notes (beat 3 carries A or F-sharp in most bars, so the left hand moves to D there; C and A
    # under the C and E of bars 6 and 7); chorus over C, G and D major triads.
    "yankee-doodle": dict(
        key="G", time="4/4", pickup="1/4", dynamic="mf",
        rh="""d'4 |
              g'4 g' a' b' | g' b' a' fis' | g' g' a' b' | g'2 fis'4 d' |
              g'4 g' a' b' | c'' b' a' g' | fis' d' e' fis' | g'2 g'4 r |
              !f e'4. fis'8 e'4 d' | e' fis' g'2 | d'4. e'8 d'4 c' | b4( c') d' r |
              e'4. fis'8 e'4 d' | e' fis' g' e' | d' g' fis' a' | g'2 g'4 r |""",
        lh="""r4 |
              g,2 d | g, d | g, d | g, d |
              g, d | c d | d a, | <g, d>1 |
              <c e g>1 | <c e g>2 <b, d g> | <d fis a>1 | <g, b, d> |
              <c e g> | <c e g>2 <b, d g> | <d fis a>1 | <g, d> |""",
    ),
    # Open fifths on F, C and B-flat; G minor under the D of "auld lang syne" (beat 3 of bars 7 and 15).
    "auld-lang-syne": dict(
        key="F", time="4/4", pickup="1/4", dynamic="mp",
        rh="""c'4 |
              f'4.( f'8 f'4 a' | g'4. f'8 g'4 a') | f'4.( f'8 a'4 c'' | d''2.) d''4 |
              c''4.( a'8 a'4 f' | g'4. f'8 g'4 a') | f'4.( d'8 d'4 c' | f'2.) d''4 |
              c''4.( a'8 a'4 f' | g'4. f'8 g'4 d'') | c''4.( a'8 a'4 c'' | d''2.) d''4 |
              c''4.( a'8 a'4 f' | g'4. f'8 g'4 a') | f'4.( d'8 d'4 c' | f'2.) r4 |""",
        lh="""r4 |
              <f, c>1 | <c g> | <f, c> | <bes, f> |
              <f, c> | <c g> | <bes, f>2 <g, d> | <f, c>1 |
              <f, c> | <c g> | <f, c> | <bes, f> |
              <f, c> | <c g> | <bes, f>2 <g, d> | <f, c>1 |""",
    ),
    # Open fifths on A and E (the B on beat 3 sits on E-B), D under the F of bars 4 and 8, and a close
    # on the fifth E-B: the tune ends on its final, E. Bars 13-14 in the rhythm of the 1888 print.
    "sakura-sakura": dict(
        key="a minor", time="4/4", dynamic="p",
        rh="""a'4( a' b'2) | a'4( a' b'2) | a'4( b' c'' b' | a' b'8 a' f'2) |
              e'4( c' e' f' | e' e'8 c' b2) | a'4( b' c'' b' | a' b'8 a' f'2) |
              e'4( c' e' f' | e' e'8 c' b2) | a'4( a' b'2) | a'4( a' b'2) |
              r4 e'4( f'2 | b'8 a' f'4 e'2) |""",
        lh="""<a, e>2 <e, b,> | <a, e> <e, b,> | <a, e>1 | <a, e>2 <d a> |
              <a, e>1 | <a, e>2 <e, b,> | <a, e>1 | <a, e>2 <d a> |
              <a, e>1 | <a, e>2 <e, b,> | <a, e> <e, b,> | <a, e> <e, b,> |
              <a, e> d | <e, b,>1 |""",
    ),
    # Root-position triads: E major, A minor, D minor. The D on beat 3 of bars 3, 7 and 11 would make a
    # seventh with the E, so the left hand drops to B there.
    "korobeiniki": dict(
        key="a minor", time="4/4", dynamic="mf",
        rh="""e'4.( gis'8 b'4 gis'8 e' | a'4. c''8 e''4 d''8 c'' | b'4. c''8 d''4 e'' | c'' a' a'2) |
              f''4.( g''8 a''4 g''8 f'' | e''4. f''8 e''4 d''8 c'' | b'4. c''8 d''4 e'' | c'' a' a'2) |
              f''4.( g''8 a''4 g''8 f'' | e''4. f''8 e''4 d''8 c'' | b'4. c''8 d''4 e'' | c'' a' a'2) |""",
        lh="""<e, gis, b,>1 | <a, c e> | <e, gis, b,>2 b, | <a, c e>1 |
              <d f a> | <a, c e> | <e, gis, b,>2 b, | <a, c e>1 |
              <d f a> | <a, c e> | <e, gis, b,>2 b, | <a, c e>1 |""",
    ),
    # Chorus, verse, chorus over open fifths on F, C and G (G minor under the B-flats of the verse).
    "la-cucaracha": dict(
        key="F", time="3/4", pickup="3/8", dynamic="f",
        rh="""c'8 c' c' |
              f'4 a'8 c' c' c' | f'4 a'2 | f'8 f' e' e' d' d' | c'4. c'8 c' c' |
              e'4 g'8 c' c' c' | e'4 g'2 | c''8 d'' c'' bes' a' g' | f'2. |
              !mf c'8 c' f' f' a' a' | c''4 a'2 | c''8 d'' c'' bes' a' c'' | bes'4 g'2 |
              c'8 c' e' e' g' g' | bes'4 g'2 | c''8 d'' c'' bes' a' g' | a'4 f'8 c' c' c' |
              !f f'4 a'8 c' c' c' | f'4 a'2 | f'8 f' e' e' d' d' | c'4. c'8 c' c' |
              e'4 g'8 c' c' c' | e'4 g'2 | c''8 d'' c'' bes' a' g' | f'2. |""",
        lh="""r4. |
              <f, c>2. | <f, c> | <f, c> | <c g> |
              <c g> | <c g> | <c g> | <f, c> |
              <f, c> | <f, c> | <c g> | <g, d> |
              <c g> | <g, d> | <c g> | <f, c> |
              <f, c> | <f, c> | <f, c> | <c g> |
              <c g> | <c g> | <c g> | <f, c> |""",
    ),
    # Verse and refrain on the same tune: open fifths, then broken fifths; C under the held C of bar 6.
    "red-river-valley": dict(
        key="G", time="4/4", pickup="1/4", dynamic="mp",
        rh="""d'8( g' |
              b'4 b'8 b' b'4 a'8 b' | a'4 g'2) b'8( b' | b'4 g'8 b' d''4 c''8 b' | a'2.) d''8( c'' |
              b'4 b'8 a' g'4 a'8 b' | d''4 c''~ c'' e'8 e' | d'4 fis'8 g' a'4 b'8 a' | g'2) r4 d'8( g' |
              b'4 b'8 b' b'4 a'8 b' | a'4 g'2) b'8( b' | b'4 g'8 b' d''4 c''8 b' | a'2.) d''8( c'' |
              b'4 b'8 a' g'4 a'8 b' | d''4 c''~ c'' e'8 e' | d'4 fis'8 g' a'4 b'8 a' | g'1) |""",
        lh="""r4 |
              <g, d>1 | <d a>2 <g, d> | <g, d>1 | <d a> |
              <g, d> | <g, d>2 <c g> | <d a>1 | <g, d> |
              g,2 d | d g, | g, d | d a |
              g, d | g, c | d a | <g, d>1 |""",
    ),
    # Verse and chorus on the same tune: triads within a fifth under the verse (F, G minor, B-flat,
    # D minor, C), changing on beat 3 where the melody leaves the chord (C over B-flat in bar 4, D over C
    # in bar 7); root and fifth in half notes under the chorus.
    "loch-lomond": dict(
        key="F", time="4/4", pickup="1/4", dynamic="mp",
        rh="""c'8( d' |
              f'4 f'8 g' a'4 g'8 f' | g'4 g'8 f' d'4) c'8( d' | f'4 f'8 f' f'4 a'8 c'' | d''2 c''4) c''( |
              d''4 d''8 c'' a'4 a'8 c'' | bes'8 a' g' f' d'4) c'8( d' | f'8 f' a' c'' d''4 c''8 a' |
              g'2 f'4) !mf c'( |
              f'4 f'8 g' a'4 g'8 f' | g'4 g'8 f' d'4) c'8( d' | f'4 f'8 f' f'4 a'8 c'' | d''2 c''4) c''( |
              d''4 d''8 c'' a'4 a'8 c'' | bes'8 a' g' f' d'4) c'8( d' | f'8 f' a' c'' d''4 c''8 a' |
              g'2 f'4) r |""",
        lh="""r4 |
              <f, a, c>1 | <g, bes, d> | <f, a, c> | <bes, d f>2 <f, a, c> |
              <d f a>1 | <g, bes, d> | <f, a, c>2 <bes, d f> | <c e g> <f, a, c> |
              f,2 c | g, d | f, c | bes, f, |
              d a, | g, d | f, bes, | c <f, c> |""",
    ),
}
