"""Shared JSON files of the library: one lock and atomic replacement (L1 plan, decision 3).

Several implementers build pieces at the same time, and each run merges its results into
content/manifest.json and content/verification.json. Every read-modify-write of those files
happens inside `library_lock()`, an exclusive lock file under content/_build/ (gitignored), and
every file is replaced atomically, so a concurrent reader never sees half a file.

    with jsonio.library_lock():
        data = json.loads(path.read_text(encoding="utf-8"))
        ...
        jsonio.write_json(path, data)

    jsonio.update_json(path, lambda d: {**d, "key": value})   # the same in one call

The lock is a file created with O_CREAT | O_EXCL holding "<pid> <unix time>". A lock older than
`stale` seconds is broken, and so is a lock whose holder process no longer runs (a build killed
without running `finally`, as Windows' TerminateProcess does). The lock is re-entrant inside one
process, so a helper that takes it may call another that takes it too. Standard library only.
License: MIT.
"""
from __future__ import annotations

import json
import os
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator

CONTENT = Path(__file__).resolve().parent.parent
LOCK: Path = CONTENT / "_build" / ".library.lock"
POLL = 0.2  # seconds between attempts to take the lock or to replace a file
REPLACE_RETRIES = 5  # os.replace retries on PermissionError (Windows: a reader has the target open)

_held: dict[str, int] = {}  # lock path -> nesting depth in this process


@contextmanager
def library_lock(timeout: float = 900, stale: float = 1800) -> Iterator[None]:
    """Hold the library lock (LOCK, read at call time) for the duration of the block.

    Polls every 0.2 s; breaks a lock file older than `stale` seconds or held by a process that no
    longer runs; raises TimeoutError after `timeout` seconds. Re-entrant within one process.
    """
    lock = Path(LOCK)
    key = str(lock)
    if _held.get(key):
        _held[key] += 1
        try:
            yield
        finally:
            _held[key] -= 1
        return
    lock.parent.mkdir(parents=True, exist_ok=True)
    token = f"{os.getpid()} {time.time():.3f}"
    deadline = time.monotonic() + timeout
    while True:
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            if time.monotonic() >= deadline:
                holder = _read(lock)
                raise TimeoutError(f"library lock {lock} still held after {timeout:g} s (holder: {holder!r})")
            try:
                age = time.time() - lock.stat().st_mtime
            except FileNotFoundError:
                continue  # released between our attempt and the stat: try again at once
            seen = _read(lock)
            time.sleep(POLL)
            if (age > stale or _holder_is_dead(seen)) and seen is not None and _read(lock) == seen:
                # still that holder's lock (another waiter may have broken it and taken a fresh
                # one in the meantime): break it
                try:
                    lock.unlink()
                except (FileNotFoundError, PermissionError):
                    pass
            continue
        except PermissionError:
            # Windows: the lock file is being deleted by its holder right now
            if time.monotonic() >= deadline:
                raise TimeoutError(f"library lock {lock} could not be created after {timeout:g} s") from None
            time.sleep(POLL)
            continue
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(token)
        break
    _held[key] = 1
    try:
        yield
    finally:
        _held[key] = 0
        _release(lock, token)


def _release(lock: Path, token: str) -> None:
    """Delete our lock file, and only ours: if it was broken as stale, someone else's is there now.

    On Windows a waiter that is reading the file blocks its deletion for a moment (sharing
    violation), so both steps are retried for about five seconds. A lock that still cannot be
    deleted is left behind with a warning: it names this process, so the next taker breaks it
    (this process holds nothing, or it has exited)."""
    for _ in range(250):
        try:
            content = lock.read_text(encoding="utf-8")
        except FileNotFoundError:
            return
        except PermissionError:
            time.sleep(0.02)
            continue
        if content != token:
            return
        try:
            lock.unlink()
            return
        except FileNotFoundError:
            return
        except PermissionError:
            time.sleep(0.02)
    print(f"warning: could not delete the library lock {lock}; the next taker will break it", file=sys.stderr)


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError):
        return None


def _holder_is_dead(content: str | None) -> bool:
    """The lock names a process that no longer runs (killed without `finally`), or names this
    process, which is taking the lock and so does not hold it (a release that could not delete
    the file; one thread per process uses the lock).

    Unknown content (empty, being written) counts as alive, and so does any doubt."""
    try:
        pid = int((content or "").split()[0])
    except (IndexError, ValueError):
        return False
    if pid == os.getpid():
        return True
    return not _pid_alive(pid)


def _pid_alive(pid: int) -> bool:
    if os.name == "nt":
        # never os.kill(pid, 0) on Windows: any signal other than CTRL_* terminates the process
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel32.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
        kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
        process_query_limited_information, still_active, invalid_parameter = 0x1000, 259, 87
        handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
        if not handle:
            return ctypes.get_last_error() != invalid_parameter  # e.g. access denied: it exists
        try:
            code = wintypes.DWORD()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return True
            return code.value == still_active
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def write_atomic(path: Path, data: bytes) -> None:
    """Write `data` to a temporary file next to `path`, then os.replace it over `path`.

    The replacement is retried five times, 0.2 s apart, on PermissionError (Windows refuses to
    replace a file that a reader has open). The temporary file never survives a failure.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.{os.getpid()}.tmp"
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        for attempt in range(REPLACE_RETRIES + 1):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                if attempt == REPLACE_RETRIES:
                    raise
                time.sleep(POLL)
    finally:
        if tmp.exists():
            tmp.unlink()


def dumps(obj) -> bytes:
    """The library's JSON format: indent 2, UTF-8 without escapes, LF, trailing newline."""
    return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def write_json(path: Path, obj) -> None:
    """Write `obj` atomically in the library's JSON format."""
    write_atomic(Path(path), dumps(obj))


def read_json(path: Path, default: Callable[[], object] = dict):
    """Parse `path`, or return `default()` when it does not exist."""
    path = Path(path)
    if not path.exists():
        return default()
    return json.loads(path.read_text(encoding="utf-8"))


def update_json(path: Path, fn: Callable[[object], object], default: Callable[[], object] = dict) -> object:
    """Read `path` ({} if missing, or `default()`), apply `fn`, write the result; all under the lock.

    `fn` returns the new value; returning None keeps the (possibly mutated) value it was given.
    Returns the value written.
    """
    with library_lock():
        data = read_json(path, default)
        new = fn(data)
        if new is None:
            new = data
        write_json(path, new)
        return new
