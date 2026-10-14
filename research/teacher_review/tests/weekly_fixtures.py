"""Helpers for the weekly-job tests: the real engine dump (skipped without node and the engine
build), and, from Task 2 on, synthetic dumps, PIG pieces, gallery pages and fake reviews (no
engine, no PIG data)."""
from __future__ import annotations

import json
import shutil
import subprocess
from fractions import Fraction
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
ENGINE_DUMP = REPO / "research" / "teacher_review" / "engine_dump.mjs"
DIST_INDEX = REPO / "packages" / "engine" / "dist" / "src" / "index.js"
BENCH_CLI = REPO / "packages" / "engine" / "dist" / "cli" / "main.js"
PIG_FILES = REPO / "research" / "data" / "pig" / "FingeringFiles"
NODE = shutil.which("node")

needs_engine = pytest.mark.skipif(not NODE or not DIST_INDEX.exists(),
                                  reason="needs node and the engine build (pnpm --filter @digitus2/engine build)")
needs_pig = pytest.mark.skipif(not PIG_FILES.exists(), reason="needs the PIG dataset under research/data/pig")


def run_dump(out: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([NODE, str(ENGINE_DUMP), "--out", str(out), *args], cwd=REPO, capture_output=True,
                          text=True, encoding="utf-8", timeout=600)


def bench_gallery(tmp_path: Path, pieces: list[str], profile: str) -> dict:
    """bench on the given PIG pieces into tmp_path (never benchmarks/): pig_validation.json is a plain piece
    list, so bench gets a split file whose test subset is exactly those pieces."""
    from teacher_review.gallery import read_gallery
    split = tmp_path / "split.json"
    split.write_text(json.dumps({"default_split": "validation", "splits": {"validation": {"test": {"pieces": pieces}}}}),
                     encoding="utf-8")
    runs = tmp_path / profile / "runs"
    r = subprocess.run([NODE, str(BENCH_CLI), "bench", "--gold", "research/data/pig", "--split", str(split),
                        "--subset", "test", "--profile", profile, "--label", "t", "--out", str(runs)],
                       cwd=REPO, capture_output=True, text=True, encoding="utf-8", timeout=600)
    assert r.returncode == 0, r.stderr
    return read_gallery(tmp_path / profile / "errors" / "t")


# ---- synthetic library pieces (Task 2) ---------------------------------------------------------

DIV = 4  # ticks per quarter in synthetic dumps

LINT_RULES = {"L01": {"title": "Two simultaneous notes share a finger", "law": True},
              "L05": {"title": "Span beyond the practical maximum on keys held together", "law": True},
              "L06": {"title": "Non-thumb crossing", "law": False},
              "L07": {"title": "Uncomfortable span", "law": False},
              "L11": {"title": "Fast hop with the same finger", "law": False},
              "L14": {"title": "Agility", "law": False}}


def nt(onset_q, dur_q, midi, finger, conf=0.95, grace=False, lint=()):
    """One synthetic note; onset in quarters from the start of bar 1 (negative = pickup)."""
    return {"onset": Fraction(onset_q), "dur": Fraction(dur_q), "midi": midi, "finger": finger, "conf": conf,
            "grace": grace, "lint": list(lint)}


def line(start_q, step_q, midis, fingers, conf=0.95):
    step = Fraction(step_q)
    return [nt(Fraction(start_q) + i * step, step, m, f, conf) for i, (m, f) in enumerate(zip(midis, fingers))]


def eighths(bars, conf=None, vary=True, shift=0):
    """RH eighths up and down a five-finger position, 8 per bar, fingers 1-2-3-4-5-4-3-2. With vary,
    each bar moves by (7 * bar) mod 12 semitones so no two bars of a piece are equal. conf maps
    (bar, k) to a confidence."""
    pitches, fingers, out = [60, 62, 64, 65, 67, 65, 64, 62], [1, 2, 3, 4, 5, 4, 3, 2], []
    for b in range(1, bars + 1):
        move = shift + ((7 * b) % 12 if vary else 0)
        for k in range(8):
            out.append(nt(Fraction(4 * (b - 1)) + Fraction(k, 2), Fraction(1, 2), pitches[k] + move, fingers[k],
                          conf=(conf or {}).get((b, k), 0.95)))
    return out


def quarters(bars, conf=None, beats=4):
    out = []
    for b in range(1, bars + 1):
        for k in range(beats):
            out.append(nt(beats * (b - 1) + k, 1, 60 + 2 * k + (b % 5), k + 1, conf=(conf or {}).get((b, k), 0.95)))
    return out


def chords(bars):
    """LH half-note triads (C3-E3-G3, fingers 5-3-1) on beats 1 and 3."""
    return [nt(Fraction(4 * (b - 1) + h * 2), 2, m, f) for b in range(1, bars + 1) for h in (0, 1)
            for m, f in ((48, 5), (52, 3), (55, 1))]


def lib_piece(slug, *, rh=(), lh=(), meter=(4, 4), bars=8, pickup_q=0, level=1, tempo=100, title="Test piece",
              composer="Test Composer", transpose=0, numbers=None, lengths_q=None):
    """A library dump piece shaped like engine_dump.mjs output. Notes are sorted like the engine's
    (onset, R before L, pitch); ids n<k> and sourceIndex k follow the input order (rh, then lh)."""
    beats, beat_type = meter
    bar_q = Fraction(4 * beats, beat_type)
    lengths = [Fraction(x) for x in lengths_q] if lengths_q else \
        ([Fraction(pickup_q)] if pickup_q else []) + [bar_q] * bars
    first = 0 if pickup_q else 1
    nums = list(numbers) if numbers else [str(first + i) for i in range(len(lengths))]
    measures, start = [], 0
    for i, (ln, num) in enumerate(zip(lengths, nums)):
        ticks = int(ln * DIV)
        measures.append({"index": i, "number": num, "startTick": start, "lengthTicks": ticks, "beats": beats,
                         "beatType": beat_type})
        start += ticks
    origin = int(Fraction(pickup_q) * DIV)
    raw = [("R", k, n) for k, n in enumerate(rh)] + [("L", len(rh) + k, n) for k, n in enumerate(lh)]

    def tick(q):
        return origin + int(Fraction(q) * DIV)

    order = sorted(raw, key=lambda x: (tick(x[2]["onset"]), 0 if x[0] == "R" else 1, x[2]["midi"], x[1]))
    qsec = 60 / tempo
    notes = []
    for index, (hand, src, n) in enumerate(order):
        on = tick(n["onset"])
        off = on if n["grace"] else on + int(n["dur"] * DIV)
        mi = max(i for i, m in enumerate(measures) if m["startTick"] <= on)
        notes.append({"index": index, "id": f"n{src}", "hand": hand, "staff": 1 if hand == "R" else 2, "voice": 1,
                      "midi": n["midi"] + transpose, "pitch": "", "onsetTick": on, "offsetTick": off,
                      "onsetSec": on / DIV * qsec, "offsetSec": off / DIV * qsec, "measureIndex": mi,
                      "measure": measures[mi]["number"], "beatQ": (on - measures[mi]["startTick"]) / DIV,
                      "durQ": (off - on) / DIV, "isGrace": n["grace"], "chordId": f"{hand}@{on}", "tied": False,
                      "sourceIndex": src, "finger": n["finger"], "confidence": n["conf"],
                      "gaps": [0 if f == n["finger"] else 1.5 * abs(f - n["finger"]) for f in range(1, 6)],
                      "lint": [f"{r}:warning" for r in n["lint"]]})
    piece = {"id": slug + ("@tritone" if transpose else ""), "source": "library", "slug": slug, "title": title,
             "composer": composer, "level": level, "file": f"content/scores/{slug}.musicxml", "transpose": transpose,
             "divisions": DIV, "tempoMap": [{"tick": 0, "qpm": tempo}], "measures": measures, "notes": notes,
             "rests": [], "solve": []}
    from teacher_review.musicxml_passages import derive_rests
    piece["rests"] = derive_rests(piece)
    return piece


def fake_dump(*pieces):
    return {"version": 1, "engineVersion": "test", "profile": "medium", "weightSet": "parncutt-defaults",
            "weightsHash": "0" * 16, "lintRules": LINT_RULES, "pieces": list(pieces)}


# ---- synthetic PIG pieces and bench gallery pages (Task 3) ------------------------------------

def pig_piece(piece_id, rh, lh=(), meter=(4, 4), bars=8, tempo=120, composer="Bach", style="two-part invention"):
    """A PieceData like pig_passages.build_piece's, from (onset_q, dur_q, midi) single notes. Note ids are
    "0", "1", ... in the engine's order (onset, R before L, pitch), as PIG files number them."""
    from teacher_review.model import Event, number_events
    from teacher_review.pig_passages import Grid, PieceData
    qsec = 60 / tempo
    raw = sorted([("R", Fraction(o), Fraction(d), m) for o, d, m in rh] + [("L", Fraction(o), Fraction(d), m) for o, d, m in lh],
                 key=lambda x: (x[1], 0 if x[0] == "R" else 1, x[3]))
    ids = {k: str(i) for i, k in enumerate(raw)}
    events = {}
    for hand in ("R", "L"):
        evs = [Event(hand, o, float(o) * qsec, d, [m], [0], [], [ids[(h, o, d, m)]]) for (h, o, d, m) in raw if h == hand]
        if evs:
            events[hand] = number_events(evs, hand)
    grid = Grid(quarter_s=qsec, bar1_s=0.0, tempo_qpm=tempo, residual=0.0, align=1.0, mode_ioi=qsec,
                quarter_from_bars=qsec, implied_bars=float(bars))
    return PieceData(piece_id=piece_id, composer=composer, title="Test", bars=bars, meter=meter, style=style, grid=grid,
                     annotation="1", annotators={"1": "XX"}, events=events, all_fingers={}, fhmm3={},
                     source_hand={ids[k]: k[0] for k in raw})


def pig_dump_piece(piece_id, piece, fingers, conf=0.5):
    """The dump entry engine_dump.mjs would write for that PieceData with the given engine fingers."""
    from teacher_review.model import pitch_name
    rows = []
    for hand, evs in piece.events.items():
        for e in evs:
            for sid, midi in zip(e.source_ids, e.pitches):
                rows.append((int(sid), {"id": sid, "hand": hand, "midi": midi, "pitch": pitch_name(midi),
                                        "onsetSec": e.onset_s, "isGrace": False, "finger": fingers[sid],
                                        "confidence": conf, "gaps": [0 if f == fingers[sid] else 1.0 for f in range(1, 6)],
                                        "lint": []}))
    notes = [dict(n, index=i) for i, (_, n) in enumerate(sorted(rows, key=lambda r: r[0]))]
    return {"id": f"pig:{piece_id}", "source": "pig", "pigId": piece_id, "file": f"{piece_id}-1_fingering.txt",
            "transpose": 0, "divisions": 480, "tempoMap": [], "measures": [], "notes": notes, "rests": [], "solve": []}


def gallery_page(piece_id, rows):
    """A page in bench.ts's format; rows are (index, hand, pitch, engine finger, confidence %, annotators, hard)."""
    head = [f"# Piece {piece_id}", "",
            "gen 50.00 high 60.00 soft 70.00 rec 65.00 hard-error 25.00 notes 40 annotators 3", "",
            "Context: two notes of the same hand on each side as pitch:engine finger, the note itself in brackets.", "",
            "| # | bar | onset s | hand | pitch | context | engine (confidence) top terms | runner-up | annotators | why not | hard |",
            "|---|---|---|---|---|---|---|---|---|---|---|"]
    body = [f"| {i} | - | {i * 0.25:.2f} | {h} | {p} | x:1 [{p}] y:2 | {f} ({c}%) hop 12.0 | 3 +0.4 | "
            f"{' '.join('-' if a is None else str(a) for a in ann)} | 3: +0.4 | {'hard' if hard else ''} |"
            for i, h, p, f, c, ann, hard in rows]
    return "\n".join(head + body) + "\n"


# ---- fake reviewer outputs (Task 5) -------------------------------------------------------------

def fake_reviews(day, skip=(), objections=None, bad_note=()):
    """Write a valid reviewer output for every batch of day/key.json (except those in skip). objections(item
    key entry) -> list of objection dicts; bad_note: batch ids whose first item names a note that does not exist."""
    key = json.loads((Path(day) / "key.json").read_text(encoding="utf-8"))
    for bid, b in key["batches"].items():
        if bid in skip:
            continue
        items = []
        for k, iid in enumerate(b["items"]):
            ki = key["items"][iid]
            obs = list(objections(ki)) if objections else []
            if bid in bad_note and k == 0:
                obs.append({"notes": [f"{ki['hands'][0]}999"], "kind": "hop", "severity": "warning", "problem": "x", "fix": {}})
            items.append({"item": iid, "readback": {h: ki["fingers"][h] for h in ki["hands"]},
                          "scores": {"possible": 3, "idiomatic": 3, "economical": 2, "consistent": 3, "beginner_friendly": 3},
                          "verdict": "good", "objections": obs, "comment": ""})
        out = Path(b["out"])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"batch": bid, "started_at": "2099-01-01T10:00:00Z", "finished_at": "2099-01-01T10:09:00Z",
                                   "items": items}), encoding="utf-8")


# ---- the CLI (Task 8) ---------------------------------------------------------------------------

def cli_dump(path):
    """A synthetic library of eight level 1 to 3 pieces (and two harder ones), each with its tritone copy, written
    as a dump file for the CLI tests."""
    pieces = []
    for k, level in enumerate([1, 2, 3, 1, 2, 3, 2, 1, 4, 5]):
        rh = eighths(12, shift=k, conf={(3 + k % 5, 1): 0.2 + 0.01 * k, (9, 2): 0.3})
        pieces.append(lib_piece(f"cli-{k:02d}", rh=rh, lh=chords(12), bars=12, level=level))
        tt = [dict(n, finger=2) if i == 2 else n for i, n in enumerate(rh)]
        pieces.append(lib_piece(f"cli-{k:02d}", rh=tt, lh=chords(12), bars=12, level=level, transpose=6))
    Path(path).write_text(json.dumps(fake_dump(*pieces)), encoding="utf-8")
    return path
