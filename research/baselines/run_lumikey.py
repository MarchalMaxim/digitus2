"""lumikey/piano-fingering-model (no license file): small Transformer (~100k params) that
predicts one finger per note autoregressively (greedy), from 26 tokens = last note of each
of the 5 fingers, the current note and a 20-note lookahead.

!! The released checkpoints were trained on *all* PIG files (their
data/pig_fingering_data_{right,left}.npz hold exactly 54239 RH + 45801 LH samples = every
note of all 309 PIG v1.2 files), i.e. including the official test pieces.  Scores of
``lumikey_pretrained`` on the PIG test split are therefore contaminated and must not be
compared with the other baselines.  ``train_lumikey_pig.py`` retrains the same architecture
on the official training split only (``--checkpoint-dir`` selects those weights).

The wrapper calls the repository's own ``inference.predict_fingerings`` (time and duration
in ms, notes of a chord ordered low to high, no finger hints given).

    python run_lumikey.py --pieces test                                   # pretrained
    python run_lumikey.py --pieces test --checkpoint-dir outputs/_lumikey_retrained \
        --name lumikey_retrained_pigtrain
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import THIRD_PARTY, base_arg_parser, resolve_common, run_pieces  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "lumikey__piano-fingering-model"


def main() -> None:
    ap = base_arg_parser(__doc__, "lumikey_pretrained")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--checkpoint-dir", default=None,
                    help="directory with fingering_transformer_{left,right}.pt (default: the repo's)")
    args = ap.parse_args()
    repo = Path(args.repo)
    sys.path.insert(0, str(repo / "python"))
    import torch  # noqa: E402
    import inference  # noqa: E402  (repo module)
    from model import FingeringTransformer  # noqa: E402

    torch.set_num_threads(4)

    def load(hand):
        ck_dir = Path(args.checkpoint_dir) if args.checkpoint_dir else repo / "checkpoints"
        ck = torch.load(ck_dir / f"fingering_transformer_{hand}.pt", map_location="cpu", weights_only=True)
        m = FingeringTransformer(d_model=ck["d_model"], nhead=ck["nhead"], num_layers=ck["num_layers"],
                                 dim_feedforward=ck.get("dim_feedforward", 128))
        m.load_state_dict(ck["model_state"])
        m.eval()
        return m

    models = {"left": load("left"), "right": load("right")}

    def predict(notes, inp):
        js = [{"left": n.channel == 1, "note": n.pitch, "time": n.onset * 1000.0,
               "duration": (n.offset - n.onset) * 1000.0, "idx": n.idx} for n in notes]
        fingers = [None] * len(notes)
        for hand, is_left in (("left", True), ("right", False)):
            for r in inference.predict_fingerings(js, hand, models[hand], is_left=is_left):
                fingers[r["idx"]] = -int(r["finger"]) if is_left else int(r["finger"])
        return fingers

    pig_dir, pieces, out_dir = resolve_common(args)
    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": str(repo), "checkpoint_dir": args.checkpoint_dir or str(repo / "checkpoints"),
                     "warning": None if args.checkpoint_dir else
                     "pretrained checkpoints were trained on all PIG files incl. the test pieces"},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
