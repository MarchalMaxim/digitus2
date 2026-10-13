"""chrsztz/APF-Gen (no license file): CNN-BiLSTM (+local attention, autoregressive finger
embedding, auxiliary "physical" head) predicting a *signed* finger (11 classes -5..5) per
note from hand-crafted features (pitch, timing in beats, channel, chord rank, intervals,
hand-position features), optional beam search with physical transition costs.

!! The released ``outputs/checkpoints/best.pt`` was trained on a random 70 % of the 309
PIG *files* (seed 42, ``split_pieces`` over file ids), so annotations of most official test
pieces were in its training data -> ``apfgen_pretrained`` scores on the official test split
are contaminated.  Their own reported "test" M_gen of ~82 % is inflated the same way
(other annotators of the same piece in training).  ``train_apfgen_official.py`` retrains the
default configuration on the official split (``--checkpoint`` selects that model).

Only best.pt matches the current feature code (input_dim 21 / phys_dim 5); the other 25
ablation checkpoints in the repository were trained with an older feature set (20 / 6) and
cannot be loaded by the released code.

The wrapper mirrors ``src/infer.py::run_inference`` (the CLI hard-codes the config's device,
"mps", which fails on CUDA machines) and maps predictions back by note id.

    python run_apfgen.py --pieces test                 # pretrained best.pt, beam search
    python run_apfgen.py --pieces test --no-beam --name apfgen_pretrained_nobeam
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import THIRD_PARTY, base_arg_parser, resolve_common, run_pieces, write_blanked_input  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "chrsztz__APF-Gen"


def main() -> None:
    ap = base_arg_parser(__doc__, "apfgen_pretrained")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--checkpoint", default=None, help="default: <repo>/outputs/checkpoints/best.pt")
    ap.add_argument("--no-beam", action="store_true", help="argmax decoding instead of beam search")
    args = ap.parse_args()
    repo = Path(args.repo)
    sys.path.insert(0, str(repo))
    import torch  # noqa: E402
    from src.data.features import IDX_TO_FINGER, FeatureBuilder  # noqa: E402
    from src.data.parser import parse_fingering_file  # noqa: E402
    from src.infer import forward_pass  # noqa: E402
    from src.models.model import FingeringModel  # noqa: E402
    from src.utils.decoder import beam_search_decode  # noqa: E402

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ckpt_path = Path(args.checkpoint) if args.checkpoint else repo / "outputs" / "checkpoints" / "best.pt"
    ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
    cfg = ckpt["config"]
    builder = FeatureBuilder(feature_type=cfg["data"]["feature_type"], word2vec_dim=cfg["data"]["word2vec_dim"],
                             velocity_threshold=cfg["data"]["velocity_threshold"])
    if cfg["data"]["feature_type"] == "word2vec":
        raise SystemExit("word2vec checkpoints need the training corpus; not supported")
    m = cfg["model"]
    if m.get("arch", "cnn_bilstm") != "cnn_bilstm":
        raise SystemExit(f"arch {m.get('arch')} not supported by this wrapper")
    model = FingeringModel(input_dim=ckpt["input_dim"], phys_dim=ckpt["phys_dim"], hidden_size=m["hidden_size"],
                           cnn_channels=m["cnn_channels"], cnn_layers=m["cnn_layers"], lstm_layers=m["lstm_layers"],
                           dropout=m["dropout"], num_classes=m["num_classes"], use_attention=m["attention"],
                           attn_heads=m.get("attn_heads", 4), attn_window=m.get("attn_window", 10),
                           use_crf=m.get("use_crf", False), use_ar=m.get("use_ar", False),
                           ar_embed_dim=m.get("ar_embed_dim", 16)).to(device)
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    top_k = cfg.get("inference", {}).get("top_k", 3)
    dec = cfg.get("decoder", {})
    tmp = Path(tempfile.mkdtemp(prefix="apfgen_"))
    stats = {"sign_disagrees_with_channel": 0, "zero_finger": 0}

    @torch.no_grad()
    def predict(notes, inp):
        blank = tmp / inp.name
        write_blanked_input(blank, notes, blank="0")
        _, events = parse_fingering_file(str(blank))
        main_f, phys_f, labels = builder.build(events)
        main_t = torch.tensor(main_f, dtype=torch.float32, device=device).unsqueeze(0)
        phys_t = torch.tensor(phys_f, dtype=torch.float32, device=device).unsqueeze(0)
        mask = torch.ones((1, len(events)), dtype=torch.bool, device=device)
        preds, combined, _ = forward_pass(model, main_t, phys_t, mask, m["phys_lambda"], top_k=top_k)
        if args.no_beam:
            idx = preds.squeeze(0).cpu().tolist()
        else:
            idx = beam_search_decode(combined.squeeze(0).cpu(), [e.midi for e in events],
                                     [e.channel for e in events], beam_size=dec.get("beam_size", 5),
                                     alpha=dec.get("alpha", 0.1), beta=dec.get("beta", 0.05),
                                     gamma=dec.get("gamma", 1.0))
        by_id = {int(e.idx): IDX_TO_FINGER.get(int(i), 0) for e, i in zip(events, idx)}
        out = []
        for n in notes:
            f = by_id[int(n.note_id)]
            if f == 0:
                stats["zero_finger"] += 1
            elif (f < 0) != (n.channel == 1):
                stats["sign_disagrees_with_channel"] += 1
            out.append(f)
        return out

    pig_dir, pieces, out_dir = resolve_common(args)
    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": str(repo), "checkpoint": str(ckpt_path), "beam": not args.no_beam,
                     "device": str(device), "prediction_stats": stats},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
