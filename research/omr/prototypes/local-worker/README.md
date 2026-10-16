# Optional PC recognition worker

Experimental PC connector for the app's photo/PDF review flow; see [app setup](../../../../docs/scanning.md). Python 3.11 and the already-proven portable Audiveris 5.11.0 are required. The worker itself uses only Python's standard library. Audiveris remains a separately licensed AGPL-3.0-or-later tool; preserve its notices. No service installation, public listener, tunnel or autostart is created.

From the repository root, prepare the checked portable runtime using [the quality adapter's setup](../oemer-quality/README.md). Existing runtime:

```powershell
python research/omr/prototypes/local-worker/worker.py --short-staves --text-models research/omr/results/quality-wave/text-models
```

For a fresh extraction, pass `--bundle research/omr/results/quality-wave/toolchain`. Optional checked English OCR assets are supplied by the quality setup; add `--text-models research/omr/results/quality-wave/text-models`. The model is copied into each job's private directory. Default recognition without `--short-staves` or `--text-models` remains available for comparison. Those explicit settings improve measured fixtures; they do not certify arbitrary scans.

Keep the terminal open; Ctrl+C cancels work and removes this instance's job directories. The server binds **only `127.0.0.1:8996`**. The default allowed browser origin is `https://marchalmaxim.github.io`; this is an origin boundary, not an individual GitHub Pages project-path boundary. Requests from other origins, missing origins, rebinding Host values and duplicate security headers fail closed. No cookies, wildcard CORS or remote-recognition endpoint is used. Local native programs can forge HTTP headers; this protocol is not authentication against already-running local malware.

For an isolated local app preview, add its exact HTTP loopback origin, for example `--dev-origin http://127.0.0.1:4196`. This repeatable option adds only explicitly named localhost/127.0.0.1 HTTP origins with a port; Pages remains allowed. Other ports, external HTTP hosts, URL paths, credentials and wildcard origins are rejected. The listener remains 127.0.0.1 only. This is a development-origin configuration, never a browser security bypass.

The reusable `client.mjs` exports `createLocalWorkerClient()`. Call it from an explicit user action on the HTTPS frontend after explaining the connection. Current Chrome uses the **`loopback-network`** permission for `127.0.0.1`; the legacy `local-network-access` grant alone did not permit the tested Chrome 155 connection. Fetches declare `targetAddressSpace: 'loopback'` and omit credentials. Permission denial is a normal recoverable connection failure. The research browser test grants/denies only disposable browser contexts; it does not alter the user's profile or disable security.

```javascript
const local = createLocalWorkerClient();
const health = await local.health();
const job = await local.start(selectedImageOrPdf);
await local.wait(job.id, { signal: cancelController.signal });
const { xml, needsReview } = await local.result(job.id);
// Keep the recognition review step: needsReview is always true.
```

PNG, JPEG and PDF are sent as original binary bodies with matching MIME types. PDFs remain `.pdf` inputs to the native recognizer, without browser rasterization. The connector proof used one clean PNG; broader PDF accuracy is separate quality evidence. A network failure after submission can leave a bounded native job running until cancellation/timeout; do not silently resubmit an unknown job.

| Request                  | Purpose                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `GET /v1/health`         | Protocol, recognizer profile and upload limit                             |
| `POST /v1/jobs`          | Original image/PDF body; returns opaque job ID and 202                    |
| `GET /v1/jobs/ID`        | `running`, `cancelling`, `ready`, `failed`, `timed_out` or `cancelled`    |
| `GET /v1/jobs/ID/result` | Complete parsed raw MusicXML after successful process exit; otherwise 409 |
| `DELETE /v1/jobs/ID`     | Cancel the native process tree; invalidate any result                     |

POST and DELETE require `X-Digitus2-Client: 1`; every request requires the allowed Origin and exact loopback Host/port. Browser CORS preflights are supported. The compatibility private-network header is not a replacement for browser permission.

Limits: one recognition at a time, four HTTP handlers, 10 MiB upload, eight retained jobs, five-minute terminal retention, 20 MiB uncompressed result, 180-second default native timeout (maximum configurable 600), 4 GiB JVM heap. Native logs/workspaces have periodically checked 8/128 MiB guards; these are not OS-enforced memory/disk quotas and can overshoot between samples. Full logs are private local artifacts, never HTTP responses. AppData, home, temp, native caches and optional OCR assets are job-local; inherited JVM/OCR options are cleared. Failed/cancelled/oversized/ambiguous output is never published. Retention cleanup recognizes only marked owned directories, including expired interrupted-instance jobs, and preserves unrelated files. Cleanup runs while the worker is running. Force-killing the standalone Python interpreter can interrupt cleanup; use Ctrl+C. The browser harness kills its owned whole process tree on exit.

Focused checks and actual deployed-origin proof:

```powershell
python -m pytest research/omr/prototypes/local-worker -q
node --test research/omr/prototypes/local-worker/client.test.mjs
pnpm --filter @digitus2/engine build
node research/omr/prototypes/local-worker/browser-smoke.mjs NEW-UNIQUE-ID --text-models research/omr/results/quality-wave/text-models
node research/omr/prototypes/local-worker/score-output.mjs NEW-UNIQUE-ID
node research/omr/prototypes/local-worker/format-durable.mjs
```

The browser harness starts and closes its own worker, uses installed Chrome and the actual deployed Pages origin, exercises denied/granted permission, submits a real scan, cancels another real native job, and explicitly imports the returned raw MusicXML using the existing frontend file input. Results stay in ignored `research/omr/results/connector-wave/`; each run ID must be new. It does not add frontend scanning controls. Test helpers with simulated recognition are protocol/lifecycle tests, not accuracy evidence. See [the connector report](../../../../docs/research/omr-local-worker-2026-10-15.md).

## Actionable failures and real-photo limit

Job status retains the existing error code and adds optional failure metadata with code, message and bounded public details. Low staff resolution reports the measured interline pixels and higher-resolution/PDF guidance. Multiple exported scores and known incomplete native exports remain held; the worker does not choose a movement or publish a partial result. No native log, local pathname or stack trace is sent over HTTP.

An actual 768 × 1024 curved book photo failed at six-pixel staff spacing. Bounded local contrast/illumination/binarization/enlargement controls and a separate existing dewarping recognizer did not yield musically usable input. These are private negative evidence, not enabled preprocessing or a new backend. Ordinary book-photo capability is held; see the app setup guide's acceptance limit.
