"""Recognises one photo exactly as the hosted scan service does (issue 233), for recognize.mjs.

usage: python -I recognize.py --homr TOOLCHAIN --photo PHOTO --out DIR --root WORK [--timeout S] [--threads N]

The photo goes through the service's own Service (research/omr/service/service.py) with the
recogniser the container builds, PhotoPdfRecognizer over the worker's Homr adapter, and a Keeper
that keeps in memory what the live Keeper writes to the cases bucket. DIR receives:

  answer.json          {"status": <HTTP status>, "body": <the service's JSON answer without xml>,
                        "environment": <where it ran>, "diagnostic"?: <what raised a refusal>}
  recognized.musicxml  the answer's xml, as the app receives it (ready answers only)
  recognition.json     the recogniser's record, byte for byte as the Keeper keeps it (when written)

The service answers 422 for whatever stops the recogniser, so `diagnostic` says what did:
{"cause": "<exception>: <message>", "environment": <bool>, "log"?: <the end of homr's log>}.
`environment` is true for a fault of this computer or the toolchain (a path too long, a library
that does not load), which is no measurement of the scanner.

Nothing is printed on stdout: the service's own log line goes to stderr. Exit 0 whenever the
service answered, whatever it answered; 2 when the toolchain cannot be used.
"""
from __future__ import annotations

import argparse
import contextlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import secrets
import sys

SERVICE = Path(__file__).resolve().parent.parent / "service"
sys.path.insert(0, str(SERVICE))
# service.py puts the local worker's folder on the path itself.
from service import Keeper, Service  # noqa: E402
from thread_budget import VARIABLE as THREADS_VARIABLE  # noqa: E402
from worker import PhotoPdfRecognizer  # noqa: E402

# What the service's handler accepts, by the upload's first bytes (Handler.do_POST).
SIGNATURES = ((b"\x89PNG\r\n\x1a\n", ".png"), (b"\xff\xd8\xff", ".jpg"))
MAX_BYTES = 10 * 1024 * 1024
# The thread budget of the hosted service: deploy.ps1 sets DIGITUS2_OMR_THREADS=4 on Cloud Run.
LIVE_THREADS = 4
# homr's child stopped by this computer, not by the page: a library that does not load, or an
# operating system error (homr reports a file it could not write, under a path too long, as
# "[Errno 2] No such file or directory").
BROKEN_TOOLCHAIN = re.compile(
    r"DLL load failed|ImportError|ModuleNotFoundError|No module named|\[(?:Errno|WinError) \d+\]"
    r"|filename or extension is too long")
# The packages of the toolchain that decide what homr reads.
PACKAGES = ("onnxruntime", "opencv-python", "opencv-python-headless", "numpy", "pillow")


class NoPdf:
    """The PDF side of the live recogniser; photos never reach it."""
    name = "no PDF recognizer"
    capabilities: dict = {}
    warnings: list = []

    def __call__(self, source, destination, cancelled):
        raise ValueError("PDFs are not re-recognised")


class MemoryWriter:
    """The Keeper's bucket, in memory: object name to bytes."""
    def __init__(self):
        self.objects: dict[str, bytes] = {}

    def __call__(self, name: str, data: bytes, content_type: str):
        self.objects[name] = data


class Watched:
    """The recogniser as the service sees it, noting what stopped it before the service turns it
    into an answer: the answer stays the service's, the cause goes in answer.json."""
    def __init__(self, recognizer):
        self.recognizer = recognizer
        self.called = False
        self.diagnostic = None

    def __getattr__(self, name):
        return getattr(self.recognizer, name)

    def __call__(self, source, destination, cancelled):
        self.called = True
        try:
            return self.recognizer(source, destination, cancelled)
        except (TimeoutError, InterruptedError):
            raise  # 504 and cancel: the service's own answers, no other cause to tell.
        except Exception as error:
            log = tail(Path(destination) / "execution.log")
            self.diagnostic = {
                "cause": f"{type(error).__name__}: {error}",
                # TimeoutError and InterruptedError are OSErrors too, and passed on above.
                "environment": isinstance(error, (OSError, ImportError)) or bool(BROKEN_TOOLCHAIN.search(log)),
            }
            if log:
                self.diagnostic["log"] = log
            raise


def tail(path: Path, size: int = 1500) -> str:
    """The end of a log, or nothing."""
    try:
        return path.read_bytes()[-size:].decode("utf-8", errors="replace").strip()
    except OSError:
        return ""


def recognize_page(recognizer, photo: Path, out: Path, root: Path, environment: dict | None = None) -> int:
    """Recognises `photo` through Service and writes answer.json, recognized.musicxml and
    recognition.json into `out`. Returns the HTTP status the service would answer."""
    data = photo.read_bytes()
    extension = next((ext for magic, ext in SIGNATURES if data.startswith(magic)), None)
    diagnostic = None
    if extension is None:
        status, body = 415, {"error": "unsupported-input"}
    elif not 0 < len(data) <= MAX_BYTES:
        status, body = 413, {"error": "upload-too-large"}
    else:
        writer = MemoryWriter()
        keeper = Keeper(writer)
        watched = Watched(recognizer)
        service = Service(watched, root, keeper=keeper)
        scan = secrets.token_hex(16)
        # The service logs one JSON line per recognition on stdout; it is kept off ours.
        with contextlib.redirect_stdout(sys.stderr):
            status, body = service.recognize(data, extension, secrets.token_hex(16), scan)
        keeper.drain()
        record = next((value for name, value in writer.objects.items() if name.endswith("-recognition.json")), None)
        if record is not None:
            (out / "recognition.json").write_bytes(record)
        diagnostic = watched.diagnostic
        if diagnostic is None and status != 200 and not watched.called:
            # The service stopped before the recogniser ran: its working folder, this computer.
            diagnostic = {"cause": "the service failed before the recogniser ran", "environment": True}
    body = dict(body)
    xml = body.pop("xml", None)
    if xml is not None:
        (out / "recognized.musicxml").write_bytes(xml.encode("utf-8"))
    answer = {"status": status, "body": body, "environment": environment}
    if diagnostic is not None:
        answer["diagnostic"] = diagnostic
    (out / "answer.json").write_bytes(json.dumps(answer, indent=2).encode("utf-8"))
    return status


def thread_budget(requested: int | None, environ=os.environ) -> int:
    """homr's threads: --threads, else DIGITUS2_OMR_THREADS, else the hosted service's 4."""
    if requested is not None:
        return requested
    try:
        value = int(environ.get(THREADS_VARIABLE, ""))
    except ValueError:
        value = 0
    return value if value > 0 else LIVE_THREADS


def toolchain_environment(toolchain: Path) -> dict:
    """The toolchain's Python and the versions of the packages that decide what homr reads."""
    found: dict = {}
    venv = toolchain / "venv"
    config = venv / "pyvenv.cfg"
    with contextlib.suppress(OSError):
        version = re.search(r"^version(?:_info)?\s*=\s*(\S+)", config.read_text(encoding="utf-8"), re.M)
        if version:
            found["python"] = version[1]
    sites = [venv / "Lib" / "site-packages", *sorted(venv.glob("lib/python3*/site-packages"))]
    for site in (s for s in sites if s.is_dir()):
        for dist in importlib.metadata.distributions(path=[str(site)]):
            name = (dist.metadata["Name"] or "").lower()
            if name in PACKAGES:
                found[name] = dist.version
    return found


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--homr", type=Path, required=True, help="prepared homr toolchain")
    parser.add_argument("--photo", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True, help="the service's working folder")
    parser.add_argument("--timeout", type=float, default=180, help="the service's default, 180 s")
    parser.add_argument("--threads", type=int, default=None,
                        help=f"homr's CPU threads; default {THREADS_VARIABLE}, else {LIVE_THREADS} as deployed")
    args = parser.parse_args(argv)
    if args.threads is not None and args.threads <= 0:
        parser.error("--threads must be positive")
    # As service.main: the budget is set before the recogniser is built, homr's child inherits it.
    threads = thread_budget(args.threads)
    os.environ[THREADS_VARIABLE] = str(threads)
    from homr import Homr
    try:
        recognizer = PhotoPdfRecognizer(NoPdf(), Homr(args.homr, timeout=args.timeout))
    except (OSError, ValueError) as error:
        print(f"The homr toolchain cannot be used: {error}", file=sys.stderr)
        return 2
    environment = {"platform": platform.platform(), "python": platform.python_version(),
                   "toolchain": toolchain_environment(args.homr), "threads": threads,
                   "timeout": args.timeout}
    args.out.mkdir(parents=True, exist_ok=True)
    recognize_page(recognizer, args.photo, args.out, args.root, environment)
    return 0


if __name__ == "__main__":
    sys.exit(main())
