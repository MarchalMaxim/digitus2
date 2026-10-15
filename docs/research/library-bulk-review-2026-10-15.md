# Bulk library independent review — 2026-10-15

Independent review approves the final 91 additions after the holds and
metadata corrections below. The resulting library contains 253 pieces.
Downloaded candidates remain distinct from accepted library entries.
Complete final verification passed all 11 steps (858 engine, 300 web and
177 browser tests), with 1,715 content tests passing separately. The bulk
expansion report records the release logs.

## Acquisition boundary

The harvest inventories 608 unique Mutopia editions (669 alternative source
main-file rows). It acquired 733 MIDI files for 607 editions, with individual
SHA-256 hashes and authoritative RDF metadata. One Debussy anthology has no
published MIDI. All 608 RDF licences permit redistribution: 369 public-domain,
72 CC BY and 167 CC BY-SA editions. Attribution and share-alike obligations
remain applicable to accepted derivatives. Canonical reuse policy:
<https://www.mutopiaproject.org/legal.html>.

Three declarations mention an organ alternative and require explicit pedal
review; they are held from automatic piano promotion. The remaining 605
unique declarations identify solo piano or other keyboard instruments.

## Promotion audit findings

- The existing quality gate verifies MIDI generated from the converted LilyPond
  source, but does not independently require the published Mutopia MIDI to
  match. Bulk promotion must require both checks to be present and exact.
- ZIP-contained published MIDI paths must retain their relative subdirectory;
  reducing them to a basename silently omits the check in `build_mutopia`.
- Unsupported notation checks must inspect included sibling source files as
  well as the selected main file. Literal musicglyph ornaments and fermatas
  require review instead of automatic acceptance.
- A five-level heuristic cannot independently establish the difficulty of
  advanced originals. Advanced level 6 placement requires an explicit policy;
  teaching material needs contextual review rather than blindly copying a
  measured proposal.
- Anthologies and sources containing several scores need accurate movement
  labels. A first-score conversion must not claim to represent an entire
  multi-movement edition.

The pipeline implementer addressed these findings before final acceptance:
both MIDI checks are mandatory, archive paths are retained, included files
are screened, mixed organ declarations are held, and advanced repertoire
uses an explicit conservative level 6 policy. No converter exceptions,
excerpts or per-piece source patches were introduced to force acceptance.

## Provisional visual sample

Twelve provisional passes were rendered beside the LilyPond source PDFs.
The sample includes Beethoven Op. 79/I and Op. 2/1/I, Chopin Op. 33/1 and
Op. 28/3, Czerny Op. 821/1, Handel's Aylesford Ouverture, Bach BWV 1080
canons XIII–XV and BWV 515, and two anonymous Lancer quadrilles. Opening
pages were compared for rhythm, voices, ties/slurs, articulation, ornaments,
pedals and expression. All 76 strict passes available at that point had
exactly one musical score in the converter dump.

The sample found additional reasons to hold provisional passes:

| Edition | Observed discrepancy | Required action |
| --- | --- | --- |
| Handel, Aylesford Ouverture | Initial `Maestoso` exists in the source header's `meter`, but disappears from the generated score. | Hold or restore the expression using a verified source patch. |
| Anonymous, La Native | Source `Fine` disappears; terminal `D.C.` survives. | Hold or restore the navigation instruction. |
| Anonymous, Les Graces | Both source `Fine` and terminal `D.C.` disappear. | Hold or restore both navigation instructions. |
| Bach, BWV 1080 canon XIII | Source sextuplets display `6`; output displays `3` over the same six-note groups after reducing 6:4 to 3:2. | Hold or independently verify original tuplet-number preservation. |

These issues demonstrate why exact MIDI pitch/onset matching is not a
complete notation-fidelity test. Evidence is retained under ignored
`content/_build/bulk-review/`. The implementer received each finding before
final acceptance. The affected pieces were held.

The replacement sample additionally found missing `Allegro vivace` from a
textual rehearsal mark in an included Czerny file. A batch-wide comparison
of source mark text against XML held seven Op. 840 studies and Haydn's
Hob. XVI:28 second movement, whose `Trio` label disappeared. These holds
were recorded rather than waived after the numerical gates passed.

## Metadata and difficulty corrections

Composer identity is derived explicitly rather than inherited from the
first existing piece in a composer's FTP folder. In particular, Petzold's
notebook minuet must not supply the composer identity for every `BachJS`
edition. Three internal composer codes were expanded from their source
headers to Johannes Brahms, Dora Pejačević and Johann Strauss II.

The two accepted notebook exceptions carry qualified attribution:

- BWV 515: Johann Sebastian Bach (attributed). David Schulenberg discusses
  uncertain authorship and transmission in his [scholarly edition, page
  3](https://faculty.wagner.edu/david-schulenberg/files/2020/03/P225_selections.pdf).
- BWV Anh. 131: Johann Christian Bach (attributed), correcting the historical
  Mutopia label. The [IMSLP work catalogue](https://imslp.org/wiki/March_in_F_major,_W.A_22_(Bach,_Johann_Christian))
  identifies W.A 22 and records earlier attribution. Its linked Bach Digital
  record could not be read because of a site security challenge; no claim
  is made to have independently inspected that record.

No unsourced composer life dates or syllabus grades were invented.
Advanced level 6 placement is conservative, not an external grading claim.
The sole provisional Easy addition, Czerny Op. 821/5, was moved to Moderate
because its chromatic ornaments, grace notes and approximately eight
sounding notes per second exceed an appropriate first beginner placement.
That change stays within one level of the frozen heuristic.

## Targeted hairpin warning investigation

Every hairpin event in both suspect source dumps was compared with the
actual MusicXML timeline, including backups, offsets, staff and wedge
number. Neither piece lost an event or changed its musical onset. However,
directions inside polyphonic voices can be serialized out of timeline
order, which music21's sequential wedge importer cannot always pair.

| Edition | Source and XML evidence | Decision |
| --- | --- | --- |
| Beethoven Op. 31/2, II | At XML measure 96/source bar 86, the stop at quarter 259.5 precedes its start at 258.5 in document order. The actual rendered diminuendo agrees with the source; Verovio emits no warning. | Retain; document the music21 reader limitation. |
| Scriabin Op. 16/1 | At measure 4, serialized wedge number 1 stops at 10.5, stops at 9.75, then starts at 10. The renderer overlaps/mispairs adjacent source hairpins and explicitly reports an ignored hairpin. | Hold; correct event presence alone does not establish rendered fidelity. |

The Scriabin metronome is valid quarter-note MusicXML. Missing glyph boxes
in a standalone raster were not treated as an independently confirmed app
defect. The confirmed hairpin mispairing alone justified the hold.
Evidence: ignored `bulk-review/wedge-audit.json` and the two targeted source
and score PNG pairs.

## Final mechanical and app review

All final additions were checked for pinned main-source, RDF and published
MIDI hashes; identical materialized cache inputs; permitted authoritative
RDF rights; current production validation, rendering and fingering evidence;
one musical score; exactly one two-staff piano part; no pedal ambiguity;
no excerpt or patches; both MIDI pitch/onset comparisons present and exact;
zero span/law errors; embedded attribution; consistent composer and level
metadata; and the 700 KB file budget. Existing 162 manifest records,
verification records and 195 score-file hashes remain unchanged. The
coordinator and pipeline also reproduced the accepted files with the plain
build pipeline. MIDI equality here describes the pipeline's pitch/onset
comparison, not literal performed duration or expression equality.
The final independent production audit passed 2,184 checks across all 91
additions, with no failed invariant or unresolved composer-code warning.

An additional two-worker native Verovio check rendered every page of every
remaining accepted score: 91 pieces, 167 pages, 9.34 seconds, zero render
failures and zero ignored/mismatched/dropped/unmatched/invalid warnings.
Native stderr was captured per process because the toolkit's log accessor
did not expose the Scriabin warning. One separate layout warning class
remains: insufficient room for a mixed beam, followed by an explicit
above/below beam-placement fallback. It occurred 36 times, on Goldberg
variations 11 (9), 20 (18) and 28 (9). This is reported as a layout fallback,
not hidden as a font warning or described as a zero-warning corpus. The
warning does not report discarded notes, dynamics or timing. Complete logs
are in ignored `bulk-review/all-pages.json`.

The final bounded sample comprises Beethoven Op. 79/I and Op. 2/1/I;
Chopin Op. 33/1 and Op. 28/3; Haydn Hob. XVI:28/III; Czerny Op. 821/1;
Bach BWV 1080 canons XIV and XV, BWV 515 and BWV 802; Handel's Aylesford
Allegro; and Schumann Op. 68/4. Source openings were compared with generated
scores; the two longest works by measure count were also checked at their
source and generated endings. No Rachmaninoff edition passed the gates, so
none is represented as accepted or included in the app sample.

The same 12 accepted pieces were opened by real library-row clicks in
headless Chromium at 1280×900 and 360×740. All 24 opens showed fingered
scores and an enabled Play button with no page or console errors, no
horizontal overflow and exactly one red root. All 24 screenshots were
visually inspected. The Advanced library and About page were checked at
both sizes; six level controls fit the phone viewport. Two library images
were recaptured after their normal transition finished.

| Local Chromium observation | Result |
| --- | --- |
| Maximum click-to-Play-ready time across 24 opens | 1,980 ms |
| Beethoven Op. 79/I, 206 bars | 992 ms desktop; 1,927 ms phone viewport |
| Haydn Hob. XVI:28/III, 172 bars | 954 ms desktop; 1,949 ms phone viewport |
| About serialized HTML | Approximately 109 KB at both widths |
| App states checked, including library/About | 28 |

These are local unthrottled browser observations, not physical-phone
performance guarantees. The About HTML measurement is not a full-page PNG
baseline size. Browser evidence is in ignored `bulk-review/browser-report.json`;
the final release pass separately refreshed the affected About baseline.

Final admission is recorded separately from acquisition in
`content/tools/bulk-candidates.json`: 91 accepted new source directories,
428 held and 89 already represented. Alternative source-main rows identify
which main was actually selected. Acquisition status and the 733 downloaded
MIDI files are retained regardless of admission.

The final storage pass regenerated the 91 new editions with explicit
`compactXml` metadata, removing intertag indentation only. All 111 new files
reproduced byte for byte through the ordinary production builder; the
2,184 production invariants were rerun successfully and all original
records and 195 score hashes remain unchanged. The complete acquisition
evidence remains in ignored `content/_raw/bulk/inventory.json`; the committed
index retains source/RDF pins and separately regenerated catalog admission.
Offline collector coverage confirms refresh preserves those decisions.

Rights review also identified Andrew Sidwell's contemporary original work:
its embedded credit now describes the composition and engraving under
CC BY-SA 2.5 rather than incorrectly claiming a public-domain composition.
About now accurately describes public-domain or Creative Commons editions.
Its final reviewed PNG is losslessly encoded to 707,120 bytes, with decoded
pixels identical to the captured image and no increase to the 900 KB budget.
