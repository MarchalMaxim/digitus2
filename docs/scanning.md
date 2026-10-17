# Scanning (experimental)

Scanning turns a photo or PDF of printed piano music into a score with fingerings. Recognition runs on your own PC, in an optional local worker: homr for photos and Audiveris for PDFs. The app shows the original beside the recognised notation, and you decide whether to use the result. Recognition is not reliable. Good-looking notation can still contain wrong pitches, rhythms, ties, bars or hands, so treat every result as a draft to check. Original PDFs and flat, high-resolution scans work best; book photos can fail even when well lit. Handwriting is not supported.

MusicXML, compressed MusicXML (`.mxl`) and MIDI open directly, without the worker. Why these recognisers were chosen, and what was measured: `docs/research/omr.md`.

## What the app guarantees

- **Original bytes are kept.** Unrotated images and PDFs go to the worker byte for byte. A rotated image is sent as a lossless PNG derived from the original, and four turns restore the exact original file. PDFs are never rasterised in the browser.
- **Nothing leaves your computer.** The file goes only from the browser to the worker on 127.0.0.1. There is no external recognition service and no upload. Scan jobs download nothing; only the one-time setup does.
- **Recognition errors stay visible.** The source and the recognised notation sit side by side, and every result is marked as needing review. Scanned notation goes through a strict import that refuses malformed notation, for example a tie stop without a start. You can still download such a result, but **Use for fingerings** stays disabled.
- **Nothing is silently corrected.** The app never guesses a repair, deletes bars or invents notes, meter or tempo. The worker never picks one of several exported scores or publishes an incomplete export.
- **Display preparation never changes the music.** Inferred beams and a voice regrouping for Verovio (below) apply only to the rendered copy. Recognised pitches, timing, note ids, raw downloads and the input to fingering and playback are untouched.

## Scan a score

1. At the end of the library, choose **Open your own score**, or drop files onto the library. Choose up to 20 PNG or JPEG page images together (10 MB each), or one PDF (10 MB). Drag the thumbnails into reading order. Selecting a page shows keyboard-accessible move and remove controls and **Rotate 90° clockwise**. Rotate a sideways or upside-down photo before scanning.
2. On the PC that runs the worker, press **Connect to this PC**. If the browser asks, allow this site to connect to the local computer. The app never contacts the worker before you press Connect.
3. Press **Scan this score**. Pages are recognised one at a time in the order shown. **Cancel scan** stops the job, and leaving the page cancels it too. A page that fails keeps the others; **Retry failed pages** resubmits only the failed ones. Most pages take seconds, difficult ones a few minutes.
4. Compare the original with **Recognized notation**: every page, pitches, rhythms, bar count, clefs, key and time signatures, and hands. For an image batch, select a thumbnail to see that page's recognition, or switch to **Combined score**. For a PDF, step through the original with Previous and Next; the recognised pages may break differently. Text and tempo may be missing.
5. Press **Use for fingerings** to open the normal score view with fingerings and playback. The button is enabled once the recognised score passes the strict import and renders. **Scan source and recognition** in the score view returns to the comparison, and so does the browser's Back button, without a new job.

**Download raw MusicXML** saves the recognised file untouched, without fingerings. A batch offers **Download combined MusicXML** and each page's file instead. Correct a file in a notation editor, then open the corrected MusicXML normally. The playback tempo of a scan may be the app's default, not a recognised tempo.

### Rotation

Each rotation is computed from the original image, after its EXIF orientation, rather than from the previous turn. Rotating a page clears its old recognition; other pages and the order are kept. A failed or cancelled rotation leaves the current image usable. Rotation refuses images over 16 megapixels or 12,000 px on a side, and the rotated PNG must still fit the 10 MB limit. PDFs cannot be rotated.

### Image batches

The combined score appends each page's recognised measures in your order, keeping each page's time units, signatures and notation. It needs compatible parts and staves and an explicit starting context on each page. Repeat and jump navigation, incompatible layouts and invalid ties block the combined score; page-by-page review and downloads stay available. Combining never repairs recognition or fills in notes at page boundaries.

Slur and other span numbers are renumbered per page, so a slur never links across pages by accident; check continuations at page edges. MusicXML allows only 16 numbers per span type, so a batch whose spans would need more is refused, even below 20 pages.

### Display of homr results

The pinned homr writes no beams. For display, the app infers conventional beat groups in simple and compound meters, keeps any explicit beams and skips ambiguous cases. These groups are not the source's beams: a run of six eighths can come back as three pairs. Real beam recovery has to link the image's noteheads, stems and beam strokes to the recognised notes, checked separately from pitch and rhythm; a page-specific grouping rule is not a fix. A render-only regrouping of simultaneous notes by voice also works around a Verovio import issue that displaced notes in time and stretched bars.

## My scores

Uploads are saved automatically in the browser's IndexedDB (database `digitus2.my-scores`), with page order, rotation, original and rotated bytes, the raw recognised MusicXML and the recogniser's name. Plain MusicXML and MIDI imports are saved too. **My scores** appears in the library when it has entries. Reopening an entry never reconnects to the PC or restarts recognition. A multi-page result that cannot be combined still reopens page by page. Remove deletes an entry. A failed save is reported and the current work stays usable.

Browser storage belongs to one site and one browser profile, so a local preview and the GitHub Pages site have separate collections. Clearing site data or storage eviction removes it ([IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [storage limits](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)), so keep your own copies. Nothing is shared or published; a shared library is an open request in `docs/TODO.md`.

## Set up the PC worker

You need a Windows PC with PowerShell and Python 3.11 or later; desktop Chrome is the tested browser. The worker starts the Java runtime bundled with Audiveris, and Audiveris may use a 4 GB heap, so leave memory free. A phone or tablet cannot use the worker: its localhost is the device itself.

Get the repository from [GitHub](https://github.com/MarchalMaxim/digitus2) and open a terminal in its root folder. Run once:

```powershell
powershell -File research/omr/prototypes/oemer-quality/prepare-audiveris.ps1
powershell -File research/omr/prototypes/oemer-quality/prepare-text-models.ps1
powershell -File research/omr/prototypes/homr-photo/setup.ps1
```

- `prepare-audiveris.ps1` downloads the Audiveris 5.11.0 Windows installer (about 85 MB), checks its SHA-256 and unpacks it with an administrative extraction into `research/omr/results/quality-wave/toolchain`. Nothing is installed on the system. If it reports that the extraction exists, keep the existing one.
- `prepare-text-models.ps1` downloads and checks the pinned English text model (about 23 MB) into `research/omr/results/quality-wave/text-models`.
- `setup.ps1` prepares homr in `research/omr/results/photo-options/toolchain`: an isolated CPU-only Python environment, the pinned source and three ONNX models (about 139 MB), with the project's patches applied and every file digest checked (see `research/omr/prototypes/homr-photo/README.md`).

All three locations are ignored by git. Start the worker whenever you want to scan, and keep the terminal open:

```powershell
python research/omr/prototypes/local-worker/worker.py --bundle research/omr/results/quality-wave/toolchain --short-staves --text-models research/omr/results/quality-wave/text-models --homr-toolchain research/omr/results/photo-options/toolchain
```

It prints `http://127.0.0.1:8996` and the recogniser profile (homr for images, Audiveris with `pinned-eng` for PDFs). Ctrl+C or closing the terminal stops the worker and any running recognition. No account, public server, tunnel or automatic startup is involved.

- `--short-staves` turns on two Audiveris settings that keep short staves, such as a one-bar final system. `--text-models` enables English text recognition. Without it, the worker and the app warn that musical text may be missing. Even with it, a metronome mark's beat unit is often unresolved.
- Without `--homr-toolchain`, images also go to Audiveris, which fails on most photos.
- The worker accepts requests only from `https://marchalmaxim.github.io`. For a local preview, add its exact origin, for example `--dev-origin http://127.0.0.1:4196`, and open that exact address: `http://localhost:4196` is a different origin and needs its own option. The worker still listens on 127.0.0.1 only.

Worker limits: one recognition at a time, 10 MiB per upload, 20 MiB per result, a 180 s timeout per job (the app stops waiting after about three minutes), eight retained jobs, and five minutes' retention for finished jobs. homr refuses images over 25 megapixels. Each job gets its own temporary directory, settings and caches, removed on expiry and at shutdown. The protocol is described in `research/omr/prototypes/local-worker/README.md`.

## Connection problems

- **Could not connect.** Check that the worker terminal is running on this PC, then retry Connect. If you denied local access, allow the site's local or loopback-network connection in the browser's site settings and retry. Never disable browser security.
- **PC already scanning.** One recognition runs at a time; wait or cancel the other job.
- **Staff resolution too low.** The message gives the measured staff-line spacing, for example six pixels. Use the full-resolution original, photograph a smaller area more closely, or use the original PDF. Enlarging a compressed image does not restore detail.
- **Multiple scores or incomplete export.** Separate examples, footnotes and a curved page can confuse the recogniser. Try a single main music section or the original PDF.
- **Other recognition failure.** A flatter, sharper source may help; ordinary book photos remain unreliable.
- **Preview unavailable.** Open the original in another tab. The PDF preview does not run document scripts, and some unusual PDFs or image encodings do not preview.
- **Cancellation cannot be confirmed.** Close the worker terminal to stop recognition.

## Known recognition errors and limits

The only real-photo test material is two photos of one printed continuation page. On both, the homr profile recovers all 13 main bars and both hands, with these errors:

- missed chord ties on two notes, which then sound again instead of being held;
- a duplicated C5 (smaller photo);
- a bass E3 assigned to the upper hand (smaller photo);
- beams inferred from the meter instead of read from the source;
- key and time signature inferred when a continuation page does not print them.

Further limits:

- Small inset examples are excluded before recognition and flagged in the result. A legitimate short inset passage, such as an indented coda, can look like an example, so compare the whole original.
- Ornaments can be incomplete and rhythms wrong on any page.
- Audiveris (used for PDFs, and for images without homr) fails below about 10 px between staff lines and on skewed or curved pages.
- Text and tempo can be incomplete. A tempo like "= 100" without a recognised beat unit gives no tempo, and an app default tempo is not a recognised one.
- A recognition job finishing does not mean its notation imports. In one test scan, an A4 tie in bar 11 whose continuation arrives a quarter note late is refused by the strict import.
- Synthetic test pages, strict parsing and passing tests do not certify musical accuracy. Phone-photo robustness, multi-page books and browsers other than desktop Chrome are untested.

The open requests are recognition fixes, source beam recovery, an acceptance corpus, in-browser correction and a shared library. They are tracked in `docs/TODO.md` under T9.

## Licences

The PDF preview uses unmodified [Mozilla PDF.js](https://mozilla.github.io/pdf.js/examples/) (Apache-2.0) on a canvas, bundled with its licence and credited in About. The browser's own PDF viewer was not used: its coloured chrome breaks the black-and-white rule, and it blocked the raw download. The preview never changes what is recognised.

The recognisers are not part of the MIT web app. The setup scripts fetch them onto your PC: homr code and models are AGPL-3.0, Audiveris is AGPL-3.0-or-later, and the English text model is Apache-2.0. The worker's wrappers do not relicense them.
