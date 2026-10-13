"""jpsmith8488/valhala-fingering-solver (MIT, 2026; J. P. Smith, "Optimal piano fingering from a
physically parameterized variational framework", submitted to J. Math. & Music): a first-order
Viterbi over a 14-term physical "action" (kinetic, topographic, gravity, collision, coupling,
key action, contact, adhesion, tempo, dissipation, rotation, stagger, tradition ...).

The solver is monophonic and isochronous: ``HamiltonianSolver.solve(list_of_midi)`` spaces the
notes at ``tempo_nps`` (default 6 notes/s).  Its two-hand ``BilateralSolver.solve(treble,
bass)`` simply runs the same right-hand solver on the bass line too (no mirroring).  We call
exactly that (variant ``bilateral``, default ``tradition='modern'``), hands from the PIG
channel, each hand's notes ordered by (onset, pitch) so chords become ascending runs.
Variant ``mirrored`` (our modification, not the author's method) mirrors the left-hand
pitches around E4/F4... (midi -> 128 - midi) before solving, to show what the cost model does
with a proper left hand.

    python run_valhala.py --variant bilateral --pieces test
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import THIRD_PARTY, base_arg_parser, resolve_common, run_pieces  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "jpsmith8488__valhala-fingering-solver"


def main() -> None:
    ap = base_arg_parser(__doc__, "valhala")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--variant", default="bilateral", choices=["bilateral", "mirrored"])
    ap.add_argument("--tradition", default="modern")
    args = ap.parse_args()
    if args.name == "valhala":
        args.name = f"valhala_{args.variant}"
    sys.path.insert(0, str(Path(args.repo)))
    import valhala_solver_standalone as V  # noqa: E402

    def predict(notes, inp):
        out = [None] * len(notes)
        rh_solver = V.HamiltonianSolver(tradition=args.tradition)
        lh_solver = V.HamiltonianSolver(tradition=args.tradition)
        hands = {}
        for channel in (0, 1):
            hands[channel] = sorted((n for n in notes if n.channel == channel), key=lambda n: (n.onset, n.pitch))
        if args.variant == "bilateral":
            bi = V.BilateralSolver(rh_solver, lh_solver)
            res = bi.solve([n.pitch for n in hands[0]], [n.pitch for n in hands[1]])
            per = {0: res.rh_fingers, 1: res.lh_fingers}
        else:
            per = {}
            for channel, solver in ((0, rh_solver), (1, lh_solver)):
                mids = [n.pitch if channel == 0 else 128 - n.pitch for n in hands[channel]]
                per[channel] = solver.solve(mids)["fingers"] if mids else []
        for channel in (0, 1):
            if len(per[channel]) != len(hands[channel]):
                raise RuntimeError("length mismatch")
            for n, f in zip(hands[channel], per[channel]):
                out[n.idx] = int(f) if channel == 0 else -int(f)
        return out

    pig_dir, pieces, out_dir = resolve_common(args)
    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": args.repo, "variant": args.variant, "tradition": args.tradition,
                     "tempo_nps": 6.0}, skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
