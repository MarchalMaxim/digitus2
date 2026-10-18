# Scanning (experimental)

Scanning turns a photo or PDF of printed piano music into a score with fingerings. Recognition runs on your own PC, in an optional local worker: homr for photos and Audiveris for PDFs. The app shows the original beside the recognised notation, and you decide whether to use the result. Recognition is not reliable. Good-looking notation can still contain wrong pitches, rhythms, ties, bars or hands, so treat every result as a draft to check. Original PDFs and flat, high-resolution scans work best; book photos can fail even when well lit. Handwriting is not supported.

MusicXML, compressed MusicXML (`.mxl`) and MIDI open directly, without the worker. Why these recognisers were chosen, and what was measured: `docs/research/omr.md`.

## What the app guarantees

- **Original bytes are kept.** Unrotated images and PDFs go to the worker byte for byte. A rotated image is sent as a lossless PNG derived from the original, and four turns restore the exact original file. PDFs are never rasterised in the browser.
- **Nothing leaves your computer.** The file goes only from the browser to the worker on 127.0.0.1. There is no external recognition service and no upload. Scan jobs download nothing; only the one-time setup does.
- **Recognition errors stay visible.** The source and the recognised notation sit side by side, and every result is marked as needing review. Scanned notation goes through a strict import that refuses malformed notation, for example a tie stop without a start. You can still download such a result, but **Use for fingerings** stays disabled.
- **Nothing is silently corrected.** The app never guesses a repair, deletes bars or invents notes, meter or tempo. The worker never picks one of several exported scores or publishes an incomplete export. The worker changes a recognition only by two lossless rules, described under Known recognition errors and reported under Recognition details.
- **Your corrections are explicit.** Each correction you make in the review is recorded, listed and undoable. The raw recognition is kept unchanged beside the corrected copy, and both can be downloaded.
- **Display preparation never changes the music.** Inferred beams and a voice regrouping for Verovio (below) apply only to the rendered copy. Recognised pitches, timing, note ids, raw downloads and the input to fingering and playback are untouched.

## Scan a score

1. At the end of the library, choose **Open your own score**, or drop files onto the library. Choose up to 20 PNG or JPEG page images together (10 MB each), or one PDF (10 MB). Drag the thumbnails into reading order. Selecting a page shows keyboard-accessible move and remove controls and **Rotate 90° clockwise**. Rotate a sideways or upside-down photo before scanning.
2. On the PC that runs the worker, press **Connect to this PC**. If the browser asks, allow this site to connect to the local computer. The app never contacts the worker before you press Connect.
3. Press **Scan this score**. Pages are recognised one at a time in the order shown. **Cancel scan** stops the job, and leaving the page cancels it too. A page that fails keeps the others; **Retry failed pages** resubmits only the failed ones. Most pages take seconds, difficult ones a few minutes.
4. Compare the original with **Recognized notation**: every page, pitches, rhythms, bar count, clefs, key and time signatures, and hands. For an image batch, select a thumbnail to see that page's recognition, or switch to **Combined score**. For a PDF, step through the original with Previous and Next; the recognised pages may break differently. Text and tempo may be missing.
5. Correct what differs, note by note (Correct the recognition, below).
6. Press **Use for fingerings** to open the normal score view with fingerings and playback. The button is enabled once the recognised score, with your corrections, passes the strict import and renders. **Scan source and recognition** in the score view returns to the comparison, and so does the browser's Back button, without a new job.

**Download raw MusicXML** saves the recognised file untouched, without fingerings. A batch offers **Download combined MusicXML** and each page's file instead. Once you have corrected notes, **Download corrected MusicXML** saves the corrected copy too. The downloads sit under **Files for a notation editor**. A notation editor remains the tool for what the review cannot correct. The playback tempo of a scan may be the app's default, not a recognised tempo.

## Correct the recognition

Select a note or rest in **Recognized notation** to correct it: click or tap it (a tap close to a note reaches it), or focus the notation and press Enter for the first note, then the arrow keys. The selected note carries the screen's red and an ink frame (so the selection does not rest on colour alone), and a panel docks at the bottom of the screen with what the note is ("Bar 11 · right hand · A4 quarter note · tied") and what can change:

| Control                     | What it does                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lower, Higher; ♭ ♮ ♯        | Moves the note one step on the staff, taking the key signature's sharp or flat for the new letter, or sets its accidental. A tied note moves with its whole tie chain, so a tie never joins two pitches, and later notes of that letter in the bar are drawn with the accidental they now need. Up and Down do the same from the keyboard; with Shift, a whole octave (a misread clef or ledger line). |
| Whole to 16th, Dotted       | Sets the length of the note, or of its whole chord. The rest of its voice moves with it; the other hand and the other voices never move, and a change that would move them is refused, as is a change to a note in a triplet or other tuplet. When the hands then disagree on the bar's length, the panel says so ("Bar 2: right hand 2 beats, left hand 3 beats, in 3/4.").                           |
| Tied to next                | Ties the note to the same pitch starting exactly where it ends, writing both the sounding tie and the drawn one, or removes the tie. A slur is never turned into a tie or back. When nothing of that pitch starts there, the panel says so instead of guessing.                                                                                                                                        |
| To left hand, To right hand | Moves the note to the other staff at the same time: the hand the fingering uses.                                                                                                                                                                                                                                                                                                                       |
| Remove                      | A duplicated chord note goes; a grace note goes; a lone note in a hand that is too long for its bar (a duplicate) goes and the rest of its voice moves up, otherwise it becomes a rest of the same length; a stray rest goes and the rest of its voice moves up into its place. A tied note asks for its tie to be removed first.                                                                      |
| Make it a note              | On a rest the recognition put where the page has a note: the rest becomes a note of the same length, at the pitch of the nearest note on its staff, ready to be moved with Lower and Higher.                                                                                                                                                                                                           |
| ‹ ›, Done                   | The previous or next note in reading order; Done or Escape closes the panel.                                                                                                                                                                                                                                                                                                                           |

Every correction is checked before it is recorded, then the notation is rendered and imported again at once, so **Use for fingerings** follows what is on screen. **Undo** (or Ctrl+Z) takes back the last correction and says which, **Reset to recognition** removes them all (Undo brings them back), and **Review corrections** lists them in the order they were made ("Bar 2, right hand: quarter rest removed"). Notes are named by their position in the raw recognition, not by the strict import, so a recognition the import refuses can still be corrected until it passes. Correcting works on the combined score, including when a page's notes do not fit together; only a batch whose pages cannot be combined at all (below) is reviewed page by page and corrected in a notation editor. A misread time signature cannot be corrected in the review.

**Places to check** appears above the notation when rules checked on the file itself find something: a tied note that ends before or after the next note of its pitch begins (the bar 11 tie of the test page, whose continuation arrived a quarter note late, is one), a tie without a matching note, hands that disagree on a bar's length, or a hand longer than its time signature. Each entry selects its note. While the strict import refuses the recognition, the list opens by itself and its first entry carries the screen's red instead of the unusable **Use for fingerings** (with no entry, **Scan again** does). They point at a place; they never decide the correction. On 250 of the library's curated engravings (8,101 bars) the tie rules flag nothing and the hand rule flags 12 bars in 7 pieces (0.15%), where the engraving lets one voice end early.

## On a phone or tablet

A phone cannot reach the PC worker: its 127.0.0.1 is the phone itself, and the worker accepts connections only from its own computer. On a device whose only pointer is a finger, the library offers **Take a photo** next to **Open your own score**, and the scan page offers **Take another photo** for further pages. Photos are named by the time they were taken. The page tools (rotate, move earlier, move later, remove) are one row of symbol buttons sized for a thumb, and pages are put in order by selecting a thumbnail and moving it, because dragging needs a mouse.

Instead of **Connect to this PC**, the phone says that recognition runs on a PC and offers **Send photos to your PC**, which opens the phone's own share sheet (mail, messages, a cloud drive of your choosing), or **Save photos** where the browser cannot share files. The files are named `page-01-…`, `page-02-…` in your order, so the PC's file chooser lists them in reading order. The app uploads nothing; where the photos go is your choice in the share sheet. On the PC, open them with **Open your own score** and scan as usual.

A phone that recognises by itself would need the PC worker reachable over the local network, with pairing and authentication. That is not built: the worker is designed for the one computer it runs on (`docs/research/omr.md`, Browser to worker connection).

### Rotation

Each rotation is computed from the original image, after its EXIF orientation, rather than from the previous turn. Rotating a page clears its old recognition; other pages and the order are kept. A failed or cancelled rotation leaves the current image usable. Rotation refuses images over 16 megapixels or 12,000 px on a side, and the rotated PNG must still fit the 10 MB limit. PDFs cannot be rotated.

### Image batches

The combined score appends each page's recognised measures in your order, keeping each page's time units, signatures and notation. It needs compatible parts and staves and an explicit starting context on each page. Repeat and jump navigation and incompatible layouts block the combined score; page-by-page review and downloads stay available. Notes that do not fit together, such as a broken tie on one page or across a page edge, do not block it: the combined score opens with them under **Places to check**, and the strict import keeps **Use for fingerings** unavailable until they are corrected. Combining never repairs recognition or fills in notes at page boundaries.

Slur and other span numbers are renumbered per page, so a slur never links across pages by accident; check continuations at page edges. MusicXML allows only 16 numbers per span type, so a batch whose spans would need more is refused, even below 20 pages.

### Display of homr results

The pinned homr writes no beams. For display, the app infers conventional beat groups in simple and compound meters, keeps any explicit beams and skips ambiguous cases. These groups are not the source's beams: a run of six eighths can come back as three pairs. Real beam recovery has to link the image's noteheads, stems and beam strokes to the recognised notes, checked separately from pitch and rhythm; a page-specific grouping rule is not a fix. A render-only regrouping of simultaneous notes by voice also works around a Verovio import issue that displaced notes in time and stretched bars.

## My scores

Uploads are saved automatically in the browser's IndexedDB (database `digitus2.my-scores`), with page order, rotation, original and rotated bytes, the raw recognised MusicXML, your list of corrections and the recogniser's name. The raw recognition is never overwritten: the corrected copy is the raw recognition with the saved corrections replayed, and an entry with corrections is listed as **Corrected recognition**. Plain MusicXML and MIDI imports are saved too. **My scores** appears in the library when it has entries. Reopening an entry never reconnects to the PC or restarts recognition. A multi-page result that cannot be combined still reopens page by page. Remove deletes an entry. A failed save is reported and the current work stays usable.

Browser storage belongs to one site and one browser profile, so a local preview and the GitHub Pages site have separate collections. Clearing site data or storage eviction removes it ([IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [storage limits](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)), so keep your own copies. Nothing is shared or published.

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

The scripts run in Windows PowerShell 5.1 and in PowerShell 7. Keep the repository in a short folder, such as `C:\Users\you\digitus2`: Windows limits paths to 260 characters unless long paths are enabled, and the homr environment holds files about 125 characters deep, so a deeply nested checkout fails during `setup.ps1` with "No such file or directory". `setup.ps1 -Root C:\short\folder` puts homr elsewhere; pass that folder to `--homr-toolchain`. The Audiveris extraction already goes through the folder's short 8.3 name.

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

Measured on the acceptance corpus (16 library pieces rendered as pages, each in four photo-like variants for homr and as a PDF for Audiveris; numbers and method in `docs/research/omr.md`): homr gets 97.0 to 99.5% of pitches and 86.8 to 91.0% of notes fully right (pitch, onset, length, staff and voice), Audiveris on the PDFs 98.7% and 86.7%. The errors to look for:

- **Missed ties**: 13 of the corpus's 47 ties have no tie or slur mark in homr's recognition at all, so the note sounds again instead of being held. Use **Tied to next**.
- **Rhythm**: notes read with the wrong value (sixteenths as 32nds, a stray rest), which **Places to check** often finds as hands that disagree on a bar's length.
- **A lost grand staff**: on a badly lit photo homr can read a piano page as one staff whose clef keeps changing. The review then says so above the comparison; the hands are not separated, so use another photo or the PDF.
- **Beams** on photos are drawn by beat for readability, not read from the source; on PDFs Audiveris reads them.
- **Key and time signature** are inferred when a continuation page does not print them.

The worker changes a homr export in two lossless ways, and says so under **Recognition details**: a measure that holds no music (homr writes the bracket closing a first ending as a measure of its own, which shifted every later bar) joins its neighbours, and a slur joining one pitch to its continuation is read as a tie even when homr gave the two notes different voice numbers. No pitch, duration or onset changes.

On eleven real phone photos (WhatsApp-compressed, five pages of Boëllmann's Op. 28 and a bound book page; results per photo in `docs/research/omr.md`), all were recognised, 9 pass the strict import and 8 have exactly the page's bars. What they add to the list:

- **Upside-down photos**: rotate them first. As taken, one lost its grand staff and another its key and meter; rotated, both read right.
- **Compound meters**: homr read 4/4 for 9/8 on both photos of one page, so every bar there is listed as longer than its time signature.
- **Cut-off or torn pages** come back with extra bars.
- **Duplicates and wrong hands**: the book page's first photos showed a duplicated C5 and a bass E3 in the upper hand. Correct such notes with **Remove** and **To left hand**.

Further limits:

- Small inset examples are excluded before recognition and flagged in the result. A legitimate short inset passage, such as an indented coda, can look like an example, so compare the whole original.
- Ornaments can be incomplete and rhythms wrong on any page.
- Audiveris (used for PDFs, and for images without homr) fails below about 10 px between staff lines and on skewed or curved pages.
- Text and tempo can be incomplete. A tempo like "= 100" without a recognised beat unit gives no tempo, and an app default tempo is not a recognised one.
- A recognition job finishing does not mean its notation imports. A tie whose continuation arrives late (the bar 11 tie of the test page, a quarter note late) is refused by the strict import until it is corrected.
- Synthetic test pages, eleven phone photos checked on bars, staves, key and time, strict parsing and passing tests do not certify musical accuracy. Multi-page books and browsers other than desktop Chrome are untested.

Source beam recovery for photos is an open request (#39).

## Licences

The PDF preview uses unmodified [Mozilla PDF.js](https://mozilla.github.io/pdf.js/examples/) (Apache-2.0) on a canvas, bundled with its licence and credited in About. The browser's own PDF viewer was not used: its coloured chrome breaks the black-and-white rule, and it blocked the raw download. The preview never changes what is recognised.

The recognisers are not part of the MIT web app. The setup scripts fetch them onto your PC: homr code and models are AGPL-3.0, Audiveris is AGPL-3.0-or-later, and the English text model is Apache-2.0. The worker's wrappers do not relicense them.
