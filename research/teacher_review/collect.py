"""Collect and validate reviewer outputs for a run.

    research/.venv/Scripts/python.exe -I -m teacher_review.collect --run A

Reads ``research/teacher_review/results/<run>/key.json`` and every
``research/data/teacher_review/runs/<run>/out/batch-NN.json`` the reviewers wrote, validates
them against the output schema, checks the read-back against the rendered fingers, and writes
``results/<run>/judgements.json`` (normalised judgements; read-back strings are replaced by
their error counts so the file carries no PIG fingering sequences) and
``results/<run>/collect_report.json`` (what was missing or malformed).
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"

CRITERIA = ["possible", "idiomatic", "economical", "consistent", "beginner_friendly"]
VERDICTS = {"good": 3, "acceptable": 2, "flawed": 1, "unplayable": 0}
SEVERITIES = {"error", "warning", "info"}
KINDS = {"same_finger_chord", "crossed_chord", "impossible_span", "nonthumb_crossing", "thumb_pass_onto_black",
         "hop", "reversed_run", "thumb_on_black", "fifth_on_black", "stretch", "position_change", "inconsistent",
         "weak_finger", "repeated_note", "nonstandard_pattern", "other"}
_ID_RE = re.compile(r"^[RL]\d+$")


def _parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        s = s.strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _digits(s) -> list[int]:
    if isinstance(s, list):
        return [int(x) for x in s]
    return [int(x) for x in re.findall(r"\d", str(s))]


def normalise_item(raw: dict, key_item: dict, problems: list[str]) -> dict:
    iid = raw.get("item")
    out = {"item": iid, "passage": key_item["passage"], "condition": key_item["condition"],
           "scores": {}, "verdict": None, "verdict_rank": None, "objections": [], "comment": raw.get("comment", ""),
           "readback": {}}
    sc = raw.get("scores") or {}
    for c in CRITERIA:
        v = sc.get(c)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v <= 3:
            problems.append(f"{iid}: score {c} missing or out of range: {v!r}")
            v = None
        out["scores"][c] = None if v is None else int(round(v))
    vd = str(raw.get("verdict", "")).strip().lower()
    if vd not in VERDICTS:
        problems.append(f"{iid}: bad verdict {vd!r}")
        out["verdict"] = None
    else:
        out["verdict"] = vd
        out["verdict_rank"] = VERDICTS[vd]
    valid = {h: set(f"{h}{i}" for i in range(1, key_item["n_notes"].get(h, 0) + 1)) for h in key_item["hands"]}
    all_valid = set().union(*valid.values()) if valid else set()
    for ob in raw.get("objections") or []:
        if not isinstance(ob, dict):
            problems.append(f"{iid}: objection is not an object")
            continue
        notes = ob.get("notes") or []
        if isinstance(notes, str):
            notes = re.findall(r"[RL]\d+", notes)
        notes = [str(n).strip() for n in notes]
        bad = [n for n in notes if not _ID_RE.match(n) or n not in all_valid]
        if bad:
            problems.append(f"{iid}: objection names unknown notes {bad}")
        notes = [n for n in notes if n in all_valid]
        kind = str(ob.get("kind", "other")).strip().lower()
        if kind not in KINDS:
            problems.append(f"{iid}: unknown objection kind {kind!r} mapped to other")
            kind = "other"
        sev = str(ob.get("severity", "warning")).strip().lower()
        if sev not in SEVERITIES:
            problems.append(f"{iid}: unknown severity {sev!r} mapped to warning")
            sev = "warning"
        fix = {}
        for k, v in (ob.get("fix") or {}).items() if isinstance(ob.get("fix"), dict) else []:
            k = str(k).strip()
            try:
                fix[k] = int(v)
            except (TypeError, ValueError):
                problems.append(f"{iid}: fix value {v!r} for {k} is not a finger")
        out["objections"].append({"notes": notes, "kind": kind, "severity": sev,
                                  "problem": str(ob.get("problem", ""))[:300], "fix": fix})
    rb = raw.get("readback") or {}
    for h in key_item["hands"]:
        expected = _digits(key_item["fingers"].get(h, ""))
        got = _digits(rb.get(h, "")) if isinstance(rb, dict) else []
        n = len(expected)
        mism = sum(1 for a, b in zip(expected, got) if a != b) + abs(len(expected) - len(got))
        out["readback"][h] = {"n": n, "errors": mism, "exact": mism == 0, "length_ok": len(got) == n}
        if not isinstance(rb, dict) or h not in rb:
            problems.append(f"{iid}: readback missing for hand {h}")
    return out


def collect(run: str, data_root: Path | None = None) -> dict:
    key = json.loads((RESULTS / run / "key.json").read_text(encoding="utf-8"))
    report = {"run": run, "batches": {}, "problems": [], "missing_items": [], "n_items": 0}
    judgements = {}
    for bid, b in key["batches"].items():
        out_path = Path(b["out"])
        if data_root is not None:
            out_path = data_root / out_path.relative_to(out_path.parents[2])
        entry = {"file": str(out_path), "present": out_path.exists(), "wall_s": None, "chars_in": b["chars"],
                 "chars_out": 0, "n_items": 0}
        report["batches"][bid] = entry
        if not out_path.exists():
            report["missing_items"] += b["items"]
            continue
        text = out_path.read_text(encoding="utf-8")
        entry["chars_out"] = len(text)
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}", text, re.S)
            try:
                raw = json.loads(m.group(0)) if m else None
            except json.JSONDecodeError:
                raw = None
            if raw is None:
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
            probs: list[str] = []
            j = normalise_item(item, key["items"][iid], probs)
            j["batch"] = bid
            report["problems"] += probs
            judgements[iid] = j
        entry["n_items"] = len(seen)
        for iid in b["items"]:
            if iid not in seen:
                report["missing_items"].append(iid)
    report["n_items"] = len(judgements)
    (RESULTS / run / "judgements.json").write_text(json.dumps(judgements, indent=1), encoding="utf-8", newline="\n")
    (RESULTS / run / "collect_report.json").write_text(json.dumps(report, indent=1), encoding="utf-8", newline="\n")
    return report


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True)
    args = ap.parse_args(argv)
    rep = collect(args.run)
    print(f"run {args.run}: {rep['n_items']} items collected, {len(rep['missing_items'])} missing, "
          f"{len(rep['problems'])} problems")
    for p in rep["problems"][:40]:
        print("  -", p)


if __name__ == "__main__":
    main()
