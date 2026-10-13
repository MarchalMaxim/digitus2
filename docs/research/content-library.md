# Built-in content library

Status: complete. 30 pieces at levels 1–5, 38 MusicXML files (30 scores plus 8
copies with the editor's fingering). Every file is valid MusicXML 4.0, and
every converted piece was checked note by note against LilyPond's own MIDI.
Built 2026-10-13 by the content agent. Regenerate with `content/tools/build.py`
(see `content/tools/README.md`).

## At a glance

| Level | Meaning | Pieces | Sources |
|---|---|---|---|
| 1 | Five-finger position, both hands simple | 5 | own arrangements |
| 2 | Easy (≈ ABRSM grades 1–2) | 10 | 5 own arrangements, 5 Mutopia |
| 3 | Early intermediate (≈ grades 2–4) | 7 | Mutopia |
| 4 | Intermediate (≈ grades 5–6) | 5 | Mutopia |
| 5 | Stretch (≈ grades 6–7) | 3 | Mutopia (2 of them excerpts) |

| Licence of the MusicXML file | Files | Pieces |
|---|---|---|
| CC0 1.0 (our arrangements) | 10 | 10 |
| Public domain (Mutopia engraving dedicated to the public domain; our conversion is CC0) | 20 | 15 |
| CC BY-SA 2.5 / 3.0 (Mutopia engraving; the adaptation keeps the licence) | 8 | 5 |

Every composition is in the public domain in the United States (the latest
composer died in 1925; the latest publication is 1902). The bundle has no
20th-century copyrighted work, no Bartók and no MuseScore.com upload.

## Catalogue

Tempo is in quarter notes per minute, the same unit as MusicXML `<sound
tempo>`; every file starts with that playback tempo. "Bars" excludes pickup
bars and the second half of a bar that a repeat sign splits. "Dur." is the
playing time with repeats at the default tempo. "Ed. fing." counts the
`<fingering>` elements in the `.fingered` copy. "MIDI check" counts sounding
notes matched against LilyPond 2.24's MIDI of the same source.

| Lvl | Slug | Piece | Composer | Catalogue | Bars | Key, time | Tempo | Dur. | Source | Ed. fing. | MIDI check |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `twinkle-twinkle-little-star` | Twinkle, Twinkle, Little Star | Traditional |  | 12 | C major, 4/4 | 100 | 0:29 | own (CC0) | - | n/a |
| 1 | `mary-had-a-little-lamb` | Mary Had a Little Lamb | Traditional (tune attributed to Lowell Mason) |  | 8 | C major, 4/4 | 104 | 0:18 | own (CC0) | - | n/a |
| 1 | `ode-to-joy` | Ode to Joy (simplified) | Ludwig van Beethoven (1770–1827) | Symphony No. 9, Op. 125, finale (theme) | 16 | C major, 4/4 | 108 | 0:36 | own (CC0) | - | n/a |
| 1 | `frere-jacques` | Frère Jacques | Traditional (French) |  | 8 | C major, 4/4 | 108 | 0:18 | own (CC0) | - | n/a |
| 1 | `jingle-bells` | Jingle Bells (chorus) | James Lord Pierpont (1822–1893) |  | 16 | C major, 4/4 | 120 | 0:32 | own (CC0) | - | n/a |
| 2 | `happy-birthday` | Happy Birthday to You | Mildred J. Hill and Patty Hill (1859–1916 / 1868–1946) | melody of 'Good Morning to All' | 8 | G major, 3/4 | 100 | 0:15 | own (CC0) | - | n/a |
| 2 | `amazing-grace` | Amazing Grace | Traditional (tune 'New Britain') |  | 14 | G major, 3/4 | 80 | 0:32 | own (CC0) | - | n/a |
| 2 | `scarborough-fair` | Scarborough Fair | Traditional (English ballad) |  | 16 | D dorian, 3/4 | 96 | 0:30 | own (CC0) | - | n/a |
| 2 | `greensleeves` | Greensleeves | Traditional (English) |  | 16 | A minor, 6/8 | 96 | 0:30 | own (CC0) | - | n/a |
| 2 | `pachelbel-canon-in-d` | Canon in D (simplified) | Johann Pachelbel (1653–1706) | P. 37 | 13 | D major, 4/4 | 84 | 0:37 | own (CC0) | - | n/a |
| 2 | `bach-minuet-g-major-bwv-anh-114` | Minuet in G major | Christian Petzold (1677–1733) | BWV Anh. 114 | 32 | G major, 3/4 | 120 | 1:36 | Mutopia, PD | - | 203/203 |
| 2 | `bach-minuet-g-minor-bwv-anh-115` | Minuet in G minor | Christian Petzold (1677–1733) | BWV Anh. 115 | 32 | G minor, 3/4 | 112 | 1:43 | Mutopia, PD | - | 199/199 |
| 2 | `mozart-minuet-f-major-k2` | Minuet in F major | Wolfgang Amadeus Mozart (1756–1791) | K. 2 | 24 | F major, 3/4 | 120 | 0:48 | Mutopia, PD | - | 130/130 |
| 2 | `schumann-op68-no1-melody` | Melody (Album for the Young, No. 1) | Robert Schumann (1810–1856) | Op. 68 No. 1 | 20 | C major, 4/4 | 96 | 1:00 | Mutopia, CC BY-SA 2.5 | 30 | 303/303 |
| 2 | `burgmuller-op100-no1-la-candeur` | La Candeur (Frankness) | Friedrich Burgmüller (1806–1874) | Op. 100 No. 1 | 23 | C major, 4/4 | 152 | 1:00 | Mutopia, PD | 46 | 241/241 |
| 3 | `burgmuller-op100-no2-arabesque` | Arabesque | Friedrich Burgmüller (1806–1874) | Op. 100 No. 2 | 33 | A minor, 2/4 | 152 | 0:43 | Mutopia, PD | 26 | 283/283 |
| 3 | `burgmuller-op100-no3-pastorale` | Pastorale | Friedrich Burgmüller (1806–1874) | Op. 100 No. 3 | 29 | G major, 6/8 | 100 | 1:07 | Mutopia, PD | 52 | 346/346 |
| 3 | `burgmuller-op100-no5-innocence` | Innocence | Friedrich Burgmüller (1806–1874) | Op. 100 No. 5 | 17 | F major, 3/4 | 112 | 0:51 | Mutopia, PD | 44 | 215/215 |
| 3 | `schumann-op68-no8-wild-rider` | The Wild Rider (Album for the Young, No. 8) | Robert Schumann (1810–1856) | Op. 68 No. 8 | 24 | A minor, 6/8 | 152 | 0:38 | Mutopia, CC BY-SA 2.5 | - | 417/417 |
| 3 | `clementi-sonatina-op36-no1-mvt1` | Sonatina in C major, 1st movement (Spiritoso) | Muzio Clementi (1752–1832) | Op. 36 No. 1 | 38 | C major, 2/2 | 132 | 2:18 | Mutopia, PD | - | 333/333 |
| 3 | `bach-prelude-c-major-bwv-846` | Prelude in C major (WTC I, No. 1) | Johann Sebastian Bach (1685–1750) | BWV 846 | 35 | C major, 4/4 | 60 | 2:20 | Mutopia, PD | - | 549/549 |
| 3 | `satie-gymnopedie-no1` | Gymnopédie No. 1 | Erik Satie (1866–1925) | Trois Gymnopédies, No. 1 | 47 | D major, 3/4 | 66 | 3:33 | Mutopia, PD | - | 282/282 |
| 4 | `beethoven-fur-elise-woo-59` | Für Elise (Bagatelle in A minor) | Ludwig van Beethoven (1770–1827) | WoO 59 | 105 | A minor, 3/8 | 72 | 2:36 | Mutopia, PD | - | 902/902 |
| 4 | `mozart-sonata-k545-mvt1` | Piano Sonata in C major ('Sonata facile'), 1st mvt | Wolfgang Amadeus Mozart (1756–1791) | K. 545 | 73 | C major, 4/4 | 132 | 4:25 | Mutopia, CC BY-SA 3.0 | 378 | 1271/1271 |
| 4 | `chopin-prelude-op28-no7` | Prelude in A major | Frédéric Chopin (1810–1849) | Op. 28 No. 7 | 16 | A major, 3/4 | 72 | 0:41 | Mutopia, PD | - | 167/167 |
| 4 | `chopin-prelude-op28-no4` | Prelude in E minor | Frédéric Chopin (1810–1849) | Op. 28 No. 4 | 25 | E minor, 2/2 | 56 | 1:48 | Mutopia, PD | - | 598/598 |
| 4 | `bach-invention-no1-bwv-772` | Invention No. 1 in C major | Johann Sebastian Bach (1685–1750) | BWV 772 | 22 | C major, 4/4 | 80 | 1:06 | Mutopia, CC BY-SA 3.0 | - | 458/458 |
| 5 | `joplin-the-entertainer` | The Entertainer | Scott Joplin (1868–1917) |  | 92 | C major, 2/4 | 72 | 4:13 | Mutopia, PD | - | 2621/2621 |
| 5 | `beethoven-moonlight-sonata-mvt1` | 'Moonlight' Sonata, 1st movement (opening), *excerpt* | Ludwig van Beethoven (1770–1827) | Op. 27 No. 2 | 27 | C# minor, 2/2 | 54 | 2:00 | Mutopia, CC BY-SA 2.5 | 147 | 476/476 |
| 5 | `chopin-waltz-op69-no2` | Waltz in B minor (opening), *excerpt* | Frédéric Chopin (1810–1849) | Op. 69 No. 2 (posth.) | 32 | B minor, 3/4 | 152 | 0:38 | Mutopia, PD | 60 | 341/341 |

Excerpts:
- **Moonlight:** bars 1–27 of 69, the introduction and the exposition; the
  development starts at bar 28.
- **Chopin Waltz:** the pickup plus bars 1–32 of 146, the A section, which
  ends on the tonic. Its last bar keeps the run-up into the B section.

Everything else is complete. Für Elise, the Entertainer and K.545 are long
but stay well under the size limit (largest file 518 KB), so they were kept
whole.

## Provenance of the Mutopia engravings

All were downloaded on 2026-10-13 from `https://www.mutopiaproject.org/ftp/<path>/`.
`content/_raw/mutopia/fetch_log.json` records the SHA-256 of every file. The
Mutopia sources mirror GitHub `MutopiaProject/MutopiaProject` at commit
`2144afd6f52d56c5b6995b8b589ef1268b3139f0` (2024-11-07).

| Slug | Mutopia piece | Typesetter | Edition engraved from | Engraving licence | Orig. LilyPond |
|---|---|---|---|---|---|
| `bach-minuet-g-major-bwv-anh-114` | [Mutopia-2017/01/19-75](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=75) | Allen Garvin | Bach-Gesellschaft | Public Domain | 2.19.49 |
| `bach-minuet-g-minor-bwv-anh-115` | [Mutopia-2015/08/21-76](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=76) | Allen Garvin | Bach-Gesellschaft | Public Domain | 2.18.2 |
| `mozart-minuet-f-major-k2` | [Mutopia-2016/11/30-1770](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1770) | Nicolas Morant | Breitkopf & Härtel (AMA), plate W.A.M. 2.4 | Public Domain | 2.19.49 |
| `schumann-op68-no1-melody` | [Mutopia-2007/02/11-647](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=647) | Philippe Hézaine | Peters | CC BY-SA 2.5 | 2.10.16 |
| `burgmuller-op100-no1-la-candeur` | [Mutopia-2013/01/12-202](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=202) | Bas Wassink | Collection Litolff | Public Domain | 2.16.1 |
| `burgmuller-op100-no2-arabesque` | [Mutopia-2013/01/12-203](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=203) | Bas Wassink | Collection Litolff | Public Domain | 2.16.1 |
| `burgmuller-op100-no3-pastorale` | [Mutopia-2013/01/12-218](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=218) | Bas Wassink | Collection Litolff | Public Domain | 2.16.1 |
| `burgmuller-op100-no5-innocence` | [Mutopia-2013/01/12-214](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=214) | Bas Wassink | Collection Litolff | Public Domain | 2.16.1 |
| `schumann-op68-no8-wild-rider` | [Mutopia-2007/02/11-655](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=655) | Philippe Hézaine | Peters | CC BY-SA 2.5 | 2.10.16 |
| `clementi-sonatina-op36-no1-mvt1` | [Mutopia-2016/11/30-804](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=804) | Brian D. Rude | Schirmer Sonatina Album (1893) | Public Domain | 2.18.2 |
| `bach-prelude-c-major-bwv-846` | [Mutopia-2011/09/12-5](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=5) | Tobias Erbsland | not stated | Public Domain | 2.14.2 |
| `satie-gymnopedie-no1` | [Mutopia-2014/12/14-37](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=37) | Evin Robertson | Dover reprint | Public Domain | 2.18.2 |
| `beethoven-fur-elise-woo-59` | [Mutopia-2015/08/18-931](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=931) | Stelios Samelis | Breitkopf & Härtel (1888) | Public Domain | 2.18.2 |
| `mozart-sonata-k545-mvt1` | [Mutopia-2013/09/01-998](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=998) | Alejandro Sierra | an IMSLP scan (edition not named) | CC BY-SA 3.0 | 2.16.1 |
| `chopin-prelude-op28-no7` | [Mutopia-2015/01/17-470](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=470) | Magnus Lewis-Smith | Edition Peters | Public Domain | 2.18.2 |
| `chopin-prelude-op28-no4` | [Mutopia-2016/10/28-468](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=468) | Magnus Lewis-Smith | Peters (1879) | Public Domain | 2.18.2 |
| `bach-invention-no1-bwv-772` | [Mutopia-2008/06/15-40](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=40) | Jeff Covey | Bach-Gesellschaft | CC BY-SA 3.0 | 2.11.49 |
| `joplin-the-entertainer` | [Mutopia-2016/11/25-263](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=263) | Chris Sawer | reproduction of the 1902 first edition | Public Domain | 2.19.32 |
| `beethoven-moonlight-sonata-mvt1` | [Mutopia-2007/02/11-276](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=276) | Stewart Holmes | Berners (1908), ed. A. Winterberger | CC BY-SA 2.5 | 2.10.16 |
| `chopin-waltz-op69-no2` | [Mutopia-2013/03/23-511](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=511) | Roland Goretzki | Peters, ed. Herrmann Scholtz | Public Domain | 2.16.1 |

## Licensing notes

- **Public-domain engravings (15 pieces).** The typesetters dedicated their
  engravings to the public domain. Our MusicXML conversions are released
  under CC0 1.0, and each file's `<rights>` element says so.
- **CC BY-SA engravings (5 pieces: Schumann Op. 68 Nos. 1 and 8, Moonlight,
  K.545, Invention No. 1).** No public-domain engraving of these exists on
  Mutopia. The MusicXML files are adaptations, so they carry the same licence
  and credit the typesetter in `<rights>` and in `manifest.json`
  (`source.typesetter`, `source.license`, `source.licenseUrl`).
  - Distributing them next to the MIT-licensed app is aggregation and does
    not affect the code licence.
  - The app must show the attribution (piece, typesetter, Mutopia id,
    licence) wherever it shows these scores. All of it is in the manifest.
  - If the coordinator prefers a strictly CC0/PD bundle, drop these five
    slugs; every level keeps at least two other pieces.
- **Our arrangements (10 pieces)** are dedicated to the public domain
  (CC0 1.0). The melodies are traditional or long out of copyright:
  - **Happy Birthday.** "Good Morning to All" was published in 1893. In
    *Marya v. Warner/Chappell* (C.D. Cal., Sept. 2015) the court found no
    valid copyright in the lyrics, and the 2016 settlement put the song in
    the public domain in the US. In the EU it has been public domain since
    1 January 2017.
  - **Scarborough Fair.** The arrangement uses the traditional Dorian
    melody that is commonly sung today. It deliberately avoids the 1966
    Simon & Garfunkel arrangement and its "Canticle" counter-melody, which
    are copyrighted. The notes were checked against the transcription in
    the English Wikipedia article ("version commonly used today",
    [Scarborough Fair (ballad)](https://en.wikipedia.org/wiki/Scarborough_Fair_(ballad))).
    Residual risk: this tune version was collected in 1947 and first
    printed in 1960. Traditional melodies are generally treated as public
    domain, but if the project wants zero risk, swap it for another folk
    tune.

## How the library is built

### Our arrangements (`tools/arrange.py`)

- **Format.** Each piece is a compact, LilyPond-like note spec in absolute
  pitch (for example `c'4` is a middle-C quarter). music21 10.5 turns it into
  a two-staff piano score.
- **Checks.** The parser checks every bar's duration and that both hands
  have the same number of bars.
- **Output.** Post-processing fixes the metadata, uses `P1` as the part id
  and writes a constant encoding date, so rebuilds are byte-identical
  (tested).
- **Harmonies.** Checked by script for strong-beat clashes (seconds,
  tritones, sevenths); the remaining ones are deliberate:
  - passing tones;
  - a dominant 7th in Ode to Joy;
  - Dorian 7ths in Scarborough Fair;
  - the traditional IV chord under "dear [name]" in Happy Birthday.
- **Melody references.** The melodies were compared note by note
  (`tools/tests/test_arrange.py`) with the LilyPond snippets in the English
  Wikipedia articles:
  - [Twinkle, Twinkle, Little Star](https://en.wikipedia.org/wiki/Twinkle,_Twinkle,_Little_Star)
  - [Frère Jacques](https://en.wikipedia.org/wiki/Fr%C3%A8re_Jacques)
  - [Happy Birthday to You](https://en.wikipedia.org/wiki/Happy_Birthday_to_You)
  - [Amazing Grace](https://en.wikipedia.org/wiki/Amazing_Grace)
  - [Scarborough Fair (ballad)](https://en.wikipedia.org/wiki/Scarborough_Fair_(ballad))

  Mary, Jingle Bells, Ode to Joy, Greensleeves and the Pachelbel lines are
  the standard versions, also pinned in the tests.
- **Arrangement choices:**
  - **Level-1 pieces:** C position in both hands (RH C4–A4, LH C3–G3), with
    whole-, half- and quarter-note accompaniments.
  - **Pachelbel:** augmented to half notes, so that the right hand's first
    violin lines keep their 3rds and 5ths against the ground bass.
  - **Ode to Joy:** bar 12 ends on the upper G instead of the low G, to stay
    in C position.

### Mutopia pieces (`tools/ly2musicxml.py` + `tools/lilypond/xmldump.ily`)

python-ly's `ly musicxml` exporter was evaluated first and rejected. It
re-implements LilyPond in Python and failed on the very first file: the
G-major minuet came out in 4/4 instead of 3/4, as a 4 KB file with an empty
second staff. Instead, LilyPond itself interprets the source:

1. Copy the source to `content/_build/<slug>/` and apply any catalogue
   patches.
2. Upgrade the syntax with LilyPond's `convert-ly` (the sources range from
   LilyPond 2.10 to 2.19).
3. Compile with LilyPond 2.24.3, installed from the official `lilypond`
   wheel on PyPI.
4. While compiling, `xmldump.ily` writes LilyPond's own interpretation as
   JSON lines. These are Scheme engravers that observe the result:
   - pitches with spelling, durations and tuplets, grace notes;
   - ties, including `\repeatTie`; slurs; beams with LilyPond's per-stem
     beaming;
   - accidentals as printed, explicit stem directions;
   - articulations and ornaments, fingerings with their placement,
     dynamics, hairpins, pedals, text;
   - clefs, keys, time signatures, bar lines, voltas, tempo marks and
     whether they are visible.
5. `ly2musicxml.py` writes partwise MusicXML 4.0 from that dump:
   - one part with two staves;
   - LilyPond voices packed into MusicXML voices 1–4 (upper staff) and 5–8
     (lower staff), with stems-up voices first;
   - `<backup>`/`<forward>` only between voices;
   - divisions taken from the least common multiple of all durations.

### Verification (`tools/validate.py`, `tools/xmlcheck.py`, `content/verification.json`)

| Check | Result |
|---|---|
| Notes vs LilyPond 2.24 MIDI of the same source (per staff, (onset, pitch) sets, repeats unfolded when the MIDI is) | **20/20 pieces exact** (10,335 notes) |
| Notes vs the MIDI Mutopia published from the original source | 19/20 exact. Moonlight: 475/476. In bar 9 a triplet E4 re-strikes while the melody voice holds the same E4, and LilyPond 2.10's MIDI writer dropped the overlapping re-attack. The score is identical. |
| MusicXML 4.0 XSD (W3C, `musicxml.xsd` v4.0) | 38/38 valid |
| Structure (1 part, 2 staves, key and time present, unique increasing measure numbers, no overlapping notes in a voice, no overfull bar, every note has a duration, pitches in A0–C8, no `<fingering>` in stripped files) | 38/38 pass |
| music21 10.5 parse (2 PartStaffs, no zero-length notes) | 38/38 pass |
| verovio 6.3 load and render of page 1 (`content/_preview/<slug>.svg`, gitignored) | 38/38 render |
| Visual review of the PNG previews against LilyPond's own engraving | all 30 pieces reviewed |
| pytest `content/tools/tests` (melodies, determinism, converter regression fixture, library consistency) | 95 passed |

Previews are not committed: the SVGs total about 6 MB (12 MB with PNGs) and `build.py --png`
regenerates them (and the whole library) in about a minute.

## Conversion decisions and caveats

- **Measure numbers.** Numbering is consecutive in MusicXML style:
  - a pickup bar is `0` with `implicit="yes"`;
  - a bar split by a mid-bar repeat sign becomes `n` plus `na` (implicit),
    which happens in the Wild Rider at 8/8a and 16/16a;
  - LilyPond 2.24 restarts bar numbers in each volta alternative, so in Für
    Elise and the Waltz the numbers differ from Mutopia's PDF after the
    first ending.
- **Partial bars kept as printed.** Für Elise's 1st ending (bar 8) and the
  repeat ends in the Wild Rider are shorter than a full bar. The validator
  reports them as warnings, not errors.
- **Voices.** LilyPond voices are packed per staff, stems-up first.
  - In Moonlight this puts the melody in voice 1, so verovio places its
    rests above the triplets.
  - K.545 has one LilyPond voice with overlapping notes; it is split into
    two MusicXML voices.
  - Cross-staff notes keep the staff they are engraved on (`<staff>` per
    note). Examples: the Entertainer's introduction and the arpeggio in
    Moonlight bar 5.
- **Entertainer repairs:**
  - Bar 69 uses a hidden note as a cross-voice tie kludge. It was turned
    into a real cross-voice tie, and the hidden duplicate removed.
  - The tie into the 2nd ending of the last strain was added, mirroring the
    1st ending and matching LilyPond's unfolded MIDI.
  - Two hairpins that start inside 1st endings are closed at the end of the
    ending instead of running into the 2nd ending.
- **Slurs.**
  - Numbered by MusicXML document order, so readers pair starts and stops
    unambiguously.
  - One slur that starts on a rest (Waltz, outside the excerpt) moves to
    the next note.
  - verovio does not draw a slur from a grace note to its main note (Chopin
    28/7, bar 15). The MusicXML is correct.
- **Fingerings as text.** Finger substitutions typeset as text ("5 - 4") are
  exported as `<fingering>` plus a `<fingering substitution="yes">`: 28 in
  Moonlight, 3 in Schumann No. 1. Text fingerings inside chords, which
  LilyPond itself drops, are recovered.
- **Fingerings written after a chord** go to the chord notes according to
  LilyPond's resolved placement: when placed above the chord they belong to
  the top notes, when below to the bottom notes.
- **Dynamics typeset as text** become `<dynamics>`: "pp" in Chopin 28/4, and
  the "p" of "p leggieremente" in Arabesque.
- **Tempo marks.**
  - Hidden marks keep only `<sound tempo>`: Für Elise ♩=72 and BWV 846 ♩=60.
  - Visible marks are exported with words plus a metronome: the Waltz's
    "Moderato ♩=152", and "Largo", "Andantino", "Spiritoso", "Not fast".
- **Source fixes, all recorded in `catalog.json`:**
  - Moonlight: a LilyPond 2.10 auto-beam command was replaced by
    `\overrideTimeSignatureSettings`, so the triplets beam per beat as in
    the original.
  - Moonlight: the typo "descresc." became "decresc.".
- **Keys.** Some sources declare only the signature, so the musical key
  comes from the catalogue, both in the manifest and in the MusicXML
  `<mode>`:
  - Wild Rider: `\key c \major` → A minor.
  - Moonlight: `\key e \major` → C# minor.
  - Gymnopédie: `\key b \minor` → D major. Its harmony is modal and it ends
    on a D minor chord, as stated in the notes.
- **LilyPond's PDF of K.545** logs "cyclic dependency" programming errors
  for two slur shapes. They are layout-only; the data are unaffected, and
  the MIDI matches exactly.

## Editorial fingering (`<slug>.fingered.musicxml`)

8 pieces have a copy with the source edition's fingerings, stored as
`<notations><technical><fingering>` on each note; finger substitutions use
`substitution="yes"`. The stripped `<slug>.musicxml` files contain no
fingering at all (checked). A copy is written only when the source has at
least 5 fingerings; Chopin 28/7 has a single one, so it gets none.

| Slug | Fingerings | Edition |
|---|---|---|
| `burgmuller-op100-no1-la-candeur` | 46 | Collection Litolff |
| `burgmuller-op100-no2-arabesque` | 26 | Collection Litolff |
| `burgmuller-op100-no3-pastorale` | 52 | Collection Litolff |
| `burgmuller-op100-no5-innocence` | 44 | Collection Litolff |
| `schumann-op68-no1-melody` | 30 | Peters |
| `mozart-sonata-k545-mvt1` | 378 | IMSLP scan (edition not named) |
| `beethoven-moonlight-sonata-mvt1` | 147 (bars 1–27) | Berners 1908, ed. Winterberger |
| `chopin-waltz-op69-no2` | 60 (bars 0–32) | Peters, ed. Scholtz |

For the app's "editor's fingering" comparison, the counts reconcile exactly
with the LilyPond source for complete pieces (for example 378/378 in
K.545).

## Considered and rejected

| Candidate | Why not |
|---|---|
| python-ly `ly musicxml` | Wrong metre, an empty staff and lost voices on the first test file (see above). |
| MIDI → notation (music21 reading the Mutopia MIDI) | Loses pitch spelling, voices, slurs and articulations. LilyPond already gives exact data. |
| music21 corpus `bach/bwv846.mxl`, `joplin/maple_leaf_rag.mxl` | Both are MuseScore.com user uploads (`musescore.com/score/117279`, `musescore.com/user/116681/scores/145724`) with no CC0/PD licence. The corpus licence file warns that individual encodings may be restricted. |
| music21 corpus `mozart/k545/movement1_exposition.mxl` | Only 12 bars, unstated licence. |
| music21 corpus `beach/prayer_of_a_tired_child` | A song (voice plus piano), CC BY-SA. |
| OpenScore ([github.com/OpenScore](https://github.com/OpenScore)) | Only the *Lieder* and *StringQuartets* repositories (CC0), no solo piano. OpenScore's piano editions live on MuseScore.com behind login-gated downloads. |
| Chopin Nocturne Op. 9 No. 2 (Mutopia 1590) | The brief allowed "Waltz Op. 69 No. 2 *or* Nocturne Op. 9 No. 2". The Nocturne's engraving is CC BY-SA 3.0 and fails in LilyPond 2.24 (`set-octavation`). The Waltz is public domain and converts cleanly. |
| Mutopia `PachelbelJ/CanonInD` | A single violin part (CC BY 3.0), not piano. We wrote our own simplified arrangement. |
| Mutopia `Traditional/greensleeves`, `GreensleevesAcc`, `amazing-mutopia` | An SATB hymn ("What Child Is This"), an accordion setting and bagpipes. We wrote our own arrangements. |
| Mutopia `BWVAnh114/Minuet-xpose`, `anna-magdalena-114-115-116` | Trumpet duet / violin and viola transcriptions. We used the keyboard engravings. |
| Mutopia `Chop-28-4a` (2007, Scholtz edition) | The newer `Chop-28-4` engraving (2016, Peters 1879) was chosen. Both are public domain. |
| Bartók, *Mikrokosmos* and others | Not public domain in the US until 2036 (brief). |
| MuseScore.com uploads in general | Not used (brief). |
| IMSLP | Not needed: the MIDI cross-check and the visual review replaced note proofreading. |

## Notes for the app

- `content/manifest.json` is an array sorted by level, using the schema in
  the brief plus `files.score`, `files.fingered` and extra `source` fields:
  `licenseUrl`, `mutopiaId`, `typesetter`, `edition`, `lilypondVersion`,
  `files`.
- Measure numbers are strings (`0`, `8a`); use the element order, not
  numeric parsing.
- The upper staff is always staff 1 and the lower staff staff 2, in a
  single part `P1`. Voices 1–4 belong to staff 1 and 5–8 to staff 2, but a
  voice can cross staves.
- verovio's PNG/SVG text glyphs for metronome marks use its embedded SMuFL
  text font. Browsers render it; some rasterizers (resvg) show boxes.
