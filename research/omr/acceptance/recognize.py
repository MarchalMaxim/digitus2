"""Run the local worker's own recognisers on a list of acceptance inputs.

The acceptance gate (research/omr/acceptance.mjs) writes a job list and calls this script; each job
is one input file, one recogniser ("homr" for page images, "audiveris" for PDFs) and one output
path. The adapters are the ones the PC worker uses (local-worker/homr.py and audiveris.py), so the
gate measures the shipped pipeline, not a copy of it. A job whose output exists is skipped: the
gate names outputs by a hash of the input and of the pipeline, so a stored output is reusable
exactly when nothing that produced it has changed.

With --workers N, N jobs run at once (issue 134). Each job is a separate native process in its own
directory with the recognisers' usual thread settings, so a job's output is the same as alone.

Usage: python research/omr/acceptance/recognize.py JOBS.json --bundle DIR --text-models DIR
       --homr-toolchain DIR [--timeout S] [--workers N]
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import time

WORKER = Path(__file__).resolve().parent.parent / "prototypes" / "local-worker"
sys.path.insert(0, str(WORKER))

from audiveris import Audiveris  # noqa: E402
from homr import Homr  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jobs", type=Path)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--text-models", type=Path, required=True)
    parser.add_argument("--homr-toolchain", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--workers", type=int, default=1)
    args = parser.parse_args()
    jobs = json.loads(args.jobs.read_text(encoding="utf-8"))
    recognizers = {}

    def recognizer(name: str):
        if name not in recognizers:
            if name == "homr":
                recognizers[name] = Homr(args.homr_toolchain, timeout=args.timeout)
            elif name == "audiveris":
                recognizers[name] = Audiveris(
                    args.bundle, timeout=args.timeout, short_staves=True, text_models=args.text_models
                )
            else:
                raise ValueError(f"unknown recognizer {name}")
        return recognizers[name]

    pending = [job for job in jobs if not Path(job["output"]).exists() and not Path(job["output"] + ".failed.json").exists()]
    print(json.dumps({"jobs": len(jobs), "toRun": len(pending), "workers": args.workers}), flush=True)
    # Made before the pool starts, so the workers share them instead of racing to create them.
    for name in sorted({job["recognizer"] for job in pending}):
        recognizer(name)
    progress = threading.Lock()
    finished = 0

    def run(job) -> None:
        nonlocal finished
        source = Path(job["input"]).resolve()
        output = Path(job["output"])
        output.parent.mkdir(parents=True, exist_ok=True)
        workspace = Path(tempfile.mkdtemp(prefix="d2-accept-"))
        started = time.monotonic()
        try:
            # The adapters expect an input file whose suffix names its kind.
            local = workspace / ("input" + source.suffix.lower())
            shutil.copyfile(source, local)
            destination = workspace / "job"
            destination.mkdir()
            result = recognizer(job["recognizer"])(local, destination, threading.Event())
            data = Path(result).read_bytes()
            tmp = output.with_suffix(output.suffix + ".tmp")
            tmp.write_bytes(data)
            tmp.replace(output)
            status = "ok"
        except Exception as error:  # A failed recognition is a result the gate scores as zero.
            (output.parent / (output.name + ".failed.json")).write_text(
                json.dumps({"error": type(error).__name__, "message": str(error)[:500]}), encoding="utf-8"
            )
            status = f"failed: {type(error).__name__}"
        finally:
            shutil.rmtree(workspace, ignore_errors=True)
        with progress:
            finished += 1
            print(json.dumps({"done": finished, "of": len(pending), "id": job["id"], "status": status,
                              "seconds": round(time.monotonic() - started, 1)}), flush=True)

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        list(pool.map(run, pending))
    return 0


if __name__ == "__main__":
    sys.exit(main())
