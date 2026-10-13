"""CHOWMHALVIN/Piano-Fingering-Suggestion-Model-with-Intuitive-UI (no license file, 2025): a
first-order fingering HMM (finger-pair transitions, emission = (white-key, black-key) distance
with leaps clipped at 12 white keys) whose Viterbi pass adds hand-size dependent
biomechanical constraints, chord penalties and scale thumb-under/over rules.

The repository's own pipeline (``Hand.build_model``) trains on a *random* 80/20 piece split
(sklearn, unseeded) and reads hands from the channel.  We use its ``PianoHandHMM`` class
directly: ``train`` on the DataFrames (repository column names; substitutions reduced to the
first finger, as its loader does) of every annotator file of the official training pieces,
per hand by channel; ``suggest_fingerings`` on each hand of the test piece with the features
built exactly like its Evaluation/ScoreProcessor code (pitch_diff = clipped white-key and
black-key distance, time_diff = onset difference).  Hand size "M".

    python run_chowmhalvin.py --pieces test
"""
from __future__ import annotations

import contextlib
import io
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import THIRD_PARTY, base_arg_parser, gt_files, load_split, resolve_common, run_pieces  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "CHOWMHALVIN__PFSM"


def main() -> None:
    ap = base_arg_parser(__doc__, "chowmhalvin_hmm")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--hand-size", default="M")
    args = ap.parse_args()
    repo = Path(args.repo)
    sys.path.insert(0, str(repo))
    cwd = os.getcwd()
    os.chdir(repo)  # config.py uses relative paths; nothing is written there by the calls below
    try:
        import pandas as pd  # noqa: E402
        from math import ceil  # noqa: E402
        from config import DATA_FORMAT, HAND_SIZE_FACTORS, MAX_LEAP  # noqa: E402
        from Hand import PianoHandHMM  # noqa: E402
        from utils import extract_pitch_info  # noqa: E402
    finally:
        os.chdir(cwd)

    pig_dir, pieces, out_dir = resolve_common(args)
    split = load_split(args.split)

    def load_df(path):
        df = pd.read_csv(path, sep="\t", dtype=str, names=DATA_FORMAT, header=0)
        df["finger_number"] = df["finger_number"].str.split("_").str[0].astype(int)
        return df.astype({"note_id": int, "onset_time": float, "offset_time": float, "channel": int})

    train = [load_df(p) for pc in sorted(set(split["train"]) | set(split["val"])) for p in gt_files(pc, pig_dir)]
    models = {}
    with contextlib.redirect_stderr(io.StringIO()):
        for side, ch in (("L", 1), ("R", 0)):
            m = PianoHandHMM(side, hand_size=args.hand_size)
            m.train([df[df.channel == ch].reset_index(drop=True) for df in train])
            models[ch] = m
    max_leap = ceil(MAX_LEAP * HAND_SIZE_FACTORS.get(args.hand_size, 1.0))

    def predict(notes, inp):
        df = load_df(inp).drop(columns=["finger_number"])  # finger column dropped before inference
        out = [None] * len(notes)
        for ch, side in ((0, "R"), (1, "L")):
            part = df[df.channel == ch].copy()
            if part.empty:
                continue
            part["pitch_diff"] = list(zip(
                part["pitch"].map(extract_pitch_info).apply(lambda x: x[0]).diff().fillna(0)
                .apply(lambda x: max(-max_leap, min(max_leap, x))),
                part["pitch"].map(extract_pitch_info).apply(lambda x: x[1]).diff().fillna(0)))
            part["time_diff"] = part["onset_time"].diff().fillna(0)
            with contextlib.redirect_stdout(io.StringIO()):
                fingers = models[ch].suggest_fingerings(part.reset_index(drop=True), side)
            if len(fingers) != len(part):
                raise RuntimeError(f"{len(fingers)} fingers for {len(part)} notes")
            for row_idx, f in zip(part.index, fingers):
                f = abs(int(f))
                out[int(row_idx)] = f if ch == 0 else -f
        return out

    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": str(repo), "hand_size": args.hand_size, "train_files": len(train)},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
