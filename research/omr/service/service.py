"""Hosted scan service: one synchronous recognition per request; nothing is kept after the answer."""
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
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prototypes" / "local-worker"))
from recognition_errors import RecognitionError  # noqa: E402
from worker import LocalWorker, PhotoPdfRecognizer, validate_result  # noqa: E402

PROTOCOL = "digitus2-scan-v2"
ORIGIN = "https://marchalmaxim.github.io"
JOB_ID = re.compile(r"[a-f0-9]{32}")
BUSY_RETRY_SECONDS = 30
TIMEOUT_FAILURE = {"code": "recognition-timeout", "message": "Recognition timed out before a complete score was produced. Try a smaller music section or the original PDF."}
INVALID_FAILURE = {"code": "invalid-result", "message": "The recognizer produced an unusable result."}
UNKNOWN_FAILURE = {"code": "recognition-failed", "message": "The recognizer stopped before producing a complete score. Try the original PDF or a flatter, higher-resolution image."}


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
                return False, max(1, math.ceil(hits[0] + self.window - now))
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

    def __init__(self, recognizer, root: Path, *, max_bytes=10 * 1024 * 1024, max_result_bytes=20 * 1024 * 1024):
        self.recognizer = recognizer
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.max_bytes, self.max_result_bytes = max_bytes, max_result_bytes
        self.busy = threading.Lock()
        self.guard = threading.Lock()
        self.running: dict[str, threading.Event] = {}

    def metadata(self) -> dict:
        """The recogniser's static name, capabilities and warnings."""
        return self.review_metadata()

    def recognize(self, data: bytes, extension: str, job_id: str) -> tuple[int, dict]:
        """Recognise one upload and answer (status, body); one log line per call."""
        started, answer = time.monotonic(), None
        with self.guard:
            if job_id in self.running:
                answer = 409, {"error": "duplicate-job"}
            elif not self.busy.acquire(blocking=False):
                answer = 429, {"error": "busy"}
            else:
                self.running[job_id] = threading.Event()
        if answer is None:
            answer = self._run(data, extension, job_id)
        body = answer[1]
        print(json.dumps({"kind": extension.lstrip("."), "bytesIn": len(data),
                          "bytesOut": len(body.get("xml", "").encode()),
                          "seconds": round(time.monotonic() - started, 3),
                          "outcome": body.get("state") or body.get("error")}), flush=True)
        return answer

    def _run(self, data, extension, job_id):
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
                xml = validate_result(output, directory, self.max_result_bytes).decode("utf-8-sig")
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
                not requested <= {"content-type", "x-digitus2-client", "x-digitus2-job"}):
            self.send(403, {"error": "preflight-not-allowed"})
            return
        self.send(204, extra={"Access-Control-Allow-Methods": "GET, POST, DELETE",
                             "Access-Control-Allow-Headers": "Content-Type, X-Digitus2-Client, X-Digitus2-Job"})

    def do_GET(self):
        if not self.boundary():
            return
        if self.path != "/v1/health":
            self.send(404, {"error": "not-found"})
            return
        self.send(200, {"protocol": PROTOCOL, **self.server.service.metadata(),
                        "maxUploadBytes": self.server.service.max_bytes})

    def do_POST(self):
        if not self.boundary(client_header=True):
            return
        if self.path != "/v1/recognize":
            self.send(404, {"error": "not-found"})
            return
        sizes = self.headers.get_all("Content-Length", [])
        if self.headers.get("Transfer-Encoding") or len(sizes) != 1 or len(sizes[0]) > 10 or not sizes[0].isdigit():
            self.send(411, {"error": "content-length-required"})
            return
        size = int(sizes[0])
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
        status, body = self.server.service.recognize(data, valid[mime][1], job_id)
        if body.get("error") in {"busy", "duplicate-job"}:
            # The limit counts recognitions; an answer that started none does not use it up.
            self.server.limiter.refund(caller)
        self.send(status, body, extra={"Retry-After": str(BUSY_RETRY_SECONDS)} if body.get("error") == "busy" else None)

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
    args = parser.parse_args()
    if any(urlsplit(origin).scheme != "http" or urlsplit(origin).hostname not in {"127.0.0.1", "localhost"} for origin in args.dev_origin):
        parser.error("--dev-origin must be an exact HTTP loopback origin")
    recognizer = PhotoPdfRecognizer(
        Audiveris(args.bundle, timeout=args.timeout, short_staves=args.short_staves, text_models=args.text_models),
        Homr(args.homr_toolchain, timeout=args.timeout))
    server = serve(Service(recognizer, args.root), args.port, {ORIGIN, *args.dev_origin}, Limiter(limit=args.rate_limit))
    print(json.dumps({"listening": f"http://{server.server_address[0]}:{server.server_port}", "protocol": PROTOCOL,
                      "recognizer": recognizer.name}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
