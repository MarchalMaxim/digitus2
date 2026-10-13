"""vibetuned/chirality (AGPL-3.0, July 2026): exact weighted Viterbi over the 12 Parncutt
(1997) rules, with rule weights either uniform (= Parncutt's original cost, but solved
exactly with a second-order Viterbi instead of Dijkstra over pruned paths) or learned with
path-difference learning (Radisavljevic & Driessen 2004 = averaged structured perceptron).

The project targets Python >= 3.14 / numpy >= 2.4, but the modules used here
(``chirality.hmm.pig``, ``chirality.rules.weight_learning``) run unchanged on Python 3.11 /
numpy 1.26 (no patches).  Training (``--variant learned``) calls the repository's own
``perceptron`` (5 epochs, lr 0.01, seed 0 = its CLI defaults) on all annotator files of the
official training pieces, hand parts split by finger sign as in its ``learn-weights``
command.  Inference: per hand (channel column), notes in file order (chords flattened to
onset-ordered note steps, the repository's protocol), ``piece_features`` + ``solve_weighted``.
Its Nakamura-HMM port is not run separately (its own tests show it is note-identical to the
original binaries, which are benchmarked as nakamura_fhmm*).

    python run_chirality.py --variant learned --pieces test
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import OUTPUTS, THIRD_PARTY, base_arg_parser, gt_files, load_split, resolve_common, run_pieces  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "vibetuned__chirality"


def main() -> None:
    ap = base_arg_parser(__doc__, "chirality")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--variant", default="learned", choices=["learned", "uniform"])
    ap.add_argument("--weights", default=str(OUTPUTS / "_chirality" / "parncutt_learned.json"))
    args = ap.parse_args()
    if args.name == "chirality":
        args.name = f"chirality_parncutt_viterbi_{args.variant}"
    sys.path.insert(0, str(Path(args.repo) / "src"))
    import numpy as np  # noqa: E402
    from chirality.hmm.pig import read_fingering_file  # noqa: E402
    from chirality.rules.weight_learning import (N_RULES, perceptron, piece_features,  # noqa: E402
                                                 solve_weighted, weights_as_dict)
    from chirality.rules.parncutt97 import RULE_KEYS  # noqa: E402

    pig_dir, pieces, out_dir = resolve_common(args)
    if args.variant == "uniform":
        w = np.ones(N_RULES)
    else:
        wpath = Path(args.weights)
        if not wpath.is_file():
            split = load_split(args.split)
            train_pieces = sorted(set(split["train"]) | set(split["val"]))
            parts = []
            for pc in train_pieces:
                for path in gt_files(pc, pig_dir):
                    fingering = read_fingering_file(path)
                    for hand in (0, 1):
                        part = [n for n in fingering if (n.finger < 0) == (hand == 1)]
                        if len(part) < 2:
                            continue
                        parts.append((piece_features([(n.column, n.is_black) for n in part], hand=hand + 1),
                                      [abs(n.finger) for n in part]))
            print(f"{len(parts)} hand parts from {len(train_pieces)} training pieces", flush=True)
            w = perceptron(parts, epochs=5, lr=0.01)
            wpath.parent.mkdir(parents=True, exist_ok=True)
            wpath.write_text(json.dumps(weights_as_dict(w), indent=2) + "\n", encoding="utf-8")
        d = json.loads(wpath.read_text(encoding="utf-8"))
        w = np.array([d[k] for k in RULE_KEYS])

    def predict(notes, inp):
        pn = read_fingering_file(inp)  # finger column parsed by the library but never used below
        assert len(pn) == len(notes)
        out = [None] * len(notes)
        for hand in (0, 1):
            pos = [i for i, n in enumerate(pn) if n.channel == hand]
            if not pos:
                continue
            feats = piece_features([(pn[i].column, pn[i].is_black) for i in pos], hand=hand + 1)
            fingers = solve_weighted(feats, w)
            for i, f in zip(pos, fingers):
                out[i] = int(f) if hand == 0 else -int(f)
        return out

    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": args.repo, "variant": args.variant,
                     "weights": dict(zip(RULE_KEYS, [round(float(x), 4) for x in w]))},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
