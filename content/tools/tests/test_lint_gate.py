"""lint_gate.py: the engine's own fingering, linted at the medium and large profiles (L1 plan, Task 7).

fixtures/lint-report.json is the recorded output of

    node packages/engine/dist/cli/main.js finger content/scores/chopin-prelude-op28-no7.musicxml \
        --profile medium --format pig --out <pig>
    node packages/engine/dist/cli/main.js lint content/scores/chopin-prelude-op28-no7.musicxml \
        --fingering <pig> --json

(engine built from wt/library-150 on 2026-10-14): 4 law errors at medium, as in the plan's decision 6.
The real runs need the built engine CLI and are skipped without it.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
CONTENT = TOOLS.parent
sys.path.insert(0, str(TOOLS))
import lint_gate  # noqa: E402

FIXTURE = TOOLS / "tests" / "fixtures" / "lint-report.json"
TWINKLE = CONTENT / "scores" / "twinkle-twinkle-little-star.musicxml"
needs_cli = pytest.mark.skipif(not lint_gate.CLI.exists(),
                               reason="packages/engine/dist/cli/main.js missing: pnpm --filter @digitus2/engine build")


def test_parse_report_reads_the_recorded_output():
    report = lint_gate.parse_report(FIXTURE.read_text(encoding="utf-8"))
    assert report == {"notes": 168, "errors": 4, "warnings": 39,
                      "counts": {"L05": 4, "L07": 14, "L08": 16, "L09": 9, "L13": 1}}
    assert list(report["counts"]) == sorted(report["counts"]), "counts are sorted by rule id"


@pytest.mark.parametrize("text", ["", "digitus2: ENOENT", "[]", '{"notes": 3, "errors": 0}'])
def test_parse_report_refuses_what_is_not_a_lint_report(text):
    with pytest.raises(ValueError):
        lint_gate.parse_report(text)


def test_engine_src_sha256_is_stable_hex():
    a, b = lint_gate.engine_src_sha256(), lint_gate.engine_src_sha256()
    assert a == b and len(a) == 64 and all(c in "0123456789abcdef" for c in a)


def test_engine_src_sha256_covers_sources_not_tests(tmp_path):
    (tmp_path / "lint").mkdir()
    (tmp_path / "lint" / "rules.ts").write_bytes(b"export const a = 1;\n")
    (tmp_path / "lint" / "rules.test.ts").write_bytes(b"it('a', () => {});\n")
    base = lint_gate.engine_src_sha256(tmp_path)
    (tmp_path / "lint" / "rules.test.ts").write_bytes(b"it('b', () => {});\n")
    assert lint_gate.engine_src_sha256(tmp_path) == base, "a test file is not engine source"
    (tmp_path / "lint" / "rules.ts").write_bytes(b"export const a = 1;\r\n")
    assert lint_gate.engine_src_sha256(tmp_path) == base, "line endings are normalised to LF"
    (tmp_path / "lint" / "rules.ts").write_bytes(b"export const a = 2;\n")
    assert lint_gate.engine_src_sha256(tmp_path) != base
    (tmp_path / "lint" / "rules.ts").write_bytes(b"export const a = 1;\n")
    (tmp_path / "lint" / "rules.ts").rename(tmp_path / "lint" / "other.ts")
    assert lint_gate.engine_src_sha256(tmp_path) != base, "the paths are part of the hash"


def test_refuses_to_run_without_the_built_cli(tmp_path, monkeypatch):
    monkeypatch.setattr(lint_gate, "CLI", tmp_path / "missing" / "main.js")
    with pytest.raises(SystemExit, match="build the engine first"):
        lint_gate.lint_piece(TWINKLE, "medium")


def test_refuses_an_unknown_profile():
    with pytest.raises(ValueError):
        lint_gate.lint_piece(TWINKLE, "huge")


@needs_cli
@pytest.mark.parametrize("profile", lint_gate.PROFILES)
def test_twinkle_has_no_law_error(profile):
    report = lint_gate.lint_piece(TWINKLE, profile)
    assert report["errors"] == 0, report
    assert report["notes"] == 64 and set(report) == {"notes", "errors", "warnings", "counts"}


@needs_cli
def test_a_failing_run_raises_with_the_cli_message(tmp_path):
    with pytest.raises(RuntimeError, match="ENOENT"):
        lint_gate.lint_piece(tmp_path / "no-such-score.musicxml", "medium")


@needs_cli
def test_gate_record():
    slug = "twinkle-twinkle-little-star"
    record = lint_gate.gate([slug])[slug]
    assert set(record) == {"profiles", "scoreSha256", "engineSrcSha256", "cli"}
    assert set(record["profiles"]) == {"medium", "large"}
    assert all(record["profiles"][p]["errors"] == 0 for p in lint_gate.PROFILES)
    assert record["scoreSha256"] == hashlib.sha256(TWINKLE.read_bytes()).hexdigest()
    assert record["engineSrcSha256"] == lint_gate.engine_src_sha256()
    assert record["cli"] == "packages/engine/dist/cli/main.js"
    json.dumps(record)  # it goes into verification.json as it is
