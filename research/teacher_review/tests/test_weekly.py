"""weekly.py: the whole job from the command line (synthetic dump, empty gallery, fake reviewers)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from .weekly_fixtures import REPO, cli_dump, fake_reviews, gallery_page, needs_engine, needs_pig

WEEKLY = Path(__file__).resolve().parents[1] / "weekly.py"
VALIDATION_SPLIT = REPO / "research" / "data" / "splits" / "pig_validation.json"


def run(*args, isolated=True):
    flags = ["-I"] if isolated else []
    return subprocess.run([sys.executable, *flags, str(WEEKLY), *args], cwd=REPO, capture_output=True, text=True,
                          encoding="utf-8", timeout=600)


def test_cli_imports_this_checkout():
    r = run("where")
    assert r.returncode == 0, r.stderr
    assert Path(r.stdout.strip()) == WEEKLY.parent.resolve()


def test_cli_without_isolation_still_runs():
    r = run("where", isolated=False)          # select.py must not shadow the standard library's select
    assert r.returncode == 0, r.stderr
    assert Path(r.stdout.strip()) == WEEKLY.parent.resolve()


def test_usage_errors_exit_2():
    assert run("build").returncode == 2                     # --date is required
    assert run("build", "--date", "2099-1-1").returncode == 2
    assert run("nonsense", "--date", "2099-01-01").returncode == 2


def _dirs(tmp_path):
    return ["--data-dir", str(tmp_path / "data"), "--results-dir", str(tmp_path / "results")]


def _build(tmp_path, *extra):
    gallery = tmp_path / "gallery"
    gallery.mkdir(exist_ok=True)
    dump = cli_dump(tmp_path / "dump.json")
    return run("build", "--date", "2099-01-01", "--dump", str(dump), "--gallery", str(gallery), *_dirs(tmp_path), *extra)


def _snapshot(root: Path) -> dict:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def test_build_is_deterministic_and_refuses_to_overwrite_outputs(tmp_path):
    r = _build(tmp_path)
    assert r.returncode == 0, r.stderr
    assert r.stdout.splitlines()[2].startswith("selected: lowconf ")
    day = tmp_path / "data" / "2099-01-01"
    for name in ("key.json", "launches.json", "launches.md", "selection.json"):
        assert (day / name).exists()
    launches = json.loads((day / "launches.json").read_text(encoding="utf-8"))
    assert {l["pool"] for l in launches} == {"lowconf", "control"}
    first = _snapshot(tmp_path / "data") | {f"results/{k}": v for k, v in _snapshot(tmp_path / "results").items()}
    assert _build(tmp_path, "--force").returncode == 0
    second = _snapshot(tmp_path / "data") | {f"results/{k}": v for k, v in _snapshot(tmp_path / "results").items()}
    assert first == second
    (day / "out" / "batch-01a.json").write_text("{}", encoding="utf-8")
    r = _build(tmp_path)
    assert r.returncode == 1 and "already holds reviewer outputs" in r.stderr


def test_build_refuses_a_gallery_from_another_engine(tmp_path):
    gallery = tmp_path / "gallery"
    gallery.mkdir()
    (gallery / "001.md").write_text(gallery_page("001", [(3, "R", "C4", 2, 40, [1, 1, 1], True)]), encoding="utf-8")
    dump = cli_dump(tmp_path / "dump.json")
    r = run("build", "--date", "2099-01-01", "--dump", str(dump), "--gallery", str(gallery), *_dirs(tmp_path))
    assert r.returncode == 1 and "001: the dump has no PIG piece 001" in r.stderr


def test_build_refuses_a_gallery_of_the_official_test_pieces(tmp_path):
    """Errors on the official PIG test pieces 001 to 030 must not seed hypotheses (coordinator decision for M7-A),
    so a reused gallery that holds one of them is refused even when no row of it is hard."""
    gallery = tmp_path / "gallery"
    gallery.mkdir()
    (gallery / "012.md").write_text(gallery_page("012", [(3, "R", "C4", 2, 40, [1, 3, 1], False)]), encoding="utf-8")
    dump = cli_dump(tmp_path / "dump.json")
    r = run("build", "--date", "2099-01-01", "--dump", str(dump), "--gallery", str(gallery), *_dirs(tmp_path))
    assert r.returncode == 1 and "official PIG test pieces 012" in r.stderr
    assert not (tmp_path / "data" / "2099-01-01" / "key.json").exists()


def test_build_refuses_a_dump_of_another_profile(tmp_path):
    r = _build(tmp_path, "--profile", "large")              # the synthetic dump was solved with medium
    assert r.returncode == 1 and "profile medium" in r.stderr and "profile large" in r.stderr
    assert not (tmp_path / "data" / "2099-01-01" / "key.json").exists()


@needs_pig
@needs_engine
def test_build_benches_the_validation_pieces_only(tmp_path):
    """Without --gallery the build runs bench into the day directory on a split file whose test subset is exactly
    the PIG validation pieces (bench cannot read pig_validation.json, a plain piece list), never on the official
    test pieces, and leaves the tracked benchmarks/latest.json alone. The synthetic dump has no PIG pieces, so the
    cross-check then refuses the gallery's hard rows."""
    tracked = REPO / "benchmarks" / "latest.json"
    before = tracked.read_bytes() if tracked.exists() else None
    dump = cli_dump(tmp_path / "dump.json")
    r = run("build", "--date", "2099-01-01", "--dump", str(dump), *_dirs(tmp_path))
    assert r.returncode == 1 and "the dump has no PIG piece 046" in r.stderr, r.stderr
    validation = json.loads(VALIDATION_SPLIT.read_text(encoding="utf-8"))["pieces"]
    bench = tmp_path / "data" / "2099-01-01" / "bench"
    split = json.loads((bench / "validation-split.json").read_text(encoding="utf-8"))
    assert split["splits"][split["default_split"]]["test"]["pieces"] == validation
    (card_path,) = (bench / "runs").glob("*-teacher-2099-01-01.json")
    card = json.loads(card_path.read_text(encoding="utf-8"))
    assert card["profile"] == "medium" and card["split"]["subset"] == "test"
    assert sorted([p["id"] for p in card["pieces"]] + [s["id"] for s in card["skipped"]]) == sorted(validation)
    pages = sorted(p.stem for p in (bench / "errors" / "teacher-2099-01-01").glob("*.md"))
    assert pages and set(pages) <= set(validation) and all(int(pid) > 30 for pid in pages)
    assert (bench / "latest.json").exists()
    assert (tracked.read_bytes() if tracked.exists() else None) == before


def test_collect_and_report(tmp_path):
    assert _build(tmp_path).returncode == 0
    day = tmp_path / "data" / "2099-01-01"

    def objections(ki):
        return [{"notes": [f"{ki['hands'][0]}2"], "kind": "hop", "severity": "warning", "problem": "Hop at speed.",
                 "fix": {f"{ki['hands'][0]}2": 2}}] if ki["set"] == "lowconf" else []

    fake_reviews(day, objections=objections)
    r = run("collect", "--date", "2099-01-01", *_dirs(tmp_path))
    assert r.returncode == 0, r.stdout + r.stderr
    docs = tmp_path / "docs"
    r = run("report", "--date", "2099-01-01", *_dirs(tmp_path), "--docs-dir", str(docs))
    assert r.returncode == 0, r.stdout + r.stderr
    md = (docs / "teacher-2099-01-01.md").read_text(encoding="utf-8")
    assert md.startswith("# Teacher review, 2099-01-01\n")
    results = tmp_path / "results" / "2099-01-01"
    summary = json.loads((results / "summary.json").read_text(encoding="utf-8"))
    assert summary["date"] == "2099-01-01" and summary["hypotheses"][0]["key"] == "hop"
    assert (results / "hypotheses.md").read_text(encoding="utf-8").splitlines()[1].startswith("| 2099-01-01 | Teacher review")
    assert sum(p.stat().st_size for p in results.rglob("*") if p.is_file()) < 400_000
