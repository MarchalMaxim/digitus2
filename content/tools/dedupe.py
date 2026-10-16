"""Find duplicate scores by their notes, not their titles.

Items compared: every curated piece of the library (the manifest entries that are not MuseScore
archive pieces) and every archive candidate that passed `pdmx_gate.py` (its plain MusicXML is in
`content/_build/pdmx/<sha256>/`). Two items are

* exact copies when they strike the same notes at the same onsets (a multiset hash), and
* near copies when the Jaccard index of their (onset, pitch) sets is at least NEAR (0.9) and their
  note counts are within 10 percent: the same score exported twice with a small difference.

The same tune in another arrangement is a third relation (a transposition-proof comparison of the
top line: SAME_TUNE of the smaller piece's 6-interval shingles occur in the larger one). At the same
level it is a copy too: a learner gains nothing from three Mozart minuets in F at level 2, though their
onsets differ (a pickup bar, another beat unit). At different levels it is an alternative (an easy and a
full arrangement of one piece), so it is only listed and stays.

Which copy stays: a curated piece always; among archive pieces, one with a named composer, then the
more rated, then the smaller slug. A curated piece is never removed, and curated copies of each other
are only listed. `--apply` writes the archive copies into the `duplicates` map of
`content/tools/pdmx-excluded.json` ({slug or sha256: {"of": keeper, "kind", "similarity"}}), which
`pdmx_fragments.py` reads. The full report is written to `content/_build/dedupe/report.json`.

    content/.venv/Scripts/python.exe -I content/tools/dedupe.py [--apply]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zlib
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
CONTENT = HERE.parent
RAW = CONTENT / "_raw" / "pdmx"
OUT = CONTENT / "_build" / "dedupe"
EXCLUDED = HERE / "pdmx-excluded.json"

import pdmx_advanced  # noqa: E402
import scoreio  # noqa: E402
import xmlcheck as xc  # noqa: E402

NEAR = 0.9
NOTE_COUNT_RATIO = 0.10
SAME_TUNE = 0.8
MIN_SHINGLES = 20
SHINGLE = 6
COMMON = 60  # a shingle in more items than this says nothing (repeated notes, scales)


def read_notes(path: Path) -> tuple[frozenset, list[int], int]:
    """(the set of (onset, pitch) struck, the top line's interval shingles, the number of struck notes)."""
    xs = xc.parse_musicxml(scoreio.plain_path(path))
    struck = [(str(n.onset), n.pitch) for n in xs.notes if n.pitch is not None and not n.grace and not n.tie_stop]
    top: dict = {}
    for n in xs.notes:
        if n.pitch is None or n.grace or n.tie_stop:
            continue
        if n.onset not in top or n.pitch > top[n.onset]:
            top[n.onset] = n.pitch
    line = [top[o] for o in sorted(top)]
    steps = [max(-12, min(12, b - a)) for a, b in zip(line, line[1:])]
    shingles = {zlib.crc32(bytes(s + 12 for s in steps[i:i + SHINGLE])) for i in range(len(steps) - SHINGLE + 1)}
    return frozenset(struck), sorted(shingles), len(struck)


def multiset_hash(path: Path) -> str:
    xs = xc.parse_musicxml(scoreio.plain_path(path))
    struck = sorted((str(n.onset), n.pitch) for n in xs.notes if n.pitch is not None and not n.grace and not n.tie_stop)
    return hashlib.sha1(repr(struck).encode()).hexdigest()


def load_items() -> list[dict]:
    """Curated pieces from the manifest, then the archive candidates that passed the gate."""
    items: list[dict] = []
    manifest = json.loads((CONTENT / "manifest.json").read_text(encoding="utf-8"))
    for e in manifest:
        if e["slug"].startswith("pdmx-"):
            continue
        items.append({"id": e["slug"], "kind": "curated", "path": CONTENT / e["files"]["score"], "rank": (0,),
                      "level": e["level"]})
    candidates = {c["sha256"]: c for c in json.loads((RAW / "candidates.json").read_text(encoding="utf-8"))}
    for line in (RAW / "gate.jsonl").open(encoding="utf-8"):
        gate = json.loads(line)
        if not gate["ok"] or gate["sha256"] not in candidates:  # a superseded representative is skipped
            continue
        cand = candidates[gate["sha256"]]
        sha = gate["sha256"]
        path = CONTENT / "_build" / "pdmx" / sha / f"{sha}.musicxml"
        if not path.exists():
            continue
        named = bool((cand.get("composer") or "").strip()) and (cand.get("composer") or "").strip().upper() != "NA"
        rank = (1, 0 if named else 1, -int(cand.get("n_ratings") or 0), -float(cand.get("rating") or 0), sha)
        level = 6 if pdmx_advanced.advanced(gate["level"], cand["notes"]) else gate["level"]["level"]
        items.append({"id": sha, "kind": "pdmx", "path": path, "rank": rank, "title": cand.get("title"), "level": level})
    items.sort(key=lambda i: i["rank"])
    return items


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="write the archive copies into pdmx-excluded.json")
    a = ap.parse_args(argv)
    items = load_items()
    print(f"items: {sum(i['kind'] == 'curated' for i in items)} curated, {sum(i['kind'] == 'pdmx' for i in items)} archive",
          flush=True)
    data = {}
    for n, item in enumerate(items):
        try:
            data[item["id"]] = (*read_notes(item["path"]), multiset_hash(item["path"]))
        except Exception as exc:  # noqa: BLE001 - an unreadable item is reported, not compared
            print(f"  unreadable {item['id']}: {exc}", flush=True)
        if n % 1000 == 999:
            print(f"  read {n + 1}", flush=True)
    items = [i for i in items if i["id"] in data]
    order = {i["id"]: n for n, i in enumerate(items)}  # best keeper first

    # exact copies
    by_hash: dict[str, list[str]] = defaultdict(list)
    for item in items:
        by_hash[data[item["id"]][3]].append(item["id"])
    found: dict[str, dict] = {}  # removed archive id -> {"of", "kind", "similarity"}
    curated_pairs: list[dict] = []
    kinds = {i["id"]: i["kind"] for i in items}
    levels = {i["id"]: i["level"] for i in items}

    def consider(keeper: str, other: str, kind: str, similarity: float) -> None:
        if kinds[other] == "curated":
            curated_pairs.append({"a": keeper, "b": other, "kind": kind, "similarity": round(similarity, 3)})
            return
        if other in found or keeper in found:
            return
        found[other] = {"of": keeper, "kind": kind, "similarity": round(similarity, 3)}

    for ids in by_hash.values():
        ids.sort(key=order.__getitem__)
        for other in ids[1:]:
            consider(ids[0], other, "exact", 1.0)

    # candidate pairs for near copies and the same tune, from shared shingles
    index: dict[int, list[str]] = defaultdict(list)
    for item in items:
        for sh in data[item["id"]][1]:
            index[sh].append(item["id"])
    shared: Counter = Counter()
    for ids in index.values():
        if len(ids) > COMMON:
            continue
        for i, x in enumerate(ids):
            for y in ids[i + 1:]:
                shared[(x, y) if order[x] < order[y] else (y, x)] += 1
    same_tune: list[dict] = []
    for (x, y), count in shared.items():
        sx, sy = data[x], data[y]
        smaller = min(len(sx[1]), len(sy[1]))
        if smaller < MIN_SHINGLES:
            continue
        if count / smaller >= SAME_TUNE:
            ratio = abs(sx[2] - sy[2]) / max(sx[2], sy[2])
            jaccard = len(sx[0] & sy[0]) / len(sx[0] | sy[0]) if sx[0] or sy[0] else 0.0
            if jaccard >= NEAR and ratio <= NOTE_COUNT_RATIO:
                consider(x, y, "near", jaccard)
            elif levels[x] == levels[y]:
                consider(x, y, "same tune, same level", count / smaller)
            else:
                same_tune.append({"a": x, "b": y, "containment": round(count / smaller, 3), "jaccard": round(jaccard, 3)})

    OUT.mkdir(parents=True, exist_ok=True)
    report = {"removedArchive": found, "curatedCopies": curated_pairs, "sameTune": same_tune}
    (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    kind_counts = Counter(v["kind"] for v in found.values())
    print(f"archive copies to remove: {len(found)} ({dict(kind_counts)}); curated copies listed: {len(curated_pairs)}; "
          f"same tune, other arrangement (kept): {len(same_tune)}", flush=True)
    if a.apply:
        doc = json.loads(EXCLUDED.read_text(encoding="utf-8"))
        doc["duplicates"] = dict(sorted(found.items()))
        EXCLUDED.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"wrote {len(found)} duplicates to {EXCLUDED.name}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
