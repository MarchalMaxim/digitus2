#!/usr/bin/env python
"""Convert a random sample of the PDMX fingered keyboard subset to PIG format and validate it,
to estimate how noisy MuseScore community fingerings are.

    research/.venv/Scripts/python.exe -I research/scripts/download_datasets.py pdmx_fingered
    research/.venv/Scripts/python.exe -I research/scripts/convert_pdmx_sample.py [--n 200] [--seed 0]

MusicXML -> notes with music21: piano parts arrive as one PartStaff per staff; the first staff of
a two-staff instrument is the right hand, the second the left hand (same convention as for
Mutopia). Ties are merged; a fingering on a single note is taken directly; fingerings attached to
a chord are used only when there is one per chord note (MusicXML order = music21 note order).
Output: research/data/pdmx_fingered/sample_pig/*.txt and reports/pdmx_sample_validation.json.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path

RESEARCH = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RESEARCH))

from fingering_eval import validate as V  # noqa: E402
from fingering_eval.pig_io import make_note, write_pig  # noqa: E402

DATA = RESEARCH / "data"
ROOT = DATA / "pdmx_fingered"


def fingers_of(obj) -> list[int]:
    from music21 import articulations

    out = []
    for a in getattr(obj, "articulations", []):
        if isinstance(a, articulations.Fingering):
            try:
                v = int(str(a.fingerNumber).strip()[:1])
            except (TypeError, ValueError):
                continue
            if 1 <= v <= 5:
                out.append(v)
    return out


def convert(path: Path) -> list | None:
    import music21
    from music21 import harmony, stream

    score = music21.converter.parse(path)
    # a piano grand staff arrives as consecutive PartStaff objects; take the first such pair
    staves = list(score.parts)
    pair = None
    for a, b in zip(staves, staves[1:]):
        if isinstance(a, stream.PartStaff) and isinstance(b, stream.PartStaff):
            pair = (a, b)
            break
    if pair is None:
        return None
    rh, lh = pair
    notes = []
    for ch, part in ((0, rh), (1, lh)):
        flat = part.stripTies().flatten()
        for el in flat.notes:
            if isinstance(el, harmony.Harmony):     # chord symbols are not played notes
                continue
            on = float(el.offset)
            dur = float(el.duration.quarterLength) or 0.05
            fs = fingers_of(el)
            if el.isChord:
                ps = [n.pitch.midi for n in el.notes]
                per_note = [fingers_of(n) for n in el.notes]
                if all(len(x) == 1 for x in per_note):
                    fl = [x[0] for x in per_note]
                elif len(fs) == len(ps):
                    fl = fs
                else:
                    fl = [None] * len(ps)
                for p, f in zip(ps, fl):
                    notes.append((on, on + dur, p, ch, f))
            else:
                notes.append((on, on + dur, el.pitch.midi, ch, fs[0] if fs else None))
    notes.sort(key=lambda x: (x[0], x[3], x[2]))
    return [make_note(i, on * 0.6, off * 0.6, p, ch, (f if ch == 0 else -f) if f else None)
            for i, (on, off, p, ch, f) in enumerate(notes)]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)
    index = json.loads((ROOT / "fingered_keyboard_index.json").read_text(encoding="utf-8"))
    rng = random.Random(args.seed)
    sample = rng.sample(index, min(args.n, len(index)))
    outdir = ROOT / "sample_pig"
    outdir.mkdir(parents=True, exist_ok=True)
    stats = Counter()
    anomalies = []
    per_file = []
    for k, row in enumerate(sample):
        path = ROOT / "mxl" / row["path"]
        try:
            notes = convert(path)
        except Exception as e:  # noqa: BLE001
            stats["parse_error"] += 1
            per_file.append({"path": row["path"], "error": f"{type(e).__name__}: {str(e)[:80]}"})
            continue
        if not notes:
            stats["no_two_staff_part"] += 1
            continue
        pid = f"pdmx{k:04d}"
        write_pig(outdir / f"{pid}-0_fingering.txt", notes, ["//Version: PianoFingering_v170101",
                                                             f"//Source: PDMX {row['path']}"])
        an = V.validate_notes(notes, pid, "0", "pdmx")
        anomalies += an
        nf = sum(1 for n in notes if n.finger != "0")
        stats["converted"] += 1
        stats["notes"] += len(notes)
        stats["fingered"] += nf
        per_file.append({"path": row["path"], "piece": pid, "notes": len(notes), "fingered": nf,
                         "errors": sum(1 for a in an if a.severity == "error")})
    summ = V.summarize(anomalies)
    out = {"sampled": len(sample), "index_size": len(index), **stats,
           "fingered_fraction": round(stats["fingered"] / stats["notes"], 4) if stats["notes"] else 0,
           "anomaly_counts": summ,
           "errors_per_1000_fingered": round(1000 * sum(summ.get("error", {}).values()) / max(1, stats["fingered"]), 2),
           "files": per_file}
    (DATA / "reports" / "pdmx_sample_validation.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in out.items() if k != "files"}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
