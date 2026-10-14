"""Songs before 1929, easy rags and classical themes: the new own arrangements of the collections
`songs-before-1929`, `easy-rags` and `classical-themes` (L1 plan, Task 12).

Catalog entries: tools/catalog.d/songs.json. The core arrangements Happy Birthday, Ode to Joy and
Pachelbel's Canon stay in arrange.CORE_PIECES.

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

References: every melody was typed from a dated notated source (retrieved 2026-10-14); the notes,
the source description and the scans are kept under content/_raw/references/ (gitignored):
  - Wikisource transcriptions (LilyPond) of first or early editions: Camptown Races (Benteen,
    1850), Oh! Susanna (1848, plate 1427), Daisy Bell (New York, 1893). Camptown Races and
    Oh! Susanna were also checked note for note against library scans of the same or the next
    edition (Library of Congress 1852 guitar edition; Duke University's copy of plate 1427).
  - Library scans read from the page images: Long, Long Ago (Cramer, Addison & Beale, London,
    1839), The Little Brown Jug (J. E. Winner, Philadelphia, 1869; Indiana University), In the
    Good Old Summer Time (Howley, Haviland & Dresser, New York, 1902; University of Illinois
    Chicago).
  - Wikipedia scores (LilyPond in the article): the Surprise Symphony theme, Brahms's Lullaby
    (also checked against the Mutopia engraving, BrahmsJ/O49/Wiegenlied) and the opening of
    Eine kleine Nachtmusik.
  - The library's own core engraving of The Entertainer (Mutopia 263, after the 1902 edition):
    the melody line of the A strain.
A melody is the sung (or played) line, tied notes once. compare="intervals" marks a transposed
arrangement. Where a level-1 hand position cannot hold the whole tune, the arrangement and its
reference keep one complete section (the reference's description says which).

License: MIT (this module). The arrangements are dedicated to the public domain (CC0 1.0).
"""
from __future__ import annotations

RETRIEVED = "2026-10-14"

# ---------------------------------------------------------------------------
# References: the published melodies, typed from the sources (MIDI numbers)
# ---------------------------------------------------------------------------
# Camptown Races, verse, D major (bars of the 1850 edition, pickup first)
_CAMPTOWN_VERSE = [69,
                   69, 69, 66, 69, 71, 69, 66, 66, 64, 66, 64, 69,
                   69, 69, 66, 69, 71, 69, 66, 64, 66, 64, 62, 69,
                   69, 69, 66, 69, 69, 71, 69, 66, 66, 64, 66, 64, 69,
                   69, 69, 66, 69, 69, 71, 71, 69, 69, 66, 64, 66, 64, 62]
# Oh! Susanna, G major: four-bar phrases; the pickup "I" / "I'm" / "It" / "I've" is G A
_SUSANNA_PICKUP = [67, 69]
_SUSANNA_A = [71, 74, 74, 76, 74, 71, 67, 69, 71, 71, 69, 67, 69]   # "came from Alabama ... knee"
_SUSANNA_B = [71, 74, 74, 76, 74, 71, 67, 69, 71, 71, 69, 69, 67]   # "gwyne to Louisiana ... see"
_SUSANNA_CHORUS = [72, 72, 76, 76, 76, 74, 74, 71, 67, 69]          # "Oh! Susanna ... for me"
# Long, Long Ago, F major, bars 1-8
_LONG_AGO = [65, 65, 67, 69, 69, 70, 72, 74, 72, 69, 72, 70, 69, 67, 70, 69, 67, 65,
             65, 65, 67, 69, 69, 70, 72, 74, 72, 69, 72, 70, 69, 67, 69, 67, 65]
# The Little Brown Jug, chorus, C major
_JUG_HALF = [67, 67, 67, 69, 69, 69, 71, 71, 71, 69, 71]
# Daisy Bell, chorus, G major
_DAISY = [74, 71, 67, 62, 64, 66, 67, 64, 67, 62,
          69, 74, 71, 67, 64, 66, 67, 69, 71, 69, 71,
          72, 71, 69, 74, 71, 69, 67, 69, 71, 67, 64, 67, 64, 62, 62,
          67, 71, 69, 67, 71, 69, 71, 72, 74, 71, 67, 69, 62, 67]
# The Entertainer, A strain melody line (core score bars 4.5-20), C major
_ENTERTAINER = [62, 63, 64, 72, 64, 72, 64, 72, 72, 74, 75, 76, 72, 74, 76, 71, 74, 72,
                62, 63, 64, 72, 64, 72, 64, 72, 69, 67, 66, 69, 72, 76, 74, 72, 69, 74,
                62, 63, 64, 72, 64, 72, 64, 72, 72, 74, 75, 76, 72, 74, 76, 71, 74, 72,
                72, 74, 76, 72, 74, 76, 72, 74, 72, 76, 72, 74, 76, 72, 74, 72, 76, 72, 74, 76, 71, 74, 72]
# In the Good Old Summer Time, chorus with the second ending, B-flat major
_SUMMERTIME = [65, 67, 65, 62, 65, 70, 74, 72, 70, 70, 72, 70, 67, 65,
               62, 65, 70, 72, 74, 72, 70, 72, 74, 72, 74, 72, 65,
               62, 65, 70, 72, 74, 72, 70, 70, 70, 72, 70, 67, 70, 65, 65,
               62, 65, 70, 72, 74, 72, 70, 65, 67, 70, 70, 72, 70]
# Haydn, Symphony No. 94, II, first violins bars 1-16 (without the tutti chord of bar 16)
_SURPRISE_A = [60, 60, 64, 64, 67, 67, 64, 65, 65, 62, 62, 59, 59, 55, 60, 60, 64, 64, 67, 67, 64]
_SURPRISE = _SURPRISE_A + [72, 72, 66, 66, 67, 55] + _SURPRISE_A + [72, 72, 66, 66, 67]
# Brahms, Wiegenlied Op. 49 No. 4, E-flat major, with its pickup (grace notes left out)
_BRAHMS = [67, 67, 70, 67, 67, 70, 67, 70, 75, 74, 72, 72, 70, 65, 67, 68, 65, 65, 67, 68, 65, 68,
           74, 72, 70, 74, 75, 63, 63, 75, 72, 68, 70, 67, 63, 68, 70, 72, 70, 63, 63,
           75, 72, 68, 70, 67, 63, 68, 67, 65, 63]
# Mozart, Eine kleine Nachtmusik K. 525, I, bars 1-4 at the pitch of the reference (G5 ...)
_NACHTMUSIK = [79, 74, 79, 74, 79, 74, 79, 83, 86, 84, 81, 84, 81, 84, 81, 78, 81, 74]

REFERENCES: dict[str, dict] = {
    "camptown-races": dict(
        url="https://en.wikisource.org/wiki/Camptown_Races", retrieved=RETRIEVED, compare="intervals",
        description=("Wikisource transcription (LilyPond, Page:Camptown Races (1850).pdf/2) of the first "
                     "edition, 'Gwine to Run All Night' (Baltimore: F. D. Benteen, 1850): solo voice, "
                     "D major, 2/4, the verse with its pickup ('De Camptown ladies sing dis song ... Oh! "
                     "doo-dah day!'). Checked note for note against the 1852 Benteen edition for voice "
                     "and guitar (Library of Congress scan, Wikimedia Commons File:Camptownraces.gif)."),
        note=("Arranged in C major, a whole tone lower, so compared by intervals. Only the verse: the "
              "chorus ('Gwine to run all night') climbs to the upper octave, beyond a level-1 hand "
              "position. Note values doubled (2/4 written as 4/4), so sixteenths become eighths."),
        melody=_CAMPTOWN_VERSE,
    ),
    "oh-susanna": dict(
        url="https://en.wikisource.org/wiki/Oh!_Susanna_(1848)", retrieved=RETRIEVED, compare="exact",
        description=("Wikisource transcription (LilyPond, Page:Oh! Susanna (IA OhSusanna 201611).pdf/2-4) "
                     "of an 1848 edition (plate 1427): the voice in the verse and the Air in the chorus, "
                     "G major, 2/4, verse 1 and chorus. Checked note for note against Duke University's "
                     "copy of the same plate (Historic American Sheet Music n1329, Wikimedia Commons "
                     "File:Oh!_Susanna_2.jpg to _4.jpg)."),
        note=("Note values doubled (2/4 written as 4/4): sixteenths become eighths and the dotted "
              "eighth-sixteenth pairs are straightened into two quarters. The chorus is played once, "
              "without the repeat."),
        melody=(_SUSANNA_PICKUP + _SUSANNA_A + _SUSANNA_PICKUP + _SUSANNA_B + _SUSANNA_PICKUP + _SUSANNA_A
                + _SUSANNA_PICKUP + _SUSANNA_B + _SUSANNA_CHORUS + _SUSANNA_PICKUP + _SUSANNA_B),
    ),
    "long-long-ago": dict(
        url=("https://commons.wikimedia.org/wiki/File:Thomas_Haynes_Bayly_-_Long,_Long_Ago!_A_Ballad,"
             "_Cramer,_Addison_%26_Beale,_London,_n._d._(1839)_(IA_BaylyLongLongAgo1839Sheetmusic).pdf"),
        retrieved=RETRIEVED, compare="exact",
        description=("Scan of 'Long, Long Ago! A Ballad' (London: Cramer, Addison & Beale, n.d., advertised "
                     "in February 1839; Internet Archive BaylyLongLongAgo1839Sheetmusic), PDF pages 3 and 4, "
                     "the voice: F major, 4/4, bars 1-8 of the first verse ('Tell me the tales ... long, "
                     "long ago, long ago')."),
        note=("Only the first eight bars, a complete period that ends on the tonic: the middle section "
              "('Now you are come') drops to C4, which widens the range to 14 semitones, beyond a "
              "level-1 hand position. Rhythm as printed."),
        melody=_LONG_AGO,
    ),
    "little-brown-jug": dict(
        url=("https://webapp1.dlib.indiana.edu/inharmony/detail.do?action=detail&fullItemID=/lilly/starr/"
             "LL-SSM-2-086-0041"),
        retrieved=RETRIEVED, compare="exact",
        description=("Scan of 'The Little Brown Jug', words and music by Eastburn (Joseph E. Winner), "
                     "Philadelphia: J. E. Winner, 1869 (Lilly Library, Indiana University, Starr Sheet "
                     "Music, IN Harmony LL-SSM-2-086-0041), page 4: the Air of the chorus ('Ha, ha, ha, "
                     "you and me'), C major, 2/4."),
        note=("Only the chorus: with the verse the tune spans 12 semitones (E4 to E5), beyond a level-1 "
              "hand position. Note values doubled (2/4 written as 4/4): sixteenths become eighths."),
        melody=_JUG_HALF + [72, 74, 76] + _JUG_HALF + [72, 67, 72],
    ),
    "daisy-bell": dict(
        url="https://en.wikisource.org/wiki/Daisy_Bell", retrieved=RETRIEVED, compare="exact",
        description=("Wikisource transcription (LilyPond, Page:Daisy Bell (IA daisybell00harr).pdf/3) of "
                     "the 1893 New York printing: the voice (Singer1), G major, 3/4, the chorus ('Daisy, "
                     "Daisy, give me your answer do ... a bicycle built for two')."),
        note=("Only the chorus (32 bars); the verse is left out. In bar 19 of the chorus the cue-size "
              "triplet a-b-a (for the words of later verses) is left out and the main note A kept. "
              "Rhythm as printed."),
        melody=_DAISY,
    ),
    "the-entertainer-easy": dict(
        url="https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=263", retrieved=RETRIEVED,
        compare="exact",
        description=("The library's core engraving content/scores/joplin-the-entertainer.musicxml (Mutopia "
                     "263, typeset by Chris Sawer after the original 1902 edition, public domain): the "
                     "melody line of the A strain, from the last two sixteenths of bar 4 to bar 20, read "
                     "as the lowest right-hand note at each onset, that is the tune without its "
                     "upper-octave doubling and inner chord notes; C major, 2/4."),
        note=("Note values doubled (2/4 written as 4/4): sixteenths become eighths, ties kept. In bars 2, "
              "10 (original bars 6 and 14) the long C ends after two beats, an eighth rest before the C "
              "is struck again. The repeat, the second ending and the later strains are left out; the "
              "strain ends on the C of the original bar 20."),
        melody=_ENTERTAINER,
    ),
    "in-the-good-old-summertime": dict(
        url="https://digital.library.uic.edu/view/ark:/81984/d3g73735b", retrieved=RETRIEVED,
        compare="exact",
        description=("Scan of 'In the Good Old Summer Time', words by Ren Shields, music by George Evans "
                     "(New York: Howley, Haviland & Dresser, 1902; University of Illinois Chicago "
                     "Library, Sheet Music Collection SMC_0016_0080), page 5: the voice in the chorus, "
                     "B-flat major, 3/4, with the second ending."),
        note=("Only the chorus, once, with its second ending; the verse and the first ending's pickup "
              "('In the') are left out. Rhythm as printed."),
        melody=_SUMMERTIME,
    ),
    "surprise-symphony-theme": dict(
        url="https://en.wikipedia.org/wiki/Symphony_No._94_(Haydn)", retrieved=RETRIEVED, compare="exact",
        description=("Score in the article, section 'II. Andante': the first violins' theme, bars 1-16, "
                     "C major, 2/4 (\\relative c')."),
        note=("The fortissimo tutti chord on the second beat of bar 16 (the 'surprise') is not part of "
              "the melody line: the left hand plays it. Rhythm as printed."),
        melody=_SURPRISE,
    ),
    "brahms-lullaby": dict(
        url="https://en.wikipedia.org/wiki/Wiegenlied_(Brahms)", retrieved=RETRIEVED, compare="intervals",
        description=("Score in the article (section 'Melody'): E-flat major, 3/4, the 16-bar melody with "
                     "its pickup. It matches the voice of the Mutopia engraving (BrahmsJ/O49/Wiegenlied, "
                     "Mutopia 1037, public domain) note for note."),
        note=("Arranged in F major, a whole tone higher, so compared by intervals. The grace notes (the "
              "appoggiatura in bar 12 and the after-grace in bar 15) are left out, and the last bar is "
              "filled with a rest."),
        melody=_BRAHMS,
    ),
    "eine-kleine-nachtmusik-theme": dict(
        url="https://en.wikipedia.org/wiki/Eine_kleine_Nachtmusik", retrieved=RETRIEVED,
        compare="intervals",
        description=("First score in the article, section 'I. Allegro': the opening theme, bars 1-4, "
                     "G major, 4/4, at the first violins' pitch (\\relative c''')."),
        note=("Played an octave lower than the reference, so compared by intervals. Only the four bars of "
              "the reference; the last D is held for a half note instead of a quarter and a quarter rest."),
        melody=_NACHTMUSIK,
    ),
}

# ---------------------------------------------------------------------------
# The arrangements (arrange.py's note language, absolute pitches: c' = C4)
# ---------------------------------------------------------------------------
PIECES: dict[str, dict] = {
    # Level 1. The verse in C position (the source's D major a whole tone lower), note values
    # doubled; left hand C, F and G in one position, open fifths at the cadences.
    "camptown-races": dict(
        key="C", time="4/4", pickup="1/4", dynamic="mf",
        rh="""g'4 |
              g'4 g' e' g' | a' g' e' r | e' d'2. | e'4 d'2 g'4 |
              g'4 g' e' g' | a' g' e' r | d'2 e'4 d' | c'2 r4 g' |
              g'4 g' e' g'8 g' | a'4 g' e' r | e' d'2. | e'4 d'2 g'4 |
              g'4 g' e' g'8 g' | a'8 a' g' g' e'4 r | d'2 e'4 d' | c'2. r4 |""",
        lh="""r4 |
              c1 | f2 c | c g | c g |
              c1 | f2 c | g1 | <c g>1 |
              c1 | f2 c | c g | c g |
              c1 | f2 c | g1 | <c g>1 |""",
    ),
    # Level 1. Verse and chorus in the source's G major, note values doubled, dotted pairs
    # straightened; right hand G4 to E5, left hand G2 to D3.
    "oh-susanna": dict(
        key="G", time="4/4", pickup="1/4", dynamic="mf",
        rh="""g'8 a' |
              b'4 d'' d'' e'' | d'' b' g' a' | b' b' a' g' | a'2. g'8 a' |
              b'4 d'' d'' e'' | d'' b' g' a' | b' b' a' a' | g'2 r4 g'8 a' |
              b'4 d'' d'' e'' | d'' b' g' a' | b' b' a' g' | a'2 r4 g'8 a' |
              b'4 d'' d'' e'' | d'' b' g' a' | b' b' a' a' | g'2 r2 |
              c''2 c'' | e''4 e''2 e''4 | d'' d'' b' g' | a'2 r4 g'8 a' |
              b'4 d'' d'' e'' | d'' b' g' a' | b' b' a' a' | g'2 r2 |""",
        lh="""r4 |
              <g, d>1 | g,1 | g,2 d | d1 |
              <g, d>1 | g,1 | g,2 d | g,1 |
              <g, d>1 | g,1 | g,2 d | d1 |
              <g, d>1 | g,1 | g,2 d | <g, d>1 |
              c1 | c1 | g,1 | d1 |
              <g, d>1 | g,1 | g,2 d | <g, d>1 |""",
    ),
    # Level 1. The first eight bars in the source's F major; left hand F2 to C3.
    "long-long-ago": dict(
        key="F", time="4/4", dynamic="mp",
        rh="""f'4 f'8 g' a'4 a'8 bes' | c''4 d''8 c'' a'4 r | c''4 bes'8 a' g'4 r | bes'4 a'8 g' f'4 r |
              f'4 f'8 g' a'4 a'8 bes' | c''4 d''8 c'' a'4 r | c''4 bes'8 a' g'4 a'8 g' | f'2 r2 |""",
        lh="""<f, c>1 | f,2 a, | <f, c>2 c | g,2 <f, c> |
              <f, c>1 | f,2 a, | <f, c>2 c | <f, c>1 |""",
    ),
    # Level 1. The chorus in the source's C major, note values doubled; right hand G4 to E5.
    "little-brown-jug": dict(
        key="C", time="4/4", dynamic="mf",
        rh="""g'4 g' g'2 | a'4 a' a'2 | b'8 b' b'4 a' b' | c'' d'' e''2 |
              g'4 g' g'2 | a'4 a' a'2 | b'8 b' b'4 a' b' | c'' g' c'' r |""",
        lh="""c1 | f1 | g2 d | c1 |
              c1 | f1 | g2 d | <c g>1 |""",
    ),
    # Level 2. The chorus in the source's G major over a waltz bass.
    "daisy-bell": dict(
        key="G", time="3/4", dynamic="mf",
        rh="""d''2. | b' | g' | d'2 r4 | e'4 fis' g' | e'2 g'4 | d'2.~ | d'2 r4 |
              a'2. | d'' | b' | g'2 r4 | e'4 fis' g' | a'2 b'4 | a'2.~ | a'4 r b' |
              c'' b' a' | d''2 b'4 | a'4 g'2~ | g'2 a'4 | b'2 g'4 | e'2 g'4 | e'4 d'2~ | d'4 r d' |
              g'2 b'4 | a'4 r r | g'2 b'4 | a'4 r b'8 c'' | d''4 b' g' | a'2 d'4 | g'2.~ | g'4 r r |""",
        lh="""g,4 <b, d> <b, d> | g,4 <b, d> <b, d> | g,4 <b, d> <b, d> | g,4 <b, d> <b, d> |
              c4 <e g> <e g> | c4 <e g> <e g> | g,4 <b, d> <b, d> | d4 <fis c'> <fis c'> |
              d4 <fis c'> <fis c'> | g,4 <b, d> <b, d> | g,4 <b, d> <b, d> | g,4 <b, d> <b, d> |
              c4 <e g> <e g> | d4 <fis a> <fis a> | d4 <fis a> <fis a> | d4 <fis c'> <fis c'> |
              a,4 <c e> <c e> | g,4 <b, d> <b, d> | d4 <g b> <g b> | g,4 <b, d> <b, d> |
              g,4 <b, d> <b, d> | c4 <e g> <e g> | a,4 <d fis> <d fis> | g,4 <b, d> <b, d> |
              g,4 <b, d> <b, d> | d4 <fis c'> <fis c'> | g,4 <b, d> <b, d> | d4 <fis c'> <fis c'> |
              g,4 <b, d> <b, d> | d4 <fis c'> <fis c'> | g,4 <b, d> <b, d> | <g, d>2 r4 |""",
    ),
    # Level 2. The chorus with its second ending, in the source's B-flat major, over a waltz bass.
    "in-the-good-old-summertime": dict(
        key="B-", time="3/4", pickup="1/4", dynamic="mf",
        rh="""f'8 g' |
              f'4 d'2 | f'2 bes'4 | d''2.~ | d''4 c'' bes' | bes'4 c''2 | bes'2 g'4 | f'2.~ | f'4 r r |
              d'2 f'4 | bes'2 c''4 | d''2 c''4 | bes'2. | c''2 d''4 | c''2 d''4 | c''2.~ | c''4 r f' |
              d'2 f'4 | bes'2 c''4 | d''2 c''4 | bes'2 bes'4 | bes'2 c''4 | bes'4 g' bes' | f'2.~ | f'4 r f' |
              d'2 f'4 | bes'2 c''4 | d''2 c''4 | bes'2 f'4 | g'4 bes'2 | bes'2 c''4 | bes'2.~ | bes'4 r r |""",
        lh="""r4 |
              bes,4 <d f> <d f> | bes,4 <d f> <d f> | bes,4 <d f> <d f> | f,4 <a, ees> <a, ees> |
              ees4 <g bes> <g bes> | ees4 <g bes> <g bes> | f,4 <a, c> <a, c> | f,4 <a, ees> <a, ees> |
              bes,4 <d f> <d f> | ees4 <g bes> <g bes> | bes,4 <d f> <d f> | bes,4 <d f> <d f> |
              f,4 <a, ees> <a, ees> | f,4 <a, ees> <a, ees> | f,4 <a, c> <a, c> | f,4 <a, ees> <a, ees> |
              bes,4 <d f> <d f> | ees4 <g bes> <g bes> | bes,4 <d f> <d f> | bes,4 <d f> <d f> |
              ees4 <g bes> <g bes> | ees4 <g bes> <g bes> | f,4 <a, c> <a, c> | f,4 <a, ees> <a, ees> |
              bes,4 <d f> <d f> | ees4 <g bes> <g bes> | bes,4 <d f> <d f> | bes,4 <d f> <d f> |
              ees4 <g bes> <g bes> | f,4 <a, ees> <a, ees> | bes,4 <d f> <d f> | <bes, f>2 r4 |""",
    ),
    # Level 2. The A strain's melody line in C major, note values doubled, over a simplified stride
    # bass (bass note and two-note chord on alternate beats, following Joplin's harmony).
    "the-entertainer-easy": dict(
        key="C", time="4/4", pickup="1/4", dynamic="mf",
        rh="""d'8 dis' |
              e'8 c'' e' c'' e' c''4.~ | c''2 r8 c'' d'' dis'' | e''8 c'' d'' e''4 b'8 d''4 | c''2. d'8 dis' |
              e'8 c'' e' c'' e' c''4.~ | c''2. a'8 g' | fis'8 a' c'' e''4 d''8 c'' a' | d''2. d'8 dis' |
              e'8 c'' e' c'' e' c''4.~ | c''2 r8 c'' d'' dis'' | e''8 c'' d'' e''4 b'8 d''4 | c''2. c''8 d'' |
              e''8 c'' d'' e''4 c''8 d'' c'' | e''8 c'' d'' e''4 c''8 d'' c'' | e''8 c'' d'' e''4 b'8 d''4 |
              c''1 |""",
        lh="""r4 |
              c4 <e g> g, <e bes> | f, <f a> e, <g c'> | g, <e g> g, <f b> | c <e g> g, <e g> |
              c <e g> g, <e bes> | f, <f a> e, <g c'> | d <fis c'> a, <fis c'> | g, <g b> g, <f b> |
              c <e g> g, <e bes> | f, <f a> e, <g c'> | g, <e g> g, <f b> | c <e g> c <e g> |
              c <e g> g, <e bes> | a, <c f> aes, <c f> | g, <e g> g, <f b> |
              c <e g> c2 |""",
    ),
    # Level 2. Haydn's theme in C major as the first violins play it; left hand a bass note and a
    # two-note chord per bar, and the fortissimo chord on the last beat.
    "surprise-symphony-theme": dict(
        key="C", time="2/4", dynamic="p",
        rh="""c'8 c' e' e' | g' g' e'4 | f'8 f' d' d' | b b g4 |
              c'8 c' e' e' | g' g' e'4 | c''8 c'' fis' fis' | g'4 g8 r |
              !pp c'8 c' e' e' | g' g' e'4 | f'8 f' d' d' | b b g4 |
              c'8 c' e' e' | g' g' e'4 | c''8 c'' fis' fis' | g'8 r r4 |""",
        lh="""c4 <e g> | c <e g> | d <f b> | g, <b, d> |
              c <e g> | c <e g> | a, <d fis> | g, <b, d> |
              c <e g> | c <e g> | d <f b> | g, <b, d> |
              c <e g> | c <e g> | a, <d fis> | g,8 r !ff <g, b, d>4 |""",
    ),
    # Level 2. Brahms's melody in F major (a whole tone above the song's E-flat) over a waltz bass.
    "brahms-lullaby": dict(
        key="F", time="3/4", pickup="1/4", dynamic="p",
        rh="""a'8 a' |
              c''4. a'8 a'4 | c''4 r a'8 c'' | f''4 e''4. d''8 | d''4 c'' g'8 a' |
              bes'4 g' g'8 a' | bes'4 r g'8 bes' | e''8 d'' c''4 e'' | f''4 r f'8 f' |
              f''2 d''8 bes' | c''2 a'8 f' | bes'4 c'' d'' | c''2 f'8 f' |
              f''2 d''8 bes' | c''2 a'8 f' | bes'4 a' g' | f'2 r4 |""",
        lh="""r4 |
              f,4 <a, c> <a, c> | f,4 <a, c> <a, c> | c4 <g bes> <g bes> | g,4 <c e> <c e> |
              g,4 <bes, e> <bes, e> | g,4 <bes, e> <bes, e> | c4 <g bes> <g bes> | f,4 <a, c> <a, c> |
              bes,4 <d f> <d f> | f,4 <a, c> <a, c> | bes,4 <d f> <d f> | f,4 <a, c> <a, c> |
              bes,4 <d f> <d f> | f,4 <a, c> <a, c> | g,4 <bes, e> <bes, e> | <f, c>2 r4 |""",
    ),
    # Level 2. The four opening bars an octave below the violins, G major; left hand half notes.
    "eine-kleine-nachtmusik-theme": dict(
        key="G", time="4/4", dynamic="f",
        rh="""g'4 r8 d'8 g'4 r8 d'8 | g'8 d' g' b' d''4 r | c''4 r8 a'8 c''4 r8 a'8 | c''8 a' fis' a' d'2 |""",
        lh="""g,2 d | g, b, | a, c | a, <g, d> |""",
    ),
}
