"""Optional loopback research connector. HTTP success never certifies recognition."""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET
from recognition_errors import RecognitionError

ORIGIN = "https://marchalmaxim.github.io"
TERMINAL = {"ready", "failed", "cancelled", "timed_out"}


@dataclass
class Job:
    id: str
    directory: Path
    state: str = "running"
    created: float = field(default_factory=time.monotonic)
    finished: float | None = None
    cancelled: threading.Event = field(default_factory=threading.Event)
    result: bytes | None = None
    failure: dict | None = None
    thread: threading.Thread | None = None


class LocalWorker:
    def __init__(self, root, recognizer, *, max_bytes=10 * 1024 * 1024,
                 max_result_bytes=20 * 1024 * 1024, max_jobs=8, retention_seconds=300):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.recognizer = recognizer
        self.max_bytes = max_bytes
        self.max_result_bytes = max_result_bytes
        self.max_jobs = max_jobs
        self.retention_seconds = retention_seconds
        self.jobs: dict[str, Job] = {}
        self.lock = threading.RLock()
        self.closed = False

    def owned_directories(self):
        for marker in self.root.glob("scan-*/.digitus2-job.json"):
            if marker.parent.is_symlink():
                continue
            try:
                record = json.loads(marker.read_text(encoding="utf-8"))
                if record.get("protocol") == "digitus2-scan-v1" and isinstance(record.get("created"), (int, float)):
                    yield marker.parent, record
            except (OSError, ValueError):
                continue

    def expire(self):
        with self.lock:
            for identifier, job in list(self.jobs.items()):
                if job.finished is not None and time.monotonic() - job.finished >= self.retention_seconds:
                    if job.thread and job.thread.is_alive():
                        continue
                    shutil.rmtree(job.directory)
                    del self.jobs[identifier]
            # Recover bounded retention after an interrupted worker, without touching unrelated files.
            from audiveris import process_alive
            current = {job.directory for job in self.jobs.values()}
            for directory, record in list(self.owned_directories()):
                if (directory not in current and time.time() - record["created"] >= self.retention_seconds
                        and not process_alive(record.get("ownerPid"))):
                    shutil.rmtree(directory)

    def submit(self, data, extension):
        self.expire()
        with self.lock:
            if self.closed or any(j.state not in TERMINAL for j in self.jobs.values()):
                raise BlockingIOError("busy")
            if len(list(self.owned_directories())) >= self.max_jobs:
                raise BlockingIOError("retention-full")
            directory = Path(tempfile.mkdtemp(prefix="scan-", dir=self.root))
            job = Job(secrets.token_hex(16), directory)
            (directory / ".digitus2-job.json").write_text(json.dumps({
                "protocol": "digitus2-scan-v1", "ownerPid": os.getpid(), "created": time.time(),
            }), encoding="utf-8")
            source = directory / ("input" + extension)
            source.write_bytes(data)
            self.jobs[job.id] = job
            job.thread = threading.Thread(target=self._run, args=(job, source), daemon=True)
            job.thread.start()
            return job.id

    def _run(self, job, source):
        try:
            output = Path(self.recognizer(source, job.directory, job.cancelled)).resolve()
            if job.directory not in output.parents or output.is_symlink() or not output.is_file():
                raise ValueError("invalid output")
            if output.stat().st_size > self.max_result_bytes:
                raise ValueError("oversized output")
            data = output.read_bytes()
            if b"<!ENTITY" in data.upper():
                raise ValueError("XML entities are not accepted")
            xml = ET.fromstring(data)
            if xml.tag != "score-partwise":
                raise ValueError("not a partwise score")
            with self.lock:
                if job.cancelled.is_set():
                    job.state = "cancelled"
                else:
                    job.result, job.state = data, "ready"
        except InterruptedError:
            with self.lock:
                job.state = "cancelled"
        except TimeoutError:
            with self.lock:
                job.state = "timed_out"
                job.failure = {"code": "recognition-timeout", "message": "Recognition timed out before a complete score was produced. Try a smaller music section or the original PDF."}
        except RecognitionError as error:
            with self.lock:
                job.state = "cancelled" if job.cancelled.is_set() else "failed"
                job.failure = None if job.cancelled.is_set() else error.public
        except Exception:
            with self.lock:
                job.state = "cancelled" if job.cancelled.is_set() else "failed"
        finally:
            with self.lock:
                job.finished = time.monotonic()

    def status(self, identifier):
        self.expire()
        with self.lock:
            job = self.jobs.get(identifier)
            if job is None:
                return None
            return {"id": job.id, "state": job.state, **self.review_metadata(),
                    "error": job.failure["code"] if job.failure else {"failed": "recognition-failed", "timed_out": "recognition-timeout"}.get(job.state),
                    "failure": job.failure}

    def review_metadata(self):
        return {"needsReview": True, "recognizer": getattr(self.recognizer, "name", "test-recognizer"),
                "capabilities": getattr(self.recognizer, "capabilities", {}),
                "warnings": getattr(self.recognizer, "warnings", [])}

    def cancel(self, identifier):
        with self.lock:
            job = self.jobs.get(identifier)
            if job is None:
                return False
            job.cancelled.set()
            job.result = None
            if job.state in TERMINAL:
                job.state = "cancelled"
            else:
                job.state = "cancelling"
            return True

    def close(self):
        with self.lock:
            self.closed = True
            jobs = list(self.jobs.values())
            for job in jobs:
                job.cancelled.set()
        for job in jobs:
            if job.thread:
                job.thread.join(10)
            if job.thread and job.thread.is_alive():
                # A production recognizer must terminate its child process on cancellation.
                continue
            with self.lock:
                if self.jobs.pop(job.id, None):
                    shutil.rmtree(job.directory)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address, worker, origins):
        self.worker, self.origins = worker, frozenset(origins)
        self.slots = threading.BoundedSemaphore(4)
        super().__init__(address, Handler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(5)
        return connection, address

    def handle_error(self, request, address):
        if isinstance(sys.exc_info()[1], (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, TimeoutError)):
            return
        super().handle_error(request, address)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            # Give the peer a bounded chance to send its request before closing the socket;
            # otherwise Windows may reset it before the 503 can be read.
            request.settimeout(0.1)
            try:
                request.recv(8192)
            except (TimeoutError, ConnectionError):
                pass
            try:
                request.sendall(b"HTTP/1.1 503 Busy\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            except ConnectionError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "Digitus2LocalWorker/1"
    sys_version = ""

    def log_message(self, *args):
        pass

    def send(self, status, data=None, *, content_type="application/json", extra=None):
        payload = data if isinstance(data, bytes) else json.dumps(data).encode() if data is not None else b""
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        origin = self.headers.get("Origin")
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

    def boundary(self):
        port = self.server.server_port
        if (len(self.headers.get_all("Host", [])) != 1 or
                self.headers.get("Host") not in {f"127.0.0.1:{port}", f"localhost:{port}"}):
            self.send(403, {"error": "host-not-allowed"})
            return False
        if len(self.headers.get_all("Origin", [])) != 1 or self.headers.get("Origin") not in self.server.origins:
            self.send(403, {"error": "origin-not-allowed"})
            return False
        if urlsplit(self.path).query or urlsplit(self.path).fragment:
            self.send(404, {"error": "not-found"})
            return False
        return True

    def do_OPTIONS(self):
        if not self.boundary():
            return
        requested = {s.strip().lower() for s in self.headers.get("Access-Control-Request-Headers", "").split(",") if s.strip()}
        if (self.headers.get("Access-Control-Request-Method") not in {"GET", "POST", "DELETE"} or
                not requested <= {"content-type", "x-digitus2-client"}):
            self.send(403, {"error": "preflight-not-allowed"})
            return
        self.send(204, extra={"Access-Control-Allow-Methods": "GET, POST, DELETE",
                             "Access-Control-Allow-Headers": "Content-Type, X-Digitus2-Client",
                             "Access-Control-Allow-Private-Network": "true"})

    def do_GET(self):
        if not self.boundary():
            return
        if self.path == "/v1/health":
            self.send(200, {"protocol": "digitus2-scan-v1", **self.server.worker.review_metadata(),
                            "maxUploadBytes": self.server.worker.max_bytes, "concurrency": 1,
                            })
            return
        match = re.fullmatch(r"/v1/jobs/([a-zA-Z0-9-]+)(/result)?", self.path)
        if not match or (status := self.server.worker.status(match[1])) is None:
            self.send(404, {"error": "not-found"})
        elif not match[2]:
            self.send(200, status)
        else:
            with self.server.worker.lock:
                job = self.server.worker.jobs.get(match[1])
                if job is None or job.state != "ready" or job.result is None:
                    self.send(409, {"error": "result-not-ready"})
                else:
                    self.send(200, job.result, content_type="application/vnd.recordare.musicxml+xml")

    def do_POST(self):
        if not self.boundary():
            return
        if self.path != "/v1/jobs":
            self.send(404, {"error": "not-found"})
            return
        if self.headers.get("X-Digitus2-Client") != "1":
            self.send(403, {"error": "client-header-required"})
            return
        sizes = self.headers.get_all("Content-Length", [])
        if self.headers.get("Transfer-Encoding") or len(sizes) != 1 or len(sizes[0]) > 10 or not sizes[0].isdigit():
            self.send(411, {"error": "content-length-required"})
            return
        size = int(sizes[0])
        if not 0 < size <= self.server.worker.max_bytes:
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
        try:
            identifier = self.server.worker.submit(data, valid[mime][1])
            self.send(202, {"id": identifier, "state": "running", **self.server.worker.review_metadata()})
        except BlockingIOError:
            self.send(409, {"error": "busy-or-retention-full"})

    def do_DELETE(self):
        if not self.boundary():
            return
        if self.headers.get("X-Digitus2-Client") != "1":
            self.send(403, {"error": "client-header-required"})
            return
        match = re.fullmatch(r"/v1/jobs/([a-zA-Z0-9-]+)", self.path)
        if not match or not self.server.worker.cancel(match[1]):
            self.send(404, {"error": "not-found"})
        else:
            self.send(200, {"id": match[1], "state": "cancelling", "needsReview": True})


def serve(worker, port=8996, origins=frozenset({ORIGIN})):
    def valid_origin(origin):
        parsed = urlsplit(origin)
        if parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            return False
        try:
            port = parsed.port
        except ValueError:
            return False
        return bool(parsed.hostname and (parsed.scheme == "https" or
                    (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"} and port)))
    if not origins or any(not valid_origin(origin) for origin in origins):
        raise ValueError("Explicit HTTPS or loopback development origins are required")
    return Server(("127.0.0.1", port), worker, origins)


def main():
    from audiveris import Audiveris
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8996)
    parser.add_argument("--root", type=Path, default=Path("research/omr/results/connector-wave/jobs"))
    parser.add_argument("--bundle", type=Path, default=Path("research/omr/results/audiveris-spike"))
    parser.add_argument("--timeout", type=float, default=180)
    parser.add_argument("--short-staves", action="store_true", help="Experimental quality profile; always needs review")
    parser.add_argument("--text-models", type=Path, help="Optional pinned legacy-capable English tessdata directory")
    parser.add_argument("--dev-origin", action="append", default=[], help="Exact loopback HTTP development origin; Pages remains allowed")
    args = parser.parse_args()
    if any(urlsplit(origin).scheme != "http" or urlsplit(origin).hostname not in {"127.0.0.1", "localhost"} for origin in args.dev_origin):
        parser.error("--dev-origin must be an exact HTTP loopback origin")
    recognizer = Audiveris(args.bundle, timeout=args.timeout, short_staves=args.short_staves, text_models=args.text_models)
    worker = LocalWorker(args.root, recognizer)
    server = serve(worker, args.port, {ORIGIN, *args.dev_origin})
    stopping = threading.Event()
    def expire():
        while not stopping.wait(10):
            worker.expire()
    threading.Thread(target=expire, daemon=True).start()
    print(json.dumps({"listening": f"http://127.0.0.1:{server.server_port}", "origin": ORIGIN,
                      "recognizer": recognizer.name, "needsReview": True}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stopping.set()
        server.server_close()
        worker.close()


if __name__ == "__main__":
    main()
