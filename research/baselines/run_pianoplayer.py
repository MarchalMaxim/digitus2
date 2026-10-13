"""marcomusy/pianoplayer (MIT) on PIG files.

pianoplayer 3.0.2 reads PIG files itself (``scorereader.reader_PIG``), so the wrapper:
  1. writes a copy of the input with the finger column set to 0 -- pianoplayer treats any
     1..5 finger already present in a PIG file as a fixed *anchor*, so feeding the
     ground-truth file directly would leak the answer;
  2. builds the RH (channel 0) and LH (channel 1) note sequences with ``reader_PIG``;
  3. fixes an upstream bug: ``reader_PIG`` never sets the key position ``INote.x`` (all
     notes sit at x = 0 cm, so the hand model sees no movement at all).  With the default
     ``--x-mode keypos`` we set ``x = models.keypos(note)``, exactly what the MusicXML reader
     does; ``--x-mode none`` reproduces the unpatched upstream behaviour, ``--x-mode midi``
     uses ``keypos_midi`` (the MIDI reader's formula, itself non-monotonic within an octave);
  4. optionally (``--chord-stagger 0.05``) re-orders chord members low->high and staggers their
     onsets like the MusicXML/MIDI readers do (reader_PIG does not);
  5. runs ``Hand.generate`` (default hand size M, automatic search depth) and maps the
     fingers back to the original notes.

    python run_pianoplayer.py --pieces test
    python run_pianoplayer.py --pieces test --x-mode none --name pianoplayer_unpatched
"""
from __future__ import annotations

import logging
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import THIRD_PARTY, base_arg_parser, resolve_common, run_pieces, write_blanked_input  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "marcomusy__pianoplayer"


def main() -> None:
    ap = base_arg_parser(__doc__, "pianoplayer")
    ap.add_argument("--repo", default=str(DEFAULT_REPO), help="pianoplayer checkout")
    ap.add_argument("--hand-size", default="M", choices=["XXS", "XS", "S", "M", "L", "XL", "XXL"])
    ap.add_argument("--depth", type=int, default=0, help="0 = automatic (default)")
    ap.add_argument("--x-mode", default="keypos", choices=["keypos", "none", "midi"])
    ap.add_argument("--chord-stagger", type=float, default=0.0,
                    help="seconds; 0 = upstream reader_PIG (no stagger); 0.05 = MusicXML/MIDI path default")
    args = ap.parse_args()
    sys.path.insert(0, str(Path(args.repo)))
    logging.getLogger("pianoplayer").setLevel(logging.WARNING)
    from pianoplayer.hand import Hand  # noqa: E402
    from pianoplayer.models import keypos, keypos_midi  # noqa: E402
    from pianoplayer.scorereader import reader_PIG  # noqa: E402

    pig_dir, pieces, out_dir = resolve_common(args)
    tmp = Path(tempfile.mkdtemp(prefix="pianoplayer_"))

    def predict(notes, inp: Path):
        blank = tmp / inp.name
        write_blanked_input(blank, notes, blank="0")
        fingers = [None] * len(notes)
        for channel, side in ((0, "right"), (1, "left")):
            idx = [n.idx for n in notes if n.channel == channel]
            if not idx:
                continue
            seq = reader_PIG(str(blank), channel)
            # reader_PIG: rows.sort(key=(onset, name.replace('b','-'))) -> stable; noteID = rank
            order = sorted(idx, key=lambda i: (notes[i].onset, notes[i].spelled.replace("b", "-")))
            assert len(seq) == len(order)
            orig = {}
            for an, i in zip(seq, order):
                assert an.pitch == notes[i].pitch and abs(an.time - notes[i].onset) < 1e-9
                orig[id(an)] = i
                if args.x_mode == "keypos":
                    an.x = keypos(an)
                elif args.x_mode == "midi":
                    an.x = keypos_midi(an)
            if args.chord_stagger > 0:
                # emulate musicxml_io.noteseq_from_part: chord members low->high, staggered onsets
                out_seq, k = [], 0
                while k < len(seq):
                    j = k
                    while j < len(seq) and seq[j].time == seq[k].time:
                        j += 1
                    group = sorted(seq[k:j], key=lambda a: a.pitch)
                    cnt = len(group)
                    for r, an in enumerate(group):
                        if cnt > 1:
                            an.chordnr = r
                            an.time = an.time - args.chord_stagger * (cnt - r - 1)
                            an.duration = an.duration + args.chord_stagger * (cnt - 1)
                        out_seq.append(an)
                    k = j
                seq = out_seq
            hand = Hand(side=side, noteseq=seq, size=args.hand_size)
            hand.verbose = False
            hand.autodepth = args.depth == 0
            if not hand.autodepth:
                hand.depth = args.depth
            hand.generate(1, 100000)
            for an in hand.noteseq:
                i = orig[id(an)]
                f = int(an.fingering) if str(an.fingering).lstrip("-").isdigit() else 0
                fingers[i] = (f if channel == 0 else -f) if 1 <= abs(f) <= 5 else None
        missing = sum(1 for f in fingers if f is None)
        if missing:
            raise RuntimeError(f"{missing} notes without a finger")
        return fingers

    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": args.repo, "hand_size": args.hand_size, "depth": args.depth,
                     "x_mode": args.x_mode, "chord_stagger_s": args.chord_stagger},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
