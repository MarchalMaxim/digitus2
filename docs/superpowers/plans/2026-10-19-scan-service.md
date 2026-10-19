# Scan Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognition moves from the reader's PC to a container the project runs on Google Cloud Run, and the scan page becomes one button on every device.

**Architecture:** The existing worker code (job runner, homr and Audiveris adapters) gets a Linux-capable layout and a new synchronous HTTP front, `service.py`, packaged in a Docker image with the pinned recognisers. The web app replaces its loopback client with a v2 client that posts one page per request to the service origin, warms the service up when the scan page opens, and drops the Connect, setup and phone hand-off paths. Deploy and budget scripts bring the service up on Cloud Run with a billing kill-switch at 5 a month.

**Tech Stack:** Python 3.11+ standard library (service, adapters), pytest; Docker on Ubuntu 24.04; gcloud; TypeScript, React 19, Vite 8, vitest, Playwright (app); Node (acceptance harness).

**Spec:** `docs/superpowers/specs/2026-10-19-scan-service-design.md`

## Global Constraints

- Python only under `research/`; the product stays TypeScript. The service and its scripts live in `research/omr/service/`.
- UI: black and white, one red element on screen at a time, no second visible control on the scan page. The Connect step, the setup section and the phone hand-off are removed, not hidden.
- Copy: English is the source in `apps/web/src/i18n/en/scan.ts`; `es`, `fr`, `nl`, `pt` carry the same keys (the `Messages` type fails the typecheck otherwise).
- Protocol name `digitus2-scan-v2`; origin allowlist `https://marchalmaxim.github.io` plus `--dev-origin` loopback origins; POST and DELETE need `X-Digitus2-Client: 1`; the job id is 32 lowercase hex chosen by the client in `X-Digitus2-Job`.
- Limits: 10 MiB upload, 20 MiB result, 180 s recognition timeout (the client waits 200 s), 30 recognitions per caller per rolling hour keyed by the last `X-Forwarded-For` address (the one Google appends), one recognition at a time per instance. A busy instance answers 429 `{"error":"busy"}`; the hourly limit answers 429 `{"error":"rate-limited"}` with `Retry-After`.
- Network isolation stays as today: homr's child process has Python's socket functions disabled; the Audiveris JVM is not restricted.
- Cloud Run: request-based billing, 4 vCPU, 8 GiB, concurrency 4, max 1 instance, min 0, timeout 240 s, startup CPU boost, `europe-west4`, service `digitus2-scan`, unauthenticated.
- Spend: budget 5 in the billing account's currency, thresholds 50, 90, 100 percent, kill-switch function in a dedicated project.
- Pinned artefacts: homr commit `ab369ac54277afab582afa4725441f7cbba76593`, source archive SHA-256 `23c81d6783c995866c256dba403bfa374639aeb20df64b738a0fc0034d160315`, the three model digests in `local-worker/homr.py` `MODELS`; Audiveris `Audiveris-5.11.0-ubuntu24.04-x86_64.deb` SHA-256 `f20113aaa33b3149ec8d6a09b2a7963360e65fafd92d69389987a85bbc3ec7a3`; `eng.traineddata` from tessdata commit `4767ea922bcc460e70b87b1d303ebdfed0897da8`, SHA-256 `daa0c97d651c19fba3b25e81317cd697e9908c8208090c94c3905381c23fc047`.
- Nothing is retained on the server after a response; one JSON log line per job with kind, bytes in and out, seconds and outcome, never content, file name or address.
- Subagents do not run git; the controlling agent commits each task with explicit paths. Long commands (Docker builds, the acceptance run) go to the background.
- `pnpm verify` is the definition of done; run it with `DIGITUS2_OMR_HOMR=C:/Users/maxim/omr/homr` on this machine so the acceptance gate runs instead of SKIP.

## Review Focus

- A reader closes the tab or navigates away mid-scan: the pending request is aborted and a DELETE goes out, so the instance is free within seconds (Task 6, unmount test).
- The warm-up fails (offline, cold service slow to answer): nothing is shown, and Scan still works when the service answers later (Task 6, warm-up test).
- Cloud Run itself answers 429 or 503 with an empty or HTML body when the instance is saturated: the app shows the busy phrase, not a parse error (Task 5, client test).
- Two scans in a row after a cancel: the second POST may meet 429 while the cancelled job winds down; the busy message appears and the button stays enabled (Task 7, cancel spec).
- A forwarded address header with several hops, the first of them forged by the client: the limiter keys on the last address only, and a request without the header uses the socket address (Task 2, limiter test).

---

### Task 1: Linux-capable adapters

**Files:**
- Modify: `research/omr/prototypes/local-worker/homr.py:74` (interpreter path)
- Modify: `research/omr/prototypes/local-worker/audiveris.py:118-175` (layout, environment, command)
- Test: `research/omr/prototypes/local-worker/test_homr.py`, `research/omr/prototypes/local-worker/test_audiveris_layout.py` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces, in `homr.py`: `def venv_python(toolchain: Path, platform: str = os.name) -> Path` returning `toolchain/"venv/Scripts/python.exe"` for `"nt"` and `toolchain/"venv/bin/python"` otherwise; `Homr.__init__` uses it.
- Produces, in `audiveris.py`: `DEB_SHA256 = "f20113aaa33b3149ec8d6a09b2a7963360e65fafd92d69389987a85bbc3ec7a3"`, `DEB_NAME = "Audiveris-5.11.0-ubuntu24.04-x86_64.deb"`; `@dataclass(frozen=True) class Layout: java: Path; classpath: str; package: str` (`package` is `"msi"` or `"deb"`); `def detect_layout(bundle: Path) -> Layout`; `def job_environment(destination: Path, platform: str = os.name) -> dict[str, str]`; `Audiveris.__init__` keeps its signature and stores `self.layout`.

- [ ] **Step 1: Write the failing tests for the interpreter path**

In `test_homr.py`, replace the fixture's hard-coded `venv/Scripts/python.exe` with `homr.venv_python(bundle)` (create its parent and write the file), and add:

```python
def test_interpreter_path_follows_the_platform():
    assert homr.venv_python(Path("t"), "nt") == Path("t/venv/Scripts/python.exe")
    assert homr.venv_python(Path("t"), "posix") == Path("t/venv/bin/python")
```

- [ ] **Step 2: Run the homr tests to verify the new one fails**

Run: `python -m pytest research/omr/prototypes/local-worker/test_homr.py -q`
Expected: FAIL with `AttributeError: module 'homr' has no attribute 'venv_python'`

- [ ] **Step 3: Implement `venv_python` and use it in `Homr.__init__`**

- [ ] **Step 4: Run the homr tests to verify they pass**

Run: `python -m pytest research/omr/prototypes/local-worker/test_homr.py -q`
Expected: PASS

- [ ] **Step 5: Write the failing layout tests**

Create `test_audiveris_layout.py`:

```python
"""Bundle layout detection and job isolation per platform; no recognition."""
import hashlib, os, threading, zipfile
from pathlib import Path
import pytest
import audiveris

def pin(monkeypatch, name, data):
    monkeypatch.setattr(audiveris, name, hashlib.sha256(data).hexdigest())

@pytest.fixture
def deb_bundle(tmp_path, monkeypatch):
    bundle = tmp_path / "audiveris"
    (bundle / "lib/runtime/bin").mkdir(parents=True)
    (bundle / "lib/runtime/bin/java").write_bytes(b"java")
    (bundle / "lib/app").mkdir()
    (bundle / "lib/app/Audiveris.cfg").write_text("[Application]\n")
    (bundle / audiveris.DEB_NAME).write_bytes(b"deb-bytes")
    pin(monkeypatch, "DEB_SHA256", b"deb-bytes")
    return bundle

@pytest.fixture
def msi_bundle(tmp_path, monkeypatch):
    bundle = tmp_path / "toolchain"
    (bundle / "portable/Audiveris/runtime/bin").mkdir(parents=True)
    (bundle / "portable/Audiveris/runtime/bin/java.exe").write_bytes(b"java")
    (bundle / "portable/Audiveris/app").mkdir()
    (bundle / "audiveris-5.11.0.msi").write_bytes(b"msi-bytes")
    pin(monkeypatch, "MSI_SHA256", b"msi-bytes")
    return bundle

def test_deb_layout_uses_the_package_java_and_both_class_path_entries(deb_bundle):
    layout = audiveris.detect_layout(deb_bundle)
    assert layout.package == "deb"
    assert layout.java == deb_bundle / "lib/runtime/bin/java"
    assert layout.classpath == str(deb_bundle / "lib/app" / "*")

def test_msi_layout_is_unchanged(msi_bundle):
    layout = audiveris.detect_layout(msi_bundle)
    assert layout.package == "msi"
    assert layout.java == msi_bundle / "portable/Audiveris/runtime/bin/java.exe"
    assert layout.classpath == str(msi_bundle / "portable/Audiveris/app" / "*")

def test_a_bundle_without_a_pinned_package_is_refused(tmp_path):
    with pytest.raises(ValueError, match="Audiveris release"):
        audiveris.detect_layout(tmp_path)

def test_a_package_with_the_wrong_digest_is_refused(deb_bundle):
    (deb_bundle / audiveris.DEB_NAME).write_bytes(b"other")
    with pytest.raises(ValueError, match="hash mismatch"):
        audiveris.detect_layout(deb_bundle)

def test_job_environment_isolates_each_platform(tmp_path):
    nt = audiveris.job_environment(tmp_path, "nt")
    assert nt["APPDATA"] == str(tmp_path / "roaming") and nt["TEMP"] == str(tmp_path / "tmp")
    posix = audiveris.job_environment(tmp_path, "posix")
    assert posix["HOME"] == str(tmp_path / "home")
    assert posix["XDG_CONFIG_HOME"] == str(tmp_path / "roaming")
    assert posix["XDG_DATA_HOME"] == str(tmp_path / "local")
    assert posix["XDG_CACHE_HOME"] == str(tmp_path / "javacpp")
    assert posix["TMPDIR"] == str(tmp_path / "tmp")
    assert "APPDATA" not in posix

def test_deb_command_runs_the_package_java_with_isolation(deb_bundle, tmp_path, monkeypatch):
    adapter = audiveris.Audiveris(deb_bundle, short_staves=True)
    job = tmp_path / "job"; job.mkdir()
    source = tmp_path / "input.pdf"; source.write_bytes(b"%PDF-1.4")
    captured = {}
    def run(command, directory, env, cancelled, timeout, log):
        captured.update(command=command, env=env)
        log.write_text("")
        (directory / "exports").mkdir(exist_ok=True)
        with zipfile.ZipFile(directory / "exports/score.mxl", "w") as archive:
            archive.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>')
            archive.writestr("score.xml", "<score-partwise/>")
    monkeypatch.setattr(audiveris, "run_process", run)
    monkeypatch.setattr(audiveris, "check_complete_export", lambda log: None)
    assert adapter(source, job, threading.Event()) == job / "result.musicxml"
    assert captured["command"][0] == str(deb_bundle / "lib/runtime/bin/java")
    assert captured["command"][captured["command"].index("-cp") + 1] == adapter.layout.classpath
    assert "org.audiveris.omr.sheet.grid.LinesRetriever.minStaffLength=12" in captured["command"]
    for name in ["JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "CLASSPATH"]:
        assert name not in captured["env"]
```

- [ ] **Step 6: Run the layout tests to verify they fail**

Run: `python -m pytest research/omr/prototypes/local-worker/test_audiveris_layout.py -q`
Expected: FAIL with `AttributeError: module 'audiveris' has no attribute 'detect_layout'`

- [ ] **Step 7: Implement `detect_layout`, `job_environment` and use them in `Audiveris`**

`detect_layout` checks the msi then the deb: a present package file whose digest mismatches raises `ValueError("Audiveris release hash mismatch")`; no package raises `ValueError("Audiveris release not found in bundle")`. `Audiveris.__call__` builds the command from `self.layout.java` and `-cp self.layout.classpath`, keeps every other argument, and applies `job_environment(destination)` over a copy of `os.environ` after popping the JVM and OCR variables. The `TESSDATA_PREFIX` copy of the text model is unchanged. Keep `-Xmx4g`.

- [ ] **Step 8: Run every worker test**

Run: `python -m pytest research/omr/prototypes/local-worker -q`
Expected: PASS (the existing `test_native.py`, `test_worker.py`, `test_homr.py` included)

- [ ] **Step 9: Commit**

```bash
git add research/omr/prototypes/local-worker/homr.py research/omr/prototypes/local-worker/audiveris.py research/omr/prototypes/local-worker/test_homr.py research/omr/prototypes/local-worker/test_audiveris_layout.py
git commit -m "Scanning adapters: Linux layouts for the homr environment and the Audiveris package"
```

### Task 2: The synchronous service

**Files:**
- Create: `research/omr/service/service.py`
- Create: `research/omr/service/test_service.py`
- Modify: `research/omr/prototypes/local-worker/worker.py:95-110` (extract `validate_result`)
- Modify: `scripts/verify.mjs:59` (an `omr:service` step after `omr`), `docs/verification-loop.md` (its row in the step table)

**Interfaces:**
- Consumes: `LocalWorker`, `PhotoPdfRecognizer` from `worker.py`; `Audiveris`, `Homr`, `run_process` semantics (a recogniser is `callable(source: Path, destination: Path, cancelled: threading.Event) -> Path`, raising `InterruptedError` when cancelled, `TimeoutError` on timeout, `RecognitionError` with `.public` for a public failure); `RecognitionError` from `recognition_errors.py`.
- Produces, in `worker.py`: `def validate_result(output: Path, directory: Path, max_result_bytes: int) -> bytes` (the checks now inline in `LocalWorker._run`: inside the directory, not a symlink, a file, size, no `<!ENTITY`, root `score-partwise`), used by `_run`.
- Produces, in `service.py`: `PROTOCOL = "digitus2-scan-v2"`, `ORIGIN = "https://marchalmaxim.github.io"`, `JOB_ID = re.compile(r"[a-f0-9]{32}")`;
  `class Limiter: __init__(self, limit: int = 30, window: float = 3600, clock=time.monotonic); allow(self, key: str) -> tuple[bool, int]` (allowed, seconds until the oldest entry leaves the window);
  `class Service: __init__(self, recognizer, root: Path, *, max_bytes=10 MiB, max_result_bytes=20 MiB); metadata(self) -> dict; recognize(self, data: bytes, extension: str, job_id: str) -> tuple[int, dict]; cancel(self, job_id: str) -> bool`;
  `def serve(service: Service, port: int, origins: set[str], limiter: Limiter, host: str = "0.0.0.0") -> ThreadingHTTPServer`; `def main()`.
- `recognize` runs the recogniser in the calling thread. Answers: `(200, {"state": "ready", "recognizer", "capabilities", "warnings", "xml"})`; `(422, {"state": "failed", "failure": error.public})`; `(504, {"state": "timed_out", "failure": {"code": "recognition-timeout", "message": ...}})`; `(409, {"state": "cancelled"})`; `(409, {"error": "duplicate-job"})`; `(429, {"error": "busy"})` when another recognition is running; `(422, {"state": "failed", "failure": {"code": "invalid-result", "message": "The recognizer produced an unusable result."}})` when `validate_result` raises. The job directory is removed in a `finally`. One `print(json.dumps({...}), flush=True)` per job with `kind`, `bytesIn`, `bytesOut`, `seconds`, `outcome` (the state or error string).
- The HTTP layer: `GET /v1/health` → 200 with `metadata()` plus `"protocol"` and `"maxUploadBytes"`; `POST /v1/recognize` → the checks of the worker's `do_POST` (exactly one `Content-Length`, no `Transfer-Encoding` or `Content-Encoding`, MIME and magic bytes), `X-Digitus2-Job` matching `JOB_ID` else 400 `{"error": "job-id-required"}`, the limiter keyed on the last comma-separated value of `X-Forwarded-For` or the socket address (429 `{"error": "rate-limited"}` with `Retry-After`), then `recognize`; `DELETE /v1/jobs/<id>` → `cancel` (200 `{"id", "state": "cancelling"}` or 404); `OPTIONS` → 204 with `Access-Control-Allow-Methods: GET, POST, DELETE` and `Access-Control-Allow-Headers: Content-Type, X-Digitus2-Client, X-Digitus2-Job`. Every answer carries `Access-Control-Allow-Origin` for an allowed origin, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Exactly one `Origin` header from the allowlist is required on every request (403 `origin-not-allowed`); POST and DELETE require `X-Digitus2-Client: 1` (403). No `Host` check. The server allows at least four handler threads at once.
- `scripts/verify.mjs` gains, after the `omr` step: `if (want('omr:service'))`, which runs `python -m pytest research/omr/service research/omr/prototypes/local-worker -q` and reports SKIP (never a failure) when `python -c "import pytest"` fails; `docs/verification-loop.md` gets the row.
- `main()` arguments: `--port` (default `PORT` env or 8080), `--root` (default a `digitus2-scan` directory under the system temp), `--bundle`, `--homr-toolchain`, `--text-models`, `--short-staves`, `--timeout` (default 180), `--dev-origin` (repeatable, exact loopback HTTP origin), `--rate-limit` (default 30). It builds `PhotoPdfRecognizer(Audiveris(...), Homr(...))` as `worker.main` does and prints one JSON line `{"listening": ..., "protocol": PROTOCOL, "recognizer": ...}`.

- [ ] **Step 1: Write the failing tests**

Create `test_service.py` with a fixture in the style of `test_worker.py` (a blocking simulated recogniser, `serve` on port 0, a `request(api, method, path, body=None, headers=None)` helper that sends `Origin` and, for POST and DELETE, `X-Digitus2-Client: 1` and a fresh `X-Digitus2-Job` of 32 hex unless given). Tests:

```python
def test_health_names_the_protocol_and_the_upload_limit(api)  # 200; body["protocol"] == "digitus2-scan-v2"; body["maxUploadBytes"] == 64 (fixture limit); body["needsReview"] is True
def test_recognize_answers_the_xml_with_metadata_and_keeps_nothing(api, tmp_path)  # 200; body["state"] == "ready"; body["xml"].startswith("<?xml"); recognizer.inputs == [PNG]; no "scan-*" directory left under tmp_path after the answer
def test_a_public_failure_is_422(api)  # the recogniser raises RecognitionError(public={"code": "staff-resolution-too-low", ...}); 422; body["failure"]["code"] == that code
def test_a_timeout_is_504(api)  # the recogniser raises TimeoutError; 504; body["state"] == "timed_out"
def test_an_unusable_result_is_422_invalid_result(api)  # the recogniser writes "<!DOCTYPE x [<!ENTITY a 'b'>]><score-partwise/>"; 422; body["failure"]["code"] == "invalid-result"
def test_a_second_recognition_is_busy_with_retry_after(api)  # block the recogniser; POST in a thread; a second POST gets 429 with Retry-After; unblock; the first gets 200
def test_cancel_stops_the_running_job_and_the_post_answers_409(api)  # block; POST in a thread with job id J; DELETE /v1/jobs/J → 200 state cancelling; the POST answers 409 {"state": "cancelled"}; DELETE of an unknown id → 404
def test_the_limiter_keys_on_the_last_forwarded_address(api)  # limiter limit 2 in the fixture: two POSTs with X-Forwarded-For "9.9.9.9, 1.1.1.1" succeed, a third with "8.8.8.8, 1.1.1.1" is 429 {"error": "rate-limited"} with Retry-After; a POST with "1.1.1.1, 2.2.2.2" succeeds
def test_origin_and_client_header_are_required(api)  # no Origin → 403; wrong Origin → 403; POST without X-Digitus2-Client → 403; OPTIONS preflight → 204 with the three allowed headers
def test_the_job_id_must_be_32_hex_and_unused(api)  # missing or "abc" → 400 job-id-required; the same id while running → 409 duplicate-job
def test_upload_checks(api)  # 65 bytes → 413; Content-Type text/plain → 415; PNG type with JPEG bytes → 415; Transfer-Encoding chunked → 411
```

- [ ] **Step 2: Run the service tests to verify they fail**

Run: `python -m pytest research/omr/service/test_service.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'service'` (or the import of `serve`)

- [ ] **Step 3: Extract `validate_result` in `worker.py` and run the worker tests**

Run: `python -m pytest research/omr/prototypes/local-worker/test_worker.py -q`
Expected: PASS

- [ ] **Step 4: Implement `service.py`**

`service.py` adds `../prototypes/local-worker` to `sys.path` relative to its own file. `Limiter` keeps a deque of timestamps per key and prunes on each call. `Service.recognize` takes a non-blocking `threading.Lock` for the one-at-a-time rule and keeps `running: dict[str, threading.Event]` for cancellation.

- [ ] **Step 5: Run the service tests to verify they pass**

Run: `python -m pytest research/omr/service/test_service.py -q`
Expected: PASS

- [ ] **Step 6: Add the `omr:service` step and run it**

Run: `node scripts/verify.mjs --only omr:service` (or the flag `verify.mjs` uses for one step; read its `want` helper)
Expected: PASS with the pytest summary

- [ ] **Step 7: Commit**

```bash
git add research/omr/service/service.py research/omr/service/test_service.py research/omr/prototypes/local-worker/worker.py scripts/verify.mjs docs/verification-loop.md
git commit -m "Scan service: one synchronous recognition per request, cancel by job id, per-caller limit"
```

### Task 3: The container and the smoke script

**Files:**
- Create: `research/omr/service/setup-homr.py`, `research/omr/service/Dockerfile`, `research/omr/.dockerignore`, `research/omr/service/smoke.mjs`, `research/omr/service/README.md`
- Test: `research/omr/service/test_setup_homr.py`

**Interfaces:**
- Consumes: `COMMIT`, `MODELS` from `local-worker/homr.py`; `prepare_patched.py` from `homr-photo/`; `service.py` from Task 2.
- Produces: `setup-homr.py --root DIR [--python PATH]` with `ARCHIVE_SHA256 = "23c81d6783c995866c256dba403bfa374639aeb20df64b738a0fc0034d160315"`, `ARCHIVE_URL = f"https://github.com/liebharc/homr/archive/{COMMIT}.zip"`, `def verify_sha256(path: Path, expected: str) -> None` (raises `ValueError` naming the file), and the same steps as `homr-photo/setup.ps1`: download the archive, verify, extract, create the venv with `--python`, `pip install --only-binary=:all: -r requirements-cpu.txt`, `pip freeze > installed.txt`, `prepare_patched.py --verify-pristine-only`, `python -m homr.main --init --no-title --gpu no` with `PYTHONPATH` at the pristine source, verify every `.onnx` against `MODELS`, write `models.json`, `prepare_patched.py` (patch and verify).
- Produces: an image whose entry point is `python3 research/omr/service/service.py --bundle /opt/audiveris --short-staves --text-models /opt/text-models --homr-toolchain /opt/homr`, `CMD []`, listening on `PORT` (8080), running as a non-root user, with `/app/research/omr/prototypes/{local-worker,homr-photo,photo-recovery}` and `/app/research/omr/service` copied in. The Audiveris package is installed with `apt-get install -y ./Audiveris-5.11.0-ubuntu24.04-x86_64.deb` after its digest check, and the package file is kept at `/opt/audiveris/Audiveris-5.11.0-ubuntu24.04-x86_64.deb` for the adapter's check. `eng.traineddata` and its `LICENSE` are fetched from `https://raw.githubusercontent.com/tesseract-ocr/tessdata/4767ea922bcc460e70b87b1d303ebdfed0897da8/` and the model's digest checked. Python: Ubuntu's `python3` (3.12) with `python3-venv`; if the locked requirements do not install with `--only-binary=:all:` on 3.12, use a managed Python 3.11 and say so in the README.
- Produces: `smoke.mjs URL [--photo PATH] [--pdf PATH]`: posts the photo (default `research/omr/photos/boellmann-op28-page5-flat.jpeg`) and the PDF (default: the first `*.pdf` under the newest `research/omr/results/acceptance/fixtures-*/` directory, skipped with a note when none exists) with `Origin: https://marchalmaxim.github.io`, prints `{state, recognizer, seconds, xmlBytes}` per route, checks each answer's `xml` parses to a root named `score-partwise` (a regex on the first element is enough), exits 1 on any other outcome, and refuses the URL `https://scan.digitus2.invalid` with a message.

- [ ] **Step 1: Write the failing setup test**

```python
# test_setup_homr.py
def test_verify_sha256_names_the_file_on_mismatch(tmp_path):
    f = tmp_path / "a.zip"; f.write_bytes(b"x")
    with pytest.raises(ValueError, match="a.zip"):
        setup_homr.verify_sha256(f, "00" * 32)
def test_setup_pins_the_archive_and_models():
    assert setup_homr.ARCHIVE_SHA256 == "23c81d6783c995866c256dba403bfa374639aeb20df64b738a0fc0034d160315"
    assert setup_homr.MODELS is homr.MODELS
```

(`test_setup_homr.py` imports the script as a module with `importlib` from its hyphenated file name.)

- [ ] **Step 2: Run it to verify it fails, implement `setup-homr.py`, run it to verify it passes**

Run: `python -m pytest research/omr/service/test_setup_homr.py -q`

- [ ] **Step 3: Write the Dockerfile and `.dockerignore`**

Build context is `research/omr`; the ignore file excludes `results/`, `photos/`, `prototypes/oemer*`, `**/__pycache__`, `**/*.test.mjs`. Layers in this order so a code change rebuilds only the last ones: base and apt packages; Audiveris; text model; homr setup (copy `prototypes/homr-photo`, `prototypes/photo-recovery` and `prototypes/local-worker/homr.py` first, since the setup imports it); then the rest of the worker and the service.

- [ ] **Step 4: Build the image in the background and check its health**

Run (background): `docker build -f research/omr/service/Dockerfile -t digitus2-scan research/omr`
Then: `docker run --rm -d -p 8996:8080 --cpus 4 --memory 8g --name scan digitus2-scan` and
`curl -s -H "Origin: https://marchalmaxim.github.io" http://127.0.0.1:8996/v1/health`
Expected: a JSON body with `"protocol":"digitus2-scan-v2"` and a `recognizer` naming both HOMR and Audiveris-5.11.0 with `+pinned-eng`.

- [ ] **Step 5: Write `smoke.mjs` and run it against the container**

Run: `node research/omr/service/smoke.mjs http://127.0.0.1:8996`
Expected: two lines with `state: 'ready'` and the seconds taken; exit 0. Record both timings for `docs/scan-service.md` (Task 9).

- [ ] **Step 6: Write `README.md` for the service** (build, run locally with `--dev-origin`, the protocol in one table, deploy and budget pointers to Task 8's scripts, recovery when billing is disabled)

- [ ] **Step 7: Commit**

```bash
git add research/omr/service/setup-homr.py research/omr/service/test_setup_homr.py research/omr/service/Dockerfile research/omr/.dockerignore research/omr/service/smoke.mjs research/omr/service/README.md
git commit -m "Scan service container: pinned homr and Audiveris on Ubuntu, with a smoke script"
```

### Task 4: Equivalence of the Linux build on the acceptance corpus

**Files:**
- Modify: `research/omr/acceptance.mjs` (a `--service URL` mode)
- Test: `research/omr/acceptance.test.mjs`

**Interfaces:**
- Consumes: the running container from Task 3; the toolchains on this machine (the photo rotation step uses the homr environment's Python).
- Produces: `export async function recognizeViaService(jobs, service, { fetch = globalThis.fetch, origin = ORIGIN } = {})`: for each job without an output, POSTs the input bytes to `${service}/v1/recognize` with `Content-Type` by extension (`.png`, `.jpg`/`.jpeg`, `.pdf`), `Origin`, `X-Digitus2-Client: 1` and a random `X-Digitus2-Job`; a 200 writes `body.xml` to `job.output`, any other status writes `job.output + '.failed.json'` with `{ status, message }` from `body.failure?.message ?? body.error`. Jobs run one after another. `main` with `--service URL` keeps the fixtures, the job list, the scoring and the floor comparison, but recognises with `recognizeViaService` and caches under `research/omr/results/acceptance/cache-service/<recognizer label from health, sanitised>/` instead of `cache/`, writes the scorecard to `latest-service.json`, and prints the same table.

- [ ] **Step 1: Write the failing test**

In `acceptance.test.mjs`, a test `recognizeViaService writes the answer or the failure per job` with a stub `fetch` that answers 200 `{ xml: '<score-partwise/>' }` for a `.pdf` body and 422 `{ failure: { message: 'blur' } }` for a `.png`, two jobs in a temp dir; assert the PDF job's output holds `<score-partwise/>`, the PNG job's `.failed.json` holds `blur`, and that each request carried `X-Digitus2-Client: 1`, an `Origin` and a 32-hex `X-Digitus2-Job`.

- [ ] **Step 2: Run it to verify it fails, implement, run it to verify it passes**

Run: `node --test research/omr/acceptance.test.mjs`

- [ ] **Step 3: Run the corpus through the container in the background**

Run (background, with the container of Task 3 running): `DIGITUS2_OMR_HOMR=C:/Users/maxim/omr/homr node research/omr/acceptance.mjs --service http://127.0.0.1:8996`
Expected: the table for `homr:*`, `audiveris:pdf` and `photos:*`, and exit 0 (no breach of `floor.json`). Keep the printed table for `docs/research/omr.md` (Task 9). A breach is investigated before anything is deployed.

- [ ] **Step 4: Commit**

```bash
git add research/omr/acceptance.mjs research/omr/acceptance.test.mjs
git commit -m "Acceptance gate: recognise through a running scan service to check the Linux build"
```

### Task 5: The v2 client in the app

**Files:**
- Create: `apps/web/src/scan/service.ts`
- Modify: `apps/web/src/scan/client.ts`
- Modify: `apps/web/src/i18n/en/scan.ts` (`client` and `errors` keys only in this task), `es`, `fr`, `nl`, `pt` likewise
- Test: `apps/web/src/scan/scan.test.ts`

**Interfaces:**
- Produces, `service.ts`: `export const PLACEHOLDER_SCAN_SERVICE = 'https://scan.digitus2.invalid'`; `export const DEPLOYED_SCAN_SERVICE = PLACEHOLDER_SCAN_SERVICE` (replaced by the real URL in Task 10); `export const SCAN_SERVICE: string = (import.meta.env?.VITE_SCAN_SERVICE as string | undefined) || DEPLOYED_SCAN_SERVICE`. No other import, so the e2e specs can import it under Node.
- Produces, `client.ts`: `export const PROTOCOL = 'digitus2-scan-v2'`; `export interface ScanServiceMetadata` (the fields of today's `WorkerMetadata` minus `id`, `state`, `failure`); `export interface Recognition { xml: string; recognizer?: string; warnings: string[]; capabilities?: ScanServiceMetadata['capabilities'] }`; `export function newJobId(): string` (32 lowercase hex from `crypto.getRandomValues`); `export function createScanClient(fetcher: typeof fetch = fetch, base: string = SCAN_SERVICE)` returning `{ health(): Promise<ScanServiceMetadata>; recognize(file: File, job: string, signal?: AbortSignal): Promise<Recognition>; cancel(job: string): Promise<void> }`. `UNKNOWN_WARNING` and `GRAND_STAFF_WARNING` and the warning normalisation stay.
- Behaviour: `health` GETs `/v1/health` with a 10 s timeout, `mode: 'cors'`, `credentials: 'omit'`, and throws `PhraseError(t.scan.client.outdated)` when `protocol !== PROTOCOL`. `recognize` POSTs `/v1/recognize` with headers `Content-Type: file.type`, `X-Digitus2-Client: 1`, `X-Digitus2-Job: job`, the file as body, aborted by `signal` or after 200 s; it maps: a rejected fetch (network) → `PhraseError(t.scan.errors.offline)` unless the signal aborted (rethrow); 200 → the recognition (missing `xml` → `PhraseError(t.scan.client.noResult)`); 409 → throw `new DOMException('cancelled', 'AbortError')`; 422 and 504 → `new Error(failure.message)` when the body carries a string message, else `PhraseError(t.scan.errors.notRecognized)` (422) or `PhraseError(t.scan.errors.timedOut)` (504); 429 with a JSON body whose `error` is `rate-limited` → `PhraseError(t.scan.client.limited)`; any other 429 and 503 → `PhraseError(t.scan.client.busy)` whatever the body; any other status → `PhraseError(t.scan.client.serviceStatus(status))`. `cancel` sends `DELETE /v1/jobs/<job>` with `X-Digitus2-Client: 1` and `keepalive: true`, and resolves even on a non-2xx answer. A job id that does not match `/^[a-f0-9]{32}$/` throws `PhraseError(t.scan.client.invalidJob)`.
- Copy (English): `client.busy` "The scanner is busy with another score. Try again in a minute."; `client.limited` "You have scanned a lot in the past hour. Try again later."; `client.serviceStatus(status)` "The scanner could not answer (error {status}). Try again later."; `client.outdated` "Reload the page to scan: the scanner has been updated."; `client.noResult` "The scanner returned no score."; `client.invalidJob` "Invalid scan job."; `errors.offline` "Could not reach the scanner. Check your connection and try again."; removed: `client.workerStatus`, `client.updateWorker`, `client.noJob`, `errors.connectFailed`.

- [ ] **Step 1: Rewrite the client tests**

Replace the worker tests in `scan.test.ts` (`does not contact the worker before an explicit connect`, `passes original upload and cancels...`, `refuses incompatible worker and surfaces busy state`) with tests against a stub fetcher:

```ts
it('posts the original bytes with the job id and returns the recognition')
it('cancels with a keepalive DELETE and tolerates a failed answer')
it('maps busy, limited, offline, failure, timeout and other statuses to phrases', ...) // 429 with an HTML body → busy; 429 {error:'rate-limited'} → limited; 503 → busy; a rejected fetch → offline; 422 {failure:{message:'blur'}} → Error('blur'); 504 → timedOut phrase; 500 → serviceStatus(500)
it('throws an abort on a cancelled job and on a caller abort')
it('refuses a service of another protocol')  // health protocol 'digitus2-scan-v1' → outdated phrase
it('makes 32-hex job ids')
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @digitus2/web test -- src/scan/scan.test.ts`
Expected: FAIL (no `recognize`, no `service.ts`)

- [ ] **Step 3: Implement `service.ts`, rewrite `client.ts`, add the copy in the five languages**

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm --filter @digitus2/web test -- src/scan/scan.test.ts` then `pnpm --filter @digitus2/web typecheck`
Expected: the client tests PASS; the typecheck fails only in `ScanView.tsx`, `ScanView.test.tsx` and `phone.ts` (Task 6 fixes them), nowhere else.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/scan/service.ts apps/web/src/scan/client.ts apps/web/src/scan/scan.test.ts apps/web/src/i18n/en/scan.ts apps/web/src/i18n/es/scan.ts apps/web/src/i18n/fr/scan.ts apps/web/src/i18n/nl/scan.ts apps/web/src/i18n/pt/scan.ts
git commit -m "Scan client v2: one request per page to the scan service"
```

### Task 6: One button on the scan page

**Files:**
- Modify: `apps/web/src/scan/ScanView.tsx`, `apps/web/src/scan/phone.ts`
- Modify: `apps/web/src/i18n/{en,es,fr,nl,pt}/scan.ts` (`view`, `setup`, `phone`, `errors` keys)
- Test: `apps/web/src/scan/ScanView.test.tsx`

**Interfaces:**
- Consumes: Task 5's client (`health`, `recognize`, `cancel`, `newJobId`).
- Produces: `ScanView` phases `'ready' | 'scanning' | 'cancelling' | 'review'`; `phone.ts` keeps `isTouchOnly` and `namedCapture` only.
- Copy (English): `view.where` "Recognition runs on the project's scanner on Google Cloud (Netherlands). Your page is sent there, recognized and then deleted."; `view.scanning` "Recognizing… Usually under a minute. The first scan after a quiet spell takes longer while the scanner starts."; `view.scanningPage(page, total)` "Page {page} of {total} · Recognizing… Usually under a minute. The first scan after a quiet spell takes longer while the scanner starts."; `view.help` "How scanning works" (a link to `https://github.com/MarchalMaxim/digitus2/blob/main/docs/scanning.md`); `errors.cancelFailed` "Cancellation could not be confirmed. The scanner stops by itself within three minutes."; keep `view.advice`, `view.cancelScan`, `view.cancelling`, `view.retryFailed`, `view.scanScore`, `view.textModelMissing`, `phone.takePhoto`, `phone.takeAnother`. Removed in all five languages: `view.workerNeeded`, `view.connect`, `view.connecting`, `view.connected`, the whole `setup` object, `phone.explain`, `phone.share`, `phone.save`, `phone.shareTitle`, `phone.shared`, `phone.saved`.
- Behaviour: on mount with no recognition yet (`phase === 'ready'`), one `client.health()` whose result sets `health` and whose rejection is ignored. `scan()` keeps its page loop but, per page, makes `const job = newJobId()` and an `AbortController`, stores both on `active.current`, calls `client.recognize(page.file, job, controller.signal)`, and on success sets `page.xml`, `page.recognizer` and `page.warnings` from the recognition (falling back to `health` for the recogniser name and warnings). `cancel()` aborts the controller, calls `client.cancel(job)`, and returns the phase to `'ready'`; an `AbortError` from `recognize` is not shown as an error. Unmount aborts and cancels the running job. The intro renders, on every device: the advice, the `where` sentence (`small muted`), the one button row (Scan this score / Retry failed pages, or Cancel scan while scanning), the loader, the status, the text-model warning, the error alert and the `help` link. No `touchOnly` branch except the page tools' touch text that already exists. "Scan again" sets `'ready'`.

- [ ] **Step 1: Update the view tests**

In `ScanView.test.tsx`, replace `connects, scans one image and arrives at the review of the recognition` with:

```ts
it('warms the scanner up on arrival, scans one image and arrives at the review', ...)
// stub fetch: GET .../v1/health → { protocol: 'digitus2-scan-v2', recognizer: 'Test' }; POST .../v1/recognize → { state: 'ready', xml, recognizer: 'Test', warnings: [] }
// assert: a health request happened before any click and no POST; after clicking 'Scan this score' the POST carried X-Digitus2-Job (32 hex) and X-Digitus2-Client; the review heading appears; load was called with xml
it('shows nothing when the warm-up fails, and the scan still works', ...)  // health rejects; no alert; Scan still reaches the review
it('cancels the running job with a DELETE and returns to Scan this score', ...)  // POST never resolves until aborted; click Cancel scan; expect a DELETE to /v1/jobs/<job>; no alert; button back
it('sends the DELETE when the view unmounts mid-scan', ...)
it('offers the same single button on a touch-only device', ...)  // matchMedia stub: coarse only; no 'Send photos' text; 'Scan this score' present; the where sentence present
```

- [ ] **Step 2: Run the view tests to verify they fail**

Run: `pnpm --filter @digitus2/web test -- src/scan/ScanView.test.tsx`
Expected: FAIL (`Connect to this PC` flow, `connect` phase)

- [ ] **Step 3: Rewrite the intro and the scan loop in `ScanView.tsx`, trim `phone.ts`, update the copy in the five languages**

- [ ] **Step 4: Run the web unit tests, typecheck and lint**

Run: `pnpm --filter @digitus2/web test` then `pnpm typecheck` then `pnpm lint`
Expected: PASS, PASS, PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/scan/ScanView.tsx apps/web/src/scan/ScanView.test.tsx apps/web/src/scan/phone.ts apps/web/src/i18n/en/scan.ts apps/web/src/i18n/es/scan.ts apps/web/src/i18n/fr/scan.ts apps/web/src/i18n/nl/scan.ts apps/web/src/i18n/pt/scan.ts
git commit -m "Scan page: one button on every device, the scanner warmed up on arrival"
```

### Task 7: End-to-end specs against the service origin

**Files:**
- Modify: `apps/web/e2e/helpers/scan.ts`, `apps/web/e2e/scan.spec.ts`, `apps/web/e2e/scan-phone.spec.ts`, `apps/web/e2e/scan-rotation.spec.ts`, `apps/web/e2e/scan-edit.spec.ts`, `apps/web/e2e/local-library.spec.ts`, `apps/web/e2e/embellish.spec.ts` (every `127.0.0.1:8996` route and every `Connect to this PC` click)

**Interfaces:**
- Consumes: `SCAN_SERVICE` from `../src/scan/service.js` (the placeholder origin in e2e builds).
- Produces, `helpers/scan.ts`: `export const HEALTH = { protocol: 'digitus2-scan-v2', recognizer: 'test recognizer', capabilities: { textModelConfigured: true } }`; `export async function mockService(page, xml: string | ((request: Request) => string), hooks?: { onRecognize?: (request) => Promise<Response-like | void> })` routing `${SCAN_SERVICE}/**`: health → `HEALTH`; POST → 200 `{ state: 'ready', ...HEALTH, xml }`; DELETE → 200 `{ state: 'cancelling' }`; `scanOnePage(page, name)` no longer clicks Connect.

- [ ] **Step 1: Rewrite the helper and the specs**

In `scan.spec.ts`: drop every Connect click; the `deliberate connection` test becomes `scan: the warm-up happens on arrival, the page goes only on Scan` (exactly one request, the health GET, after choosing the file; the POST only after Scan; the rest unchanged); `unavailable worker ...` becomes `scan: an unreachable scanner is reported and the scan can be retried` (route aborts → alert contains `Could not reach the scanner` → `Scan this score` enabled); add `scan: a busy scanner says so and keeps the button` (POST → 429 with an empty body → alert contains `busy` → button enabled); the cancellation test holds the POST until the DELETE arrives, then fulfils it with 409 `{ state: 'cancelled' }`, and asserts the DELETE was sent and `Scan this score` is back with no alert; the resolution-failure test fulfils the POST with 422 and the same `failure` object. In `scan-phone.spec.ts`: both tests become one flow: two camera photos, the page tools at 44 px, moving the second photo first, then `Scan this score` against `mockService` and the review heading; assert there is no `Connect to this PC`, no `Send photos`, and the `where` sentence is visible; keep the one-red, axe, horizontal-scroll and dark checks. The other specs swap the route for `mockService` and drop the Connect click.

- [ ] **Step 2: Build and run the scan specs at both widths**

Run: `pnpm --filter @digitus2/web exec vite build` then `pnpm --filter @digitus2/web exec playwright test scan scan-phone scan-rotation scan-edit local-library embellish`
Expected: PASS on `desktop` and `mobile`

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/helpers/scan.ts apps/web/e2e/scan.spec.ts apps/web/e2e/scan-phone.spec.ts apps/web/e2e/scan-rotation.spec.ts apps/web/e2e/scan-edit.spec.ts apps/web/e2e/local-library.spec.ts apps/web/e2e/embellish.spec.ts
git commit -m "e2e: scan through the service origin on PC and phone"
```

### Task 8: Deploy and budget scripts

**Files:**
- Create: `research/omr/service/deploy.ps1`, `research/omr/service/budget/main.py`, `research/omr/service/budget/requirements.txt`, `research/omr/service/budget/test_main.py`, `research/omr/service/budget/budget.ps1`
- Modify: `research/omr/service/README.md`

**Interfaces:**
- Produces, `deploy.ps1 -Project ID [-Region europe-west4] [-Service digitus2-scan] [-Repository digitus2]`: `gcloud services enable run.googleapis.com artifactregistry.googleapis.com`; create the Artifact Registry Docker repository when missing and set a cleanup policy that keeps the 2 most recent versions; `gcloud auth configure-docker <region>-docker.pkg.dev --quiet`; `docker build -f research/omr/service/Dockerfile -t <region>-docker.pkg.dev/<project>/<repo>/<service>:<short git sha> research/omr`; push; `gcloud run deploy <service> --image ... --region ... --cpu 4 --memory 8Gi --concurrency 4 --max-instances 1 --min-instances 0 --timeout 240 --cpu-boost --execution-environment gen2 --allow-unauthenticated --ingress all --port 8080`; print the service URL; run `node research/omr/service/smoke.mjs <url>`.
- Produces, `budget/main.py`: Google's Python sample shaped as `def stop_billing(cloud_event) -> None` with `def decide(cost: float, budget: float, billing_enabled: bool) -> str` returning `"keep"`, `"disable"` or `"already-disabled"`, `SIMULATE = os.environ.get("SIMULATE", "true").lower() != "false"`, the project id from `GOOGLE_CLOUD_PROJECT` or the metadata server, `google.cloud.billing_v1.CloudBillingClient` for `get_project_billing_info` and `update_project_billing_info(name=..., project_billing_info={"billing_account_name": ""})`, `PermissionDenied` caught and logged. `requirements.txt`: `functions-framework==3.*`, `google-cloud-billing`, `google-cloud-logging` at the versions Google's page lists.
- Produces, `budget.ps1 -Project ID -BillingAccount ID [-Amount 5] [-Topic digitus2-scan-budget] [-Simulate $true]`: enable `cloudbilling`, `billingbudgets`, `pubsub`, `cloudfunctions`, `cloudbuild`, `eventarc`, `run`, `artifactregistry`; create the topic; deploy the function (`gcloud functions deploy stop-billing --gen2 --runtime python312 --region europe-west4 --source research/omr/service/budget --entry-point stop_billing --trigger-topic <topic> --set-env-vars SIMULATE=<true|false>`); grant the function's service account `roles/billing.admin` on the billing account as Google's guide does; create the budget with `gcloud billing budgets create --billing-account <id> --display-name digitus2-scan --budget-amount <amount> --filter-projects projects/<id> --threshold-rule percent=0.5 --threshold-rule percent=0.9 --threshold-rule percent=1.0 --notifications-rule-pubsub-topic projects/<id>/topics/<topic>`; print the test command `gcloud pubsub topics publish <topic> --message '{"costAmount": 6, "budgetAmount": 5}'` and where to read the function's log.

- [ ] **Step 1: Write the failing kill-switch tests**

```python
# budget/test_main.py
def test_decide_keeps_billing_under_the_budget(): assert main.decide(4.0, 5.0, True) == "keep"
def test_decide_disables_at_the_budget(): assert main.decide(5.0, 5.0, True) == "disable"
def test_decide_reports_already_disabled(): assert main.decide(6.0, 5.0, False) == "already-disabled"
def test_simulation_logs_and_never_calls_the_api(monkeypatch, caplog)  # SIMULATE true; a fake client records calls; stop_billing(event with costAmount 6, budgetAmount 5) → no update call; log contains "simulation"
def test_a_real_run_unlinks_the_billing_account(monkeypatch)  # SIMULATE false; the fake's update receives billing_account_name ""
```

- [ ] **Step 2: Run them to verify they fail, implement `main.py`, run them to verify they pass**

Run: `python -m pytest research/omr/service/budget -q` (install `google-cloud-billing` and `functions-framework` into a scratch virtual environment for the test, or stub the `google.cloud` modules in the test; the stub is the default so `pnpm verify` needs no new global package)

- [ ] **Step 3: Write `deploy.ps1` and `budget.ps1`; check them with `pwsh -NoProfile -Command "Get-Command -Syntax"` style parsing**

Run: `powershell -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw research/omr/service/deploy.ps1)) | Out-Null; 'ok'"` and the same for `budget.ps1`
Expected: `ok` twice (they parse; they are not run here)

- [ ] **Step 4: Extend the README** with deploy, budget, the simulation test, switching simulation off, and recovery (link the project to the billing account again in the console; nothing to redeploy)

- [ ] **Step 5: Commit**

```bash
git add research/omr/service/deploy.ps1 research/omr/service/budget research/omr/service/README.md
git commit -m "Scan service: deploy script and the billing kill-switch at 5 a month"
```

### Task 9: Documents

**Files:**
- Modify: `docs/scanning.md`, `docs/research/omr.md`, `docs/PROGRESS.md`, `docs/app.md`, `docs/TODO.md`, `research/omr/prototypes/local-worker/README.md`
- Create: `docs/scan-service.md`

- [ ] **Step 1: `docs/scanning.md`**: replace "Nothing leaves your computer" with "Where your page goes" (the `where` sentence; processed in memory, deleted when the job ends, one page at a time, the scanner can be busy or asleep for the first scan); "Scan a score" without the Connect step; "On a phone or tablet" says a phone scans like a PC and keeps the camera and the touch tools; remove "Set up the PC worker" and "Connection problems", replace the latter with "When scanning does not start" (busy, no connection, the scanner could not answer, timed out); "Licences": the recognisers run on the project's server, their source is public in this repository. Keep every section about the review, corrections, batches, rotation, My scores and known errors.
- [ ] **Step 2: `docs/scan-service.md`** (new): what runs where; the v2 protocol table; the Cloud Run settings table; deploy; budget and kill-switch; recovery; the cost table of the design with its sources; the timings from Task 3 and Task 10 in a table; limits.
- [ ] **Step 3: `docs/research/omr.md`**: the Decision bullets (recognition runs on a Cloud Run service; the loopback worker is a research tool), a section "Hosted recognition" with the routes weighed (the design's table) and the equivalence table from Task 4 next to the Windows numbers; "Browser to worker connection" marked as the research worker's.
- [ ] **Step 4: `docs/PROGRESS.md`**: "Where things are" (service and budget rows), the `apps/web/src` and `research/` lines, the M10 and M13 rows, the Scanning decisions (replace the four bullets), "What is next" (drop the phone hand-off limitation); `docs/app.md`: the network sentence and the Scanning section; `local-worker/README.md`: first paragraph says it is the research loopback server and the service's engine; `CLAUDE.md` and `docs/superpowers/specs/2026-10-13-digitus2-design.md`: the stack line "engine runs in the browser with no server" gains "except the scan recognition service on Cloud Run (`docs/scan-service.md`)", and GitHub Pages stays the only deployment of the app; `docs/TODO.md`: one line for #62 ("Scanning: find a way to not rely on a local machine running the service" with the outcome).
- [ ] **Step 5: Run the formatter and commit**

Run: `pnpm exec prettier --check docs` (fix with `--write`)

```bash
git add docs/scanning.md docs/scan-service.md docs/research/omr.md docs/PROGRESS.md docs/app.md docs/TODO.md research/omr/prototypes/local-worker/README.md
git commit -m "Docs: scanning runs on the project's Cloud Run service"
```

### Task 10: Deploy, set the URL, smoke and timings

Owner-gated: the billing account comes from the owner (design section 11). Until then the app builds with the placeholder origin, and the pull request is not opened: GitHub Pages deploys every push to `main`, and a merge with the placeholder would break scanning for everyone. The URL is known once the project exists: `https://digitus2-scan-<project number>.europe-west4.run.app`.

- [ ] **Step 1: Create the project and link billing** (controller, with gcloud as the owner): `gcloud projects create <id> --name digitus2-scan`, `gcloud billing projects link <id> --billing-account <account>`.
- [ ] **Step 2: Deploy**: `powershell -File research/omr/service/deploy.ps1 -Project <id>`; note the URL and the smoke output (cold start: time the first `GET /v1/health` after 20 minutes idle, then the photo and the PDF).
- [ ] **Step 3: Budget**: `powershell -File research/omr/service/budget/budget.ps1 -Project <id> -BillingAccount <account> -Simulate $true`; publish the test message; read the function log; rerun with `-Simulate $false`.
- [ ] **Step 4: Set `DEPLOYED_SCAN_SERVICE` in `apps/web/src/scan/service.ts`** to the URL; run `pnpm --filter @digitus2/web test -- src/scan` and the scan e2e specs again (they route the real origin now).
- [ ] **Step 5: Record the timings and the URL** in `docs/scan-service.md` and `docs/PROGRESS.md`; commit.

```bash
git add apps/web/src/scan/service.ts docs/scan-service.md docs/PROGRESS.md
git commit -m "Scan service: deployed URL and measured timings"
```

### Task 11: Verify and open the pull request

- [ ] **Step 1: Run the whole loop**: `DIGITUS2_OMR_HOMR=C:/Users/maxim/omr/homr pnpm verify` (background). Expected: every step PASS, `omr:acceptance` run, not SKIP; the benchmark gates may SKIP only for the datasets this machine lacks.
- [ ] **Step 2: Rebase on `main`** (it moves fast), rerun the web unit tests and the scan e2e specs.
- [ ] **Step 3: Open the PR** with "Closes #62", the design and plan paths, the equivalence table, the timings, and the owner's device check as the one open item.
