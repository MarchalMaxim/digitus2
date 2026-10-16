"""HTTP boundary/lifecycle tests; simulated recognition is not OMR evidence."""
import http.client
import json
import threading
import time
import pytest
from worker import LocalWorker, serve

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
    worker = LocalWorker(tmp_path, recognizer, max_bytes=64)
    server = serve(worker, port=0, origins={ORIGIN})
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server, worker, recognizer
    recognizer.block.set()
    server.shutdown()
    server.server_close()
    worker.close()
    thread.join(2)

def request(api, method, path, body=None, headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", api[0].server_port, timeout=3)
    actual = {"Origin": ORIGIN, **(headers or {})}
    if method in {"POST", "DELETE"}:
        actual.setdefault("X-Digitus2-Client", "1")
    if body is not None:
        actual.setdefault("Content-Type", "image/png")
        actual.setdefault("X-Digitus2-Client", "1")
    connection.request(method, path, body, actual)
    response = connection.getresponse()
    result = response.status, dict(response.getheaders()), response.read()
    connection.close()
    return result

def wait_state(api, identifier, expected):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        status, _, body = request(api, "GET", f"/v1/jobs/{identifier}")
        result = json.loads(body)
        if result.get("state") == expected:
            return result
        time.sleep(0.01)
    pytest.fail(f"Expected {expected}, got {status}: {result}")

def test_loopback_health(api):
    assert api[0].server_address[0] == "127.0.0.1"
    status, headers, body = request(api, "GET", "/v1/health")
    assert status == 200
    assert headers["Access-Control-Allow-Origin"] == ORIGIN
    assert headers["Cache-Control"] == "no-store"
    assert json.loads(body)["protocol"] == "digitus2-scan-v1"

@pytest.mark.parametrize("origin", ["null", "https://evil.example", ORIGIN + ".evil.example", ""])
def test_origins_cannot_start_jobs(api, origin):
    status, headers, _ = request(api, "POST", "/v1/jobs", PNG, {"Origin": origin})
    assert status == 403
    assert "Access-Control-Allow-Origin" not in headers
    assert api[2].inputs == []

def test_rebinding_host_rejected(api):
    assert request(api, "GET", "/v1/health", headers={"Host": "evil.example"})[0] == 403

def test_preflight(api):
    headers = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-digitus2-client", "Access-Control-Request-Private-Network": "true"}
    status, response, _ = request(api, "OPTIONS", "/v1/jobs", headers=headers)
    assert status == 204
    assert response["Access-Control-Allow-Private-Network"] == "true"
    headers["Access-Control-Request-Headers"] = "x-arbitrary"
    assert request(api, "OPTIONS", "/v1/jobs", headers=headers)[0] == 403

@pytest.mark.parametrize("body,headers,expected", [(b"x" * 65, {}, 413), (b"not a scan", {}, 415), (PNG, {"X-Digitus2-Client": ""}, 403), (PNG, {"Content-Type": "text/plain"}, 415)])
def test_bad_upload(api, body, headers, expected):
    assert request(api, "POST", "/v1/jobs", body, headers)[0] == expected
    assert api[2].inputs == []

def test_result_explicitly_unreviewed(api):
    status, _, body = request(api, "POST", "/v1/jobs", PNG)
    assert status == 202
    identifier = json.loads(body)["id"]
    assert wait_state(api, identifier, "ready")["needsReview"] is True
    status, headers, data = request(api, "GET", f"/v1/jobs/{identifier}/result")
    assert status == 200
    assert headers["Content-Type"] == "application/vnd.recordare.musicxml+xml"
    assert data.startswith(b"<?xml")
    assert api[2].inputs == [PNG]

def test_busy_cancel_and_isolation(api):
    api[2].block.clear()
    first = json.loads(request(api, "POST", "/v1/jobs", PNG)[2])["id"]
    assert request(api, "POST", "/v1/jobs", PNG)[0] == 409
    assert request(api, "GET", "/v1/jobs/not-ours/result")[0] == 404
    assert request(api, "DELETE", f"/v1/jobs/{first}")[0] == 200
    wait_state(api, first, "cancelled")
    assert request(api, "GET", f"/v1/jobs/{first}/result")[0] == 409

def test_failure_hides_partial_results_and_internal_paths(api):
    def fail(source, destination, cancelled):
        (destination / "partial.musicxml").write_text("partial")
        raise RuntimeError("private path")
    api[1].recognizer = fail
    identifier = json.loads(request(api, "POST", "/v1/jobs", PNG)[2])["id"]
    assert "private path" not in json.dumps(wait_state(api, identifier, "failed"))
    assert request(api, "GET", f"/v1/jobs/{identifier}/result")[0] == 409

def test_output_containment(api, tmp_path):
    outside = tmp_path / "outside.musicxml"
    outside.write_text("outside")
    api[1].recognizer = lambda source, destination, cancelled: outside
    identifier = json.loads(request(api, "POST", "/v1/jobs", PNG)[2])["id"]
    wait_state(api, identifier, "failed")

def test_expiry_and_close_only_remove_owned_directories(api, tmp_path):
    sentinel = tmp_path / "unrelated.txt"
    sentinel.write_text("keep")
    identifier = json.loads(request(api, "POST", "/v1/jobs", PNG)[2])["id"]
    wait_state(api, identifier, "ready")
    api[1].retention_seconds = 0
    api[1].expire()
    assert request(api, "GET", f"/v1/jobs/{identifier}")[0] == 404
    api[1].close()
    assert sentinel.read_text() == "keep"
    assert not list(tmp_path.glob("scan-*"))


def test_missing_delete_client_header_is_rejected(api):
    assert request(api, "DELETE", "/v1/jobs/anything", headers={"X-Digitus2-Client": ""})[0] == 403


def test_retention_and_result_size_are_bounded(api):
    api[1].max_jobs = 1
    identifier = json.loads(request(api, "POST", "/v1/jobs", PNG)[2])["id"]
    wait_state(api, identifier, "ready")
    assert request(api, "POST", "/v1/jobs", PNG)[0] == 409
    api[1].retention_seconds = 0
    api[1].expire()
    api[1].retention_seconds = 300
    api[1].max_result_bytes = 8
    identifier = json.loads(request(api, "POST", "/v1/jobs", PNG)[2])["id"]
    wait_state(api, identifier, "failed")
    assert request(api, "GET", f"/v1/jobs/{identifier}/result")[0] == 409


def test_timeout_status_is_truthful(api):
    def timeout(*args):
        raise TimeoutError("private path")
    api[1].recognizer = timeout
    identifier = json.loads(request(api, "POST", "/v1/jobs", PNG)[2])["id"]
    status = wait_state(api, identifier, "timed_out")
    assert status["error"] == "recognition-timeout"
    assert request(api, "GET", f"/v1/jobs/{identifier}/result")[0] == 409


def test_missing_host_port_and_query_fail_closed(api):
    assert request(api, "GET", "/v1/health", headers={"Host": "127.0.0.1"})[0] == 403
    assert request(api, "GET", "/v1/health?anything=1")[0] == 404


@pytest.mark.parametrize("duplicated", ["Host", "Origin"])
def test_duplicate_security_headers_are_rejected(api, duplicated):
    connection = http.client.HTTPConnection("127.0.0.1", api[0].server_port, timeout=3)
    connection.putrequest("GET", "/v1/health", skip_host=True)
    for name, value in [("Host", f"127.0.0.1:{api[0].server_port}"), ("Origin", ORIGIN)]:
        connection.putheader(name, value)
        if name == duplicated:
            connection.putheader(name, value)
    connection.endheaders()
    response = connection.getresponse()
    assert response.status == 403
    response.read()
    connection.close()


def test_entity_output_is_not_published(api):
    def bad(source, destination, cancelled):
        output = destination / "bad.musicxml"
        output.write_bytes(b'<!DOCTYPE x [<!ENTITY a "bad">]><score-partwise>&a;</score-partwise>')
        return output
    api[1].recognizer = bad
    identifier = json.loads(request(api, "POST", "/v1/jobs", PNG)[2])["id"]
    wait_state(api, identifier, "failed")
    assert request(api, "GET", f"/v1/jobs/{identifier}/result")[0] == 409


def test_expired_owned_orphan_cleanup_preserves_unrelated_scan_directory(api, tmp_path):
    orphan = tmp_path / "scan-old-owned"
    orphan.mkdir()
    (orphan / ".digitus2-job.json").write_text(json.dumps({"protocol": "digitus2-scan-v1", "created": 0, "ownerPid": 0}))
    unrelated = tmp_path / "scan-not-ours"
    unrelated.mkdir()
    (unrelated / "keep").write_text("sentinel")
    api[1].expire()
    assert not orphan.exists()
    assert (unrelated / "keep").read_text() == "sentinel"


def test_request_thread_count_is_bounded(api):
    import socket
    connections = []
    try:
        for _ in range(4):
            connection = socket.create_connection(("127.0.0.1", api[0].server_port))
            connection.sendall(b"GET /v1/health HTTP/1.1\r\n")
            connections.append(connection)
        time.sleep(0.1)
        assert request(api, "GET", "/v1/health")[0] == 503
    finally:
        for connection in connections:
            connection.close()


def test_missing_ocr_warning_is_structured_in_health_submit_and_status(api):
    api[2].capabilities = {"textModelConfigured": False}
    api[2].warnings = [{"code": "ocr-language-not-configured", "message": "Configure OCR"}]
    health = json.loads(request(api, "GET", "/v1/health")[2])
    submitted = json.loads(request(api, "POST", "/v1/jobs", PNG)[2])
    status = wait_state(api, submitted["id"], "ready")
    for value in (health, submitted, status):
        assert value["capabilities"]["textModelConfigured"] is False
        assert value["warnings"][0]["code"] == "ocr-language-not-configured"
        assert value["needsReview"] is True

@pytest.mark.parametrize("origin", [
    "http://evil.example:4196", "http://localhost:4196/path",
    "http://localhost", "http://localhost:4196?query=1",
    "http://user@localhost:4196", "http://127.0.0.1:bad",
])
def test_development_origins_stay_exact_and_loopback(tmp_path, origin):
    worker = LocalWorker(tmp_path, Recognizer())
    with pytest.raises(ValueError):
        serve(worker, port=0, origins={ORIGIN, origin})
    worker.close()


def test_explicit_development_origin_keeps_pages_and_rejects_other_ports(tmp_path):
    worker = LocalWorker(tmp_path, Recognizer())
    dev_origin = "http://127.0.0.1:4196"
    server = serve(worker, port=0, origins={ORIGIN, dev_origin})
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        api = server, worker, worker.recognizer
        for origin in [ORIGIN, dev_origin]:
            status, headers, _ = request(api, "GET", "/v1/health", headers={"Origin": origin})
            assert status == 200
            assert headers["Access-Control-Allow-Origin"] == origin
        assert request(api, "GET", "/v1/health", headers={"Origin": "http://127.0.0.1:4197"})[0] == 403
    finally:
        server.shutdown()
        server.server_close()
        worker.close()
        thread.join(2)

def test_native_scale_reason_reaches_status_without_private_logs(api):
    from recognition_errors import native_failure
    def scale_failure(*args):
        raise native_failure("private C:/Users/name/input.jpg; With a too low interline value of 6 pixels")
    api[1].recognizer = scale_failure
    identifier = json.loads(request(api, "POST", "/v1/jobs", PNG)[2])["id"]
    status = wait_state(api, identifier, "failed")
    assert status["error"] == "staff-resolution-too-low"
    assert status["failure"]["details"]["interlinePixels"] == 6
    assert "6 pixels" in status["failure"]["message"]
    assert "C:/" not in json.dumps(status)
    assert request(api, "GET", f"/v1/jobs/{identifier}/result")[0] == 409

class BranchRecognizer:
    def __init__(self, name):
        self.name=name
        self.capabilities={'testBranch':name}
        self.warnings=[{'code':name,'message':name+' needs review'}]
        self.inputs=[]
    def __call__(self, source, destination, cancelled):
        self.inputs.append((source.suffix,source.read_bytes()))
        if self.name=='photo':
            (destination/'recognition.json').write_text(json.dumps({'warnings':[
                *self.warnings,{'code':'foreign-staff-omitted','message':'An inset example was omitted; compare the source.'}]}))
        output=destination/'score.musicxml';output.write_text('<score-partwise/>');return output


def test_explicit_router_preserves_pdf_and_image_bytes(tmp_path):
    from worker import PhotoPdfRecognizer
    pdf,photo=BranchRecognizer('pdf'),BranchRecognizer('photo')
    router=PhotoPdfRecognizer(pdf,photo)
    for extension,data,expected in [('.pdf',b'%PDF-original',pdf),('.jpg',b'\xff\xd8\xff-original',photo),('.png',PNG,photo)]:
        folder=tmp_path/extension[1:];folder.mkdir()
        source=folder/('input'+extension);source.write_bytes(data)
        router(source,folder,threading.Event())
        assert expected.inputs[-1]==(extension,data)
        metadata=router.metadata_for(source,folder)
        assert metadata['recognizer']==expected.name
        assert metadata['needsReview'] is True
        assert metadata['warnings'][-1]['code']==('foreign-staff-omitted' if expected is photo else 'pdf')
    assert len(pdf.inputs)==1 and len(photo.inputs)==2


def test_job_specific_metadata_does_not_leak_between_pdf_and_photo(tmp_path):
    from worker import PhotoPdfRecognizer
    worker=LocalWorker(tmp_path,PhotoPdfRecognizer(BranchRecognizer('pdf'),BranchRecognizer('photo')))
    try:
        image=worker.submit(PNG,'.png');worker.jobs[image].thread.join(2)
        assert worker.status(image)['recognizer']=='photo'
        assert any(w['code']=='foreign-staff-omitted' for w in worker.status(image)['warnings'])
        pdf=worker.submit(b'%PDF-original','.pdf');worker.jobs[pdf].thread.join(2)
        assert worker.status(pdf)['recognizer']=='pdf'
        assert all(w['code']!='foreign-staff-omitted' for w in worker.status(pdf)['warnings'])
        assert worker.status(image)['recognizer']=='photo'
        assert worker.status(image)['needsReview'] is True
    finally:worker.close()


def test_invalid_photo_warning_metadata_cannot_publish_ready_result(tmp_path):
    from worker import PhotoPdfRecognizer
    photo=BranchRecognizer('photo')
    def invalid(source,destination,cancelled):
        path=destination/'recognition.json';path.write_text('{"warnings":[{"code":"broken"}]}')
        out=destination/'result.musicxml';out.write_text('<score-partwise/>');return out
    photo.__class__=type('InvalidBranch',(BranchRecognizer,),{'__call__':staticmethod(invalid)})
    worker=LocalWorker(tmp_path,PhotoPdfRecognizer(BranchRecognizer('pdf'),photo))
    try:
        identifier=worker.submit(PNG,'.png');worker.jobs[identifier].thread.join(2)
        assert worker.status(identifier)['state']=='failed'
        assert worker.jobs[identifier].result is None
    finally:worker.close()
