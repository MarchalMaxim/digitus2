"""huukhangapcs/AutomaticPianoFingering (MIT, Mar 2026): "pianist-inspired" pipeline -
phrase-boundary detection, intent analysis, a pattern library (Alberti bass, arpeggios,
octave bounces hard-locked for the LH), RH phrase-peak "gravity", and a phrase-scoped
Viterbi DP over 5-finger hand states with 3-D key geometry costs, then an auditor/repair
pass.  Main entry point: ``fingering.phrasing.pipeline.PhraseAwareFingering`` (the grand-staff
mode: each hand fingered with the other hand as ``companion_notes``).

Input conversion exactly as the repository's own scripts/pig_eval.py: 120 bpm assumed
(beat = onset / 0.5 s), measure = int(onset / 2 s) + 1, notes sorted by onset per hand,
finger column not passed (``finger=None``).  ``--pipeline simple`` runs the repository's
simpler ``fingering.simple.pipeline.PianoFingering`` instead.

    python run_huukhang.py --pieces test
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import THIRD_PARTY, base_arg_parser, resolve_common, run_pieces  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "huukhangapcs__AutomaticPianoFingering"


def main() -> None:
    ap = base_arg_parser(__doc__, "huukhang_phraseaware")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--pipeline", default="phrase", choices=["phrase", "simple"])
    args = ap.parse_args()
    if args.pipeline == "simple" and args.name == "huukhang_phraseaware":
        args.name = "huukhang_simple"
    sys.path.insert(0, str(Path(args.repo) / "src"))
    from fingering.models.note_event import NoteEvent  # noqa: E402

    if args.pipeline == "phrase":
        from fingering.phrasing.pipeline import PhraseAwareFingering  # noqa: E402
    else:
        from fingering.simple.pipeline import PianoFingering  # noqa: E402

    def predict(notes, inp):
        hands = {}
        for channel, hand in ((0, "right"), (1, "left")):
            sel = sorted((n for n in notes if n.channel == channel), key=lambda n: (n.onset, n.pitch))
            evs = []
            for n in sel:
                beat = n.onset / 0.5
                evs.append(NoteEvent(pitch=n.pitch, onset=beat, offset=beat + (n.offset - n.onset) / 0.5,
                                     hand=hand, measure=int(n.onset / 2.0) + 1, beat=beat, finger=None))
            hands[channel] = (sel, evs)
        out = [None] * len(notes)
        for channel in (0, 1):
            sel, evs = hands[channel]
            if not evs:
                continue
            other = hands[1 - channel][1] or None
            if args.pipeline == "phrase":
                fingers = PhraseAwareFingering(use_motif_engine=True).run(evs, companion_notes=other)
            else:
                fingers = PianoFingering().run(evs)
            if len(fingers) != len(sel):
                raise RuntimeError(f"{len(fingers)} fingers for {len(sel)} notes")
            for n, f in zip(sel, fingers):
                f = int(f) if f else 1
                out[n.idx] = f if channel == 0 else -f
        return out

    pig_dir, pieces, out_dir = resolve_common(args)
    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": args.repo, "pipeline": args.pipeline, "assumed_bpm": 120},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
