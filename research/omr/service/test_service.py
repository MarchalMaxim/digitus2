"""Synchronous scan service tests; simulated recognition is not OMR evidence."""
import http.client
import json
import secrets
import socket
import threading
import time
import pytest
from service import Limiter, Service, serve
from recognition_errors import RecognitionError

ORIGIN = "https://marchalmaxim.github.io"
PNG = b"\x89PNG\r\n\x1a\n" + b"test-input"

class Recognizer:
    def __init__(self):
        self.inputs = []
        self.block = threading.Event()
        self.block.set()
    def __call__(self, source, destination, cancelled):
        self.inputs.append(source.read_bytes())
        while not self.block.wait(0.01):
            if cancelled.is_set():
                raise InterruptedError("Cancelled")
        output = destination / "score.musicxml"
        output.write_bytes(b"<?xml version='1.0'?><score-partwise/>")
        return output

@pytest.fixture
def api(tmp_path):
    recognizer = Recognizer()
    service = Service(recognizer, tmp_path, max_bytes=64)
    server = serve(service, 0, {ORIGIN}, Limiter(limit=2), host="127.0.0.1")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server, service, recognizer
    recognizer.block.set()
    server.shutdown()
    server.server_close()
    thread.join(2)

def request(api, method, path, body=None, headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", api[0].server_port, timeout=10)
    actual = {"Origin": ORIGIN, **(headers or {})}
    if method in {"POST", "DELETE"}:
        actual.setdefault("X-Digitus2-Client", "1")
    if method == "POST":
        actual.setdefault("X-Digitus2-Job", secrets.token_hex(16))
    if body is not None:
        actual.setdefault("Content-Type", "image/png")
    connection.request(method, path, body, {k: v for k, v in actual.items() if v is not None})
    response = connection.getresponse()
    result = response.status, dict(response.getheaders()), response.read()
    connection.close()
    return result

def in_thread(call):
    outcome = {}
    thread = threading.Thread(target=lambda: outcome.setdefault("result", call()), daemon=True)
    thread.start()
    return thread, outcome

def wait_running(recognizer):
    deadline = time.monotonic() + 3
    while not recognizer.inputs:
        if time.monotonic() > deadline:
            pytest.fail("The recognition did not start")
        time.sleep(0.01)

def test_health_names_the_protocol_and_the_upload_limit(api):
    status, headers, body = request(api, "GET", "/v1/health")
    assert status == 200
    assert headers["Access-Control-Allow-Origin"] == ORIGIN
    assert headers["Cache-Control"] == "no-store"
    assert headers["X-Content-Type-Options"] == "nosniff"
    body = json.loads(body)
    assert body["protocol"] == "digitus2-scan-v2"
    assert body["maxUploadBytes"] == 64
    assert body["needsReview"] is True
    assert body["threads"] is None

def test_health_names_the_thread_budget(api):
    api[1].threads = 4
    body = json.loads(request(api, "GET", "/v1/health")[2])
    assert body["threads"] == 4
    assert "threads" not in api[1].metadata()

def test_the_thread_budget_is_a_service_setting(tmp_path):
    assert Service(Recognizer(), tmp_path, threads=4).threads == 4
    assert Service(Recognizer(), tmp_path).threads is None

def test_recognize_answers_the_xml_with_metadata_and_keeps_nothing(api, tmp_path, capsys):
    status, headers, body = request(api, "POST", "/v1/recognize", PNG)
    assert status == 200
    assert headers["Access-Control-Allow-Origin"] == ORIGIN
    body = json.loads(body)
    assert body["state"] == "ready"
    assert body["xml"].startswith("<?xml")
    assert body["needsReview"] is True
    assert api[2].inputs == [PNG]
    assert not list(tmp_path.glob("scan-*"))
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert lines == [{"kind": "png", "bytesIn": len(PNG), "bytesOut": len(body["xml"]),
                      "seconds": lines[0]["seconds"], "outcome": "ready"}]

def test_a_public_failure_is_422(api, tmp_path):
    def fail(source, destination, cancelled):
        raise RecognitionError("staff-resolution-too-low", "The staff lines are too close.", {"interlinePixels": 6})
    api[1].recognizer = fail
    status, _, body = request(api, "POST", "/v1/recognize", PNG)
    assert status == 422
    body = json.loads(body)
    assert body["state"] == "failed"
    assert body["failure"]["code"] == "staff-resolution-too-low"
    assert not list(tmp_path.glob("scan-*"))

def test_an_unexpected_failure_hides_its_text(api):
    def crash(source, destination, cancelled):
        raise RuntimeError("private C:/Users/name/input.png")
    api[1].recognizer = crash
    status, _, body = request(api, "POST", "/v1/recognize", PNG)
    assert status == 422
    assert json.loads(body)["failure"]["code"] == "recognition-failed"
    assert b"private" not in body

def test_a_timeout_is_504(api):
    def timeout(*args):
        raise TimeoutError("private path")
    api[1].recognizer = timeout
    status, _, body = request(api, "POST", "/v1/recognize", PNG)
    assert status == 504
    body = json.loads(body)
    assert body["state"] == "timed_out"
    assert body["failure"]["code"] == "recognition-timeout"

def test_an_unusable_result_is_422_invalid_result(api):
    def bad(source, destination, cancelled):
        output = destination / "bad.musicxml"
        output.write_bytes(b"<!DOCTYPE x [<!ENTITY a 'b'>]><score-partwise/>")
        return output
    api[1].recognizer = bad
    status, _, body = request(api, "POST", "/v1/recognize", PNG)
    assert status == 422
    assert json.loads(body)["failure"]["code"] == "invalid-result"

def test_a_second_recognition_is_busy_with_retry_after(api):
    api[2].block.clear()
    thread, first = in_thread(lambda: request(api, "POST", "/v1/recognize", PNG))
    wait_running(api[2])
    status, headers, body = request(api, "POST", "/v1/recognize", PNG)
    assert status == 429
    assert json.loads(body) == {"error": "busy"}
    assert int(headers["Retry-After"]) > 0
    api[2].block.set()
    thread.join(5)
    assert first["result"][0] == 200

def test_cancel_stops_the_running_job_and_the_post_answers_409(api, tmp_path):
    job = secrets.token_hex(16)
    api[2].block.clear()
    thread, first = in_thread(lambda: request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Job": job}))
    wait_running(api[2])
    status, _, body = request(api, "DELETE", f"/v1/jobs/{job}")
    assert status == 200
    assert json.loads(body) == {"id": job, "state": "cancelling"}
    thread.join(5)
    assert first["result"][0] == 409
    assert json.loads(first["result"][2]) == {"state": "cancelled"}
    assert not list(tmp_path.glob("scan-*"))
    assert request(api, "DELETE", f"/v1/jobs/{job}")[0] == 404
    assert request(api, "DELETE", f"/v1/jobs/{secrets.token_hex(16)}")[0] == 404

def test_the_limiter_keys_on_the_last_forwarded_address(api):
    for _ in range(2):
        assert request(api, "POST", "/v1/recognize", PNG, {"X-Forwarded-For": "9.9.9.9, 1.1.1.1"})[0] == 200
    status, headers, body = request(api, "POST", "/v1/recognize", PNG, {"X-Forwarded-For": "8.8.8.8, 1.1.1.1"})
    assert status == 429
    assert json.loads(body) == {"error": "rate-limited"}
    assert 0 < int(headers["Retry-After"]) <= 3600
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Forwarded-For": "1.1.1.1, 2.2.2.2"})[0] == 200

def test_busy_and_duplicate_answers_do_not_use_up_the_limit(api):
    forwarded = {"X-Forwarded-For": "1.1.1.1"}
    job = secrets.token_hex(16)
    api[2].block.clear()
    thread, first = in_thread(lambda: request(api, "POST", "/v1/recognize", PNG, {**forwarded, "X-Digitus2-Job": job}))
    wait_running(api[2])
    assert json.loads(request(api, "POST", "/v1/recognize", PNG, forwarded)[2]) == {"error": "busy"}
    assert json.loads(request(api, "POST", "/v1/recognize", PNG, {**forwarded, "X-Digitus2-Job": job})[2]) == {"error": "duplicate-job"}
    api[2].block.set()
    thread.join(5)
    assert first["result"][0] == 200
    assert request(api, "POST", "/v1/recognize", PNG, forwarded)[0] == 200
    status, _, body = request(api, "POST", "/v1/recognize", PNG, forwarded)
    assert (status, json.loads(body)) == (429, {"error": "rate-limited"})

def test_the_limiter_window_rolls():
    now = [1000.0]
    limiter = Limiter(limit=2, window=60, clock=lambda: now[0])
    assert limiter.allow("a") == (True, 0)
    now[0] += 10
    assert limiter.allow("a") == (True, 0)
    assert limiter.allow("a") == (False, 50)
    assert limiter.allow("b") == (True, 0)
    now[0] += 50
    assert limiter.allow("a") == (True, 0)

def test_the_wait_never_exceeds_the_window_on_a_coarse_clock():
    # Windows' monotonic clock ticks coarsely, so a refused request often reads the same instant
    # as the first hit; 6000.7 + 3600 crosses a power of two and rounds up (Retry-After 3601).
    limiter = Limiter(limit=1, window=3600, clock=lambda: 6000.7)
    assert limiter.allow("a") == (True, 0)
    assert limiter.allow("a") == (False, 3600)

@pytest.mark.parametrize("origin", [None, "null", "https://evil.example", ORIGIN + ".evil.example"])
def test_origin_and_client_header_are_required(api, origin):
    for method, path in [("GET", "/v1/health"), ("POST", "/v1/recognize"), ("DELETE", f"/v1/jobs/{'a' * 32}")]:
        status, headers, _ = request(api, method, path, PNG if method == "POST" else None, {"Origin": origin})
        assert status == 403
        assert "Access-Control-Allow-Origin" not in headers
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Client": None})[0] == 403
    assert request(api, "DELETE", f"/v1/jobs/{'a' * 32}", headers={"X-Digitus2-Client": None})[0] == 403
    assert api[2].inputs == []
    preflight = {"Access-Control-Request-Method": "POST",
                 "Access-Control-Request-Headers": "content-type,x-digitus2-client,x-digitus2-job"}
    status, headers, _ = request(api, "OPTIONS", "/v1/recognize", headers=preflight)
    assert status == 204
    assert headers["Access-Control-Allow-Origin"] == ORIGIN
    assert headers["Access-Control-Allow-Methods"] == "GET, POST, DELETE"
    assert headers["Access-Control-Allow-Headers"] == "Content-Type, X-Digitus2-Client, X-Digitus2-Job"
    # A cached preflight spares each page one round trip; browsers cap the day at their own limit.
    assert headers["Access-Control-Max-Age"] == "86400"
    preflight["Access-Control-Request-Headers"] = "x-arbitrary"
    assert request(api, "OPTIONS", "/v1/recognize", headers=preflight)[0] == 403

def test_origins_refused_before_the_body_arrives_still_read_the_answer(api):
    # Closing a socket with unread data resets it, and the reset would discard the 403.
    port = api[0].server_port
    with socket.create_connection(("127.0.0.1", port), timeout=3) as client:
        client.sendall(f"POST /v1/recognize HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://evil.example\r\n"
                       f"X-Digitus2-Client: 1\r\nX-Digitus2-Job: {'a' * 32}\r\nContent-Type: image/png\r\n"
                       f"Content-Length: {len(PNG)}\r\n\r\n".encode())
        time.sleep(0.2)
        client.sendall(PNG)
        time.sleep(0.2)
        answer = b""
        while chunk := client.recv(4096):
            answer += chunk
    assert answer.split(b" ", 2)[1] == b"403"
    assert b'"origin-not-allowed"' in answer
    assert api[2].inputs == []

def test_the_job_id_must_be_32_hex_and_unused(api):
    for job in [None, "abc", "A" * 32]:
        status, _, body = request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Job": job})
        assert (status, json.loads(body)) == (400, {"error": "job-id-required"})
    job = secrets.token_hex(16)
    api[2].block.clear()
    thread, first = in_thread(lambda: request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Job": job}))
    wait_running(api[2])
    status, _, body = request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Job": job})
    assert (status, json.loads(body)) == (409, {"error": "duplicate-job"})
    api[2].block.set()
    thread.join(5)
    assert first["result"][0] == 200
    assert api[2].inputs == [PNG]

@pytest.mark.parametrize("body,headers,expected", [
    (b"x" * 65, {}, 413),
    (PNG, {"Content-Type": "text/plain"}, 415),
    (b"\xff\xd8\xff" + b"jpeg", {}, 415),
    (PNG, {"Content-Encoding": "gzip"}, 415),
    (None, {"Transfer-Encoding": "chunked", "Content-Type": "image/png"}, 411),
])
def test_upload_checks(api, body, headers, expected):
    assert request(api, "POST", "/v1/recognize", body, headers)[0] == expected
    assert api[2].inputs == []

def test_unknown_paths_and_queries_are_not_found(api):
    assert request(api, "GET", "/v1/health?anything=1")[0] == 404
    assert request(api, "POST", "/v1/jobs", PNG)[0] == 404
    assert request(api, "DELETE", "/v1/jobs/not-a-job")[0] == 404

def test_an_unsupported_method_answers_json_with_the_usual_headers(api):
    status, headers, body = request(api, "PUT", "/v1/recognize", PNG)
    assert status == 501
    assert headers["Content-Type"] == "application/json"
    assert headers["Cache-Control"] == "no-store"
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Access-Control-Allow-Origin"] == ORIGIN
    assert json.loads(body) == {"error": "not-found"}
