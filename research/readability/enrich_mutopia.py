#!/usr/bin/env python
"""Recover beats and bar positions for the Mutopia PIG files.

The PIG files carry onsets in seconds at the score's first ``\\tempo`` (default quarter = 100)
and no meter. This script re-runs the project's LilyPond interpreter
(``fingering_eval.mutopia.convert_file``, read-only reuse) on each verified part's source, checks
that it reproduces the PIG note list exactly, and writes
``research/data/readability/mutopia_beats/<piece_id>.json`` with, per note, the onset in
quarter-note beats, the duration in beats, the bar index and the position in the bar.

    research/.venv-readability/Scripts/python.exe -I research/readability/enrich_mutopia.py [--only SUBSTR]

Needs ``research/data/mutopia_src/ftp`` (``download_datasets.py mutopia_src``). Without it the
feature table falls back to beats at the default tempo and unknown bar positions.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from fractions import Fraction
from pathlib import Path

RESEARCH = Path(__file__).resolve().parents[1]
if str(RESEARCH) not in sys.path:
    sys.path.insert(0, str(RESEARCH))

from fingering_eval import lilypond as L  # noqa: E402
from fingering_eval import mutopia as MU  # noqa: E402
from fingering_eval.pig_io import read_pig  # noqa: E402

SRC = RESEARCH / "data" / "mutopia_src" / "ftp"
OUT = RESEARCH / "data" / "readability" / "mutopia_beats"
GRACE = MU.GRACE_SECONDS

_RECORDED: list[L.Evaluator] = []


class _RecordingEvaluator(L.Evaluator):
    """Same evaluator; every instance is kept so the meter grid can be read afterwards."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        _RECORDED.append(self)


def bar_grid(ev: L.Evaluator, horizon: Fraction) -> tuple[list[Fraction], callable]:
    """Barline times (whole notes) up to ``horizon`` and a ``meter_at(t)`` function.

    Mirrors ``fingering_eval.mutopia._meter_grid_failures``: the grid starts at the first
    anacrusis marker (``\\partial`` / ``measurePosition``) if there is one at the start, else at
    time 0; measure lengths follow ``\\time`` changes; later anacrusis markers re-anchor it.
    """
    meters = sorted(set(ev.meter_events)) or [(Fraction(0), Fraction(1))]

    def meter_at(t: Fraction) -> Fraction:
        cur = meters[0][1]
        for mt, ml in meters:
            if mt <= t:
                cur = ml
            else:
                break
        return cur

    anchors = sorted([(t, t + d) for t, d in ev.partial_events if d > 0] +
                     [(t, t + meter_at(t) - p) for t, p in ev.measure_pos_events])
    ai = 0
    if anchors and anchors[0][0] <= 0:
        barline = anchors[0][1]
        ai = 1
    else:
        barline = Fraction(0)
    lines = [barline]
    guard = 0
    while lines[-1] <= horizon and guard < 200000:
        nxt = lines[-1] + meter_at(lines[-1])
        while ai < len(anchors) and anchors[ai][0] < nxt:
            # an anacrusis marker inside the bar: the next barline is where it says
            nxt = anchors[ai][1]
            ai += 1
            while nxt <= lines[-1]:
                nxt += meter_at(nxt)
        lines.append(nxt)
        guard += 1
    return lines, meter_at


def enrich_part(row: dict, conv_cache: dict) -> dict | None:
    pid = row["piece_id"]
    ly = SRC / row["ly_file"]
    if not ly.exists():
        return {"error": f"missing source {ly}"}
    comps = Path(row["ly_file"]).parts
    unit_dir = SRC / Path(*comps[:3]) if len(comps) > 3 else ly.parent
    if ly not in conv_cache:
        del _RECORDED[:]
        conv = MU.convert_file(ly, search_dirs=[unit_dir] + [p for p in unit_dir.iterdir() if p.is_dir()])
        conv_cache[ly] = (conv, list(_RECORDED))
    conv, evaluators = conv_cache[ly]
    if conv.error:
        return {"error": conv.error}
    pig = read_pig(MU_FING / f"{pid}-0_fingering.txt")
    want = [(n.onset, n.pitch, n.channel, n.finger) for n in pig.notes]
    part = None
    for p in conv.parts:
        got = [(n.onset, n.pitch, n.channel, n.finger) for n in p.notes]
        if got == want:
            part = p
            break
    if part is None:
        return {"error": "no converted part reproduces the PIG file"}
    bpm = part.diagnostics["tempo_bpm_quarter"]
    sec_per_whole = 4 * 60.0 / bpm
    ends = part.diagnostics["staff_end_whole_notes"]
    # pick the evaluator of this part's score: the one whose event horizon matches the staff ends
    ev = None
    if len(evaluators) == 1:
        ev = evaluators[0]
    else:
        target = max(ends) if ends else 0
        best = None
        for e in evaluators:
            if not e.events:
                continue
            h = max(float(x.offset) for x in e.events)
            d = abs(h - target)
            if best is None or d < best[0]:
                best = (d, e)
        ev = best[1] if best else None
    if ev is None:
        return {"error": "no evaluator for this part"}
    horizon = Fraction(max(ends)).limit_denominator(10080) if ends else Fraction(0)
    lines, meter_at = bar_grid(ev, horizon)
    notes_out = []
    main_onsets = [n.onset for n in part.notes if abs(n.duration - GRACE) >= 1e-6]
    for n in part.notes:
        grace = abs(n.duration - GRACE) < 1e-6
        on_sec = n.onset
        if grace:
            # a grace note is placed 0.04 s * k before its main note: snap to the next real onset
            later = [t for t in main_onsets if t >= on_sec - 1e-9]
            on_sec = later[0] if later else on_sec
        on = Fraction(on_sec / sec_per_whole).limit_denominator(10080)
        dur = Fraction(0) if grace else Fraction(n.duration / sec_per_whole).limit_denominator(10080)
        # bar containing ``on``
        import bisect
        k = bisect.bisect_right(lines, on) - 1
        if k < 0:
            bar_start = lines[0] - meter_at(lines[0])
            bar_idx = -1
        else:
            bar_start = lines[k]
            bar_idx = k
        bar_len = meter_at(bar_start) if k >= 0 else lines[0] - bar_start
        notes_out.append({"beat": float(on * 4), "dur_beats": float(dur * 4), "bar": bar_idx,
                          "bar_pos": float((on - bar_start) * 4), "bar_len": float(bar_len * 4),
                          "grace": grace})
    return {"piece_id": pid, "tempo_bpm_quarter": bpm, "n_bars": len(lines),
            "meter_events": [[str(t), str(m)] for t, m in sorted(set(ev.meter_events))],
            "notes": notes_out}


MU_FING = RESEARCH / "data" / "mutopia_fingering" / "FingeringFiles"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--status", default="ok")
    args = ap.parse_args(argv)
    if not SRC.exists():
        print(f"missing {SRC}; nothing to do", file=sys.stderr)
        return 1
    MU.L.Evaluator = _RecordingEvaluator  # convert_file looks the class up at call time
    with open(RESEARCH / "data" / "mutopia_fingering" / "manifest.json", encoding="utf-8") as f:
        manifest = json.load(f)
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    cache: dict = {}
    ok = fail = 0
    errors = {}
    for row in manifest:
        if args.status and row["status"] != args.status:
            continue
        if args.only not in row["piece_id"]:
            continue
        try:
            res = enrich_part(row, cache)
        except Exception as e:  # noqa: BLE001
            res = {"error": f"{type(e).__name__}: {e}"}
        if res is None or "error" in res:
            fail += 1
            errors[row["piece_id"]] = res["error"] if res else "none"
            continue
        with open(OUT / f"{row['piece_id']}.json", "w", encoding="utf-8") as f:
            json.dump(res, f)
        ok += 1
    with open(OUT / "_summary.json", "w", encoding="utf-8") as f:
        json.dump({"ok": ok, "failed": fail, "errors": errors, "seconds": round(time.time() - t0, 1)}, f, indent=1)
    print(f"enriched {ok} parts, {fail} failed, {time.time() - t0:.1f} s")
    for k, v in errors.items():
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
