"""V9011N/pygame-piano-animator ("Hand-thesia", no license file, Oct 2026): the automatic
fingering planner of a falling-notes/animated-hands player.  ``fingering.plan_fingering`` is a
beam search over chord fingerings under a hand-made physical cost model (stretch, cramp,
crossings, weak fingers, black keys, shifts against the clock, finger speed) plus
"figure" suggestions (scales, arpeggios, octaves, thirds, trills...).  Its cost weights were
fitted by coordinate search on PIG pieces 031-150 (``learn_weights.py``; the standard
train split), so the test pieces 001-030 are unseen.

The wrapper uses the repository's own ``midi_loader.read_pig(path, with_fingering=False)``
(hands from the channel column) and ``fingering.finger_hand`` per hand with the whole song
as context and the default ("calibrated") pianist, exactly like its ``pig_eval.py``.

    python run_handthesia.py --pieces test
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import THIRD_PARTY, base_arg_parser, resolve_common, run_pieces  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "V9011N__pygame-piano-animator"


def main() -> None:
    ap = base_arg_parser(__doc__, "handthesia_planner")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    args = ap.parse_args()
    sys.path.insert(0, str(Path(args.repo)))
    import fingering as FG  # noqa: E402  (repo module)
    from midi_loader import LEFT, RIGHT, read_pig  # noqa: E402

    def predict(notes, inp):
        song = read_pig(str(inp), with_fingering=False)  # finger column not read
        assert len(song.notes) == len(notes)
        out = [None] * len(notes)
        # MidiSong re-orders the notes, so map back by (onset, pitch, channel), duplicates in order
        queues: dict = {}
        for pn in notes:
            queues.setdefault((round(pn.onset, 6), pn.pitch, pn.channel), []).append(pn.idx)
        pos = {}
        for n in sorted(song.notes, key=lambda n: (n.start, n.pitch, n.track)):
            pos[id(n)] = queues[(round(n.start, 6), n.pitch, n.track)].pop(0)
        for h in (RIGHT, LEFT):
            ns = [n for n in song.notes if n.hand == h]
            if not ns:
                continue
            fing = FG.finger_hand(ns, left=(h == LEFT), context=song.notes, pianist=None)
            for n in ns:
                f = fing.get(id(n))
                i = pos[id(n)]
                if not isinstance(f, int) or not 1 <= f <= 5:
                    raise RuntimeError(f"note {i} got finger {f!r}")
                out[i] = f if notes[i].channel == 0 else -f
        return out

    pig_dir, pieces, out_dir = resolve_common(args)
    run_pieces(args.name, pieces, pig_dir, out_dir, predict, meta={"repo": args.repo},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
