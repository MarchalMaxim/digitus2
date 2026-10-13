"""ackyedy/piano-fingering-analysis (no license file; 2026 high-school research project on PIG
v1.2): small numpy models -- B0 most-frequent finger per hand, B1 direction rule (+-1 finger per
interval direction), H1 first-order "interval HMM" (state = finger, observation = clipped
semitone interval, mirrored for the LH; Laplace smoothing alpha=1, clip 15), H2 interpolated
second-order version (lam 0.5).  Repository defaults are used.

Training (B0/H1/H2): every annotator file of the official training pieces (split train+val),
one sequence per hand (hand from the channel; notes in file order; the pressing finger of
substitutions), weight 1 -- the repository's ``fit(sequences)`` API.  Inference: ``predict``
per hand on the test piece (channel hands, notes in file order).

    python run_ackyedy.py --model H2 --pieces test
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import (THIRD_PARTY, base_arg_parser, gt_files, load_split, read_pig, resolve_common,  # noqa: E402
                     run_pieces, strike_finger)

DEFAULT_REPO = THIRD_PARTY / "ackyedy__piano-fingering-analysis"


def main() -> None:
    ap = base_arg_parser(__doc__, "ackyedy")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--model", default="H2", choices=["B0", "B1", "H1", "H2"])
    args = ap.parse_args()
    if args.name == "ackyedy":
        args.name = f"ackyedy_{args.model.lower()}"
    sys.path.insert(0, str(Path(args.repo)))
    from src.baselines import build  # noqa: E402  (repo package "src")

    pig_dir, pieces, out_dir = resolve_common(args)
    split = load_split(args.split)
    model = build(args.model)
    seqs = []
    for pc in sorted(set(split["train"]) | set(split["val"])):
        for path in gt_files(pc, pig_dir):
            notes = read_pig(path)
            for hand in (0, 1):
                sel = [n for n in notes if n.channel == hand and 1 <= abs(strike_finger(n.finger)) <= 5]
                if sel:
                    seqs.append(([n.pitch for n in sel], [abs(strike_finger(n.finger)) for n in sel], hand, 1.0))
    model.fit(seqs)

    def predict(notes, inp):
        out = [None] * len(notes)
        for hand in (0, 1):
            sel = [n for n in notes if n.channel == hand]
            if not sel:
                continue
            for n, f in zip(sel, model.predict([n.pitch for n in sel], hand)):
                out[n.idx] = int(f) if hand == 0 else -int(f)
        return out

    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": args.repo, "model": args.model, "hyperparameters": model.hyperparameters(),
                     "train_sequences": len(seqs)}, skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
