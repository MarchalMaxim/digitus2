"""Shared helpers for the experiment scripts: low process priority, single-threaded numpy, JSON
results under ``research/learn/results``, logging with timestamps."""
from __future__ import annotations

import ctypes
import json
import os
import sys
import time
from pathlib import Path

for var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(var, "1")

RESEARCH = Path(__file__).resolve().parents[2]
RESULTS = RESEARCH / "learn" / "results"
if str(RESEARCH) not in sys.path:
    sys.path.insert(0, str(RESEARCH))

BELOW_NORMAL_PRIORITY_CLASS = 0x00004000


def lower_priority() -> None:
    """Run below normal priority so the other agents' test suites keep their timing budgets."""
    if os.name == "nt":
        try:
            k32 = ctypes.windll.kernel32
            k32.SetPriorityClass(k32.GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS)
        except Exception:  # pragma: no cover
            pass
    else:  # pragma: no cover
        try:
            os.nice(10)
        except Exception:
            pass


_T0 = time.perf_counter()


def log(msg: str) -> None:
    print(f"[{time.perf_counter() - _T0:8.1f}s] {msg}", flush=True)


def save_json(name: str, data: dict) -> Path:
    path = RESULTS / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1, default=_default) + "\n", encoding="utf-8")
    return path


def load_json(name: str) -> dict:
    return json.loads((RESULTS / name).read_text(encoding="utf-8"))


def _default(o):
    import numpy as np

    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (np.bool_,)):
        return bool(o)
    raise TypeError(f"not serialisable: {type(o)}")


def command_line() -> str:
    return "research/.venv/Scripts/python.exe -I -m " + " ".join(
        [Path(sys.argv[0]).stem if sys.argv[0].endswith(".py") else sys.argv[0]] + sys.argv[1:]
    )
