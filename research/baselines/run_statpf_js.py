"""JavaScript FHMM1 from Nakamura's web demo (https://statpianofingering.github.io/demo.html).

``FingeringEstimator.html`` ships a browser port of the 1st-order fingering HMM
(``myfunctions.js``: class FHMM1, parameters embedded in the source, w1 = 1 instead of the
0.964 used by run_FHMM1.sh) plus a hand-separation HMM for MIDI input (not used here: PIG
gives the hands).  ``js/statpf_fhmm1.cjs`` loads the demo's scripts unmodified in Node.js
(v22 here) and runs ``FHMM1.ViterbiTwoHands`` on each piece; this wrapper writes a blanked
copy of every input first.  Runtime includes Node start-up (one process per piece).

    python run_statpf_js.py --pieces test
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import (THIRD_PARTY, base_arg_parser, read_pig, resolve_common, run_pieces,  # noqa: E402
                     strike_finger, write_blanked_input)

DEFAULT_REPO = THIRD_PARTY / "statpianofingering_js" / "repo"


def main() -> None:
    ap = base_arg_parser(__doc__, "nakamura_fhmm1_webdemo_js")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--node", default=shutil.which("node") or "node")
    args = ap.parse_args()
    tmp = Path(tempfile.mkdtemp(prefix="statpf_js_"))
    runner = HERE / "js" / "statpf_fhmm1.cjs"

    def predict(notes, inp):
        blank = tmp / inp.name
        out = tmp / ("out_" + inp.name)
        write_blanked_input(blank, notes, blank="0")
        subprocess.run([args.node, str(runner), args.repo, str(blank), str(out)], check=True,
                       capture_output=True, text=True)
        est = read_pig(out)
        assert len(est) == len(notes)
        return [strike_finger(n.finger) for n in est]

    pig_dir, pieces, out_dir = resolve_common(args)
    ver = subprocess.run([args.node, "--version"], capture_output=True, text=True).stdout.strip()
    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": args.repo, "node": ver, "runner": str(runner)},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
