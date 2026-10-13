"""Build the blinded pilot benchmark: passages x conditions -> randomised, batched prompt files.

Usage (from the repository root, with research/.venv):

    research/.venv/Scripts/python.exe -I -m teacher_review.build_benchmark --seed 20261013 --runs A B

Writes
* ``research/data/teacher_review/runs/<run>/batch-NN.md`` — one self-contained reviewer input
  per batch (brief + legend + 7-8 passages, each a different musical passage, conditions mixed,
  order random, opaque item ids). PIG-derived, therefore never committed.
* ``research/data/teacher_review/runs/<run>/out/`` — where reviewers write their JSON.
* ``research/teacher_review/results/<run>/key.json`` — the blinding key: item -> passage,
  condition, annotator, planted faults with positions, per-note alternative expert fingers
  (digits only; no pitches or timing, so it can be committed).
* ``research/teacher_review/results/passages.json`` — the passage list (piece, bars, hands).
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from .inject import inject_faults
from .model import Passage
from .pig_passages import PIECES, PieceData, annotation_files, build_piece, extract_window
from .render import LEGEND, render_passage

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
DATA_OUT = HERE.parent / "data" / "teacher_review"
PROMPTS = HERE / "prompts"

# pieces whose synthesised timing sits on a clean grid (results/grid_diagnostics.json: at least
# 85% of onsets within 20% of a sixteenth of the 16th/triplet grid). Excluded: 003, 006, 007,
# 009, 010, 023 (jitter or tempo drift; their bar/beat rendering would be unreliable).
USABLE = {
    "Bach": ["001", "002", "004", "005", "008"],
    "Mozart": ["011", "012", "013", "014", "015", "016", "017", "018", "019", "020"],
    "Chopin": ["021", "022", "024", "025", "026", "027", "028", "029", "030"],
}
QUOTA = {"Bach": 11, "Mozart": 15, "Chopin": 14}
HAND_CONFIGS = [["R"]] * 16 + [["L"]] * 14 + [["R", "L"]] * 10
CONDITIONS = ["expert", "fhmm3", "corrupted"]


def _count(p: Passage, hand: str) -> int:
    return len(p.notes(hand))


def window_ok(piece: PieceData, b1: int, b2: int, hands: list[str]) -> bool:
    try:
        p = extract_window(piece, b1, b2, hands, "probe")
    except ValueError:
        return False
    for h in hands:
        n = _count(p, h)
        lo, hi = (10, 40) if len(hands) == 2 else (14, 48)
        if not (lo <= n <= hi):
            return False
        for e in p.sounding(h):
            if any(f == 0 for f in e.fingers):
                return False
    total = sum(_count(p, h) for h in p.events)
    if total > (72 if len(hands) == 2 else 90):
        return False
    # the FHMM3 output must give the same hand to every reviewed note
    try:
        extract_window(piece, b1, b2, hands, "probe", fingers="fhmm3")
    except ValueError:
        return False
    # faults must be plantable
    try:
        inject_faults(p, random.Random(0))
    except ValueError:
        return False
    return True


def candidate_windows(piece: PieceData, hands: list[str], rng: random.Random) -> list[tuple[int, int]]:
    out = []
    for b1 in range(1, piece.bars):
        for length in range(2, 9):
            b2 = b1 + length - 1
            if b2 > piece.bars:
                break
            if window_ok(piece, b1, b2, hands):
                out.append((b1, b2))
                break   # the shortest acceptable window from this start bar
    rng.shuffle(out)
    return out


def select_passages(seed: int) -> list[dict]:
    rng = random.Random(seed)
    configs = list(HAND_CONFIGS)
    rng.shuffle(configs)
    chosen: list[dict] = []
    used: dict[str, list[tuple[int, int]]] = {}
    pieces_cache: dict[tuple[str, str], PieceData] = {}
    for composer, quota in QUOTA.items():
        ids = list(USABLE[composer])
        rng.shuffle(ids)
        k = 0
        guard = 0
        while k < quota and guard < 200:
            pid = ids[guard % len(ids)]      # cycle through every piece before repeating one
            guard += 1
            slots = sorted(annotation_files(pid))
            slot = rng.choice(slots)
            key = (pid, slot)
            if key not in pieces_cache:
                pieces_cache[key] = build_piece(pid, slot)
            piece = pieces_cache[key]
            hands = configs[len(chosen) % len(configs)]
            wins = candidate_windows(piece, hands, rng)
            taken = used.get(pid, [])
            wins = [w for w in wins if all(w[1] < t[0] or w[0] > t[1] for t in taken)]
            if not wins:
                continue
            b1, b2 = wins[0]
            used.setdefault(pid, []).append((b1, b2))
            chosen.append({"passage": f"p{len(chosen) + 1:02d}", "piece": pid, "composer": composer,
                           "title": piece.title, "slot": slot, "annotator": piece.annotators.get(slot, "?"),
                           "bars": [b1, b2], "hands": hands})
            k += 1
    return chosen


def build_items(passages: list[dict], seed: int) -> tuple[dict[str, dict], dict[str, dict]]:
    """Return (renderings per passage per condition, key info per passage per condition)."""
    renders: dict[str, dict] = {}
    info: dict[str, dict] = {}
    cache: dict[tuple[str, str], PieceData] = {}
    kind_counts: dict[str, int] = {}
    for ps in passages:
        key = (ps["piece"], ps["slot"])
        if key not in cache:
            cache[key] = build_piece(*key)
        piece = cache[key]
        b1, b2 = ps["bars"]
        hands = ps["hands"]
        expert = extract_window(piece, b1, b2, hands, ps["passage"])
        fhmm = extract_window(piece, b1, b2, hands, ps["passage"], fingers="fhmm3")
        corrupted, faults = inject_faults(expert, random.Random(f"{seed}-{ps['passage']}"), prefer=kind_counts)
        for f in faults:
            kind_counts[f.kind] = kind_counts.get(f.kind, 0) + 1
        src = expert.notes_meta["source"]
        alt = {}
        for h in hands:
            for nid, _, f, _, _ in expert.notes(h):
                others = piece.all_fingers.get(src[nid], {})
                alt[nid] = {"expert": f, "others": [others[s] for s in sorted(others) if s != ps["slot"]]}
        renders[ps["passage"]] = {"expert": expert, "fhmm3": fhmm, "corrupted": corrupted}
        info[ps["passage"]] = {
            "n_notes": {h: _count(expert, h) for h in expert.events},
            "fingers": {c: {h: renders[ps["passage"]][c].finger_string(h) for h in hands} for c in CONDITIONS},
            "faults": [f.as_dict() for f in faults],
            "alt": alt,
        }
    return renders, info


def make_run(run: str, passages: list[dict], renders: dict, info: dict, seed: int, batch_size: int,
             variant: str) -> dict:
    rng = random.Random(f"{seed}-{run}")
    items = [(ps["passage"], c) for ps in passages for c in CONDITIONS]
    rng.shuffle(items)
    ids: dict[tuple[str, str], str] = {}
    taken: set[str] = set()
    for it in items:
        while True:
            iid = f"it-{rng.randrange(16 ** 4):04x}"
            if iid not in taken:
                taken.add(iid)
                ids[it] = iid
                break
    n_batches = -(-len(items) // batch_size)
    batches: list[list[tuple[str, str]]] = [[] for _ in range(n_batches)]
    for it in items:
        order = list(range(n_batches))
        rng.shuffle(order)
        order.sort(key=lambda b: len(batches[b]))
        for b in order:
            if len(batches[b]) < batch_size and all(x[0] != it[0] for x in batches[b]):
                batches[b].append(it)
                break
        else:
            raise RuntimeError("could not place item without a passage clash; raise batch count")
    run_dir = DATA_OUT / "runs" / run
    (run_dir / "out").mkdir(parents=True, exist_ok=True)
    (run_dir / "items").mkdir(parents=True, exist_ok=True)
    brief = (PROMPTS / "brief.md").read_text(encoding="utf-8")
    pre = (PROMPTS / f"variant_{variant}.md").read_text(encoding="utf-8")
    key = {"run": run, "seed": seed, "variant": variant, "batch_size": batch_size, "items": {}, "batches": {}}
    by_passage = {ps["passage"]: ps for ps in passages}
    for bi, batch in enumerate(batches, start=1):
        bid = f"{run}-{bi:02d}"
        lines = [f"# Batch {bid}", "", pre.strip(), "", brief.strip(), "", "## Notation", "", LEGEND.strip(), "",
                 f"## Passages ({len(batch)})", ""]
        for pid, cond in batch:
            iid = ids[(pid, cond)]
            p = renders[pid][cond].copy()
            p.passage_id = iid
            text = render_passage(p)
            (run_dir / "items" / f"{iid}.txt").write_text(text, encoding="utf-8", newline="\n")
            lines += ["```", text.rstrip("\n"), "```", ""]
            ps = by_passage[pid]
            key["items"][iid] = {"passage": pid, "condition": cond, "piece": ps["piece"], "composer": ps["composer"],
                                 "slot": ps["slot"], "annotator": ps["annotator"], "bars": ps["bars"],
                                 "hands": ps["hands"], "batch": bid, "n_notes": info[pid]["n_notes"],
                                 "fingers": info[pid]["fingers"][cond],
                                 "faults": info[pid]["faults"] if cond == "corrupted" else [],
                                 "alt": info[pid]["alt"] if cond != "corrupted" else {}}
        lines += [f"Output file: {(run_dir / 'out' / f'batch-{bi:02d}.json').as_posix()}", ""]
        (run_dir / f"batch-{bi:02d}.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")
        key["batches"][bid] = {"items": [ids[it] for it in batch], "file": (run_dir / f"batch-{bi:02d}.md").as_posix(),
                               "out": (run_dir / "out" / f"batch-{bi:02d}.json").as_posix(),
                               "chars": sum(len(x) for x in lines)}
    (RESULTS / run).mkdir(parents=True, exist_ok=True)
    (RESULTS / run / "key.json").write_text(json.dumps(key, indent=1), encoding="utf-8", newline="\n")
    return key


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", type=int, default=20261013)
    ap.add_argument("--runs", nargs="+", default=["A", "B"])
    ap.add_argument("--batch-size", type=int, default=8)
    args = ap.parse_args(argv)
    passages = select_passages(args.seed)
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "passages.json").write_text(json.dumps(passages, indent=1), encoding="utf-8", newline="\n")
    renders, info = build_items(passages, args.seed)
    for i, run in enumerate(args.runs):
        variant = "ab"[i % 2]
        key = make_run(run, passages, renders, info, args.seed, args.batch_size, variant)
        print(f"run {run}: {len(key['items'])} items in {len(key['batches'])} batches, variant {variant}")
    from collections import Counter
    print("passages:", len(passages), Counter(p["composer"] for p in passages),
          Counter("+".join(p["hands"]) for p in passages))
    print("faults:", Counter(f["kind"] for v in info.values() for f in v["faults"]))


if __name__ == "__main__":
    main()
