# Piano-fingering baselines

Every open-source piano-fingering implementation we could find, set up, run on the PIG
dataset and scored with the same metrics. Write-up and results:
[`docs/research/baselines.md`](../../docs/research/baselines.md). Machine-readable results:
[`results.json`](results.json) (scores + metadata), [`results_table.md`](results_table.md),
[`results_per_piece_test.csv`](results_per_piece_test.csv) and `results_per_piece_all.csv`.

## Layout

| Path | What |
|---|---|
| `run_<name>.py` | one wrapper per implementation: reads PIG files (finger column never reaches the third-party code), writes PIG files with predicted fingers to `outputs/<name>/`, plus `run_log.json` (per-piece runtime, failures, settings) |
| `train_lumikey_pig.py`, `train_apfgen_official.py` | retrain two models whose released weights saw the test pieces, on the official training split |
| `_common.py` | PIG I/O, split loading (`research/data/splits/pig_official.json`), run bookkeeping |
| `_pig_metrics.py` | fallback port of Nakamura's C++ evaluator (only used if `research/fingering_eval` is missing) |
| `score_baselines.py` | scores `outputs/*` with `research/fingering_eval` (M_gen, M_high, M_soft, M_rec; macro over pieces + micro over notes), optional cross-check against the original C++ `Evaluate_MultipleGroundTruth` |
| `make_report.py` | merges `registry.json` (metadata: approach, license, training data, notes) into `results.json`, writes `results_table.md` |
| `setup_baselines.sh` | reproduces everything from scratch (venv, clones at pinned commits, patches, native builds, Julia) |
| `run_all_baselines.sh` | runs every wrapper and the scorer |
| `patches/` | the only source changes made to third-party code (see below) |
| `cpp/bshakhovsky/`, `rust/opennote_pig/`, `js/`, `jl/` | small drivers/shims we wrote to call non-Python implementations |
| `third_party/` (git-ignored) | clones, downloads, PIG fallback copy, portable Julia |
| `outputs/` (git-ignored) | predictions, retrained checkpoints, work dirs |

## Setup from scratch (Windows 11, Git Bash)

Prerequisites present on the reference machine: Python 3.11.9 as `python`, git, curl, unzip,
Node.js 22, MinGW.org g++ 9.2 in `C:/MinGW/bin` (no MSVC toolset is installed), rustup/cargo,
NVIDIA GPU with a CUDA 12.x driver (optional; everything also runs on CPU).

```bash
cd <repo root>
bash research/baselines/setup_baselines.sh          # all steps below
```

which runs, in order:

1. **Python venv** `research/.venv-baselines` (Python 3.11.9):
   ```bash
   python -m venv research/.venv-baselines
   research/.venv-baselines/Scripts/python.exe -m pip install pip==24.2
   research/.venv-baselines/Scripts/python.exe -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cu124
   research/.venv-baselines/Scripts/python.exe -m pip install -r research/baselines/requirements-baselines.txt
   ```
   (`requirements-baselines.lock.txt` is the full `pip freeze`.) numpy is pinned to 1.26
   because the ArGNN code uses `np.compat`; torch to 2.5.1 because the ArGNN checkpoints
   pickle an `nn.Module` and need `weights_only=False`.
2. **Clones** at the commits listed in `setup_baselines.sh` / `registry.json` into
   `research/baselines/third_party/<owner>__<repo>`. Two need sparse checkouts:
   PRamoneda/Automatic-Piano-Fingering (file names containing `:` are invalid on Windows:
   `output/`, `results/` excluded) and carlosrmz009/OpenNote (1.4 GB of videos excluded).
   Nakamura's HMM sources come from `statpianofingering.github.io/data/SourceCode_v190921.zip`
   (sha256-checked in `build_nakamura_hmm.sh`).
3. **Patches** (`git apply` in the clone):
   * `patches/pydactyl.patch` -- log file in the OS temp dir with a unique name (was
     `/tmp/...<timestamp with ':'>`), and a typo that made the Balliauw rule set crash
     (`handed_finger_*` -> `handed_digit_*`);
   * `patches/autofingering.patch` -- `DataFrame.append` -> `pd.concat` (pandas 2);
   * `patches/balliauw_vns.patch` -- `-seed N` option for reproducible runs;
   * `patches/bshakhovsky.patch` -- three MSVC-only constructs (`136i16` literal,
     `virtual ~X() = 0 {}`, `#pragma comment(lib)`), plus a force-included
     `cpp/bshakhovsky/compat/msvc_compat.h` (`#define abstract`) and a 5-line
     `boost::noncopyable` stand-in (no Boost needed).
   Runtime shims (no source change): `python-magic` is replaced by an empty module for
   pydactyl; pianoplayer's PIG reader gets the key positions it forgets to set (see doc).
4. **Native builds** (`PATH=/c/MinGW/bin:$PATH`):
   * `bash research/baselines/build_nakamura_hmm.sh` -- FHMM1/2/3, CHMM, evaluators
     (`g++ -O2 -static`);
   * Balliauw VNS: `g++ -O2 -static -o bin/apf.exe *.cpp` in its clone;
   * BShakhovsky module + our driver: the `g++ -std=c++17 ... -include msvc_compat.h`
     line in `setup_baselines.sh`;
   * OpenNote driver: `rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal`
     then `cargo +stable-x86_64-pc-windows-gnu build --release --manifest-path research/baselines/rust/opennote_pig/Cargo.toml`
     (the default MSVC Rust toolchain cannot link without Visual C++ build tools).
5. **Julia** for PianoFingering.jl: portable Julia 1.10.5 (official zip, sha256-checked) in
   `third_party/_tools`, depot in `third_party/_tools/julia_depot`, `PYTHON` pointing at the
   venv so PyCall imports music21; `Pkg.instantiate(); Pkg.build("PyCall")`.

PIG v1.2 is read from `research/data/pig/FingeringFiles` (datasets agent). If that is missing,
`setup_baselines.sh` copies the v1.2 folder of a GitHub mirror (lemonadedw/BACHprop, pinned) to
`third_party/_pig_copy`; the official download requires a registration form. PIG is for
nonprofit academic use only.

## Running and scoring

```bash
cd research/baselines
bash run_all_baselines.sh                     # official test split (30 pieces)
PIECES=all bash run_all_baselines.sh          # all 150 pieces
../.venv-baselines/Scripts/python.exe score_baselines.py --crosscheck-cpp
../.venv-baselines/Scripts/python.exe make_report.py
```

Single implementation, e.g. `../.venv-baselines/Scripts/python.exe run_fingerflow.py --variant learned --pieces test`.
Every wrapper takes `--pieces test|train|val|all|1-30|001,005`, `--pig-dir`, `--split`,
`--out-dir`, `--name`, `--skip-existing`.

Input convention (identical for all wrappers, and the same as Nakamura's released results):
for piece `NNN` the notes and the hand (channel) assignment of the lowest-numbered annotator
file `NNN-1_fingering.txt` are the input; the finger column is blanked (or reduced to the
hand sign for programs that read the hand from it) before any third-party code sees it.
Scores are against **all** annotator files of the piece.

Split: `research/data/splits/pig_official.json` (`nakamura2020`: test = pieces 001-030, the
Bach/Mozart/Chopin sets, 150 fingering files; train = 031-150). The two models that need a
validation set use its `ramoneda2022` variant (same test pieces; 100 train / 29 val pieces of
031-150, 9 pieces appear in both).

## Long jobs and their cost on the reference machine (RTX 4080 SUPER, 16 logical cores)

| Job | Time |
|---|---|
| `train_lumikey_pig.py` (both hands, CPU) | ~45 min |
| `train_apfgen_official.py` (GPU, early stop at epoch 17) | ~15 min |
| fingerflow / chirality training on first use | < 1 min |
| pianoplayer, test split | ~10 min (19 s/piece) |
| PianoFingering.jl, test split (12 threads) | ~8 min (+ JIT) |
| Balliauw VNS | 10 s - 12 min per piece (stopped after 12 pieces, see doc) |
| EER (per-piece DQN) | ~28 s/episode -> ~8 h per piece at the default 500 episodes x 2 hands (not completed) |
