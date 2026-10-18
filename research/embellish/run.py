"""Scoring run: embellish library pieces at each density and measure what changed (issue #38).

For every manifest piece at the chosen levels (default 1 and 2) and for each density (none = the
plain score, light, playful):

  1. the embellisher writes `research/data/embellish/<slug>/<density>.musicxml` and the record of every
     inserted note, `<density>.inserted.json` (the plain copy is `none.musicxml`; the library score
     itself is only read);
  2. `check.verify` compares it with the plain score (untouched notes, strong positions);
  3. the built engine CLI reads it (`inspect`), fingers it at the beginner level and lints that
     fingering with the beginner rules:
         node packages/engine/dist/cli/main.js finger <file> --level beginner --format pig --out <pig>
         node packages/engine/dist/cli/main.js lint <file> --fingering <pig> --beginner --json
     (the default hand profile, large, as the lint's span tables);
  4. the frozen level heuristic (`content/tools/level.py`: features, score, propose) at the
     manifest tempo.

One JSON row per piece and density goes to `research/data/embellish/results.json`.

    research/.venv/Scripts/python.exe -I research/embellish/run.py [--levels 1 2] [--only SLUG ...] [--workers 4]

License: MIT.
"""
from __future__ import annotations

import argparse
import gzip
import json
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction as F
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
ROOT = RESEARCH.parent
if str(RESEARCH) not in sys.path:
    sys.path.insert(0, str(RESEARCH))
from embellish import core  # noqa: E402
from embellish.check import verify  # noqa: E402

TOOLS = ROOT / "content" / "tools"
if str(TOOLS) not in sys.path:
    sys.path.append(str(TOOLS))
import level as lv  # noqa: E402

MANIFEST = ROOT / "content" / "manifest.json"
CLI = ROOT / "packages" / "engine" / "dist" / "cli" / "main.js"
OUT = RESEARCH / "data" / "embellish"
LAWS = ("L01", "L02", "L03", "L04", "L05")
BEGINNER_ERRORS = ("L06", "L10")  # warnings for experts, errors with --beginner (lint/rules.ts)
DENSITIES = ("none", "light", "playful")


def score_text(entry: dict) -> str:
    path = ROOT / "content" / entry["files"]["score"]
    data = path.read_bytes()
    if path.suffix == ".gz":
        data = gzip.decompress(data)
    return data.decode("utf-8")


def node(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run([shutil.which("node") or "node", str(CLI), *args], capture_output=True, text=True,
                          encoding="utf-8", check=False, cwd=ROOT)


def engine(path: Path) -> dict:
    out: dict = {}
    insp = node(["inspect", str(path)])
    out["inspect_ok"] = insp.returncode == 0
    if not out["inspect_ok"]:
        out["inspect_error"] = (insp.stderr or insp.stdout).strip()[:300]
    pig = path.with_suffix(".pig.txt")
    fin = node(["finger", str(path), "--level", "beginner", "--format", "pig", "--out", str(pig)])
    if fin.returncode != 0:
        out["finger_error"] = fin.stderr.strip()[:300]
        return out
    lint = node(["lint", str(path), "--fingering", str(pig), "--beginner", "--json"])
    try:
        rep = json.loads(lint.stdout)
    except json.JSONDecodeError:
        out["lint_error"] = (lint.stderr or lint.stdout).strip()[:300]
        return out
    counts = rep.get("counts", {})
    out["lint"] = {"notes": rep["notes"], "errors": rep["errors"], "warnings": rep["warnings"],
                   "counts": {k: counts[k] for k in sorted(counts)},
                   "law_errors": sum(counts.get(k, 0) for k in LAWS),
                   "beginner_errors": sum(counts.get(k, 0) for k in BEGINNER_ERRORS)}
    return out


def level_of(path: Path, tempo: float) -> dict:
    f = lv.features(path, tempo)
    s = lv.score(f)
    return {"score": round(s, 3), "proposal": lv.propose(round(s, 3)),
            "features": {k: round(float(f[k]), 3) for k in lv.FEATURES}}


def _json(o):
    if isinstance(o, F):
        return str(o)
    raise TypeError(type(o))


def process(entry: dict) -> list[dict]:
    slug = entry["slug"]
    d = OUT / slug
    d.mkdir(parents=True, exist_ok=True)
    plain = score_text(entry)
    rows = []
    for density in DENSITIES:
        t0 = time.time()
        res = core.embellish(plain, density)
        path = d / f"{density}.musicxml"
        path.write_text(res.xml, encoding="utf-8", newline="")
        (d / f"{density}.inserted.json").write_text(json.dumps(
            {"slug": slug, "density": density, "refusal": res.refusal, "melodyVoice": res.melody_voice,
             "inserted": res.inserted}, indent=1, default=_json), encoding="utf-8")
        row = {"slug": slug, "title": entry["title"], "level": entry["level"], "collection": entry["collection"],
               "license": entry["source"]["license"], "density": density, "refusal": res.refusal,
               "melody_voice": res.melody_voice, "inserted": len(res.inserted),
               "figures": sum(1 for i in res.inserted if i["role"] != "return"),
               "by_rule": _count(res.inserted), "skipped": dict(res.skipped), "candidates": dict(res.candidates)}
        if density != "none" and not res.refusal:
            rep = verify(plain, res.xml, res.inserted, res.melody_voice)
            row["check"] = {"ok": rep.ok, "problems": rep.problems, "strong_total": rep.strong_total,
                            "strong_kept": rep.strong_kept}
        if density == "none" or (res.inserted and not res.refusal):
            row.update(engine(path))
            row["level_heuristic"] = level_of(path, entry["tempoBpm"])
        row["seconds"] = round(time.time() - t0, 2)
        rows.append(row)
    return rows


def _count(inserted: list[dict]) -> dict:
    out: dict = {}
    for i in inserted:
        if i["role"] != "return":
            out[i["rule"]] = out.get(i["rule"], 0) + 1
    return out


def main(argv=None) -> int:
    getattr(sys.stdout, "reconfigure", lambda **_: None)(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--levels", nargs="+", type=int, default=[1, 2])
    ap.add_argument("--only", nargs="+", metavar="SLUG")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", type=Path, default=OUT / "results.json")
    a = ap.parse_args(argv)
    if not CLI.exists():
        raise SystemExit(f"{CLI} is missing: pnpm --filter @digitus2/engine build")
    entries = json.loads(MANIFEST.read_text(encoding="utf-8"))
    chosen = [e for e in entries if e["level"] in a.levels and (not a.only or e["slug"] in a.only)]
    print(f"{len(chosen)} pieces", flush=True)
    rows: list[dict] = []
    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        for k, piece_rows in enumerate(pool.map(process, chosen), start=1):
            rows.extend(piece_rows)
            if k % 20 == 0:
                print(f"{k}/{len(chosen)}", flush=True)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(rows, indent=1, ensure_ascii=False, default=_json), encoding="utf-8")
    print(f"wrote {len(rows)} rows to {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
