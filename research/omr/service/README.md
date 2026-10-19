# Scan service

The hosted front of the app's scanning: one container with homr (photos) and Audiveris 5.11.0 (PDFs) behind `service.py`, a standard-library HTTP server that runs one recognition per request and keeps nothing afterwards. It runs on Google Cloud Run; the design is in [docs/superpowers/specs/2026-10-19-scan-service-design.md](../../../docs/superpowers/specs/2026-10-19-scan-service-design.md). The recognisers' adapters are the research worker's ([local-worker](../prototypes/local-worker/README.md)).

## Build

From the repository root, with Docker (Linux containers):

```sh
docker build -f research/omr/service/Dockerfile -t digitus2-scan research/omr
```

The build context is `research/omr`; `research/omr/.dockerignore` keeps results, photos and the oemer prototypes out. The image is Ubuntu 24.04 (pinned by digest) with its own Python 3.12, which installs the locked `homr-photo/requirements-cpu.txt` unchanged with `--only-binary=:all:`. Nothing is fetched at run time. The base image is pinned by its digest, and the build checks these downloads against a pinned SHA-256; the Python wheels are pinned by version only and the apt packages not at all (below):

| Artefact                                                         | Pin                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Base image `ubuntu:24.04`                                        | `sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac`                          |
| `Audiveris-5.11.0-ubuntu24.04-x86_64.deb` (installed with apt)  | `f20113aaa33b3149ec8d6a09b2a7963360e65fafd92d69389987a85bbc3ec7a3` (`audiveris.py` `DEB_SHA256`) |
| tessdata 4.1.0 `eng.traineddata`                                 | `daa0c97d651c19fba3b25e81317cd697e9908c8208090c94c3905381c23fc047`                                 |
| tessdata `LICENSE` (Apache-2.0)                                  | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`                                 |
| homr source archive at the pinned commit                         | `setup-homr.py` `ARCHIVE_SHA256`                                                                  |
| homr's three ONNX models                                         | `local-worker/homr.py` `MODELS`                                                                   |

`setup-homr.py --root DIR [--python PATH]` is the Linux twin of `homr-photo/setup.ps1`: it downloads and checks the archive, creates the virtual environment with `--copies` (the adapter refuses a symlinked interpreter), installs the locked requirements, writes `installed.txt`, verifies the pristine source, downloads the models with `homr.main --init`, checks their digests, writes `models.json` and applies the four patches with `homr-photo/prepare_patched.py`. The adapter repeats the source, dependency and model checks at start and before every photo. The Python wheels themselves come from PyPI by version, not by hash, because `requirements-cpu.txt` carries none; the apt packages come from the Ubuntu archive at build time.

Audiveris on a headless Linux needs two things its package does not declare: fontconfig with one font (Java's font manager fails without them) and `GDK_SCALE` set, because otherwise it probes the monitor scale through GTK and aborts when `libgtk-3` is missing. The package's post-install registers a desktop menu entry and a MIME type, so the image creates the empty system menu and MIME directories first. The adapter's class path is `/opt/audiveris/lib/app/*` only: with `lib/app` itself on it, the package's loose classes load first, and Audiveris then resolves its resources in the job directory and exports nothing.

The build records a JDK ahead-of-time class cache for Audiveris, `/opt/audiveris/audiveris.aot` (65 MB), with `train-aot.py`: one recognition of `aot-training.pdf` (the library's Amazing Grace, CC0, as the acceptance corpus renders it) through the adapter with `-XX:AOTCacheOutput`, then a second run with `-XX:AOTMode=on`, which exits when the cache is unusable, and must give the same MusicXML; otherwise the build fails. The adapter adds `-XX:AOTCache` when the file exists and runs without it otherwise, as on Windows. It saves about 1.4 s a PDF in the container (Audiveris alone, 7.8 to 6.4 s).

## Run locally

```sh
docker run --rm -d --name scan --cpus 4 --memory 8g -p 8996:8080 digitus2-scan
curl -s -H "Origin: https://marchalmaxim.github.io" http://127.0.0.1:8996/v1/health
node research/omr/service/smoke.mjs http://127.0.0.1:8996
docker stop scan
```

The entry point carries the fixed arguments (`--bundle /opt/audiveris --short-staves --text-models /opt/text-models --homr-toolchain /opt/homr`); anything after the image name is appended, so a development app on Vite's port is allowed with:

```sh
docker run --rm -d --name scan --cpus 4 --memory 8g -p 8996:8080 digitus2-scan --dev-origin http://localhost:5173
```

The service listens on `PORT` (8080), runs as an unprivileged user and writes one JSON line per job to standard output. `--cpus 4 --memory 8g` is the Cloud Run size.

Inside a container ONNX Runtime sizes its thread pool from the host's physical cores, not the container's CPU quota, and oversubscribes it: the dense Schumann corpus page took 83 s at `--cpus 4` instead of 22 s. The service therefore gives homr a thread budget (`thread_budget.py` beside the adapters): `--threads N`, else the `DIGITUS2_OMR_THREADS` environment variable, else the container's CPU quota from the cgroup (`cpu.max`, or `cpu.cfs_quota_us` over `cpu.cfs_period_us`), else the CPU affinity when it is smaller than the machine. Cloud Run exposes neither its allotment (a 4 vCPU service detected 9), so `deploy.ps1` sets `DIGITUS2_OMR_THREADS=4` on the service. It sets `DIGITUS2_OMR_THREADS` for homr's child Python, which then creates ONNX Runtime sessions with that many intra-op threads and one inter-op thread and sets OpenCV's thread count to match; health reports the budget as `threads`. Without a budget (Windows, the research harness) nothing changes. The Audiveris JVM keeps `-XX:ActiveProcessorCount=4`.

`smoke.mjs URL [--photo PATH] [--pdf PATH]` posts a phone photo (default `research/omr/photos/boellmann-op28-page5-flat.jpeg`) and a corpus PDF (default the first PDF of the newest `research/omr/results/acceptance/fixtures-*/`, rendered by `node research/omr/prepare.mjs`; skipped with a note when there is none), prints the state, recogniser, seconds and MusicXML size per route, and exits 1 unless both answers are ready `score-partwise` documents. It refuses the app's placeholder URL `https://scan.digitus2.invalid`.

## Protocol `digitus2-scan-v2`

Every request needs exactly one allowed `Origin` (`https://marchalmaxim.github.io`, plus the `--dev-origin` loopback origins); POST and DELETE also need `X-Digitus2-Client: 1`.

| Request                                                                                                     | Answer                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/health`                                                                                            | 200 `{"protocol","recognizer","capabilities","warnings","maxUploadBytes","threads"}`; loads no model                                                                                                                                                         |
| `POST /v1/recognize` with `Content-Type` `image/png`, `image/jpeg` or `application/pdf`, `X-Digitus2-Job: <32 hex>`, the original bytes | 200 `{"state":"ready",…,"xml"}`; 422 `failed` with `failure`; 504 `timed_out` after 180 s; 409 `cancelled` or a duplicate job id; 429 `{"error":"busy"}` while another recognition runs or `{"error":"rate-limited"}` over 30 per caller per hour, with `Retry-After`; 400, 403, 411, 413, 415 for bad requests |
| `DELETE /v1/jobs/<id>`                                                                                      | 200 `{"id","state":"cancelling"}`: the recognition is killed and its POST answers 409; 404 for an unknown or finished id                                                                                                                                      |
| `OPTIONS`                                                                                                   | The CORS preflight for the allowed origins                                                                                                                                                                                                                   |

## Deploy and budget

From the owner's machine, with gcloud signed in:

```powershell
powershell -File research/omr/service/deploy.ps1 -Project ID
powershell -File research/omr/service/budget/budget.ps1 -Project ID -BillingAccount ID
```

`deploy.ps1` builds this image, pushes it to Artifact Registry, deploys it to Cloud Run with the service's settings and runs `smoke.mjs` against the new URL. `budget.ps1` creates the 5-a-month budget and the kill-switch function that disables billing for the project when the budget is reached.

Both scripts stop at the first failing command and are safe to run again: they create the repository, topic, service account and budget only when missing.

### Deploy

`deploy.ps1 -Project ID [-Region europe-west4] [-Service digitus2-scan] [-Repository digitus2]` enables the Cloud Run and Artifact Registry APIs, creates the Docker repository `<region>-docker.pkg.dev/<project>/<repository>` when missing and gives it a cleanup policy that keeps the 2 most recent versions of the image and deletes older ones (Artifact Registry applies it about once a day). It tags the image with the short git commit, with `-dirty` added when `research/omr` has uncommitted changes, and deploys it with these settings:

| Setting               | Value                                                        |
| --------------------- | ------------------------------------------------------------ |
| CPU, memory           | 4, 8 GiB, as in [Run locally](#run-locally)                  |
| Requests per instance | 4 (`--concurrency`); the service itself runs one recognition |
| Instances             | 0 to 1: no instance runs, and none is billed, while idle     |
| Request timeout       | 240 s, above the service's 180 s recognition limit           |
| Start-up CPU boost    | on                                                           |
| Execution environment | gen2                                                         |
| Access                | public (`--allow-unauthenticated`, ingress all), port 8080   |

It then prints the service URL and runs `smoke.mjs` against it, passing the first PDF under `research/omr/results/acceptance/fixtures-v1/` with `--pdf`; without one it says the PDF route was not smoked.

### Budget and kill-switch

`budget/budget.ps1 -Project ID -BillingAccount ID [-Amount 5] [-Topic digitus2-scan-budget] [-Simulate true]` follows Google's [Disable billing usage with notifications](https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications):

| Piece    | What it is                                                                                                                                                                                                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Budget   | `digitus2-scan` on the billing account, 10 a month in the account's currency, for this project only; notifications at 50 %, 90 % and 100 % go to the Pub/Sub topic                                                                                                                                                                 |
| Topic    | `digitus2-scan-budget`; the budget publishes the month's running cost to it several times a day                                                                                                                                                                                                                                   |
| Function | `stop-billing` (Cloud Run functions, Python 3.12, europe-west4), source `budget/main.py`, triggered by the topic                                                                                                                                                                                                                  |
| Identity | Its own service account `stop-billing@<project>.iam.gserviceaccount.com`: Billing Account Administrator on the billing account (as Google's guide grants); on the project, Browser (to read the billing state), Project Billing Manager (to unlink; without an organization the account role does not reach the project) and log writer. The scan service runs as `digitus2-scan-run@<project>.iam.gserviceaccount.com`, an account with no role at all; the Compute Engine default account, which holds Editor on a project without an organization, is not used |

`main.py` is Google's Python sample with three changes: it acts when the cost reaches the budget, not only above it; simulation comes from the `SIMULATE` environment variable (on unless it is `false`); and in simulation a billing state it cannot read is logged at ERROR as a failed test, because a live run needs the same rights (live, it then assumes billing is on and unlinks, as the sample does). For each notification it decodes `costAmount` and `budgetAmount`; under the budget it does nothing; otherwise it reads the project's billing state and, when billing is on, unlinks the billing account (`update_project_billing_info` with an empty `billing_account_name`) or, in simulation, only logs that it would. A refused unlink is logged, not raised. Its tests stub the Google client modules:

```sh
python -m pytest research/omr/service/budget -q
```

### Simulation test

The function starts in simulation. After `budget.ps1`, publish a notification over the budget; the script prints these commands with the project filled in. The quoting depends on the shell, because gcloud runs as `gcloud.ps1` in PowerShell and hands the arguments to Python: Windows PowerShell 5.1 (and PowerShell 7.0 to 7.2) strips plain double quotes, so they need backslashes; PowerShell 7.3 and later passes them intact and would keep the backslashes; Git Bash passes them intact.

| Shell                                     | Publish command                                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Windows PowerShell 5.1, PowerShell 7.0–7.2 | `gcloud pubsub topics publish digitus2-scan-budget --project ID --message '{\"costAmount\": 6, \"budgetAmount\": 5}'` |
| PowerShell 7.3 and later, Git Bash        | `gcloud pubsub topics publish digitus2-scan-budget --project ID --message '{"costAmount": 6, "budgetAmount": 5}'`     |

Then read the log:

```sh
gcloud functions logs read stop-billing --gen2 --region europe-west4 --project ID --limit 20
```

The test passes when the log shows `Cost: 6.0 Budget: 5.0`, `Getting billing info for projects/ID...` and `Billing disabled for projects/ID. (simulation: nothing was changed)`, with no ERROR line; billing stays linked. `simulation test failed` at ERROR means the function's account cannot read the project's billing state, and a live run would lack the same rights: check its roles on the project before switching simulation off. A `json` error means the quoting did not fit the shell. The console shows the same log under Cloud Run functions, `stop-billing`, Logs.

### Switching simulation off

Once the simulation test passes, redeploy the function live:

```powershell
powershell -File research/omr/service/budget/budget.ps1 -Project ID -BillingAccount ID -Simulate false
```

Under `-File` the switch is text, so `-Simulate false` and `-Simulate $false` both work. From then on a notification at or over the budget unlinks billing. Do not publish the test message again while the function is live: it would unlink billing for the project.

## When billing is disabled

The kill-switch unlinks the project from its billing account when the month's cost reaches the budget; the service then stops answering and the app says the scanner could not answer. Scanning stays off until the budget period resets on the first of the month, because the notifications repeat with the running total and would unlink a relinked project again. To recover, on the first of the month (or after raising the budget for the current month), link the project to the billing account again in the Cloud console (Billing, My projects). The service resumes by itself; if Google removed it meanwhile, run the deploy script again.

Unlinked billing can also shut down or delete the kill-switch function, which lives in the same project, and a relinked project without it has no spend ceiling. After relinking, check it:

```powershell
gcloud functions describe stop-billing --region europe-west4 --project ID --format "value(serviceConfig.environmentVariables)"
```

If the function is missing or `SIMULATE` is not `false`, run `budget.ps1 -Simulate false` again. To raise the ceiling for the current month, change the amount of the `digitus2-scan` budget in the console (Billing, Budgets & alerts) first and link billing afterwards; `budget.ps1 -Amount` updates the same budget, but it also redeploys the function, which needs billing linked, so it suits a project that is still linked.
