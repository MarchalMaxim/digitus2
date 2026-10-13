"""dvdrndlph/pydactyl (MIT): classic rule-based fingering models on PIG files.

pydactyl (David A. Randolph, "Didactyl" project, UIC) implements several published
monophonic fingering models as "Dactylers":

  parncutt  Parncutt, Sloboda, Clarke, Raekallio & Desain (1997), 12 trigram rules
  jacobs    Jacobs (2001) revision of Parncutt (physical key distances)
  badgerow  Badgerow (2009) revision of Parncutt
  balliauw  Balliauw et al. (2017) rules (as re-implemented in Parncutt's DP framework)
  hart      Hart, Bosch & Tsai (2000) interval cost table DP
  random    uniformly random legal fingering (sanity floor)

Each model works on one staff at a time; chords are "arpeggiated" by pydactyl itself
(``DPart.orderly_note_stream``: simultaneous notes nudged by a 2048th note, low to high).
We build a two-part music21 score straight from the PIG notes (part 0 = channel 0 = right
hand = "upper" staff, part 1 = channel 1 = left hand = "lower" staff; 1 s = 2 quarter notes)
and ask for the single best suggestion (``generate_advice(staff, k=1)``).

Shims (no source changes to the clone): ``magic`` (python-magic, only used for file-type
sniffing when loading corpora from disk) is replaced by an empty stub module; same-pitch
duplicates at the same onset in one hand (pydactyl raises on them) are removed before
fingering and receive their twin's finger.

    python run_pydactyl.py --model parncutt --pieces test
"""
from __future__ import annotations

import re
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import THIRD_PARTY, base_arg_parser, resolve_common, run_pieces  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "dvdrndlph__pydactyl"
QL_PER_SECOND = 2.0
ABCDF_TOKEN_RE = re.compile(r"[<>]|\d")


def parse_abcdf(advice: str) -> list[tuple[str, int]]:
    """abcDF advice string ('>1234<21...': hand marker then one digit per note) -> [(hand, digit)]."""
    hand, out = ">", []
    for tok in ABCDF_TOKEN_RE.findall(advice):
        if tok in "<>":
            hand = tok
        else:
            out.append((hand, int(tok)))
    return out


def main() -> None:
    ap = base_arg_parser(__doc__, "pydactyl_parncutt")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--model", default="parncutt",
                    choices=["parncutt", "jacobs", "badgerow", "balliauw", "hart", "random"])
    args = ap.parse_args()
    if args.name == "pydactyl_parncutt":
        args.name = f"pydactyl_{args.model}"
    sys.path.insert(0, str(Path(args.repo)))
    sys.modules.setdefault("magic", types.ModuleType("magic"))
    from music21 import metadata, note, stream, tempo  # noqa: E402
    from pydactyl.dcorpus.DCorpus import DCorpus  # noqa: E402
    from pydactyl.dcorpus.DScore import DScore  # noqa: E402
    from pydactyl.dactyler import Parncutt as P  # noqa: E402

    def make_model():
        if args.model == "parncutt":
            return P.Parncutt()
        if args.model == "jacobs":
            return P.Jacobs()
        if args.model == "badgerow":
            return P.Badgerow()
        if args.model == "balliauw":
            return P.Balliauw()
        if args.model == "hart":
            from pydactyl.dactyler.Hart import Hart
            return Hart()
        from pydactyl.dactyler.Random import Random
        return Random()

    split_stats = {"segments": 0, "forced_splits": 0}

    def advise_segment(seg, staff):
        """Best fingering for one monophonic(-ised) segment; one DScore per segment."""
        parts = []
        for _ in range(2):  # same notes in both parts; ``staff`` selects the hand's rules
            part = stream.Part()
            part.insert(0, tempo.MetronomeMark(number=120))
            for n in seg:
                m = note.Note(midi=n.pitch)
                m.quarterLength = max(n.offset - n.onset, 0.01) * QL_PER_SECOND
                part.insert(n.onset * QL_PER_SECOND, m)
            parts.append(part)
        score = stream.Score()
        score.insert(0, metadata.Metadata(title="pig"))
        for p in parts:
            score.insert(0, p)
        corpus = DCorpus()
        corpus.append(d_score=DScore(music21_stream=score, title="pig"))
        model = make_model()
        model.load_corpus(d_corpus=corpus)
        suggestions, _, _ = model.generate_advice(staff=staff, score_index=0, k=1)
        digits = parse_abcdf(suggestions[0])
        if len(digits) != len(seg):
            raise RuntimeError(f"{staff}: {len(digits)} digits for {len(seg)} notes")
        return [d for _, d in digits]

    def solve(seg, staff, thresholds):
        """Try the whole segment; on 'No solution' split at leaps larger than the next threshold."""
        try:
            split_stats["segments"] += 1
            return advise_segment(seg, staff)
        except Exception as exc:
            # Parncutt family: "No solution between ..." when a leap exceeds every finger pair's
            # MaxPrac; Hart: KeyError when an interval exceeds its 12-semitone cost table.
            unsolvable = "No solution" in str(exc) or isinstance(exc, KeyError)
            if not unsolvable or len(seg) <= 1 or not thresholds:
                raise
        thr, rest = thresholds[0], thresholds[1:]
        cuts = [i for i in range(1, len(seg)) if abs(seg[i].pitch - seg[i - 1].pitch) > thr]
        if not cuts:
            return solve(seg, staff, rest)
        split_stats["forced_splits"] += len(cuts)
        out, prev = [], 0
        for c in cuts + [len(seg)]:
            out += solve(seg[prev:c], staff, rest)
            prev = c
        return out

    def predict(notes, inp):
        fingers = [None] * len(notes)
        twins = {}
        for channel, staff in ((0, "upper"), (1, "lower")):
            sel = sorted((n for n in notes if n.channel == channel), key=lambda n: (n.onset, n.pitch))
            kept, seen = [], {}
            for n in sel:
                key = (n.onset_str, n.pitch)
                if key in seen:
                    twins[n.idx] = seen[key]
                    continue
                seen[key] = n.idx
                kept.append(n)
            if not kept:
                continue
            digits = solve(kept, staff, [15, 12, 11, 9, 7, 5, 4, 3, 2, 1, 0])
            for n, d in zip(kept, digits):
                fingers[n.idx] = d if channel == 0 else -d
        for i, j in twins.items():
            fingers[i] = fingers[j]
        if any(f is None for f in fingers):
            raise RuntimeError("unassigned notes")
        return fingers

    pig_dir, pieces, out_dir = resolve_common(args)
    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": args.repo, "model": args.model, "ql_per_second": QL_PER_SECOND,
                     "segmentation": "whole hand; if unsolvable split at leaps > 15,12,11,9,... semitones",
                     "split_stats": split_stats},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
