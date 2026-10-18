"""Collect and validate the blinded listening reviews of issue #38.

    research/.venv/Scripts/python.exe -I research/embellish/collect.py

Reads the passages of ``listening/teacher/batch-NN.md``, the reviewers' ``teacher/results/batch-NN.json``
and the key ``teacher/key.json``. Each results file is checked against the output schema of
``teacher/brief.md``:

- the batch id matches; every input item appears exactly once, in the batch file's order;
- the three scores are integers 0 to 3; the verdict is one of the four;
- each objection has a known kind and severity, a problem of at most 25 words, and names only note
  ids that exist in that passage.

The problems are reported per batch. The normalised judgements, with the key joined in (piece,
condition, bars, inserted ids, and each inserted id's rule from ``NN-<slug>.inserted.json``), go to
``teacher/results/judgements.json``. The script exits 1 if any batch has a problem.
License: MIT.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from fractions import Fraction as F
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
if str(RESEARCH) not in sys.path:
    sys.path.insert(0, str(RESEARCH))

LISTEN = HERE / "listening"
TEACHER = LISTEN / "teacher"
RESULTS = TEACHER / "results"

CRITERIA = ("musical", "fits_harmony", "beginner_friendly")
VERDICTS = ("natural", "acceptable", "awkward", "wrong")
KINDS = ("wrong_note", "clash", "rhythm", "clutter", "repetitive", "phrase", "other")
SEVERITIES = ("error", "warning", "info")
CONDITIONS = ("plain", "light", "playful")
MAX_PROBLEM_WORDS = 25

_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_PITCH = re.compile(r"^([A-G])([#b]?)(-?\d+)$")
_ROW = re.compile(r"^([RL])(\d+)(?:-(\d+))?\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$")
_BLOCK = re.compile(r"^```[^\n]*\n(.*?)^```", re.S | re.M)


def pitch_midi(name: str) -> int:
    m = _PITCH.match(name.strip())
    if not m:
        raise ValueError(f"not a pitch: {name!r}")
    step, acc, octave = m.groups()
    return 12 * (int(octave) + 1) + _PC[step] + {"": 0, "#": 1, "b": -1}[acc]


def parse_batch(text: str) -> tuple[str | None, list[dict]]:
    """(batch id, passages in file order). A passage is a fenced block whose first line is
    ``PASSAGE <id>``; each note id maps to its hand, bar, beat (Fraction), duration, pitch and midi."""
    m = re.search(r"^# Batch (\S+)", text, re.M)
    bid = m.group(1) if m else None
    passages = []
    for block in _BLOCK.findall(text):
        lines = block.splitlines()
        if not lines or not lines[0].startswith("PASSAGE "):
            continue
        pid = lines[0].split()[1]
        bars = re.search(r"Bars (\d+)-(\d+)\.", block)
        notes: dict[str, dict] = {}
        for line in lines[1:]:
            r = _ROW.match(line)
            if not r:
                continue
            hand, first, last, bar, beat, dur, pitch = r.groups()
            ids = range(int(first), int(last or first) + 1)
            pitches = pitch.split("+")
            if len(pitches) != len(ids):
                raise ValueError(f"{pid}: {len(ids)} ids but {len(pitches)} pitches in {line!r}")
            for k, p in zip(ids, pitches):
                notes[f"{hand}{k}"] = {"hand": hand, "bar": int(bar), "beat": F(beat).limit_denominator(48),
                                       "dur": dur, "pitch": p, "midi": pitch_midi(p)}
        passages.append({"item": pid, "bars": [int(bars.group(1)), int(bars.group(2))] if bars else None,
                         "notes": notes})
    return bid, passages


def _wall(raw: dict) -> float | None:
    try:
        t0, t1 = (datetime.fromisoformat(str(raw[k]).replace("Z", "+00:00")) for k in ("started_at", "finished_at"))
    except (KeyError, ValueError):
        return None
    t0, t1 = (t if t.tzinfo else t.replace(tzinfo=timezone.utc) for t in (t0, t1))
    return (t1 - t0).total_seconds()


def _item(raw: dict, passage: dict, problems: list[str]) -> dict:
    iid = passage["item"]
    out = {"item": iid, "scores": {}, "verdict": None, "objections": [], "comment": str(raw.get("comment") or "")}
    scores = raw.get("scores") if isinstance(raw.get("scores"), dict) else {}
    for c in CRITERIA:
        v = scores.get(c)
        if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= 3:
            problems.append(f"{iid}: score {c} is not an integer 0-3: {v!r}")
            v = None
        out["scores"][c] = v
    extra = sorted(set(scores) - set(CRITERIA))
    if extra:
        problems.append(f"{iid}: unknown scores {extra}")
    verdict = raw.get("verdict")
    if verdict not in VERDICTS:
        problems.append(f"{iid}: verdict {verdict!r} is not one of {list(VERDICTS)}")
        verdict = None
    out["verdict"] = verdict
    objections = raw.get("objections")
    if not isinstance(objections, list):
        problems.append(f"{iid}: objections is not a list")
        objections = []
    for k, ob in enumerate(objections, start=1):
        where = f"{iid} objection {k}"
        if not isinstance(ob, dict):
            problems.append(f"{where}: not an object")
            continue
        notes = ob.get("notes")
        if not isinstance(notes, list) or not notes:
            problems.append(f"{where}: notes is not a non-empty list")
            notes = []
        notes = [str(n) for n in notes]
        unknown = [n for n in notes if n not in passage["notes"]]
        if unknown:
            problems.append(f"{where}: note ids not in the passage: {unknown}")
        kind, sev = ob.get("kind"), ob.get("severity")
        if kind not in KINDS:
            problems.append(f"{where}: kind {kind!r} is not one of {list(KINDS)}")
            kind = "other"
        if sev not in SEVERITIES:
            problems.append(f"{where}: severity {sev!r} is not one of {list(SEVERITIES)}")
            sev = "warning"
        problem = str(ob.get("problem") or "")
        if not problem.strip():
            problems.append(f"{where}: no problem statement")
        elif len(problem.split()) > MAX_PROBLEM_WORDS:
            problems.append(f"{where}: problem has {len(problem.split())} words, over {MAX_PROBLEM_WORDS} words")
        out["objections"].append({"notes": [n for n in notes if n in passage["notes"]], "kind": kind,
                                  "severity": sev, "problem": problem})
    return out


def validate(raw, bid: str, passages: list[dict]) -> tuple[list[dict], list[str]]:
    """Normalised items in the batch file's order, and the schema problems of one results document."""
    problems: list[str] = []
    if not isinstance(raw, dict):
        return [], ["results are not a JSON object"]
    if raw.get("batch") != bid:
        problems.append(f"batch id {raw.get('batch')!r} does not match {bid!r}")
    for k in ("started_at", "finished_at"):
        if not raw.get(k):
            problems.append(f"{k} missing")
    by_id = {p["item"]: p for p in passages}
    got: dict[str, dict] = {}
    order: list[str] = []
    for it in raw.get("items") or []:
        iid = it.get("item") if isinstance(it, dict) else None
        if iid not in by_id:
            problems.append(f"unexpected item {iid!r}")
        elif iid in got:
            problems.append(f"duplicate item {iid}")
        else:
            got[iid] = it
            order.append(iid)
    expected = [p["item"] for p in passages]
    missing = [i for i in expected if i not in got]
    if missing:
        problems.append(f"missing items {missing}")
    if order != [i for i in expected if i in got]:
        problems.append(f"items out of order: {order}")
    items = [_item(got[i], by_id[i], problems) for i in expected if i in got]
    return items, problems


def join_rules(passage: dict, inserted_ids: list[str], entries: list[dict]) -> tuple[dict[str, str], list[str]]:
    """Each inserted id's rule: the one entry of the density's ``inserted.json`` list with the note's bar,
    beat and midi pitch. Also checks that the entries inside the passage's bars are exactly the ids."""
    problems: list[str] = []
    b1, b2 = passage["bars"]
    span = [e for e in entries if b1 <= int(e["bar"]) <= b2]
    rules: dict[str, str] = {}
    for nid in inserted_ids:
        note = passage["notes"].get(nid)
        if note is None:
            problems.append(f"{passage['item']}: inserted id {nid} is not in the passage")
            continue
        hits = [e for e in span if int(e["bar"]) == note["bar"] and F(str(e["beat"])) == note["beat"]
                and int(e["midi"]) == note["midi"]]
        if len(hits) != 1:
            problems.append(f"{passage['item']}: inserted id {nid} matches {len(hits)} inserted entries")
            continue
        rules[nid] = hits[0]["rule"]
    if len(span) != len(inserted_ids):
        problems.append(f"{passage['item']}: {len(span)} inserted entries in the passage's bars, "
                        f"{len(inserted_ids)} inserted ids in the key")
    return rules, problems


def load_pieces(listen: Path) -> dict[str, dict]:
    pieces = {}
    for row in json.loads((listen / "pieces.json").read_text(encoding="utf-8")):
        rec = json.loads((listen / f"{row['n']:02d}-{row['slug']}.inserted.json").read_text(encoding="utf-8"))
        pieces[row["slug"]] = {"n": row["n"], "title": row["title"], "inserted": rec["inserted"]}
    return pieces


def collect(teacher: Path = TEACHER, listen: Path = LISTEN, results: Path | None = None) -> dict:
    results = results or teacher / "results"
    key = {k["item"]: k for k in json.loads((teacher / "key.json").read_text(encoding="utf-8"))}
    pieces = load_pieces(listen)
    report: dict = {"batches": {}, "items": []}
    for path in sorted(teacher.glob("batch-*.md")):
        bid, passages = parse_batch(path.read_text(encoding="utf-8"))
        bid = bid or path.stem
        out = results / f"{bid}.json"
        entry = {"results": out.name, "items": 0, "wall_s": None, "problems": []}
        report["batches"][bid] = entry
        if not out.exists():
            entry["problems"].append("results file missing")
            continue
        try:
            raw = json.loads(out.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            entry["problems"].append(f"results are not valid JSON: {e}")
            continue
        items, problems = validate(raw, bid, passages)
        entry["problems"] += problems
        entry["wall_s"] = _wall(raw)
        entry["items"] = len(items)
        by_id = {p["item"]: p for p in passages}
        for pos, it in enumerate(items, start=1):
            k = key.get(it["item"])
            if k is None:
                entry["problems"].append(f"{it['item']}: not in the key")
                continue
            if k["batch"] != bid:
                entry["problems"].append(f"{it['item']}: the key puts it in {k['batch']}")
            p = by_id[it["item"]]
            n_r = sum(1 for n in p["notes"].values() if n["hand"] == "R")
            if n_r != k["notes_R"]:
                entry["problems"].append(f"{it['item']}: {n_r} right-hand notes, the key says {k['notes_R']}")
            piece = pieces[k["slug"]]
            rules: dict[str, str] = {}
            if k["condition"] != "plain":
                rules, probs = join_rules(p, k["inserted_ids"], piece["inserted"][k["condition"]])
                entry["problems"] += probs
            report["items"].append({
                "item": it["item"], "batch": bid, "position": pos, "n": piece["n"], "slug": k["slug"],
                "title": piece["title"], "condition": k["condition"], "bars": k["bars"],
                "inserted_ids": k["inserted_ids"], "inserted_rules": rules,
                "notes_R": n_r, "notes_L": sum(1 for n in p["notes"].values() if n["hand"] == "L"),
                "scores": it["scores"], "verdict": it["verdict"], "objections": it["objections"],
                "comment": it["comment"]})
    missing = sorted(set(key) - {i["item"] for i in report["items"]})
    report["missing_items"] = missing
    results.mkdir(parents=True, exist_ok=True)
    (results / "judgements.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n",
                                             encoding="utf-8", newline="\n")
    return report


def main(argv: list[str] | None = None) -> int:
    getattr(sys.stdout, "reconfigure", lambda **_: None)(encoding="utf-8")
    import argparse
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.parse_args(argv)
    rep = collect()
    bad = 0
    for bid, b in rep["batches"].items():
        print(f"{bid}: {b['items']} items, {len(b['problems'])} problems")
        for p in b["problems"]:
            print(f"  - {p}")
        bad += len(b["problems"])
    print(f"{len(rep['items'])} judgements written, {len(rep['missing_items'])} key items missing")
    return 1 if bad or rep["missing_items"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
