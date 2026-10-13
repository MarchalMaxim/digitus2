"""Retrain APF-Gen's default model (configs/default.yaml: CNN-BiLSTM + attention + AR,
"physical" features, octave/tempo augmentation) on the official PIG split.

The repository splits the 309 *files* randomly (70/15/15, seed 42), which leaks
annotations of test pieces into training.  Here ``src.data.dataset.split_pieces`` is
replaced by the official split (train pieces / val pieces / test pieces, all annotator
files of each piece) and the repository's unmodified ``src.train.train`` is called with a
copy of the default config (device -> cuda, num_workers -> 0 for Windows, data.root -> PIG).
Output: outputs/_apfgen_retrained/outputs/checkpoints/best.pt (best val M_gen).

    python train_apfgen_official.py
    python run_apfgen.py --checkpoint outputs/_apfgen_retrained/outputs/checkpoints/best.pt \
        --name apfgen_retrained_official
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import OUTPUTS, THIRD_PARTY, default_pig_dir, load_split  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "chrsztz__APF-Gen"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--work", default=str(OUTPUTS / "_apfgen_retrained"))
    ap.add_argument("--split", default=None)
    ap.add_argument("--epochs", type=int, default=None, help="override train.epochs (default: config's 40)")
    args = ap.parse_args()
    repo = Path(args.repo).resolve()
    sys.path.insert(0, str(repo))
    import yaml
    import src.data.dataset as ds  # noqa: E402
    import src.train as tr  # noqa: E402

    split = load_split(args.split, name="ramoneda2022")  # needs a validation set
    pig_dir = default_pig_dir()

    def official_split(pieces, train_ratio, val_ratio, test_ratio, seed=42):
        ids = sorted(pieces)  # file ids like "031-1"
        pick = lambda keep: [i for i in ids if i[:3] in keep]  # noqa: E731
        return pick(set(split["train"])), pick(set(split["val"])), pick(set(split["test"]))

    ds.split_pieces = official_split
    cfg = yaml.safe_load((repo / "configs" / "default.yaml").read_text(encoding="utf-8"))
    cfg["data"]["root"] = str(pig_dir)
    cfg["train"]["device"] = "cuda"
    cfg["train"]["num_workers"] = 0
    if args.epochs:
        cfg["train"]["epochs"] = args.epochs
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    cfg_path = work / "config_official.yaml"
    cfg_path.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    os.chdir(work)  # train() writes outputs/checkpoints/best.pt relative to the cwd
    tr.train(str(cfg_path))


if __name__ == "__main__":
    main()
