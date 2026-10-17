# Textbook fingering oracle

Data: `benchmarks/textbook/` (`scales.json`, `arpeggios.json`, `chromatic.json`).
Generator and gates: `python benchmarks/textbook/generate.py` (it also rewrites the tables at the end of this file).

The oracle is a set of generated patterns whose fingering is what piano method books print: scales,
arpeggios and chromatic scales in every key, both hands, both directions. The engine should reproduce the
`fingers` list of every entry, or one of its `alternatives`. Every table is cited, and where the books
disagree the disagreement is recorded instead of hidden.

## How the fingerings are described

Every printed scale book describes a fingering as a pattern that repeats each octave, plus a few special
fingers at the ends. The generator uses the same description:

- **Cycle.** One finger per scale degree (or per chord tone), repeated every octave. The cycle is fixed by
  where the 4th finger falls. The chart of Prof. Escadon (University of Miami), published at
  cs.miami.edu/~burt, gives that 4th-finger placement for every major, natural, harmonic and melodic minor
  scale in both hands. Every other source used here agrees with it on the cycle; the disagreements below
  are only about the ends.
- **Start and end substitutions.** The first note may use a different finger from the one the cycle gives
  (RH B-flat major starts on 2 in one-octave charts; LH C major starts on 5). The same goes for the last note
  (RH C major ends on 5; RH F major ends on 4).

Conventions that hold for every entry:

| Topic | Convention |
|---|---|
| Finger numbers | 1 = thumb to 5 = little finger, positive for both hands |
| Range | Lowest note = tonic (or chord root) nearest middle C, MIDI 60, for RH. Ties (F-sharp) go down, so the RH range starts between F#3 (54) and F4 (65). LH is exactly one octave lower. Descending entries cover the same range from the top, and `startMidi` is always `midi[0]`. |
| Lengths | Scales: 1, 2 and 3 octaves. Arpeggios and chromatic scales: 2 octaves. |
| Descending | Exact reverse of the ascending entry (notes, fingers and alternatives). Melodic minor is the one exception: its descending entry uses the natural-minor notes and the natural-minor fingering. |
| Thumb on black keys | Never in scales or chromatic scales. In arpeggios, only F-sharp major and E-flat minor, the two triads with no white key, where Kelley notes the thumb has no choice. |

### Scales

- **White-key majors and their minors** (C, G, D, A, E; minors A, E, D, G, C): RH `1 2 3 1 2 3 4` with 5 on
  the top tonic; LH `5 4 3 2 1 3 2 1`, so 4 falls on degree 2 and the bottom tonic takes 5. This applies to
  every minor form.
- **B major and all forms of B minor**: RH as above; LH `4 3 2 1 4 3 2 1` (4 on F-sharp).
- **F major and all forms of F minor**: RH `1 2 3 4 1 2 3 4` (4 on B-flat, top F on 4); LH as for C.
- **Black-key majors**: the RH 4th finger is always on B-flat (A-sharp). The LH 4th finger is on E-flat in
  B-flat major, A-flat in E-flat major, D-flat in A-flat major, and G-flat (F-sharp) in D-flat and
  G-flat/F-sharp major. Escadon summarises this as "the first flat encountered ascending".
  Thumbs always fall on white keys. For example, the LH thumbs of F-sharp major fall on B and E-sharp, and
  those of B major on E and B. So no standard scale fingering puts the thumb on a black key, and the gate
  allows no exception for scales.
- **Harmonic minor** uses the natural-minor fingering, except that G-sharp minor LH moves its 4th finger from
  F-sharp to C-sharp, because the raised 7th (F double sharp) is a white key the thumb can take.
- **Melodic minor ascending** keeps the natural-minor fingering, except where raising the 6th and 7th changes
  which notes are white keys. Either a thumb would land on a new black key (F-sharp, C-sharp RH), or a new
  white key frees the thumb (G-sharp LH):
  - F-sharp RH `2 3 1 2 3 4 1 2` (4 on D-sharp).
  - C-sharp RH 4 on A-sharp (`2 3 1 2 3 4 1 2`).
  - G-sharp LH 4 on C-sharp, as in the harmonic form.

  Descending uses the natural-minor notes and fingering, so for these three the descending entry is not the
  reverse of the ascending one (`check.py` lists them).

### Arpeggios (root position, two octaves)

- RH `1 2 3 1 2 3 5` whenever the root is white, and also for the all-black triads F-sharp major and
  E-flat minor.
- LH `5 4 2 1 4 2 1` when the root and third are both white (C, F, G major; A, D, E minor), for every
  minor triad on a white root, and for the all-black triads (E-flat minor; F-sharp major by tie-break).
  LH `5 3 2 1 3 2 1` when the third is black and the root white (D, A, E, B major).
- Black root with a white third (A-flat, D-flat, E-flat major; C-sharp, F-sharp, G-sharp minor): thumb on the
  third. LH `2 1 4 2 1 4 2`; RH `4 1 2 4 1 2 4` with a disputed first finger (see below).
- B-flat major: RH thumb on D, LH `3 2 1 3 2 1 3`.
- B-flat minor: RH `2 3 1 2 3 1 2`, LH `3 2 1 3 2 1 3`.
- **Seventh chords.** The basic fingering is `1 2 3 4` (Roskell). When the chord starts on a white note, both
  thumbs go on the root (Hanon's diminished sevenths, as described by Black): RH `1 2 3 4 1 2 3 4 5`,
  LH `5 4 3 2 1 4 3 2 1`. When it starts on a black note, the thumbs go on white keys: RH on the white key
  reached from a black key, LH on the white key that leads to a black key. For diminished sevenths this puts
  the two thumbs on different white notes, as Black states. No per-key printed table for black-root seventh
  chords could be read online, so those 40 entries (20 per family) are marked `confidence: "rule"`.

### Chromatic scale

3 on every black key, 1 on every other white key. In the pairs of adjacent white keys, the RH plays E-F and
B-C with `1 2` and the LH plays them with `2 1`, going up. So the second finger takes the white key that
follows another white key (RH) or precedes one (LH). Both source descriptions state this pair rule. A first
or last note with no partner (RH starting on F or C, LH ending on E or B) takes the thumb.

## How the primary fingering was chosen

1. Collect every source that prints the fingering for that key, form and hand (list below).
2. The fingering printed by more sources is `primary`; the others go in `alternatives` with their sources.
   Entries are marked `confidence: "majority"`.
3. On a tie (`confidence: "tie"`), prefer the option that keeps the octave pattern from the first note. If
   neither tied option does, prefer Kelley's arpeggio chart, which is labelled the standard accepted fingering.
   The entry's `note` says which rule decided it.
4. When every consulted source agrees, the entry is marked `confidence: "agreed"` and has no alternatives.

A scorer should accept the primary or any alternative. A stricter scorer can grade `agreed` entries alone.

## Disputed cases and the choice made

| Case | Options and sources | Primary chosen |
|---|---|---|
| B-flat major RH, first finger | 2: pianoscales.org, Musicnotes, oktav (one octave), MasterPiano, Beauchamp (two octaves). 4: piano-keyboard-guide (one octave), Commonwealth University, Hoffman, oktav ("start on 4 for more than one octave"), pianoscales.org fingerings page. | 2 for one octave, 4 for two and three octaves, which is the majority at each length. The other start is an alternative. |
| B-flat minor RH, first finger (all forms) | 2: pianoscales.org, MasterPiano, Beauchamp. 4: the octave-pattern finger (Escadon). | 2 |
| E-flat major RH, first finger | 3: pianoscales.org, Commonwealth, Hoffman (one and two octaves), MasterPiano. 2: Beauchamp. | 3 |
| A-flat major RH, first two fingers | 3 4: pianoscales.org, piano-keyboard-guide, Commonwealth, MasterPiano. 2 3: oktav, Beauchamp. | 3 4 |
| C-sharp minor RH (natural, harmonic) | 3 4: pianoscales.org, piano-keyboard-guide, MasterPiano. 2 3: oktav, Beauchamp. | 3 4 |
| F-sharp minor RH (natural, harmonic) | 2 3: pianoscales.org (both forms), piano-keyboard-guide, oktav, MasterPiano, Beauchamp. 3 4: Hoffman. | 2 3, with 4 on G-sharp from the second octave on |
| G-sharp minor RH | Natural: 3 4 (pianoscales.org, Hoffman, MasterPiano) vs 2 3 (oktav). Harmonic: 3 4 (Hoffman, MasterPiano) vs 2 3 (pianoscales.org, Beauchamp), a tie. | 3 4 in every form (harmonic by tie-break) |
| E-flat minor RH (harmonic) | 3: pianoscales.org, MasterPiano. 2: Beauchamp. | 3 |
| C-sharp melodic minor RH ascending | 2 3 (octave pattern with 4 on A-sharp, per Escadon) vs 3 4 (MasterPiano). | 2 3 (tie-break) |
| LH top note, B-flat, E-flat, A-flat major; C-sharp, F-sharp, G-sharp minor | Octave-pattern finger (3, or 4 for F-sharp minor): pianoscales.org, Commonwealth (B-flat, E-flat, A-flat), Hoffman (B-flat, E-flat). 2: Beauchamp ("nearest available finger"), Musicnotes (B-flat). | Octave-pattern finger |
| LH top note, D-flat and F-sharp major | 3 or 4: pianoscales.org, MasterPiano (one octave). 2: Beauchamp, Commonwealth (two octaves). | Octave-pattern finger (tie-break) |
| C, F, G major arpeggio LH | 5 4 2 1: Escadon, Kelley, Hoffman (F), Beauchamp's broken-chord argument. 5 3 2 1: Commonwealth. | 5 4 2 1 |
| A, D, E minor arpeggio LH | 5 4 2 1: Escadon, Kelley, Commonwealth, Hoffman. 5 3 2 1: "some technique books" (Commonwealth footnote). | 5 4 2 1 |
| F-sharp major arpeggio LH | 5 4 2 1: Escadon. 5 3 2 1: Kelley. | 5 4 2 1 (tie, same shape as C major) |
| A-flat, D-flat, E-flat major arpeggio RH, first finger | 4: Commonwealth, Hoffman (E-flat). 2: Kelley. 3: Escadon. | 4. This is the majority for E-flat; for A-flat and D-flat all three options have one source each, and 4 wins the tie-break. |
| B-flat major arpeggio RH, first finger | 4: Commonwealth, Hoffman. 2: Escadon, Kelley. | 4 (tie-break) |
| C-sharp, F-sharp, G-sharp minor arpeggio RH, first finger | 2: Kelley. 3: Escadon. | 2 (tie-break to Kelley) |
| C-sharp 7 (dominant of F-sharp) | Thumbs on B, or on E-sharp. | Thumbs on B (smaller thumb crossings); E-sharp is the alternative. Rule-derived. |

## Sources

The table at the end of this file maps source keys to URLs.

- Escadon chart (University of Miami), 4th-finger placement and arpeggio chart:
  https://www.cs.miami.edu/~burt/music/finger-charts.html
- pianoscales.org: major https://www.pianoscales.org/major.html, natural minor
  https://www.pianoscales.org/minor.html, harmonic minor https://www.pianoscales.org/minor-harmonic.html, and
  the fingering notes https://www.pianoscales.org/fingerings.html
- Commonwealth University (Mansfield), piano handout, two-octave scale and arpeggio patterns:
  https://commonwealthu.edu/documents/music-piano-handout-new-students-mansfield
- R. Beauchamp, Music & Health piano syllabus, two-octave fingering tables:
  https://musicandhealth.co.uk/scales_examples/fingering.htm (and fingering1.htm to fingering4.htm,
  example.htm)
- Hoffman Academy: scale pages and two-octave lesson transcripts (E-flat, B-flat, F, D, E major; B, C,
  A/D/G, F-sharp, G-sharp minor; chromatic). URLs are in the table at the end.
- piano-keyboard-guide.com: B-flat major, A-flat major, C-sharp minor, E-flat minor, F-sharp minor and the
  chromatic scale.
- oktav.com: B-flat major, A-flat major, C-sharp, F-sharp and G-sharp minor.
- Musicnotes, B-flat major scale guide.
- MasterPiano, chart for all 24 keys: https://www.masterpiano.com/piano-scales
- R. T. Kelley, arpeggio fingering chart: https://robertkelleyphd.com/home/arpfing.htm
- F. Black, Guide to Playing Diminished Seventh Arpeggios (ABRSM Grade 8), 2011:
  https://www.scribd.com/doc/264965107/Diminished-7th-Guide
- P. Roskell, The Art of Piano Fingering, chapters 11 and 12 (Informance). Only the free preview could be
  read, which gives the basic fingering 1 2 3 4.
- C.-L. Hanon, The Virtuoso Pianist (1873), IMSLP:
  https://imslp.org/wiki/The_Virtuoso_Pianist_(Hanon,_Charles-Louis)

### Sources tried and not used, and why

| Source | Why it was not used |
|---|---|
| ABRSM and RCM scale books | Not online. The only report found is a forum post saying ABRSM marks E-flat major RH to start on 2. That agrees with the recorded alternative, so it changes nothing. |
| Hanon No. 39 to 43 scans (IMSLP), University of Washington piano proficiency PDF | Scanned images, so their digits were never read. Hanon is cited only for the families and for No. 42, through Black. |
| Wikipedia, Fingering (music) | No scale tables. |
| R. T. Kelley scale chart | Explicitly "optimized" fingerings, not the traditional ones (it says to use them with caution). |
| musicmagix.com chart | Internally inconsistent: for example, B-flat and E-flat major LH are given the B-flat minor fingering. |
| Greg Spero course chart | Says it was cross-checked against pianoscales.org, so it is not independent. |
| oktav.com left-hand fingerings | Use only three-finger groups (for example A-flat LH 3 2 1 3 2 1 3 2), which is a one-octave shortcut no method prints. Only their right-hand fingerings were used. |
| pianoscales.org interactive fingering tool | Its G-sharp minor LH (3 2 1 3 2 1 3 2) contradicts the site's own tables; the tables were used. |
| Escadon chart, C-sharp natural minor LH entry | Reads "B-", which is not in the scale and is probably a typo. It was not cited for that cell; the harmonic and melodic C-sharp cells are consistent. |

## Limitations

- The black-key seventh-chord arpeggios (5 dominant sevenths and 5 diminished sevenths, 20 entries per family
  over both hands and directions) come from a stated rule, not a printed per-key table. They are marked
  `confidence: "rule"`.
- The first finger of scales and arpeggios that start on a black key is a matter of convention between
  editions. Each such entry lists every sourced option. Treat a miss on the first or last note of a
  non-`agreed` entry as a convention difference, not an engine error.
- The chromatic table uses only the standard 1-3 fingering. The virtuoso 1-2-3-4 chromatic fingerings are
  not included.

## Generated tables

<!-- BEGIN GENERATED TABLES (benchmarks/textbook/generate.py) -->

### Major scales

One octave ascending, then two octaves ascending. Descending is the exact reverse. Source keys are listed under Sources below.

| Key | Notes | RH 1 oct | RH 2 oct | LH 1 oct | LH 2 oct | Sources (RH / LH) | Alternatives (RH / LH, 1 oct unless noted) |
|---|---|---|---|---|---|---|---|
| C | C D E F G A B C | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | ps_major, cwu, mh_cgdae, escadon / ps_major, cwu, mh_cgdae, escadon |  |
| G | G A B C D E F# G | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | ps_major, cwu, mh_cgdae, escadon / ps_major, cwu, mh_cgdae, escadon |  |
| D | D E F# G A B C# D | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | ps_major, cwu, mh_cgdae, escadon, hoffman_d / ps_major, cwu, mh_cgdae, escadon, hoffman_d |  |
| A | A B C# D E F# G# A | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | ps_major, cwu, mh_cgdae, escadon / ps_major, cwu, mh_cgdae, escadon |  |
| E | E F# G# A B C# D# E | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | ps_major, cwu, mh_cgdae, escadon, hoffman_e / ps_major, cwu, mh_cgdae, escadon, hoffman_e |  |
| B | B C# D# E F# G# A# B | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 4 3 2 1 4 3 2 1 | 4 3 2 1 4 3 2 1 3 2 1 4 3 2 1 | ps_major, cwu, mh_bfscs, escadon / ps_major, cwu, mh_bfscs, escadon |  |
| F# | F# G# A# B C# D# E# F# | 2 3 4 1 2 3 1 2 | 2 3 4 1 2 3 1 2 3 4 1 2 3 1 2 | 4 3 2 1 3 2 1 4 (tie) | 4 3 2 1 3 2 1 4 3 2 1 3 2 1 4 | ps_major, cwu, mh_bfscs, masterpiano, escadon / ps_major, masterpiano, escadon | LH 4 3 2 1 3 2 1 2 [mh_bfscs, cwu] |
| Db | Db Eb F Gb Ab Bb C Db | 2 3 1 2 3 4 1 2 | 2 3 1 2 3 4 1 2 3 1 2 3 4 1 2 | 3 2 1 4 3 2 1 3 (tie) | 3 2 1 4 3 2 1 3 2 1 4 3 2 1 3 | ps_major, cwu, mh_bfscs, masterpiano, escadon / ps_major, masterpiano, escadon | LH 3 2 1 4 3 2 1 2 [mh_bfscs, cwu] |
| Ab | Ab Bb C Db Eb F G Ab | 3 4 1 2 3 1 2 3 (majority) | 3 4 1 2 3 1 2 3 4 1 2 3 1 2 3 | 3 2 1 4 3 2 1 3 (majority) | 3 2 1 4 3 2 1 3 2 1 4 3 2 1 3 | ps_major, pkg_ab, cwu, masterpiano, escadon / ps_major, pkg_ab, cwu, escadon | RH 2 3 1 2 3 1 2 3 [oktav_ab, mh_abgscs] ; LH 3 2 1 4 3 2 1 2 [mh_abgscs] |
| Eb | Eb F G Ab Bb C D Eb | 3 1 2 3 4 1 2 3 (majority) | 3 1 2 3 4 1 2 3 1 2 3 4 1 2 3 | 3 2 1 4 3 2 1 3 (majority) | 3 2 1 4 3 2 1 3 2 1 4 3 2 1 3 | ps_major, cwu, hoffman_ebmaj, hoffman_eb2, masterpiano, escadon / ps_major, cwu, hoffman_ebmaj, hoffman_eb2, escadon | RH 2 1 2 3 4 1 2 3 [mh_ebfsbb] ; LH 3 2 1 4 3 2 1 2 [mh_ebfsbb] |
| Bb | Bb C D Eb F G A Bb | 2 1 2 3 1 2 3 4 (majority) | 4 1 2 3 1 2 3 4 1 2 3 1 2 3 4 | 3 2 1 4 3 2 1 3 (majority) | 3 2 1 4 3 2 1 3 2 1 4 3 2 1 3 | ps_major, musicnotes_bb, oktav_bb, masterpiano, mh_ebfsbb / ps_major, cwu, hoffman_bb2, escadon | RH 4 1 2 3 1 2 3 4 [cwu, hoffman_bb2, oktav_bb, pkg_bb, ps_fingerings, escadon] ; RH 2 oct 2 1 2 3 1 2 3 4 1 2 3 1 2 3 4 [ps_major, musicnotes_bb, oktav_bb, masterpiano, mh_ebfsbb] ; LH 3 2 1 4 3 2 1 2 [mh_ebfsbb, musicnotes_bb] |
| F | F G A Bb C D E F | 1 2 3 4 1 2 3 4 | 1 2 3 4 1 2 3 1 2 3 4 1 2 3 4 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | ps_major, cwu, mh_bf, hoffman_f2, escadon / ps_major, cwu, mh_bf, hoffman_f2, escadon |  |

### Harmonic minor scales

One octave ascending, then two octaves ascending. Descending is the exact reverse. Source keys are listed under Sources below.

| Key | Notes | RH 1 oct | RH 2 oct | LH 1 oct | LH 2 oct | Sources (RH / LH) | Alternatives (RH / LH, 1 oct unless noted) |
|---|---|---|---|---|---|---|---|
| A | A B C D E F G# A | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | ps_harmonic, cwu, mh_cgdae, escadon, hoffman_adg / ps_harmonic, cwu, mh_cgdae, escadon, hoffman_adg |  |
| E | E F# G A B C D# E | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | ps_harmonic, cwu, mh_cgdae, escadon / ps_harmonic, cwu, mh_cgdae, escadon |  |
| B | B C# D E F# G A# B | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 4 3 2 1 4 3 2 1 | 4 3 2 1 4 3 2 1 3 2 1 4 3 2 1 | ps_harmonic, cwu, mh_bf, hoffman_bm, escadon / ps_harmonic, cwu, mh_bf, hoffman_bm, escadon |  |
| F# | F# G# A B C# D E# F# | 2 3 1 2 3 1 2 3 (majority) | 2 3 1 2 3 1 2 3 4 1 2 3 1 2 3 | 4 3 2 1 3 2 1 4 (majority) | 4 3 2 1 3 2 1 4 3 2 1 3 2 1 4 | ps_harmonic, mh_ebfsbb, masterpiano / ps_harmonic, masterpiano, escadon | RH 3 4 1 2 3 1 2 3 [hoffman_fsm, escadon] ; LH 4 3 2 1 3 2 1 2 [mh_ebfsbb] |
| C# | C# D# E F# G# A B# C# | 3 4 1 2 3 1 2 3 (majority) | 3 4 1 2 3 1 2 3 4 1 2 3 1 2 3 | 3 2 1 4 3 2 1 3 (majority) | 3 2 1 4 3 2 1 3 2 1 4 3 2 1 3 | ps_harmonic, masterpiano, escadon / ps_harmonic, masterpiano, escadon | RH 2 3 1 2 3 1 2 3 [mh_abgscs] ; LH 3 2 1 4 3 2 1 2 [mh_abgscs] |
| G# | G# A# B C# D# E Fx G# | 3 4 1 2 3 1 2 3 (tie) | 3 4 1 2 3 1 2 3 4 1 2 3 1 2 3 | 3 2 1 4 3 2 1 3 (majority) | 3 2 1 4 3 2 1 3 2 1 4 3 2 1 3 | hoffman_gsm, masterpiano, escadon / ps_harmonic, hoffman_gsm, masterpiano, escadon | RH 2 3 1 2 3 1 2 3 [ps_harmonic, mh_abgscs] ; LH 3 2 1 4 3 2 1 2 [mh_abgscs] |
| Eb | Eb F Gb Ab Bb Cb D Eb | 3 1 2 3 4 1 2 3 (majority) | 3 1 2 3 4 1 2 3 1 2 3 4 1 2 3 | 2 1 4 3 2 1 3 2 | 2 1 4 3 2 1 3 2 1 4 3 2 1 3 2 | ps_harmonic, masterpiano, escadon / ps_harmonic, mh_bf, masterpiano, escadon | RH 2 1 2 3 4 1 2 3 [mh_bf] |
| Bb | Bb C Db Eb F Gb A Bb | 2 1 2 3 1 2 3 4 (majority) | 2 1 2 3 1 2 3 4 1 2 3 1 2 3 4 | 2 1 3 2 1 4 3 2 | 2 1 3 2 1 4 3 2 1 3 2 1 4 3 2 | ps_harmonic, mh_bf, masterpiano / ps_harmonic, mh_bf, masterpiano, escadon | RH 4 1 2 3 1 2 3 4 [escadon] |
| F | F G Ab Bb C Db E F | 1 2 3 4 1 2 3 4 | 1 2 3 4 1 2 3 1 2 3 4 1 2 3 4 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | ps_harmonic, cwu, mh_bf, escadon / ps_harmonic, cwu, mh_bf, escadon |  |
| C | C D Eb F G Ab B C | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | ps_harmonic, cwu, mh_cgdae, escadon, hoffman_cm / ps_harmonic, cwu, mh_cgdae, escadon, hoffman_cm |  |
| G | G A Bb C D Eb F# G | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | ps_harmonic, cwu, mh_cgdae, escadon, hoffman_adg / ps_harmonic, cwu, mh_cgdae, escadon, hoffman_adg |  |
| D | D E F G A Bb C# D | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | ps_harmonic, cwu, mh_cgdae, escadon, hoffman_adg / ps_harmonic, cwu, mh_cgdae, escadon, hoffman_adg |  |

### Melodic minor scales, ascending (raised 6th and 7th)

One octave ascending, then two octaves ascending. Descending is the exact reverse. Source keys are listed under Sources below.

| Key | Notes | RH 1 oct | RH 2 oct | LH 1 oct | LH 2 oct | Sources (RH / LH) | Alternatives (RH / LH, 1 oct unless noted) |
|---|---|---|---|---|---|---|---|
| A | A B C D E F# G# A | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | escadon, masterpiano / escadon, masterpiano |  |
| E | E F# G A B C# D# E | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | escadon, masterpiano / escadon, masterpiano |  |
| B | B C# D E F# G# A# B | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 4 3 2 1 4 3 2 1 | 4 3 2 1 4 3 2 1 3 2 1 4 3 2 1 | escadon, masterpiano, hoffman_bm / escadon, masterpiano, hoffman_bm |  |
| F# | F# G# A B C# D# E# F# | 2 3 1 2 3 4 1 2 | 2 3 1 2 3 4 1 2 3 1 2 3 4 1 2 | 4 3 2 1 3 2 1 4 | 4 3 2 1 3 2 1 4 3 2 1 3 2 1 4 | escadon, masterpiano / escadon, masterpiano |  |
| C# | C# D# E F# G# A# B# C# | 2 3 1 2 3 4 1 2 (tie) | 2 3 1 2 3 4 1 2 3 1 2 3 4 1 2 | 3 2 1 4 3 2 1 3 | 3 2 1 4 3 2 1 3 2 1 4 3 2 1 3 | escadon / escadon, masterpiano | RH 3 4 1 2 3 4 1 2 [masterpiano] |
| G# | G# A# B C# D# E# Fx G# | 3 4 1 2 3 1 2 3 | 3 4 1 2 3 1 2 3 4 1 2 3 1 2 3 | 3 2 1 4 3 2 1 3 | 3 2 1 4 3 2 1 3 2 1 4 3 2 1 3 | hoffman_gsm, masterpiano, escadon / hoffman_gsm, masterpiano, escadon |  |
| Eb | Eb F Gb Ab Bb C D Eb | 3 1 2 3 4 1 2 3 | 3 1 2 3 4 1 2 3 1 2 3 4 1 2 3 | 2 1 4 3 2 1 3 2 | 2 1 4 3 2 1 3 2 1 4 3 2 1 3 2 | escadon, masterpiano / escadon, masterpiano |  |
| Bb | Bb C Db Eb F G A Bb | 2 1 2 3 1 2 3 4 (majority) | 2 1 2 3 1 2 3 4 1 2 3 1 2 3 4 | 2 1 3 2 1 4 3 2 | 2 1 3 2 1 4 3 2 1 3 2 1 4 3 2 | masterpiano / escadon, masterpiano | RH 4 1 2 3 1 2 3 4 [escadon] |
| F | F G Ab Bb C D E F | 1 2 3 4 1 2 3 4 | 1 2 3 4 1 2 3 1 2 3 4 1 2 3 4 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | escadon, masterpiano / escadon, masterpiano |  |
| C | C D Eb F G A B C | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | escadon, masterpiano / escadon, masterpiano |  |
| G | G A Bb C D E F# G | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | escadon, masterpiano / escadon, masterpiano |  |
| D | D E F G A B C# D | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | escadon, masterpiano / escadon, masterpiano |  |

### Melodic minor scales, descending (natural-minor notes)

Shown in descending order from the top tonic, one octave and two octaves.

| Key | Notes (descending) | RH 1 oct | RH 2 oct | LH 1 oct | LH 2 oct | Sources (RH / LH) | Alternatives (RH / LH) |
|---|---|---|---|---|---|---|---|
| A | A G F E D C B A | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | ps_natural, escadon, masterpiano, hoffman_adg / ps_natural, escadon, masterpiano, hoffman_adg |  |
| E | E D C B A G F# E | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | ps_natural, escadon, masterpiano / ps_natural, escadon, masterpiano |  |
| B | B A G F# E D C# B | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | 1 2 3 4 1 2 3 4 | 1 2 3 4 1 2 3 1 2 3 4 1 2 3 4 | ps_natural, escadon, masterpiano, hoffman_bm / ps_natural, escadon, masterpiano, hoffman_bm |  |
| F# | F# E D C# B A G# F# | 3 2 1 3 2 1 3 2 (majority) | 3 2 1 3 2 1 4 3 2 1 3 2 1 3 2 | 4 1 2 3 1 2 3 4 | 4 1 2 3 1 2 3 4 1 2 3 1 2 3 4 | ps_natural, pkg_fsm, oktav_fsm, masterpiano / ps_natural, pkg_fsm, masterpiano, escadon | RH 3 2 1 3 2 1 4 3 [hoffman_fsm, escadon] |
| C# | C# B A G# F# E D# C# | 3 2 1 3 2 1 4 3 (majority) | 3 2 1 3 2 1 4 3 2 1 3 2 1 4 3 | 3 1 2 3 4 1 2 3 | 3 1 2 3 4 1 2 3 1 2 3 4 1 2 3 | ps_natural, pkg_csm, masterpiano, escadon / ps_natural, pkg_csm, masterpiano | RH 3 2 1 3 2 1 3 2 [oktav_csm] |
| G# | G# F# E D# C# B A# G# | 3 2 1 3 2 1 4 3 (majority) | 3 2 1 3 2 1 4 3 2 1 3 2 1 4 3 | 3 4 1 2 3 1 2 3 | 3 4 1 2 3 1 2 3 4 1 2 3 1 2 3 | ps_natural, hoffman_gsm, masterpiano, escadon / ps_natural, hoffman_gsm, masterpiano, escadon | RH 3 2 1 3 2 1 3 2 [oktav_gsm] |
| Eb | Eb Db Cb Bb Ab Gb F Eb | 3 2 1 4 3 2 1 3 | 3 2 1 4 3 2 1 3 2 1 4 3 2 1 3 | 2 3 1 2 3 4 1 2 | 2 3 1 2 3 4 1 2 3 1 2 3 4 1 2 | ps_natural, pkg_ebm, masterpiano, escadon / ps_natural, pkg_ebm, masterpiano, escadon |  |
| Bb | Bb Ab Gb F Eb Db C Bb | 4 3 2 1 3 2 1 2 (majority) | 4 3 2 1 3 2 1 4 3 2 1 3 2 1 2 | 2 3 4 1 2 3 1 2 | 2 3 4 1 2 3 1 2 3 4 1 2 3 1 2 | ps_natural, masterpiano, mh_bf / ps_natural, masterpiano, mh_bf, escadon | RH 4 3 2 1 3 2 1 4 [escadon] |
| F | F Eb Db C Bb Ab G F | 4 3 2 1 4 3 2 1 | 4 3 2 1 4 3 2 1 3 2 1 4 3 2 1 | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | ps_natural, escadon, masterpiano / ps_natural, escadon, masterpiano |  |
| C | C Bb Ab G F Eb D C | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | ps_natural, escadon, masterpiano, hoffman_cm / ps_natural, escadon, masterpiano, hoffman_cm |  |
| G | G F Eb D C Bb A G | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | ps_natural, escadon, masterpiano, hoffman_adg / ps_natural, escadon, masterpiano, hoffman_adg |  |
| D | D C Bb A G F E D | 5 4 3 2 1 3 2 1 | 5 4 3 2 1 3 2 1 4 3 2 1 3 2 1 | 1 2 3 1 2 3 4 5 | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | ps_natural, escadon, masterpiano, hoffman_adg / ps_natural, escadon, masterpiano, hoffman_adg |  |

### Major triad arpeggios (root position)

Two octaves ascending; descending is the exact reverse.

| Key | Chord | RH | LH | Sources (RH / LH) | Alternatives |
|---|---|---|---|---|---|
| C | C | 1 2 3 1 2 3 5 | 5 4 2 1 4 2 1 (majority) | escadon, kelley_arp, cwu / escadon, kelley_arp, mh_brokenchord | LH 5 3 2 1 3 2 1 [cwu] |
| G | G | 1 2 3 1 2 3 5 | 5 4 2 1 4 2 1 (majority) | escadon, kelley_arp, cwu / escadon, kelley_arp, mh_brokenchord | LH 5 3 2 1 3 2 1 [cwu] |
| D | D | 1 2 3 1 2 3 5 | 5 3 2 1 3 2 1 | escadon, kelley_arp / escadon, kelley_arp, hoffman_d |  |
| A | A | 1 2 3 1 2 3 5 | 5 3 2 1 3 2 1 | escadon, kelley_arp / escadon, kelley_arp |  |
| E | E | 1 2 3 1 2 3 5 | 5 3 2 1 3 2 1 | escadon, kelley_arp / escadon, kelley_arp, hoffman_e |  |
| B | B | 1 2 3 1 2 3 5 | 5 3 2 1 3 2 1 | escadon, kelley_arp / escadon, kelley_arp |  |
| F# | F# | 1 2 3 1 2 3 5 | 5 4 2 1 4 2 1 (tie) | escadon, kelley_arp / escadon | LH 5 3 2 1 3 2 1 [kelley_arp] |
| Db | Db | 4 1 2 4 1 2 4 (tie) | 2 1 4 2 1 4 2 | cwu / escadon, kelley_arp, cwu | RH 2 1 2 4 1 2 4 [kelley_arp]; 3 1 2 4 1 2 4 [escadon] |
| Ab | Ab | 4 1 2 4 1 2 4 (tie) | 2 1 4 2 1 4 2 | cwu / escadon, kelley_arp, cwu | RH 2 1 2 4 1 2 4 [kelley_arp]; 3 1 2 4 1 2 4 [escadon] |
| Eb | Eb | 4 1 2 4 1 2 4 (majority) | 2 1 4 2 1 4 2 | cwu, hoffman_eb2 / escadon, kelley_arp, cwu, hoffman_eb2 | RH 2 1 2 4 1 2 4 [kelley_arp]; 3 1 2 4 1 2 4 [escadon] |
| Bb | Bb | 4 1 2 4 1 2 4 (tie) | 3 2 1 3 2 1 3 | cwu, hoffman_bb2 / escadon, kelley_arp, cwu | RH 2 1 2 4 1 2 4 [escadon, kelley_arp] |
| F | F | 1 2 3 1 2 3 5 | 5 4 2 1 4 2 1 (majority) | escadon, kelley_arp, cwu, hoffman_f2 / escadon, kelley_arp, mh_brokenchord, hoffman_f2 | LH 5 3 2 1 3 2 1 [cwu] |

### Minor triad arpeggios (root position)

Two octaves ascending; descending is the exact reverse.

| Key | Chord | RH | LH | Sources (RH / LH) | Alternatives |
|---|---|---|---|---|---|
| A | Am | 1 2 3 1 2 3 5 | 5 4 2 1 4 2 1 (majority) | escadon, kelley_arp, cwu, hoffman_adg / escadon, kelley_arp, cwu, hoffman_adg | LH 5 3 2 1 3 2 1 [cwu] |
| E | Em | 1 2 3 1 2 3 5 | 5 4 2 1 4 2 1 (majority) | escadon, kelley_arp, cwu / escadon, kelley_arp, cwu | LH 5 3 2 1 3 2 1 [cwu] |
| B | Bm | 1 2 3 1 2 3 5 | 5 4 2 1 4 2 1 | escadon, kelley_arp, hoffman_bm / escadon, kelley_arp, hoffman_bm |  |
| F# | F#m | 2 1 2 4 1 2 4 (tie) | 2 1 4 2 1 4 2 | kelley_arp / escadon, kelley_arp | RH 3 1 2 4 1 2 4 [escadon] |
| C# | C#m | 2 1 2 4 1 2 4 (tie) | 2 1 4 2 1 4 2 | kelley_arp / escadon, kelley_arp | RH 3 1 2 4 1 2 4 [escadon] |
| G# | G#m | 2 1 2 4 1 2 4 (tie) | 2 1 4 2 1 4 2 | kelley_arp / escadon, kelley_arp | RH 3 1 2 4 1 2 4 [escadon] |
| Eb | Ebm | 1 2 3 1 2 3 5 | 5 4 2 1 4 2 1 | escadon, kelley_arp / escadon, kelley_arp |  |
| Bb | Bbm | 2 3 1 2 3 1 2 | 3 2 1 3 2 1 3 | escadon, kelley_arp / escadon, kelley_arp |  |
| F | Fm | 1 2 3 1 2 3 5 | 5 4 2 1 4 2 1 | escadon, kelley_arp / escadon, kelley_arp |  |
| C | Cm | 1 2 3 1 2 3 5 | 5 4 2 1 4 2 1 | escadon, kelley_arp, hoffman_cm / escadon, kelley_arp, hoffman_cm |  |
| G | Gm | 1 2 3 1 2 3 5 | 5 4 2 1 4 2 1 | escadon, kelley_arp, hoffman_adg / escadon, kelley_arp, hoffman_adg |  |
| D | Dm | 1 2 3 1 2 3 5 | 5 4 2 1 4 2 1 (majority) | escadon, kelley_arp, cwu, hoffman_adg / escadon, kelley_arp, cwu, hoffman_adg | LH 5 3 2 1 3 2 1 [cwu] |

### Dominant seventh arpeggios (by key; chord on the dominant)

Two octaves ascending; descending is the exact reverse.

| Key | Chord | RH | LH | Sources (RH / LH) | Alternatives |
|---|---|---|---|---|---|
| C | G7 | 1 2 3 4 1 2 3 4 5 | 5 4 3 2 1 4 3 2 1 | roskell_dom7 / roskell_dom7 |  |
| G | D7 | 1 2 3 4 1 2 3 4 5 | 5 4 3 2 1 4 3 2 1 | roskell_dom7 / roskell_dom7 |  |
| D | A7 | 1 2 3 4 1 2 3 4 5 | 5 4 3 2 1 4 3 2 1 | roskell_dom7 / roskell_dom7 |  |
| A | E7 | 1 2 3 4 1 2 3 4 5 | 5 4 3 2 1 4 3 2 1 | roskell_dom7 / roskell_dom7 |  |
| E | B7 | 1 2 3 4 1 2 3 4 5 | 5 4 3 2 1 4 3 2 1 | roskell_dom7 / roskell_dom7 |  |
| B | F#7 | 2 3 4 1 2 3 4 1 2 (rule) | 4 3 2 1 4 3 2 1 4 (rule) | roskell_dom7, fergus_black / roskell_dom7, fergus_black |  |
| F# | C#7 | 2 3 4 1 2 3 4 1 2 (rule) | 4 3 2 1 4 3 2 1 4 (rule) | roskell_dom7, fergus_black / roskell_dom7, fergus_black | RH 4 1 2 3 4 1 2 3 4 [roskell_dom7] ; LH 2 1 4 3 2 1 4 3 2 [roskell_dom7] |
| Db | Ab7 | 4 1 2 3 4 1 2 3 4 (rule) | 2 1 4 3 2 1 4 3 2 (rule) | roskell_dom7, fergus_black / roskell_dom7, fergus_black |  |
| Ab | Eb7 | 4 1 2 3 4 1 2 3 4 (rule) | 2 1 4 3 2 1 4 3 2 (rule) | roskell_dom7, fergus_black / roskell_dom7, fergus_black |  |
| Eb | Bb7 | 4 1 2 3 4 1 2 3 4 (rule) | 3 2 1 4 3 2 1 4 3 (rule) | roskell_dom7, fergus_black / roskell_dom7, fergus_black |  |
| Bb | F7 | 1 2 3 4 1 2 3 4 5 | 5 4 3 2 1 4 3 2 1 | roskell_dom7 / roskell_dom7 |  |
| F | C7 | 1 2 3 4 1 2 3 4 5 | 5 4 3 2 1 4 3 2 1 | roskell_dom7 / roskell_dom7 |  |

### Diminished seventh arpeggios (by starting note)

Two octaves ascending; descending is the exact reverse.

| Key | Chord | RH | LH | Sources (RH / LH) | Alternatives |
|---|---|---|---|---|---|
| C | Cdim7 | 1 2 3 4 1 2 3 4 5 | 5 4 3 2 1 4 3 2 1 | fergus_black, hanon, roskell_dim7 / fergus_black, hanon, roskell_dim7 |  |
| C# | C#dim7 | 4 1 2 3 4 1 2 3 4 (rule) | 3 2 1 4 3 2 1 4 3 (rule) | fergus_black, roskell_dim7 / fergus_black, roskell_dim7 |  |
| D | Ddim7 | 1 2 3 4 1 2 3 4 5 | 5 4 3 2 1 4 3 2 1 | fergus_black, hanon, roskell_dim7 / fergus_black, hanon, roskell_dim7 |  |
| Eb | Ebdim7 | 3 4 1 2 3 4 1 2 3 (rule) | 4 3 2 1 4 3 2 1 4 (rule) | fergus_black, roskell_dim7 / fergus_black, roskell_dim7 |  |
| E | Edim7 | 1 2 3 4 1 2 3 4 5 | 5 4 3 2 1 4 3 2 1 | fergus_black, hanon, roskell_dim7 / fergus_black, hanon, roskell_dim7 |  |
| F | Fdim7 | 1 2 3 4 1 2 3 4 5 | 5 4 3 2 1 4 3 2 1 | fergus_black, hanon, roskell_dim7 / fergus_black, hanon, roskell_dim7 |  |
| F# | F#dim7 | 4 1 2 3 4 1 2 3 4 (rule) | 3 2 1 4 3 2 1 4 3 (rule) | fergus_black, roskell_dim7 / fergus_black, roskell_dim7 |  |
| G | Gdim7 | 1 2 3 4 1 2 3 4 5 | 5 4 3 2 1 4 3 2 1 | fergus_black, hanon, roskell_dim7 / fergus_black, hanon, roskell_dim7 |  |
| Ab | Abdim7 | 4 1 2 3 4 1 2 3 4 (rule) | 4 3 2 1 4 3 2 1 4 (rule) | fergus_black, roskell_dim7 / fergus_black, roskell_dim7 |  |
| A | Adim7 | 1 2 3 4 1 2 3 4 5 | 5 4 3 2 1 4 3 2 1 | fergus_black, hanon, roskell_dim7 / fergus_black, hanon, roskell_dim7 |  |
| Bb | Bbdim7 | 3 4 1 2 3 4 1 2 3 (rule) | 4 3 2 1 4 3 2 1 4 (rule) | fergus_black, roskell_dim7 / fergus_black, roskell_dim7 |  |
| B | Bdim7 | 1 2 3 4 1 2 3 4 5 | 5 4 3 2 1 4 3 2 1 | fergus_black, hanon, roskell_dim7 / fergus_black, hanon, roskell_dim7 |  |

### Chromatic scales

Two octaves ascending from each starting note; descending is the exact reverse.

| Start | RH | LH |
|---|---|---|
| C | 1 3 1 3 1 2 3 1 3 1 3 1 2 3 1 3 1 2 3 1 3 1 3 1 2 | 1 3 1 3 2 1 3 1 3 1 3 2 1 3 1 3 2 1 3 1 3 1 3 2 1 |
| C# | 3 1 3 1 2 3 1 3 1 3 1 2 3 1 3 1 2 3 1 3 1 3 1 2 3 | 3 1 3 2 1 3 1 3 1 3 2 1 3 1 3 2 1 3 1 3 1 3 2 1 3 |
| D | 1 3 1 2 3 1 3 1 3 1 2 3 1 3 1 2 3 1 3 1 3 1 2 3 1 | 1 3 2 1 3 1 3 1 3 2 1 3 1 3 2 1 3 1 3 1 3 2 1 3 1 |
| Eb | 3 1 2 3 1 3 1 3 1 2 3 1 3 1 2 3 1 3 1 3 1 2 3 1 3 | 3 2 1 3 1 3 1 3 2 1 3 1 3 2 1 3 1 3 1 3 2 1 3 1 3 |
| E | 1 2 3 1 3 1 3 1 2 3 1 3 1 2 3 1 3 1 3 1 2 3 1 3 1 | 2 1 3 1 3 1 3 2 1 3 1 3 2 1 3 1 3 1 3 2 1 3 1 3 1 |
| F | 1 3 1 3 1 3 1 2 3 1 3 1 2 3 1 3 1 3 1 2 3 1 3 1 2 | 1 3 1 3 1 3 2 1 3 1 3 2 1 3 1 3 1 3 2 1 3 1 3 2 1 |
| F# | 3 1 3 1 3 1 2 3 1 3 1 2 3 1 3 1 3 1 2 3 1 3 1 2 3 | 3 1 3 1 3 2 1 3 1 3 2 1 3 1 3 1 3 2 1 3 1 3 2 1 3 |
| G | 1 3 1 3 1 2 3 1 3 1 2 3 1 3 1 3 1 2 3 1 3 1 2 3 1 | 1 3 1 3 2 1 3 1 3 2 1 3 1 3 1 3 2 1 3 1 3 2 1 3 1 |
| Ab | 3 1 3 1 2 3 1 3 1 2 3 1 3 1 3 1 2 3 1 3 1 2 3 1 3 | 3 1 3 2 1 3 1 3 2 1 3 1 3 1 3 2 1 3 1 3 2 1 3 1 3 |
| A | 1 3 1 2 3 1 3 1 2 3 1 3 1 3 1 2 3 1 3 1 2 3 1 3 1 | 1 3 2 1 3 1 3 2 1 3 1 3 1 3 2 1 3 1 3 2 1 3 1 3 1 |
| Bb | 3 1 2 3 1 3 1 2 3 1 3 1 3 1 2 3 1 3 1 2 3 1 3 1 3 | 3 2 1 3 1 3 2 1 3 1 3 1 3 2 1 3 1 3 2 1 3 1 3 1 3 |
| B | 1 2 3 1 3 1 2 3 1 3 1 3 1 2 3 1 3 1 2 3 1 3 1 3 1 | 2 1 3 1 3 2 1 3 1 3 1 3 2 1 3 1 3 2 1 3 1 3 1 3 1 |

### Source keys used in the tables

| Key | Source |
|---|---|
| escadon | [Fingering charts, piano scales: 4th-finger placement, both hands, for every major, natural, harmonic and melodic minor scale, plus a root-position arpeggio chart (chart of Prof. Escadon, University of Miami, c. 1999, published by B. Rosenberg)](https://www.cs.miami.edu/~burt/music/finger-charts.html) |
| ps_major | [pianoscales.org, Piano Major Scales (RH and LH fingering per key)](https://www.pianoscales.org/major.html) |
| ps_natural | [pianoscales.org, Piano Minor Scales (natural minor, RH and LH fingering per key)](https://www.pianoscales.org/minor.html) |
| ps_harmonic | [pianoscales.org, Piano Harmonic Minor Scales (RH and LH fingering per key)](https://www.pianoscales.org/minor-harmonic.html) |
| ps_fingerings | [pianoscales.org, Fingerings: B-flat major RH may start on 2, 3 or 4; 4 suits many octaves](https://www.pianoscales.org/fingerings.html) |
| cwu | [Commonwealth University (Mansfield) Dept. of Music, piano handout for new students: scale and arpeggio fingering patterns (two-octave)](https://commonwealthu.edu/documents/music-piano-handout-new-students-mansfield) |
| mh_cgdae | [R. Beauchamp, Music & Health piano syllabus: fingering for C, G, D, A, E major and minor (two-octave)](https://musicandhealth.co.uk/scales_examples/fingering.htm) |
| mh_bfscs | [R. Beauchamp, Music & Health piano syllabus: fingering for B, F-sharp and C-sharp major (two-octave)](https://musicandhealth.co.uk/scales_examples/fingering1.htm) |
| mh_bf | [R. Beauchamp, Music & Health piano syllabus: fingering for B and F major and minor, B-flat and E-flat minor (two-octave)](https://musicandhealth.co.uk/scales_examples/fingering2.htm) |
| mh_abgscs | [R. Beauchamp, Music & Health piano syllabus: fingering for A-flat major, G-sharp minor and C-sharp minor (two-octave)](https://musicandhealth.co.uk/scales_examples/fingering3.htm) |
| mh_ebfsbb | [R. Beauchamp, Music & Health piano syllabus: fingering for E-flat major, F-sharp minor and B-flat major (two-octave)](https://musicandhealth.co.uk/scales_examples/fingering4.htm) |
| mh_brokenchord | [R. Beauchamp, Music & Health piano syllabus: broken-chord fingering (argues LH 5-4-2-1 rather than 5-3-2-1 for C major)](https://musicandhealth.co.uk/scales_examples/example.htm) |
| hoffman_ebmaj | [Hoffman Academy, E-flat major scale (one-octave)](https://hoffmanacademy.com/blog/e-flat-major-scale-on-piano) |
| hoffman_eb2 | [Hoffman Academy lesson: two-octave scales, arpeggios and chords in E-flat major](https://app.hoffmanacademy.com/lessons/piano/scales-arpeggios-chords-in-e-flat-major/video/) |
| hoffman_bb2 | [Hoffman Academy lesson: B-flat major two-octave scale and arpeggio](https://app.hoffmanacademy.com/lessons/piano/b-flat-major-scale-arpeggio/video/) |
| hoffman_f2 | [Hoffman Academy lesson: two-octave scales, arpeggios and chords in F major](https://app.hoffmanacademy.com/lessons/piano/scales-arpeggios-chords-in-f-major/video/) |
| hoffman_d | [Hoffman Academy lesson: D major scale and arpeggio](https://app.hoffmanacademy.com/lessons/piano/d-major-scale-arpeggio/video/) |
| hoffman_e | [Hoffman Academy lesson: E major scale, arpeggio and chords](https://app.hoffmanacademy.com/lessons/piano/e-major-scale-arpeggio-diatonic-chords/video/) |
| hoffman_bm | [Hoffman Academy lesson: B minor scales, arpeggios and chords](https://app.hoffmanacademy.com/lessons/piano/b-minor-scales-arpeggios-chords/video/) |
| hoffman_cm | [Hoffman Academy lesson: C minor scales and arpeggio](https://app.hoffmanacademy.com/lessons/piano/c-minor-scales-arpeggio/video/) |
| hoffman_adg | [Hoffman Academy lesson: two-octave minor scales and arpeggios in A, D and G](https://app.hoffmanacademy.com/lessons/piano/two-octave-minor-scales-and-arpeggios-in-a-d-g/video/) |
| hoffman_gsm | [Hoffman Academy, G-sharp minor scale (natural; states the harmonic/melodic LH change)](https://www.hoffmanacademy.com/blog/g-sharp-minor-scale-piano) |
| hoffman_fsm | [Hoffman Academy, F-sharp minor scale (natural, one-octave)](https://www.hoffmanacademy.com/blog/f-sharp-minor-scale-piano) |
| hoffman_chromatic | [Hoffman Academy lesson: chromatic scale](https://app.hoffmanacademy.com/lessons/piano/chromatic-scale/video/) |
| pkg_bb | [piano-keyboard-guide.com, B-flat major scale](https://www.piano-keyboard-guide.com/b-flat-major-scale.html) |
| pkg_ab | [piano-keyboard-guide.com, A-flat major scale](https://www.piano-keyboard-guide.com/a-flat-major-scale.html) |
| pkg_csm | [piano-keyboard-guide.com, C-sharp minor scale (natural)](https://www.piano-keyboard-guide.com/c-sharp-minor-scale.html) |
| pkg_ebm | [piano-keyboard-guide.com, E-flat minor scale (natural)](https://www.piano-keyboard-guide.com/e-flat-minor-scale.html) |
| pkg_fsm | [piano-keyboard-guide.com, F-sharp minor scale (natural)](https://www.piano-keyboard-guide.com/?p=426) |
| pkg_chromatic | [piano-keyboard-guide.com, How to play the chromatic scale (RH 1313 123 1313 12, LH 1313 213 1313 21 from C)](https://www.piano-keyboard-guide.com/?p=254) |
| oktav_bb | [oktav.com, B-flat major scale (RH starts on 2 for one octave, on 4 for more than one)](https://www.oktav.com/en/c/b-flat-major-scale-piano) |
| oktav_ab | [oktav.com, A-flat major scale](https://www.oktav.com/en/c/a-flat-major-scale-piano) |
| oktav_csm | [oktav.com, C-sharp minor scale (natural)](https://www.oktav.com/en/c/c-sharp-minor-scale-piano) |
| oktav_gsm | [oktav.com, G-sharp minor scale (natural)](https://www.oktav.com/en/c/g-sharp-minor-scale-piano) |
| oktav_fsm | [oktav.com, F-sharp minor scale (natural)](https://www.oktav.com/en/c/f-sharp-minor-scale-piano) |
| musicnotes_bb | [Musicnotes, Scale guide: how to play B-flat major on piano (RH 2 1 2 3 1 2 3 4, LH 3 2 1 4 3 2 1 2)](https://www.musicnotes.com/blog/scale-guide-how-to-play-b-flat-major-on-piano) |
| masterpiano | [MasterPiano, Piano scales: fingering chart for all 12 major and 12 minor scales](https://www.masterpiano.com/piano-scales) |
| kelley_arp | [R. T. Kelley, Guide to Learning Piano: arpeggio fingering chart (standard accepted root-position fingerings, all keys)](https://robertkelleyphd.com/home/arpfing.htm) |
| fergus_black | [F. Black, Guide to Playing Diminished Seventh Arpeggios for ABRSM Grade 8 Piano (2011): Hanon's diminished sevenths start on white notes with the thumbs together on the first note of each group of four; black-note starts put the thumbs on different white notes](https://www.scribd.com/doc/264965107/Diminished-7th-Guide) |
| roskell_dom7 | [P. Roskell, The Art of Piano Fingering, ch. 11, Arpeggios of the dominant seventh (basic fingering 1 2 3 4; charts by key)](https://dfp.informance.biz/content/pages/6-the-art-of-piano-fingering/447-chapter-11-arpeggios-of-the-dominant-seventh) |
| roskell_dim7 | [P. Roskell, The Art of Piano Fingering, ch. 12, Arpeggios of the diminished seventh (basic fingering 1 2 3 4)](https://www.informance.biz/wiki/6-the-art-of-piano-fingering/448-chapter-12-arpeggios-of-the-diminished-seventh) |
| hanon | [C.-L. Hanon, The Virtuoso Pianist (1873), Part II: scales, arpeggios and seventh-chord arpeggios in all keys (No. 42 = diminished sevenths); public-domain scans](https://imslp.org/wiki/The_Virtuoso_Pianist_(Hanon,_Charles-Louis)) |

<!-- END GENERATED TABLES -->
