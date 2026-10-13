"""carlosrmz009/OpenNote (PolyForm-Noncommercial-1.0.0, Rust, Oct 2026): fingering engine
combining several published rule sets (Parncutt, Jacobs, Balliauw, Badgerow; default
"consensus" = every rule any set charges for, weighted by how many sets endorse it) with a
biomechanical hand model, Viterbi search and an optional learned n-gram prior.

The learned prior that official builds embed (models/helios-beta1.8.json) is not in the
repository and published models are sealed for official builds only, so only the
rules-only engine can be benchmarked.  ``rust/opennote_pig`` (our 60-line driver crate,
path-dependent on the clone's on-train/on-fingering/on-hand crates) reads each PIG file with
OpenNote's own reader (``on_train::corpus::read``; hand from the channel when the finger
column is 0) and calls ``on_train::eval::solve`` with ``FingeringOptions::for_hand(medium)``
and the chosen rule set -- i.e. what ``opennote bench --model none`` measures.
Build (no MSVC on this machine -> GNU Rust toolchain):
    rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal
    cargo +stable-x86_64-pc-windows-gnu build --release --manifest-path rust/opennote_pig/Cargo.toml

    python run_opennote.py --rules consensus --pieces test
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import base_arg_parser, resolve_common, run_pieces, write_blanked_input  # noqa: E402

DEFAULT_EXE = HERE / "rust" / "opennote_pig" / "target" / "release" / "opennote_pig.exe"


def main() -> None:
    ap = base_arg_parser(__doc__, "opennote")
    ap.add_argument("--exe", default=str(DEFAULT_EXE))
    ap.add_argument("--rules", default="consensus", choices=["consensus", "parncutt", "jacobs", "balliauw", "badgerow"])
    args = ap.parse_args()
    if args.name == "opennote":
        args.name = f"opennote_rules_{args.rules}"
    tmp = Path(tempfile.mkdtemp(prefix="opennote_"))
    solve_secs = {}

    def predict(notes, inp):
        blank = tmp / inp.name
        write_blanked_input(blank, notes, blank="0")  # finger 0 -> OpenNote takes the hand from the channel
        res = tmp / (inp.stem + ".tsv")
        subprocess.run([args.exe, args.rules, str(blank), str(res)], check=True, capture_output=True, text=True)
        lines = res.read_text(encoding="utf-8").splitlines()
        solve_secs[inp.name[:3]] = float(lines[0].split("\t")[1])
        rows = [l.split("\t") for l in lines[1:]]
        # OpenNote sorts notes by (onset, midi) with a stable sort: reproduce it to map back
        order = sorted(range(len(notes)), key=lambda i: (notes[i].onset, notes[i].pitch))
        if len(rows) != len(order):
            raise RuntimeError(f"{len(rows)} rows for {len(notes)} notes")
        out = [None] * len(notes)
        missing = 0
        for i, (onset, midi, f) in zip(order, rows):
            assert int(midi) == notes[i].pitch and abs(float(onset) - notes[i].onset) < 1e-6
            f = int(f)
            if not 1 <= f <= 5:
                missing += 1
                f = 1
            out[i] = f if notes[i].channel == 0 else -f
        if missing:
            print(f"  {inp.name}: {missing} notes without a finger -> 1", file=sys.stderr)
        return out

    pig_dir, pieces, out_dir = resolve_common(args)
    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"exe": args.exe, "rules": args.rules, "prior": "none (rules only)",
                     "solver_seconds_per_piece": solve_secs}, skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
