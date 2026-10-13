"""thegreatkwanghyeon/autofingering (MIT): a small Python re-implementation of Nakamura's
first-order fingering HMM (finger-pair transitions, emission = keyboard-position difference
(dx in white keys clipped to +-15, dy in {-1,0,1}), -5 log-penalty for wrong-direction
fingers within 30 ms, as in Nakamura et al. 2020).

The repository only offers a MusicXML CLI; we call its ``Hand`` class directly:
  * training: ``Hand.build_from_data`` on all annotator files of the PIG *training* pieces
    (split train+val = pieces 031-150, the same data as Nakamura's shipped parameters);
    the hand of a training note is the sign of its finger, exactly as the original CLI;
  * decoding: ``Hand.decoding`` on each hand of the test piece (hand = channel column),
    observations built with the repository's own ``fingering.note_to_diff``; time = onset
    in seconds (the 30 ms chord rule then works as intended; the original MusicXML path
    feeds quarter-lengths).

Patch: patches/autofingering.patch (DataFrame.append -> pd.concat for pandas 2).

    python run_autofingering.py --pieces test
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import THIRD_PARTY, base_arg_parser, gt_files, load_split, resolve_common, run_pieces  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "thegreatkwanghyeon__autofingering"
PIG_COLUMNS = ["id", "onset", "offset", "pitch", "onsetvel", "offsetvel", "hand", "fingernum"]


def main() -> None:
    ap = base_arg_parser(__doc__, "autofingering_hmm")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    args = ap.parse_args()
    sys.path.insert(0, str(Path(args.repo) / "autofingering"))
    import warnings

    import pandas as pd  # noqa: E402
    import fingering  # noqa: E402  (the repository's module)
    import hand as hand_mod  # noqa: E402

    warnings.filterwarnings("ignore", category=FutureWarning)
    pig_dir, pieces, out_dir = resolve_common(args)
    split = load_split(args.split)
    train_pieces = sorted(set(split["train"]) | set(split["val"]))
    if set(train_pieces) & set(pieces):
        print("WARNING: evaluating on training pieces", file=sys.stderr)

    left, right = [], []
    for pc in train_pieces:
        for path in gt_files(pc, pig_dir):
            data = pd.read_csv(path, sep="\t", header=0, names=PIG_COLUMNS)
            if data.fingernum.dtype == object:
                data.fingernum = data.fingernum.apply(lambda x: x.split("_")[0]).astype("int")
            left.append(data[data.fingernum < 0])
            right.append(data[data.fingernum > 0])
    import contextlib
    import io
    with contextlib.redirect_stdout(io.StringIO()):  # the library prints one line per file
        lh = hand_mod.Hand("L")
        lh.build_from_data(left)
        rh = hand_mod.Hand("R")
        rh.build_from_data(right)

    def predict(notes, inp):
        fingers = [None] * len(notes)
        for channel, model in ((0, rh), (1, lh)):
            sel = [n for n in notes if n.channel == channel]  # file order (= onset order)
            if not sel:
                continue
            obs = pd.DataFrame({"pitch": [n.spelled for n in sel], "time": [n.onset for n in sel]})
            obs["time_diff"] = obs.time.diff()
            obs["pitch_diff"] = fingering.note_to_diff(obs)
            path = model.decoding(obs)[1:]
            for n, f in zip(sel, path):
                fingers[n.idx] = int(f) if channel == 0 else -int(f)
        return fingers

    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": args.repo, "train_pieces": f"{len(train_pieces)} pieces (split train+val)"},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
