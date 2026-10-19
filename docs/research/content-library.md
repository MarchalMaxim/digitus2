# Built-in content library

Sources, licences, conversion and checks for the curated core of the built-in
library: the first 30 pieces (levels 1–5; 38 MusicXML files, 30 scores plus 8
copies with the editor's fingering) and the 119 pieces of the L1 build (see
"L1 curated library"). Every file is valid MusicXML 4.0, and every converted
engraving was checked note by note against LilyPond's own MIDI. Regenerate with
`content/tools/build.py` (see `content/tools/README.md`).

The library has since grown to 3,224 pieces: 286 curated pieces (our
arrangements and Mutopia engravings, the first 149 of them documented here) and
2,938 scores from the MuseScore archive (PDMX), which admits only files
declared public domain or CC0. The later lanes, their selection rules and their
build steps are in `content/tools/README.md`. The manifest groups pieces into
grades 1–6; the app shows them as four levels (Easy 1–2, Medium 3, Harder 4,
Challenging 5–6). The levels in this file are the manifest's grades.

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

Every composition of the first 30 is in the public domain in the United
States (the latest composer died in 1925; the latest publication is 1902). They
contain no 20th-century copyrighted work, no Bartók and no MuseScore.com
upload.

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

All were downloaded from `https://www.mutopiaproject.org/ftp/<path>/`.
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

Rules for every curated piece:

- A score is accepted only under public domain, CC0, CC BY or CC BY-SA, as the
  Mutopia RDF states it. `build.py` refuses an unknown licence
  (`test_build_refuses_an_unknown_licence`). Public-domain engravings are
  preferred.
- Every CC BY and CC BY-SA engraving is credited with its typesetter, Mutopia
  id, licence and licence URL in three places: `manifest.json`
  (`source.typesetter`, `source.mutopiaId`, `source.license`,
  `source.licenseUrl`), the `<rights>` element of the score and of its
  `.fingered` copy, and the app (About page and score pages).
  `gates.py` and `test_every_cc_engraving_is_credited_in_rights` read the
  credit from `<rights>` itself.
- A share-alike engraving is adapted into MusicXML, so the file keeps the
  licence. Distributing such files next to the MIT-licensed app is aggregation
  and does not affect the code licence.
- A Mutopia piece whose edition is "Original work" (a modern composition
  licensed by its author) is credited as "Composition and engraving (c)", never
  as a public-domain composition (`build.rights_text`, `test_rights.py`).
- The Mutopia engravings of the library are public domain, CC BY 2.5 and 3.0,
  and CC BY-SA 2.5, 3.0 and 4.0. The MuseScore-archive scores are public
  domain or CC0 as their uploaders declared and PDMX checked.

The first 30 pieces:

- **Public-domain engravings (15 pieces).** The typesetters dedicated their
  engravings to the public domain. Our MusicXML conversions are released
  under CC0 1.0, and each file's `<rights>` element says so.
- **CC BY-SA engravings (5 pieces: Schumann Op. 68 Nos. 1 and 8, Moonlight,
  K.545, Invention No. 1).** No public-domain engraving of these exists on
  Mutopia.
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

Results for the first 30 pieces (38 files):

| Check | Result |
|---|---|
| Notes vs LilyPond 2.24 MIDI of the same source (per staff, (onset, pitch) sets, repeats unfolded when the MIDI is) | **20/20 pieces exact** (10,335 notes) |
| Notes vs the MIDI Mutopia published from the original source | 19/20 exact. Moonlight: 475/476. In bar 9 a triplet E4 re-strikes while the melody voice holds the same E4, and LilyPond 2.10's MIDI writer dropped the overlapping re-attack. The score is identical. |
| MusicXML 4.0 XSD (W3C, `musicxml.xsd` v4.0) | 38/38 valid |
| Structure (1 part, 2 staves, key and time present, unique increasing measure numbers, no overlapping notes in a voice, no overfull bar, every note has a duration, pitches in A0–C8, no `<fingering>` in stripped files) | 38/38 pass |
| music21 10.5 parse (2 PartStaffs, no zero-length notes) | 38/38 pass |
| verovio 6.3 load and render of page 1 (`content/_preview/<slug>.svg`, gitignored) | 38/38 render |
| pytest `content/tools/tests` (melodies, determinism, converter regression fixture, library consistency) | pass |

Each verovio preview was also compared by eye with LilyPond's own engraving of
the same source. Previews are not committed: `build.py --png` regenerates them.

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

Of the first 30 pieces, 8 have a copy with the source edition's fingerings, stored as
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
K.545). The L1 build added 25 more copies (1,967 fingerings; per-piece counts
in "Provenance of the new Mutopia engravings"), and the manifest's
`files.fingered` lists every copy.

## Considered and rejected

| Candidate | Why not |
|---|---|
| python-ly `ly musicxml` | Wrong metre, an empty staff and lost voices on the first test file (see above). |
| MIDI → notation (music21 reading the Mutopia MIDI) | Loses pitch spelling, voices, slurs and articulations. LilyPond already gives exact data. |
| music21 corpus `bach/bwv846.mxl`, `joplin/maple_leaf_rag.mxl` | Both are MuseScore.com user uploads (`musescore.com/score/117279`, `musescore.com/user/116681/scores/145724`) with no CC0/PD licence. The corpus licence file warns that individual encodings may be restricted. |
| music21 corpus `mozart/k545/movement1_exposition.mxl` | Only 12 bars, unstated licence. |
| music21 corpus `beach/prayer_of_a_tired_child` | A song (voice plus piano), CC BY-SA. |
| OpenScore ([github.com/OpenScore](https://github.com/OpenScore)) | Only the *Lieder* and *StringQuartets* repositories (CC0), no solo piano. OpenScore's piano editions live on MuseScore.com behind login-gated downloads. |
| Chopin Nocturne Op. 9 No. 2 (Mutopia 1590) | Its engraving is CC BY-SA 3.0 and fails in LilyPond 2.24 (`set-octavation`). The Waltz Op. 69 No. 2 is public domain and converts cleanly. |
| Mutopia `PachelbelJ/CanonInD` | A single violin part (CC BY 3.0), not piano. We wrote our own simplified arrangement. |
| Mutopia `Traditional/greensleeves`, `GreensleevesAcc`, `amazing-mutopia` | An SATB hymn ("What Child Is This"), an accordion setting and bagpipes. We wrote our own arrangements. |
| Mutopia `BWVAnh114/Minuet-xpose`, `anna-magdalena-114-115-116` | Trumpet duet / violin and viola transcriptions. We used the keyboard engravings. |
| Mutopia `Chop-28-4a` (2007, Scholtz edition) | The newer `Chop-28-4` engraving (2016, Peters 1879) was chosen. Both are public domain. |
| Bartók, *Mikrokosmos* and others | Not public domain in the US until 2036. |
| MuseScore.com uploads in general | Not used for the first 30: an upload's licence is the uploader's claim. The later MuseScore-archive lane admits only PDMX files declared public domain or CC0 without a licence conflict (`content/tools/README.md`). |
| IMSLP | Not needed: the MIDI cross-check and the visual review replaced note proofreading. |

## Notes for the app

- `content/manifest.json` is an array sorted by level, then collection, then
  catalogue position. Besides the common fields it has `files.score`,
  `files.fingered` and extra `source` fields: `licenseUrl`, `mutopiaId`,
  `typesetter`, `edition`, `lilypondVersion`, `files`.
- Measure numbers are strings (`0`, `8a`); use the element order, not
  numeric parsing.
- The upper staff is always staff 1 and the lower staff staff 2, in a
  single part `P1`. Voices 1–4 belong to staff 1 and 5–8 to staff 2, but a
  voice can cross staves.
- verovio's PNG/SVG text glyphs for metronome marks use its embedded SMuFL
  text font. Browsers render it; some rasterizers (resvg) show boxes.

## L1 curated library

The L1 build added 119 pieces to the first 30: 46 own arrangements and 73
Mutopia engravings. Together they are 149 pieces in 23 collections and 182
MusicXML files (149 scores plus 33 copies with the editor's fingering). The
first 30 are unchanged byte for byte, and the pipeline described above is the
one L1 used.

### At a glance

Pieces per level and source:

| Level | Core 30, own | Core 30, Mutopia | New, own | New, Mutopia | Total |
|---|---|---|---|---|---|
| 1 | 5 | 0 | 19 | 0 | 24 |
| 2 | 5 | 5 | 27 | 6 | 43 |
| 3 | 0 | 7 | 0 | 34 | 41 |
| 4 | 0 | 5 | 0 | 22 | 27 |
| 5 | 0 | 3 | 0 | 11 | 14 |
| All | 10 | 20 | 46 | 73 | 149 |

The library is weighted to beginners on purpose: the levels 1–3 together hold
more pieces than the levels 4–6 (`test_level_counts_are_weighted_to_beginners`).
Levels 1 and 2 rest mostly on our own arrangements (24 of 24 and 32 of 43
pieces).

Licences of the pieces and files:

| Licence of the MusicXML file | Pieces | Core 30 | New | Files |
|---|---|---|---|---|
| Public domain (Mutopia engraving) | 68 | 15 | 53 | 93 |
| CC0 1.0 (own arrangements) | 56 | 10 | 46 | 56 |
| CC BY-SA 2.5 | 12 | 3 | 9 | 15 |
| CC BY-SA 3.0 | 10 | 2 | 8 | 14 |
| CC BY 3.0 | 2 | 0 | 2 | 3 |
| CC BY 2.5 | 1 | 0 | 1 | 1 |
| All | 149 | 30 | 119 | 182 |

Every CC BY and CC BY-SA engraving is credited as described in "Licensing
notes".

The 23 collections are either a genre or a published set. Genres: Children's
songs, Folk songs, Christmas carols and songs, Hymns and spirituals, National
anthems, Songs before 1929, Ragtime (simplified and original), Classical themes
(simplified), Minuets, dances and rondos, Sonatinas and sonatas, Romantic
character pieces. Sets: Notebook for Anna Magdalena Bach (1725), Handel
Aylesford Pieces, Bach Little Preludes, Swedish folk dances (1814), Burgmüller
Op. 100, Schumann Op. 68 (Album for the Young) and Op. 15 (Scenes from
Childhood), Tchaikovsky Op. 39 (Album for the Young), Bach Inventions
BWV 772–786, Bach Well-Tempered Clavier, Chopin Preludes Op. 28. Inside a level
the manifest follows the collection order, so "Start here" is still Twinkle
(`test_twinkle_is_the_first_level_one_piece`).

### Selection

Rules for the L1 pieces:

| Rule | As applied |
|---|---|
| Instrument | Solo keyboard engravings only: the mirror's 659 solo-keyboard piece directories out of 832, after duets, voice and other instruments are removed. The arrangements are two-staff piano scores. |
| Length | At most 255 s with repeats at the catalogue tempo (`approxDurationSec`), and at most 6 pages of Mutopia's A4 PDF. A longer piece is cut at a section end or dropped. |
| Size | A new score is at most 700 KB (`tests/test_gates.py`). |
| Gates | A piece with a span-flagged slice or a lint law error is cut to a section that ends on the tonic before the first offending bar, if that keeps at least 16 bars and a musical whole. Otherwise it is dropped. No new piece ships with a flag. |
| Engraving licence | Public domain, CC BY or CC BY-SA only, as the fetched RDF states. `build.py` refuses an unknown licence (`test_build_refuses_an_unknown_licence`). Public-domain engravings are preferred, and every CC engraving is credited. |
| Melody (arrangements) | The melody is traditional, or else every author of the melody died in 1955 or earlier (EU: life plus 70 years) and the melody was first published in 1928 or earlier (US). Lyrics are never printed. Checked from the catalog by `test_new_arrangements_are_public_domain_in_the_us_and_the_eu`. |
| Melody reference (arrangements) | Each tune has a dated, notated source whose pitches are typed in as MIDI numbers. The built score must reproduce those pitches exactly, or their intervals when transposed (`test_built_melody_equals_the_reference`). A tune with no reachable source, or whose sources disagree, is not arranged. |

Popular songs from before 1929 that the EU half of the melody rule excludes.
Tunes go by their traditional title where a modern text is protected:
Londonderry Air, not Danny Boy. Korobeiniki is the folk song, not the 1989
video-game arrangement. Simple Gifts is the 1848 Shaker tune, not Copland's 1944
setting.

| Song | Author who died after 1955 |
|---|---|
| Take Me Out to the Ball Game | Albert Von Tilzer, died 1956 |
| Shine On, Harvest Moon | Jack Norworth, died 1959 |
| Alexander's Ragtime Band | Irving Berlin, died 1989 |
| Hello! Ma Baby | Joseph E. Howard, died 1961 |
| K-K-K-Katy | Geoffrey O'Hara, died 1967 |
| Cielito Lindo | Quirino Mendoza, died 1957 |
| Kookaburra | Marion Sinclair, died 1988 |

**Mutopia enumeration and fetch.**

- **Enumeration.** The Mutopia candidates were enumerated from the pinned
  mirror `research/data/mutopia_src/ftp`
  ([MutopiaProject/MutopiaProject](https://github.com/MutopiaProject/MutopiaProject)
  at commit `2144afd6`, 2024-11-07): 832 piece directories, 659 of them solo
  keyboard. 76 main candidates and 21 spares were picked. They are the 97 rows
  of `content/tools/candidates.json`, in 96 directories: the two Clementi
  movements share one directory, the core first movement's.
- **Fetch.** `fetch_mutopia.py --candidates content/tools/candidates.json`
  downloads from `https://www.mutopiaproject.org/ftp/<ftpDir>/`.
  `fetch_log.json` lists every directory with the SHA-256 of every file.
- **RDF licences of the 97 candidates.** Every one matches the licence in
  the mirror's header, and none is outside the allowed set, so no candidate
  was excluded for its licence:

  | RDF licence | Candidates |
  |---|---|
  | Public Domain | 72 |
  | Creative Commons Attribution-ShareAlike 2.5 | 12 |
  | Creative Commons Attribution-ShareAlike 3.0 | 9 |
  | Creative Commons Attribution 2.5 | 2 |
  | Creative Commons Attribution-ShareAlike 4.0 | 2 |

- **Mirror match.** For 92 candidates, the fetched main `.ly` is byte-identical
  to the mirror's copy. For 5, the live site's source differs from the
  mirror's: `bach-polonaise-g-minor-bwv-anh-119` and
  `bach-prelude-d-minor-bwv-926` shipped, and their `sourceSha256` pins the
  fetched version; `chopin-prelude-op28-no20`, `gobbaerts-les-etoiles-d-or-no1`
  and `debussy-clair-de-lune` did not.

Three engravings are excerpts, each ending on the tonic at a section end:

- `wanhal-rondo-op42-no1`: bars 1–24 of 56, the theme up to the Fine. The
  converter cannot play a da capo, so the whole score would end in F major.
- `mozart-sonata-k545-mvt2`: bars 1–32 of 74, the theme section. The whole
  movement runs 5:18 with repeats, over the length limit.
- `beethoven-sonata-op13-mvt2`: bars 1–16 of 73, the theme and its
  restatement.

`andre-sonatina-op34-mvt1` is the complete first movement: a pre-stage patch
and `barTo 24` cut the Rondo out of the shared file. Several arrangements keep
one section of a song, for example the verse of Camptown Races, the chorus of
Daisy Bell and the A strain of The Entertainer. Each reference `note` names
the section kept.

### Levelling

`content/tools/level.py` proposes a level from the MusicXML at the catalogue
tempo. The weights were fixed in advance; only the four cut points are fitted.

```
score = 0.35 min(nps, 12) + 0.06 shifts + 0.12 max(0, span - 7) + 2.0 chord + 0.25 fifths
        + 0.05 accidentals + 0.3 min(seconds, 240) / 60 + 0.05 leaps
level = 1 + number of CUTS below the score,  CUTS = (1.76, 4.09, 9.11, 12.68)
```

| Feature | Measures |
|---|---|
| `nps` | Sounding notes per second at the catalogue tempo, both hands |
| `shifts` | Position shifts per 100 onsets, mean of the two hands. A hand keeps a window of at most 7 semitones; a slice that would widen it opens a new window. |
| `span` | Widest slice one hand strikes, in semitones |
| `chord` | Share of a hand's onsets that strike two or more keys, the larger hand |
| `fifths` | Sharps or flats in the first key signature |
| `accidentals` | Percent of notes outside the major scale of the first key signature |
| `seconds` | Written length without repeats, at the catalogue tempo |
| `leaps` | Leaps per 100 onsets: consecutive slice centres more than an octave apart, the larger hand |

Calibration on the 30 labelled pieces, recomputed from the scores recorded in
`verification.json`:

| Measure | Result | Pinned by |
|---|---|---|
| In-sample, with `CUTS` | 30 of 30 within one level, 19 exact | `test_reproduces_the_labelled_levels_within_one` (at least 27) |
| Leave-one-out (cut points refitted without the piece) | 27 of 30 within one level, 14 exact | `test_leave_one_out_generalises` (at least 25) |
| `calibrate()` on the 30 | (1.762, 4.091, 9.111, 12.6835), frozen as `CUTS` | `test_frozen_cuts_are_the_fit` |
| Final level against the proposal, core 30 | 19 equal, 5 one above, 6 one below | |

The fit is exhaustive: it tries the midpoints between the sorted scores and
keeps the cut points with the most pieces within one level, then the most
exact, then the least absolute error. Two biases are known and stay within
one level on the 30:

- **Counterpoint is underrated.** Invention No. 1 is proposed at 3 and
  catalogued at 4.
- **Held left-hand chords are overrated.** The Amazing Grace and
  Greensleeves arrangements are proposed at 3 and catalogued at 2.

**The final level.** The heuristic only advises. The final level is set by
hand, and its one-line `levelNote` (in `content/tools/catalog.json` and
`catalog.d/`) gives a syllabus placement and the proposal. A final level more
than one away from the proposal needs a `levelOverride` reason. `gates.py`
writes `levelProposal` into `verification.json`, and
`test_new_piece_passes_every_gate` asserts the rule.

Syllabus anchors:

| Anchor | Mapping to our levels | Used for |
|---|---|---|
| [Henle levels of difficulty](https://www.henle.de/Levels-of-Difficulty/) (1 to 9) | Henle 1 ≈ our 2, 2 ≈ 3, 3 ≈ 4, 4 ≈ 5 | the general mapping |
| Henle per-piece levels: [HN 1726](https://www.henle.de/en/25-Etudes-op.-100/HN-1726) Burgmüller Op. 100, [HN 45](https://www.henle.de/en/Album-for-the-Young-op.-68/HN-45) Schumann Op. 68, [HN 46](https://henle.de/Scenes-from-Childhood-op.-15-and-Album-for-the-Young-op.-68/HN-46) Op. 15, [HN 106](https://www.henle.de/Little-Preludes-and-Fughettas/HN-106) Little Preludes, [HN 1591](https://www.henle.de/Two-Part-Inventions/HN-1591) Inventions, [HN 883](https://www.henle.de/en/Preludes/HN-883) Chopin Op. 28 | as above, but calibrated per set on its core members (below) | the sets named |
| Henle per-volume levels: [HN 848](https://www.henle.de/Six-Piano-Sonatinas-op.-36/HN-848) Clementi Op. 36, [HN 1391](https://www.henle.de/en/Five-Easy-Piano-Sonatas/HN-1391) Beethoven Op. 49, [HN 1392](https://www.henle.de/en/Five-Famous-Piano-Sonatas/HN-1392) Op. 13, [HN 1300](https://www.henle.de/en/Piano-Sonata-A-major-K.-331-Alla-Turca/HN-1300) K. 331, [HN 375](https://www.henle.de/en/Moments-musicaux-op.-94-D-780/HN-375) Schubert D. 780, [HN 1669](https://www.henle.de/cn/Piano-works-Volume-III-Songs-without-Words/HN-1669) Mendelssohn | as above | sonatinas, sonatas, Schubert, Mendelssohn |
| [RCM Piano Syllabus 2022](https://teacherportal.rcmusic.com/getattachment/57f3734d-97e5-4777-b67e-4b1111ee31a3/piano-syllabus-2022-edition.pdf) | RCM 1–2 ≈ our 2, 3–5 ≈ 3, 6–7 ≈ 4, 8–9 ≈ 5 | Notebook pieces, André, Little Preludes, Inventions |
| [ABRSM](https://www.abrsm.org/en-gb/exams/piano-exams) lists, 2023–2024 ([summary](https://www.online-academy.informance.biz/courses/10-a-guide-to-the-abrsm-syllabus-2023-2024-intermediate/132)) | grades 1–2 ≈ our 2, 2–4 ≈ 3, 5–6 ≈ 4, 6–7 ≈ 5 (the level comment in `catalog.json`) | Kuhlau Op. 20 No. 1, K. 331, Schubert D. 780 No. 3 |
| The collection's own order | Burgmüller's progressive order; Schumann's split of Op. 68 into "Für Kleinere" (Nos. 1–18) and "Für Erwachsenere"; Tchaikovsky's Op. 39, written for children; Clementi's numbering | the sets |
| None published | the `levelNote` says so; the level rules of the arrangements (see "The new arrangements") and the heuristic decide | all 46 arrangements, and the engravings whose `levelNote` says no placement was found |

The general Henle mapping disagrees with how the core 30 are levelled in some
sets, so the new pieces were calibrated on the core members of each set:

- **Burgmüller.** Henle rates the core Nos. 2, 3 and 5 at 1, and we have
  them at 3.
- **Schumann Op. 68.** Henle rates No. 1 at 2 (ours: 2) and No. 8 at 3
  (ours: 3).
- **Chopin.** Henle rates Op. 28 Nos. 4 and 7 at 4, and we have them at 4.

One inconsistency is left open. The RCM places BWV Anh. 114 and 115 (core, our
level 2) and the new BWV Anh. 119 and 126 (our level 3) at the same RCM
Level 3.

Final level against the proposal for the 119 new pieces (rows: final level;
columns: proposal):

| Final \ proposal | 1 | 2 | 3 | 4 | 5 | Pieces |
|---|---|---|---|---|---|---|
| 1 | 15 | 4 |  |  |  | 19 |
| 2 |  | 7 | 26 |  |  | 33 |
| 3 |  | 7 | 27 |  |  | 34 |
| 4 |  |  | 19 | 3 |  | 22 |
| 5 |  |  | 7 | 1 | 3 | 11 |

- **Equal:** 55.
- **One below the proposal:** 30. Of these, 23 are level-2 arrangements
  whose held left-hand fifths and triads the heuristic overrates.
- **One above:** 27. Twelve are Baroque pieces with ornaments and two voices,
  which the heuristic underrates. Fifteen are Classical and Romantic pieces
  that Henle, the RCM or ABRSM place higher than their note density
  suggests.
- **Two above, each with a `levelOverride`:** 7.

The seven `levelOverride` reasons:

- `mozart-sonata-k331-mvt3-rondo-alla-turca` (proposed 3, final 5): Henle rates
  the sonata 6 and ABRSM sets it at Grade 8 (HN 1300). Note density is measured
  at the moderate default tempo, and the heuristic has no feature for the
  right hand's octaves and broken octaves in the A major refrain.
- `beethoven-sonata-op13-mvt2` (3, 5): the Adagio is slow (5 notes per second),
  but Henle rates the sonata 7 (HN 1392), and in bars 1-8 the right hand sings
  the melody over its own semiquaver accompaniment, voicing the heuristic does
  not measure. The core Moonlight opening is level 5 for the same reason.
- `bach-invention-no10-bwv-781`, `-no13-bwv-784`, `-no14-bwv-785` and
  `-no15-bwv-786` (3, 5): counterpoint. The heuristic underrates two-part
  inventions (it proposes 3 for the core Invention No. 1, catalogued 4), and
  Henle level 4 'medium' (HN 1591) and RCM 2022 Level 8 both place these a step
  above Nos. 1 and 4.
- `mendelssohn-op30-no6-venetian-boat-song` (3, 5): Henle rates it 5 of 9
  (HN 1669), the Henle level of Schubert's D. 780 No. 3, which the heuristic
  does propose at 5. At the moderate quarter = 84 its note density is low, but
  the right hand voices a cantabile melody above its own accompaniment
  throughout.

### Provenance of the new Mutopia engravings

All 73 were downloaded from `https://www.mutopiaproject.org/ftp/<ftpDir>/` by
`fetch_mutopia.py`, which never executes what it downloads. Per candidate,
`content/tools/candidates.json` records the fetched RDF facts (`rdfLicense`,
`lyFile`, `maintainer`, `lilypondVersion`), the published MIDI files, the A4
PDF page count, `mainSha256` and `mirrorMatch`. Each catalog entry pins
`sourceSha256` and `retrievedAt`.

Every new engraving was checked against two MIDI files:

- **LilyPond 2.24's MIDI of the same upgraded and patched source.** This one
  must be exact; it is exact for all 73 (36,436 notes; 61 compared as written,
  8 with repeats unfolded, 4 as excerpts).
- **The MIDI that Mutopia published from the original source.** Exact for 67.
  The 6 differences below are accepted: only this check may differ, and only
  with a written reason in the piece's `notes`.

| Slug | Published MIDI | Reason |
|---|---|---|
| `bach-minuet-a-minor-bwv-anh-120` | 75/165 | The source pads the half-bars 12 and 28 with spacer rests. Catalog patches remove them, because they made LilyPond 2.24 insert a beat and the converter drop the final repeat. The Mutopia MIDI (LilyPond 2.12) keeps the spacer beat: shifted back by one quarter, its remaining 90 notes equal the score. |
| `bach-march-e-flat-major-bwv-anh-127` | 189/357 | The same padding at bars 10 and 29. Shifted by one quarter, the 168 notes equal the score. |
| `burgmuller-op100-no14-la-styrienne` | 0/310 | The opening grace notes shift LilyPond's whole MIDI timeline by 43/384 of a quarter. Two patches render the LilyPond 2.24 MIDI without them. The MusicXML is byte-identical with and without the patches, and the published MIDI keeps the constant shift. |
| `swedish-polska-norrbotten` | 422/422, plus 2 MIDI-only | The two extra notes are the second-pass D5 grace notes. `xmlcheck` counts a grace note once even in an unfolded comparison. |
| `bach-prelude-d-minor-bwv-940` | 168/169 | In bar 5, an E4 re-strikes while another voice holds the same E4. The old MIDI writer (LilyPond 2.11) dropped the re-attack, the same case as Moonlight in the first 30. |
| `schumann-op15-no1-of-foreign-lands` | 222/224 | The same case: two left-hand G3 re-strikes in bars 6 and 20, missing from the 2006 MIDI (LilyPond 2.6). |

"Ed. fing." counts the `<fingering>` elements in the `.fingered` copy.

| Slug | Mutopia piece | Typesetter | Edition engraved from | Engraving licence | Ed. fing. |
|---|---|---|---|---|---|
| `bach-polonaise-f-major-bwv-anh-117a` | [Mutopia-2007/07/26-1013](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1013) | Steven McDougall | Bach-Gesellschaft Ausgabe 1851-1899 Band 43 (1894) | Public Domain | - |
| `handel-aylesford-minuet-d-minor` | [Mutopia-2013/02/21-157](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=157) | Bas Wassink | Edition Schott 1930 | Public Domain | - |
| `schumann-op68-no3-humming-song` | [Mutopia-2011/09/18-651](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=651) | Philippe Hézaine | Peters | CC BY-SA 3.0 | 43 |
| `schumann-op68-no5-little-piece` | [Mutopia-2007/02/11-653](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=653) | Philippe Hézaine | Peters | CC BY-SA 2.5 | 31 |
| `schumann-op68-no2-soldiers-march` | [Mutopia-2007/02/11-650](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=650) | Philippe Hézaine | Peters | CC BY-SA 2.5 | - |
| `behr-in-may` | [Mutopia-2016/12/07-2155](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2155) | John Mamoun | Thiebes-Stierlin Music Co. c.1903 | Public Domain | - |
| `bach-minuet-f-major-bwv-anh-113` | [Mutopia-2013/01/06-74](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=74) | Allen Garvin | Bach-Gesellschaft | Public Domain | - |
| `bach-minuet-g-major-bwv-anh-116` | [Mutopia-2013/01/06-77](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=77) | Allen Garvin | Bach-Gesellschaft | Public Domain | - |
| `bach-minuet-a-minor-bwv-anh-120` | [Mutopia-2009/01/06-1612](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1612) | Steven McDougall | Bach-Gesellschaft Ausgabe 1851-1899 Band 43 (1894) | Public Domain | - |
| `bach-minuet-c-minor-bwv-anh-121` | [Mutopia-2011/06/15-1613](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1613) | Steven McDougall | Bach-Gesellschaft Ausgabe 1851-1899 Band 43 (1894) | Public Domain | - |
| `bach-musette-d-major-bwv-anh-126` | [Mutopia-2013/01/06-79](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=79) | Allen Garvin | Bach-Gesellschaft | Public Domain | - |
| `bach-polonaise-g-minor-bwv-anh-119` | [Mutopia-2007/07/30-1016](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1016) | Steven McDougall | Bach-Gesellschaft Ausgabe 1851-1899 Band 43 (1894) | Public Domain | - |
| `bach-polonaise-d-minor-bwv-anh-128` | [Mutopia-2009/01/06-1615](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1615) | Steven McDougall | Bach-Gesellschaft Ausgabe 1851-1899 Band 43 (1894) | Public Domain | - |
| `bach-prelude-c-major-bwv-924` | [Mutopia-2007/05/20-978](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=978) | JD Erickson | Bach-Gesellschaft, 1853 | CC BY-SA 3.0 | - |
| `bach-prelude-c-major-bwv-939` | [Mutopia-2008/11/06-1593](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1593) | Hajo Dezelski | Bach-Gesellschaft Edition Band 36 / Ernst Naumann 1890 | CC BY-SA 3.0 | - |
| `bach-applicatio-c-major-bwv-994` | [Mutopia-2007/04/22-66](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=66) | Allen Garvin | Bach-Gesellschaft | Public Domain | - |
| `wanhal-rondo-op42-no1` | [Mutopia-2013/01/13-192](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=192) | Bas Wassink | Unknown, late 19th Century | Public Domain | - |
| `swedish-polska-norrbotten` | [Mutopia-2006/12/01-815](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=815) | Erik Sjölund | Traditioner af Swenska Folk-Dansar, 1st part, 1814 | CC BY 2.5 | - |
| `burgmuller-op100-no4-la-petite-reunion` | [Mutopia-2013/01/12-219](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=219) | Bas Wassink | Collection Litolff, 19th Century | Public Domain | 86 |
| `burgmuller-op100-no6-progres` | [Mutopia-2013/01/12-215](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=215) | Bas Wassink | Collection Litolff, 19th Century | Public Domain | 87 |
| `burgmuller-op100-no7-le-courant-limpide` | [Mutopia-2013/01/12-216](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=216) | Bas Wassink | Collection Litolff, 19th Century | Public Domain | 30 |
| `burgmuller-op100-no8-la-gracieuse` | [Mutopia-2013/01/12-217](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=217) | Bas Wassink | Collection Litolff, 19th Century | Public Domain | 44 |
| `burgmuller-op100-no9-la-chasse` | [Mutopia-2013/01/12-220](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=220) | Bas Wassink | Collection Litolff, 19th Century | Public Domain | 87 |
| `burgmuller-op100-no10-tendre-fleur` | [Mutopia-2013/01/12-221](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=221) | Bas Wassink | Collection Litolff, 19th Century | Public Domain | 66 |
| `burgmuller-op100-no11-la-bergeronnette` | [Mutopia-2013/01/12-222](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=222) | Bas Wassink | Collection Litolff, 19th Century | Public Domain | 48 |
| `burgmuller-op100-no12-l-adieu` | [Mutopia-2013/01/12-223](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=223) | Bas Wassink | Collection Litolff, 19th Century | Public Domain | 97 |
| `burgmuller-op100-no13-consolation` | [Mutopia-2013/01/12-224](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=224) | Bas Wassink | Collection Litolff, 19th Century | Public Domain | 55 |
| `burgmuller-op100-no14-la-styrienne` | [Mutopia-2013/01/12-225](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=225) | Bas Wassink | Collection Litolff, 19th Century | Public Domain | 47 |
| `burgmuller-op100-no16-douce-plainte` | [Mutopia-2013/01/12-228](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=228) | Bas Wassink | Collection Litolff, 19th Century | Public Domain | 70 |
| `burgmuller-op100-no17-la-babillarde` | [Mutopia-2013/01/12-229](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=229) | Bas Wassink | Collection Litolff, 19th Century | Public Domain | 106 |
| `schumann-op68-no6-poor-orphan` | [Mutopia-2007/02/11-687](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=687) | Philippe Hézaine | Peters | CC BY-SA 2.5 | - |
| `schumann-op68-no9-little-folk-song` | [Mutopia-2007/02/11-675](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=675) | Philippe Hézaine | Peters | CC BY-SA 2.5 | - |
| `schumann-op68-no10-the-happy-farmer` | [Mutopia-2007/02/11-659](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=659) | Philippe Hézaine | Peters | CC BY-SA 2.5 | - |
| `schumann-op68-no14-little-study` | [Mutopia-2007/02/11-786](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=786) | Philippe Hézaine | Peters | CC BY-SA 2.5 | - |
| `tchaikovsky-op39-no1-morning-prayer` | [Mutopia-2015/07/09-2032](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2032) | Rem Zolotykh | Schirmer, 1904 | Public Domain | 91 |
| `tchaikovsky-op39-no16-old-french-song` | [Mutopia-2015/11/27-2080](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2080) | David McNamara | Schirmer, 1904 | Public Domain | - |
| `andre-sonatina-op34-mvt1` | [Mutopia-2013/01/06-207](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=207) | Bas Wassink | Unknown, late 19th Century | Public Domain | - |
| `clementi-sonatina-op36-no1-mvt2` | [Mutopia-2016/11/30-804](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=804) | Brian D. Rude | Sonatina Album, G. Schirmer, Inc. Copyright 1893 | Public Domain | - |
| `clementi-sonatina-op36-no1-mvt3` | [Mutopia-2016/11/30-804](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=804) | Brian D. Rude | Sonatina Album, G. Schirmer, Inc. Copyright 1893 | Public Domain | - |
| `kuhlau-sonatina-op20-no1-mvt2` | [Mutopia-2013/02/21-233](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=233) | Bas Wassink | B. Schott's Söhnen, 19th Century | Public Domain | - |
| `bach-march-e-flat-major-bwv-anh-127` | [Mutopia-2009/01/06-1614](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1614) | Steven McDougall | Bach-Gesellschaft Ausgabe 1851-1899 Band 43 (1894) | Public Domain | - |
| `bach-prelude-d-minor-bwv-926` | [Mutopia-2009/02/22-69](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=69) | Allen Garvin | Bach-Gesellschaft | Public Domain | - |
| `bach-prelude-c-major-bwv-933` | [Mutopia-2008/09/28-1537](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1537) | Hajo Dezelski | Bach-Gesellschaft Edition Band 36 / Ernst Naumann 1890 | CC BY-SA 3.0 | - |
| `bach-prelude-d-minor-bwv-940` | [Mutopia-2008/11/13-1594](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1594) | Hajo Dezelski | Bach-Gesellschaft Edition Band 36 / Ernst Naumann 1890 | CC BY-SA 3.0 | - |
| `bach-prelude-e-minor-bwv-941` | [Mutopia-2008/11/13-1595](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1595) | Hajo Dezelski | Bach-Gesellschaft Edition Band 36 / Ernst Naumann 1890 | CC BY-SA 3.0 | - |
| `burgmuller-op100-no15-ballade` | [Mutopia-2013/01/12-227](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=227) | Bas Wassink | Collection Litolff, 19th Century | Public Domain | 63 |
| `burgmuller-op100-no18-inquietude` | [Mutopia-2013/01/12-230](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=230) | Bas Wassink | Collection Litolff, 19th Century | Public Domain | 38 |
| `schumann-op68-no16-first-loss` | [Mutopia-2007/02/11-676](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=676) | Philippe Hézaine | Peters | CC BY-SA 2.5 | - |
| `schumann-op68-no12-knecht-ruprecht` | [Mutopia-2007/02/11-784](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=784) | Philippe Hézaine | Peters | CC BY-SA 2.5 | - |
| `schumann-op68-no25-echoes-from-the-theatre` | [Mutopia-2007/02/11-787](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=787) | Philippe Hézaine | Peters | CC BY-SA 2.5 | - |
| `tchaikovsky-op39-no5-march-of-the-wooden-soldiers` | [Mutopia-2015/01/17-1806](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1806) | Anonymous | Schirmer, 1904 | Public Domain | - |
| `kuhlau-sonatina-op20-no1-mvt1` | [Mutopia-2013/02/21-232](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=232) | Bas Wassink | B. Schott's Söhnen, 19th Century | Public Domain | 58 |
| `kuhlau-sonatina-op20-no1-mvt3` | [Mutopia-2013/02/21-234](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=234) | Bas Wassink | B. Schott's Söhnen, 19th Century | Public Domain | 14 |
| `mozart-sonata-k545-mvt2` | [Mutopia-2007/07/22-1007](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1007) | Alejandro Sierra | IMSLP | CC BY-SA 3.0 | 124 |
| `mozart-sonata-k545-mvt3` | [Mutopia-2007/08/22-1027](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1027) | Alejandro Sierra | IMSLP | CC BY-SA 3.0 | 285 |
| `beethoven-sonata-op49-no2-mvt2` | [Mutopia-2006/06/05-777](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=777) | Stelios Samelis | Breitkopf & Hartel (1862-1865) | Public Domain | - |
| `beethoven-sonata-op49-no1-mvt1` | [Mutopia-2017/07/06-912](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=912) | Stelios Samelis | Breitkopf & Hartel (1862-1865) | Public Domain | - |
| `bach-invention-no4-bwv-775` | [Mutopia-2008/06/15-67](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=67) | Allen Garvin | Bach-Gesellschaft | Public Domain | - |
| `bach-invention-no8-bwv-779` | [Mutopia-2008/06/15-61](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=61) | Allen Garvin | Bach-Gesellschaft | Public Domain | - |
| `schumann-op15-no1-of-foreign-lands` | [Mutopia-2006/01/01-354](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=354) | Ying-Chun Liu | Leichte Stucke, 1900 | Public Domain | 88 |
| `schumann-op15-no2-a-curious-story` | [Mutopia-2013/01/05-355](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=355) | Ying-Chun Liu | Leichte Stucke, 1900 | CC BY 3.0 | - |
| `chopin-prelude-op28-no6` | [Mutopia-2015/01/17-469](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=469) | Magnus Lewis-Smith | Edition Peters | Public Domain | - |
| `mozart-sonata-k331-mvt3-rondo-alla-turca` | [Mutopia-2015/08/13-108](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=108) | Rune Zedeler and Chris Sawer | IMSLP | Public Domain | 136 |
| `beethoven-sonata-op13-mvt2` | [Mutopia-2011/10/25-295](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=295) | Chris Sawer | Berners, 1908 (edited by A. Winterberger); Peters, 1910 | Public Domain | 75 |
| `bach-invention-no10-bwv-781` | [Mutopia-2008/06/15-62](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=62) | Allen Garvin | Bach-Gesellschaft | Public Domain | - |
| `bach-invention-no13-bwv-784` | [Mutopia-2008/06/15-59](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=59) | Allen Garvin | Bach-Gesellschaft | Public Domain | - |
| `bach-invention-no14-bwv-785` | [Mutopia-2008/06/15-72](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=72) | Allen Garvin | Bach-Gesellschaft | Public Domain | - |
| `bach-invention-no15-bwv-786` | [Mutopia-2008/08/23-68](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=68) | Allen Garvin | Bach-Gesellschaft | Public Domain | - |
| `schumann-op15-no6-an-important-event` | [Mutopia-2013/01/05-374](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=374) | Ying-Chun Liu | Leichte Stucke, 1900 | CC BY 3.0 | 98 |
| `schubert-moment-musical-d780-no3` | [Mutopia-2007/08/11-1023](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1023) | Claude Chaudron | Sauer & Leidersdorf, Wien, 1827 | Public Domain | - |
| `mendelssohn-op30-no6-venetian-boat-song` | [Mutopia-2010/02/03-1741](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1741) | Ryan Prince | Breitkopf & Härtel, 1874-1877 | Public Domain | - |
| `joplin-elite-syncopations` | [Mutopia-2008/09/19-1540](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1540) | Benjamin Bloomfield | John Stark & Son | Public Domain | - |
| `joplin-sun-flower-slow-drag` | [Mutopia-2013/03/03-465](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=465) | Daniel Škarda | Reproduction of original edition (1901) | Public Domain | - |

**Catalog patches.** A patch is a regular-expression edit of the downloaded
source in the build directory; the download itself is never edited. At most two
patches per piece. The patches and their reasons are in the `convert` field of the entries in
`content/tools/catalog.json` and `catalog.d/`. They fall into a
few kinds:

- spacer rests that pad half-bars, which made LilyPond 2.24 insert a beat;
- `\repeat volta 1`, which LilyPond 2.24 no longer prints, and which made a
  volta 2;
- LilyPond 2.10 text spanners ("cresc.", "dimin.") that the converter would
  print as plain text, and tempo words in a markup, moved into a hidden
  `\tempo`;
- ornament commands the converter cannot map (`\upmordent`, `\downmordent`,
  glyph-markup turns) and a hidden playback `mp` it would print;
- a `\bar "||"` or `\bar "|."` that hid a repeat sign, and tuplet brackets
  hidden through the stencil;
- excerpts and movement selection through `barTo` and `score`.

**Editorial fingering.** 25 new `.fingered` copies carry 1,967 fingerings, on
top of the 8 core copies. The counts are the exported ones; an excerpt counts
only the bars kept (K. 545 mvt 2: 124 for bars 1–32; Op. 13 mvt 2: 75 for bars
1–16).

**Tempos.**

- **Arrangements:** 33 use an editorial tempo and 11 the tempo of their
  reference score.
- **Engravings:** 13 have an editorial tempo. The other 60 use the source's
  `\midi` block, a hidden `\tempo` or a printed mark.

Each `tempoSource` in the catalog says which.

### The new arrangements

The 46 arrangements are written in `arrange.py`'s note language in
`content/tools/arrangements/` (`children.py`, `christmas.py`, `hymns.py`,
`folk.py`, `songs.py`). Each tune has a reference melody (`REFERENCES`), and
`tests/test_arrangements.py` holds the level rules:

- **Level 1:** the right hand stays in one five-finger position with at most
  one extension, at most 10 semitones. The left hand plays single notes or
  open fifths within 7 semitones. Keys have at most one sharp or flat, the
  tempo is at most 120, and a piece has at most 32 bars.
- **Level 2:** the right hand may move, up to 19 semitones. The left hand
  plays simple triads within a ninth, broken fifths or a waltz bass. Keys
  have up to two sharps or flats.
- **Both levels:** no clash between the left hand and the melody on a strong
  beat (a second, tritone or seventh) unless `allowedClashes` gives the
  reason (`test_no_strong_beat_clashes`).

The reference column links the notated source the melody was checked
against, retrieved in October 2026 (the dates are in the catalog). The
retrieved page text or image is kept under `content/_raw/references/`, which is
gitignored and local only. Each reference `note` lists the simplified
rhythms, the omitted bars and the section kept.

| Slug | Tune | Melody author (died) | First published | Reference | Melody check |
|---|---|---|---|---|---|
| `hot-cross-buns` | Hot Cross Buns | traditional | not dated | [English Wikipedia score, 'Alternative' version (G)](https://en.wikipedia.org/wiki/Hot_Cross_Buns_(song)) | exact, 17 notes, by intervals |
| `alle-meine-entchen` | Alle meine Entchen (All My Little Ducklings) | traditional | not dated | [German Wikipedia score (C)](https://de.wikipedia.org/wiki/Alle_meine_Entchen) | exact, 27 notes, pitch for pitch |
| `lightly-row` | Lightly Row (Hänschen klein) | traditional | not dated | [German Wikipedia score of 'Hänschen klein' (F)](https://de.wikipedia.org/wiki/H%C3%A4nschen_klein) | exact, 49 notes, by intervals |
| `au-clair-de-la-lune` | Au clair de la lune | traditional | not dated | [English Wikipedia score image (C)](https://en.wikipedia.org/wiki/Au_clair_de_la_lune) | exact, 44 notes, pitch for pitch |
| `london-bridge` | London Bridge Is Falling Down | traditional | not dated | [English Wikipedia score (F, repeat unfolded)](https://en.wikipedia.org/wiki/London_Bridge_Is_Falling_Down) | exact, 24 notes, by intervals |
| `old-macdonald-had-a-farm` | Old MacDonald Had a Farm | traditional | not dated | [French Wikipedia score (G)](https://fr.wikipedia.org/wiki/Old_MacDonald_Had_a_Farm) | exact, 59 notes, pitch for pitch |
| `kuckuck` | Kuckuck, Kuckuck, ruft's aus dem Wald (Cuckoo) | traditional | not dated | [German Wikipedia score (G, upper voice)](https://de.wikipedia.org/wiki/Kuckuck,_Kuckuck,_ruft%E2%80%99s_aus_dem_Wald) | exact, 26 notes, pitch for pitch |
| `little-jack-horner` | Little Jack Horner | traditional | 1877 | [English Wikipedia score image: The Baby's Opera, 1877 (E)](https://en.wikipedia.org/wiki/Little_Jack_Horner) | exact, 34 notes, by intervals |
| `see-saw-margery-daw` | See-Saw, Margery Daw | traditional | 1878 | [The Baby's Bouquet, 1878: Project Gutenberg 25432 MusicXML (F)](https://www.gutenberg.org/cache/epub/25432/music/margerydaw.xml) | exact, 30 notes, pitch for pitch |
| `schlaf-kindlein-schlaf` | Schlaf, Kindlein, schlaf (Sleep, Baby, Sleep) | Johann Friedrich Reichardt (1814) | 1781 | [German Wikipedia score, Reichardt 1781 (F)](https://de.wikipedia.org/wiki/Schlaf,_Kindlein,_schlaf) | exact, 31 notes, by intervals |
| `little-bo-peep` | Little Bo-Peep | traditional | 1911 | [Our Old Nursery Rhymes (Moffat), 1911: Project Gutenberg 61009 MusicXML (F)](https://www.gutenberg.org/cache/epub/61009/music/bopeep.mxl) | exact, 35 notes, pitch for pitch |
| `three-little-kittens` | The Three Little Kittens | traditional | 1878 | [The Baby's Bouquet, 1878: Project Gutenberg 25432 MusicXML (B-flat)](https://www.gutenberg.org/cache/epub/25432/music/threelittlekittens.xml) | exact, 25 notes, by intervals |
| `jolly-old-saint-nicholas` | Jolly Old Saint Nicholas | James Ramsey Murray (attributed) (1905) | 1874 | [Franklin Square Song Collection, 1881, p. 80 (A)](https://archive.org/details/franklinsquares04mccagoog/page/n84/mode/1up) | exact, 48 notes, by intervals |
| `when-the-saints-go-marching-in` | When the Saints Go Marching In | traditional | not dated | [German Wikipedia ABC score (C)](https://de.wikipedia.org/wiki/When_the_Saints_Go_Marching_In) | exact, 31 notes, pitch for pitch |
| `michael-row-the-boat-ashore` | Michael, Row the Boat Ashore | traditional | 1867 | [English Wikipedia score (C)](https://en.wikipedia.org/wiki/Michael,_Row_the_Boat_Ashore) | exact, 23 notes, pitch for pitch |
| `camptown-races` | Camptown Races | Stephen Foster (1864) | 1850 | [Wikisource transcription of the 1850 first edition (D)](https://en.wikisource.org/wiki/Camptown_Races) | exact, 52 notes, by intervals |
| `oh-susanna` | Oh! Susanna | Stephen Foster (1864) | 1848 | [Wikisource transcription of the 1848 edition, plate 1427 (G)](https://en.wikisource.org/wiki/Oh!_Susanna_(1848)) | exact, 85 notes, pitch for pitch |
| `long-long-ago` | Long, Long Ago | Thomas Haynes Bayly (1839) | 1839 | [Cramer, Addison & Beale edition, 1839: Commons scan (F)](https://commons.wikimedia.org/wiki/File:Thomas_Haynes_Bayly_-_Long,_Long_Ago!_A_Ballad,_Cramer,_Addison_%26_Beale,_London,_n._d._(1839)_(IA_BaylyLongLongAgo1839Sheetmusic).pdf) | exact, 35 notes, pitch for pitch |
| `little-brown-jug` | Little Brown Jug | Joseph Eastburn Winner (1918) | 1869 | [J. E. Winner edition, 1869: Lilly Library scan (C)](https://webapp1.dlib.indiana.edu/inharmony/detail.do?action=detail&fullItemID=/lilly/starr/LL-SSM-2-086-0041) | exact, 28 notes, pitch for pitch |
| `pease-porridge-hot` | Pease Porridge Hot | traditional | 1922 | [English Wikipedia infobox score: The Song Play Book, 1922 (G)](https://en.wikipedia.org/wiki/Pease_Porridge_Hot) | exact, 36 notes, pitch for pitch |
| `yankee-doodle` | Yankee Doodle | traditional | not dated | [Chinese Wikipedia score, revision 87230830 (A)](https://zh.wikipedia.org/wiki/%E6%B4%8B%E5%9F%BA%E6%AD%8C) | exact, 58 notes, by intervals |
| `auld-lang-syne` | Auld Lang Syne | traditional | 1799 | [English Wikipedia score, revision 1380084234 (F)](https://en.wikipedia.org/wiki/Auld_Lang_Syne) | exact, 56 notes, pitch for pitch |
| `sakura-sakura` | Sakura, Sakura | traditional | 1888 | [Chinese Wikipedia score, revision 91594626 (A minor); 1888 first print for the rhythm of bars 13-14](https://zh.wikipedia.org/wiki/%E6%A8%B1%E8%8A%B1_(%E6%B0%91%E8%B0%A3)) | exact, 50 notes, pitch for pitch |
| `korobeiniki` | Korobeiniki (The Peddlers) | Yakov Prigozhy (attributed: the popular 1898 setting of the folk song) (1920) | 1898 | [English Wikipedia score, revision 1373187891 (A minor)](https://en.wikipedia.org/wiki/Korobeiniki) | exact, 51 notes, pitch for pitch |
| `la-cucaracha` | La Cucaracha | traditional | not dated | [English Wikipedia score, revision 1376650501 (F)](https://en.wikipedia.org/wiki/La_Cucaracha) | exact, 100 notes, pitch for pitch |
| `red-river-valley` | Red River Valley | traditional | 1896 | [English Wikipedia score, revision 1378721571 (G)](https://en.wikipedia.org/wiki/Red_River_Valley_(song)) | exact, 76 notes, pitch for pitch |
| `loch-lomond` | Loch Lomond | traditional | 1841 | [English Wikipedia score image, revision 1378516938: Ford's edition (F)](https://en.wikipedia.org/wiki/The_Bonnie_Banks_o%27_Loch_Lomond) | exact, 89 notes, pitch for pitch |
| `silent-night` | Silent Night (Stille Nacht) | Franz Xaver Gruber (1863) | 1833 | [English Wikipedia score 'Contemporary' (D)](https://en.wikipedia.org/wiki/Silent_Night) | exact, 46 notes, by intervals |
| `joy-to-the-world` | Joy to the World | Lowell Mason (1872); George Frideric Handel (attributed phrases) (1759) | 1836 | [English Wikipedia score: Mason, The Modern Psalmist, 1839 (D)](https://en.wikipedia.org/wiki/Joy_to_the_World) | exact, 57 notes, pitch for pitch |
| `o-come-all-ye-faithful` | O Come, All Ye Faithful (Adeste Fideles) | John Francis Wade (1786) | 1751 | [English Wikipedia score, upper voice (G)](https://en.wikipedia.org/wiki/O_Come,_All_Ye_Faithful) | exact, 61 notes, pitch for pitch |
| `deck-the-halls` | Deck the Halls | traditional | 1794 | [Franklin Square Song Collection, 1881, p. 120 (F)](https://archive.org/details/franklinsquares04mccagoog/page/n124/mode/1up) | exact, 84 notes, pitch for pitch |
| `good-king-wenceslas` | Good King Wenceslas | traditional | 1582 | [Christmas Carols New and Old (Bramley and Stainer), No. 10 (A)](https://archive.org/details/christmascarolsn00bramuoft/page/n21/mode/1up) | exact, 53 notes, by intervals |
| `o-christmas-tree` | O Christmas Tree (O Tannenbaum) | traditional | 1824 | [English Wikipedia score (G)](https://en.wikipedia.org/wiki/O_Tannenbaum) | exact, 46 notes, pitch for pitch |
| `the-first-noel` | The First Noel | traditional | 1823 | [Christmas Carols New and Old (Bramley and Stainer), No. 6 (D)](https://archive.org/details/christmascarolsn00bramuoft/page/n13/mode/1up) | exact, 72 notes, pitch for pitch |
| `old-hundredth` | Old Hundredth | Louis Bourgeois (1560) | 1551 | [English Wikipedia score, Genevan rhythm (G)](https://en.wikipedia.org/wiki/Old_100th) | exact, 32 notes, pitch for pitch |
| `holy-holy-holy` | Holy, Holy, Holy (tune Nicaea) | John Bacchus Dykes (1876) | 1861 | [English Wikipedia score, New English Hymnal soprano (D)](https://en.wikipedia.org/wiki/Holy,_Holy,_Holy!_Lord_God_Almighty) | exact, 45 notes, pitch for pitch |
| `a-mighty-fortress` | A Mighty Fortress Is Our God (Ein feste Burg) | Martin Luther (1546) | 1529 | [English Wikipedia score of BWV 80's closing chorale, soprano (D)](https://en.wikipedia.org/wiki/Ein_feste_Burg_ist_unser_Gott,_BWV_80) | exact, 73 notes, pitch for pitch |
| `la-marseillaise` | La Marseillaise | Claude-Joseph Rouget de Lisle (1836) | 1792 | [Mutopia 1891, the 1792 first edition, voice (C)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1891) | exact, 105 notes, pitch for pitch |
| `god-save-the-king` | God Save the King | traditional | 1744 | [Hymnary.org tune AMERICA: Cyber Hymnal No. 49, soprano (F)](https://hymnary.org/tune/america_carey) | exact, 41 notes, pitch for pitch |
| `austrian-hymn` | Austrian Hymn (Gott erhalte Franz den Kaiser) | Joseph Haydn (1809) | 1797 | [English Wikipedia score (G)](https://en.wikipedia.org/wiki/Gott_erhalte_Franz_den_Kaiser) | exact, 94 notes, pitch for pitch |
| `daisy-bell` | Daisy Bell (A Bicycle Built for Two) | Harry Dacre (1922) | 1892 | [Wikisource transcription of the 1893 New York printing (G)](https://en.wikisource.org/wiki/Daisy_Bell) | exact, 50 notes, pitch for pitch |
| `in-the-good-old-summertime` | In the Good Old Summer Time | George Evans (1915) | 1902 | [Howley, Haviland & Dresser edition, 1902: UIC scan (B-flat)](https://digital.library.uic.edu/view/ark:/81984/d3g73735b) | exact, 55 notes, pitch for pitch |
| `the-entertainer-easy` | The Entertainer, A strain (simplified) | Scott Joplin (1917) | 1902 | [The core engraving joplin-the-entertainer (Mutopia 263), A strain](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=263) | exact, 77 notes, pitch for pitch |
| `surprise-symphony-theme` | Theme from the "Surprise" Symphony | Joseph Haydn (1809) | 1795 | [English Wikipedia score, first violins, bars 1-16 (C)](https://en.wikipedia.org/wiki/Symphony_No._94_(Haydn)) | exact, 53 notes, pitch for pitch |
| `brahms-lullaby` | Lullaby (Wiegenlied) | Johannes Brahms (1897) | 1868 | [English Wikipedia score (E-flat), as the voice of Mutopia 1037](https://en.wikipedia.org/wiki/Wiegenlied_(Brahms)) | exact, 51 notes, by intervals |
| `eine-kleine-nachtmusik-theme` | Eine kleine Nachtmusik, opening theme | Wolfgang Amadeus Mozart (1791) | 1827 | [English Wikipedia score, bars 1-4 (G)](https://en.wikipedia.org/wiki/Eine_kleine_Nachtmusik) | exact, 18 notes, by intervals |

- **Melody check:** all 46 are exact. 33 match pitch for pitch, and 13 match
  by intervals because they are transposed (`verification[slug].melody`).
- **Deliberate clashes:** none. `allowedClashes` is empty in all five
  modules.
- **Melody rule:**
  - 25 tunes are traditional; 10 of them have no documented first printing
    and are recorded as `firstPublished: null`.
  - The latest death among the named melody authors is 1922 (Harry Dacre,
    Daisy Bell).
  - The latest first publication is 1922 (Pease Porridge Hot, The Song Play
    Book).
  - Where a candidate table gave a composition year, `firstPublished` records
    the documented first publication instead: Silent Night 1833, Joy to the
    World 1836, Long, Long Ago 1839, the Surprise theme 1795 and Eine kleine
    Nachtmusik 1827.
  - Jolly Old Saint Nicholas is credited to James R. Murray (School Chimes,
    1874).
  - When the Saints, Hot Cross Buns and Old MacDonald have no dated first
    printing of the tune as sung.

### Gates and results

`build.py` runs the conversion, the MIDI checks and the validation; `gates.py`
then runs the span check, the level proposal, the melody check and the lint.
The results are in `content/verification.json` and are asserted by
`tests/test_gates.py::test_new_piece_passes_every_gate`,
`test_every_cc_engraving_is_credited_in_rights` and
`test_span_flags_only_on_core30`.

| Check | Scope | Result |
|---|---|---|
| `validate.py`: MusicXML 4.0 XSD, xmlcheck structure (1 part, 2 staves, numbering, no voice overlap, no overfull bar, pitches A0–C8, no fingering in stripped files), music21 10.5 parse | 182 files | 182 pass |
| verovio 6.3 renders page 1 | 149 scores | 149 render |
| Notes against LilyPond 2.24's MIDI of the same source | 73 new engravings | 73 exact, 36,436 notes |
| Notes against the MIDI Mutopia published | 73 new engravings | 67 exact. The 6 differences are accepted above. |
| Melody against the reference (top line of staff 1 of the built score) | 46 new arrangements | 46 exact |
| Span check (`check_spans.py`: a slice one hand cannot strike) | whole library | 19 flagged slices, all in 4 core pieces (Satie 9, Moonlight 6, Chopin 28/4 3, Chopin 28/7 1). None in a new piece. |
| Lint law errors (L01 to L05) on the engine's own fingering, medium and large profile | 119 new pieces, 37,493 notes | 0 at both profiles |
| Lint law errors, core 30 (exempt) | 30 pieces, 9,802 notes | medium 101 in 5 pieces (Satie 40, Moonlight 33, Chopin 28/4 22, Chopin 28/7 4, Entertainer 2); large 89 |
| Level within one of the proposal, or `levelOverride` | 119 new pieces | 112 within one, 7 overrides |
| Size, at most 700 KB per new file | 144 new files | largest 607,204 bytes (`mozart-sonata-k331-mvt3-rondo-alla-turca.fingered.musicxml`) |
| Length, at most 255 s | 119 new pieces | longest 253 s (`joplin-sun-flower-slow-drag`) |
| Engine reader: `src/io/musicxml/smoke.test.ts`, one test per file | every file | all parse, with both hands present |
| Byte-for-byte rebuild (`repro.py --all`) | 182 files | 182 identical |

These results are as measured when the L1 pieces were added. The lint records
hold the hash of the score they linted (`scoreSha256`) and of the engine source
that fingered it (`engineSrcSha256`), so a stale record is visible.
`digitus2 lint` has no `--profile` option, so the laws are checked with its
default (large) span tables; the fingering checked is each profile's own.

Known limits of the converter and checkers, found during L1. They are recorded
in the pieces' `notes` and `rejected` entries and remain open:

| Limit | Tool | Effect |
|---|---|---|
| In an unfolded comparison, grace notes are counted once (`best_midi_match` uses `grace_pitches` as written) | `xmlcheck.py` | Blocks Op. 68 Nos. 7, 18 and 26 and Grieg Op. 12 No. 7. Also forces the polska's comparison as written. Fix: count grace notes along `unfold_order`. |
| Excerpt mode compares written notes with the MIDI before the written length, not the unfolded performance | `build.py` `midi_check` | Blocks The Easy Winners (bars 1–21 with both endings), which is exact when unfolded (611/611) |
| `barTo` keeps an implicit `<barTo>a` upbeat bar of the next movement | `ly2musicxml.py` | André needs a pre-stage patch |
| No D.C./Fine playback (`<sound dacapo/fine>`) | `ly2musicxml.py` | Wanhal is cut to the Fine |
| Not exported: measured tremolo, transparent dynamics, TextSpanner text, `\mark` fermatas over the final bar line, header tempo words, `\upmordent`/`\downmordent`, octave-shift lines (`xmldump` reads `ottavation`, which is markup in 2.24) | `ly2musicxml.py`, `xmldump.ily` | Catalog patches above. Unpatched: the fermatas over the final bar lines of Anh. 117a, 119, 120 and 121, and the 8va lines of Burgmüller Nos. 8, 11 and 15, whose pitches are right. |
| A final `\bar "\|\|"` becomes a light-heavy bar line | `ly2musicxml.py` | Behr, Wanhal |
| `bracket-visibility #f` on tuplets is serialised as null | `xmldump.ily` | Burgmüller No. 7 patch |
| A piece's end is taken from its last note, so a final bar padded with spacers loses its repeat sign | `ly2musicxml.py` | Op. 68 No. 26 needed two patches; Sicilienne not used |
| `\partcombine` multi-measure rests of length None crash `build_measures` | `ly2musicxml.py` | In the Hall of the Mountain King not used |
| The CLI fails with relative `--build`/`--out` paths, because LilyPond runs in the source directory | `ly2musicxml.py` `main()` | Pass absolute paths. `build.py` is not affected. |

### Benchmark set

- **The field.** Every manifest entry has `benchmarkSet`. It is `"core30"`
  for the 30 pieces of the first library and `null` for every later piece.
- **Why.** Every library-based measurement was made, and its floors set, on
  those 30: the evalhands library score, the hand-motion fit, the
  benchmark's repeat consistency, the metamorphic sample and the solver's
  exact-search oracle. A growing library must not move them silently.
- **What is pinned.** The 30 keep their bytes (`test_core30_scores_are_byte_identical`),
  their manifest facts (`test_core30_manifest_entries_only_gain_the_new_keys`)
  and their membership (`test_exactly_the_core30_carry_the_benchmark_set`).

| Consumer | Selection |
|---|---|
| `packages/engine/src/library/benchmarkSet.ts` | `benchmarkEntries(entries, set = 'core30')` returns the entries of a set in manifest order. It returns every entry for `'all'` or for a manifest without any `benchmarkSet`, and it throws for a named set with no entries. It is not exported from `src/index.ts`. |
| `packages/engine/cli/evalhands.ts` | `librarySet` defaults to `core30` |
| `packages/engine/cli/bench.ts` (`libraryRepeats`), `src/eval/hands.test.ts`, `src/fingering/solve.test.ts`, `src/fingering/profilesWeights.test.ts`, `src/io/midi/motion.test.ts`, `src/io/midi/engrave.library.test.ts`, `research/scripts/make_hand_motion.py`, `apps/web/src/library/manifest.test.ts` | the benchmark set |
| `src/io/musicxml/smoke.test.ts` | every file on purpose, one test per file |
| `content/tools/gates.py --new` | every piece outside `core30`. Core-30 failures are reported as exempt. |

**Overlap with the Mutopia fingering split.** Some library engravings are in
the train or test half of the Mutopia fingering split
(`research/data/splits/mutopia_split.json`, split `piece70_30`, grouped by
Mutopia id) that the learned weights train and evaluate on. Of the L1 pieces,
26 of the 73 new engravings are in the split (18 train, 8 test), besides 9 of
the 20 core engravings (5 train, 4 test). Counting every non-core Mutopia
engraving in the manifest, 46 are in the split (32 train, 14 test). An evaluation of learned weights on
"the library" without the `core30` filter, or without excluding these ids,
would mix training pieces into the measurement. A piece is in the split when
the number at the end of its `source.mutopiaId` is one of the split's
`mutopia_ids`.

### Considered and rejected

Main candidates and spares that were not shipped. Each catalog fragment's
`rejected` list has the full reasons.

| Candidate | Why not |
|---|---|
| `go-tell-aunt-rhody` | No notated source reachable: no score in any Wikipedia edition, none on Commons or Gutenberg, and IMSLP's only score sits behind a CAPTCHA (not bypassed). |
| `this-old-man` | No notated source in any Wikipedia edition, on Commons or in the Gutenberg nursery-song books. |
| `skip-to-my-lou` | No notated source in any Wikipedia edition; Commons has only recordings. |
| `the-muffin-man` | No notated source; the article's image is a song-sheet cover. |
| `hush-little-baby` | The only two notations (an undated Commons image, a 2023 MIDI) disagree. |
| `lucy-locket` (spare) | In both dated sources the tune is Yankee Doodle, and its right hand breaks the level-1 position rule. |
| `sur-le-pont-d-avignon` (spare) | Spans an octave in both sources, too wide for level 1. |
| `love-somebody` (spare) | No notated source. |
| `we-wish-you-a-merry-christmas` | The tune sung today was first printed in 1935 (Warrell, OUP), after the 1928 cut-off; the 19th-century versions use other tunes. |
| `up-on-the-housetop` | No notated source from 1928 or earlier (Wikipedia in 6 languages, Internet Archive full text from 1948 on, IMSLP only a 2010 arrangement). |
| `simple-gifts` | No notated text source could be read (Wikipedia has only a manuscript image; Hymnary's score is licence-gated; CPDL refused the request). |
| `swing-low-sweet-chariot` | Sources disagree: the only text score does not fill its metre and differs from its own incipit. |
| `londonderry-air` | Spans 20 semitones (B3 to G5) in Petrie's 1855 first edition; level 2 allows 19 and transposition does not help. |
| `shenandoah` | No notated text source; the two ABC transcriptions found cite no edition and disagree. |
| `home-on-the-range` | The only notated source found (Project Gutenberg #21300, Lomax: MIDI, Finale, PDF) was not read. |
| `maple-leaf-rag-easy` | The A strain's melody spans 25 semitones (29 by the other reading); an 8-bar half is not a musical whole. |
| `schumann-op68-no7-hunting-song` | LilyPond 2.24 MIDI check 612/612 plus 2 MIDI-only notes, the second pass of a grace note: the `xmlcheck` grace-count limit. Every other gate passes. Held until that limit is fixed. |
| `schumann-op68-no18-reapers-song` | The same limit (458/458 plus 2). Held until that limit is fixed. |
| `schumann-op68-no26-untitled` | The same limit (682/682 plus 1), after two patches for the padded last bar. Held until that limit is fixed. |
| `schumann-op68-no11-sicilienne` (spare) | 323/789: a spacer in the first ending offsets the unfolded MIDI by an eighth, plus the grace-count limit. |
| `haydn-sonata-hob-xvi-27-mvt2` | Span flags (bars 29 and 31, cross-staff) and L05 law errors from bar 29; no tonic-ending section of 16 bars before it; 4:18. |
| `mozart-sonata-k331-mvt1-theme` (spare) | LilyPond 2.24 MIDI check not exact (2 MIDI-only notes). |
| `beethoven-minuet-woo-82` (spare) | One L03 law error at medium, and a MIDI check that is not exact. |
| `grieg-lyric-pieces-op12-no7-album-leaf` | The `xmlcheck` grace-count limit (586 sounding notes match; 14 grace notes sound twice). It is Op. 12 No. 7 despite the directory name `No03`. |
| `schumann-op15-no7-traumerei` | Span flags in bars 6 and 22; L05 law errors from bar 6. |
| `chopin-prelude-op28-no20` | Span flags in bars 2, 6 and 10; 8 law errors from bar 2. |
| `joplin-peacherine-rag` | 14 law errors at medium (bars 16, 29, 50); bar 16 is inside the first strain. |
| `joplin-the-easy-winners` | The whole rag fails the span gate at bar 36. The excerpt of bars 1–21 is blocked by `midi_check`'s excerpt mode (327/338; 611/611 when unfolded). Held until that limit is fixed. |
| `satie-gymnopedie-no3` (spare) | 7 span flags from bar 6; 40 law errors at medium. |
| `grieg-op46-no4-in-the-hall-of-the-mountain-king` (spare) | The converter crashes on `\partcombine` rests. |
| `debussy-clair-de-lune` (spare) | 324 s; span flags and law errors from bar 8. |

Excluded by rule:

| Excluded | Why |
|---|---|
| Living or recent composers on Mutopia (Kumar, Sidwell, Comeau, Iliev, Magnenat, Doonan, Brown, Hunter) | not method repertoire |
| Verdi Traviata reductions | "Calcografía" licence strings, opera reductions |
| Czerny Op. 840 | no `\score` block in the piece files |
| Clementi Op. 42, Hanon | exercise collections without a `\score` per piece |
| Large works (Schubert Impromptus, Chopin Études and Ballades, Beethoven sonata first movements beyond Op. 49) | above level 5 |
| Clementi Op. 36 Nos. 2 to 6, Kuhlau Op. 55, Diabelli, Gurlitt, Türk, Köhler | not on Mutopia |
| The seven songs in the table under "Selection" | an author died after 1955 |

Known weakness: `eine-kleine-nachtmusik-theme` is 4 bars long (8 s at level 2),
of little practice value next to the 16-bar level-2 pieces. Its reference, the
English Wikipedia score, stops at bar 4, and extending it needs a dated
notated source for bars 5 to 8.

### Reproducibility

- **The raw downloads are not in the repository.** `content/_raw/` is
  gitignored. The Mutopia sources can be fetched again with `fetch_mutopia.py`,
  and the pins detect any change on the live site. `validate.load_schema()`
  downloads the MusicXML 4.0 XSD the first time. The environment is pinned in
  `content/requirements.txt`.
- **Dates are pinned.** The catalog entries of the core Mutopia pieces pin
  `retrievedAt` to the date of the first fetch, which is also the date in
  their `<encoding-date>` and in `source.retrievedAt`, so a refetch does not
  move a byte.
- **The 30 are pinned by hash.** `tests/fixtures/core30.json` holds the
  SHA-256 of the 38 core files, and `test_core30_scores_are_byte_identical`
  checks them. The refetched sources rebuild all 38 files identically
  (`repro.py --core30`).
- **Every engraving pins its source.** All Mutopia entries of the curated core
  have a `sourceSha256`. For most it is the SHA-256 of the fetched main `.ly`
  in `fetch_log.json`. For 4 (Chopin Op. 28 Nos. 6 and 7, Moonlight, Rondo alla
  Turca), the main `.ly` sits inside a `-lys.zip`: the pin is the hash of the
  extracted file, while the log hashes the zip. The tests check the core pins
  (`test_core_mutopia_sources_match_their_pinned_sha256`); the new ones are
  covered by the byte-for-byte rebuild. For BWV Anh. 119 and BWV 926 the live
  site's source differs from the 2024 mirror's copy, and the pin is the version
  that was built.
- **The whole library rebuilds byte for byte.** `repro.py --all` rebuilds the
  library into `content/_build/repro` without touching `content/scores`, and
  every file must be identical. Arrangements use a fixed encoding date
  (`arrange.ENCODING_DATE`), and no script writes a timestamp into a tracked
  file: `gates.py` records hashes, not dates.
- **Shared files survive parallel builds.** `manifest.json` and
  `verification.json` are rewritten only under `jsonio.library_lock()`, with
  atomic replacement (`test_concurrent_writers_keep_every_entry`,
  `test_atomic_write_leaves_no_temporary_file`). Their order is fixed by the
  data: level, then collection display order, then position in the merged
  catalog.
- **What cannot be rebuilt from the repository alone:** the downloads under
  `content/_raw/`, and the reference pages of the arrangements. The URLs and
  retrieval dates are in the catalog, the article revisions where they were
  recorded, and the typed melodies in the arrangement modules.
