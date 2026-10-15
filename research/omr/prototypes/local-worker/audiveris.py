"""Pinned portable Audiveris adapter: direct argv, isolated settings, bounded lifetime."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

MSI_SHA256 = "5f1b4e96a12c53c7da426814b76e599363c4181e291855996e0a6878dda95f71"
ENGLISH_SHA256 = "daa0c97d651c19fba3b25e81317cd697e9908c8208090c94c3905381c23fc047"


def process_alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.restype = ctypes.c_void_p
        kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
        kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        code = ctypes.c_ulong()
        alive = bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code)) and code.value == 259)
        kernel.CloseHandle(handle)
        return alive
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def stop_process(process):
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       creationflags=subprocess.CREATE_NO_WINDOW, check=False)
    else:
        os.killpg(process.pid, signal.SIGKILL)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def run_process(command, directory, env, cancelled, timeout, log_path):
    options = ({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt"
               else {"start_new_session": True})
    with log_path.open("wb") as log:
        process = subprocess.Popen(command, cwd=directory, env=env, stdout=log,
                                   stderr=subprocess.STDOUT, shell=False, **options)
        started = time.monotonic()
        checked = started
        try:
            while True:
                if cancelled.is_set():
                    raise InterruptedError("cancelled")
                if time.monotonic() - started > timeout:
                    raise TimeoutError("recognition timeout")
                if time.monotonic() - checked > 0.25:
                    checked = time.monotonic()
                    if log_path.stat().st_size > 8 * 1024 * 1024:
                        raise RuntimeError("recognizer log limit")
                    workspace_bytes = 0
                    for path in directory.rglob("*"):
                        try:
                            if path.is_file():
                                workspace_bytes += path.stat().st_size
                        except FileNotFoundError:
                            pass  # Native atomic writes may replace a temporary file during sampling.
                    if workspace_bytes > 128 * 1024 * 1024:
                        raise RuntimeError("recognizer workspace limit")
                code = process.poll()
                if code is not None:
                    if code:
                        raise RuntimeError("recognizer exit")
                    return
                cancelled.wait(0.05)
        finally:
            stop_process(process)
            (directory / "process.json").write_text(json.dumps({
                "pid": process.pid, "exitCode": process.returncode,
                "cancelled": cancelled.is_set(), "timeoutSeconds": timeout,
                "elapsedSeconds": time.monotonic() - started,
            }, indent=2), encoding="utf-8")


def unwrap_mxl(path, maximum=20 * 1024 * 1024):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 32 or sum(e.file_size for e in entries) > maximum:
            raise ValueError("oversized MusicXML archive")
        container = archive.read("META-INF/container.xml")
        if b"<!ENTITY" in container.upper():
            raise ValueError("XML entities rejected")
        root = ET.fromstring(container)
        targets = root.findall(".//{*}rootfile")
        if len(targets) != 1:
            raise ValueError("ambiguous MusicXML archive")
        name = targets[0].get("full-path", "")
        if not name or name.startswith(("/", "\\")) or ".." in name.replace("\\", "/").split("/"):
            raise ValueError("unsafe score path")
        return archive.read(name)


class Audiveris:
    def __init__(self, bundle, *, timeout=180, short_staves=False, text_models=None):
        self.bundle = Path(bundle).resolve()
        self.timeout = timeout
        if not 0 < timeout <= 600:
            raise ValueError("timeout must be in (0,600]")
        if hashlib.sha256((self.bundle / "audiveris-5.11.0.msi").read_bytes()).hexdigest() != MSI_SHA256:
            raise ValueError("Audiveris release hash mismatch")
        self.portable = self.bundle / "portable/Audiveris"
        self.short_staves = short_staves
        self.text_model = Path(text_models).resolve() / "eng.traineddata" if text_models else None
        if self.text_model and hashlib.sha256(self.text_model.read_bytes()).hexdigest() != ENGLISH_SHA256:
            raise ValueError("English OCR model hash mismatch")
        self.name = "Audiveris-5.11.0/" + ("experimental-short-staves" if short_staves else "default")
        if self.text_model:
            self.name += "+pinned-eng"
        self.capabilities = {"textModelConfigured": bool(self.text_model), "originalPdfInput": True,
                             "experimentalShortStaves": short_staves}
        self.warnings = ([] if self.text_model else [{
            "code": "ocr-language-not-configured",
            "message": "English OCR is not configured; text and tempo labels may be omitted. Configure --text-models.",
        }])

    def __call__(self, source, destination, cancelled):
        for name in ["home", "tmp", "roaming", "local", "javacpp", "exports"]:
            (destination / name).mkdir()
        env = dict(os.environ)
        env.update(APPDATA=str(destination / "roaming"), LOCALAPPDATA=str(destination / "local"),
                   TEMP=str(destination / "tmp"), TMP=str(destination / "tmp"))
        # Do not inherit JVM options that could override isolation or inject an agent.
        for name in ["JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "CLASSPATH", "TESSDATA_PREFIX"]:
            env.pop(name, None)
        if self.text_model:
            import shutil
            (destination / "tessdata").mkdir()
            shutil.copyfile(self.text_model, destination / "tessdata/eng.traineddata")
            env["TESSDATA_PREFIX"] = str(destination / "tessdata")
        command = [str(self.portable / "runtime/bin/java.exe"), "-Xms256m", "-Xmx4g",
                   "-XX:ActiveProcessorCount=4", "-Djava.awt.headless=true", "-Dfile.encoding=UTF-8",
                   "-Duser.home=" + str(destination / "home"),
                   "-Djava.io.tmpdir=" + str(destination / "tmp"),
                   "-Dorg.bytedeco.javacpp.cachedir=" + str(destination / "javacpp"),
                   "--add-exports=java.desktop/sun.awt.image=ALL-UNNAMED", "--enable-native-access=ALL-UNNAMED",
                   "-cp", str(self.portable / "app/*"), "Audiveris"]
        if self.short_staves:
            command += ["-constant", "org.audiveris.omr.sheet.grid.LinesRetriever.minStaffLength=12",
                        "-constant", "org.audiveris.omr.sheet.grid.ClustersRetriever.minClusterLengthRatio=0.15"]
        if self.text_model:
            command += ["-constant", "org.audiveris.omr.text.Language.defaultSpecification=eng"]
        command += ["-batch", "-transcribe", "-export", "-save", "-output", str(destination / "exports"), "--", str(source)]
        (destination / "invocation.json").write_text(json.dumps({
            "command": command, "profile": self.name, "msiSha256": MSI_SHA256,
            "textModelSha256": ENGLISH_SHA256 if self.text_model else None,
            "inputSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        }, indent=2), encoding="utf-8")
        run_process(command, destination, env, cancelled, self.timeout, destination / "execution.log")
        outputs = list((destination / "exports").rglob("*.mxl"))
        if len(outputs) != 1:
            raise ValueError("expected exactly one complete exported score")
        data = unwrap_mxl(outputs[0])
        output = destination / "result.musicxml"
        output.write_bytes(data)
        return output
