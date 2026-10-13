"""MarcAlKareh/fingerflow (no license file; Sept 2026): biomechanical cost model over physical
keyboard geometry (99 features: spans scaled to the hand, legato coupling, speed factor,
Fitts-law relocation term, finger-pair indicators, ...) decoded with a second-order Viterbi
over chord-aware finger assignments; weights learned from PIG with an averaged
passive-aggressive structured perceptron (Hamming-augmented decoding).

Two variants:
  fingerflow_default  hand-tuned default weights (no training);
  fingerflow_learned  weights learned with the repository's ``engine.training.train.train``
                      (default hyper-parameters of its benchmark: 8 epochs, lr 0.5, rho 0.5,
                      l2-to-prior 0.01, span 21 cm) on all annotator files of the official
                      *training* pieces only (split train+val = 031-150; no dev set is passed,
                      so the test pieces are never seen).  Weights are cached in
                      outputs/_fingerflow/weights_learned.json.

Inference: ``engine.assign_fingering(hand_data, hand, hand_span_cm=21, weights=...)`` per
hand, with hands from the PIG channel column (their PIG loader uses the finger sign, which
is ground truth).  Notes the engine drops (``unfingered_note_ids``) get finger 1 and are
counted in run_log.json.

    python run_fingerflow.py --variant learned --pieces test
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import OUTPUTS, THIRD_PARTY, base_arg_parser, gt_files, load_split, resolve_common, run_pieces  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "MarcAlKareh__fingerflow"
SPAN_CM = 21.0


def main() -> None:
    ap = base_arg_parser(__doc__, "fingerflow")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--variant", default="learned", choices=["learned", "default"])
    ap.add_argument("--weights", default=str(OUTPUTS / "_fingerflow" / "weights_learned.json"))
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    if args.name == "fingerflow":
        args.name = f"fingerflow_{args.variant}"
    sys.path.insert(0, str(Path(args.repo) / "backend"))
    from engine import assign_fingering  # noqa: E402
    from engine.weights import Weights  # noqa: E402

    pig_dir, pieces, out_dir = resolve_common(args)
    weights = None
    if args.variant == "learned":
        wpath = Path(args.weights)
        if not wpath.is_file():
            from engine.training.pig import load_pig_dir  # noqa: E402
            from engine.training.train import prepare_all, train  # noqa: E402
            split = load_split(args.split)
            train_pieces = set(split["train"]) | set(split["val"])
            assert not train_pieces & set(split["test"])
            seqs = [s for s in load_pig_dir(pig_dir) if s.piece in train_pieces]
            print(f"training on {len({s.piece for s in seqs})} pieces / {len(seqs)} hand sequences", flush=True)
            prepared = prepare_all(seqs, SPAN_CM, wpath.parent / "cache", args.workers)
            learned = train(prepared, Weights.default(), epochs=8, lr=0.5, rho=0.5, l2_to_prior=0.01)
            wpath.parent.mkdir(parents=True, exist_ok=True)
            learned.save(wpath)
        weights = Weights.load(wpath)
    stats = {"unfingered_notes": 0}

    def predict(notes, inp):
        fingers = [None] * len(notes)
        for channel, hand in ((0, "right"), (1, "left")):
            sel = [n for n in notes if n.channel == channel]
            if not sel:
                continue
            hand_data = [{"note_id": n.idx, "pitch": n.pitch, "start_time_sec": n.onset,
                          "duration_sec": max(n.offset - n.onset, 0.0)} for n in sel]
            res = assign_fingering(hand_data, hand, hand_span_cm=SPAN_CM, weights=weights, explain=False)
            for n, f in zip(sel, res.finger_list):
                if f is None:
                    stats["unfingered_notes"] += 1
                    f = 1
                fingers[n.idx] = int(f) if channel == 0 else -int(f)
        return fingers

    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": args.repo, "variant": args.variant, "span_cm": SPAN_CM,
                     "weights": args.weights if args.variant == "learned" else "Weights.default()",
                     "stats": stats}, skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
