"""Bundle layout detection and job isolation per platform; no recognition."""
import hashlib, threading, zipfile
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

def test_deb_layout_uses_the_package_java_and_only_its_jars(deb_bundle):
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
