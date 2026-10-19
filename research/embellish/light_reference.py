"""Light density as the app builds it: the reference for the TypeScript port in
packages/engine/src/embellish/ (issue #67).

It is core.py at density light with the three changes the app makes:
  1. only the light rules are looked for (passing, neighbour-repeated), so `skipped` counts why a
     melody note got no light candidate;
  2. neighbour-repeated only when the upper scale step is a whole step above the repeated note;
  3. the divisions factor is computed over the light split table (SPLIT_END) only.

    python -I research/embellish/light_reference.py --golden packages/engine/fixtures/embellish-light-golden.json

writes, for every manifest piece at levels 1 and 2 in manifest order, the refusal and the inserted
notes as [bar, beat, midi, rule]. Standard library only. License: MIT.
"""
from __future__ import annotations

import argparse
import gzip
import json
import sys
from math import gcd
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "research") not in sys.path:
    sys.path.insert(0, str(ROOT / "research"))
from embellish import core  # noqa: E402


def _candidates_light(piece, skipped):
    out = []
    melody = piece.melody
    last_measure = piece.measures[-1].idx
    others = [n for n in piece.notes if n.pitch is not None and not n.grace and n.dur > 0]
    graces = {n.onset for n in piece.notes if n.grace and n.staff == "1"}
    for i, g in enumerate(melody):
        if not g.single:
            skipped["chord"] += 1
            continue
        a = g.notes[0]
        m = a.measure
        reason = None
        if i == len(melody) - 1 or m.idx == last_measure:
            reason = "last bar"
        elif a.tie:
            reason = "tied"
        elif a.tuplet:
            reason = "tuplet"
        elif a.fermata:
            reason = "fermata"
        elif m.time is None:
            reason = "no time signature"
        elif m.inner_time_change:
            reason = "time change inside the bar"
        if reason:
            skipped[reason] += 1
            continue
        nxt = melody[i + 1]
        b = nxt.top
        contiguous = nxt.onset == a.end and nxt.onset not in graces
        sc = core.scale(a.fifths)
        same_key = b.fifths == a.fifths
        found = []
        if contiguous and same_key and abs(b.pitch - a.pitch) in (3, 4) and a.pitch % 12 in sc and b.pitch % 12 in sc:
            mid = core.between(a.pitch, b.pitch, sc)
            if mid is not None:
                found.append(("passing", core.SPLIT_END[m.compound], [mid]))
        if contiguous and b.pitch == a.pitch:
            up = core.step_above(a.pitch, sc)
            if up is not None and up - a.pitch == 2:
                found.append(("neighbour-repeated", core.SPLIT_END[m.compound], [up]))
        reasons = []
        made = 0
        for rule, table, pitches in found:
            lengths = table.get(a.dur)
            if lengths is None:
                reasons.append("too short or odd length")
                continue
            if any((x * a.divisions).denominator != 1 for x in lengths):
                reasons.append("divisions")
                continue
            t = a.onset + lengths[0]
            why = None
            for length, p in zip(lengths[1:], pitches):
                metric = t - m.start + m.offset
                if m.strong(metric) or m.sounds_through_strong(metric, metric + length):
                    why = "strong beat"
                    break
                sound = [n for n in others if n is not a and n.onset < t + length and n.end > t]
                if any(n.pitch >= p for n in sound):
                    why = "not the top line"
                    break
                bar_notes = [n for n in others if n.measure is m]
                if any(n.pitch % 12 not in sc and (n.pitch - p) % 12 in (1, 11) for n in bar_notes):
                    why = "accidental nearby"
                    break
                t += length
            if why:
                reasons.append(why)
                continue
            roles = {"passing": ["passing"], "neighbour-repeated": ["neighbour"]}[rule]
            parts = [(lengths[0], None, "melody")] + [(ln, p, r) for ln, p, r in zip(lengths[1:], pitches, roles)]
            out.append(core.Candidate(rule, a, parts))
            made += 1
        if not made:
            skipped[reasons[0] if reasons else "no rule fits"] += 1
    return out


def _divisions_factor_light(piece):
    need = 1
    for g in piece.melody:
        if not g.single:
            continue
        a = g.notes[0]
        for x in core.SPLIT_END[a.measure.compound].get(a.dur, ()):
            d = (x * a.divisions).denominator
            need = need * d // gcd(need, d)
    return need if need <= 12 else 0


core._candidates = _candidates_light
core.divisions_factor = _divisions_factor_light


def embellish_light(text: str) -> core.Result:
    return core.embellish(text, "light")


def golden(levels=(1, 2)) -> dict:
    manifest = json.loads((ROOT / "content" / "manifest.json").read_text(encoding="utf-8"))
    rows = []
    for p in manifest:
        if p["level"] not in levels:
            continue
        raw = (ROOT / "content" / p["files"]["score"]).read_bytes()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        res = embellish_light(raw.decode("utf-8-sig"))
        rows.append({"slug": p["slug"], "refusal": res.refusal,
                     "inserted": [[i["bar"], i["beat"], i["midi"], i["rule"]] for i in res.inserted]})
    return {"pieces": rows}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--golden", required=True, type=Path, help="where to write the golden JSON")
    a = ap.parse_args(argv)
    a.golden.write_text(json.dumps(golden(), separators=(",", ":")) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
