"""Nakamura, Saito & Yoshii (2020) fingering HMMs (1st/2nd/3rd order, chord HMM).

Runs the original C++ binaries built by ``build_nakamura_hmm.sh`` with the
parameters shipped in SourceCode_v190921.zip (trained on the PIG
"miscellaneous" set = pieces 031-150, i.e. the official training split) and
the hyper-parameters from the original run_*.sh scripts.

    python run_nakamura_hmm.py --model fhmm1            # official test split
    python run_nakamura_hmm.py --model all --pieces all
    python run_nakamura_hmm.py --model fhmm2 --retrain  # retrain on split train+val first

Output: outputs/nakamura_<model>/<piece>-1_fingering.txt
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (THIRD_PARTY, OUTPUTS, base_arg_parser, gt_files, load_split, read_pig,  # noqa: E402
                     resolve_common, run_pieces, strike_finger, write_blanked_input)

SRC = THIRD_PARTY / "nakamura_hmm" / "SourceCode"

# (binary, param file, hyper-parameters) exactly as in run_FHMM*.sh / run_CHMM.sh
MODELS = {
    "fhmm1": ("FingeringHMM1_Run", "param_FHMM1.txt", ["0.964", "-5"], "FingeringHMM1_Train"),
    "fhmm2": ("FingeringHMM2_Run", "param_FHMM2.txt", ["0.556", "0.407", "0.474", "-5"], "FingeringHMM2_Train"),
    "fhmm3": ("FingeringHMM3_Run", "param_FHMM3.txt", ["0.448", "0.292", "0.194", "0.470", "0.504", "-5"],
              "FingeringHMM3_Train"),
    "chmm": ("CHMM_Run", "param_CHMM1.txt", ["0.94", "4.70", "7.53", "5.29", "0.10"], "CHMM_Train"),
}


def exe(name: str, src: Path) -> Path:
    for cand in (src / "Binary" / f"{name}.exe", src / "Binary" / name):
        if cand.is_file():
            return cand
    raise FileNotFoundError(f"{name} not built; run build_nakamura_hmm.sh first")


def retrain(model: str, src: Path, pieces: list[str], pig_dir: Path, work: Path) -> Path:
    """Train a parameter file on all annotator files of ``pieces`` (original Train binary)."""
    _, _, _, train_bin = MODELS[model]
    work.mkdir(parents=True, exist_ok=True)
    names = [p.name[: -len("_fingering.txt")] for pc in pieces for p in gt_files(pc, pig_dir)]
    lst = work / "list_train.txt"
    lst.write_text("\n".join(names) + "\n", encoding="utf-8")
    prefix = work / f"param_{model}_retrained"
    cmd = [str(exe(train_bin, src))]
    if model == "chmm":
        cmd.append(str(src / "Code" / "ChordFinergingTemplates.txt"))
    cmd += [str(lst), str(pig_dir), str(prefix)]
    print("training:", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=str(work), stdout=subprocess.DEVNULL)
    return Path(str(prefix) + ".txt")


def main() -> None:
    ap = base_arg_parser(__doc__, "nakamura_fhmm1")
    ap.add_argument("--model", default="fhmm1", choices=list(MODELS) + ["all"])
    ap.add_argument("--source-dir", default=str(SRC))
    ap.add_argument("--retrain", action="store_true",
                    help="retrain parameters on the split's train+val pieces instead of the shipped ones")
    args = ap.parse_args()
    src = Path(args.source_dir)
    models = list(MODELS) if args.model == "all" else [args.model]
    for model in models:
        suffix = "_retrained" if args.retrain else ""
        args.name = f"nakamura_{model}{suffix}"
        args.out_dir = None
        pig_dir, pieces, out_dir = resolve_common(args)
        run_bin, param_name, hyper, _ = MODELS[model]
        param = src / "Code" / param_name
        if args.retrain:
            split = load_split(args.split)
            param = retrain(model, src, sorted(set(split["train"]) | set(split["val"])), pig_dir,
                            out_dir / "_train")
        binary = exe(run_bin, src)
        tmp = Path(tempfile.mkdtemp(prefix=f"nakamura_{model}_"))

        def predict(notes, inp: Path, _b=binary, _p=param, _h=hyper, _model=model):
            blank_in = tmp / inp.name
            # GT fingers never reach the binary; the sign carries the hand (HMM2/3 read it).
            write_blanked_input(blank_in, notes, blank="1", signed=True)
            out = tmp / ("out_" + inp.name)
            cmd = [str(_b)]
            if _model == "chmm":
                cmd.append(str(src / "Code" / "ChordFinergingTemplates.txt"))
            cmd += [str(_p), str(blank_in), str(out)] + list(_h)
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            est = read_pig(out)
            assert len(est) == len(notes), "note count changed"
            return [strike_finger(n.finger) for n in est]

        run_pieces(args.name, pieces, pig_dir, out_dir, predict,
                   meta={"model": model, "binary": str(binary), "param": str(param), "hyper": hyper,
                         "source": "https://statpianofingering.github.io/data/SourceCode_v190921.zip"},
                   skip_existing=args.skip_existing)


if __name__ == "__main__":
    main()
