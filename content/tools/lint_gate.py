"""Lint the engine's own fingering of a library score at the medium and large profiles (L1 plan, Task 7).

For every profile in PROFILES the built engine CLI fingers the score and lints that fingering:

    node packages/engine/dist/cli/main.js finger <score> --profile <p> --format pig --out content/_build/lint/<slug>.<p>.pig.txt
    node packages/engine/dist/cli/main.js lint <score> --fingering <that pig> --json

A law error (lint severity "error") at either profile fails the gate for a new piece (gates.py):
medium is the binding profile, and large, the solver's default, is required too, because the
engine's own test "every library hand that has a fully legal fingering gets one" solves every
library file at the default profile (decision 6). `digitus2 lint` has no --profile option yet, so
the laws are checked with lint's default (large) span tables; the fingering checked is the
profile's own. Once the CLI gains `lint --profile`, the lint call here adds it (deferred item e).

The record of a piece (verification[slug]["lint"], written by gates.py):

    {profiles: {medium: {notes, errors, warnings, counts}, large: {...}},
     scoreSha256,       SHA-256 of the linted score, so a stale record is detectable
     engineSrcSha256,   engine_src_sha256(): which engine source produced the fingering
     cli}               the CLI used, relative to the repository root

Run from the repository root; the CLI is the built one (pnpm --filter @digitus2/engine build), never
the TypeScript sources. Standard library only, plus `node` on PATH.

    python -I content/tools/lint_gate.py SLUG ...   # print the records of these pieces as JSON
License: MIT.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONTENT = HERE.parent
ROOT = CONTENT.parent
SCORES = CONTENT / "scores"
ENGINE_SRC = ROOT / "packages" / "engine" / "src"
CLI: Path = ROOT / "packages" / "engine" / "dist" / "cli" / "main.js"
OUT = CONTENT / "_build" / "lint"
PROFILES = ("medium", "large")
ALL_PROFILES = ("child", "small", "medium", "large")
WORKERS = max(1, min(4, os.cpu_count() or 1))  # node processes at once; the machine is shared


def parse_report(text: str) -> dict:
    """{notes, errors, warnings, counts} of a `digitus2 lint --json` output; counts sorted by rule.

    ValueError when the text is not such a report."""
    try:
        report = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"not JSON: {exc}") from exc
    if not isinstance(report, dict):
        raise ValueError(f"not a lint report: a JSON {type(report).__name__}")
    missing = [k for k in ("notes", "errors", "warnings", "counts") if k not in report]
    if missing:
        raise ValueError(f"not a lint report: no {', '.join(missing)}")
    counts = report["counts"]
    if not isinstance(counts, dict):
        raise ValueError("not a lint report: counts is not an object")
    return {"notes": report["notes"], "errors": report["errors"], "warnings": report["warnings"],
            "counts": {rule: counts[rule] for rule in sorted(counts)}}


def require_cli() -> Path:
    cli = Path(CLI)
    if not cli.exists():
        raise SystemExit(f"{cli} is missing: build the engine first: pnpm --filter @digitus2/engine build")
    return cli


def _node() -> str:
    node = shutil.which("node")
    if node is None:
        raise SystemExit("node is not on PATH")
    return node


def _run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run([_node(), str(require_cli()), *args], capture_output=True, text=True,
                          encoding="utf-8", check=False, cwd=ROOT)


def lint_piece(score: Path, profile: str) -> dict:
    """{notes, errors, warnings, counts}: the lint of the engine's own fingering of `score` at `profile`."""
    if profile not in ALL_PROFILES:
        raise ValueError(f"profile must be one of {ALL_PROFILES}, not {profile!r}")
    require_cli()
    score = Path(score).resolve()
    slug = score.name.removesuffix(".musicxml")
    OUT.mkdir(parents=True, exist_ok=True)
    pig = OUT / f"{slug}.{profile}.pig.txt"
    fingered = _run(["finger", str(score), "--profile", profile, "--format", "pig", "--out", str(pig)])
    if fingered.returncode != 0:
        raise RuntimeError(f"digitus2 finger {score.name} --profile {profile} exited {fingered.returncode}: "
                           f"{fingered.stderr.strip()}")
    linted = _run(["lint", str(score), "--fingering", str(pig), "--json"])  # exit 1 when errors exist
    try:
        return parse_report(linted.stdout)
    except ValueError as exc:
        raise RuntimeError(f"digitus2 lint {score.name} (profile {profile}) exited {linted.returncode} without "
                           f"a JSON report ({exc}); stderr: {linted.stderr.strip()}") from exc


def engine_src_sha256(src: Path = ENGINE_SRC) -> str:
    """SHA-256 over the engine's non-test TypeScript sources: every `*.ts` under `src` except
    `*.test.ts`, in sorted relative-path order, each as its POSIX path and the SHA-256 of its
    content with line endings normalised to LF."""
    h = hashlib.sha256()
    files = sorted((p for p in Path(src).rglob("*.ts") if p.is_file() and not p.name.endswith(".test.ts")),
                   key=lambda p: p.relative_to(src).as_posix())
    for p in files:
        body = p.read_bytes().replace(b"\r\n", b"\n")
        h.update(f"{p.relative_to(src).as_posix()}\0{hashlib.sha256(body).hexdigest()}\n".encode("utf-8"))
    return h.hexdigest()


def dist_is_older_than_src(src: Path = ENGINE_SRC) -> bool:
    """A non-test engine source is newer than the built CLI (dist/cli/run.js, which every build
    rewrites): the gate would lint with an engine that is not the recorded source."""
    built = Path(CLI).with_name("run.js")
    if not built.exists():
        return True
    newest = max((p.stat().st_mtime for p in Path(src).rglob("*.ts") if not p.name.endswith(".test.ts")),
                 default=0.0)
    return newest > built.stat().st_mtime


def gate(slugs: list[str]) -> dict[str, dict]:
    """{slug: {profiles: {medium, large}, scoreSha256, engineSrcSha256, cli}} for content/scores/<slug>.musicxml."""
    require_cli()
    scores = {s: SCORES / f"{s}.musicxml" for s in slugs}
    missing = [s for s, p in scores.items() if not p.exists()]
    if missing:
        raise SystemExit(f"no score (build it first): {', '.join(missing)}")
    shas = {s: hashlib.sha256(p.read_bytes()).hexdigest() for s, p in scores.items()}
    src_sha = engine_src_sha256()
    jobs = [(s, prof) for s in slugs for prof in PROFILES]
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        reports = dict(zip(jobs, pool.map(lambda job: lint_piece(scores[job[0]], job[1]), jobs)))
    cli = Path(CLI).resolve().relative_to(ROOT).as_posix()
    return {s: {"profiles": {prof: reports[(s, prof)] for prof in PROFILES}, "scoreSha256": shas[s],
                "engineSrcSha256": src_sha, "cli": cli} for s in slugs}


def main(argv=None) -> int:
    getattr(sys.stdout, "reconfigure", lambda **_: None)(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slugs", nargs="+", metavar="SLUG")
    a = ap.parse_args(argv)
    print(json.dumps(gate(a.slugs), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
