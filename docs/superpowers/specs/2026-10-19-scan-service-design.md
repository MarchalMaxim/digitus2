# Scanning without a PC: a hosted recognition service

- Issue: https://github.com/MarchalMaxim/digitus2/issues/62 ("Scanning: find a way to not rely on a local machine running the service")
- Scope: where recognition runs and how the app reaches it. The recognisers (homr for photos, Audiveris for PDFs), the review, the corrections and My scores are unchanged. `docs/scanning.md` keeps describing the review; this document replaces its PC worker and phone hand-off sections.

## 1. The problem

Scanning runs on a Python worker that the reader has to install and start on their own Windows PC, bound to 127.0.0.1. A phone cannot reach it at all: it photographs pages and hands them to a PC. The owner's words: "It's not very acceptable to expect someone to run those scripts on their local machine, and basically this whole scanning thing doesn't work for mobile users." The owner is open to "a google cloud or azure instance for this, as long as we keep the costs heavily in control (also: no AWS)", rules out services where the reader signs up, and does not want recognition on the reader's device for privacy's sake: "I don't give a crap about privacy or on device mumbo-jumbo (and neither does the user)."

## 2. Decision

Recognition moves to a container that the project runs on Google Cloud Run: the same worker code, the same two recognisers, one recognition at a time, scaled to zero when idle, with a hard spend ceiling of 5 a month enforced by a budget that disables billing. The app sends the page to that service and waits for the MusicXML. Every device scans the same way, phones included. The PC worker leaves the app.

Routes weighed:

| Route                                                                                   | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud Run, request-based billing, scale to zero                                         | **Adopted.** The worker container runs unchanged; the free grant covers the expected use; the worst case is bounded by one instance and a billing kill-switch; no account for the reader.                                                                                                                                                                                                                                     |
| Azure Container Apps, consumption plan                                                  | Equivalent free grant and scale to zero; not chosen because the owner already has a Google Cloud account with a Cloud Run service, and Google documents the billing kill-switch pattern. The container is portable, so this stays a fallback.                                                                                                                                                                                 |
| On-device recognition in the browser (homr on ONNX Runtime Web with WebGPU)             | Not now. Never measured; homr's inference code is 45 Python files on OpenCV and numpy, a faithful port is weeks of work and must match the native output; phone speed and memory are unknown (the oemer browser run took 21 minutes single-threaded, and homr reuses that UNet); the AGPL code and models cannot ship inside the MIT app. The owner does not want it for its own sake. A spike remains possible later. |
| Phone paired with the reader's PC over the local network                                | Still needs the scripts on a PC. Rejected.                                                                                                                                                                                                                                                                                                                                                                                   |
| A desktop installer for the worker                                                      | Helps PC readers only. Rejected.                                                                                                                                                                                                                                                                                                                                                                                             |
| Vendor OMR APIs (Flat, Klangio, Newzik)                                                 | Sign-ups, per-page credits and the score on a vendor's servers. Rejected by the owner.                                                                                                                                                                                                                                                                                                                                       |
| Hugging Face Spaces, free CPU tier                                                      | Zero cost, but 2 vCPU, a 48-hour sleep with a minute-long wake-up, and a provider the owner did not name. Not chosen.                                                                                                                                                                                                                                                                                                        |
| A 10-second keep-warm ping                                                              | Not cheating, but a bad deal: each ping bills at least 100 ms of the whole instance, about 104,000 of the 180,000 free vCPU-seconds a month, and Cloud Run may recycle the instance anyway. Replaced by one warm-up request when the reader opens the scan page (section 4.5).                                                                                                                                              |

## 3. What the reader sees

One control, everywhere. The scan page shows the pages, the advice line and one primary button, **Scan this score**. There is no connection step, no setup section, no "Send photos to your PC", and no difference between a phone and a PC except the camera button the phone already has. The line under the advice says where the page goes, in one sentence: "Recognition runs on the project's scanner on Google Cloud (Netherlands). Your page is sent there, recognized and then deleted." The button press is the explicit act the honesty rule asks for; there is no separate consent dialog.

States and copy (English source; the four other languages follow):

| State                       | What is shown                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ready                       | **Scan this score** (primary). For a batch with failed pages, **Retry failed pages**.                                                                                               |
| Scanning                    | The loader (the screen's red), **Cancel scan**, and the status "Recognizing… Usually under a minute. The first scan after a quiet spell takes longer while the scanner starts." For a batch, "Page 2 of 5 · …". |
| Cancelling                  | **Cancelling…** disabled, until the service confirms.                                                                                                                                |
| Busy                        | "The scanner is busy with another score. Try again in a minute." The button stays enabled.                                                                                          |
| No connection               | "Could not reach the scanner. Check your connection and try again."                                                                                                                 |
| Service error               | "The scanner could not answer (error 503). Try again later."                                                                                                                        |
| Timed out                   | The existing "Recognition timed out. Try a smaller, clearer page."                                                                                                                  |
| Recognition failed          | The service's public message (low staff resolution with the measured interline, several scores, incomplete export), or the existing "could not recognize a complete score" text.    |
| Review                      | Unchanged.                                                                                                                                                                          |

Removed from the app: **Connect to this PC**, **Connecting…**, "PC connected.", "Scanning needs the PC worker running on this computer.", the "Set up the PC worker" disclosure with its commands, **Send photos to your PC**, **Save photos** and their explanations, the hand-off file naming, and the local-network permission error. The camera capture (**Take a photo**, **Take another photo**), the touch page tools and the photo naming by time stay. A reader offline is told so and keeps the pages; nothing else changes.

The text model warning ("English text recognition is not configured…") stays wired to the health answer but never shows for the deployed service, which always ships the English model.

## 4. The service

### 4.1 What runs

One container holds everything a recognition needs, with no download at run time:

- Python with homr at the pinned commit, patched with the three existing patches, its three ONNX models (SHA-256 pinned) and the locked CPU dependencies of `research/omr/prototypes/homr-photo/requirements-cpu.txt`, in a virtual environment.
- Audiveris 5.11.0 from the project's Ubuntu 24.04 package (SHA-256 pinned). The package bundles its Java runtime and the Tesseract and Leptonica natives as JavaCPP jars, so no system Tesseract is installed. Its layout is `/opt/audiveris/lib/runtime/bin/java` and `/opt/audiveris/lib/app/` (jars plus the application's classes; `Audiveris.cfg` there names the main class and class path).
- The pinned English text model, `eng.traineddata`, with the SHA-256 the Windows setup already checks.
- The worker code: `research/omr/prototypes/local-worker/` (the job runner, the two adapters, export normalisation, error mapping) imported by a new HTTP front, `research/omr/service/service.py`.

The two adapters become Linux-capable: the homr adapter finds the virtual environment's interpreter under `bin/` on POSIX and `Scripts/` on Windows; the Audiveris adapter accepts a Linux layout (java, class path from the package) next to the Windows portable layout, and keeps the per-job home, temp, config and cache isolation (`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` on Linux instead of `APPDATA` and `LOCALAPPDATA`). The Windows worker keeps working unchanged for research.

### 4.2 Protocol: `digitus2-scan-v2`

Cloud Run bills CPU only while a request is in flight, and throttles it between requests, so the recognition happens inside one request. The job and poll endpoints of v1 are not used by the app any more.

| Request                                                                                                              | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/health`                                                                                                     | 200, `{"protocol":"digitus2-scan-v2","recognizer":…,"capabilities":…,"warnings":…,"maxUploadBytes":10485760}`. Static; loads no model.                                                                                                                                                                                                                                                                                              |
| `POST /v1/recognize`, headers `Content-Type` (`image/png`, `image/jpeg`, `application/pdf`), `X-Digitus2-Client: 1`, `X-Digitus2-Job: <32 hex chosen by the client>`, body the original bytes | 200, `{"state":"ready","recognizer":…,"capabilities":…,"warnings":[…],"xml":"<score-partwise…"}` after recognition. 422 `{"state":"failed","failure":{"code","message","details"}}` for a recognition failure. 504 `{"state":"timed_out","failure":…}` after 180 s. 409 `{"state":"cancelled"}` when the job was cancelled. 429 `{"error":"busy"}` with `Retry-After` while another recognition runs or the caller is over its limit. 411, 413, 415, 403 and 400 as the worker answers today. |
| `DELETE /v1/jobs/<id>`, header `X-Digitus2-Client: 1`                                                                | 200 `{"id","state":"cancelling"}`: the native process tree is killed and the pending POST answers 409. 404 for an unknown or finished id.                                                                                                                                                                                                                                                                                             |
| `OPTIONS`                                                                                                            | The CORS preflight for the allowed origins, methods GET, POST, DELETE, headers `Content-Type`, `X-Digitus2-Client`, `X-Digitus2-Job`.                                                                                                                                                                                                                                                                                                 |

The client chooses the job id so that a cancel can name a job whose response has not arrived. A duplicate id is refused with 409. The result JSON is at most the 20 MiB result limit plus escaping, under Cloud Run's 32 MiB response limit; the 10 MiB upload limit is under its 32 MiB request limit.

### 4.3 Boundaries

- Every request needs exactly one `Origin` from the allowlist: `https://marchalmaxim.github.io` and the loopback development origins passed at start (`--dev-origin`, as today). POST and DELETE need `X-Digitus2-Client: 1`. These stop casual scripts; they are not authentication, and no secret ships in the static bundle (`docs/research/omr.md`, Online services).
- One recognition at a time per instance; a second POST gets 429 `{"error":"busy"}` at once. The per-caller limit is 30 recognitions per rolling hour, answered with 429 `{"error":"rate-limited"}` and `Retry-After`, keyed by the last address in `X-Forwarded-For`, which is the one Google's front end appends (a client can forge the earlier ones), or the socket address without the header; kept in memory, so it resets with the instance. The app words the two answers differently.
- Upload size, MIME type and magic bytes are checked before the job starts, as today; the recognition timeout is 180 s; logs and workspaces keep their caps. Network isolation is as today: the homr child process runs with Python's socket functions disabled by the adapter's bootstrap, and the Audiveris JVM is not restricted. No network-level isolation is built.
- Each job gets its own temporary directory, deleted as soon as the response is built. Nothing is retained: no job list, no result in memory, no copy of the page. The service writes one JSON line per job to standard output (kind, bytes in and out, seconds, outcome code) and nothing else about the request: no content, no file name, no address.
- The service listens on `0.0.0.0` and the `PORT` Cloud Run gives it; it answers at least four requests at once so that health, cancel and busy answers get through while a recognition runs.

### 4.4 Cloud Run configuration

| Setting                | Value                                   | Why                                                                                                                                           |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Billing                | request-based (the default)             | CPU and memory are billed only while a request is being handled                                                                               |
| CPU, memory            | 4 vCPU, 8 GiB                           | homr's segmentation uses the cores; Audiveris keeps its 4 GiB heap; memory is cheap next to CPU                                                |
| Concurrency            | 4                                       | one recognition at a time inside the service; health, cancel and busy answers still get through                                               |
| Minimum instances      | 0                                       | scale to zero: no idle charge                                                                                                                 |
| Maximum instances      | 1                                       | bounds the worst case to one busy instance                                                                                                    |
| Request timeout        | 240 s                                   | above the 180 s recognition timeout                                                                                                           |
| Startup CPU boost      | on                                      | a shorter cold start                                                                                                                          |
| Execution environment  | second generation                       | full Linux for the JVM and the native libraries (the builder may keep the first generation if it works and starts faster)                      |
| Ingress, authentication | all, unauthenticated                   | the app is a public static site                                                                                                               |
| Region                 | `europe-west4` (Netherlands)            | Tier 1 price; the owner's other service is there                                                                                              |
| Service name           | `digitus2-scan`                         |                                                                                                                                               |

### 4.5 Warm-up and cold starts

When the scan page opens with pages that have no recognition yet, the app sends one `GET /v1/health` at once and forgets the answer except for the capabilities. That starts an instance while the reader arranges pages, so **Scan this score** usually finds it running. One request per visit to the scan page, never on the library. There is no periodic ping and no paid minimum instance.

### 4.6 Cancellation

**Cancel scan** aborts the pending POST and sends the DELETE. The service kills the native process and the instance is free again within a second. If the DELETE is lost, the recognition runs on until it finishes or times out (at most 180 s) and the next POST gets 429 meanwhile; the app's busy message covers that.

## 5. Spend control

Prices as published for Tier 1 regions ([Cloud Run pricing](https://cloud.google.com/run/pricing)):

| Item                                                      | Figure                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| Free each month                                           | 180,000 vCPU-seconds, 360,000 GiB-seconds, 2 million requests              |
| Beyond the free grant                                     | $0.000024 per vCPU-second, $0.0000025 per GiB-second, $0.40 per million requests |
| One second of the service, 4 vCPU and 8 GiB               | $0.000116                                                                  |
| Free recognition time a month                             | 45,000 s: about 1,500 pages of 30 s, or 750 pages of 60 s                   |
| What 5 buys beyond the free grant                         | about 43,000 s more, about 1,400 pages of 30 s                              |
| Worst case, one instance busy around the clock            | about $10 a day                                                            |
| A warm-up request                                         | at least 100 ms of the instance, about $0.00001                            |

The free grant is counted per billing account, not per project ([Cloud Run pricing](https://cloud.google.com/run/pricing)): the table assumes a billing account with no other usage. On an account shared with another service, that service's usage eats into the same 180,000 vCPU-seconds.

Three things bound the spend:

1. **One instance, request-based.** Nothing runs between requests, and at most one instance exists.
2. **A dedicated project.** The service lives in its own Google Cloud project, created for it, because the kill-switch below disables billing for a whole project and shuts down everything in it. The owner's other Cloud Run service stays in its own project. The function's code unlinks only the project it runs in; the role Google's guide grants it (Billing Account Administrator on the billing account) is broader than that, so a billing account of the service's own isolates both the free grant and the kill-switch completely. Which account is the owner's choice (section 11).
3. **The billing kill-switch.** A budget of 5 (in the billing account's currency) on that project, with e-mail alerts at 50, 90 and 100 percent and programmatic notifications to a Pub/Sub topic. A small Cloud Run function subscribed to the topic disables billing for the project when the notified cost reaches the budget, following Google's own guide ([Disable billing usage with notifications](https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications)). It is deployed in simulation mode, tested with a published notification, then switched to act. Billing notifications lag by hours, so the real ceiling is 5 plus whatever a busy instance costs during the lag: at the $10-a-day worst case, a six-hour lag is about $2.50.

When the kill-switch fires, the service stops answering and the app shows "The scanner could not answer". Scanning then stays off until the budget period resets on the first of the month: the notifications repeat several times a day with the month's running total, so a project relinked while the total is still above the budget is unlinked again within hours. Recovery is manual, in this order: on the first of the month, or after raising the budget for the current month, the owner links the project to the billing account again in the console; the service resumes by itself, and the deploy script restores it should Google have removed it in the meantime (the guide warns that resources of a project without billing may be deleted). Nothing is built to resume automatically.

## 6. Repository layout

| Path                                                   | Content                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `research/omr/service/service.py`                      | The HTTP front of section 4.2, standard library only, reusing the worker's job runner and adapters                                                                                                                                                                       |
| `research/omr/service/test_service.py`                 | Tests with a simulated recogniser: protocol, limits, busy, per-caller limit, cancel, origin and header checks, JSON shapes, no retention                                                                                                                                 |
| `research/omr/service/Dockerfile`                      | Ubuntu 24.04; the pinned homr, models, Audiveris package and text model fetched at build time with SHA-256 checks; the worker code copied in; no network at run time                                                                                                      |
| `research/omr/service/setup-homr.py`                   | The Linux equivalent of `homr-photo/setup.ps1`: fetch the pinned source and models, apply the patches with the existing Python helpers, write `installed.txt`, so the adapter's manifest checks pass unchanged                                                            |
| `research/omr/service/deploy.ps1`                      | The `gcloud run deploy --source` command with section 4.4's settings, for the owner's machine (gcloud is installed and signed in there)                                                                                                                                   |
| `research/omr/service/budget/`                         | The kill-switch: the function (Python, after Google's sample), its requirements, and `budget.ps1` with the gcloud commands that create the topic, deploy the function, grant it the billing role and create the budget                                                      |
| `research/omr/service/smoke.mjs`                       | Posts one corpus page and one corpus PDF to a service URL and checks the answers parse: the check after a deploy                                                                                                                                                          |
| `research/omr/acceptance.mjs --service URL`            | The acceptance gate's new mode: the same corpus, recognised through a running container, scored with the same scorer against `research/omr/acceptance/floor.json` (section 7)                                                                                            |
| `research/omr/service/README.md`                       | Build, run locally, deploy, budget, recovery                                                                                                                                                                                                                              |
| `apps/web/src/scan/service.ts`                         | The service origin: `VITE_SCAN_SERVICE` when set (development, e2e), else the deployed URL                                                                                                                                                                               |
| `apps/web/src/scan/client.ts`                          | The v2 client: health, recognize with an abort signal and a 200 s ceiling, cancel; errors mapped to the phrases of section 3                                                                                                                                              |
| `apps/web/src/scan/ScanView.tsx`                       | Phases `ready`, `scanning`, `cancelling`, `review`; the warm-up; the phone branch removed                                                                                                                                                                                 |
| `apps/web/src/scan/phone.ts`                           | Keeps `isTouchOnly` and `namedCapture`; the hand-off functions go                                                                                                                                                                                                        |
| `apps/web/src/i18n/*/scan.ts`                          | The copy of section 3 in the five languages; the removed strings go from all five                                                                                                                                                                                        |
| `apps/web/e2e/helpers/scan.ts`, the scan specs          | Mock the service origin instead of `127.0.0.1:8996`; the phone spec scans directly; one spec covers busy, offline and cancel                                                                                                                                              |

The Windows worker (`worker.py`, its tests, `client.mjs`) stays as the research loopback server for the acceptance harness and the adapters' tests. `browser-smoke.mjs` is retired: its job is now `smoke.mjs` against the service plus the e2e specs.

The deployed URL follows Cloud Run's fixed form, `https://digitus2-scan-<project number>.europe-west4.run.app`, known once the project exists. Until then `service.ts` holds a placeholder that the smoke script refuses, and every test mocks the origin. GitHub Pages deploys every push to `main`, so the app change ships in one pull request opened only after the service is deployed and the real URL is in `service.ts`; a merge with the placeholder would leave scanning broken for everyone.

## 7. Verification

- `pnpm verify` is the definition of done. `pnpm verify` runs no Python test today (the `omr` step runs the Node harness tests, and CI has no Python), so a new `omr:service` step runs `pytest` over `research/omr/service` and `research/omr/prototypes/local-worker`, reporting SKIP where Python or pytest is missing; the e2e specs run at desktop and phone widths; the colour guard, bundle budget and the rest are unchanged.
- **Equivalence.** The Linux build must recognise as well as the Windows one. `acceptance.mjs --service URL` renders the 16 corpus pieces with `prepare.mjs`, sends each PDF and each photo variant through the running container, scores them with the same scorer, and compares with `floor.json` like the gate. Its table goes into `docs/research/omr.md` beside the Windows numbers. The floors are tight (an F1 minus 0.5, exact error counts, some of them zero), and a different build of the same pinned libraries can move a count by one. A route under its floor is investigated first (the recognition timeout is 180 s in the service against 300 s in the harness; the corpus pages take about 10 s each on this PC, so that is not the cause). A gap of at most one count per error class or 0.5 F1 points, explained in `docs/research/omr.md`, does not block the deploy; a larger gap goes to the owner before anything is deployed.
- **Timings to record** (in `docs/scan-service.md`): per-page time for a corpus PDF and a corpus photo in the container at 4 vCPU on the owner's PC; after the deploy, the cold start (health from a cold service) and the same two pages against the deployed service.
- **Kill-switch test.** A published notification with a cost above the budget, in simulation mode, logs the decision; only then is simulation switched off.
- **Smoke after deploy.** `smoke.mjs` against the deployed URL, then a real scan from the deployed app on the owner's phone (the owner's device check, as for the PWA).

## 8. Documents to update

- `docs/scanning.md`: "Nothing leaves your computer" becomes "Where your page goes" (the sentence of section 3, plus: processed in memory, deleted when the job ends, one page at a time, the scanner can be busy or asleep). "Scan a score" loses the Connect step. "On a phone or tablet" says phones scan like PCs. "Set up the PC worker" and "Connection problems" move out; the PC worker's own README keeps the research setup. "Licences" notes that the service runs AGPL software on the project's server with its source public in this repository.
- `docs/scan-service.md` (new): what runs where, the protocol, the Cloud Run settings, deploy, the budget and kill-switch, recovery, the cost table with its sources, the recorded timings, limits.
- `docs/research/omr.md`: the decision bullets (recognition runs on a Cloud Run service; the loopback worker is a research tool), the routes weighed in section 2 with the measured and quoted numbers, and the equivalence table.
- `docs/PROGRESS.md`: the Scanning decisions, the M10 and M13 rows, "Where things are" (service, budget), "What is next".
- `docs/app.md`: the scan page's controls.
- `CLAUDE.md` and `docs/superpowers/specs/2026-10-13-digitus2-design.md`: the stack line ("engine runs in the browser with no server") gains the one exception, the scan recognition service; GitHub Pages stays the only deployment of the app.
- `docs/verification-loop.md`: the `omr:service` step.
- `docs/TODO.md`: one line for #62 when it closes.

## 9. Goals, non-goals, anti-goals

Goals: a reader on any device photographs or opens a score and presses one button; no install, no account, no PC; the owner's spend is capped at 5 a month and the reader is told where the page goes.

Non-goals: recognition on the reader's device; a queue or several instances; accounts, quotas per reader beyond the hourly limit, or paid tiers; better recognition (#39 stays open); a custom domain; continuous deployment of the service from CI (the owner deploys with one command; CI deploy is a possible follow-up).

Anti-goals: a shared secret in the static bundle; retaining pages or results on the server; a keep-warm pinger; a minimum instance; the kill-switch in a project that holds anything else; a second visible control on the scan page.

## 10. Left to the builder

- Python 3.12 from Ubuntu 24.04 or a managed 3.11: whichever installs the locked `requirements-cpu.txt` unchanged and passes the adapter's manifest and model checks. The patched source digests must match `source-manifests.json` on Linux (line endings are the known trap).
- The Audiveris class path on Linux, read from `Audiveris.cfg`, and whether `--enable-native-access` and the `sun.awt.image` export are still needed there.
- First or second generation execution environment, by measurement.
- The exact wording in Spanish, French, Dutch and Portuguese.
- The in-memory limiter's structure and the busy `Retry-After` value.
- The deploy script's Artifact Registry clean-up (keep the last two images) and the Cloud Build source bucket.
- Whether the e2e specs mock a fixed fake origin (`https://scan.example`) through `VITE_SCAN_SERVICE` or the deployed URL; a fixed fake origin is the default.

## 11. For the owner

- The billing account. gcloud on the owner's machine is signed in as the owner and lists two open billing accounts; the project is new either way. A billing account of the service's own, which only the owner can open in the console, keeps the free grant and the kill-switch's role away from everything else; an existing account shares the free grant with whatever else it bills, and the kill-switch function holds a broad role on it while its code unlinks only its own project. The controlling agent runs the project creation, the deploy and the budget commands with that signed-in gcloud once the account is named.
- The region default is `europe-west4`; say so if another is wanted.
- The PC worker leaves the app. That is this document's call under the one-control rule; the worker stays for research.
- Settled by this document: scanning stays off for the rest of the month once the cap is hit (section 5); network isolation is as today (section 4.3); a floor miss of the Linux build within one count or 0.5 F1 is explained, not escalated (section 7).

## Sources

- Cloud Run pricing: https://cloud.google.com/run/pricing
- Cloud Run billing settings and idle instances: https://docs.cloud.google.com/run/docs/configuring/cpu-allocation
- Cloud Run limits: https://docs.cloud.google.com/run/quotas
- Disable billing usage with notifications: https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications
- Azure Container Apps pricing: https://azure.microsoft.com/en-us/pricing/details/container-apps/
- Audiveris 5.11.0 release: https://github.com/Audiveris/audiveris/releases/tag/5.11.0
- homr: https://github.com/liebharc/homr
- WebGPU in major browsers: https://web.dev/blog/webgpu-supported-major-browsers
