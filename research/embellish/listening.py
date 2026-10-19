"""Listening-test material for issue #38: ten library pieces, plain and embellished, as MusicXML, plus a
blinded teacher-review batch in the shape of research/teacher_review.

Selection (deterministic): pieces embellished at both densities whose own check passes, with no more
law or beginner lint errors than the plain score, a level proposal at most one up; six curated
pieces and four from the MuseScore archive, in catalogue order, one per collection first and a second
where a lane runs short. The archive's jazz and blues collection is left out (modern songs whose
melodies may still be under copyright).

Writes, under research/embellish/listening/:
  NN-<slug>-plain.musicxml, -light.musicxml, -playful.musicxml   (the title says which)
  NN-<slug>.inserted.json                                         (every inserted note, both densities)
  pieces.json                                                     (the selection and its numbers)
  teacher/batch-NN.md, teacher/key.json                           (blinded passages; brief in teacher/brief.md)

    research/.venv/Scripts/python.exe -I research/embellish/listening.py [--seed 38]

The passages are rendered with research/teacher_review's own text format (`model.Passage`,
`render.render_passage`) without a fingering column: the reviewer judges the notes, not fingers.
License: MIT.
"""
from __future__ import annotations

import argparse
import gzip
import json
import random
import re
import sys
from collections import Counter
from fractions import Fraction as F
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
ROOT = RESEARCH.parent
if str(RESEARCH) not in sys.path:
    sys.path.insert(0, str(RESEARCH))
from embellish import core  # noqa: E402
from embellish.check import read  # noqa: E402
from teacher_review.model import Event, Passage, number_events  # noqa: E402
from teacher_review.render import render_passage  # noqa: E402

MANIFEST = ROOT / "content" / "manifest.json"
DATA = RESEARCH / "data" / "embellish"
LISTEN = HERE / "listening"
TEACHER = LISTEN / "teacher"
DENS = ("light", "playful")
CONDITIONS = ("plain", "light", "playful")
MAX_BYTES = 1_000_000
N_CURATED, N_ARCHIVE = 6, 4
WINDOW_BARS = 4
BATCHES = 5
# modern songs: the archive arrangement is CC0, but the melody may not be in the public domain
EXCLUDE = {"Jazz and blues from the MuseScore archive"}


def eligible(rows: dict[str, dict]) -> bool:
    plain = rows["none"]
    for d in DENS:
        r = rows[d]
        if r["refusal"] or not r["inserted"] or not r["check"]["ok"]:
            return False
        if r["lint"]["law_errors"] > plain["lint"]["law_errors"] or r["lint"]["law_errors"] > 0:
            return False
        if r["lint"]["beginner_errors"] > plain["lint"]["beginner_errors"]:
            return False
        if r["level_heuristic"]["proposal"] - plain["level_heuristic"]["proposal"] > 1:
            return False
    return True


def select(results: list[dict], manifest: list[dict]) -> list[dict]:
    by: dict[str, dict] = {}
    for r in results:
        by.setdefault(r["slug"], {})[r["density"]] = r
    order = [e for e in manifest if e["slug"] in by and eligible(by[e["slug"]])
             and e["collection"] not in EXCLUDE]
    picked: list[dict] = []
    for archive, quota in ((False, N_CURATED), (True, N_ARCHIVE)):
        lane = [e for e in order if e["files"]["score"].endswith(".gz") == archive]
        for per_collection in (1, 2):  # one per collection first, then a second where needed
            for e in lane:
                if sum(1 for p in picked if p["files"]["score"].endswith(".gz") == archive) == quota:
                    break
                if e in picked or sum(1 for p in picked if p["collection"] == e["collection"]) >= per_collection:
                    continue
                picked.append(e)
    return picked


def retitle(xml: str, suffix: str, title: str) -> str:
    """Adds " (suffix)" to the work and movement titles and to every credit that shows one of them (or
    the catalogue `title`); a file with neither title gets a movement title, so the app shows the version."""
    names = {escape(title).strip()}
    found = False
    for tag in ("work-title", "movement-title"):
        m = re.search(rf"<{tag}>(.*?)</{tag}>", xml, flags=re.S)
        if m:
            names.add(m.group(1).strip())
            xml = xml[:m.end(1)] + f" ({suffix})" + xml[m.end(1):]
            found = True
    xml = re.sub(r"(<credit-words\b[^>]*>)(.*?)(</credit-words>)",
                 lambda m: m.group(1) + m.group(2) + (f" ({suffix})" if m.group(2).strip() in names else "") + m.group(3),
                 xml, flags=re.S)
    if not found:
        new = f"<movement-title>{escape(title)} ({suffix})</movement-title>"
        anchor = None
        for close in ("</movement-number>", "</work>"):
            k = xml.find(close)
            if k >= 0:
                anchor = k + len(close)
                break
        if anchor is None:
            anchor = re.search(r"<score-partwise\b[^>]*>", xml).end()
        xml = xml[:anchor] + new + xml[anchor:]
    return xml


def plain_text(entry: dict) -> str:
    data = (ROOT / "content" / entry["files"]["score"]).read_bytes()
    return (gzip.decompress(data) if entry["files"]["score"].endswith(".gz") else data).decode("utf-8")


# ---- passages ---------------------------------------------------------------------------------

def hand_events(xs, hand: str, t1: F, t2: F) -> list[Event]:
    staff_ok = (lambda s: s == "1") if hand == "R" else (lambda s: s != "1")
    groups: dict[F, list] = {}
    for n in xs.notes:
        if n.pitch is None or n.grace or n.tie_stop or not staff_ok(n.staff) or not (t1 <= n.onset < t2):
            continue
        groups.setdefault(n.onset, []).append(n)
    events, last_end = [], t1
    for onset in sorted(groups):
        if onset - last_end >= F(1, 2):
            events.append(Event(hand, last_end, 0.0, onset - last_end))
        ns = groups[onset]
        dur = max(n.dur for n in ns)
        events.append(Event(hand, onset, 0.0, dur, sorted({n.pitch for n in ns}), []))
        last_end = max(last_end, onset + dur)
    if t2 - last_end >= F(1, 2):
        events.append(Event(hand, last_end, 0.0, t2 - last_end))
    return number_events(events, hand)


def window(xs, inserted: list[dict]) -> tuple[int, int] | None:
    """Measure indices (first, last) of the WINDOW_BARS regular bars holding the most insertions."""
    times = dict(xs.times)
    cur, regular = None, []
    for m in xs.measures:
        cur = times.get(m.idx, cur)
        regular.append(cur is not None and m.length == F(cur[0] * 4, cur[1]) and m.number.isdigit()
                       and not m.implicit)
    onsets = [F(i["onset"]) for i in inserted]
    best = None
    for i in range(len(xs.measures) - WINDOW_BARS + 1):
        ms = xs.measures[i:i + WINDOW_BARS]
        if not all(regular[i:i + WINDOW_BARS]):
            continue
        if any(times.get(m.idx) not in (None, times.get(ms[0].idx)) for m in ms[1:]):
            continue
        if [int(m.number) for m in ms] != list(range(int(ms[0].number), int(ms[0].number) + WINDOW_BARS)):
            continue
        t1, t2 = ms[0].start, ms[-1].start + ms[-1].length
        k = sum(1 for o in onsets if t1 <= o < t2)
        if best is None or k > best[0]:
            best = (k, i)
    return (best[1], best[1] + WINDOW_BARS - 1) if best and best[0] > 0 else None


def passage(xml: str, entry: dict, span: tuple[int, int], pid: str) -> Passage:
    xs = read(xml)
    times = dict(xs.times)
    cur = None
    for m in xs.measures[: span[0] + 1]:
        cur = times.get(m.idx, cur)
    m1, m2 = xs.measures[span[0]], xs.measures[span[1]]
    t1, t2 = m1.start, m2.start + m2.length
    composer = re.sub(r"\s*\([^)]*\)", "", entry["composer"] or "Traditional").strip() or "Traditional"
    p = Passage(pid, composer, entry["genre"], tuple(cur), int(entry["tempoBpm"]),
                int(m1.number), int(m2.number),
                events={"R": hand_events(xs, "R", t1, t2), "L": hand_events(xs, "L", t1, t2)})
    p.notes_meta["bar1_q"] = str(t1 - (int(m1.number) - 1) * p.bar_q)
    return p


def render(p: Passage) -> str:
    body = render_passage(p, with_fingers=[], header=False)
    lines = []
    for line in body.splitlines():
        if line.startswith("id ") and line.rstrip().endswith("f"):
            line = line.rstrip()[:-1]
        elif line.rstrip().endswith(" -"):
            line = line.rstrip()[:-1]
        elif line == "RH (context)":
            line = "RH (melody)"
        elif line == "LH (context)":
            line = "LH (accompaniment)"
        lines.append(line.rstrip())
    head = (f"PASSAGE {p.passage_id}\nComposer: {p.composer} ({p.style}). Meter: {p.meter[0]}/{p.meter[1]}. "
            f"Tempo: quarter = {p.tempo_qpm}. Bars {p.bar_first}-{p.bar_last}.")
    return head + "\n" + "\n".join(lines) + "\n"


def inserted_ids(p: Passage, inserted: list[dict]) -> list[str]:
    wanted = {(F(i["onset"]), i["midi"]) for i in inserted}
    out = []
    for e in p.events["R"]:
        for nid, pitch in zip(e.ids, e.pitches):
            if (e.onset_q, pitch) in wanted:
                out.append(nid)
    return out


def plan(items: list[dict], seed: int) -> list[list[dict]]:
    """BATCHES batches; the three conditions of a piece always in three different batches."""
    rng = random.Random(seed)
    pieces = sorted({i["slug"] for i in items})
    rng.shuffle(pieces)
    batches: list[list[dict]] = [[] for _ in range(BATCHES)]
    for k, slug in enumerate(pieces):
        conds = [i for i in items if i["slug"] == slug]
        rng.shuffle(conds)
        for j, item in enumerate(conds):
            batches[(k + j * 2) % BATCHES].append(item)
    for b in batches:
        rng.shuffle(b)
    return batches


def main(argv=None) -> int:
    getattr(sys.stdout, "reconfigure", lambda **_: None)(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", type=int, default=38)
    ap.add_argument("--results", type=Path, default=DATA / "results.json")
    a = ap.parse_args(argv)
    results = json.loads(a.results.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    picked = select(results, manifest)
    rows = {(r["slug"], r["density"]): r for r in results}
    LISTEN.mkdir(parents=True, exist_ok=True)
    TEACHER.mkdir(parents=True, exist_ok=True)
    for old in list(LISTEN.glob("*.musicxml")) + list(LISTEN.glob("*.inserted.json")) + list(TEACHER.glob("batch-*.md")):
        old.unlink()
    rng = random.Random(a.seed)
    used_ids: set[str] = set()
    items, listing = [], []
    for k, e in enumerate(picked, start=1):
        plain = plain_text(e)
        versions = {"plain": (plain, [])}
        for d in DENS:
            res = core.embellish(plain, d)
            versions[d] = (res.xml, res.inserted)
        record = {"slug": e["slug"], "inserted": {d: versions[d][1] for d in DENS}}
        stem = f"{k:02d}-{e['slug']}"
        for cond, (xml, _) in versions.items():
            out = retitle(xml, "plain" if cond == "plain" else f"embellished, {cond}", e["title"])
            data = out.encode("utf-8")
            if len(data) > MAX_BYTES:
                raise SystemExit(f"{stem}-{cond} is {len(data)} bytes, over {MAX_BYTES}")
            (LISTEN / f"{stem}-{cond}.musicxml").write_bytes(data)
        (LISTEN / f"{stem}.inserted.json").write_text(json.dumps(record, indent=1, default=str), encoding="utf-8", newline="\n")
        span = window(read(versions["playful"][0]), versions["playful"][1])
        listing.append({"n": k, "slug": e["slug"], "title": e["title"], "composer": e["composer"],
                        "collection": e["collection"], "level": e["level"], "tempoBpm": e["tempoBpm"],
                        "source": e["source"], "files": [f"{stem}-{c}.musicxml" for c in CONDITIONS],
                        "added": {d: len(versions[d][1]) for d in DENS},
                        "proposal": {c: rows[(e["slug"], "none" if c == "plain" else c)]["level_heuristic"]["proposal"]
                                     for c in CONDITIONS},
                        "window": None if span is None else [int(read(plain).measures[i].number) for i in span]})
        if span is None:
            continue
        for cond in CONDITIONS:
            xml, ins = versions[cond]
            while True:
                pid = f"em-{rng.randrange(16 ** 4):04x}"
                if pid not in used_ids:
                    used_ids.add(pid)
                    break
            p = passage(xml, e, span, pid)
            items.append({"item": pid, "slug": e["slug"], "condition": cond, "text": render(p),
                          "bars": [p.bar_first, p.bar_last], "inserted_ids": inserted_ids(p, ins),
                          "notes_R": sum(len(ev.pitches) for ev in p.events["R"])})
    (LISTEN / "pieces.json").write_text(json.dumps(listing, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")
    brief = (TEACHER / "brief.md").read_text(encoding="utf-8")
    batches = plan(items, a.seed)
    key = []
    for b, batch in enumerate(batches, start=1):
        bid = f"batch-{b:02d}"
        parts = [f"# Batch {bid}\n", brief, "\n## Passages\n"]
        for item in batch:
            parts.append("```\n" + item["text"] + "```\n")
            key.append({k: v for k, v in item.items() if k != "text"} | {"batch": bid})
        (TEACHER / f"{bid}.md").write_text("\n".join(parts), encoding="utf-8", newline="\n")
    (TEACHER / "key.json").write_text(json.dumps(key, indent=1), encoding="utf-8", newline="\n")
    print(f"{len(picked)} pieces, {len(items)} passages in {len(batches)} batches")
    for row in listing:
        print(f"{row['n']:2d} {row['slug']:44} added {row['added']} proposal {row['proposal']} window {row['window']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
