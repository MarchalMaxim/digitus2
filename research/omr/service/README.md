# Scan service

The hosted front of the app's scanning: one container with homr (photos) and Audiveris 5.11.0 (PDFs) behind `service.py`, a standard-library HTTP server that runs one recognition per request and keeps nothing afterwards. It runs on Google Cloud Run; the design is in [docs/superpowers/specs/2026-10-19-scan-service-design.md](../../../docs/superpowers/specs/2026-10-19-scan-service-design.md). The recognisers' adapters are the research worker's ([local-worker](../prototypes/local-worker/README.md)).

## Build

From the repository root, with Docker (Linux containers):

```sh
docker build -f research/omr/service/Dockerfile -t digitus2-scan research/omr
```

The build context is `research/omr`; `research/omr/.dockerignore` keeps results, photos and the oemer prototypes out. The image is Ubuntu 24.04 (pinned by digest) with its own Python 3.12, which installs the locked `homr-photo/requirements-cpu.txt` unchanged with `--only-binary=:all:`. Every download is checked against a pinned SHA-256 during the build, and nothing is fetched at run time:

| Artefact                                                         | Pin                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Base image `ubuntu:24.04`                                        | `sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac`                          |
| `Audiveris-5.11.0-ubuntu24.04-x86_64.deb` (installed with apt)  | `f20113aaa33b3149ec8d6a09b2a7963360e65fafd92d69389987a85bbc3ec7a3` (`audiveris.py` `DEB_SHA256`) |
| tessdata 4.1.0 `eng.traineddata`                                 | `daa0c97d651c19fba3b25e81317cd697e9908c8208090c94c3905381c23fc047`                                 |
| tessdata `LICENSE` (Apache-2.0)                                  | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`                                 |
| homr source archive at the pinned commit                         | `setup-homr.py` `ARCHIVE_SHA256`                                                                  |
| homr's three ONNX models                                         | `local-worker/homr.py` `MODELS`                                                                   |

`setup-homr.py --root DIR [--python PATH]` is the Linux twin of `homr-photo/setup.ps1`: it downloads and checks the archive, creates the virtual environment with `--copies` (the adapter refuses a symlinked interpreter), installs the locked requirements, writes `installed.txt`, verifies the pristine source, downloads the models with `homr.main --init`, checks their digests, writes `models.json` and applies the three patches with `homr-photo/prepare_patched.py`. The adapter repeats the source, dependency and model checks at start and before every photo. The Python wheels themselves come from PyPI by version, not by hash, because `requirements-cpu.txt` carries none; the apt packages come from the Ubuntu archive at build time.

Audiveris on a headless Linux needs two things its package does not declare: fontconfig with one font (Java's font manager fails without them) and `GDK_SCALE` set, because otherwise it probes the monitor scale through GTK and aborts when `libgtk-3` is missing. The package's post-install registers a desktop menu entry and a MIME type, so the image creates the empty system menu and MIME directories first. The adapter's class path is `/opt/audiveris/lib/app/*` only: with `lib/app` itself on it, the package's loose classes load first, and Audiveris then resolves its resources in the job directory and exports nothing.

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

`smoke.mjs URL [--photo PATH] [--pdf PATH]` posts a phone photo (default `research/omr/photos/boellmann-op28-page5-flat.jpeg`) and a corpus PDF (default the first PDF of the newest `research/omr/results/acceptance/fixtures-*/`, rendered by `node research/omr/prepare.mjs`; skipped with a note when there is none), prints the state, recogniser, seconds and MusicXML size per route, and exits 1 unless both answers are ready `score-partwise` documents. It refuses the app's placeholder URL `https://scan.digitus2.invalid`.

## Protocol `digitus2-scan-v2`

Every request needs exactly one allowed `Origin` (`https://marchalmaxim.github.io`, plus the `--dev-origin` loopback origins); POST and DELETE also need `X-Digitus2-Client: 1`.

| Request                                                                                                     | Answer                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/health`                                                                                            | 200 `{"protocol","recognizer","capabilities","warnings","maxUploadBytes"}`; loads no model                                                                                                                                                                   |
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

## When billing is disabled

The kill-switch unlinks the project from its billing account when the month's cost reaches the budget; the service then stops answering and the app says the scanner could not answer. Scanning stays off until the budget period resets on the first of the month, because the notifications repeat with the running total and would unlink a relinked project again. To recover, on the first of the month (or after raising the budget for the current month), link the project to the billing account again in the Cloud console (Billing, My projects). The service resumes by itself; if Google removed it meanwhile, run the deploy script again.
