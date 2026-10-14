"""Rebuild library pieces into content/_build/repro and compare them byte for byte with content/scores.

    python -I content/tools/repro.py --core30   # the 30 pieces of the benchmark set core30 (38 files)
    python -I content/tools/repro.py --all      # every slug of the merged catalog

Runs `build.py --out-dir content/_build/repro --only <slugs>`, which converts and arranges into that
directory without validating and without touching content/scores, manifest.json or
verification.json. Then compares every <slug>.musicxml and <slug>.fingered.musicxml of the selected
slugs (in either directory) with content/scores/ and prints, per file, `identical` or the first
differing line. Exit 1 on any difference, any missing file or any failed build.

Proves that the fetched sources, the pinned catalog and the tools reproduce the committed library
(L1 plan, decision 2 and Review Focus 1). License: MIT.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # isolated mode (-I) does not put the script's directory on sys.path

import build  # noqa: E402

CONTENT = HERE.parent
SCORES = CONTENT / "scores"
OUT = CONTENT / "_build" / "repro"
CORE_SET = "core30"


def select(core30: bool) -> list[str]:
    """The slugs to rebuild: the benchmark set core30, or every slug of the merged catalog."""
    catalog = build.load_catalog()
    if core30:
        return [p["slug"] for p in catalog if p.get("benchmarkSet") == CORE_SET]
    return [p["slug"] for p in catalog]


def score_names(slug: str) -> tuple[str, str]:
    return f"{slug}.musicxml", f"{slug}.fingered.musicxml"


def _show(line: bytes, limit: int = 100) -> str:
    text = line.decode("utf-8", "replace").rstrip("\r\n").strip()
    return repr(text if len(text) <= limit else text[:limit] + "...")


def first_difference(expected: bytes, got: bytes) -> str | None:
    """None when the bytes are identical, else 'line N: ...' for the first line that differs."""
    if expected == got:
        return None
    a, b = expected.splitlines(keepends=True), got.splitlines(keepends=True)
    for i, (x, y) in enumerate(zip(a, b), 1):
        if x != y:
            return f"line {i}: scores {_show(x)} / rebuild {_show(y)}"
    i = min(len(a), len(b)) + 1
    if len(a) > len(b):
        return f"line {i}: the rebuild ends here; scores continue with {_show(a[len(b)])}"
    return f"line {i}: scores end here; the rebuild continues with {_show(b[len(a)])}"


def compare(slugs: list[str], out: Path = OUT, scores: Path = SCORES) -> tuple[int, int, list[str]]:
    """(identical files, files compared, one report line per file) for the slugs' score files that
    exist in either directory."""
    lines: list[str] = []
    same = total = 0
    for slug in slugs:
        for name in score_names(slug):
            a, b = scores / name, out / name
            if not a.exists() and not b.exists():
                continue
            total += 1
            if not b.exists():
                lines.append(f"DIFFERS    {name}: not produced by the rebuild")
            elif not a.exists():
                lines.append(f"DIFFERS    {name}: produced by the rebuild, absent from content/scores")
            else:
                diff = first_difference(a.read_bytes(), b.read_bytes())
                if diff is None:
                    same += 1
                    lines.append(f"identical  {name}")
                else:
                    lines.append(f"DIFFERS    {name}: {diff}")
    return same, total, lines


def main(argv=None) -> int:
    getattr(sys.stdout, "reconfigure", lambda **_: None)(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    which = ap.add_mutually_exclusive_group(required=True)
    which.add_argument("--core30", action="store_true", help="the 30 pieces of the benchmark set core30")
    which.add_argument("--all", action="store_true", help="every slug of the merged catalog")
    a = ap.parse_args(argv)
    slugs = select(core30=a.core30)
    OUT.mkdir(parents=True, exist_ok=True)
    for slug in slugs:  # a stale file from an earlier run must not pass for a rebuilt one
        for name in score_names(slug):
            (OUT / name).unlink(missing_ok=True)
    print(f"rebuilding {len(slugs)} piece(s) into {OUT}", flush=True)
    rc = subprocess.call([sys.executable, "-I", str(HERE / "build.py"), "--out-dir", str(OUT), "--only", *slugs])
    same, total, lines = compare(slugs)
    for line in lines:
        print(line)
    print(f"{same}/{total} identical" + (f" (build.py exited {rc})" if rc else ""))
    return 0 if rc == 0 and same == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
