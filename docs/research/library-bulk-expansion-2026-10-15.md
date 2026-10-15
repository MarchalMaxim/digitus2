# Bulk piano library expansion

Codex — Astra orchestration, Sol 6.1 acquisition, integration and independent review. 2026-10-15.

The user requested substantially more MIDI/MusicXML repertoire, particularly Beethoven, Chopin and Rachmaninoff, with less agent time spent per piece. This wave inventories an existing source mirror, downloads published MIDI in four workers, and probes conversion and quality gates in four processes. No agent is assigned to an individual song. Downloaded files remain candidates until the app's existing gates and independent review pass.

## Acquired sources

The [Mutopia Project source repository](https://github.com/MutopiaProject/MutopiaProject) supplies notation sources. Published MIDI and edition metadata come from the project's canonical FTP directory. Each edition's RDF licence is checked against the project's [reuse policy](https://www.mutopiaproject.org/legal.html). The new `content/tools/bulk_sources.py` collector retains source URLs, hashes and edition metadata in `content/tools/bulk-candidates.json`; MIDI files are cached under ignored `content/_raw/bulk/mutopia/`. Complete download URLs, MIDI hashes and cache paths are retained in ignored `content/_raw/bulk/inventory.json`; the committed compact index retains source/RDF hashes, counts and admission. Fresh collection and offline `--refresh` both regenerate admission from the catalog fragment.

| Measure | Count |
| --- | ---: |
| Unique keyboard editions inventoried | 608 |
| Editions with published MIDI acquired | 607 |
| Actual published MIDI files | 733 |
| Editions absent from the earlier catalog | 519 |
| Beethoven editions / MIDI files | 36 / 38 |
| Chopin editions / MIDI files | 46 / 46 |
| Rachmaninoff editions / MIDI files | 10 / 10 |
| Public-domain edition declarations | 369 |
| CC BY editions | 72 |
| CC BY-SA editions | 167 |

Counts describe editions and files, not unique compositions or accepted app entries. Alternative page formats share a directory; a published anthology can contain several MIDI files. Three mixed piano/organ editions are held for pedal review. One Debussy anthology has notation but no published MIDI. Source titles, publication details and contributors remain edition-specific; a historical composer's public-domain status alone does not determine an engraving's licence.

## Admission and review

The batch preserves full original editions and does not silently simplify or excerpt them. Admission requires successful conversion and schema validation, renderable MusicXML, exact pitch/onset agreement with both freshly generated LilyPond MIDI and the independently published MIDI under the existing comparator, playable piano pitches and hand spans, medium/large fingering-law checks, and the existing score size limit. The MIDI comparator's duration diagnostics are separate; MIDI equality cannot establish engraving fidelity. Unsupported notation and ambiguous multi-score anthologies are held. Failures retain concrete reasons; gates are not weakened to raise the count.

The existing app already supports level 6, Advanced. The old difficulty heuristic was calibrated on the first 30 pieces and saturates at level 5; it is not a reliable classifier for concert repertoire. Qualifying mature originals receive a conservative advanced placement with that limitation stated in catalog notes. No external syllabus placements are invented.

Independent review checks every accepted source's licence and MIDI evidence, source completeness and attribution, then samples generated notation and actual desktop/phone rendering. Coordinator review caught a folder-derived attribution error that would have copied Petzold's name onto Bach works; promotion now uses explicit composer metadata. The downloader also rejects missing or nonredistributable canonical rights metadata before requesting MIDI, checks MIDI headers, confines archive extraction, and hydrates alternative source mains once per edition. Six offline collector boundary tests pass.

## Reproduction

With the documented Mutopia mirror and content Python environment available:

```powershell
& content/.venv/Scripts/python.exe -I content/tools/bulk_sources.py --download
```

Ordinary `content/tools/build.py` and `gates.py` rebuild and check accepted catalog entries. The ignored batch probe is an acceleration tool; committed catalog metadata and ordinary production build paths remain the source of truth. Downloaded candidates are not bundled into the initial app payload.

## Integrated result

| Measure | Final result |
| --- | ---: |
| Missing editions probed | 519 |
| New full editions accepted | 91 |
| Editions held, with reasons | 428 |
| Total playable library pieces | 253 |
| New score files, including editorial-fingering variants | 111 |
| Total score files | 306 |
| Pieces at levels 1 / 2 / 3 / 4 / 5 / 6 | 24 / 44 / 83 / 37 / 15 / 50 |
| New Beethoven / Chopin / Rachmaninoff entries | 4 / 2 / 0 |

The additions also include 27 Bach-folder editions with individual attribution, 15 Czerny studies, 22 Swedish folk settings, and works by Haydn, Mozart, Brahms, Pejačević and others. All ten acquired Rachmaninoff editions remain held because they fail the existing technical gates; downloading them did not make them accepted library entries.

The first 100 technically passing editions were narrowed to 92 after independent source comparison found omitted textual musical marks. A targeted warning investigation then held Scriabin Op. 16/1 because the renderer mispaired adjacent hairpins, leaving 91 accepted additions. Broader screening also held missing navigation signs, tempo/header expressions and altered tuplet numbers. One Czerny study was moved from Easy to Moderate after review of its ornaments and note density. Every original 162 manifest entry, verification record and all 195 pre-existing score bytes remain unchanged.

All retained additions passed the ordinary production gates, and all 111 retained new score files are byte-identical to independently rebuilt outputs. Independent review checked source and production evidence across every accepted piece, then inspected 12 representative scores, including the longest, at both desktop and phone widths. Those 24 actual score opens had one red element, no horizontal overflow, and no browser errors; the longest observed opening was under two seconds on this host. Eight library/About screenshot states were refreshed and reviewed after the sixth level and additional credits appeared. The final About baseline was refreshed again after the Scriabin hold, then losslessly encoded to 707,120 bytes with identical decoded pixels, below the unchanged 900 KB limit. The welcome sentence loses one word to retain the existing 36-word first-screen budget. The initial app bundle remains below the unchanged 150 KB gzip limit.

Complete `DIGITUS2_E2E_PORT=4189 pnpm verify` passed every step; explicit `pnpm format:check` passed as well. The preview at localhost:4191 serves the current batch after a refresh. See `library-bulk-review-2026-10-15.md` for independent findings. No merge to main is authorized.

The final storage pass removes only XML intertag indentation via the explicit catalog field compactXml; all 111 outputs reproduce byte for byte through ordinary builds. Existing 195 score bytes remain unchanged. The repository is 56.4 MB, below its unchanged 60 MB budget. Rights text distinguishes contemporary original works from public-domain compositions; Andrew Sidwell’s original work remains CC BY-SA 2.5 throughout the source, score and app credits.

## Final release evidence

| Check | Result | Local ignored evidence |
| --- | --- | --- |
| Complete verification | All 11 steps passed; no skipped benchmark | `content/_build/bulk-review/release-verify-ready.log` |
| Engine / web / browser tests | 858 / 300 / 177 passed | Same verification log |
| Complete content tests | 1,715 passed; five documented reader warnings | `content/_build/bulk-review/release-content-tests-final.log` |
| Independent production invariants | 2,184 checks; zero errors | `content/_build/bulk-review/production-invariants.json` |
| Ordinary new-score rebuild | 111/111 byte-identical | `content/_build/bulk-review/release-repro-comparison.json` |
| All-page engraving audit | 91 editions, 167 pages; no semantic discard warnings | `content/_build/bulk-review/all-pages.json` |
| Corpus and admission | 253 pieces, 306 files; 91 accepted / 428 held / 89 existing directories | `content/_build/bulk-review/release-counts.json` |
| Repository / initial bundle | 56.4 MB / 135.1 KB gzip; budgets unchanged | Verification log |
| About baseline | 707,120 bytes; lossless and below 900 KB | `content/_build/bulk-review/about-253-encoding.json` |

The five music21 warnings include four pre-existing reader warnings and the reviewed Beethoven wedge-import limitation. The all-page audit documents 36 mixed-beam placement fallbacks across three Goldberg variations. Neither is concealed as a warning-free corpus. Local headless phone-width checks do not establish physical-device performance. All Rachmaninoff candidates remain held. No git, deployment or merge operation was performed by the release implementer.