"""Weekly teacher review (verification spec 3.12): build | collect | report | where.

Run by path from the repository root, never with -m: in a worktree the shared research/.venv puts the
main checkout's research/ on sys.path, so -m would run the main checkout's harness.

    research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py build --date 2026-10-14
    (the coordinator launches one Opus reviewer per row of research/data/teacher_review/weekly/<date>/launches.json)
    research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py collect --date 2026-10-14
    research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py report --date 2026-10-14

The hard-error set comes from a bench run on the PIG validation pieces (research/data/splits/pig_validation.json),
never on the official test pieces 001 to 030: their errors must not seed hypotheses. bench reads only split files
with named subsets, so build writes one whose test subset is exactly the validation pieces into the day's bench
directory (gitignored) and passes it with --split.
"""
from __future__ import annotations

import sys
from pathlib import Path

if __package__ in (None, ""):
    _here = Path(__file__).resolve().parent
    # without -I Python puts this directory first, where select.py would shadow the standard library's select
    sys.path[:] = [p for p in sys.path if Path(p or ".").resolve() != _here]
    sys.path.insert(0, str(_here.parent))

import argparse  # noqa: E402
import datetime  # noqa: E402
import json  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402

import teacher_review  # noqa: E402
from teacher_review import dispatch, gallery, report, select  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
ENGINE_CLI = REPO / "packages" / "engine" / "dist" / "cli" / "main.js"
ENGINE_DUMP = HERE / "engine_dump.mjs"
SPLIT_FILE = "validation-split.json"


def _date(text: str) -> str:
    """YYYY-MM-DD, kept as written (argparse turns the ValueError into a usage error, exit 2)."""
    if datetime.date.fromisoformat(text).isoformat() != text:
        raise ValueError(text)
    return text


def _err(msg: str) -> int:
    print(f"weekly: {msg}", file=sys.stderr)
    return 1


def _node() -> str:
    node = shutil.which("node")
    if not node:
        raise SystemExit("weekly: node is not on PATH")
    return node


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, encoding="utf-8")


def _rel(path: Path) -> str:
    return dispatch._repo_relative(path, REPO)


def run_bench(day: Path, args) -> tuple[Path, dict]:
    """bench --profile <profile> on the PIG validation pieces into <day>/bench (never benchmarks/): the scorecard
    goes to bench/runs, the gallery to bench/errors/teacher-<date>, latest.json to bench/."""
    label = f"teacher-{args.date}"
    bench_dir = day / "bench"
    runs, pages = bench_dir / "runs", bench_dir / "errors" / label
    split = bench_dir / SPLIT_FILE
    runs.mkdir(parents=True, exist_ok=True)
    spec = select.validation_bench_split()
    split.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    # a rebuild must read this run's scorecard and pages only (bench names the scorecard by commit)
    for old in [*runs.glob(f"*-{label}.json"), *(pages.glob("*.md") if pages.exists() else [])]:
        old.unlink()
    cmd = [_node(), str(ENGINE_CLI), "bench", "--gold", "research/data/pig", "--split", _rel(split),
           "--subset", "test", "--profile", args.profile, "--label", label, "--out", _rel(runs)]
    if args.weight_set:
        usage = _run([_node(), str(ENGINE_CLI)])
        if "--weights" not in usage.stdout + usage.stderr:
            raise SystemExit("weekly: this engine's bench has no --weights (M3 not merged); omit --weight-set")
        cmd += ["--weights", args.weight_set]
    r = _run(cmd)
    if r.returncode != 0:
        raise SystemExit(f"weekly: bench failed\n{r.stderr}")
    cards = sorted(runs.glob(f"*-{label}.json"))
    if len(cards) != 1:
        raise SystemExit(f"weekly: expected one bench scorecard *-{label}.json in {runs}, found {len(cards)}")
    card = json.loads(cards[0].read_text(encoding="utf-8"))
    pieces = spec["splits"][spec["default_split"]]["test"]["pieces"]
    return pages, {"label": label, "gitSha": card.get("gitSha"), "profile": card.get("profile"),
                   "gen": card["macro"]["gen"], "hardErrorRate": card["macro"]["hardErrorRate"],
                   "weightsHash": card.get("weightsHash"), "split": _rel(select.VALIDATION_SPLIT),
                   "pieces": len(pieces), "skipped": [s["id"] for s in card.get("skipped", [])]}


def run_dump(day: Path, args, pig_ids: list[str]) -> Path:
    out = day / "dump.json"
    cmd = [_node(), str(ENGINE_DUMP), "--out", _rel(out), "--manifest", "content/manifest.json", "--tritone",
           "--profile", args.profile]
    if pig_ids:
        cmd += ["--pig-dir", "research/data/pig", "--pig-pieces", ",".join(pig_ids)]
    if args.weight_set:
        cmd += ["--weight-set", args.weight_set]
    r = _run(cmd)
    if r.returncode != 0:
        raise SystemExit(f"weekly: engine dump failed\n{r.stderr}")
    return out


def build(args) -> int:
    day = Path(args.data_dir) / args.date
    out_dir = day / "out"
    if out_dir.exists() and any(out_dir.glob("*.json")) and not args.force:
        return _err(f"{out_dir} already holds reviewer outputs; use --force to rebuild")
    day.mkdir(parents=True, exist_ok=True)
    seed = args.seed if args.seed is not None else int(args.date.replace("-", ""))
    if args.gallery:
        gallery_dir, bench = Path(args.gallery), {"label": None}
    else:
        gallery_dir, bench = run_bench(day, args)
    rows = gallery.read_gallery(gallery_dir)
    hard_pages = sorted(pid for pid, rs in rows.items() if any(r.hard for r in rs))
    dump_path = Path(args.dump) if args.dump else run_dump(day, args, hard_pages)
    dump = json.loads(dump_path.read_text(encoding="utf-8"))
    if dump["profile"] != args.profile or (args.weight_set and dump["weightSet"] != args.weight_set):
        return _err(f"the dump was solved with profile {dump['profile']}, weight set {dump['weightSet']}; this build "
                    f"asks for profile {args.profile}" + (f", weight set {args.weight_set}" if args.weight_set else ""))
    problems = gallery.check_against_dump(rows, dump)
    if problems:
        return _err("the gallery does not describe the dumped engine:\n  " + "\n  ".join(problems[:20]))
    try:
        sel = select.select_all(dump, rows, seed)
    except ValueError as exc:                   # a gallery of the official PIG test pieces
        return _err(str(exc))
    (day / "selection.json").write_text(json.dumps(sel, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")
    passages = select.build_passages(sel["records"], dump)
    meta = {"engineVersion": dump["engineVersion"], "profile": dump["profile"], "weightSet": dump["weightSet"],
            "weightsHash": dump["weightsHash"], "lintRules": dump["lintRules"], "bench": bench, "seed": seed,
            "dump": _rel(dump_path), "skipped": sel["skipped"], "counts": sel["counts"]}
    key = dispatch.write_day(day, Path(args.results_dir) / args.date, sel["records"], passages, seed=seed,
                             date=args.date, meta=meta)
    kinds = {"library": 0, "tritone": 0, "pig": 0}
    for p in dump["pieces"]:
        kinds["pig" if p["source"] == "pig" else "tritone" if p.get("transpose") else "library"] += 1
    n_hard = sum(r.hard for rs in rows.values() for r in rs)
    ran = f"{bench['label']} on {bench['pieces']} PIG validation pieces" if bench["label"] else "not run (gallery reused)"
    print(f"bench: {ran}, gallery {gallery_dir.as_posix()} ({len(rows)} pages, {n_hard} hard-error rows)")
    print(f"dump: {len(dump['pieces'])} pieces ({kinds['library']} library, {kinds['tritone']} tritone, {kinds['pig']} PIG), "
          f"engine {dump['engineVersion']}, profile {dump['profile']}, weight set {dump['weightSet']}")
    c, s = sel["counts"], sel["skipped"]
    print(f"selected: lowconf {c['lowconf']}, harderr {c['harderr']}, control {c['control']}, planted {c['planted']}, "
          f"recall {c['recall']} (hard errors skipped: unusable grid {s['unusable grid']}, not in the quantised piece "
          f"{s['not in the quantised piece']}, not covered {s['not covered']})")
    pools: dict[str, set[str]] = {}
    for b in key["batches"].values():
        pools.setdefault(b["pool"], set()).add(b["file"].rsplit("batch-", 1)[1][:2])
    desc = ", ".join(f"{pool} {len(nums)} x{2 if pool != 'control' else 1}" for pool, nums in pools.items())
    print(f"batches: {sum(len(v) for v in pools.values())} ({desc}) -> {len(key['batches'])} reviewer launches, "
          f"{len(key['items'])} item reviews")
    print(f"launches: {(day / 'launches.md').as_posix()}")
    return 0


def collect(args) -> int:
    rep = dispatch.collect_outputs(Path(args.data_dir) / args.date)
    print(f"weekly collect {args.date}: {rep['n_items']} items, {len(rep['missing_items'])} missing, "
          f"{len(rep['problems'])} problems")
    for p in rep["problems"][:40]:
        print("  -", p)
    return 1 if rep["missing_items"] else 0


def report_cmd(args) -> int:
    day = report.load_day(Path(args.data_dir) / args.date)
    if day.collect_report["missing_items"] and not args.allow_missing:
        return _err(f"{len(day.collect_report['missing_items'])} items are missing; relaunch or pass --allow-missing")
    pilot = json.loads((HERE / "results" / "summary.json").read_text(encoding="utf-8"))
    results = Path(args.results_dir)
    prior = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(results.glob("*/summary.json"))
             if p.parent.name < args.date]
    md, summary, rows = report.build_report(day, pilot, prior)
    blob = json.dumps(summary, indent=1, ensure_ascii=False)
    try:
        report.audit_no_pig(day, md, blob, rows)
    except report.PigLeak as leak:
        return _err(f"PIG data would leak into a tracked file: {leak}")
    docs = Path(args.docs_dir)
    docs.mkdir(parents=True, exist_ok=True)
    (docs / f"teacher-{args.date}.md").write_text(md, encoding="utf-8", newline="\n")
    (results / args.date).mkdir(parents=True, exist_ok=True)
    (results / args.date / "summary.json").write_text(blob + "\n", encoding="utf-8", newline="\n")
    header = (f"<!-- Teacher review {args.date}: rows for the table in docs/experiments.md. The coordinator appends them "
              "after the table's last row and runs prettier. Generated by research/teacher_review/weekly.py report. -->\n")
    (results / args.date / "hypotheses.md").write_text(header + (rows or "<!-- no group reached three consistent objections -->\n"),
                                                       encoding="utf-8", newline="\n")
    print(f"report: {(docs / f'teacher-{args.date}.md').as_posix()}, {len(summary['hypotheses'])} hypotheses")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("build", "collect", "report"):
        p = sub.add_parser(name)
        p.add_argument("--date", required=True, type=_date)
        p.add_argument("--data-dir", default=str(REPO / "research" / "data" / "teacher_review" / "weekly"))
        p.add_argument("--results-dir", default=str(HERE / "results" / "weekly"))
        if name == "build":
            p.add_argument("--seed", type=int)
            p.add_argument("--profile", default="medium")
            p.add_argument("--weight-set")
            p.add_argument("--dump")
            p.add_argument("--gallery")
            p.add_argument("--force", action="store_true")
        if name == "report":
            p.add_argument("--docs-dir", default=str(REPO / "docs" / "reviews"))
            p.add_argument("--allow-missing", action="store_true")
    sub.add_parser("where")
    args = ap.parse_args(argv)
    if args.cmd == "where":
        print(Path(teacher_review.__file__).resolve().parent)
        return 0
    return {"build": build, "collect": collect, "report": report_cmd}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
