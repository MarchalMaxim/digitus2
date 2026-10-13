"""Ramoneda, Jeong, Nakamura, Serra & Miron (ACM MM 2022) ArGNN / ArLSTM, pretrained weights.

"Automatic Piano Fingering from Partially Annotated Scores using Autoregressive Neural
Networks", https://github.com/PRamoneda/Automatic-Piano-Fingering (MIT).  The repository
ships the four finetuned checkpoints of the paper (models/{right,left}_{ArGNN,ArLSTM}.pth:
pretrained on ThumbSet, finetuned on the PIG official train split, early-stopped on its val
split).  This wrapper re-uses the repository's own code for the input representation
(``loader.KEY_TO_SEMITONE``, ``normalize_midi``, ``compute_edge_list``, ``reverse_hand``,
``nns.GGCN.edges_to_matrix``) and model definitions (``nns.seq2seq_model``) so that inference
is identical to their ``compute_results_seq2seq`` (greedy autoregressive decoding) or
``compute_results_seq2seq_with_beam`` (``--beam K``).

Per hand: right-hand notes (channel 0) in file order; left-hand notes are mirrored with
``reverse_hand`` (the LH models were trained on mirrored data) -- exactly as the official
test pickles.  Differences from the original pipeline: we do not drop LH pieces whose
mirrored pitches leave the 88-key range (their ``bounds=True`` filter), and the finger column
of the input is never read.

    python run_ramoneda_ar.py --model ArGNN            # greedy, test split
    python run_ramoneda_ar.py --model ArLSTM --beam 10
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import THIRD_PARTY, base_arg_parser, resolve_common, run_pieces  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "PRamoneda__Automatic-Piano-Fingering"


def main() -> None:
    ap = base_arg_parser(__doc__, "ramoneda_argnn")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--model", default="ArGNN", choices=["ArGNN", "ArLSTM"])
    ap.add_argument("--beam", type=int, default=1, help="1 = greedy (default); >1 = beam search")
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    args = ap.parse_args()
    if args.name == "ramoneda_argnn":
        args.name = f"ramoneda_{args.model.lower()}" + (f"_beam{args.beam}" if args.beam > 1 else "")
    if args.device == "cpu":
        os.environ["CUDA_VISIBLE_DEVICES"] = ""  # AR_decoder picks its device at construction

    repo = Path(args.repo)
    sys.path.insert(0, str(repo))
    import numpy as np  # noqa: E402
    import torch  # noqa: E402
    from loader import KEY_TO_SEMITONE, compute_edge_list, normalize_midi, reverse_hand  # noqa: E402
    from nns import common, seq2seq_model  # noqa: E402
    from nns.GGCN import edges_to_matrix  # noqa: E402

    device = "cuda:0" if torch.cuda.is_available() else "cpu"

    def build():
        if args.model == "ArGNN":
            return seq2seq_model.seq2seq(embedding=common.emb_pitch(),
                                         encoder=seq2seq_model.gnn_encoder(input_size=64),
                                         decoder=seq2seq_model.AR_decoder(64))
        return seq2seq_model.seq2seq(embedding=common.only_pitch(),
                                     encoder=seq2seq_model.lstm_encoder(input=1, dropout=0.0),
                                     decoder=seq2seq_model.AR_decoder(64))

    models = {}
    for hand in ("right", "left"):
        m = build()
        ck = torch.load(repo / "models" / f"{hand}_{args.model}.pth", map_location=device, weights_only=False)
        m.load_state_dict(ck["model_state_dict"])
        m.to(device).eval()
        models[hand] = m

    def hand_input(notes, channel):
        cond = [str(channel)]
        sel = [n for n in notes if n.channel == channel]
        # rows exactly as csv.reader would give them, finger column blanked
        rows = [[n.note_id, n.onset_str, n.offset_str, n.spelled, n.onset_vel, n.offset_vel,
                 str(n.channel), "0"] for n in sel]
        pitches = [KEY_TO_SEMITONE[r[3][:-1].lower()] + int(r[3][-1]) * 12 for r in rows]
        data = ([normalize_midi(np.array(pitches))], [np.array([float(r[1]) for r in rows])],
                [np.array([float(r[2]) - float(r[1]) for r in rows])], [np.zeros(len(rows), dtype=int)],
                [(0, 0)], [len(rows)], [compute_edge_list(rows, cond)])
        if channel == 1:
            data = reverse_hand(data, bounds=False)
        return sel, data

    @torch.no_grad()
    def predict(notes, inp):
        fingers = [None] * len(notes)
        for channel, hand in ((0, "right"), (1, "left")):
            sel, data = hand_input(notes, channel)
            if not sel:
                continue
            nts, ons, durs, _, _, lens, edges = data
            # == fingering_subset.__getitem__ + collate_fn_seq2seq for a batch of one
            x = torch.from_numpy(nts[0].astype(float)).view(1, -1, 1).to(device)
            o = torch.from_numpy(ons[0].astype(np.float32)).view(1, -1, 1).to(device)
            d = torch.from_numpy(durs[0].astype(np.float32)).view(1, -1, 1).to(device)
            ln = torch.IntTensor([lens[0]]).to(device)
            e = edges_to_matrix(edges[0], lens[0]).unsqueeze(0).to(device)
            model = models[hand]
            if args.beam > 1:
                pred = model.decode_with_beam(x, o, d, ln, e, fingers=None, beam_k=args.beam)[0]
            else:
                pred = model(x, o, d, ln, e, fingers=None).argmax(dim=2)[0].cpu().tolist()
            for n, c in zip(sel, pred):
                fingers[n.idx] = (int(c) + 1) * (1 if channel == 0 else -1)
        return fingers

    pig_dir, pieces, out_dir = resolve_common(args)
    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": str(repo), "model": args.model, "beam": args.beam, "device": device,
                     "weights": [f"models/right_{args.model}.pth", f"models/left_{args.model}.pth"]},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
