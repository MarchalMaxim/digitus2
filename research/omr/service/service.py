"""Hosted scan service: one synchronous recognition per request; nothing is kept after the answer,
unless the device opted in and a cases bucket is configured (Keeper)."""
from __future__ import annotations

import argparse
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
import shutil
import socket
import sys
import tempfile
import threading
import time
from urllib.parse import quote, urlencode, urlsplit
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prototypes" / "local-worker"))
from recognition_errors import RecognitionError  # noqa: E402
from thread_budget import VARIABLE as THREADS_VARIABLE, detect as detect_threads  # noqa: E402
from worker import LocalWorker, PhotoPdfRecognizer, linger_close, validate_result  # noqa: E402

PROTOCOL = "digitus2-scan-v2"
ORIGIN = "https://marchalmaxim.github.io"
JOB_ID = re.compile(r"[a-f0-9]{32}")
BUSY_RETRY_SECONDS = 30
TIMEOUT_FAILURE = {"code": "recognition-timeout", "message": "Recognition timed out before a complete score was produced. Try a smaller music section or the original PDF."}
INVALID_FAILURE = {"code": "invalid-result", "message": "The recognizer produced an unusable result."}
UNKNOWN_FAILURE = {"code": "recognition-failed", "message": "The recognizer stopped before producing a complete score. Try the original PDF or a flatter, higher-resolution image."}
MIME = {".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf"}
# A scan's pages are tied together by the id the device sends in this header (issue 233).
KEEP_HEADER = "X-Digitus2-Keep"
# And a page by the id the device gives it, so a retaken or reordered page can be told apart.
PAGE_HEADER = "X-Digitus2-Page"
CASE_PATH = re.compile(r"/v1/cases/([a-f0-9]{32})")
CASE_HOURS = 1
MAX_REVIEW_BYTES = 64 * 1024
MAX_REVIEWS = 100
MAX_RECOGNITION_JSON = 256 * 1024
# A review waits this long at most for its scan's page writes; the reader never waits on a review.
DRAIN_SECONDS = 5
# A kept page's own writes are joined this long at most before its answer goes out, while the
# request still holds the CPU; the review's drain is the backstop.
SETTLE_SECONDS = 2
TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"


def keep_failed(name: str, error: BaseException):
    """Logs a write that failed: the object's file name, not the scan id; no content, no address."""
    print(json.dumps({"keepFailed": name.rsplit("/", 1)[-1], "error": type(error).__name__,
                      "status": getattr(error, "code", None)}), file=sys.stderr, flush=True)


class StorageWriter:
    """Writes one new object to a Cloud Storage bucket with the JSON API and the instance's own token."""
    def __init__(self, bucket: str, opener=urllib.request.urlopen, clock=time.monotonic):
        self.bucket, self.opener, self.clock = bucket, opener, clock
        self.cached: tuple[str, float] | None = None
        self.lock = threading.Lock()

    def token(self) -> str:
        """The run account's access token from the metadata server, kept until a minute before it expires."""
        with self.lock:
            if self.cached and self.cached[1] > self.clock():
                return self.cached[0]
            request = urllib.request.Request(TOKEN_URL, headers={"Metadata-Flavor": "Google"})
            with self.opener(request, timeout=10) as response:
                record = json.loads(response.read(64 * 1024))
            self.cached = record["access_token"], self.clock() + max(0, int(record.get("expires_in", 0)) - 60)
            return self.cached[0]

    def __call__(self, name: str, data: bytes, content_type: str):
        # ifGenerationMatch=0: the run account may create objects but not replace them, so a name
        # already taken fails here, in the log, instead of silently keeping the older object.
        query = urlencode({"uploadType": "media", "name": name, "ifGenerationMatch": "0"})
        request = urllib.request.Request(
            f"https://storage.googleapis.com/upload/storage/v1/b/{quote(self.bucket, safe='')}/o?{query}",
            data=data, method="POST",
            headers={"Authorization": f"Bearer {self.token()}", "Content-Type": content_type})
        with self.opener(request, timeout=60) as response:
            response.read()


class Keeper:
    """Keeps an opted-in device's scans as validation cases: cases/<UTC date>/<scan id>/<visit>/ in
    a bucket. The visit is the time in milliseconds of the first page this instance kept of the scan
    since it last forgot it, so a scan that comes back never reuses a name.

    Each page is page-<n> in arrival order within the visit, with its recognised MusicXML, the
    recogniser's recognition.json and the device's page id beside it; each review the device
    reports is review-<k>.json, the highest k the latest. Writes run in background threads; a
    failure is logged and ignored."""
    def __init__(self, writer, clock=time.time):
        self.writer, self.clock = writer, clock
        self.lock = threading.Lock()
        self.scans: dict[str, dict] = {}

    def _prune(self):
        cutoff = self.clock() - CASE_HOURS * 3600
        for scan_id in [s for s, scan in self.scans.items() if scan["seen"] <= cutoff]:
            del self.scans[scan_id]

    def page(self, scan_id: str) -> str:
        """The object name of this scan's next page, without extension."""
        with self.lock:
            self._prune()
            now = self.clock()
            # The folder's date is the visit's first page's, so a scan across midnight stays together.
            scan = self.scans.setdefault(scan_id, {
                "folder": f"cases/{time.strftime('%Y-%m-%d', time.gmtime(now))}/{scan_id}/{int(now * 1000)}",
                "pages": 0, "reviews": 0, "pending": []})
            scan["seen"] = now
            scan["pages"] += 1
            return f"{scan['folder']}/page-{scan['pages']}"

    def known(self, scan_id: str) -> bool:
        """True when this instance kept a page of the scan in the last hour."""
        with self.lock:
            self._prune()
            return scan_id in self.scans

    def write(self, scan_id: str, name: str, data: bytes, content_type: str):
        """Writes one object in a background thread; never raises."""
        thread = threading.Thread(target=self._write, args=(name, data, content_type), daemon=True)
        try:
            thread.start()
        except RuntimeError as error:
            keep_failed(name, error)
            return
        with self.lock:
            scan = self.scans.get(scan_id)
            if scan is not None:
                scan["pending"] = [t for t in scan["pending"] if t.is_alive()] + [thread]

    def settle(self, scan_id: str, seconds: float):
        """Waits at most `seconds` for the scan's writes under way."""
        with self.lock:
            scan = self.scans.get(scan_id)
            pending = list(scan["pending"]) if scan is not None else []
        deadline = time.monotonic() + seconds
        for thread in pending:
            thread.join(max(0, deadline - time.monotonic()))

    def _write(self, name, data, content_type):
        try:
            self.writer(name, data, content_type)
        except Exception as error:
            keep_failed(name, error)

    def review(self, scan_id: str, body: bytes) -> bool:
        """Keeps one review of a known scan, after its page writes; False when the scan has too many."""
        with self.lock:
            scan = self.scans.get(scan_id)
            if scan is None or scan["reviews"] >= MAX_REVIEWS:
                return False
            scan["reviews"] += 1
            # A reader still correcting keeps the scan known.
            scan["seen"] = self.clock()
            name = f"{scan['folder']}/review-{scan['reviews']}.json"
        # Cloud Run gives the instance CPU only while a request is in flight, so writes still under
        # way from the recognitions finish here, within this request, as far as the bound allows.
        self.settle(scan_id, DRAIN_SECONDS)
        self._write(name, body, "application/json")
        return True

    def drain(self):
        """Waits for every write under way (tests)."""
        with self.lock:
            pending = [t for scan in self.scans.values() for t in scan["pending"]]
        for thread in pending:
            thread.join()


class Limiter:
    """Recognitions per caller in a rolling window, kept in memory only."""
    def __init__(self, limit: int = 30, window: float = 3600, clock=time.monotonic):
        self.limit, self.window, self.clock = limit, window, clock
        self.hits: dict[str, deque] = {}
        self.lock = threading.Lock()

    def allow(self, key: str) -> tuple[bool, int]:
        """Record one recognition for key; (False, seconds until a slot frees) when over the limit."""
        with self.lock:
            now = self.clock()
            for other in list(self.hits):
                hits = self.hits[other]
                while hits and hits[0] <= now - self.window:
                    hits.popleft()
                if not hits:
                    del self.hits[other]
            hits = self.hits.setdefault(key, deque())
            if len(hits) >= self.limit:
                # The time left, as the window less the time gone: `hits[0] + window - now` rounds
                # up past the window when the sum crosses a power of two and the clock has not moved.
                return False, max(1, math.ceil(self.window - (now - hits[0])))
            hits.append(now)
            return True, 0

    def refund(self, key: str):
        """Give back the newest recognition of key, for an answer that started none."""
        with self.lock:
            hits = self.hits.get(key)
            if hits:
                hits.pop()
            if not hits:
                self.hits.pop(key, None)


class Service:
    """Runs one recognition at a time in the calling thread and removes its directory before answering."""
    review_metadata = LocalWorker.review_metadata

    def __init__(self, recognizer, root: Path, *, max_bytes=10 * 1024 * 1024, max_result_bytes=20 * 1024 * 1024, threads=None,
                 keeper: Keeper | None = None):
        self.recognizer = recognizer
        self.threads = threads
        self.keeper = keeper
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.max_bytes, self.max_result_bytes = max_bytes, max_result_bytes
        self.busy = threading.Lock()
        self.guard = threading.Lock()
        self.running: dict[str, threading.Event] = {}

    def metadata(self) -> dict:
        """The recogniser's static name, capabilities and warnings."""
        return self.review_metadata()

    def recognize(self, data: bytes, extension: str, job_id: str, keep: str | None = None,
                  page_id: str | None = None) -> tuple[int, dict]:
        """Recognise one upload and answer (status, body); one log line per call. With a keeper, a
        `keep` scan id keeps the page once its recognition has started, with the device's
        `page_id` when it sent one (Keeper)."""
        started, answer = time.monotonic(), None
        with self.guard:
            if job_id in self.running:
                answer = 409, {"error": "duplicate-job"}
            elif not self.busy.acquire(blocking=False):
                answer = 429, {"error": "busy"}
            else:
                self.running[job_id] = threading.Event()
        if answer is None:
            page = None
            if self.keeper is not None and keep is not None:
                # Written while the recognition runs, when the instance has the CPU. Keeping never
                # stands in the recognition's way, nor in the busy lock's release in _run.
                try:
                    page = keep, self.keeper.page(keep)
                    self.keeper.write(keep, page[1] + extension, data, MIME[extension])
                    if page_id is not None:
                        self.keeper.write(keep, f"{page[1]}-id.json", json.dumps({"page": page_id}).encode(),
                                          "application/json")
                except Exception as error:
                    keep_failed("page", error)
            answer = self._run(data, extension, job_id, page)
            if page is not None:
                # Cloud Run throttles the CPU once the answer is out, so the page's writes finish
                # first, as far as the bound allows; after the busy lock's release, so no reader waits.
                self.keeper.settle(page[0], SETTLE_SECONDS)
        body = answer[1]
        print(json.dumps({"kind": extension.lstrip("."), "bytesIn": len(data),
                          "bytesOut": len(body.get("xml", "").encode()),
                          "seconds": round(time.monotonic() - started, 3),
                          "outcome": body.get("state") or body.get("error")}), flush=True)
        return answer

    def _keep_record(self, page, directory):
        """Keeps the recogniser's recognition.json, when it wrote one, before the directory is removed."""
        if page is None or directory is None:
            return
        scan_id, name = page
        record = directory / "recognition.json"
        try:
            if record.is_file() and not record.is_symlink() and record.stat().st_size <= MAX_RECOGNITION_JSON:
                self.keeper.write(scan_id, f"{name}-recognition.json", record.read_bytes(), "application/json")
        except OSError as error:
            keep_failed(f"{name}-recognition.json", error)

    def _run(self, data, extension, job_id, page=None):
        """The recognition proper; the caller holds the busy lock, released here after cleanup."""
        cancelled, directory = self.running[job_id], None
        def failed(failure):
            return (409, {"state": "cancelled"}) if cancelled.is_set() else (422, {"state": "failed", "failure": failure})
        try:
            directory = Path(tempfile.mkdtemp(prefix="scan-", dir=self.root))
            source = directory / ("input" + extension)
            source.write_bytes(data)
            output = self.recognizer(source, directory, cancelled)
            try:
                raw = validate_result(output, directory, self.max_result_bytes)
                xml = raw.decode("utf-8-sig")
                if page is not None:
                    self.keeper.write(page[0], f"{page[1]}-recognized.musicxml", raw,
                                      "application/vnd.recordare.musicxml+xml")
                metadata = self.review_metadata(source, directory)
            except (OSError, ValueError):
                return failed(INVALID_FAILURE)
            if cancelled.is_set():
                return 409, {"state": "cancelled"}
            return 200, {"state": "ready", **metadata, "xml": xml}
        except InterruptedError:
            return 409, {"state": "cancelled"}
        except TimeoutError:
            return 504, {"state": "timed_out", "failure": TIMEOUT_FAILURE}
        except RecognitionError as error:
            return failed(error.public)
        except Exception:
            return failed(UNKNOWN_FAILURE)
        finally:
            self._keep_record(page, directory)
            if directory is not None:
                shutil.rmtree(directory, ignore_errors=True)
            with self.guard:
                del self.running[job_id]
                self.busy.release()

    def cancel(self, job_id: str) -> bool:
        """Signal the running job; False when no job of that id is running."""
        with self.guard:
            cancelled = self.running.get(job_id)
            if cancelled is None:
                return False
            cancelled.set()
            return True


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, service, origins, limiter):
        self.service, self.origins, self.limiter = service, frozenset(origins), limiter
        super().__init__(address, Handler)

    def get_request(self):
        connection, address = super().get_request()
        # Bounds each socket read and write, not the recognition, which runs between them.
        connection.settimeout(30)
        return connection, address

    def shutdown_request(self, request):
        # An early refusal (403, 413) must reach the caller although its body was never read.
        linger_close(request)

    def handle_error(self, request, address):
        """Name the failure's type only; the default handler would log the caller's address."""
        error = sys.exc_info()[1]
        if not isinstance(error, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, TimeoutError)):
            print(json.dumps({"handlerError": type(error).__name__}), file=sys.stderr, flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "Digitus2ScanService/2"
    sys_version = ""

    def log_message(self, *args):
        pass

    def send(self, status, data=None, *, extra=None):
        payload = json.dumps(data).encode() if data is not None else b""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        # Absent when the request line itself was malformed.
        origin = self.headers.get("Origin") if getattr(self, "headers", None) else None
        if origin in self.server.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.close_connection = True
        if payload:
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def send_error(self, code, message=None, explain=None):
        """The framework's own errors (unsupported method, malformed request) as JSON with the usual headers."""
        body = {"error": "not-found" if code in {404, 501} else "bad-request"}
        self.send(code, None if getattr(self, "command", None) == "HEAD" else body)

    def boundary(self, client_header=False):
        if len(self.headers.get_all("Origin", [])) != 1 or self.headers.get("Origin") not in self.server.origins:
            self.send(403, {"error": "origin-not-allowed"})
            return False
        if urlsplit(self.path).query or urlsplit(self.path).fragment:
            self.send(404, {"error": "not-found"})
            return False
        if client_header and self.headers.get("X-Digitus2-Client") != "1":
            self.send(403, {"error": "client-header-required"})
            return False
        return True

    def caller(self):
        forwarded = ",".join(self.headers.get_all("X-Forwarded-For", [])).split(",")[-1].strip()
        return forwarded or self.client_address[0]

    def do_OPTIONS(self):
        if not self.boundary():
            return
        requested = {s.strip().lower() for s in self.headers.get("Access-Control-Request-Headers", "").split(",") if s.strip()}
        if (self.headers.get("Access-Control-Request-Method") not in {"GET", "POST", "DELETE"} or
                not requested <= {"content-type", "x-digitus2-client", "x-digitus2-job", "x-digitus2-keep", "x-digitus2-page"}):
            self.send(403, {"error": "preflight-not-allowed"})
            return
        # Cached for a day (browsers cap it lower), so a page's POST seldom waits on a preflight.
        self.send(204, extra={"Access-Control-Allow-Methods": "GET, POST, DELETE",
                             "Access-Control-Allow-Headers": "Content-Type, X-Digitus2-Client, X-Digitus2-Job, X-Digitus2-Keep, X-Digitus2-Page",
                             "Access-Control-Max-Age": "86400"})

    def do_GET(self):
        if not self.boundary():
            return
        if self.path != "/v1/health":
            self.send(404, {"error": "not-found"})
            return
        self.send(200, {"protocol": PROTOCOL, **self.server.service.metadata(),
                        "maxUploadBytes": self.server.service.max_bytes, "threads": self.server.service.threads})

    def length(self):
        """The one plain Content-Length, or None after answering 411."""
        sizes = self.headers.get_all("Content-Length", [])
        if self.headers.get("Transfer-Encoding") or len(sizes) != 1 or len(sizes[0]) > 10 or not sizes[0].isdigit():
            self.send(411, {"error": "content-length-required"})
            return None
        return int(sizes[0])

    def do_POST(self):
        if not self.boundary(client_header=True):
            return
        case = CASE_PATH.fullmatch(self.path)
        if case:
            self.post_case(case[1])
            return
        if self.path != "/v1/recognize":
            self.send(404, {"error": "not-found"})
            return
        size = self.length()
        if size is None:
            return
        if not 0 < size <= self.server.service.max_bytes:
            self.send(413, {"error": "upload-too-large"})
            return
        mime = self.headers.get("Content-Type", "")
        if mime not in {"image/png", "image/jpeg", "application/pdf"} or self.headers.get("Content-Encoding"):
            self.send(415, {"error": "unsupported-input"})
            return
        try:
            data = self.rfile.read(size)
        except socket.timeout:
            self.send(408, {"error": "upload-timeout"})
            return
        valid = {"image/png": (data.startswith(b"\x89PNG\r\n\x1a\n"), ".png"),
                 "image/jpeg": (data.startswith(b"\xff\xd8\xff"), ".jpg"),
                 "application/pdf": (data.startswith(b"%PDF-"), ".pdf")}
        if len(data) != size or not valid[mime][0]:
            self.send(415, {"error": "unsupported-input"})
            return
        job_id = self.headers.get("X-Digitus2-Job", "")
        if len(self.headers.get_all("X-Digitus2-Job", [])) != 1 or not JOB_ID.fullmatch(job_id):
            self.send(400, {"error": "job-id-required"})
            return
        caller = self.caller()
        allowed, wait = self.server.limiter.allow(caller)
        if not allowed:
            self.send(429, {"error": "rate-limited"}, extra={"Retry-After": str(wait)})
            return
        # Anything but one valid scan id keeps nothing and changes nothing else.
        keeps = self.headers.get_all(KEEP_HEADER, [])
        keep = keeps[0] if len(keeps) == 1 and JOB_ID.fullmatch(keeps[0]) else None
        pages = self.headers.get_all(PAGE_HEADER, [])
        page_id = pages[0] if keep and len(pages) == 1 and JOB_ID.fullmatch(pages[0]) else None
        status, body = self.server.service.recognize(data, valid[mime][1], job_id, keep, page_id)
        if body.get("error") in {"busy", "duplicate-job"}:
            # The limit counts recognitions; an answer that started none does not use it up.
            self.server.limiter.refund(caller)
        self.send(status, body, extra={"Retry-After": str(BUSY_RETRY_SECONDS)} if body.get("error") == "busy" else None)

    def post_case(self, scan_id):
        """Keeps what the review told an opted-in reader about a scan this instance kept (issue 233)."""
        keeper = self.server.service.keeper
        if keeper is None:
            self.send(404, {"error": "not-found"})
            return
        size = self.length()
        if size is None:
            return
        if not 0 < size <= MAX_REVIEW_BYTES:
            self.send(413, {"error": "review-too-large"})
            return
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json" or self.headers.get("Content-Encoding"):
            self.send(415, {"error": "unsupported-input"})
            return
        try:
            data = self.rfile.read(size)
        except socket.timeout:
            self.send(408, {"error": "upload-timeout"})
            return
        try:
            review = json.loads(data) if len(data) == size else None
        except ValueError:
            review = None
        if not isinstance(review, dict):
            self.send(400, {"error": "invalid-review"})
            return
        if not keeper.known(scan_id):
            self.send(404, {"error": "unknown-scan"})
            return
        if not keeper.review(scan_id, json.dumps(review, ensure_ascii=False).encode()):
            self.send(429, {"error": "too-many-reviews"})
            return
        self.send(204)

    def do_DELETE(self):
        if not self.boundary(client_header=True):
            return
        match = re.fullmatch(r"/v1/jobs/([a-f0-9]{32})", self.path)
        if not match or not self.server.service.cancel(match[1]):
            self.send(404, {"error": "not-found"})
        else:
            self.send(200, {"id": match[1], "state": "cancelling"})


def valid_origin(origin):
    """An HTTPS origin, or an exact loopback HTTP origin with a port; no path, query or credentials."""
    parsed = urlsplit(origin)
    if parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        return False
    try:
        port = parsed.port
    except ValueError:
        return False
    return bool(parsed.hostname and (parsed.scheme == "https" or
                (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"} and port)))


def serve(service: Service, port: int, origins: set[str], limiter: Limiter, host: str = "0.0.0.0") -> ThreadingHTTPServer:
    """The HTTP front, bound but not yet serving."""
    if not origins or any(not valid_origin(origin) for origin in origins):
        raise ValueError("Explicit HTTPS or loopback development origins are required")
    return Server((host, port), service, origins, limiter)


def main():
    """Start the service with both recognisers, as the container runs it."""
    from audiveris import Audiveris
    from homr import Homr
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8080)))
    parser.add_argument("--root", type=Path, default=Path(tempfile.gettempdir()) / "digitus2-scan")
    parser.add_argument("--bundle", type=Path, required=True, help="Audiveris installation (PDFs)")
    parser.add_argument("--homr-toolchain", type=Path, required=True, help="Prepared pinned HOMR toolchain (images)")
    parser.add_argument("--text-models", type=Path, help="Pinned legacy-capable English tessdata directory")
    parser.add_argument("--short-staves", action="store_true", help="Experimental quality profile; always needs review")
    parser.add_argument("--timeout", type=float, default=180)
    parser.add_argument("--dev-origin", action="append", default=[], help="Exact loopback HTTP development origin; Pages remains allowed")
    parser.add_argument("--rate-limit", type=int, default=30, help="Recognitions per caller per rolling hour")
    parser.add_argument("--threads", type=int, default=None,
                        help=f"CPU threads for homr's ONNX Runtime and OpenCV; default {THREADS_VARIABLE}, else the container's CPU quota")
    args = parser.parse_args()
    if any(urlsplit(origin).scheme != "http" or urlsplit(origin).hostname not in {"127.0.0.1", "localhost"} for origin in args.dev_origin):
        parser.error("--dev-origin must be an exact HTTP loopback origin")
    if args.threads is None:
        args.threads = detect_threads()
    elif args.threads <= 0:
        parser.error("--threads must be positive")
    if args.threads is not None:
        # Before the recognisers are built: homr's child inherits the service's environment.
        os.environ[THREADS_VARIABLE] = str(args.threads)
    recognizer = PhotoPdfRecognizer(
        Audiveris(args.bundle, timeout=args.timeout, short_staves=args.short_staves, text_models=args.text_models),
        Homr(args.homr_toolchain, timeout=args.timeout))
    # Validation cases (issue 233): kept only with a bucket here and the device's opt-in header.
    bucket = os.environ.get("DIGITUS2_CASES_BUCKET", "").strip()
    keeper = Keeper(StorageWriter(bucket)) if bucket else None
    server = serve(Service(recognizer, args.root, threads=args.threads, keeper=keeper), args.port,
                   {ORIGIN, *args.dev_origin}, Limiter(limit=args.rate_limit))
    print(json.dumps({"listening": f"http://{server.server_address[0]}:{server.server_port}", "protocol": PROTOCOL,
                      "recognizer": recognizer.name, "threads": args.threads, "casesBucket": bucket or None}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
