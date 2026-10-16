"""Gate the PDMX candidates the way the library's own new pieces are gated.

For each candidate in `content/_raw/pdmx/candidates.json` the gate writes the MusicXML of
its archive file to `content/_build/pdmx/<sha256>/` and checks:

1. the XSD of its own MusicXML version (3.1 or 4.0), by `validate.xsd_errors`;
2. the span check: no slice that one hand cannot strike (`check_spans.span_flags`);
3. zero lint law errors (L01 to L05) of the engine's own fingering at the medium and the
   large profile (`lint_gate.lint_piece`), the same rule as `gates.py --new`;
4. the level proposal of the frozen heuristic (`level.proposal`) at the tempo the file
   gives, or 100 quarter notes per minute when it gives none.

A candidate passes when every check passes. Each record keeps its reasons. The results go
to `content/_raw/pdmx/gate.jsonl`, one line per candidate, in completion order, so a run
can be stopped and resumed (`--resume` skips the candidates already recorded).

    content/.venv/Scripts/python.exe -I content/tools/pdmx_gate.py --limit 300
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
CONTENT = HERE.parent
RAW = CONTENT / "_raw" / "pdmx"
BUILD = CONTENT / "_build" / "pdmx"
SELECTED = RAW / "selected"
DEFAULT_TEMPO = 100.0

import check_spans  # noqa: E402
import scoreio  # noqa: E402
import xmlcheck as xc  # noqa: E402
import level  # noqa: E402
import lint_gate  # noqa: E402
import pdmx_screen  # noqa: E402
import pdmx_select  # noqa: E402
import validate  # noqa: E402


def first_tempo(xml: bytes) -> float | None:
    """The first <sound tempo="..."> of the score, when the file has one."""
    match = re.search(rb'<sound[^>]*\btempo="([0-9]+(?:\.[0-9]+)?)"', xml)
    return float(match.group(1)) if match else None


def gate_one(candidate: dict) -> dict:
    sha = candidate["sha256"]
    record: dict = {"sha256": sha, "title": candidate.get("title"), "composer": candidate.get("composer"),
                    "ok": False, "reasons": []}
    reasons = record["reasons"]
    try:
        data = pdmx_screen.xml_from_mxl((SELECTED / f"{sha}.mxl").read_bytes())
        work = BUILD / sha
        work.mkdir(parents=True, exist_ok=True)
        score = work / f"{sha}.musicxml"
        score.write_bytes(data)
        tempo = first_tempo(data)
        record["tempo"] = tempo if tempo is not None else DEFAULT_TEMPO
        record["tempoFromFile"] = tempo is not None
        xsd = validate.xsd_errors(score)
        if xsd is None:
            reasons.append("XSD schema unavailable")
        elif xsd:
            reasons.append(f"XSD: {xsd[0][:160]}")
        notes = xc.parse_musicxml(scoreio.plain_path(score))
        staves_with_notes = {str(nt.staff) for nt in notes.notes if nt.pitch is not None}
        if notes.staves != 2 or not {"1", "2"} <= staves_with_notes:
            reasons.append(f"not a grand staff with notes on both staves ({notes.staves} staves, "
                           f"notes on {sorted(staves_with_notes)})")
        flags = check_spans.span_flags(score, sha)
        record["spanFlags"] = len(flags)
        if flags:
            reasons.append(f"{len(flags)} slice(s) no hand can strike")
        record["lint"] = {}
        for profile in ("medium", "large"):
            report = lint_gate.lint_piece(score, profile)
            record["lint"][profile] = {"notes": report["notes"], "errors": report["errors"],
                                       "warnings": report["warnings"]}
            if report["errors"]:
                reasons.append(f"{report['errors']} lint law error(s) at {profile}")
        record["level"] = level.proposal(score, record["tempo"])
        if record["level"]["level"] not in range(1, 7):
            reasons.append(f"level proposal {record['level']['level']} out of range")
        record["ok"] = not reasons
    except Exception as exc:  # noqa: BLE001 - every failure is a recorded rejection
        reasons.append(f"{type(exc).__name__}: {str(exc)[:200]}")
    return record


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--candidates", type=Path, default=RAW / "candidates.json")
    ap.add_argument("--out", type=Path, default=RAW / "gate.jsonl")
    ap.add_argument("--limit", type=int, default=None, help="gate only the N best-rated candidates")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--resume", action="store_true", help="skip candidates already in --out")
    ap.add_argument("--grand-staff", action="store_true",
                    help="gate only the candidates the library rule admits (two staves, pdmx_select.grand_staff)")
    a = ap.parse_args(argv)
    candidates = json.loads(a.candidates.read_text(encoding="utf-8"))
    candidates.sort(key=lambda c: (-int(c.get("n_ratings") or 0), -float(c.get("rating") or 0), c["sha256"]))
    done: set[str] = set()
    if a.resume and a.out.exists():
        done = {json.loads(line)["sha256"] for line in a.out.open(encoding="utf-8")}
    todo = [c for c in candidates if c["sha256"] not in done
            and (not a.grand_staff or pdmx_select.grand_staff(c))]
    if a.limit is not None:
        todo = todo[: a.limit]
    print(f"gating {len(todo)} candidates ({len(done)} already recorded)", flush=True)
    started = time.time()
    passed = failed = 0
    mode = "a" if a.resume else "w"
    with a.out.open(mode, encoding="utf-8") as out, Pool(a.workers) as pool:
        for n, record in enumerate(pool.imap_unordered(gate_one, todo, chunksize=2), 1):
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            out.flush()
            if record["ok"]:
                passed += 1
            else:
                failed += 1
            if n % 100 == 0:
                rate = n / max(1.0, time.time() - started)
                print(f"  {n}/{len(todo)}: {passed} pass, {failed} fail ({rate:.1f}/s)", flush=True)
    print(f"done: {passed} pass, {failed} fail in {time.time() - started:.0f}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
