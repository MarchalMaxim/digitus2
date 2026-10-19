# Local recognition worker (research)

The research loopback server and the scan service's engine. `worker.py` is a loopback HTTP server, written with Python's standard library only, that runs homr on page images and Audiveris on PDFs and returns the raw MusicXML; the acceptance harness and the adapters' tests use this folder on a Windows PC. Its job runner, adapters (`homr.py`, `audiveris.py`), export rules (`normalize_export.py`) and error mapping (`recognition_errors.py`) are also what the app's scan service runs in its Linux container ([research/omr/service](../../service/README.md), [docs/scan-service.md](../../../../docs/scan-service.md)). The app does not talk to this worker: readers scan through the service ([docs/scanning.md](../../../../docs/scanning.md)). The research behind it is in [docs/research/omr.md](../../../../docs/research/omr.md).

## Run

Requirements: Windows, Python 3.11 or later, and the three prepared toolchains (Audiveris, the English text model and homr). Prepare them once from the repository root:

```powershell
powershell -File research/omr/prototypes/oemer-quality/prepare-audiveris.ps1
powershell -File research/omr/prototypes/oemer-quality/prepare-text-models.ps1
powershell -File research/omr/prototypes/homr-photo/setup.ps1
```

Start the worker:

```powershell
python research/omr/prototypes/local-worker/worker.py --bundle research/omr/results/quality-wave/toolchain --short-staves --text-models research/omr/results/quality-wave/text-models --homr-toolchain research/omr/results/photo-options/toolchain
```

| Option                 | Effect                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `--bundle DIR`         | Audiveris toolchain (must hold the checked `audiveris-5.11.0.msi` and `portable/Audiveris`); always required, because PDFs use it             |
| `--short-staves`       | Two Audiveris constants that keep short staves (`LinesRetriever.minStaffLength=12`, `ClustersRetriever.minClusterLengthRatio=0.15`)           |
| `--text-models DIR`    | Pinned English `eng.traineddata`, copied into each job; without it, health, status and results carry an `ocr-language-not-configured` warning |
| `--homr-toolchain DIR` | Prepared homr for PNG and JPEG; without it, images also go to Audiveris                                                                       |
| `--dev-origin URL`     | Also allow an exact `http://127.0.0.1:PORT` or `http://localhost:PORT` origin (repeatable); the Pages origin stays allowed                    |
| `--timeout S`          | Native timeout per job, default 180 s, maximum 600 s                                                                                          |
| `--port`, `--root`     | Listening port (default 8996) and job directory (default `research/omr/results/connector-wave/jobs`)                                          |

Keep the terminal open. Ctrl+C stops running recognition and removes this instance's job directories. Force-killing Python can skip that cleanup; expired directories of an interrupted instance are removed the next time the worker runs.

## Protocol

| Request                  | Purpose                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `GET /v1/health`         | Protocol, recogniser profile, capabilities, warnings and upload limit       |
| `POST /v1/jobs`          | Original PNG, JPEG or PDF body with its MIME type; returns a job id and 202 |
| `GET /v1/jobs/ID`        | `running`, `cancelling`, `ready`, `failed`, `timed_out` or `cancelled`      |
| `GET /v1/jobs/ID/result` | The parsed raw MusicXML after a successful exit; otherwise 409              |
| `DELETE /v1/jobs/ID`     | Cancel: stops the native process tree and drops any result                  |

`needsReview` is always true. An HTTP success means the job completed, not that the music is right. POST and DELETE require the header `X-Digitus2-Client: 1`. Every request needs the exact loopback Host and port and an allowed Origin, `https://marchalmaxim.github.io` by default, and CORS preflights are answered. A failed job carries a code, a message and bounded public details. Low staff resolution, for example, reports the measured interline. No log, local path or stack trace is sent over HTTP. Several exported scores or a known incomplete export is a failure: the worker never chooses one or publishes a partial result.

`client.mjs` exports `createLocalWorkerClient()` with `health`, `start`, `status`, `wait`, `result` and `cancel`, for research scripts. The app's client (`apps/web/src/scan/client.ts`) speaks the service's protocol `digitus2-scan-v2`, not this one. Call it only from a user action. Fetches send `targetAddressSpace: 'loopback'` and no credentials; in Chrome the governing permission is `loopback-network`, and denial is an ordinary connection failure. If the network drops after a POST, the job keeps running until it finishes, times out or is cancelled, so do not resubmit it blindly.

## Limits and boundaries

- One recognition at a time, four HTTP handlers, 10 MiB upload, 20 MiB uncompressed result, eight retained jobs, five minutes' retention after a job ends, and a 4 GiB Java heap. homr rejects images above 25 megapixels.
- Upload size, MIME type and magic bytes are checked before a job starts. Chunked, compressed and duplicate-length uploads are refused.
- Each job gets a generated directory with its own home, AppData, temp and native caches. Inherited JVM and OCR environment options are cleared, and commands are built from fixed paths, never from client input.
- Native logs and workspaces are capped at 8 and 128 MiB by periodic checks. These are not OS-enforced quotas and can overshoot between samples.
- The listener binds 127.0.0.1 only. The origin check covers every project path under `marchalmaxim.github.io`, and a local program can forge headers, so this is not authentication. Public or multi-user use would need authentication, TLS and isolation.
- Audiveris and homr are AGPL software fetched by the setup scripts; these wrappers do not relicense them.

## Tests

```powershell
python -m pytest research/omr/prototypes/local-worker -q
node --test research/omr/prototypes/local-worker/client.test.mjs
```

The Python tests cover the HTTP boundary, job lifecycle, real child-process cancellation and timeout, archive checks and native argument isolation. Tests with a simulated recogniser cover the protocol only, not accuracy. `browser-smoke.mjs` and `score-output.mjs` drive installed Chrome through a connection from the app to this worker, which the app does not have, so they are not used. The end-to-end check is `research/omr/service/smoke.mjs` against a running or deployed service, plus the Playwright scan specs against a mocked service (`docs/app.md`, Testing). `format-durable.mjs` formats this folder with Prettier, which the repository's formatter skips under `research/`.
