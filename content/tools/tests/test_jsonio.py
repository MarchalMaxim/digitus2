"""jsonio: one lock for the library's shared JSON files and atomic replacement (L1 plan, decision 3)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import jsonio  # noqa: E402

WRITER = """
import sys
sys.path.insert(0, {tools!r})
import jsonio
from pathlib import Path
p = Path({path!r})
for i in range(40):
    jsonio.update_json(p, lambda d: {{**d, f"{name}-{{i}}": i}})
"""


def test_concurrent_writers_keep_every_entry(tmp_path):
    path = tmp_path / "shared.json"
    jsonio.write_json(path, {})
    procs = [subprocess.Popen([sys.executable, "-I", "-c", WRITER.format(tools=str(TOOLS), path=str(path), name=n)])
             for n in ("a", "b", "c")]
    assert [p.wait(timeout=300) for p in procs] == [0, 0, 0]
    data = json.loads(path.read_text(encoding="utf-8"))
    assert len(data) == 120


def test_atomic_write_leaves_no_temporary_file(tmp_path):
    target = tmp_path / "x.musicxml"
    jsonio.write_atomic(target, b"<a/>")
    jsonio.write_atomic(target, b"<b/>")
    assert target.read_bytes() == b"<b/>"
    assert [p.name for p in tmp_path.iterdir()] == ["x.musicxml"]


def test_stale_lock_is_broken(tmp_path, monkeypatch):
    monkeypatch.setattr(jsonio, "LOCK", tmp_path / ".lock")
    (tmp_path / ".lock").write_text("123 0", encoding="utf-8")
    import os, time
    os.utime(tmp_path / ".lock", (time.time() - 4000, time.time() - 4000))
    with jsonio.library_lock(timeout=5, stale=1800):
        assert (tmp_path / ".lock").exists()
    assert not (tmp_path / ".lock").exists()


# Added in Task 1 beyond the plan's list: a holder killed without running `finally` (Windows
# TerminateProcess, as `timeout` does) must not block every other implementer for `stale` seconds.
def test_lock_of_a_dead_process_is_broken_at_once(tmp_path, monkeypatch):
    import time

    monkeypatch.setattr(jsonio, "LOCK", tmp_path / ".lock")
    dead = subprocess.Popen([sys.executable, "-I", "-c", "pass"])
    dead.wait(timeout=60)
    (tmp_path / ".lock").write_text(f"{dead.pid} {time.time():.3f}", encoding="utf-8")
    with jsonio.library_lock(timeout=5, stale=1800):
        assert (tmp_path / ".lock").read_text(encoding="utf-8").split()[0] == str(__import__("os").getpid())


def test_lock_of_a_live_process_is_respected(tmp_path, monkeypatch):
    import os
    import time

    import pytest

    monkeypatch.setattr(jsonio, "LOCK", tmp_path / ".lock")
    holder = subprocess.Popen([sys.executable, "-I", "-c", "import time; time.sleep(60)"])
    try:
        (tmp_path / ".lock").write_text(f"{holder.pid} {time.time():.3f}", encoding="utf-8")
        with pytest.raises(TimeoutError):
            with jsonio.library_lock(timeout=1, stale=1800):
                pass
        assert (tmp_path / ".lock").read_text(encoding="utf-8").startswith(f"{holder.pid} ")
        assert os.getpid() != holder.pid
    finally:
        holder.kill()
        holder.wait(timeout=60)
