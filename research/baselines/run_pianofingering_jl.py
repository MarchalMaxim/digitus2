"""JuliaMusic/PianoFingering.jl (GPL-3.0; Gao et al., "Generating fingerings for piano music
with model-based reinforcement learning", Applied Sciences 2023): per piece and hand, the
note sequence is split into segments, each segment is an MDP (state = current hand
position/fingering, reward from hand-made ergonomic rules) solved with Dyna-Q
(10,000 episodes, multi-threaded over segments); the greedy policy gives the fingering.

Setup (portable Julia 1.10.5 under third_party/_tools, depot inside the repo, PyCall bound
to research/.venv-baselines so the package can import music21 at load time): see README.
The package's PIG reader decides the hand from the *sign of the finger column*, so the
wrapper writes inputs whose finger column is +1 (channel 0) / -1 (channel 1) -- hand only,
no ground truth.  All pieces run in one Julia process (``jl/run_pianofingering.jl``);
per-piece times are measured inside Julia (the first piece also pays JIT compilation).
Output is the package's own PIG writer (``output/<name>_output.txt``), mapped back by line.

    python run_pianofingering_jl.py --pieces test --threads 16
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import (THIRD_PARTY, RunLog, base_arg_parser, input_file, read_pig, resolve_common,  # noqa: E402
                     strike_finger, write_blanked_input, write_pig)

DEFAULT_REPO = THIRD_PARTY / "JuliaMusic__PianoFingering.jl"
JULIA = THIRD_PARTY / "_tools" / "julia-1.10.5" / "bin" / "julia.exe"
DEPOT = THIRD_PARTY / "_tools" / "julia_depot"


def main() -> None:
    ap = base_arg_parser(__doc__, "pianofingering_jl")
    ap.add_argument("--repo", default=str(DEFAULT_REPO))
    ap.add_argument("--julia", default=str(JULIA))
    ap.add_argument("--threads", default="auto")
    ap.add_argument("--work", default=None, help="work dir (default outputs/_pianofingering_jl_work)")
    ap.add_argument("--collect-only", action="store_true", help="only convert existing Julia outputs")
    args = ap.parse_args()
    pig_dir, pieces, out_dir = resolve_common(args)
    work = Path(args.work) if args.work else out_dir.parent / "_pianofingering_jl_work"
    (work / "pig").mkdir(parents=True, exist_ok=True)
    (work / "output").mkdir(parents=True, exist_ok=True)
    names = []
    for pc in pieces:
        inp = input_file(pc, pig_dir)
        name = inp.name[: -len(".txt")]
        write_blanked_input(work / "pig" / f"{name}.txt", read_pig(inp), blank="1", signed=True)
        names.append((pc, inp, name))
    if not args.collect_only:
        env = dict(os.environ, JULIA_DEPOT_PATH=str(DEPOT),
                   PYTHON=str(Path(sys.executable)))
        todo = [n for _, _, n in names if not (args.skip_existing and (work / "output" / f"{n}_output.txt").is_file())]
        if todo:
            cmd = [args.julia, f"--project={args.repo}", "-t", str(args.threads),
                   str(HERE / "jl" / "run_pianofingering.jl")] + todo
            print("running:", " ".join(cmd[:5]), f"... ({len(todo)} pieces)", flush=True)
            subprocess.run(cmd, cwd=str(work), env=env, check=False)
    timings = {}
    tpath = work / "timings.tsv"
    if tpath.is_file():
        for line in tpath.read_text(encoding="utf-8").splitlines():
            parts = line.split("\t")
            if len(parts) >= 3:
                timings[parts[0]] = (float(parts[1]), parts[2])
    log = RunLog(args.name, out_dir, meta={"repo": args.repo, "julia": args.julia, "threads": args.threads,
                                           "note": "seconds measured inside Julia; first piece includes JIT"})
    for pc, inp, name in names:
        notes = read_pig(inp)
        secs, status = timings.get(name, (0.0, "missing"))
        res = work / "output" / f"{name}_output.txt"
        if status == "ok" and res.is_file():
            est = read_pig(res)
            if len(est) != len(notes):
                log.record(pc, secs, "error", n_notes=len(notes), error=f"{len(est)} output rows")
                continue
            fingers = [strike_finger(e.finger) for e in est]
            bad = sum(1 for n, f in zip(notes, fingers) if not 1 <= abs(f) <= 5 or (f < 0) != (n.channel == 1))
            write_pig(out_dir / inp.name, notes, fingers)
            log.record(pc, secs, "ok", n_notes=len(notes), invalid_or_wrong_hand=bad)
        else:
            log.record(pc, secs, "error", n_notes=len(notes), error=status)
    log.save()
    print(f"collected {sum(1 for v in log.pieces.values() if v['status'] == 'ok')}/{len(names)} pieces")


if __name__ == "__main__":
    main()
