"""Level proposal for library pieces, computed from the MusicXML (L1 plan, decision 5).

Hands as in check_spans.py (staff 1 the right hand, every other staff the left); grace notes and
tie continuations are not struck. Features:
  nps          sounding notes per second at the catalogue tempo, both hands (note density)
  shifts       position shifts per 100 onsets, mean of the two hands: a hand keeps a window of
               pitches no wider than 7 semitones (a five-finger position on white keys); a slice
               that would widen it beyond 7 opens a new window and counts one shift
  span         widest slice struck by one hand, in semitones (hand span demand)
  chord        share of a hand's onsets that strike two or more keys, the larger hand (polyphony)
  fifths       sharps or flats in the first key signature
  accidentals  percent of notes outside the major scale of the first key signature
  seconds      written length (no repeats) at the catalogue tempo
  leaps        per 100 onsets, consecutive slice centres more than an octave apart, the larger hand
score = 0.35 min(nps, 12) + 0.06 shifts + 0.12 max(0, span - 7) + 2.0 chord + 0.25 fifths
        + 0.05 accidentals + 0.3 min(seconds, 240) / 60 + 0.05 leaps
level = 1 + number of CUTS below the score. The weights are fixed; the four cut points are fitted
on the 30 labelled pieces (calibrate): exhaustive search over midpoints between sorted scores for
the most pieces within one level, then the most exact, then the least absolute error.
Measured 2026-10-14: 30/30 within one (19 exact); leave-one-out 27/30 within one (14 exact).

The proposal is advice: the final level is the implementer's, with a one-line justification
(`levelNote` in the catalog), and a final level more than one away from the proposal needs a
`levelOverride` reason. Known biases: counterpoint is underrated (Invention No. 1 is proposed at
3, catalogued at 4), held left-hand chords are overrated (the arrangements of Amazing Grace and
Greensleeves are proposed at 3, catalogued at 2).

    python -I content/tools/level.py --report            # proposal table for every catalog piece
    python -I content/tools/level.py --write [--only S]  # levelProposal into verification.json

--write stores verification[slug]["levelProposal"] = {features (3 decimals), score (3 decimals),
level}, where level is the proposal for the recorded (rounded) score, so a record is always
consistent with propose(). The file is updated under jsonio.library_lock().
License: MIT.
"""
from __future__ import annotations

import argparse
import itertools
import json
import sys
from collections import defaultdict
from fractions import Fraction as F
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import scoreio  # noqa: E402
import xmlcheck as xc  # noqa: E402

CONTENT = HERE.parent
MANIFEST = CONTENT / "manifest.json"
VERIFICATION = CONTENT / "verification.json"
MAJOR = (0, 2, 4, 5, 7, 9, 11)
WINDOW = 7
CUTS = (1.76, 4.09, 9.11, 12.68)
WEIGHTS: dict[str, float] = {
    "nps": 0.35,  # applied to min(nps, 12)
    "shifts": 0.06,
    "span": 0.12,  # applied to max(0, span - 7)
    "chord": 2.0,
    "fifths": 0.25,
    "accidentals": 0.05,
    "seconds": 0.3,  # applied to min(seconds, 240) / 60, that is per minute up to four minutes
    "leaps": 0.05,
}
FEATURES = ("nps", "shifts", "span", "chord", "fifths", "accidentals", "seconds", "leaps")


def features(path: Path, tempo: float) -> dict[str, float]:
    xs = xc.parse_musicxml(scoreio.plain_path(path))
    fifths = int(xs.keys[0][1]) if xs.keys and xs.keys[0][1] else 0
    tonic = (7 * fifths) % 12
    scale = {(tonic + d) % 12 for d in MAJOR}
    seconds = float(sum((m.length for m in xs.measures), F(0))) * 60 / tempo
    hands: dict[str, dict] = defaultdict(lambda: defaultdict(list))
    for n in xs.notes:
        if n.pitch is None or n.grace or n.tie_stop:
            continue
        hands["R" if xs.staves < 2 or n.staff == "1" else "L"][n.onset].append(n.pitch)
    notes = outside = 0
    shifts, spans, chords, leaps = [], [], [], []
    for slices in hands.values():
        onsets = sorted(slices)
        spans.append(max(max(v) - min(v) for v in slices.values()))
        chords.append(sum(1 for v in slices.values() if len(set(v)) > 1) / len(onsets))
        lo = hi = prev = None
        sh = lp = 0
        for o in onsets:
            a, b = min(slices[o]), max(slices[o])
            if lo is None:
                lo, hi = a, b
            elif max(hi, b) - min(lo, a) > WINDOW:
                sh += 1
                lo, hi = a, b
            else:
                lo, hi = min(lo, a), max(hi, b)
            centre = (a + b) / 2
            if prev is not None and abs(centre - prev) > 12:
                lp += 1
            prev = centre
        shifts.append(100 * sh / len(onsets))
        leaps.append(100 * lp / len(onsets))
        for v in slices.values():
            notes += len(v)
            outside += sum(1 for p in v if p % 12 not in scale)
    return {"nps": notes / seconds, "shifts": sum(shifts) / len(shifts), "span": max(spans),
            "chord": max(chords), "fifths": abs(fifths), "accidentals": 100 * outside / notes,
            "seconds": seconds, "leaps": max(leaps)}


def score(f: dict[str, float]) -> float:
    w = WEIGHTS
    return (w["nps"] * min(f["nps"], 12) + w["shifts"] * f["shifts"] + w["span"] * max(0, f["span"] - 7)
            + w["chord"] * f["chord"] + w["fifths"] * f["fifths"] + w["accidentals"] * f["accidentals"]
            + w["seconds"] * min(f["seconds"], 240) / 60 + w["leaps"] * f["leaps"])


def propose(s: float, cuts: tuple = CUTS) -> int:
    return 1 + sum(s > c for c in cuts)


def calibrate(rows: list[tuple[int, float]]) -> tuple[float, ...]:
    rs = sorted(rows, key=lambda r: r[1])
    scores, levels = [r[1] for r in rs], [r[0] for r in rs]
    mids = [(a + b) / 2 for a, b in zip(scores, scores[1:])]
    best = None
    for cuts in itertools.combinations(mids, 4):
        pred = [propose(s, cuts) for s in scores]
        key = (sum(abs(p - l) <= 1 for p, l in zip(pred, levels)), sum(p == l for p, l in zip(pred, levels)),
               -sum(abs(p - l) for p, l in zip(pred, levels)))
        if best is None or key > best[0]:
            best = (key, cuts)
    return best[1]


def leave_one_out(rows: list[tuple[int, float]]) -> tuple[int, int]:
    within = exact = 0
    for i, (lvl, s) in enumerate(rows):
        p = propose(s, calibrate(rows[:i] + rows[i + 1:]))
        within += abs(p - lvl) <= 1
        exact += p == lvl
    return within, exact


def proposal(path: Path, tempo: float) -> dict:
    """The verification record {features, score, level} of one score at its catalogue tempo.

    Features and score are rounded to 3 decimals; level is the proposal for the rounded score."""
    f = features(path, tempo)
    s = round(score(f), 3)
    return {"features": {k: round(float(f[k]), 3) for k in FEATURES}, "score": s, "level": propose(s)}


def _manifest() -> list[dict]:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def _catalog_order(entries: list[dict]) -> list[dict]:
    """Manifest entries in merged-catalog order (catalog.json, then catalog.d/ in file-name order)."""
    try:
        import build  # noqa: PLC0415  (only the report needs the catalog)

        index = {p["slug"]: i for i, p in enumerate(build.load_catalog())}
    except SystemExit as exc:  # a fragment being edited by another task: fall back to manifest order
        print(f"note: catalog not readable ({exc}); manifest order", file=sys.stderr)
        return entries
    return sorted(entries, key=lambda e: index.get(e["slug"], len(index)))


def report(entries: list[dict]) -> int:
    head = f"{'slug':44} lvl prop  score " + " ".join(f"{k:>7}" for k in FEATURES)
    print(head)
    print("-" * len(head))
    rows = []
    for e in _catalog_order(entries):
        f = features(CONTENT / e["files"]["score"], e["tempoBpm"])
        s = score(f)
        p = propose(s)
        rows.append((e["level"], s, e.get("benchmarkSet") == "core30"))
        mark = "" if abs(p - e["level"]) <= 1 else "  !"
        print(f"{e['slug'][:44]:44} {e['level']:>3} {p:>4} {s:6.2f} "
              + " ".join(f"{f[k]:7.2f}" for k in FEATURES) + mark)
    core = [(lvl, s) for lvl, s, c in rows if c]
    if core:
        within = sum(abs(propose(s) - lvl) <= 1 for lvl, s in core)
        exact = sum(propose(s) == lvl for lvl, s in core)
        print(f"core30 in sample (CUTS {CUTS}): {within}/{len(core)} within one level, {exact} exact")
    within = sum(abs(propose(s) - lvl) <= 1 for lvl, s, _ in rows)
    exact = sum(propose(s) == lvl for lvl, s, _ in rows)
    print(f"all {len(rows)} pieces: {within} within one level, {exact} exact")
    return 0


def write(entries: list[dict], only: list[str] | None) -> int:
    import jsonio  # noqa: PLC0415

    by_slug = {e["slug"]: e for e in entries}
    slugs = list(only) if only else [e["slug"] for e in entries]
    unknown = [s for s in slugs if s not in by_slug]
    if unknown:
        raise SystemExit(f"not in the manifest (build it first): {', '.join(unknown)}")
    # computed outside the lock: features take a moment and other tasks may be waiting to write
    records = {s: proposal(CONTENT / by_slug[s]["files"]["score"], by_slug[s]["tempoBpm"]) for s in slugs}

    def put(verification: dict) -> dict:
        missing = [s for s in records if not isinstance(verification.get(s), dict)]
        if missing:
            raise SystemExit(f"no verification record (build it first): {', '.join(missing)}")
        for s, rec in records.items():
            verification[s]["levelProposal"] = rec
        return verification

    jsonio.update_json(VERIFICATION, put)
    for s, rec in records.items():
        print(f"{s:44} level {by_slug[s]['level']}  proposal {rec['level']}  score {rec['score']:.3f}")
    print(f"wrote levelProposal for {len(records)} piece(s) to "
          f"{VERIFICATION.relative_to(CONTENT.parent).as_posix()}")
    return 0


def main(argv=None) -> int:
    getattr(sys.stdout, "reconfigure", lambda **_: None)(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--report", action="store_true", help="print the proposal table for every manifest piece")
    mode.add_argument("--write", action="store_true", help="write levelProposal into verification.json")
    ap.add_argument("--only", nargs="+", metavar="SLUG", help="with --write: only these pieces")
    a = ap.parse_args(argv)
    if a.only and not a.write:
        ap.error("--only goes with --write")
    entries = _manifest()
    if a.report:
        return report(entries)
    return write(entries, a.only)


if __name__ == "__main__":
    raise SystemExit(main())
