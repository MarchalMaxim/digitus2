"""Kanma/piano_fingering (MIT, PyPI ``piano_fingering`` 1.0.0) on PIG files.

A Python port (2017) of Blake West's "performer" JavaScript fingering engine
(https://github.com/blakewest/performer): a Viterbi search over per-onset "layers" whose
nodes are all finger assignments of the notes sounding at that onset, with a hand-made
pairwise cost table (note1, note2, finger1, finger2) for each hand.

Per hand we group notes by identical onset into chords (pitches ascending, as the
library assumes), call ``computeFingering(groups, 'right'|'left')`` and map the fingers
back.  Onset groups with more than 5 notes (no 6-finger option exists) are split into
chunks of at most 5 consecutive pitches.

    python run_kanma.py --pieces test
"""
from __future__ import annotations

import sys
from itertools import groupby
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import THIRD_PARTY, base_arg_parser, resolve_common, run_pieces  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "Kanma__piano_fingering"


def main() -> None:
    ap = base_arg_parser(__doc__, "kanma_piano_fingering")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    args = ap.parse_args()
    sys.path.insert(0, str(Path(args.repo)))
    from piano_fingering import computeFingering  # noqa: E402

    def predict(notes, inp):
        fingers = [None] * len(notes)
        for channel, side in ((0, "right"), (1, "left")):
            sel = sorted((n for n in notes if n.channel == channel), key=lambda n: (n.onset, n.pitch))
            groups = []
            for _, g in groupby(sel, key=lambda n: n.onset_str):
                g = list(g)
                for k in range(0, len(g), 5):
                    groups.append(g[k:k + 5])
            if not groups:
                continue
            res = computeFingering([[n.pitch for n in g] for g in groups], side)
            assert len(res) == len(groups)
            for g, r in zip(groups, res):
                assert [n.pitch for n in g] == list(r["notes"])
                for n, f in zip(g, r["fingers"]):
                    fingers[n.idx] = abs(int(f)) if channel == 0 else -abs(int(f))
        return fingers

    pig_dir, pieces, out_dir = resolve_common(args)
    run_pieces(args.name, pieces, pig_dir, out_dir, predict, meta={"repo": args.repo},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
