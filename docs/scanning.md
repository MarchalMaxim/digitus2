# Experimental photo and PDF scanning

Experimental recognition accepts PNG, JPEG and PDF, offers source comparison before you choose **Use for fingerings**. The optional PC worker uses a pinned local homr profile for photos and Audiveris for PDFs. Both supplied book photos now recover the main piano layout in prototype testing, but musical review still finds errors such as duplicated notes and missing chord ties. This remains a draft, correction-and-review workflow; it is not an accurate automatic transcription guarantee.

Good-looking notation can still contain wrong pitches, rhythms, missing bars or incorrect hands. Original PDFs generally work better than screenshots. Handwriting and arbitrary phone-photo conditions are not established capabilities.

MusicXML, compressed MusicXML and MIDI still open directly, without the PC worker.

## Open and review a score

1. At the end of the library, choose **Open your own score**, or drop a file onto the library. Choose up to 20 PNG/JPEG page images together (up to 10 MB each), or one PDF. Arrange image thumbnails in reading order by dragging; selecting a page reveals keyboard-accessible move/remove controls and **Rotate 90°**. Rotate a sideways or upside-down photo before recognition; the preview and submitted pixels use that orientation. Add page images before recognition.
2. On the computer running the worker below, press **Connect to this PC**. If the browser asks, allow this site to connect to the local computer. The app never probes this permission automatically.
3. Press **Scan this score**. You can cancel while uploading or recognizing; leaving the scan also cancels a pending job. Recognition follows the selected image order, one page at a time. Successful pages are retained when another fails; Retry unfinished pages submits only pages without a result. Recognition normally takes seconds, but difficult pages can take minutes.
4. Compare the original with **Recognized notation**, including every page, pitches, rhythms, bar count, clefs, signatures and hands. For an image batch, select each original thumbnail and compare its individual recognition; Combined score shows the joined notation. Raw page downloads remain available. For a multipage PDF, use the original's Previous/Next controls. The recognized pages may reflow differently. Text and tempo may be incomplete.
5. Choose **Use for fingerings** when ready. There is no comparison checkbox; the button becomes available once the recognized score passes import and rendering checks. This opens the existing fingering and playback view. **Scan source and recognition** returns to the original and raw result. Saved entries in **My scores** can reopen those sources and results after a reload.

**Download raw MusicXML** saves the untouched recognized file, without digitus2 fingerings. Use a notation editor to correct it, then open the corrected MusicXML normally. If strict scan parsing refuses malformed notation, the raw download remains available and **Use for fingerings** stays disabled. There is no guessed repair. A technically readable result is not certified accurate.

## Rotation and local collection

Each rotation is computed from the original browser-oriented image, including its EXIF orientation, rather than recompressing the previous turn. Four clockwise turns restore the exact original file. Rotation clears that page's stale recognition; order and other pages are retained. A failed or cancelled rotation leaves the current image usable. Rotation is bounded to 16 megapixels and a 12,000-pixel side before decode, and the resulting PNG must fit the existing 10 MB upload limit. PDFs do not expose image rotation.

The local collection uses IndexedDB database digitus2.my-scores, schema version 1, with file/blob records rather than base64 strings in localStorage. MusicXML/MIDI imports are retained too. Saves are serialized and only reported as stored after a successful transaction. Reopening does not reconnect to the PC or restart recognition automatically. A multi-page result that cannot safely combine still reopens its individual page review/downloads. Public sharing remains a future TODO; local uploads are not published.

## Image batches and notation display

Combining images appends the recognized measures in the order you chose, retaining each page's time units, signatures and source notation. It requires compatible parts/instruments/staves and explicit starting context. Unsupported repeat/jump navigation, incompatible layouts or invalid sounding ties block combined use while individual page review/download remains available. This does not repair recognition errors or infer missing notes at page boundaries.

Graphical span numbers (such as slurs) are scoped to their source page in the combined copy; compare continuations at page edges. Original endpoint patterns and separate raw files are retained. MusicXML provides only 16 number levels per span type, so a batch can be refused if disjoint span numbering would exceed that limit even when it is within the 20-image upload limit.

HOMR currently omits beam markings. The display infers conservative conventional beat groups for supported simple/compound meters, preserving explicit beams and skipping ambiguous cases. These are not recovered photographic beam groups. A render-only voice normalization also avoids a Verovio interleaving issue that displaced some simultaneous notes and stretched displayed bars. Neither display preparation changes recognized pitches, source timing, note IDs or raw downloads. The fingering/playback engine continues to consume the source notation.

## Prepare the optional Windows PC worker

Use a Windows PC with Python 3.11 or later and PowerShell. The recognition process allows a 4 GB Java heap; leave sufficient memory available. A recent desktop Chrome is the tested browser. Java is included in the pinned portable Audiveris bundle.

Get the digitus2 repository from [GitHub](https://github.com/MarchalMaxim/digitus2) and open a terminal in its root folder. Run these once:

```powershell
powershell -File research/omr/prototypes/oemer-quality/prepare-audiveris.ps1
powershell -File research/omr/prototypes/oemer-quality/prepare-text-models.ps1
powershell -File research/omr/prototypes/homr-photo/setup.ps1
```

The photo setup prepares an isolated Python CPU runtime, pinned homr source and ONNX models (about 139 MB compressed model downloads); it verifies source/model identities and applies the documented geometry/export patches. The optional homr code and models are AGPL-3.0 software, fetched locally rather than bundled into the MIT web app. The PDF scripts download and verify a pinned Audiveris 5.11.0 archive (about 85 MB) and the compatible English text model (about 23 MB). Audiveris is extracted into the repository's ignored research directory, rather than installed as a system service. Existing prepared extraction is deliberately preserved; if the first script reports that extraction exists, use the verified existing runtime instead of extracting over it.

Start the worker whenever you want to scan:

```powershell
python research/omr/prototypes/local-worker/worker.py --bundle research/omr/results/quality-wave/toolchain --short-staves --text-models research/omr/results/quality-wave/text-models --homr-toolchain research/omr/results/photo-options/toolchain
```

Keep that terminal open. It should report `http://127.0.0.1:8996` and the `pinned-eng` recognizer profile. Close it or press Ctrl+C to stop the worker and its current recognition process. No account, public server, tunnel or automatic startup is configured.

The measured experimental profile uses two fixed short-staff settings and the pinned legacy-capable English model. Missing English configuration is explicitly reported by the worker and app; it can omit musical text. English OCR still does not guarantee complete metronome beat units or playback tempo. Do not interpret an app default tempo as a recognized tempo.

The worker defaults to allowing the deployed origin `https://marchalmaxim.github.io`. For a local development preview, add its **exact** loopback origin explicitly:

```powershell
python research/omr/prototypes/local-worker/worker.py --bundle research/omr/results/quality-wave/toolchain --short-staves --text-models research/omr/results/quality-wave/text-models --homr-toolchain research/omr/results/photo-options/toolchain --dev-origin http://127.0.0.1:4196
```

Use that exact address in the browser. `http://localhost:4196` is a different origin and needs its own `--dev-origin` option. Other ports and external HTTP hosts remain denied. The worker still binds only to 127.0.0.1; the development option never creates a public listener.

## Connection problems

- **Could not connect:** confirm that the terminal is still running and that this browser is on that same PC. Retry Connect. If you denied local access, open this site's browser permissions, allow its local/loopback-network connection, then retry. Browser permission names vary; never disable browser security.
- **Phone or tablet:** its localhost refers to that device, not your PC. This experimental connector cannot reach your PC from the phone. A future remote processor would require separate setup; none is provided here.
- **PC already scanning:** wait for the other job or cancel it. One native recognition runs at a time.
- **Staff resolution too low:** the error reports the measured spacing, for example six pixels between staff lines. Use the full-resolution original file, take a closer photo of a smaller music area, or use the original PDF. Enlarging a compressed image cannot restore missing detail.
- **Multiple scores or incomplete export:** separate examples, footnotes and a curved page can confuse the recognizer. The app does not silently choose the largest export or publish a known incomplete score. Try a single main music section or the original PDF.
- **Other recognition failure:** a flatter, higher-resolution source may help, but ordinary book photos remain unreliable. A failure is not repaired automatically.
- **Preview unavailable:** open the original in a separate tab for comparison. The local PDF preview does not run document scripts; some unusual PDFs or image encodings may not preview.
- **Cancellation cannot be confirmed:** close the worker terminal to stop native processing. Normal jobs have a default three-minute native timeout, and the app also bounds its wait.

## Privacy and lifetime

The chosen input goes only from this browser to the optional worker on 127.0.0.1. Unrotated images and PDFs retain their exact bytes; a rotated image is sent as a lossless PNG derived from the original. Recognition runs locally in the prepared homr process for photos and Audiveris for PDFs. Setup downloads the dependencies; scan jobs do not download models or contact an external recognizer. There is no external recognition service or score upload to GitHub. Initial tool setup downloads software/model assets; ordinary app assets are served by the website as usual.

The app automatically saves uploaded scores, original/effective image bytes, page order/orientation, raw XML and recognizer provenance in browser-local IndexedDB. **My scores** appears in the library when entries exist. Reopen a draft to continue deliberately, or a recognized result to review without scanning again; Remove deletes that saved entry. No worker credentials or active jobs are persisted. Storage failure is reported and current in-memory work remains usable. Browser storage is local to this site and browser profile: localhost previews and the GitHub Pages site have separate collections, and clearing site data or browser eviction can remove them. Keep exported files as backups; see [IndexedDB storage](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) and [browser storage limits](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria). On the PC, jobs use isolated temporary directories, settings and caches. Terminal jobs expire after five minutes while the worker runs; shutdown removes its owned job directories. The worker rejects oversize inputs, bounds result/log/workspace size and terminates timed-out or cancelled native processes. See the [connector research report](research/omr-local-worker-2026-10-15.md) for the measured boundaries.

PDF source preview uses [Mozilla PDF.js](https://mozilla.github.io/pdf.js/examples/) locally with a bundled worker. It changes only the preview; recognition receives the original PDF bytes. PDF.js is unmodified Apache-2.0 software, credited in About with the licence shipped alongside the app. Recognition software has its own upstream licences; it is fetched by the preparation scripts, not bundled into the web app.

Codex — Sol 6.1 implementation; Astra coordination and independent acceptance.

## Real-photo acceptance and remaining limits

The original Audiveris photo path failed both supplied book photographs: one stopped at six-pixel staff spacing; the sharper one lost grand-staff grouping and exported tiny fragments. Simple contrast/upscaling and an oemer control did not solve those failures.

The new local homr profile recognizes the four main piano systems. Geometry-based preprocessing excludes detached small examples and removes a neighbouring five-line staff from a decoder margin before recognition. It never substitutes a handwritten score or deletes XML bars to match a reference. The original input remains untouched, and excluded material is flagged for review. A generic exporter fix makes existing semantic accidentals visible without changing their pitches.

These changes improve recovery, not certainty. The same page can still contain duplicated notes, missed chord ties, incomplete ornaments or incorrect rhythms. Meter can be inferred rather than read when a continuation page omits it. A legitimate short inset passage can resemble an explanatory example: compare the whole original, including excluded areas, before accepting a result. Download and correct the MusicXML in a notation editor when needed.

Exact source/output comparisons and private negative controls are recorded in docs/reviews/scanning-2026-10-15.md. Private user photos and results are never published. Software tests, successful exports and strict parsing do not certify musical accuracy.
