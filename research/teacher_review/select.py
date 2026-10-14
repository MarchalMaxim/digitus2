"""Passage selection for the weekly teacher review (verification spec 3.12, teacher-review.md 6.1 and 6.4).

lowconf  windows around the engine's lowest-confidence library notes: 2 to 8 bars, the shortest centred
         window with 16 notes in the reviewed hand (10 when 16 is out of reach, never above 48), at most
         two per piece, no overlap, no literal repeat; seed notes must sit in a line (a same-hand
         neighbour within inject.LINE_IOI_S), ties broken by a seeded rank
harderr  windows of 2 to 4 bars around the hard errors of the bench gallery, most hard errors first,
         then the shorter window; at most 16, and at most 4 per piece; PIG validation pieces with a usable
         timing grid only, never the official test pieces 001 to 030 (their errors must not seed hypotheses)
control  10 random windows of level 1 to 3 library pieces, one per piece, avoiding lowconf windows
planted  the first 4 controls (seeded order) that take two or more faults from inject.py
recall   4 other controls again: tritone transposition re-fingered by the engine, composer hidden,
         bars renumbered from 1
"""
from __future__ import annotations

import bisect
import json
import random
from collections import Counter, defaultdict
from collections.abc import Set as AbstractSet
from pathlib import Path

from .gallery import GalleryRow, pig_engine_window, slot_of
from .inject import LINE_IOI_S, inject_faults
from .model import Passage
from .musicxml_passages import (HIDDEN, IrregularWindow, count_notes, library_window, measure_at, regular_anchor,
                                render_round_trips)
from .pig_passages import PIECES, PieceData, build_piece

N_LOWCONF, PER_PIECE_LOWCONF, N_HARDERR, N_CONTROL, N_RECALL, N_PLANTED = 20, 2, 16, 10, 4, 4
PER_PIECE_HARDERR = 4
MIN_NOTES, TARGET_NOTES, MAX_NOTES, MAX_PASSAGE_NOTES = 10, 16, 48, 96
CONTROL_LEVELS = (1, 2, 3)
HARD_BARS = (2, 4)
SET_ORDER = ("lowconf", "harderr", "control", "planted", "recall")

VALIDATION_SPLIT = Path(__file__).resolve().parents[1] / "data" / "splits" / "pig_validation.json"
# The official PIG test pieces (nakamura2020 test subset), the ones pig_passages.PIECES describes.
PIG_TEST = frozenset(PIECES)
# The PIG validation pieces that can carry a hard error: bench marks a note hard only when two or more
# annotators agree, and these are the validation pieces with two annotations (List.csv). Meter, style shown to
# the reviewer and the first note's position in quarters from bar 1 (negative = upbeat) are read off ScorePDF,
# as pig_passages.PIECES does for the test pieces. Every grid passes the pilot's criterion (85 percent of onsets
# on the 16th or triplet grid; teacher-review.md 2.2): 046, 066 and 077 100 percent, 076 97.5 percent. The tests
# also hold each upbeat against the playing: more sounding time starts on beat 1 than with the bar line moved
# by one or two beats.
PIG_VALIDATION_META: dict[str, dict] = {
    "046": {"meter": (3, 4), "style": "minuet from a suite", "first_pos": 0},
    "066": {"meter": (3, 4), "style": "sonata, second movement", "first_pos": -1},
    "076": {"meter": (3, 4), "style": "waltz", "first_pos": -1},
    "077": {"meter": (3, 4), "style": "waltz", "first_pos": 0},
}
USABLE_PIG = frozenset(PIG_VALIDATION_META)


def validation_bench_split() -> dict:
    """A split file for ``bench --split`` whose test subset is exactly the PIG validation pieces: bench reads
    ``splits.<name>.<subset>.pieces`` and cannot read pig_validation.json, a plain piece list."""
    pieces = json.loads(VALIDATION_SPLIT.read_text(encoding="utf-8"))["pieces"]
    return {"note": "teacher review hard-error set: the PIG validation pieces of research/data/splits/"
                    "pig_validation.json as the test subset; never the official test pieces 001-030",
            "default_split": "validation", "splits": {"validation": {"test": {"pieces": pieces}}}}


def load_pig(pid: str, slot: str) -> PieceData:
    """pig_passages.build_piece for a validation piece of PIG_VALIDATION_META. build_piece reads meter, style and
    upbeat from pig_passages.PIECES, which holds the 30 test pieces and stays as it is (the pilot's grid
    diagnostics iterate it), so the validation piece's entry is there for the call only."""
    if pid not in PIG_VALIDATION_META:
        raise KeyError(f"PIG piece {pid} is not a validation piece with two annotations (PIG_VALIDATION_META)")
    added = pid not in PIECES
    if added:
        PIECES[pid] = PIG_VALIDATION_META[pid]
    try:
        return build_piece(pid, slot)
    finally:
        if added:
            del PIECES[pid]


def _overlaps(w: list[int] | tuple[int, int], taken) -> bool:
    return any(not (w[1] < a or w[0] > b) for a, b in taken)


def _window_fits(piece: dict, i1: int, i2: int, hands: list[str]) -> Passage | None:
    try:
        regular_anchor(piece, i1, i2)
    except IrregularWindow:
        return None
    counts = {h: count_notes(piece, i1, i2, h) for h in ("R", "L")}
    if any(not MIN_NOTES <= counts[h] <= MAX_NOTES for h in hands) or sum(counts.values()) > MAX_PASSAGE_NOTES:
        return None
    p = library_window(piece, i1, i2, hands, "probe")
    return p if render_round_trips(p) else None


def _signature(p: Passage, hand: str) -> tuple:
    evs = p.events.get(hand, [])
    t0 = evs[0].onset_q if evs else 0
    return tuple((e.onset_q - t0, tuple(e.pitches), e.dur_q, tuple(e.fingers)) for e in evs)


def _in_line(onsets: dict[str, list[float]], n: dict) -> bool:
    """A same-hand onset other than the note's own within LINE_IOI_S before or after it. ``onsets`` holds the
    sorted distinct onsets of the hand's non-grace notes, so the note's own onset is xs[i]."""
    xs = onsets[n["hand"]]
    i = bisect.bisect_left(xs, n["onsetSec"])
    return any(0 < abs(xs[j] - n["onsetSec"]) <= LINE_IOI_S + 1e-9 for j in (i - 1, i + 1) if 0 <= j < len(xs))


def _centred(piece: dict, mi: int, hand: str, min_notes: int, avoid) -> tuple[int, int, Passage] | None:
    for length in range(2, 9):
        for o in sorted(range(length), key=lambda o: (abs(2 * o - (length - 1)), o)):
            i1 = mi - o
            i2 = i1 + length - 1
            if i1 < 0 or i2 >= len(piece["measures"]) or _overlaps((i1, i2), avoid):
                continue
            if count_notes(piece, i1, i2, hand) < min_notes:
                continue
            p = _window_fits(piece, i1, i2, [hand])
            if p is not None:
                return i1, i2, p
    return None


def _library_record(piece: dict, i1: int, i2: int, hands: list[str], set_name: str) -> dict:
    return {"set": set_name, "source": "library", "piece": piece["id"], "slug": piece["slug"], "title": piece["title"],
            "level": piece["level"], "measures": [i1, i2], "hands": list(hands)}


def select_lowconf(library: list[dict], seed: int, n: int = N_LOWCONF) -> list[dict]:
    originals = [p for p in library if p.get("transpose", 0) == 0]
    by_id = {p["id"]: p for p in originals}
    rng = random.Random(f"{seed}-lowconf")
    seeds = []
    for piece in originals:
        onsets = {h: sorted({x["onsetSec"] for x in piece["notes"] if x["hand"] == h and not x["isGrace"]})
                  for h in ("R", "L")}
        for note in piece["notes"]:
            rank = rng.random()
            if note["isGrace"] or note["confidence"] is None or not _in_line(onsets, note):
                continue
            seeds.append((round(note["confidence"], 9), rank, piece["id"], note["index"]))
    seeds.sort()
    out, taken, signatures = [], defaultdict(list), set()
    for conf, _, pid, idx in seeds:
        if len(out) == n:
            break
        piece = by_id[pid]
        note = piece["notes"][idx]
        if len(taken[pid]) >= PER_PIECE_LOWCONF:
            continue
        mi = measure_at(piece, note["onsetTick"])
        if any(a <= mi <= b for a, b in taken[pid]):
            continue
        found = _centred(piece, mi, note["hand"], TARGET_NOTES, taken[pid]) or \
            _centred(piece, mi, note["hand"], MIN_NOTES, taken[pid])
        if found is None:
            continue
        i1, i2, p = found
        sig = _signature(p, note["hand"])
        if sig in signatures:
            continue
        signatures.add(sig)
        taken[pid].append((i1, i2))
        seed_note = next(k for k, v in p.notes_meta["source"].items() if v == note["id"])
        out.append(dict(_library_record(piece, i1, i2, [note["hand"]], "lowconf"), passage=f"lc{len(out) + 1:02d}",
                        seed_note=seed_note, seed_confidence=note["confidence"]))
    return out


def select_harderr(pig: dict[str, dict], rows: dict[str, list[GalleryRow]], *, loader=load_pig,
                   usable: AbstractSet[str] = USABLE_PIG, cap: int = N_HARDERR,
                   per_piece: int = PER_PIECE_HARDERR) -> tuple[list[dict], dict]:
    test_pages = sorted(pid for pid in rows if pid in PIG_TEST)
    if test_pages:
        raise ValueError(f"the gallery holds official PIG test pieces {', '.join(test_pages)}: hard errors come from "
                         "the validation pieces only, never from the test pieces 001 to 030")
    skipped = {"unusable grid": 0, "not in the quantised piece": 0, "not covered": 0}
    cands, pieces, hard_all, total = [], {}, {}, 0
    for pid in sorted(rows):
        hard_rows = [r for r in rows[pid] if r.hard]
        if not hard_rows:
            continue
        if pid not in usable:
            skipped["unusable grid"] += len(hard_rows)
            continue
        dp = pig[pid]
        piece = pieces[pid] = loader(pid, slot_of(dp))
        where = {sid: (piece.bar_of(e.onset_q), hand) for hand, evs in piece.events.items() for e in evs
                 for sid in e.source_ids}
        hard = []
        for r in hard_rows:
            sid = dp["notes"][r.index]["id"]
            if sid not in where:
                skipped["not in the quantised piece"] += 1
                continue
            hard.append((where[sid][0], where[sid][1], sid, r.annotators[0]))
        hard_all[pid] = hard
        total += len(hard)

        def notes_in(b1, b2, h):
            return sum(len(e.pitches) for e in piece.events.get(h, [])
                       if not e.is_rest and b1 <= piece.bar_of(e.onset_q) <= b2)

        seen = set()
        for bar, _, _, _ in sorted(set(hard)):
            for length in range(HARD_BARS[0], HARD_BARS[1] + 1):
                for b1 in range(bar - length + 1, bar + 1):
                    b2 = b1 + length - 1
                    if b1 < 1 or b2 > piece.bars or (b1, b2) in seen:
                        continue
                    seen.add((b1, b2))
                    hands = [h for h in ("R", "L") if any(b1 <= hb <= b2 and hh == h for hb, hh, _, _ in hard)]
                    counts = {h: notes_in(b1, b2, h) for h in ("R", "L")}
                    if any(not MIN_NOTES <= counts[h] <= MAX_NOTES for h in hands) or \
                            sum(counts.values()) > MAX_PASSAGE_NOTES:
                        continue
                    score = sum(1 for hb, hh, _, _ in hard if b1 <= hb <= b2 and hh in hands)
                    cands.append((-score, b2 - b1, pid, b1, b2, tuple(hands)))
    cands.sort()
    out = []
    for _, _, pid, b1, b2, hands in cands:
        if len(out) == cap:
            break
        mine = [tuple(r["bars"]) for r in out if r["pig"] == pid]
        if len(mine) >= per_piece or _overlaps((b1, b2), mine):
            continue
        p = pig_engine_window(pieces[pid], b1, b2, list(hands), "probe", pig[pid])
        if not render_round_trips(p):
            continue
        hard = {sid: f for hb, hh, sid, f in hard_all[pid] if b1 <= hb <= b2 and hh in hands}
        out.append({"passage": f"he{len(out) + 1:02d}", "set": "harderr", "source": "pig", "piece": pig[pid]["id"],
                    "pig": pid, "slot": slot_of(pig[pid]), "bars": [b1, b2], "hands": list(hands), "hard": hard})
    skipped["not covered"] = total - sum(len(r["hard"]) for r in out)
    return out, skipped


def select_controls(library: list[dict], lowconf: list[dict], seed: int, n: int = N_CONTROL) -> list[dict]:
    rng = random.Random(f"{seed}-control")
    pool = sorted((p for p in library if p.get("transpose", 0) == 0 and p["level"] in CONTROL_LEVELS),
                  key=lambda p: p["id"])
    rng.shuffle(pool)
    taken = defaultdict(list)
    for r in lowconf:
        taken[r["piece"]].append(tuple(r["measures"]))
    out = []
    for piece in pool:
        if len(out) == n:
            break
        nmeas = len(piece["measures"])
        for _ in range(40):
            hands = rng.choice([["R"], ["L"], ["R", "L"]])
            length = rng.randint(2, 8)
            if length > nmeas:
                continue
            i1 = rng.randrange(0, nmeas - length + 1)
            i2 = i1 + length - 1
            if _overlaps((i1, i2), taken[piece["id"]]) or _window_fits(piece, i1, i2, hands) is None:
                continue
            out.append(dict(_library_record(piece, i1, i2, hands, "control"), passage=f"ct{len(out) + 1:02d}"))
            break
    return out


def plant_and_twin(controls: list[dict], by_id: dict[str, dict], seed: int) -> tuple[list[dict], list[dict]]:
    order = sorted(controls, key=lambda r: r["passage"])
    random.Random(f"{seed}-planted").shuffle(order)
    planted, kinds = [], Counter()
    for rec in order:
        if len(planted) == N_PLANTED:
            break
        base = library_window(by_id[rec["piece"]], *rec["measures"], rec["hands"], rec["passage"])
        try:
            q, faults = inject_faults(base, random.Random(f"{seed}-{rec['passage']}"), prefer=dict(kinds))
        except ValueError:
            continue
        if not render_round_trips(q):
            continue
        kinds.update(f.kind for f in faults)
        planted.append(dict(rec, passage=f"pf{len(planted) + 1:02d}", set="planted", twin_of=rec["passage"],
                            faults=[f.as_dict() for f in faults]))
    with_planted = {r["twin_of"] for r in planted}
    ordered = sorted(controls, key=lambda r: r["passage"])
    free = [r for r in ordered if r["passage"] not in with_planted]
    pool = free if len(free) >= N_RECALL else ordered
    rng = random.Random(f"{seed}-recall")
    recall = []
    for rec in rng.sample(pool, len(pool)):
        if len(recall) == N_RECALL:
            break
        tt = by_id.get(f"{rec['piece']}@tritone")
        if tt is None:
            continue
        p = library_window(tt, *rec["measures"], rec["hands"], "probe", composer=HIDDEN[0], style=HIDDEN[1],
                           first_bar=1)
        if not render_round_trips(p):
            continue
        recall.append(dict(rec, set="recall", piece=tt["id"], twin_of=rec["passage"], transpose=tt["transpose"]))
    recall.sort(key=lambda r: r["twin_of"])
    for k, r in enumerate(recall, 1):
        r["passage"] = f"rc{k:02d}"
    return planted, recall


def select_all(dump: dict, rows: dict[str, list[GalleryRow]], seed: int, *, loader=load_pig,
               usable: AbstractSet[str] = USABLE_PIG) -> dict:
    library = [p for p in dump["pieces"] if p["source"] == "library"]
    pig = {p["pigId"]: p for p in dump["pieces"] if p["source"] == "pig"}
    by_id = {p["id"]: p for p in dump["pieces"]}
    low = select_lowconf(library, seed)
    hard, skipped = select_harderr(pig, rows, loader=loader, usable=usable)
    ctrl = select_controls(library, low, seed)
    planted, recall = plant_and_twin(ctrl, by_id, seed)
    records = low + hard + ctrl + planted + recall
    return {"seed": seed, "records": records, "counts": {s: sum(r["set"] == s for r in records) for s in SET_ORDER},
            "skipped": skipped}


def build_passages(records: list[dict], dump: dict, *, loader=load_pig) -> dict[str, Passage]:
    by_id = {p["id"]: p for p in dump["pieces"]}
    out: dict[str, Passage] = {}
    cache: dict[tuple[str, str], object] = {}
    for rec in sorted(records, key=lambda r: SET_ORDER.index(r["set"])):     # controls before their twins
        pid = rec["passage"]
        if rec["set"] in ("lowconf", "control"):
            out[pid] = library_window(by_id[rec["piece"]], *rec["measures"], rec["hands"], pid)
        elif rec["set"] == "recall":
            out[pid] = library_window(by_id[rec["piece"]], *rec["measures"], rec["hands"], pid,
                                      composer=HIDDEN[0], style=HIDDEN[1], first_bar=1)
        elif rec["set"] == "planted":
            p = out[rec["twin_of"]].copy() if rec["twin_of"] in out else \
                library_window(by_id[rec["piece"]], *rec["measures"], rec["hands"], pid)
            for f in rec["faults"]:
                for nid, finger in f["after"].items():
                    p.set_finger(nid, finger)
            p.passage_id = pid
            out[pid] = p
        else:
            key = (rec["pig"], rec["slot"])
            if key not in cache:
                cache[key] = loader(*key)
            p = pig_engine_window(cache[key], *rec["bars"], rec["hands"], pid, by_id[rec["piece"]])
            p.notes_meta["hard"] = {nid: rec["hard"][sid] for nid, sid in p.notes_meta["source"].items()
                                    if sid in rec["hard"] and nid[0] in rec["hands"]}
            out[pid] = p
    return out
