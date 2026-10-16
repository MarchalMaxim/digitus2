# Native OMR quality wave — 2026-10-15

Audiveris 5.11.0 is the better measured candidate under the user's new permission for native/Python processing on this PC. The portable CLI completes clean pages in **4–8 seconds**, rather than oemer's 21-minute browser Twinkle run, and exports actual MusicXML with meter and supported engraving. A generic short-staff profile fixes a real missing-final-system defect: Twinkle improves from **95.93% to 100% strict structural/full-note F1**, with all 64 notes/12 bars and zero timing mismatches. This is not a perfect-recognition or production-readiness claim.

The committed oemer baseline and old raw outputs are untouched. No recognizer service, public listener or score upload was created by this lane. The optional PC connector is a separately owned implementation. The user explicitly permits native runtime/Python now; this supersedes the earlier browser-only restriction.

## Actual before/after evidence

All exports below are untouched recognizer outputs. MusicXML was extracted byte-for-byte from the original MXL solely for rendering; the unchanged strict scorer consumes raw MXL. IDs label jobs/score files only: recognition receives the image, fixed CLI profile and bundled models, never reference XML.

| Original clean fixture | oemer native full-note F1 | Audiveris default full-note F1 | Audiveris short-staff profile | Profile notes ref/recognized | Profile bars ref/recognized | Profile absolute timing mismatches | Profile elapsed |
| ---------------------- | ------------------------: | -----------------------------: | ----------------------------: | ---------------------------: | --------------------------: | ---------------------------------: | --------------: |
| Twinkle                |                    88.37% |                         95.93% |                      **100%** |                        64/64 |                       12/12 |                                  0 |          4.44 s |
| Bach minuet            |                    88.73% |                         91.18% |                        91.18% |                      204/204 |                       32/32 |                                 25 |          6.34 s |
| Chopin prelude         |                     0.59% |                         40.91% |                        40.91% |                      168/140 |                       17/17 |                                 16 |          6.17 s |
| Corpus micro           |                    54.44% |                         73.42% |                    **74.17%** |                      436/408 |                       61/61 |                                 41 |               — |

Profile corpus pitch-within-ordinal-bar F1 is 95.26%, but it must not conceal the 74.17% structural result. The default has one missing Twinkle bar and 42 absolute timing mismatches; the profile recovers that bar and its five notes. Bach/Chopin per-piece strict evaluations are exactly unchanged by the profile.

**Metric interpretation:** full-note keys include onset, pitch, duration, staff, grace status and the complete onset/pitch multiset identifying the voice in its bar. One event can invalidate other voice-group matches. Bars pair by ordinal, so shifts compound later errors. These are strict structural/full-note F1 values, not literal percentages of noteheads correctly recognized. Gates and references were not changed.

### Locked-profile held-out validation

The two profile parameters were selected from the Twinkle image and official rejection logic before these four matched comparisons. No parameter was changed after held-out scoring. Four native pages cost about 22 seconds total; matched default runs were worthwhile to detect false-staff regressions rather than assuming the new profile was harmless.

| Held-out clean page | Default/profile full-note F1 | Pitch F1 | Notes ref/recognized | Bars ref/recognized | Absolute timing mismatches | Profile elapsed |
| ------------------- | ---------------------------: | -------: | -------------------: | ------------------: | -------------------------: | --------------: |
| Ode to Joy          |              86.25% / 86.25% |   96.25% |                83/77 |               16/16 |                         13 |          4.94 s |
| Amazing Grace       |              82.61% / 82.61% |     100% |                69/69 |               15/15 |                          0 |          4.84 s |
| Greensleeves        |              61.84% / 61.84% |   95.65% |              106/101 |               17/17 |                          2 |          5.15 s |
| Schumann Op.68/1    |              86.82% / 86.82% |   98.84% |              256/260 |               20/20 |                         16 |          7.46 s |
| Corpus micro        |          **81.10% / 81.10%** |   97.94% |              514/507 |               68/68 |                         31 |               — |

All four per-piece evaluations are exactly identical between default and profile. This establishes no strict-metric regression on these held-out pages, not broad photographic robustness. Some raw XML metadata/notation identifiers differ across executions. No oemer inference was performed on these held-out pages.

## Implemented generic missing-system fix

[Audiveris source commit 9e1e55cd2746037d059345881c53e6a6754bffbd](https://github.com/Audiveris/audiveris/tree/9e1e55cd2746037d059345881c53e6a6754bffbd) applies two separate staff-length filters:

- [ClustersRetriever](https://github.com/Audiveris/audiveris/blob/9e1e55cd2746037d059345881c53e6a6754bffbd/app/src/main/java/org/audiveris/omr/sheet/grid/ClustersRetriever.java) rejects clusters relative to median true line length (default ratio 0.2).
- [LinesRetriever](https://github.com/Audiveris/audiveris/blob/9e1e55cd2746037d059345881c53e6a6754bffbd/app/src/main/java/org/audiveris/omr/sheet/grid/LinesRetriever.java) additionally rejects every staff shorter than 30 interline units. At Twinkle's measured 11-pixel interline, its visibly short final one-bar system falls below that floor.

Both single-stage negative controls retain 11 bars/59 notes and the identical raw MusicXML hash. Lowering only the cluster ratio retrieves six raw five-line clusters, but the second gate still removes the short pair. Lowering only the absolute length leaves the first gate active. The combined fixed profile retains the short pair and transcribes all 12 bars:

```text
-constant org.audiveris.omr.sheet.grid.LinesRetriever.minStaffLength=12
-constant org.audiveris.omr.sheet.grid.ClustersRetriever.minClusterLengthRatio=0.15
```

This is scale-based recognizer configuration, not staff-line drawing, image fabrication or XML repair. The adapter exposes it as `--short-staves`; default behavior remains explicitly available. It does not insert guessed meter, pitches, voices or missing notes. Small clean-fixture validation does not rule out false short staves on unrelated noisy documents.

## Visual and capability checks

Actual raw renders of all three baseline pages, corrected Twinkle and all four held-out pages were inspected. Corrected Twinkle includes the recovered final system, correct hollow final note and proper 4/4. It still omits the printed metronome and duplicates an mf marking, so even its perfect strict note score does not mean perfect engraving.

Audiveris emits a time signature on each original baseline score and 84 beam elements in Bach. Chopin's raw output still has no beams and loses 28 notes; its structure is much closer than oemer but is not correct. Held-out outputs retain missing events, rhythm/voice errors, slur issues and occasional layout clipping in the raw Verovio render. Renderer warnings are retained, including an unclosed Ode slur and a Chopin slur-order warning.

Every isolated Audiveris job reports **no installed OCR languages**. Musical recognition uses packaged classifiers, but textual OCR/metronome completeness is therefore not established. We did not silently add a different text model halfway through the comparison.

Production accuracy is still rejected. These clean generated images do not establish phone-photo, skew/shadow, multipage or broad-composer quality. A correction/review flow is still necessary; there is no calibrated automatic confidence guarantee.

## Native invocation, isolation and provenance

[Official CLI documentation](https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/) supports batch transcription/export. The proven direct child process uses bundled Java, not an executable launcher:

```text
<portable>/runtime/bin/java.exe -Xms256m -Xmx4g -XX:ActiveProcessorCount=4
-Djava.awt.headless=true -Dfile.encoding=UTF-8
-Duser.home=<job>/home -Djava.io.tmpdir=<job>/tmp
-Dorg.bytedeco.javacpp.cachedir=<job>/javacpp
--add-exports=java.desktop/sun.awt.image=ALL-UNNAMED
--enable-native-access=ALL-UNNAMED
-cp <portable>/app/* Audiveris
[fixed profile constants]
-batch -transcribe -export -save -output <job>/exports -- <input>
```

Child APPDATA, LOCALAPPDATA, TEMP and TMP also point under the job. Logs confirm per-job roaming configuration/logs; the user's Audiveris settings were not used. No OS installation or resident service was performed in this wave. The Python adapter owns the actual JVM PID and enforces a 180-second bound. A real 1-second timeout control terminated it in 1.02 seconds with no successful export. This is a startup-timeout control, not a separately measured mid-transcription cancellation guarantee.

An initial retained setup failure used `app;app/*`: exploded class files made Audiveris enter development-resource mode and miss its packaged classifier. Using _*app/* only_* loads the jar and fixes it. Do not copy the broken classpath into a connector. The first successful run's direct invocation and each job's full arguments/hashes are retained.

| Pin                      | Value                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official release         | [Audiveris 5.11.0 Windows console MSI](https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-windowsConsole-x86_64.msi), 85,062,430 bytes |
| MSI SHA256               | `5f1b4e96a12c53c7da426814b76e599363c4181e291855996e0a6878dda95f71`                                                                                                   |
| audiveris.jar SHA256     | `47d8e482d6566ebb64d5e8bd121f6a381ca8cef27521000b861885a19413b428`                                                                                                   |
| bundled java.exe SHA256  | `9648fcd95f72a93edeb3f76e2dcff55d297f7bf0b2c05db94f102c3c5a143b08`                                                                                                   |
| Bundled runtime          | Java 25.0.3                                                                                                                                                          |
| Fixed Twinkle XML SHA256 | `8370a34ac8675c2c7f51acb9874254748a79752f53a5f39cdda1761e97fe4f4e`                                                                                                   |

Audiveris is [AGPL-3.0-or-later](https://github.com/Audiveris/audiveris/blob/9e1e55cd2746037d059345881c53e6a6754bffbd/LICENSE), not MIT. The project's MIT wrapper does not relicense upstream. Retain upstream notices/source obligations when distributing or modifying the recognizer; any eventual network deployment requires an appropriate AGPL review. No Audiveris binaries/models are committed.

## Reproduction and retained outputs

Durable adapters/setup/tests: [research/omr/prototypes/oemer-quality](../../research/omr/prototypes/oemer-quality/README.md). Audiveris adapter/collector need only Python 3.11 standard library. Scoring/rendering require installed pnpm dependencies and built engine:

```powershell
pnpm --filter @digitus2/engine build
python research/omr/prototypes/oemer-quality/run-audiveris.py research/omr/results/fixtures-final/twinkle-twinkle-little-star/page-001-clean.png new-quality-job --short-staves
python research/omr/prototypes/oemer-quality/collect-audiveris.py research/omr/results/quality-wave/new-quality-job twinkle-twinkle-little-star research/omr/results/quality-wave/new-collection
node research/omr/evaluate.mjs --manifest research/omr/results/fixtures-final/manifest.json --recognized research/omr/results/quality-wave/new-collection/scores --candidate audiveris-review --out NEW-CARD.json
node research/omr/prototypes/oemer/render-output.mjs research/omr/results/quality-wave/new-collection/render-xml/twinkle-twinkle-little-star.musicxml
```

The existing extracted runtime is reused. For a fresh checkout, `prepare-audiveris.ps1` provides a checked download and isolated MSI administrative extraction recipe; it uses /a, never a normal /i installation. Pass its directory with `--runtime-root research/omr/results/quality-wave/toolchain`. That fresh extraction script was syntax-checked, not redundantly executed in this wave. The previously extracted release was validated against the official MSI digest.

Raw results under ignored `research/omr/results/quality-wave/`:

- Default original corpus: `audiveris-final/{scores,render-xml}/`, `scorecard-audiveris-final.json`.
- Fixed original corpus: `audiveris-short-profile/{scores,render-xml}/`, `scorecard-profile-final.json`.
- Held-out default/profile: `audiveris-heldout/`, `audiveris-heldout-profile/`, `scorecard-heldout-default-final.json`, `scorecard-heldout-profile-final.json`.
- Each named job retains `result.json`, `execution.log`, original MXL/OMR and isolated profile/cache directories.
- Negative controls: `audiveris-short-staves-twinkle`, `audiveris-short-staff-length-twinkle`; initial classpath failure `audiveris-twinkle`.
- Initial collector ambiguity (both MXL/XML under one scoring ID) is retained in `scorecard-audiveris-first.json`. Final collections have only raw MXL under scores; no error was hidden or metric relaxed.

The scorer's `recognitionExecuted:false` describes the scorer itself; independent native job records explicitly record actual recognition. All four held-out pages are fully represented in the final cards.

## Bounded oemer diagnostic retained separately

Before native processing was unlocked, an original-image topology correction was prepared. Two real Twinkle half notes have enclosed white areas in source pixels but are typed solid by segmentation. Conservatively restoring hollow type before the unchanged rhythm pipeline improves cached Twinkle structural/full-note F1 from 88.37% to 91.47%, duration matches 59→61. It does not remove the metronome note or fix timing; all 12 timing mismatches remain.

This was **cached-mask reconstruction**, not new recognition or a held-out quality claim. Its metronome-equation detector passed synthetic positive/negative checks but deliberately abstained on the real image; no uncertain note was deleted. Eight focused tests cover solid/hollow heads, staff crossing, pinholes, open contours, high ledger notes and incomplete equations. This patch is experimental and is not the selected integration candidate. Native Audiveris plus the measured short-staff profile is more valuable than a large oemer reconstruction port at present.

## Verification and recommendation

Actual native before/after, matched held-out comparisons, raw rendering, bounded-process timeout and eight image-evidence tests completed. Python AST and PowerShell syntax checks cover durable scripts. Coordinator owns combined-wave acceptance/standing verification and git; this lane did not change shared journals, app UI, references, evaluator, committed baseline or third-party source.

Recommend the optional PC-worker boundary use the real native Audiveris process with isolated per-job settings, strict whole-export selection, cancellation and unreviewed-output provenance. Include the tested short-staff configuration as an explicit reproducible profile. Do not represent the recognizer as uniformly correct: remaining lost notes, rhythm/voice/partial-bar errors and missing textual OCR need measured follow-up or correction, rather than guessed XML repair.

## Second batch: original PDF and compatible English OCR

Preserving original PDF bytes and installing the compatible English model improves recognition without changing raw XML or the oracle. The fixed short-staff profile remains unchanged.

| Original corpus | PNG baseline strict full-note F1 | PDF+OCR strict F1 | PDF events ref/recognized | PDF timing mismatches |
| --------------- | -------------------------------: | ----------------: | ------------------------: | --------------------: |
| Twinkle         |                             100% |              100% |                     64/64 |                     0 |
| Bach            |                           91.18% |            93.37% |                   204/203 |                     0 |
| Chopin          |                           40.91% |            73.75% |                   168/171 |                     0 |
| Corpus          |                           74.17% |            86.73% |                   436/438 |                     0 |

All three exports parse, with 61/61 bars. Corpus pitch/onset/staff F1 is 99.54% (435 matches); duration F1 is 98.63%. These projections do not replace strict structural/full-note F1.

Chopin's PNG is 1260×1782, interline 11. Audiveris rasterizes its original PDF at 2478×3507, interline 21. PDF without OCR reaches 70.21% strict F1, two timing mismatches. PDF+OCR reaches 73.75%, zero timing mismatches. A fixed 2× Lanczos PNG control reaches only 60.59%, 14 timing mismatches; automatic enlargement was not adopted. PDF+OCR matches every reference pitch/onset/staff event but retains three extras and four duration differences. Whole-voice fingerprints compound these errors. Affected ordinal bars are 5, 9, 10, 11, 12, 15 (zero-based). This reference comparison is diagnostic only; recognition never reads references.

### Matched held-out PDF controls

The fixed setup was chosen before these controls. All four exports parse with 68/68 bars.

| Piece            | PNG strict F1 | PDF+OCR strict F1 | Events ref/recognized | PDF timing mismatches |
| ---------------- | ------------: | ----------------: | --------------------: | --------------------: |
| Ode to Joy       |        86.25% |            96.39% |                 83/83 |                     0 |
| Amazing Grace    |        82.61% |              100% |                 69/69 |                     0 |
| Greensleeves     |        61.84% |              100% |               106/106 |                     0 |
| Schumann Op.68/1 |        86.82% |            87.50% |               256/256 |                    20 |
| Corpus           |        81.10% |            93.19% |               514/514 |                    20 |

Held-out pitch matches are 514/514; onset/staff matches are 508/514 and duration matches 505/514. Ode to Joy has one duration difference; Schumann has six onset/staff and eight duration differences, alongside voice/bar-extent differences. Native held-out PDF jobs took 8.23–13.89 seconds; original three PDF+OCR jobs took 8.51–11.41 seconds, excluding scoring/rendering/transport. Better input is a measured improvement, not universal correctness.

### Text model and unresolved tempo

The [official language guide](https://audiveris.github.io/audiveris/_pages/guides/main/languages/) requires legacy-capable data, excluding LSTM-only tessdata_fast. The downloaded Apache-2.0 English model is tesseract-ocr/tessdata 4.1.0, commit 4767ea922bcc460e70b87b1d303ebdfed0897da8: [pinned model](https://raw.githubusercontent.com/tesseract-ocr/tessdata/4767ea922bcc460e70b87b1d303ebdfed0897da8/eng.traineddata), 23,466,654 bytes, SHA-256 daa0c97d651c19fba3b25e81317cd697e9908c8208090c94c3905381c23fc047. Git blob identity also matches official metadata. Binary, LICENSE and provenance remain ignored under quality-wave/text-models.

The new prepare-text-models.ps1 verifies the pinned digest and retains the license. Runner --text-models copies it into isolated per-job tessdata, sets TESSDATA_PREFIX and Language.defaultSpecification=eng, records the hash. Actual logs confirm installed language eng. Chopin retains Andantino and dolce e semplice.

Twinkle PNG and PDF recognize '= 100' but omit the beat-unit glyph, metronome and playback tempo. The [official metronome procedure](https://audiveris.github.io/audiveris/_pages/guides/specific/metronome/) requires text plus a classified beat unit. Guessing quarter=100 is unjustified. New audit_export.py records metronome-beat-unit-unresolved for such equation text and meter-unresolved when absent. It never modifies XML or invents BPM. Absence of a warning is not a completeness certificate. Four focused audit tests cover valid metronomes, unresolved equations, numeric non-tempo text and missing meter.

### Reproduction and evidence

Run prepare-text-models.ps1, then run-audiveris.py INPUT.pdf NEW-ID --short-staves --text-models research/omr/results/quality-wave/text-models. Collect/score with the unchanged README commands, building the engine first. No OS installation, upload or external recognizer was used.

All paths below are under ignored research/omr/results/quality-wave/; earlier evidence remains intact:

- Original PDF+OCR: audiveris-text-pdf/{scores,render-xml}, scorecard-text-pdf-final.json.
- Held-out PDF+OCR: audiveris-heldout-text-pdf/{scores,render-xml}, scorecard-heldout-text-pdf-final.json.
- Chopin ablations: scorecard-pdf-chopin-first.json and scorecard-2x-png-chopin-first.json. These partial cards retain missing other pieces; comparisons use only per-piece values.
- Twinkle PNG OCR: scorecard-text-twinkle-first.json. Per-job result.json retains exact commands, hashes, elapsed time and export audit. Old jobs predate the audit addition.
- Untouched output renders generated for all seven PDFs. Chopin visibly retains meter, beams, text and slurs, with remaining note/chord/rhythm defects. Verovio chord/beam and slur warnings were retained, not repaired.

Focused verification: 12 tests pass; seven Python files parse; both PowerShell setup scripts parse. Explicit Prettier API checks cover ignored report/README paths. Coordinator owns combined standing verification and git. Worker owner adopted original PDF pass-through and exact text-model/profile contract. Recommend that native path with recognition review; remaining voice/duration/extras, engraving and metronome gaps prohibit an automatic-correctness claim.
