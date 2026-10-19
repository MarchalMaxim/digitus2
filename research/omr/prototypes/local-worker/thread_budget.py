"""The recognisers' CPU thread budget: the container's CPU quota, not the machine's cores.

In a container ONNX Runtime sizes its intra-op pool from the host's physical cores and
oversubscribes a smaller CPU quota (a page took four times longer). `detect` finds the budget;
`apply` runs in homr's child Python before homr is imported. Standard library only.
"""
from __future__ import annotations
import math
import os
from pathlib import Path

VARIABLE = "DIGITUS2_OMR_THREADS"

def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="ascii").strip()
    except (OSError, UnicodeDecodeError):
        return None

def _cgroup_quota(root: Path) -> int | None:
    """ceil(quota / period) from cgroup v2 `cpu.max` or v1 `cpu/cpu.cfs_*_us`; None without a quota."""
    v2 = _read(root/"cpu.max")
    if v2 is not None:
        fields = v2.split()
        if len(fields) == 2 and fields[0] != "max":
            try:
                quota, period = int(fields[0]), int(fields[1])
            except ValueError:
                return None
            return math.ceil(quota/period) if quota > 0 and period > 0 else None
        return None
    quota, period = _read(root/"cpu/cpu.cfs_quota_us"), _read(root/"cpu/cpu.cfs_period_us")
    try:
        quota, period = int(quota), int(period)
    except (TypeError, ValueError):
        return None
    return math.ceil(quota/period) if quota > 0 and period > 0 else None

def detect(environ=os.environ, cgroup_root: Path = Path("/sys/fs/cgroup"), affinity=None) -> int | None:
    """The thread budget: the variable, else the cgroup quota, else a smaller affinity; None for none."""
    try:
        value = int(environ.get(VARIABLE, ""))
    except ValueError:
        value = 0
    if value > 0:
        return value
    quota = _cgroup_quota(Path(cgroup_root))
    if quota is not None:
        return quota
    if affinity is None and hasattr(os, "sched_getaffinity"):
        affinity = os.sched_getaffinity(0)
    if affinity is not None and 0 < len(affinity) < (os.cpu_count() or 0):
        return len(affinity)
    return None

def apply(budget: int) -> None:
    """Give ONNX Runtime sessions created without options this budget (inter-op 1), and OpenCV too."""
    import onnxruntime
    if not getattr(onnxruntime.InferenceSession, "_digitus2_budget", None):
        original = onnxruntime.InferenceSession

        class InferenceSession(original):
            _digitus2_budget = budget

            def __init__(self, path_or_bytes, sess_options=None, providers=None, **kwargs):
                if sess_options is None:
                    sess_options = onnxruntime.SessionOptions()
                    sess_options.intra_op_num_threads = budget
                    sess_options.inter_op_num_threads = 1
                super().__init__(path_or_bytes, sess_options=sess_options, providers=providers, **kwargs)

        onnxruntime.InferenceSession = InferenceSession
    try:
        import cv2
    except ImportError:
        return
    cv2.setNumThreads(budget)
