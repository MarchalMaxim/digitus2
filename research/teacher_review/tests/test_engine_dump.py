"""engine_dump.mjs: per-note engine output through the built engine's public API only."""
from __future__ import annotations

import json

import pytest

from .weekly_fixtures import needs_engine, needs_pig, run_dump

pytestmark = needs_engine

SLUGS = "twinkle-twinkle-little-star,happy-birthday,burgmuller-op100-no3-pastorale,chopin-waltz-op69-no2"


@pytest.fixture(scope="module")
def small(tmp_path_factory):
    out = tmp_path_factory.mktemp("dump") / "small.json"
    r = run_dump(out, "--manifest", "content/manifest.json", "--slugs", SLUGS, "--tritone")
    assert r.returncode == 0, r.stderr
    return json.loads(out.read_text(encoding="utf-8"))


def _piece(dump, pid):
    return next(p for p in dump["pieces"] if p["id"] == pid)


def test_meta_and_piece_order(small):
    assert small["version"] == 1 and small["profile"] == "medium"
    assert isinstance(small["engineVersion"], str) and isinstance(small["weightSet"], str)
    assert len(small["weightsHash"]) == 16
    assert {"L01", "L05", "L11", "L14"} <= set(small["lintRules"])
    assert [p["id"] for p in small["pieces"]] == [
        "twinkle-twinkle-little-star", "twinkle-twinkle-little-star@tritone",
        "happy-birthday", "happy-birthday@tritone",
        "burgmuller-op100-no3-pastorale", "burgmuller-op100-no3-pastorale@tritone",
        "chopin-waltz-op69-no2", "chopin-waltz-op69-no2@tritone"]
    used = {x.split(":")[0] for p in small["pieces"] for n in p["notes"] for x in n["lint"]}
    assert used <= set(small["lintRules"])


def test_twinkle_notes_measures_and_engine_fields(small):
    p = _piece(small, "twinkle-twinkle-little-star")
    assert (p["source"], p["slug"], p["level"], p["transpose"]) == ("library", "twinkle-twinkle-little-star", 1, 0)
    assert p["file"] == "content/scores/twinkle-twinkle-little-star.musicxml"
    assert p["divisions"] == 10080 and p["tempoMap"][0]["qpm"] == 100
    assert [m["number"] for m in p["measures"]] == [str(i) for i in range(1, 13)]
    assert all((m["beats"], m["beatType"], m["lengthTicks"]) == (4, 4, 40320) for m in p["measures"])
    notes = p["notes"]
    assert len(notes) == 64 and sum(n["hand"] == "R" for n in notes) == 42
    assert [n["index"] for n in notes] == list(range(64))
    first = notes[0]
    assert (first["id"], first["hand"], first["midi"], first["pitch"]) == ("n0", "R", 60, "C4")
    assert (first["measureIndex"], first["measure"], first["beatQ"], first["durQ"]) == (0, "1", 0, 1)
    assert p["rests"] == []
    for n in notes:
        assert n["finger"] in (1, 2, 3, 4, 5) and 0 <= n["confidence"] <= 1
        assert len(n["gaps"]) == 5 and n["gaps"][n["finger"] - 1] == 0
        assert all(g is None or g >= 0 for g in n["gaps"])


def test_pickup_measure_is_kept_as_written(small):
    p = _piece(small, "happy-birthday")
    assert len(p["notes"]) == 43 and len(p["measures"]) == 9
    m0 = p["measures"][0]
    assert (m0["number"], m0["startTick"], m0["lengthTicks"], m0["beats"], m0["beatType"]) == ("0", 0, 10080, 3, 4)
    n0 = p["notes"][0]
    assert (n0["measure"], n0["beatQ"], n0["durQ"], n0["pitch"]) == ("0", 0, 0.75, "D4")


def test_grace_notes_keep_document_order(small):
    p = _piece(small, "burgmuller-op100-no3-pastorale")
    order = [n["id"] for n in p["notes"]]
    notes = {n["id"]: n for n in p["notes"]}
    assert sum(n["isGrace"] for n in p["notes"]) == 9
    grace, main = notes["n17"], notes["n18"]
    assert grace["isGrace"] and not main["isGrace"] and grace["durQ"] == 0
    assert grace["chordId"] == main["chordId"] and grace["sourceIndex"] < main["sourceIndex"]
    assert order.index("n18") < order.index("n17")      # the engine sorts by pitch: E5 before the grace F#5


def test_rests_are_silences_of_an_eighth_or_more(small):
    pastorale = _piece(small, "burgmuller-op100-no3-pastorale")
    assert [(r["hand"], r["measure"], r["beatQ"]) for r in pastorale["rests"]] == [
        ("R", "10", 2.5), ("L", "10", 2.5), ("L", "15", 0.0), ("L", "18", 2.5), ("L", "28", 1.0), ("L", "28", 2.5)]
    assert [r["durQ"] for r in pastorale["rests"][:2]] == [0.5, 0.5]
    waltz = _piece(small, "chopin-waltz-op69-no2")
    assert [(r["hand"], r["measure"], r["beatQ"], r["durQ"]) for r in waltz["rests"]] == [
        ("L", "14", 2.0, 1.0), ("L", "16", 2.0, 1.0), ("L", "30", 2.0, 1.0)]


def test_tritone_copy_is_transposed_and_solved_again(small):
    orig = _piece(small, "twinkle-twinkle-little-star")
    tt = _piece(small, "twinkle-twinkle-little-star@tritone")
    assert tt["transpose"] == 6 and tt["slug"] == orig["slug"] and tt["level"] == 1
    assert [n["id"] for n in tt["notes"]] == [n["id"] for n in orig["notes"]]
    assert [n["midi"] for n in tt["notes"]] == [n["midi"] + 6 for n in orig["notes"]]
    assert all(n["finger"] in (1, 2, 3, 4, 5) for n in tt["notes"])


def test_output_is_deterministic(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    for out in (a, b):
        r = run_dump(out, "--manifest", "content/manifest.json", "--slugs", "twinkle-twinkle-little-star")
        assert r.returncode == 0, r.stderr
    assert a.read_bytes() == b.read_bytes()


def test_usage_errors_exit_2_and_write_nothing(tmp_path):
    out = tmp_path / "x.json"
    assert run_dump(out).returncode == 2                                     # nothing to dump
    assert run_dump(out, "--manifest", "content/manifest.json", "--slugs", "no-such-piece").returncode == 2
    assert run_dump(out, "--manifest", "content/manifest.json", "--profile", "huge").returncode == 2
    assert run_dump(out, "--manifest", "content/manifest.json", "--slugs", "twinkle-twinkle-little-star",
                    "--weight-set", "no-such-set").returncode == 2
    assert not out.exists()


@needs_pig
def test_pig_piece_uses_the_first_annotation_file(tmp_path):
    out = tmp_path / "pig.json"
    r = run_dump(out, "--pig-dir", "research/data/pig", "--pig-pieces", "001")
    assert r.returncode == 0, r.stderr
    (p,) = json.loads(out.read_text(encoding="utf-8"))["pieces"]
    assert (p["id"], p["source"], p["pigId"], p["file"]) == ("pig:001", "pig", "001", "001-1_fingering.txt")
    assert len(p["notes"]) == 469 and p["measures"] == [] and p["rests"] == []
    n0 = p["notes"][0]
    assert (n0["id"], n0["pitch"], n0["measure"], n0["beatQ"]) == ("0", "C4", None, None)
