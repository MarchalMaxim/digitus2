"""MuseScore 4 plugin "Smart Piano Fingering" (emanuelemerlo/smart-piano-fingering, GPL-3.0,
v1.1.0, Oct 2026) - a QML/JavaScript port and extension of pianoplayer's hand model (chord
and multi-voice handling, held-note constraints, an exact DP search when possible).

``js/smart_piano_fingering.cjs`` slices ``createSmartPianoFingeringCore`` out of the .qml file
and runs it in Node.js exactly like the repository's tests/run-tests.js (MuseScore itself is
not needed).  The plugin works in quarter-note beats; PIG gives seconds, so we assume
120 bpm (beat = 0.5 s; ``--beat-seconds``).  Hand = PIG channel; hand size "M" (plugin
default); same-pitch unisons at one onset get the primary note's finger (the plugin leaves
them unfingered).

    python run_smart_piano_fingering.py --pieces test
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import THIRD_PARTY, base_arg_parser, resolve_common, run_pieces  # noqa: E402

DEFAULT_REPO = THIRD_PARTY / "emanuelemerlo__smart-piano-fingering"


def main() -> None:
    ap = base_arg_parser(__doc__, "smart_piano_fingering_musescore")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--node", default=shutil.which("node") or "node")
    ap.add_argument("--beat-seconds", type=float, default=0.5)
    ap.add_argument("--hand-size", default="M")
    args = ap.parse_args()
    qml = Path(args.repo) / "smart-piano-fingering.qml"
    runner = HERE / "js" / "smart_piano_fingering.cjs"
    tmp = Path(tempfile.mkdtemp(prefix="spf_"))

    def predict(notes, inp):
        jin, jout = tmp / (inp.stem + ".in.json"), tmp / (inp.stem + ".out.json")
        jin.write_text(json.dumps({"beat_seconds": args.beat_seconds, "notes": [
            {"id": n.idx, "pitch": n.pitch, "onset": n.onset, "offset": n.offset, "channel": n.channel}
            for n in notes]}), encoding="utf-8")
        subprocess.run([args.node, str(runner), str(qml), str(jin), str(jout), args.hand_size],
                       check=True, capture_output=True, text=True)
        f = json.loads(jout.read_text(encoding="utf-8"))["fingers"]
        out = [f.get(str(n.idx)) for n in notes]
        if any(x is None or not 1 <= abs(int(x)) <= 5 for x in out):
            raise RuntimeError("missing or invalid finger in plugin output")
        return [int(x) for x in out]

    pig_dir, pieces, out_dir = resolve_common(args)
    run_pieces(args.name, pieces, pig_dir, out_dir, predict,
               meta={"repo": args.repo, "beat_seconds": args.beat_seconds, "hand_size": args.hand_size},
               skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
