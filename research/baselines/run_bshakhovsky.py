"""BShakhovsky/PianoFingering_CalcModule (no license file; C++/MSVC, last commit 2021; the
fingering module of "PianoTranscription_Windows", 89 stars): a trellis graph over chord
fingering combinations (``ChordFingVariations``) with vertical (within-chord) and horizontal
(chord-to-chord, up to three chords) cost tables in the spirit of Parncutt / Al Kasimi, keeping
all minimum-cost paths and pruning the graph whenever the paths agree on a prefix.

Build (MSVC-only code, no MSVC here): compiled with MinGW g++ 9.2 plus
  * cpp/bshakhovsky/compat/msvc_compat.h (force-included: ``#define abstract``, <cfloat>),
  * cpp/bshakhovsky/compat/boost/noncopyable.hpp (5-line stand-in for Boost's header),
  * patches/bshakhovsky.patch (``136i16`` literal, ``#pragma comment(lib)``, and a
    ``virtual ~X() = 0 {}`` destructor -- three MSVC-only constructs),
  * cpp/bshakhovsky/driver.cpp (our batch driver around the ``TrellisGraph`` facade).
See README for the exact g++ command.

Input per hand: notes grouped into chords by identical onset (the module's own test program
groups notes closer than ~10 ms), pitches as a set (duplicate unisons share a finger); the
left hand is mirrored by the module itself.  Output strings may list several equally optimal
fingers (we take the first); chords of more than five notes get "?" for the middle notes
(we then use the finger of the nearest fingered chord note, counted in run_log.json).

    python run_bshakhovsky.py --pieces test
"""
from __future__ import annotations

import subprocess
import sys
from itertools import groupby
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import base_arg_parser, resolve_common, run_pieces  # noqa: E402

DEFAULT_EXE = HERE / "cpp" / "bshakhovsky" / "build" / "bshakhovsky_driver.exe"


def main() -> None:
    ap = base_arg_parser(__doc__, "bshakhovsky_trellis")
    ap.add_argument("--exe", default=str(DEFAULT_EXE))
    ap.add_argument("--timeout", type=float, default=600)
    args = ap.parse_args()
    stats = {"unresolved_notes": 0}

    def predict(notes, inp):
        blocks, groups_by_hand = [], {}
        for channel in (0, 1):
            sel = sorted((n for n in notes if n.channel == channel), key=lambda n: (n.onset, n.pitch))
            groups = [list(g) for _, g in groupby(sel, key=lambda n: n.onset_str)]
            groups_by_hand[channel] = groups
            if not groups:
                continue
            lines = [f"HAND {channel} {len(groups)}"]
            for g in groups:
                ps = sorted({n.pitch for n in g})
                lines.append(" ".join([str(len(ps))] + [str(p) for p in ps]))
            blocks.append("\n".join(lines))
        res = subprocess.run([args.exe], input="\n".join(blocks) + "\n", capture_output=True, text=True,
                             timeout=args.timeout, check=True)
        out = [None] * len(notes)
        lines = res.stdout.splitlines()
        k = 0
        while k < len(lines):
            _, hand, n = lines[k].split()
            hand, n = int(hand), int(n)
            groups = groups_by_hand[hand]
            if n != len(groups):
                raise RuntimeError(f"hand {hand}: {n} result chords for {len(groups)}")
            for gi, g in enumerate(groups):
                toks = lines[k + 1 + gi].split()
                ps = sorted({x.pitch for x in g})
                if len(toks) != len(ps):
                    raise RuntimeError("chord size mismatch")
                fing = {}
                for p, t in zip(ps, toks):
                    if t[0].isdigit():
                        fing[p] = int(t[0])
                for p in ps:  # '?' (chords > 5 notes): nearest fingered pitch in the chord
                    if p not in fing:
                        stats["unresolved_notes"] += 1
                        known = [q for q in fing]
                        fing[p] = fing[min(known, key=lambda q: abs(q - p))] if known else 1
                for x in g:
                    out[x.idx] = fing[x.pitch] if hand == 0 else -fing[x.pitch]
            k += 1 + n
        return out

    pig_dir, pieces, out_dir = resolve_common(args)
    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"exe": args.exe, "stats": stats}, skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
