# Scanning (experimental)

Scanning turns a photo or PDF of printed piano music into a score with fingerings. Recognition runs on the project's scanner, a small service on Google Cloud: homr for photos and Audiveris for PDFs. It works the same on a PC, a tablet and a phone, with nothing to install and no account. The app shows the original beside the recognised notation, and you decide whether to use the result. Recognition is not reliable. Good-looking notation can still contain wrong pitches, rhythms, ties, bars or hands, so treat every result as a draft to check. Original PDFs and flat, high-resolution scans work best; book photos can fail even when well lit. Handwriting is not supported.

MusicXML, compressed MusicXML (`.mxl`) and MIDI open directly, without the scanner. Why these recognisers were chosen, and what was measured: `docs/research/omr.md`. How the scanner runs, what it costs and how its spend is capped: `docs/scan-service.md`.

## What the app guarantees

- **Original bytes are kept.** Unrotated images and PDFs go to the scanner byte for byte. A rotated image is sent as a lossless PNG derived from the original, and four turns restore the exact original file. PDFs are never rasterised in the browser.
- **The page goes only where the scan page says** (Where your page goes, below), and only when you press **Scan this score**.
- **Recognition errors stay visible.** The source and the recognised notation sit side by side, and every result is marked as needing review. Scanned notation goes through a strict import that refuses malformed notation, for example a tie stop without a start. You can still download such a result, but **Use for fingerings** stays disabled.
- **Nothing is silently corrected.** The app never guesses a repair, deletes bars or invents notes, meter or tempo. The scanner never picks one of several exported scores or publishes an incomplete export. The scanner changes a recognition only by two lossless rules, described under Known recognition errors and reported under Recognition details.
- **Your corrections are explicit.** Each correction you make in the review is recorded, listed and undoable. The raw recognition is kept unchanged beside the corrected copy, and both can be downloaded.
- **Display preparation never changes the music.** Inferred beams and a voice regrouping for Verovio (below) apply only to the rendered copy. Recognised pitches, timing, note ids, raw downloads and the input to fingering and playback are untouched.

## Where your page goes

The scan page says it in one sentence under the advice: "Recognition runs on the project’s scanner on Google Cloud (Netherlands). Your page is sent there, recognized and then deleted." Pressing **Scan this score** is the act that sends it; there is no separate consent step.

- **What is sent.** Each page's original bytes (or the rotated PNG), one page per request, over HTTPS to the scanner's address in `apps/web/src/scan/service.ts`. Nothing else: no name, no account, no other page. Opening the scan page sends one request that carries no page, to wake the scanner while you arrange the pages.
- **What the scanner keeps.** Nothing. The page is recognised in memory (Cloud Run's file system is memory) and deleted when the job ends, together with its result; there is no job list and no copy. For each page the scanner writes one log line with the file type, the sizes, the seconds taken and the outcome, never the content, the file name or your address. To hold each reader to 30 recognitions an hour it counts your address in memory for up to an hour; the count is gone when the scanner stops. Google Cloud keeps its own request log for the service (time, status and the caller's address), as for any Cloud Run service ([Cloud Run logging](https://cloud.google.com/run/docs/logging)).
- **One page at a time.** The scanner recognises one page at a time, for all readers together. When another reader's page is being recognised, the app says the scanner is busy and keeps your pages; try again in a minute. In a batch, the pages after the busy one are not sent; **Retry failed pages** sends them.
- **The scanner sleeps when nobody scans.** The first scan after a quiet spell waits while it starts, and the status line says so.
- **It needs a connection.** Offline, the app says it could not reach the scanner and keeps the pages; the rest of the app works offline as before.
- **Its spend is capped.** The project pays for the scanner and caps it at 5 a month; when the cap is reached, scanning is off until the next month and the app says "The scanner could not answer. Try again later." (`docs/scan-service.md`).

## Scan a score

1. At the end of the library, choose **Open your own score**, or drop files onto the library. Choose up to 20 PNG or JPEG page images together (10 MB each), or one PDF (10 MB). Drag the thumbnails into reading order. Selecting a page shows keyboard-accessible move and remove controls and **Rotate 90° clockwise**. Rotate a sideways or upside-down photo before scanning.
2. Press **Scan this score**. Pages are recognised one at a time in the order shown; the status line reads "Page 2 of 5 · Recognizing…" for a batch. **Cancel scan** stops the job, and leaving the page cancels it too. A page that fails keeps the others; **Retry failed pages** resubmits only the failed ones. Most pages take under a minute, and the first scan after a quiet spell longer while the scanner starts (timings in `docs/scan-service.md`); the scanner gives up on a page after three minutes.
3. Compare the original with **Recognized notation**: every page, pitches, rhythms, bar count, clefs, key and time signatures, and hands. For an image batch, select a thumbnail to see that page's recognition, or switch to **Combined score**. For a PDF, step through the original with Previous and Next; the recognised pages may break differently. Text and tempo may be missing.
4. Correct what differs, note by note (Correct the recognition, below).
5. Press **Use for fingerings** to open the normal score view with fingerings and playback. The button is enabled once the recognised score, with your corrections, passes the strict import and renders. **Scan source and recognition** in the score view returns to the comparison, and so does the browser's Back button, without a new job.

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

Every correction is checked before it is recorded, then the notation is rendered and imported again at once, so **Use for fingerings** follows what is on screen. **Undo** (or Ctrl+Z) takes back the last correction and says which, **Reset to recognition** removes them all (Undo brings them back), and **Review corrections** lists them in the order they were made ("Bar 2, right hand: quarter rest removed"). Notes are named by their position in the raw recognition, not by the strict import, so a recognition the import refuses can still be corrected until it passes. Correcting works on the combined score, including when a page's notes do not fit together; only a batch whose pages cannot be combined at all (below) is reviewed page by page and corrected in a notation editor.

**Places to check** appears above the notation when rules checked on the file itself find something: a tied note that ends before or after the next note of its pitch begins (the bar 11 tie of the test page, whose continuation arrived a quarter note late, is one), a tie without a matching note, hands that disagree on a bar's length, or a hand longer than its time signature. Each entry selects its note. While the strict import refuses the recognition, the list opens by itself and its first entry carries the screen's red instead of the unusable **Use for fingerings** (with no entry, **Scan again** does). They point at a place; they never decide the correction. On 250 of the library's curated engravings (8,101 bars) the tie rules flag nothing and the hand rule flags 12 bars in 7 pieces (0.15%), where the engraving lets one voice end early.

A misread time signature is corrected from **Places to check**, never from a standing control. When two or more bars of a part have hands that agree with each other on one length that runs past the time signature, the first of those entries offers the meter of that length, once per part: **Set 9/8 time from bar 1**. The length decides the meter: whole beats in quarters (4.5 beats of 4/4 gives 9/8, 3 beats gives 3/4), otherwise in eighths, otherwise in sixteenths, which is a guess the reader confirms against the page (six quarters could be 12/8). The change rewrites only `<time>`, in every part: from that bar until the recognition writes a different time signature. A restatement of the replaced meter, such as a joined page's opening, changes with it; no note, duration or bar moves, and a common-time symbol is dropped so the drawing shows the new meter. It is refused for a meter it cannot write (1 to 32 beats of a whole to a 32nd), a bar that is no longer there, or the meter already in force. The strict import reads a time signature without checking bar lengths against it, so a meter change cannot make it fail; a bar that still overruns the new meter stays under **Places to check**. On the owner's flat photo of Boëllmann Op. 28 No. II page 5, homr's 4/4 gave 14 places to check; 9/8 from bar 1 leaves one, bar 14, where the hands really disagree (9 and 6 beats). The torn photo goes from 7 to 1 the same way.

## On a phone or tablet

A phone or tablet scans exactly like a PC: the same **Scan this score**, the same scanner, the same review. What differs is the camera and the touch tools. On a device whose only pointer is a finger, the library offers **Take a photo** next to **Open your own score**, and the scan page offers **Take another photo** for further pages. Photos are named by the time they were taken. The page tools (rotate, move earlier, move later, remove) are one row of symbol buttons sized for a thumb, and pages are put in order by selecting a thumbnail and moving it, because dragging needs a mouse.

### Rotation

Each rotation is computed from the original image, after its EXIF orientation, rather than from the previous turn. Rotating a page clears its old recognition; other pages and the order are kept. A failed or cancelled rotation leaves the current image usable. Rotation refuses images over 16 megapixels or 12,000 px on a side, and the rotated PNG must still fit the 10 MB limit. PDFs cannot be rotated.

### Image batches

The combined score appends each page's recognised measures in your order, keeping each page's time units, signatures and notation. It needs compatible parts and staves and an explicit starting context on each page. Repeat and jump navigation and incompatible layouts block the combined score; page-by-page review and downloads stay available. Notes that do not fit together, such as a broken tie on one page or across a page edge, do not block it: the combined score opens with them under **Places to check**, and the strict import keeps **Use for fingerings** unavailable until they are corrected. Combining never repairs recognition or fills in notes at page boundaries.

Slur and other span numbers are renumbered per page, so a slur never links across pages by accident; check continuations at page edges. MusicXML allows only 16 numbers per span type, so a batch whose spans would need more is refused, even below 20 pages.

### Display of homr results

The pinned homr writes no beams. For display, the app infers conventional beat groups in simple and compound meters, keeps any explicit beams and skips ambiguous cases. These groups are not the source's beams: a run of six eighths can come back as three pairs. Real beam recovery has to link the image's noteheads, stems and beam strokes to the recognised notes, checked separately from pitch and rhythm; a page-specific grouping rule is not a fix. A render-only regrouping of simultaneous notes by voice also works around a Verovio import issue that displaced notes in time and stretched bars.

## My scores

Uploads are saved automatically in the browser's IndexedDB (database `digitus2.my-scores`), with page order, rotation, original and rotated bytes, the raw recognised MusicXML, your list of corrections and the recogniser's name. The raw recognition is never overwritten: the corrected copy is the raw recognition with the saved corrections replayed, and an entry with corrections is listed as **Corrected recognition**. Plain MusicXML and MIDI imports are saved too. **My scores** appears in the library when it has entries. Reopening an entry never contacts the scanner or restarts recognition. A multi-page result that cannot be combined still reopens page by page. Remove deletes an entry. A failed save is reported and the current work stays usable.

Browser storage belongs to one site and one browser profile, so a local preview and the GitHub Pages site have separate collections. Clearing site data or storage eviction removes it ([IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [storage limits](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)), so keep your own copies. Nothing is shared or published.

## When scanning does not start

The app keeps your pages in every case below, and **Scan this score** stays available.

- **"The scanner is busy with another score. Try again in a minute."** One page is recognised at a time for every reader. Wait a minute and press it again. In a batch, the pages after it wait too.
- **"Could not reach the scanner. Check your connection and try again."** The device is offline. Reconnect and retry; nothing was lost.
- **"The scanner could not answer. Try again later."** The device is online, but no answer from the scanner reached the app: the scanner is down, overloaded, or switched off for the rest of the month because its spend cap was reached (`docs/scan-service.md`). In those cases Google answers in front of the scanner, and the browser does not let the page read that answer, so the app cannot say which one it is. A network drop the device has not noticed looks the same.
- **"The scanner could not answer (error 500). Try again later."** The scanner itself answered with an error. The number is its error code.
- **"Recognition timed out. Try a smaller, clearer page."** The scanner gives up on a page after three minutes. A smaller crop, a flatter photo or the original PDF usually helps.
- **"You have scanned a lot in the past hour. Try again later."** Each reader has 30 recognitions an hour; the limit frees up as the hour passes. In a batch, the pages after it wait too.
- **"Cancellation could not be confirmed. The scanner stops by itself within three minutes."** The cancel request was lost; the page stops by the scanner's own time limit, and the scanner may say it is busy until then.

When the scanner answers but cannot read the page:

- **Staff resolution too low.** The message gives the measured staff-line spacing, for example six pixels. Use the full-resolution original, photograph a smaller area more closely, or use the original PDF. Enlarging a compressed image does not restore detail. homr refuses images over 25 megapixels.
- **Multiple scores or incomplete export.** Separate examples, footnotes and a curved page can confuse the recogniser. Try a single main music section or the original PDF.
- **Other recognition failure.** A flatter, sharper source may help; ordinary book photos remain unreliable.
- **Preview unavailable.** Open the original in another tab. The PDF preview does not run document scripts, and some unusual PDFs or image encodings do not preview.

## Known recognition errors and limits

Measured on the acceptance corpus (16 library pieces rendered as pages, each in four photo-like variants for homr and as a PDF for Audiveris; numbers and method in `docs/research/omr.md`): homr gets 97.0 to 99.5% of pitches and 86.8 to 91.0% of notes fully right (pitch, onset, length, staff and voice), Audiveris on the PDFs 98.7% and 86.7%. The errors to look for:

- **Missed ties**: 13 of the corpus's 47 ties have no tie or slur mark in homr's recognition at all, so the note sounds again instead of being held. Use **Tied to next**.
- **Rhythm**: notes read with the wrong value (sixteenths as 32nds, a stray rest), which **Places to check** often finds as hands that disagree on a bar's length.
- **A lost grand staff**: on a badly lit photo homr can read a piano page as one staff whose clef keeps changing. The review then says so above the comparison; the hands are not separated, so use another photo or the PDF.
- **A line of music read only in part**: a staff cut short loses bars, a short stray staff adds some. The review then says that bars may be missing or added and asks you to compare with the original; the alert is shown above the comparison, like the grand-staff one.
- **Beams** on photos are drawn by beat for readability, not read from the source; on PDFs Audiveris reads them.
- **Key and time signature** are inferred when a continuation page does not print them.

The scanner changes a homr export in two lossless ways, and says so under **Recognition details**: a measure that holds no music (homr writes the bracket closing a first ending as a measure of its own, which shifted every later bar) joins its neighbours, and a slur joining one pitch to its continuation is read as a tie even when homr gave the two notes different voice numbers. No pitch, duration or onset changes.

On fourteen real phone photos (eleven WhatsApp-compressed, of five pages of Boëllmann's Op. 28 and a bound book page, and three Google PhotoScan images of Bach's Invention No. 13; results per photo in `docs/research/omr.md`), all were recognised, 12 pass the strict import and 11 have exactly the page's bars. What they add to the list:

- **Upside-down photos**: rotate them first. As taken, one lost its grand staff and another its key and meter; rotated, both read right.
- **Compound meters**: homr read 4/4 for 9/8 on both photos of one page, so every bar there is listed as longer than its time signature. **Set 9/8 time from bar 1** on the first entry corrects it.
- **Cut-off or torn pages** come back with extra bars.
- **Duplicates and wrong hands**: the book page's first photos showed a duplicated C5 and a bass E3 in the upper hand. Correct such notes with **Remove** and **To left hand**.

Further limits:

- Small inset examples are excluded before recognition and flagged in the result. A legitimate short inset passage, such as an indented coda, can look like an example, so compare the whole original.
- Ornaments can be incomplete and rhythms wrong on any page.
- Audiveris (used for PDFs) fails below about 10 px between staff lines and on skewed or curved pages.
- Text and tempo can be incomplete. A tempo like "= 100" without a recognised beat unit gives no tempo, and an app default tempo is not a recognised one.
- A recognition job finishing does not mean its notation imports. A tie whose continuation arrives late (the bar 11 tie of the test page, a quarter note late) is refused by the strict import until it is corrected.
- Synthetic test pages, fourteen phone photos checked on bars, staves, key and time, strict parsing and passing tests do not certify musical accuracy. Multi-page books and browsers other than desktop Chrome are untested.

Source beam recovery for photos is an open request (#39).

## Licences

The PDF preview uses unmodified [Mozilla PDF.js](https://mozilla.github.io/pdf.js/examples/) (Apache-2.0) on a canvas, bundled with its licence and credited in About. The browser's own PDF viewer was not used: its coloured chrome breaks the black-and-white rule, and it blocked the raw download. The preview never changes what is recognised.

The recognisers are not part of the MIT web app: they run on the project's server, and nothing of them reaches your browser. homr code and models are AGPL-3.0, Audiveris is AGPL-3.0-or-later, and the English text model is Apache-2.0. The scanner's complete source is public in this repository: the service in `research/omr/service/` (its `Dockerfile` fetches each recogniser at a pinned version and checks its digest) and the adapters in `research/omr/prototypes/local-worker/`, whose wrappers do not relicense them.
