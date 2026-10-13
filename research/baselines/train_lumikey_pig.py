"""Retrain the lumikey FingeringTransformer on the PIG official *training* split only.

The released lumikey checkpoints saw every PIG file (incl. the test pieces).  This script
rebuilds training tokens with the repository's own ``inference.build_tokens`` (teacher-forced
finger state, ground-truth finger hints in the 20-note lookahead, which the repository's
``train.mask_finger_hints`` randomly hides during training) from all annotator files of the
split's train pieces, uses the split's val pieces for early stopping, and then calls the
repository's unmodified ``train.train`` (AdamW, label smoothing 0.1, LR plateau schedule,
patience 50, max 300 epochs, CPU).  Checkpoints go to
``outputs/_lumikey_retrained/checkpoints/fingering_transformer_{left,right}.pt``.

    python train_lumikey_pig.py            # ~10-30 min per hand on CPU
    python run_lumikey.py --checkpoint-dir outputs/_lumikey_retrained/checkpoints \
        --name lumikey_retrained_pigtrain
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import OUTPUTS, THIRD_PARTY, default_pig_dir, gt_files, load_split, read_pig, strike_finger  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "lumikey__piano-fingering-model"


def build_tokens_for_pieces(pieces, pig_dir, is_left, inference, np):
    X, Y = [], []
    for pc in pieces:
        for path in gt_files(pc, pig_dir):
            notes = [n for n in read_pig(path) if (n.channel == 1) == is_left]
            notes.sort(key=lambda n: (n.onset, n.pitch))
            fingers = [abs(strike_finger(n.finger)) for n in notes]
            last_midi = [-1.0] * 5
            last_time = [float("inf")] * 5
            for i, n in enumerate(notes):
                t_ms = n.onset * 1000.0
                look = []
                for fn, ff in zip(notes[i + 1:i + 21], fingers[i + 1:i + 21]):
                    look.append({"midi": fn.pitch, "time_until": fn.onset * 1000.0 - t_ms,
                                 "finger": ff - 1 if 1 <= ff <= 5 else None})
                X.append(inference.build_tokens(n.pitch, last_midi, last_time, look))
                f = fingers[i] if 1 <= fingers[i] <= 5 else 1
                Y.append(f - 1)
                # state update exactly as inference.predict_fingerings (with the GT finger)
                last_midi[f - 1] = n.pitch
                last_time[f - 1] = -max(n.offset - n.onset, 0.0) or -0.1
                if i + 1 < len(notes):
                    dt = notes[i + 1].onset - n.onset
                    for k in range(5):
                        if last_time[k] != float("inf"):
                            last_time[k] += dt
    return np.asarray(X, dtype=np.float32), np.asarray(Y, dtype=np.int64)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--pig-dir", default=None)
    ap.add_argument("--split", default=None)
    ap.add_argument("--out", default=str(OUTPUTS / "_lumikey_retrained"))
    ap.add_argument("--epochs", type=int, default=300)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    repo = Path(args.repo)
    sys.path.insert(0, str(repo / "python"))
    import numpy as np
    import torch
    import inference  # noqa: E402  (repo module)
    import train as lk_train  # noqa: E402  (repo module)

    torch.manual_seed(args.seed)
    pig_dir = Path(args.pig_dir) if args.pig_dir else default_pig_dir()
    split = load_split(args.split, name="ramoneda2022")  # needs a validation set
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for hand in ("right", "left"):
        is_left = hand == "left"
        Xtr, Ytr = build_tokens_for_pieces(split["train"], pig_dir, is_left, inference, np)
        Xva, Yva = build_tokens_for_pieces(split["val"], pig_dir, is_left, inference, np)
        print(f"{hand}: train {len(Xtr)} samples ({len(split['train'])} pieces), val {len(Xva)}", flush=True)
        data = {"X_train": torch.tensor(Xtr), "Y_train": torch.tensor(Ytr),
                "X_val": torch.tensor(Xva), "Y_val": torch.tensor(Yva)}
        lk_train.load_data = lambda hand=hand, **kw: data  # use our split instead of the repo's npz files
        lk_train.PROJECT_ROOT = out                         # checkpoints -> <out>/checkpoints/
        lk_train.train(hand, max_epochs=args.epochs)


if __name__ == "__main__":
    main()
