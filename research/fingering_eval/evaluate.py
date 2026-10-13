"""Evaluate predicted fingerings against PIG-format ground truth.

Usage (from ``research/``, or from the project root with ``PYTHONPATH=research``)::

    python -m fingering_eval.evaluate --pred <dir|file> --gold data/pig --split test
    python -m fingering_eval.evaluate --pred data/pig --pred-annotation 1 --gold data/pig --split test --gold-annotations 1
    python -m fingering_eval.evaluate --human --gold data/pig --split test        # Table 2 'Human' row

Prediction files are PIG fingering files (``<piece>[-<anything>]_fingering.txt`` or any
``*.txt`` whose stem starts with the piece id) containing exactly the gold notes, in the gold
order (notes are re-aligned by (onset, pitch) if only the order differs). Only the finger column
of the prediction is used.

Metrics (see ``fingering_eval.metrics``): M_gen, M_high, M_soft, M_rec, macro-averaged over pieces
as in Nakamura et al. (2020) Table 2, plus note-weighted (micro) averages. Gold notes whose finger
is unannotated ("0") are masked out (partially fingered corpora such as Mutopia).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import metrics as M
from .datasets import load_pig, pig_subset
from .pig_io import PigFile, list_pig_files, load_pig_dataset, pig_ids, read_pig
from .validate import is_labeled


def _find_pred_files(pred: Path) -> dict[str, list[Path]]:
    files = [pred] if pred.is_file() else (list_pig_files(pred) or sorted(pred.glob("*.txt")))
    out: dict[str, list[Path]] = {}
    for f in files:
        piece, ann = pig_ids(f)
        if ann is None:  # not "<piece>-<ann>_fingering.txt": accept "<piece>_fingering.txt" / "<piece>.txt"
            piece = f.stem[:-len("_fingering")] if f.stem.endswith("_fingering") else f.stem
        out.setdefault(piece, []).append(f)
    return out


def align_to_gold(pred: list, gold: list) -> list | None:
    """Return pred notes in gold order (identity if pitches already agree), else None."""
    if len(pred) != len(gold):
        return None
    if all(p.pitch == g.pitch for p, g in zip(pred, gold)):
        return pred
    key = lambda n: (round(n.onset, 3), n.pitch)  # noqa: E731
    buckets: dict = {}
    for p in pred:
        buckets.setdefault(key(p), []).append(p)
    out = []
    for g in gold:
        b = buckets.get(key(g))
        if not b:
            return None
        out.append(b.pop(0))
    return out


def evaluate(gold: dict[str, dict[str, PigFile]], preds: dict[str, PigFile], mode: str = "official",
             per_hand: bool = True) -> tuple[list[M.PieceScore], list[str]]:
    scores, problems = [], []
    for piece, anns in gold.items():
        if piece not in preds:
            problems.append(f"{piece}: no prediction")
            continue
        gts = [a.notes for _, a in sorted(anns.items())]
        if len({len(g) for g in gts}) != 1:
            problems.append(f"{piece}: gold annotations differ in length {[len(g) for g in gts]}")
            continue
        est = align_to_gold(preds[piece].notes, gts[0])
        if est is None:
            problems.append(f"{piece}: prediction has {len(preds[piece].notes)} notes / different notes than "
                            f"gold ({len(gts[0])})")
            continue
        keep = [i for i in range(len(est)) if all(is_labeled(g[i]) for g in gts)]
        if not keep:
            problems.append(f"{piece}: no annotated gold notes")
            continue
        gts_k = [[g[i] for i in keep] for g in gts]
        est_k = [est[i] for i in keep]
        s = M.evaluate_piece(gts_k, est_k, piece=piece, mode=mode, per_hand=per_hand)
        s.extra.update({"subset": pig_subset(piece) if piece.isdigit() else "", "n_masked": len(est) - len(keep),
                        "annotations": sorted(anns)})
        scores.append(s)
    return scores, problems


def human_reference(gold: dict[str, dict[str, PigFile]], mode: str = "official",
                    per_hand: bool = True) -> list[M.PieceScore]:
    """Each annotation scored against the other annotations of the same piece, averaged per piece."""
    out = []
    for piece, anns in gold.items():
        if len(anns) < 2:
            continue
        loo = M.leave_one_out({k: v.notes for k, v in anns.items()}, piece, mode=mode, per_hand=per_hand)
        s = M.PieceScore(piece, loo[0].n_notes, len(anns),
                         *[sum(getattr(x, m) for x in loo) / len(loo) for m in M.METRIC_NAMES])
        s.extra["subset"] = pig_subset(piece) if piece.isdigit() else ""
        out.append(s)
    return out


def _fmt(x: float) -> str:
    return f"{100 * x:6.2f}"


def report(scores: list[M.PieceScore], title: str, per_piece: bool = False, by_subset: bool = True) -> str:
    lines = [title]
    if per_piece:
        lines.append(f"{'piece':>8} {'notes':>6} {'#GT':>4} {'M_gen':>7} {'M_high':>7} {'M_soft':>7} {'M_rec':>7}")
        for s in scores:
            lines.append(f"{s.piece:>8} {s.n_notes:6d} {s.n_gt:4d} {_fmt(s.m_gen)}  {_fmt(s.m_high)}  "
                         f"{_fmt(s.m_soft)}  {_fmt(s.m_rec)}")
    agg = M.aggregate(scores)
    if not agg.get("n_pieces"):
        lines.append("no pieces evaluated")
        return "\n".join(lines)
    lines.append(f"{'':16}{'M_gen':>8}{'M_high':>8}{'M_soft':>8}{'M_rec':>8}")
    lines.append(f"{'macro (paper)':16}" + "".join(f"{_fmt(agg['macro_' + m]):>8}" for m in M.METRIC_NAMES)
                 + f"   ({agg['n_pieces']} pieces)")
    lines.append(f"{'micro (notes)':16}" + "".join(f"{_fmt(agg['micro_' + m]):>8}" for m in M.METRIC_NAMES)
                 + f"   ({agg['n_notes']} notes)")
    if by_subset:
        subs = sorted({s.extra.get("subset", "") for s in scores} - {""})
        if len(subs) > 1:
            for sub in subs:
                a = M.aggregate([s for s in scores if s.extra.get("subset") == sub])
                lines.append(f"{'  ' + sub:16}" + "".join(f"{_fmt(a['macro_' + m]):>8}" for m in M.METRIC_NAMES)
                             + f"   ({a['n_pieces']} pieces)")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m fingering_eval.evaluate", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gold", required=True, help="gold dir (PIG root, FingeringFiles dir, or any PIG-format dir)")
    ap.add_argument("--pred", help="prediction file or directory")
    ap.add_argument("--split", default="all",
                    help="all | test | train | ramoneda_train | ramoneda_val | ramoneda_test (PIG only)")
    ap.add_argument("--pred-annotation", help="if the prediction dir holds several files per piece, use this "
                                              "annotation id (e.g. '1')")
    ap.add_argument("--gold-annotations", help="comma-separated annotation ids to keep as gold (default: all)")
    ap.add_argument("--exclude-pred-annotation", action="store_true",
                    help="drop the --pred-annotation from the gold set (leave-one-out)")
    ap.add_argument("--human", action="store_true", help="report the leave-one-out human reference instead")
    ap.add_argument("--mode", default="official", choices=["official", "press", "exact"],
                    help="finger comparison: official = bit-exact Evaluate_MultipleGroundTruth (default), "
                         "press = key-press finger everywhere, exact = raw strings")
    ap.add_argument("--whole-piece", action="store_true",
                    help="run M_high/M_rec over the whole note sequence instead of per hand (non-official)")
    ap.add_argument("--per-piece", action="store_true", help="print per-piece scores")
    ap.add_argument("--json", help="write per-piece scores + aggregates to this JSON file")
    ap.add_argument("--status", help="derived corpora with a manifest.json (e.g. data/mutopia_fingering): keep "
                                     "only pieces whose manifest status equals this value (e.g. 'ok')")
    args = ap.parse_args(argv)

    gold_root = Path(args.gold)
    is_pig = (gold_root / "List.csv").exists() or (gold_root.name == "FingeringFiles"
                                                   and (gold_root.parent / "List.csv").exists())
    if is_pig:
        gold = load_pig(gold_root if gold_root.name != "FingeringFiles" else gold_root.parent, split=args.split)
    else:
        if args.split not in ("all", ""):
            print(f"note: --split {args.split} ignored for non-PIG gold {gold_root}", file=sys.stderr)
        gold = load_pig_dataset(gold_root)
    if args.gold_annotations:
        keep = set(args.gold_annotations.split(","))
        gold = {p: {k: v for k, v in a.items() if k in keep} for p, a in gold.items()}
    if args.exclude_pred_annotation and args.pred_annotation:
        gold = {p: {k: v for k, v in a.items() if k != args.pred_annotation} for p, a in gold.items()}
    if args.status:
        man = gold_root / "manifest.json"
        if not man.exists():
            ap.error(f"--status needs {man}")
        keep_ids = {r["piece_id"] for r in json.loads(man.read_text(encoding="utf-8"))
                    if r.get("status") == args.status}
        gold = {p: a for p, a in gold.items() if p in keep_ids}
    gold = {p: a for p, a in gold.items() if a}
    per_hand = not args.whole_piece

    if args.human:
        scores = human_reference(gold, mode=args.mode, per_hand=per_hand)
        print(report(scores, f"Human reference (leave-one-out) on {gold_root} split={args.split} mode={args.mode}",
                     args.per_piece))
        problems: list[str] = []
    else:
        if not args.pred:
            ap.error("--pred is required unless --human")
        pred_files = _find_pred_files(Path(args.pred))
        preds: dict[str, PigFile] = {}
        problems = []
        for piece, fs in pred_files.items():
            if piece not in gold:
                continue
            if args.pred_annotation:
                fs = [f for f in fs if pig_ids(f)[1] == args.pred_annotation]
            if len(fs) != 1:
                problems.append(f"{piece}: {len(fs)} candidate prediction files (use --pred-annotation)")
                continue
            preds[piece] = read_pig(fs[0])
        scores, probs = evaluate(gold, preds, mode=args.mode, per_hand=per_hand)
        problems += probs
        print(report(scores, f"Prediction {args.pred} vs gold {gold_root} split={args.split} mode={args.mode}"
                             f"{' (whole-piece)' if not per_hand else ''}", args.per_piece))
    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems[:50]:
            print("  " + p)
    if args.json:
        Path(args.json).write_text(json.dumps({"aggregate": M.aggregate(scores),
                                               "pieces": [s.as_dict() for s in scores],
                                               "problems": problems}, indent=1), encoding="utf-8")
    return 0 if scores else 1


if __name__ == "__main__":
    sys.exit(main())
