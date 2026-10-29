"""Synchronous scan service tests; simulated recognition is not OMR evidence."""
import http.client
import json
import secrets
import socket
import threading
import time
import pytest
from service import Keeper, Limiter, Service, StorageWriter, serve
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
                 "Access-Control-Request-Headers": "content-type,x-digitus2-client,x-digitus2-job,x-digitus2-keep"}
    status, headers, _ = request(api, "OPTIONS", "/v1/recognize", headers=preflight)
    assert status == 204
    assert headers["Access-Control-Allow-Origin"] == ORIGIN
    assert headers["Access-Control-Allow-Methods"] == "GET, POST, DELETE"
    assert headers["Access-Control-Allow-Headers"] == "Content-Type, X-Digitus2-Client, X-Digitus2-Job, X-Digitus2-Keep, X-Digitus2-Page"
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


class Storage:
    """A fake bucket: the objects written, by name, in the order written. While `gate` is clear,
    a page's writes wait for it, as a write starved of CPU would; reviews never wait."""
    def __init__(self):
        self.objects = {}
        self.order = []
        self.lock = threading.Lock()
        self.fail = False
        self.gate = threading.Event()
        self.gate.set()
    def __call__(self, name, data, content_type):
        if "/review-" not in name:
            self.gate.wait(10)
        if self.fail:
            raise OSError("storage unavailable")
        with self.lock:
            assert name not in self.objects, "an object is never replaced"
            self.objects[name] = (data, content_type)
            self.order.append(name)

class Recording(Recognizer):
    """Writes recognition.json beside the score, as homr does."""
    def __call__(self, source, destination, cancelled):
        (destination / "recognition.json").write_text('{"warnings": []}', encoding="utf-8")
        return super().__call__(source, destination, cancelled)

@pytest.fixture
def kept(tmp_path):
    recognizer, storage = Recording(), Storage()
    # 2024-10-04 01:00 UTC.
    now = [86400 * 20000 + 3600.0]
    keeper = Keeper(storage, clock=lambda: now[0])
    server = serve(Service(recognizer, tmp_path, max_bytes=64, keeper=keeper), 0, {ORIGIN}, Limiter(limit=10), host="127.0.0.1")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield (server, server.service, recognizer), keeper, storage, now
    storage.gate.set()
    recognizer.block.set()
    server.shutdown()
    server.server_close()
    thread.join(2)

SCAN = "0123456789abcdef0123456789abcdef"
PAGE = "fedcba9876543210fedcba9876543210"
# A visit's folder: the day and the millisecond of its first page (the fixture's clock).
FOLDER = f"cases/2024-10-04/{SCAN}/1728003600000"
JPEG = b"\xff\xd8\xff" + b"jpeg"
REVIEW = {"verdict": "Ready", "usable": True, "technical": [], "places": [], "corrections": 0}

def review(api, scan, body, headers=None):
    data = body if isinstance(body, bytes) else json.dumps(body).encode()
    return request(api, "POST", f"/v1/cases/{scan}", data, {"Content-Type": "application/json", **(headers or {})})

def reviews(storage):
    return sorted(name for name in storage.objects if "/review-" in name)

def test_an_opted_in_scan_keeps_each_page_with_its_recognition(kept):
    api, keeper, storage, _ = kept
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    assert request(api, "POST", "/v1/recognize", JPEG, {"X-Digitus2-Keep": SCAN, "Content-Type": "image/jpeg"})[0] == 200
    keeper.drain()
    assert sorted(storage.objects) == sorted(f"{FOLDER}/page-{n}{suffix}" for n, ext in [(1, ".png"), (2, ".jpg")]
                                             for suffix in [ext, "-recognition.json", "-recognized.musicxml"])
    assert storage.objects[f"{FOLDER}/page-1.png"] == (PNG, "image/png")
    assert storage.objects[f"{FOLDER}/page-2.jpg"] == (JPEG, "image/jpeg")
    assert storage.objects[f"{FOLDER}/page-1-recognized.musicxml"][0] == b"<?xml version='1.0'?><score-partwise/>"
    assert storage.objects[f"{FOLDER}/page-2-recognition.json"] == (b'{"warnings": []}', "application/json")

def test_a_scan_across_midnight_stays_in_its_first_days_folder(kept):
    api, keeper, storage, now = kept
    now[0] -= 3601
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    now[0] += 120
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    keeper.drain()
    assert {name.rsplit("/", 1)[0] for name in storage.objects} == {f"cases/2024-10-03/{SCAN}/1727999999000"}
    assert f"cases/2024-10-03/{SCAN}/1727999999000/page-2.png" in storage.objects

def test_a_scan_that_comes_back_after_it_was_forgotten_keeps_its_pages_in_a_new_visit(kept, capsys):
    api, keeper, storage, now = kept
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    now[0] += 3601
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    assert review(api, SCAN, REVIEW)[0] == 204
    keeper.drain()
    later = f"cases/2024-10-04/{SCAN}/1728007201000"
    assert {name.rsplit("/", 1)[0] for name in storage.objects} == {FOLDER, later}
    assert {f"{FOLDER}/page-1.png", f"{later}/page-1.png", f"{later}/review-1.json"} <= set(storage.objects)
    assert "keepFailed" not in capsys.readouterr().err

def test_a_review_keeps_the_scan_known(kept):
    api, keeper, storage, now = kept
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    now[0] += 3000
    assert review(api, SCAN, REVIEW)[0] == 204
    now[0] += 3000
    assert review(api, SCAN, {**REVIEW, "corrections": 1})[0] == 204
    assert reviews(storage) == [f"{FOLDER}/review-1.json", f"{FOLDER}/review-2.json"]

def test_the_page_id_the_device_sends_is_kept_beside_the_page(kept):
    api, keeper, storage, _ = kept
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN, "X-Digitus2-Page": PAGE})[0] == 200
    for page in [None, "abc", PAGE.upper()]:
        assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN, "X-Digitus2-Page": page})[0] == 200
    # Without the keep header the page id keeps nothing either.
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Page": PAGE})[0] == 200
    keeper.drain()
    assert storage.objects[f"{FOLDER}/page-1-id.json"] == (json.dumps({"page": PAGE}).encode(), "application/json")
    assert [name for name in storage.objects if name.endswith("-id.json")] == [f"{FOLDER}/page-1-id.json"]
    assert len([name for name in storage.objects if name.endswith(".png")]) == 4

@pytest.mark.parametrize("keep", [None, "", "abc", SCAN.upper(), SCAN + "0"])
def test_without_a_valid_keep_header_nothing_is_kept(kept, keep):
    api, keeper, storage, _ = kept
    status, _, body = request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": keep})
    assert status == 200 and json.loads(body)["state"] == "ready"
    keeper.drain()
    assert storage.objects == {}
    assert not keeper.known(SCAN)

def test_without_a_bucket_the_keep_header_keeps_nothing(api, tmp_path):
    assert api[1].keeper is None
    status, _, body = request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})
    assert status == 200 and json.loads(body)["state"] == "ready"
    assert not list(tmp_path.glob("scan-*"))
    status, _, body = review(api, SCAN, REVIEW)
    assert (status, json.loads(body)) == (404, {"error": "not-found"})

def test_a_busy_or_refused_offer_keeps_no_page(kept):
    api, keeper, storage, _ = kept
    api[2].block.clear()
    thread, first = in_thread(lambda: request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN}))
    wait_running(api[2])
    other = "f" * 32
    assert json.loads(request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": other})[2]) == {"error": "busy"}
    assert request(api, "POST", "/v1/recognize", b"x" * 65, {"X-Digitus2-Keep": other})[0] == 413
    api[2].block.set()
    thread.join(5)
    assert first["result"][0] == 200
    keeper.drain()
    assert not keeper.known(other)
    assert [name for name in storage.objects if name.endswith((".png", ".jpg"))] == [f"{FOLDER}/page-1.png"]

def test_a_failed_recognition_keeps_the_page_without_a_score(kept):
    api, keeper, storage, _ = kept
    def fail(source, destination, cancelled):
        raise RecognitionError("staff-resolution-too-low", "The staff lines are too close.", {})
    api[1].recognizer = fail
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 422
    keeper.drain()
    assert sorted(storage.objects) == [f"{FOLDER}/page-1.png"]

def test_a_storage_failure_is_logged_and_the_reader_still_gets_the_answer(kept, capsys):
    api, keeper, storage, _ = kept
    storage.fail = True
    status, _, body = request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})
    assert status == 200 and json.loads(body)["state"] == "ready"
    keeper.drain()
    errors = [json.loads(line) for line in capsys.readouterr().err.splitlines()]
    assert {e["keepFailed"] for e in errors} == {"page-1.png", "page-1-recognized.musicxml", "page-1-recognition.json"}
    assert all(SCAN not in json.dumps(e) for e in errors)

def test_a_review_is_kept_for_a_known_scan_only(kept):
    api, keeper, storage, _ = kept
    status, _, body = review(api, SCAN, REVIEW)
    assert (status, json.loads(body)) == (404, {"error": "unknown-scan"})
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    assert review(api, SCAN, REVIEW)[0] == 204
    assert review(api, SCAN, {**REVIEW, "corrections": 1})[0] == 204
    assert reviews(storage) == [f"{FOLDER}/review-1.json", f"{FOLDER}/review-2.json"]
    assert json.loads(storage.objects[f"{FOLDER}/review-1.json"][0]) == REVIEW
    assert storage.objects[f"{FOLDER}/review-2.json"][1] == "application/json"
    assert json.loads(storage.objects[f"{FOLDER}/review-2.json"][0])["corrections"] == 1

def test_the_page_writes_finish_before_the_answer_as_far_as_the_bound_allows(kept, monkeypatch):
    import service
    monkeypatch.setattr(service, "SETTLE_SECONDS", 0.3)
    api, keeper, storage, _ = kept
    storage.gate.clear()
    started = time.monotonic()
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    assert 0.3 <= time.monotonic() - started < 5
    assert storage.objects == {}
    storage.gate.set()
    keeper.drain()
    assert f"{FOLDER}/page-1-recognized.musicxml" in storage.objects
    # With the CPU to finish them, they are written before the answer.
    monkeypatch.setattr(service, "SETTLE_SECONDS", 5)
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    assert {f"{FOLDER}/page-2.png", f"{FOLDER}/page-2-recognized.musicxml",
            f"{FOLDER}/page-2-recognition.json"} <= set(storage.objects)

def test_a_review_waits_for_its_scans_page_writes(kept, monkeypatch):
    import service
    # The answer does not wait, so the page's writes are still under way when the review arrives.
    monkeypatch.setattr(service, "SETTLE_SECONDS", 0)
    api, keeper, storage, _ = kept
    storage.gate.clear()
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    thread, answer = in_thread(lambda: review(api, SCAN, REVIEW))
    thread.join(0.2)
    assert "result" not in answer
    storage.gate.set()
    thread.join(5)
    assert answer["result"][0] == 204
    assert storage.order.index(f"{FOLDER}/page-1-recognized.musicxml") < storage.order.index(f"{FOLDER}/review-1.json")

def test_a_review_is_written_when_the_page_writes_never_finish(kept, monkeypatch):
    import service
    monkeypatch.setattr(service, "SETTLE_SECONDS", 0)
    monkeypatch.setattr(service, "DRAIN_SECONDS", 0.2)
    api, keeper, storage, _ = kept
    storage.gate.clear()
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    assert review(api, SCAN, REVIEW)[0] == 204
    assert reviews(storage) == [f"{FOLDER}/review-1.json"]
    storage.gate.set()

def test_a_scan_is_forgotten_after_an_hour(kept):
    api, keeper, storage, now = kept
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    now[0] += 3601
    assert review(api, SCAN, REVIEW)[0] == 404
    keeper.drain()
    assert reviews(storage) == []

@pytest.mark.parametrize("body,headers,expected", [
    (b"[]", {}, 400),
    (b"{not json", {}, 400),
    (json.dumps(REVIEW).encode(), {"Content-Type": "text/plain"}, 415),
    (json.dumps(REVIEW).encode(), {"Content-Encoding": "gzip"}, 415),
    (b'{"a": "' + b"x" * (64 * 1024) + b'"}', {}, 413),
    (b"", {}, 413),
], ids=["array", "not-json", "text", "gzip", "too-large", "empty"])
def test_review_checks(kept, body, headers, expected):
    api, keeper, storage, _ = kept
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    assert review(api, SCAN, body, headers)[0] == expected
    keeper.drain()
    assert reviews(storage) == []

def test_a_review_needs_the_origin_and_the_client_header(kept):
    api, keeper, storage, _ = kept
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    assert review(api, SCAN, REVIEW, {"Origin": "https://evil.example"})[0] == 403
    assert review(api, SCAN, REVIEW, {"X-Digitus2-Client": None})[0] == 403
    assert review(api, SCAN.upper(), REVIEW)[0] == 404
    keeper.drain()
    assert reviews(storage) == []

def test_reviews_of_one_scan_are_bounded(kept, monkeypatch):
    import service
    monkeypatch.setattr(service, "MAX_REVIEWS", 2)
    api, keeper, storage, _ = kept
    assert request(api, "POST", "/v1/recognize", PNG, {"X-Digitus2-Keep": SCAN})[0] == 200
    assert [review(api, SCAN, {**REVIEW, "corrections": n})[0] for n in range(3)] == [204, 204, 429]
    assert len(reviews(storage)) == 2

def test_the_preflight_allows_the_keep_header_and_the_review(kept):
    preflight = {"Access-Control-Request-Method": "POST",
                 "Access-Control-Request-Headers": "content-type,x-digitus2-client"}
    status, headers, _ = request(kept[0], "OPTIONS", f"/v1/cases/{SCAN}", headers=preflight)
    assert status == 204
    assert headers["Access-Control-Allow-Origin"] == ORIGIN
    assert "X-Digitus2-Keep" in headers["Access-Control-Allow-Headers"]
    preflight = {"Access-Control-Request-Method": "POST",
                 "Access-Control-Request-Headers": "content-type,x-digitus2-client,x-digitus2-job,x-digitus2-keep,x-digitus2-page"}
    status, headers, _ = request(kept[0], "OPTIONS", "/v1/recognize", headers=preflight)
    assert status == 204
    assert "X-Digitus2-Page" in headers["Access-Control-Allow-Headers"]

class Answer:
    def __init__(self, body=b""):
        self.body = body
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self, *args):
        return self.body

def test_the_storage_writer_uses_the_json_api_with_the_metadata_token():
    calls, now = [], [100.0]
    def opener(request, timeout):
        calls.append(request)
        if "metadata.google.internal" in request.full_url:
            return Answer(json.dumps({"access_token": "t1", "expires_in": 3599}).encode())
        return Answer()
    writer = StorageWriter("digitus2-scan-cases", opener=opener, clock=lambda: now[0])
    writer(f"{FOLDER}/page-1.png", PNG, "image/png")
    writer(f"{FOLDER}/page-1-recognized.musicxml", b"<x/>", "application/vnd.recordare.musicxml+xml")
    token, upload = calls[0], calls[1]
    assert token.full_url == "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
    assert token.get_header("Metadata-flavor") == "Google"
    assert upload.get_method() == "POST"
    assert upload.full_url == ("https://storage.googleapis.com/upload/storage/v1/b/digitus2-scan-cases/o?uploadType=media&name="
                               + FOLDER.replace("/", "%2F") + "%2Fpage-1.png&ifGenerationMatch=0")
    assert upload.get_header("Authorization") == "Bearer t1"
    assert upload.get_header("Content-type") == "image/png"
    assert upload.data == PNG
    # The token is fetched once, and again only when it is about to expire.
    now[0] += 3600
    writer(f"{FOLDER}/review-1.json", b"{}", "application/json")
    assert [c.full_url.startswith("http://metadata") for c in calls] == [True, False, False, True, False]
