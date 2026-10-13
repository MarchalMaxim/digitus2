"""TimKoornstra/automatic-piano-fingering (GPL-3.0, 2021): tabular Q-learning over states
(previous note, note, next note) with a toy reward (minus the distance between the note and
the chosen finger's slot in a rigid five-finger hand frame); 1000 epsilon-greedy episodes.
The repository trains on MusicXML right-hand voice 1 and states that it "works best when the
sheets in the test set are part of the training set" (the reward needs no labels), so we
train a fresh Q-table on each piece itself and then read off the greedy fingering.

Adaptations (documented, not upstream): the per-note DataFrame (step, alter, octave + "fin"
row) is built straight from the PIG notes instead of MusicXML; chords are flattened to an
ascending run per onset; the method is right-hand only, so the left hand is fingered by
mirroring its pitches around D4 (MIDI 62: p -> 124 - p) and running the same right-hand model.
The Q-table indexes notes in [-8, 48) "distance" units around C4; notes outside that range are
clipped into it (upstream would index out of bounds / wrap around).

    python run_timkoornstra.py --pieces test
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import THIRD_PARTY, base_arg_parser, midi_to_spelled, resolve_common, run_pieces  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "TimKoornstra__automatic-piano-fingering"


def main() -> None:
    ap = base_arg_parser(__doc__, "timkoornstra_qlearning")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    sys.path.insert(0, str(Path(args.repo) / "src"))
    import numpy as np  # noqa: E402
    import pandas as pd  # noqa: E402
    import environment as env  # noqa: E402  (repo module)
    import note_parser  # noqa: E402
    import q_learning as q  # noqa: E402

    lo, hi = q.lowest_note, q.highest_note

    def frame(pitches):
        rows = []
        for p in pitches:
            sp = midi_to_spelled(int(p))
            step, acc, octave = sp[0], sp[1:-1], sp[-1]
            rows.append([step, acc, octave])
        rows.append(["fin", "fin", "fin"])
        df = pd.DataFrame(rows, columns=["step", "alter", "octave"])
        df.name = "pig"
        return df

    def clip_frame(df):
        # keep the numeric distance inside the Q-table range by shifting whole octaves
        vals = note_parser.to_numerical(df)
        out = []
        for (_, r), v in zip(df.iterrows(), vals + [None]):
            if r["step"] == "fin":
                out.append(list(r))
                continue
            octv = int(r["octave"])
            while v < lo:
                v += 8
                octv += 1
            while v >= hi - 1:
                v -= 8
                octv -= 1
            out.append([r["step"], r["alter"], str(octv)])
        df2 = pd.DataFrame(out, columns=["step", "alter", "octave"])
        df2.name = "pig"
        return df2

    def finger_line(pitches):
        if len(pitches) < 2:
            return [1] * len(pitches)
        np.random.seed(args.seed)
        q.q_values = np.zeros_like(q.q_values)  # fresh table per piece/hand
        env.hand = [None] * 5
        df = clip_frame(frame(pitches))
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            q.train(df)
        env.hand = [None] * 5
        out = q.find_optimal_fingering(df)
        return [int(x) for x in out]

    def predict(notes, inp):
        res = [None] * len(notes)
        for channel in (0, 1):
            sel = sorted((n for n in notes if n.channel == channel), key=lambda n: (n.onset, n.pitch))
            pitches = [n.pitch if channel == 0 else 124 - n.pitch for n in sel]
            fingers = finger_line(pitches)
            for n, f in zip(sel, fingers):
                res[n.idx] = f if channel == 0 else -f
        return res

    pig_dir, pieces, out_dir = resolve_common(args)
    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": args.repo, "seed": args.seed, "episodes": 1000, "lh": "mirrored around D4"},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
