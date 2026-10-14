"""dispatch: blinded weekly batches, the key, the reviewer launches and collection."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from teacher_review import build_benchmark as bb
from teacher_review.dispatch import (FENCE, WEEKLY_LEGEND, WRAPPER, batch_text, collect_outputs, plan_batches,
                                     write_day)
from teacher_review.render import LEGEND

from .conftest import make_passage
from .weekly_fixtures import REPO, fake_reviews

HERE = Path(__file__).resolve().parents[1]


def test_weekly_legend_states_what_dur_means():
    flat = " ".join(WEEKLY_LEGEND.split())
    assert ("dur is the sounding length in the source; pianists release early or use the pedal, so a finger may be "
            "re-used after a long note unless the notes are slurred.") in flat
    assert "A chord's dur is its longest note." in flat and "a half note in 2/2" in flat and "Bar 0 is an upbeat" in flat
    assert "come from the performance timing" not in flat


def test_wrapper_is_the_readme_prompt():
    readme = (HERE / "README.md").read_text(encoding="utf-8").split("## Dispatch", 1)[1]
    quoted = " ".join(ln[2:] for ln in readme.splitlines() if ln.startswith("> "))
    quoted = quoted.replace("`<batch file>`", "`X`").replace("`<output file>`", "`Y`")
    assert " ".join(WRAPPER.format(batch_file="X", out_file="Y", n=8).split()) == " ".join(quoted.split())


def _records():
    recs = [{"passage": f"lc{k:02d}", "set": "lowconf", "source": "library"} for k in range(1, 21)]
    recs += [{"passage": f"he{k:02d}", "set": "harderr", "source": "pig"} for k in range(1, 17)]
    recs += [{"passage": f"ct{k:02d}", "set": "control", "source": "library"} for k in range(1, 11)]
    recs += [{"passage": f"pf{k:02d}", "set": "planted", "source": "library", "twin_of": f"ct{k:02d}"} for k in range(1, 5)]
    recs += [{"passage": f"rc{k:02d}", "set": "recall", "source": "library", "twin_of": f"ct{k + 4:02d}"} for k in range(1, 5)]
    return recs


def test_plan_batches_sizes_twins_and_framings():
    recs = _records()
    plan = plan_batches(recs, seed=3)
    assert [(b["number"], b["pool"], b["framings"]) for b in plan] == [
        (1, "lowconf", ["a", "b"]), (2, "lowconf", ["a", "b"]), (3, "lowconf", ["a", "b"]),
        (4, "harderr", ["a", "b"]), (5, "harderr", ["a", "b"]),
        (6, "control", ["b"]), (7, "control", ["a"]), (8, "control", ["b"])]
    sizes = {pool: sorted(len(b["passages"]) for b in plan if b["pool"] == pool) for pool in ("lowconf", "harderr", "control")}
    assert sizes == {"lowconf": [6, 7, 7], "harderr": [8, 8], "control": [6, 6, 6]}
    base = {r["passage"]: r.get("twin_of") or r["passage"] for r in recs}
    for b in plan:
        bases = [base[p] for p in b["passages"]]
        assert len(bases) == len(set(bases))
    assert plan_batches(recs, seed=3) == plan
    many_twins = [{"passage": "ct01", "set": "control"}, {"passage": "pf01", "set": "planted", "twin_of": "ct01"},
                  {"passage": "rc01", "set": "recall", "twin_of": "ct01"}]
    assert len(plan_batches(many_twins, seed=1)) == 3        # three variants of one passage need three batches


def test_plan_batches_balanced_for_every_seed():
    # Decision 11: 20 -> 7/7/6, 16 -> 8/8, 18 -> 6/6/6 whatever the seed. Placing passages in shuffled order with
    # the twins scattered left about one seed in five with a 5/6/7 control pool (the real 2026-10-14 seed among them).
    recs = _records()
    three = recs[:-1] + [{"passage": "rc04", "set": "recall", "source": "library", "twin_of": "ct01"}]   # ct01 x3
    for records in (recs, three):
        for seed in list(range(200)) + [20261014]:
            for pool in ("lowconf", "harderr", "control"):
                plan = [b for b in plan_batches(records, seed) if b["pool"] == pool]
                sizes = sorted(len(b["passages"]) for b in plan)
                assert sizes[-1] - sizes[0] <= 1 and sizes[-1] <= 8, (seed, pool, sizes)
                bases = [[r.get("twin_of") or r["passage"] for r in records if r["passage"] in b["passages"]] for b in plan]
                assert all(len(x) == len(set(x)) for x in bases), (seed, pool)


def _small_day(tmp_path):
    recs, passages = _small_inputs()
    key = write_day(tmp_path / "day", tmp_path / "results", recs, passages, seed=5, date="2099-01-01",
                    meta={"engineVersion": "test"}, repo=tmp_path)
    return key


def _small_inputs():
    recs, passages = [], {}
    sets = [("lc", "lowconf", "library", 5), ("he", "harderr", "pig", 3), ("ct", "control", "library", 3)]
    for prefix, set_name, source, n in sets:
        for k in range(1, n + 1):
            pid = f"{prefix}{k:02d}"
            recs.append({"passage": pid, "set": set_name, "source": source, "piece": f"piece-{pid}", "title": "Test piece",
                         "level": 2, "hands": ["R"]})
            p = make_passage([(i * 0.5, 0.5, [60 + (i + k) % 12], [1 + i % 5]) for i in range(12)], pid=pid)
            p.notes_meta["engine"] = {nid: {"id": f"n{i}", "finger": f, "confidence": 0.5, "lint": []}
                                      for i, (nid, _, f, _, _) in enumerate(p.notes("R"))}
            passages[pid] = p
    recs.append({"passage": "rc01", "set": "recall", "source": "library", "piece": "piece-ct01@tritone", "title": "Test piece",
                 "level": 2, "hands": ["R"], "twin_of": "ct01", "transpose": 6})
    passages["rc01"] = passages["ct01"].copy()
    recs.append({"passage": "pf01", "set": "planted", "source": "library", "piece": "piece-ct02", "title": "Test piece",
                 "level": 2, "hands": ["R"], "twin_of": "ct02",
                 "faults": [{"kind": "hop_at_speed", "hand": "R", "notes": ["R3", "R4"], "anchor": "R4",
                             "before": {"R3": 3, "R4": 4}, "after": {"R3": 3, "R4": 3}}]})
    passages["pf01"] = passages["ct02"].copy()
    passages["pf01"].set_finger("R4", 3)
    return recs, passages


def test_write_day_files_blinding_and_key(tmp_path):
    key = _small_day(tmp_path)
    day = tmp_path / "day"
    assert sorted(p.name for p in day.glob("batch-*.md")) == [
        "batch-01a.md", "batch-01b.md", "batch-02a.md", "batch-02b.md", "batch-03a.md", "batch-04b.md"]
    assert len(key["items"]) == 5 * 2 + 3 * 2 + 5
    words = ("lowconf", "harderr", "control", "recall", "planted", "tritone", "Test piece", "piece-",
             "lc0", "he0", "ct0", "rc0", "pf0")
    for bid, b in key["batches"].items():
        text = (day / f"batch-{bid}.md").read_text(encoding="utf-8")
        body = text.split("## Passages", 1)[1]
        assert not [w for w in words if w in body], bid
        assert body.count(FENCE) == 2 * len(b["items"])
        assert text.rstrip().endswith(f"Output file: day/out/batch-{bid}.json")
        assert WEEKLY_LEGEND.strip() in text and text.startswith(f"# Batch {bid}\n")
        assert len(text) == b["chars"]
    a = [key["items"][i]["passage"] for i in key["batches"]["01a"]["items"]]
    b_ = [key["items"][i]["passage"] for i in key["batches"]["01b"]["items"]]
    assert sorted(a) == sorted(b_) and set(key["batches"]["01a"]["items"]).isdisjoint(key["batches"]["01b"]["items"])
    assert {key["items"][i]["reviewer"] for i in key["batches"]["01b"]["items"]} == {"b"}
    pf = next(v for v in key["items"].values() if v["passage"] == "pf01")
    assert pf["condition"] == "corrupted" and pf["faults"][0]["kind"] == "hop_at_speed"
    rc = next(v for v in key["items"].values() if v["passage"] == "rc01")
    assert (rc["twin_of"], rc["transpose"], rc["condition"]) == ("ct01", 6, "engine")
    lc = next(v for v in key["items"].values() if v["passage"] == "lc01")
    assert lc["n_notes"] == {"R": 12} and lc["fingers"]["R"].split()[:3] == ["1", "2", "3"] and set(lc["engine"]) >= {"R1"}
    launches = json.loads((day / "launches.json").read_text(encoding="utf-8"))
    assert [l["batch"] for l in launches] == ["01a", "01b", "02a", "02b", "03a", "04b"]
    for l in launches:
        assert Path(l["batch_file"]).is_absolute() and l["model"] == "opus"
        assert l["prompt"] == WRAPPER.format(batch_file=l["batch_file"], out_file=l["out_file"], n=l["items"])
    assert (day / "launches.md").read_text(encoding="utf-8").count("| 0") >= 6
    assert all(re.fullmatch(r"it-[0-9a-f]{4}", i) for i in key["items"])


def test_library_copies_contain_no_pig_items(tmp_path):
    key = _small_day(tmp_path)
    lib = tmp_path / "results" / "library"
    assert sorted(p.name for p in lib.glob("*.md")) == ["batch-01a.md", "batch-01b.md", "batch-03a.md", "batch-04b.md"]
    pig_items = {i for i, v in key["items"].items() if v["source"] == "pig"}
    for p in lib.glob("*.md"):
        text = p.read_text(encoding="utf-8")
        assert len(text.encode("utf-8")) < 64_000 and not any(i in text for i in pig_items)
        assert text == (tmp_path / "day" / p.name).read_text(encoding="utf-8")


def _link_dir(target: Path, link: Path) -> None:
    """A directory junction on Windows (what a worktree's research/data/teacher_review is), a symlink elsewhere."""
    if os.name == "nt":
        import _winapi
        _winapi.CreateJunction(str(target), str(link))
    else:
        os.symlink(target, link, target_is_directory=True)


def test_output_line_stays_repo_relative_through_a_junction(tmp_path):
    # In a worktree research/data/teacher_review is a junction to the main checkout's data directory. Resolving
    # it would write the other checkout's absolute path into every batch file and so into the committed copies.
    repo, elsewhere = tmp_path / "repo", tmp_path / "main-checkout-data"
    repo.mkdir()
    elsewhere.mkdir()
    _link_dir(elsewhere, repo / "data")
    try:
        day = repo / "data" / "day"
        assert not day.resolve().is_relative_to(repo.resolve())          # the link really leads out of the repo
        recs, passages = _small_inputs()
        key = write_day(day, repo / "results", recs, passages, seed=5, date="2099-01-01", meta={}, repo=repo)
        for bid, b in key["batches"].items():
            text = (day / f"batch-{bid}.md").read_text(encoding="utf-8")
            assert text.rstrip().endswith(f"Output file: data/day/out/batch-{bid}.json")
            assert str(tmp_path.name) not in text and "main-checkout-data" not in text
            assert Path(b["file"]) == Path(os.path.abspath(day / f"batch-{bid}.md"))
            assert Path(b["out"]) == Path(os.path.abspath(day / "out" / f"batch-{bid}.json"))
        assert (elsewhere / "day" / "key.json").exists()
    finally:
        os.rmdir(repo / "data")                                          # removes the link, not its target


def test_rewrite_is_deterministic_and_leaves_no_stale_batches(tmp_path):
    def snapshot():
        return {p.relative_to(tmp_path).as_posix(): p.read_bytes() for p in sorted(tmp_path.rglob("*")) if p.is_file()}

    _small_day(tmp_path)
    first = snapshot()
    _small_day(tmp_path)
    assert snapshot() == first
    recs, passages = _small_inputs()
    write_day(tmp_path / "day", tmp_path / "results", [r for r in recs if r["set"] == "lowconf"], passages, seed=5,
              date="2099-01-01", meta={"engineVersion": "test"}, repo=tmp_path)
    assert sorted(p.name for p in (tmp_path / "day").glob("batch-*.md")) == ["batch-01a.md", "batch-01b.md"]
    assert sorted(p.name for p in (tmp_path / "results" / "library").glob("*.md")) == ["batch-01a.md", "batch-01b.md"]
    key = json.loads((tmp_path / "day" / "key.json").read_text(encoding="utf-8"))
    assert sorted(p.stem for p in (tmp_path / "day" / "items").glob("*.txt")) == sorted(key["items"])
    _small_day(tmp_path)
    assert snapshot() == first


def test_collect_outputs_validates_like_the_pilot(tmp_path):
    key = _small_day(tmp_path)
    day = tmp_path / "day"
    fake_reviews(day, skip={"04b"}, bad_note={"01a"})
    rep = collect_outputs(day)
    missing = set(key["batches"]["04b"]["items"])
    assert rep["n_items"] == len(key["items"]) - len(missing) and set(rep["missing_items"]) == missing
    assert any("unknown notes" in p for p in rep["problems"])
    js = json.loads((day / "judgements.json").read_text(encoding="utf-8"))
    assert set(js) == set(key["items"]) - missing
    assert all(j["readback"]["R"]["exact"] for j in js.values())
    assert rep["batches"]["01a"]["wall_s"] == 540.0


def test_batch_layout_matches_build_benchmark(tmp_path, monkeypatch, scale_passage):
    monkeypatch.setattr(bb, "DATA_OUT", tmp_path / "data")
    monkeypatch.setattr(bb, "RESULTS", tmp_path / "results")
    passages = [{"passage": "p01", "piece": "001", "composer": "Test", "slot": "1", "annotator": "XX", "bars": [1, 2],
                 "hands": ["R"]}]
    renders = {"p01": {c: scale_passage.copy() for c in bb.CONDITIONS}}
    info = {"p01": {"n_notes": {"R": 16, "L": 9}, "fingers": {c: {"R": scale_passage.finger_string("R")} for c in bb.CONDITIONS},
                    "faults": [], "alt": {}}}
    key = bb.make_run("T", passages, renders, info, seed=1, batch_size=1, variant="a")
    bid, b = next(iter(key["batches"].items()))
    run_dir = tmp_path / "data" / "runs" / "T"
    texts = [(run_dir / "items" / f"{iid}.txt").read_text(encoding="utf-8") for iid in b["items"]]
    expected = batch_text(bid, (bb.PROMPTS / "variant_a.md").read_text(encoding="utf-8"),
                          (bb.PROMPTS / "brief.md").read_text(encoding="utf-8"), LEGEND, texts, b["out"])
    assert (run_dir / "batch-01.md").read_text(encoding="utf-8") == expected
