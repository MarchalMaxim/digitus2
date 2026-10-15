# Experimental photo and PDF scanning

Experimental recognition accepts PNG, JPEG and PDF, then adds finger numbers **only after you review the recognition**. Current evidence is strongest for original PDFs and flat, high-resolution printed scans. Ordinary book-photo acceptance is **not ready**: a real well-lit, curved 768 × 1024 book photo failed, and bounded preparation/alternative-recognizer controls did not produce usable fingering input. This work remains a draft for that photo capability.

Good-looking notation can still contain wrong pitches, rhythms, missing bars or incorrect hands. Original PDFs generally work better than screenshots. Handwriting and arbitrary phone-photo conditions are not established capabilities.

MusicXML, compressed MusicXML and MIDI still open directly, without the PC worker.

## Open and review a score

1. At the end of the library, choose **Open your own score**, or drop a file onto the library. Choose PNG, JPEG or PDF, up to 10 MB.
2. On the computer running the worker below, press **Connect to this PC**. If the browser asks, allow this site to connect to the local computer. The app never probes this permission automatically.
3. Press **Scan this score**. You can cancel while uploading or recognizing; leaving the scan also cancels a pending job. Recognition normally takes seconds, but difficult pages can take minutes.
4. Compare the original with **Recognized notation**, including every page, pitches, rhythms, bar count, clefs, signatures and hands. For a multipage PDF, use the original's Previous/Next controls. The recognized pages may reflow differently. Text and tempo may be incomplete.
5. If it looks usable, check **I compared the recognition with my original**, then choose **Use for fingerings**. This opens the existing fingering and playback view. **Scan source and recognition** returns to the original and raw result during this visit.

**Download raw MusicXML** saves the untouched recognized file, without digitus2 fingerings. Use a notation editor to correct it, then open the corrected MusicXML normally. If strict scan parsing refuses malformed notation, the raw download remains available and **Use for fingerings** stays disabled. There is no guessed repair. A technically readable result is not certified accurate.

## Prepare the optional Windows PC worker

Use a Windows PC with Python 3.11 or later and PowerShell. The recognition process allows a 4 GB Java heap; leave sufficient memory available. A recent desktop Chrome is the tested browser. Java is included in the pinned portable Audiveris bundle.

Get the digitus2 repository from [GitHub](https://github.com/MarchalMaxim/digitus2) and open a terminal in its root folder. Run these once:

```powershell
powershell -File research/omr/prototypes/oemer-quality/prepare-audiveris.ps1
powershell -File research/omr/prototypes/oemer-quality/prepare-text-models.ps1
```

The scripts download and verify a pinned Audiveris 5.11.0 archive (about 85 MB) and the compatible English text model (about 23 MB). Audiveris is extracted into the repository's ignored research directory, rather than installed as a system service. Existing prepared extraction is deliberately preserved; if the first script reports that extraction exists, use the verified existing runtime instead of extracting over it.

Start the worker whenever you want to scan:

```powershell
python research/omr/prototypes/local-worker/worker.py --bundle research/omr/results/quality-wave/toolchain --short-staves --text-models research/omr/results/quality-wave/text-models
```

Keep that terminal open. It should report `http://127.0.0.1:8996` and the `pinned-eng` recognizer profile. Close it or press Ctrl+C to stop the worker and its current recognition process. No account, public server, tunnel or automatic startup is configured.

The measured experimental profile uses two fixed short-staff settings and the pinned legacy-capable English model. Missing English configuration is explicitly reported by the worker and app; it can omit musical text. English OCR still does not guarantee complete metronome beat units or playback tempo. Do not interpret an app default tempo as a recognized tempo.

The worker defaults to allowing the deployed origin `https://marchalmaxim.github.io`. For a local development preview, add its **exact** loopback origin explicitly:

```powershell
python research/omr/prototypes/local-worker/worker.py --bundle research/omr/results/quality-wave/toolchain --short-staves --text-models research/omr/results/quality-wave/text-models --dev-origin http://127.0.0.1:4196
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

The original file goes only from this browser to the optional worker on 127.0.0.1. Recognition is performed by the local Audiveris process. There is no external recognition service or score upload to GitHub. Initial tool setup downloads software/model assets; ordinary app assets are served by the website as usual.

The app keeps original bytes, raw XML and recognizer provenance in memory during this visit. They are not written to localStorage; reloading clears them. Save the raw XML if you need it later. On the PC, jobs use isolated temporary directories, settings and caches. Terminal jobs expire after five minutes while the worker runs; shutdown removes its owned job directories. The worker rejects oversize inputs, bounds result/log/workspace size and terminates timed-out or cancelled native processes. See the [connector research report](research/omr-local-worker-2026-10-15.md) for the measured boundaries.

PDF source preview uses [Mozilla PDF.js](https://mozilla.github.io/pdf.js/examples/) locally with a bundled worker. It changes only the preview; recognition receives the original PDF bytes. PDF.js is unmodified Apache-2.0 software, credited in About with the licence shipped alongside the app. Recognition software has its own upstream licences; it is fetched by the preparation scripts, not bundled into the web app.

Codex — Sol 6.1 implementation; Astra coordination and independent acceptance.

## Real-photo acceptance limit

The tested book photo was rejected by the native recognizer's scale stage at six pixels between staff lines, before XML existed. Three deterministic job-local preparation controls retained the untouched original but either crashed recognition or produced fragmented, musically unusable exports. A single existing photo-oriented recognizer with dewarping produced XML, but independent visual review found wrong durations, lost chords and severe bass-to-right-hand assignment errors. Those results are held; none of that preparation or alternative output is enabled in the app.

The public job status now distinguishes low staff resolution, multiple scores, timeout and known incomplete native export. Detailed source images, native logs and negative controls remain private local evidence. A successful HTTP job or strict XML parse is never an accuracy certificate. This limitation must be resolved before claiming ordinary book-photo scanning works.
