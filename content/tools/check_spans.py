"""Flag the library slices that no single hand can play as written.

A slice is what one hand strikes together: the notes of one staff with the same written onset
(staff 1 is the right hand and every other staff the left, as in the engine's MusicXML reader for
a one-part score; a score with more than one part is refused, because the reader below sees only
the first part and the engine gives the other parts to the left hand), without grace notes (the engine gives each grace figure its own slice), tie continuations (they
are held, not struck) and repeated pitches (a unison in two voices is one key). A slice is flagged
with one or more reasons:

  span     its span, highest minus lowest pitch, exceeds MAX_SPAN = 15 semitones: maxPrac(1, 5)
           of the large hand profile, the widest practical stretch of the largest hand;
  notes    it has more than five keys;
  fingers  it has at most five keys within 15 semitones, but no fingering with distinct fingers
           rising with (mirrored) pitch keeps every pair of its notes within the practical span
           of their fingers (such as a five-note chord whose second and fifth notes are an octave
           apart, beyond maxPrac(2, 5) = 10).

Every flagged slice is one the solver lists under `infeasibleSlices` (it then prices the chord
instead of forbidding it) and lint reports with a law (L01, L02, L04 or L05), whatever the
fingering: L04 for more than five keys, L05 for a span beyond practical, or L01/L02 when the
fingering doubles or crosses fingers on the offending pair instead. The practical spans are
Parncutt et al. 1997 Table 1, copied from `packages/engine/src/fingering/spans.ts`
(PARNCUTT_TABLES.maxPrac, the large profile); the left hand is checked in the mirrored view
(pitch 124 - midi), as the engine does. This script only reports: the scores are not changed
here, and the list is the input for a content follow-up (another hand split, a rolled chord or an
arpeggiation).

    python -I content/tools/check_spans.py              # print the flags, write verification.json
    python -I content/tools/check_spans.py --no-write   # print only

The list goes under the top-level key "spanFlags" of content/verification.json, one entry per
slice in library order: piece (slug), bar (MusicXML measure number), hand ("R" or "L"), quarter
(onset within the bar in quarter notes), pitches (lowest first, sharps), span (semitones) and
reasons. build.py keeps spanFlags when it merges its pieces but does not recompute it, so run this
script again after a build. The file is rewritten under jsonio.library_lock(), with the flags
computed inside the lock, so a concurrent build cannot slip a piece in between.
License: MIT.
"""
from __future__ import annotations

import argparse
import json
import sys
from itertools import combinations
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import jsonio  # noqa: E402
import scoreio  # noqa: E402
import xmlcheck as xc  # noqa: E402

CONTENT = HERE.parent
# maxPrac[f - 1][g - 1]: the largest practical interval in semitones from the key of finger f to
# the key of finger g in the right hand; minPrac(f, g) = -maxPrac(g, f). Parncutt et al. 1997.
MAX_PRAC = [
    [0, 10, 12, 14, 15],
    [5, 0, 5, 7, 10],
    [4, -1, 0, 4, 7],
    [3, -1, -1, 0, 5],
    [1, -2, -1, -1, 0],
]
MAX_SPAN = MAX_PRAC[0][4]
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def pitch_name(midi: int) -> str:
    """Scientific pitch name with sharps (60 is C4)."""
    return f"{NAMES[midi % 12]}{midi // 12 - 1}"


def hand_of(staff: str, staves: int) -> str:
    """The engine's hand of a staff of the first part (read.ts): with two or more staves staff 1
    is the right hand and the others the left; a one-staff first part is the right hand."""
    return "R" if staves < 2 or staff == "1" else "L"


def practical(i: int, f: int, g: int) -> bool:
    """Interval i from the key of finger f to the key of finger g is within their practical span."""
    return -MAX_PRAC[g - 1][f - 1] <= i <= MAX_PRAC[f - 1][g - 1]


def playable(pitches: list[int], hand: str) -> bool:
    """Some fingering with distinct fingers rising with (mirrored) pitch keeps every pair practical."""
    view = sorted(p if hand == "R" else 124 - p for p in set(pitches))
    if len(view) > 5:
        return False
    for fingers in combinations(range(1, 6), len(view)):
        if all(practical(view[b] - view[a], fingers[a], fingers[b])
               for a, b in combinations(range(len(view)), 2)):
            return True
    return False


def reasons_of(pitches: list[int], hand: str) -> list[str]:
    keys = sorted(set(pitches))
    reasons = []
    if keys[-1] - keys[0] > MAX_SPAN:
        reasons.append("span")
    if len(keys) > 5:
        reasons.append("notes")
    if not reasons and not playable(keys, hand):
        reasons.append("fingers")
    return reasons


def span_flags(path: Path, piece: str) -> list[dict]:
    """The slices of one score that no single hand can play, in onset order (right hand first)."""
    xs = xc.parse_musicxml(scoreio.plain_path(path))
    if xs.parts != 1:
        # xmlcheck reads only the first part, while the engine gives every other part to the left
        # hand: a report on the first part alone would miss notes or put them in the wrong hand.
        raise ValueError(f"{path.name}: {xs.parts} parts; check_spans handles one-part scores only")
    slices: dict[tuple, list] = {}
    for nt in xs.notes:
        if nt.pitch is None or nt.grace or nt.tie_stop:
            continue
        key = (nt.onset, 0 if hand_of(nt.staff, xs.staves) == "R" else 1)
        slices.setdefault(key, []).append(nt)
    flags = []
    for (_, hand), notes in sorted(slices.items(), key=lambda kv: kv[0]):
        keys = sorted({nt.pitch for nt in notes})
        reasons = reasons_of(keys, "RL"[hand])
        if not reasons:
            continue
        first = notes[0]
        flags.append({
            "piece": piece,
            "bar": first.number,
            "hand": "RL"[hand],
            "quarter": round(float(first.rel), 3),
            "pitches": [pitch_name(p) for p in keys],
            "span": keys[-1] - keys[0],
            "reasons": reasons,
        })
    return flags


def library_flags(content: Path = CONTENT) -> list[dict]:
    """Flags of every library score in manifest order (the fingered copies hold the same notes)."""
    manifest = json.loads((content / "manifest.json").read_text(encoding="utf-8"))
    flags = []
    for entry in manifest:
        flags += span_flags(content / entry["files"]["score"], entry["slug"])
    return flags


def format_flag(f: dict) -> str:
    # The onset within the bar in quarter notes (0 is the downbeat), not a beat of the meter.
    return (f"{f['piece']}  bar {f['bar']}  quarter {f['quarter']:g}  {f['hand']}  "
            f"{' '.join(f['pitches'])}  ({f['span']} semitones; {', '.join(f['reasons'])})")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-write", action="store_true", help="print the flags without writing verification.json")
    a = ap.parse_args(argv)
    getattr(sys.stdout, "reconfigure", lambda **_: None)(encoding="utf-8")
    path = CONTENT / "verification.json"
    if a.no_write:
        flags = library_flags()
    else:
        flags = []

        def put_flags(verification: dict) -> dict:
            # computed under the lock: the manifest cannot change between reading it and writing
            flags.extend(library_flags())
            return {**verification, "spanFlags": flags}

        jsonio.update_json(path, put_flags)
    for f in flags:
        print(format_flag(f))
    pieces = len({f["piece"] for f in flags})
    print(f"{len(flags)} slice(s) in {pieces} piece(s) cannot be played by one hand as written")
    if not a.no_write:
        print(f"wrote {len(flags)} spanFlags to {path.relative_to(CONTENT.parent).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
