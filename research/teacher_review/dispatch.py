"""Blinded weekly batches (the layout of build_benchmark.make_run), the key, the reviewer launches,
and collection of the reviewers' JSON with collect.normalise_item (the pilot's validator).

Pools never mix: library low-confidence passages, PIG hard-error passages, and the control pool
(controls, planted twins, recall twins). Engine pools are written twice per batch, framing a and
framing b, with the same passages, fresh item ids and an independent order (two reviewers); control
batches get one reviewer (framing a for odd batch numbers, b for even). Library batch files are copied
byte for byte to research/teacher_review/results/weekly/<date>/library/.

Paths are made absolute without resolving links: in a git worktree research/data/teacher_review is a
junction to the main checkout's data directory, and resolving it would put the other checkout's
absolute path into the batch files' output line (and so into the committed library copies).
"""
from __future__ import annotations

import json
import math
import os
import random
import re
from pathlib import Path

from .collect import _parse_ts, normalise_item
from .model import Passage
from .render import render_passage

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PROMPTS = HERE / "prompts"
FENCE = "`" * 3
POOLS = (("lowconf", ("lowconf",), 2), ("harderr", ("harderr",), 2), ("control", ("control", "recall", "planted"), 1))

WEEKLY_LEGEND = """How to read a passage block
- One line per note, chord or rest; both hands in separate sections, each in time order.
- id = hand letter + note number (R1, R2, ... for the right hand; L1, L2, ... for the left). A chord
  shows a range (R3-5): its pitches are listed low to high and its fingers in the same order (1+3+5).
  Rests have no id. Refer to notes by these ids.
- bar / beat: bar number and beat within the bar, 1-based; 2.5 means half-way through beat 2. The beat
  is a quarter note in x/4 meters, a half note in 2/2 and 3/2, a dotted quarter in 6/8, 9/8 and 12/8,
  an eighth in 3/8. Bar 0 is an upbeat (pickup) bar.
- dur: w h q e s t = whole, half, quarter, eighth, 16th, 32nd; a trailing dot = dotted (q. = dotted
  quarter); e3 = triplet eighth; gr = grace note, played just before the note that follows it; otherwise
  a multiple of a quarter (2.5q). A chord's dur is its longest note. dur is the sounding length in the
  source; pianists release early or use the pedal, so a finger may be re-used after a long note unless
  the notes are slurred. Rest lines mark gaps of an eighth or longer in that hand.
- pitch: scientific pitch names, C4 = middle C, sharps except Eb and Bb. Black keys: C# Eb F# G# Bb.
- f: finger, 1 = thumb ... 5 = little finger, for both hands. "-" = no fingering given for that note.
- Tempo is given in quarter notes per minute and is approximate in every passage. In some passages the
  bar numbers were estimated from a recording and may be off by a bar; the order, the rhythm and the
  pitches are exact.
"""

WRAPPER = (
    "You are a reviewer in a blinded study of piano fingerings. Your only input is the file "
    "`{batch_file}`. It contains a brief, a notation legend and {n} passages, each with a candidate "
    "fingering. Follow the brief's instructions exactly and write your review as a single JSON "
    "document to `{out_file}` (UTF-8, nothing but the JSON).\n"
    "Rules: read only that one input file; do not open, list, search or read any other file, "
    "directory or web page, and do not look for the sources of the passages. Do not run git. Do not "
    "run any program except one command to get a UTC timestamp before you read the passages "
    "(bash: `date -u +%FT%TZ`) and one after you have written the JSON; put them in `started_at` and "
    "`finished_at`. Do not modify the input file. Every item in the input must appear exactly once in "
    "`items`, in the same order, each with `item`, `readback`, `scores`, `verdict`, `objections` and "
    "`comment`. Use only note ids that exist in the passage. When done, reply with one line: the "
    "output path and the number of items written."
)


def _base(rec: dict) -> str:
    return rec.get("twin_of") or rec["passage"]


def _abs(path: Path) -> Path:
    """Absolute, normalised, links not followed (see the module docstring)."""
    return Path(os.path.abspath(path))


def _repo_relative(path: Path, repo: Path) -> str:
    """``path`` relative to ``repo`` as posix, through links as written first, then resolved; absolute when it
    lies outside the repository."""
    for a, b in ((_abs(path), _abs(repo)), (Path(path).resolve(), Path(repo).resolve())):
        try:
            return a.relative_to(b).as_posix()
        except ValueError:
            pass
    return _abs(path).as_posix()


def plan_batches(records: list[dict], seed: int, batch_size: int = 8) -> list[dict]:
    """Batches per pool, numbered across pools. The variants of one passage (a control and its twins) are
    placed one after the other, each in the least-filled batch that holds no other variant: that puts a group
    of k variants into the k least-filled batches, so batch sizes never differ by more than one."""
    plan, number = [], 0
    for pool, sets, reviewers in POOLS:
        recs = sorted((r for r in records if r["set"] in sets), key=lambda r: r["passage"])
        if not recs:
            continue
        rng = random.Random(f"{seed}-batches-{pool}")
        ids = [r["passage"] for r in recs]
        rng.shuffle(ids)
        base = {r["passage"]: _base(r) for r in recs}
        groups: dict[str, list[str]] = {}
        for pid in ids:                     # groups in the order of their first member, members kept together
            groups.setdefault(base[pid], []).append(pid)
        ids = [pid for members in groups.values() for pid in members]
        per_base = max(len(members) for members in groups.values())
        n = max(math.ceil(len(ids) / batch_size), per_base)
        batches: list[list[str]] = [[] for _ in range(n)]
        for pid in ids:
            order = list(range(n))
            rng.shuffle(order)
            order.sort(key=lambda k: len(batches[k]))
            for k in order:
                if len(batches[k]) < batch_size and all(base[x] != base[pid] for x in batches[k]):
                    batches[k].append(pid)
                    break
            else:
                raise RuntimeError(f"cannot place {pid} in pool {pool} without two variants in one batch")
        for b in batches:
            number += 1
            framings = ["a", "b"] if reviewers == 2 else (["a"] if number % 2 else ["b"])
            plan.append({"number": number, "pool": pool, "framings": framings, "passages": b})
    return plan


def batch_text(bid: str, framing: str, brief: str, legend: str, passage_texts: list[str], out_line: str) -> str:
    """The pilot's batch layout, line for line (build_benchmark.make_run)."""
    lines = [f"# Batch {bid}", "", framing.strip(), "", brief.strip(), "", "## Notation", "", legend.strip(), "",
             f"## Passages ({len(passage_texts)})", ""]
    for text in passage_texts:
        lines += [FENCE, text.rstrip("\n"), FENCE, ""]
    lines += [f"Output file: {out_line}", ""]
    return "\n".join(lines)


def _key_item(rec: dict, p: Passage, bid: str, framing: str, pool: str) -> dict:
    hands = list(p.target_hands)
    return {"passage": rec["passage"], "set": rec["set"], "source": rec["source"],
            "condition": "corrupted" if rec["set"] == "planted" else "engine",
            "piece": rec.get("piece"), "title": rec.get("title", ""), "level": rec.get("level"),
            "bars": [p.bar_first, p.bar_last], "hands": hands, "batch": bid, "reviewer": framing, "pool": pool,
            "n_notes": {h: len(p.notes(h)) for h in p.events}, "fingers": {h: p.finger_string(h) for h in hands},
            "faults": rec.get("faults", []), "alt": {}, "twin_of": rec.get("twin_of"), "transpose": rec.get("transpose", 0),
            "engine": {k: v for k, v in (p.notes_meta.get("engine") or {}).items() if k[0] in hands},
            "hard": dict(p.notes_meta.get("hard") or {}), "seed_note": rec.get("seed_note")}


def _clear(directory: Path, pattern: str) -> None:
    """Remove files an earlier write_day left (a rebuild with fewer batches must not leave stale batch files,
    above all among the committed library copies). Only this module's own file names are matched."""
    for old in directory.glob(pattern):
        if old.is_file():
            old.unlink()


def write_day(day: Path, results_day: Path, records: list[dict], passages: dict[str, Passage], *, seed: int,
              date: str, meta: dict, repo: Path = REPO) -> dict:
    day, results_day = Path(day), Path(results_day)
    (day / "out").mkdir(parents=True, exist_ok=True)
    (day / "items").mkdir(parents=True, exist_ok=True)
    library_dir = results_day / "library"
    library_dir.mkdir(parents=True, exist_ok=True)
    _clear(day, "batch-*.md")
    _clear(day / "items", "it-*.txt")
    _clear(library_dir, "batch-*.md")
    brief = (PROMPTS / "brief.md").read_text(encoding="utf-8")
    framings = {f: (PROMPTS / f"variant_{f}.md").read_text(encoding="utf-8") for f in ("a", "b")}
    by_pid = {r["passage"]: r for r in records}
    ids_rng = random.Random(f"{seed}-ids")
    taken: set[str] = set()
    key = {"date": date, "seed": seed, "meta": meta, "items": {}, "batches": {}, "passages": by_pid}
    launches = []
    for b in plan_batches(records, seed):
        for framing in b["framings"]:
            bid = f"{b['number']:02d}{framing}"
            order = list(b["passages"])
            random.Random(f"{seed}-order-{bid}").shuffle(order)
            texts, items = [], []
            for pid in order:
                while True:
                    iid = f"it-{ids_rng.randrange(16 ** 4):04x}"
                    if iid not in taken:
                        taken.add(iid)
                        break
                p = passages[pid].copy()
                p.passage_id = iid
                text = render_passage(p)
                (day / "items" / f"{iid}.txt").write_text(text, encoding="utf-8", newline="\n")
                texts.append(text)
                items.append(iid)
                key["items"][iid] = _key_item(by_pid[pid], passages[pid], bid, framing, b["pool"])
            path = day / f"batch-{bid}.md"
            out = day / "out" / f"batch-{bid}.json"
            batch_file, out_file = _abs(path).as_posix(), _abs(out).as_posix()
            # repo-relative in the batch file, so committed copies carry no local path
            text = batch_text(bid, framings[framing], brief, WEEKLY_LEGEND, texts, _repo_relative(out, repo))
            path.write_text(text, encoding="utf-8", newline="\n")
            if b["pool"] != "harderr":
                (library_dir / path.name).write_text(text, encoding="utf-8", newline="\n")
            key["batches"][bid] = {"items": items, "file": batch_file, "out": out_file, "chars": len(text),
                                   "pool": b["pool"], "framing": framing}
            launches.append({"n": len(launches) + 1, "batch": bid, "pool": b["pool"], "framing": framing,
                             "items": len(items), "batch_file": batch_file, "out_file": out_file, "model": "opus",
                             "prompt": WRAPPER.format(batch_file=batch_file, out_file=out_file, n=len(items))})
    (day / "key.json").write_text(json.dumps(key, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")
    (day / "launches.json").write_text(json.dumps(launches, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")
    rows = ["| # | pool | batch file (input) | output file | items | framing |", "|---|---|---|---|---|---|"]
    rows += [f"| {l['n']:02d} | {l['pool']} | `{l['batch_file']}` | `{l['out_file']}` | {l['items']} | {l['framing']} |"
             for l in launches]
    (day / "launches.md").write_text(
        f"# Reviewer launches, {date}\n\nLaunch one fresh Opus subagent per row with the prompt in launches.json "
        f"(the README wrapper with the two paths and the item count). Nothing else goes into the prompt.\n\n"
        + "\n".join(rows) + "\n", encoding="utf-8", newline="\n")
    return key


def collect_outputs(day: Path) -> dict:
    """collect.collect for a weekly day: same validation, same report shape, files in the day directory."""
    day = Path(day)
    key = json.loads((day / "key.json").read_text(encoding="utf-8"))
    report = {"date": key["date"], "batches": {}, "problems": [], "missing_items": [], "n_items": 0}
    judgements = {}
    for bid, b in key["batches"].items():
        out = Path(b["out"])
        entry = {"file": out.as_posix(), "present": out.exists(), "wall_s": None, "chars_in": b["chars"],
                 "chars_out": 0, "n_items": 0}
        report["batches"][bid] = entry
        if not out.exists():
            report["missing_items"] += b["items"]
            continue
        text = out.read_text(encoding="utf-8")
        entry["chars_out"] = len(text)
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}", text, re.S)
            try:
                raw = json.loads(m.group(0)) if m else None
            except json.JSONDecodeError:
                raw = None
        if not isinstance(raw, dict):
            report["problems"].append(f"{bid}: output is not valid JSON")
            report["missing_items"] += b["items"]
            continue
        t0, t1 = _parse_ts(raw.get("started_at")), _parse_ts(raw.get("finished_at"))
        if t0 and t1 and t1 > t0:
            entry["wall_s"] = (t1 - t0).total_seconds()
        seen = set()
        for item in raw.get("items") or []:
            iid = item.get("item") if isinstance(item, dict) else None
            if iid not in b["items"]:
                report["problems"].append(f"{bid}: unexpected item id {iid!r}")
                continue
            if iid in seen:
                report["problems"].append(f"{bid}: duplicate item {iid}")
                continue
            seen.add(iid)
            problems: list[str] = []
            j = normalise_item(item, key["items"][iid], problems)
            j["batch"] = bid
            report["problems"] += problems
            judgements[iid] = j
        entry["n_items"] = len(seen)
        report["missing_items"] += [iid for iid in b["items"] if iid not in seen]
    report["n_items"] = len(judgements)
    (day / "judgements.json").write_text(json.dumps(judgements, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")
    (day / "collect_report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")
    return report
