# Library expansion, 2026-10-15

This batch adds 13 pieces to the built-in library, taking it from 149 to 162. It uses online Mutopia notation sources and published MIDI; the repository's existing converter produces the shipped MusicXML. These are not downloads of pre-existing MusicXML editions. No trustworthy new direct-MusicXML collection was selected in this search.

## Added repertoire

| Piece                                     | Level | Bars | Edition license |
| ----------------------------------------- | ----: | ---: | --------------- |
| Bach, Invention 2, BWV 773                |     4 |   27 | Public Domain   |
| Bach, Invention 3, BWV 774                |     4 |   59 | Public Domain   |
| Bach, Invention 6, BWV 777                |     4 |   62 | CC BY-SA 3.0    |
| Bach, Invention 7, BWV 778                |     4 |   23 | Public Domain   |
| Bach, Invention 11, BWV 782               |     4 |   23 | Public Domain   |
| Anonymous, Minuet in B-flat, BWV Anh. 118 |     2 |   26 | Public Domain   |
| Handel, Aylesford Minuet in D             |     3 |   28 | Public Domain   |
| Handel, Aylesford Minuet in F             |     4 |   24 | Public Domain   |
| Handel, Aylesford Air in B-flat           |     3 |   29 | Public Domain   |
| Bach, Little Prelude in F, BWV 928        |     4 |   24 | Public Domain   |
| Pleyel, Minuet in C, first theme          |     3 |   16 | Public Domain   |
| Müller, Siciliano in A minor              |     3 |   22 | Public Domain   |
| Traditional, Polska from Västergötland    |     3 |   16 | CC BY 2.5       |

The distribution across levels 1–5 is 24 / 44 / 46 / 34 / 14. The first steps list and benchmark set `core30` are unchanged. Existing collections and search expose the new pieces without adding controls.

## Sources and reproducibility

The two new catalog fragments, `content/tools/catalog.d/expansion-bach.json` and `expansion-teaching.json`, record exact source directories, published MIDI filenames, retrieval dates, SHA-256 pins, tempo decisions and level rationales. `content/manifest.json` retains edition-specific license URLs and contributor credits; the scores retain MusicXML rights statements. Source downloads stay in ignored `content/_raw/mutopia/` and can be fetched again with the existing pipeline. Shipped MusicXML lives in `content/scores/` and is discovered automatically by the app's asset loader.

[Mutopia's reuse policy](https://www.mutopiaproject.org/legal.html) and the individual edition declarations govern these files, separately from the project's MIT code. Invention 6 credits [jeff covey, CC BY-SA 3.0](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=159); the Swedish Polska retains Erik Sjölund's CC BY 2.5 attribution. All individual source URLs are recorded in the manifest. The Handel source editions are dated 1930 and carry explicit Mutopia Public Domain declarations; no pre-1929 source-edition claim is made.

Pleyel's printed source title is “Menuett”, although its Mutopia metadata says “Rondo”. The shipped excerpt is the complete first 16-bar theme, because the full source requires D.C. al Fine playback that the current player does not implement. The excerpt is identified in metadata; importing the complete published MIDI naturally produces a longer piece.

## Review findings

Three attempted Bach editions were withheld: Inventions 5 and 12 contain directional mordents the converter cannot faithfully preserve, and Invention 9's delayed turn rendered as literal `scripts.turn`. The rejected records explain each limitation. No playability or accuracy gate was relaxed.

Independent comparison against the source engravings found missing terminal fermatas in Invention 6 and BWV Anh. 118. Their sources used rehearsal-mark glyphs instead of note articulations. Catalog patches normalize those specific glyphs to existing directed fermata articulations, preserving pitches, timing and placement; the shared converter is unchanged. Invention 3 also needs two syntax-only patches for its older LilyPond source.

The complete content suite passed 1,141 tests. A fresh rebuild reproduced all 195 shipped score files byte for byte, including all existing pieces. All 149 pre-existing manifest/verification records are semantically unchanged. Source-specific regression checks protect the restored fermatas, which MIDI note comparison cannot detect.

The content pipeline compares each addition's pitch/onset events against both the published MIDI and a fresh LilyPond MIDI, validates MusicXML with the schema and independent readers, and requires zero span flags and zero medium/large lint law errors. Its `exact` MIDI result does not mean every duration or engraving detail is identical; grace-note timing and expressive notation require separate review. Browser review covered all 13 additions at desktop and phone widths, plus actual published-MIDI imports; four additional renders checked the corrected fermatas.

Evidence remains in ignored `content/_build/`: `library-pytest-final.log`, `library-repro-final.log`, `visual-qa/` (source comparisons) and `ui-qa/` (real app screenshots and JSON reports). The final `pnpm verify` passed all steps: 747 engine tests, 298 web tests, 175 browser tests, and all benchmark gates. Its log is `content/_build/library-verify-reviewed.log`.

_Codex · Astra orchestration · Sol 6.1 implementation and independent reviews · 2026-10-15._
