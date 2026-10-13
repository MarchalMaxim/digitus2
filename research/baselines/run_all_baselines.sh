#!/usr/bin/env bash
# Run every working baseline and score it (after setup_baselines.sh).
#   bash research/baselines/run_all_baselines.sh          # official test split (001-030)
#   PIECES=all bash research/baselines/run_all_baselines.sh   # all 150 pieces where cheap
# Long jobs (minutes to hours) are marked; run them in the background if needed.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
PY="$HERE/../.venv-baselines/Scripts/python.exe"; [ -x "$PY" ] || PY="$HERE/../.venv-baselines/bin/python"
P="${PIECES:-test}"
run() { echo "== $*"; "$PY" -W ignore "$@" --pieces "$P" | tail -1; }

# --- statistical / learned models -------------------------------------------------------
run run_nakamura_hmm.py --model all                    # C++ FHMM1/2/3 + CHMM (seconds)
run run_statpf_js.py                                    # FHMM1 of the web demo, Node.js
run run_autofingering.py                                # Python HMM, trains on 031-150 (seconds)
run run_ackyedy.py --model H1
run run_ackyedy.py --model H2
run run_ackyedy.py --model B0
run run_ackyedy.py --model B1
run run_chowmhalvin.py
run run_ramoneda_ar.py --model ArGNN
run run_ramoneda_ar.py --model ArGNN --beam 10
run run_ramoneda_ar.py --model ArLSTM
run run_ramoneda_ar.py --model ArLSTM --beam 10
run run_fingerflow.py --variant default
run run_fingerflow.py --variant learned                # trains ~30 s on first use
run run_chirality.py --variant uniform
run run_chirality.py --variant learned                 # trains ~1 min on first use
run run_lumikey.py                                      # CONTAMINATED (trained on all PIG)
[ -f outputs/_lumikey_retrained/checkpoints/fingering_transformer_left.pt ] || "$PY" train_lumikey_pig.py   # ~40 min CPU
run run_lumikey.py --checkpoint-dir outputs/_lumikey_retrained/checkpoints --name lumikey_retrained_pigtrain
run run_apfgen.py                                       # CONTAMINATED (random file split)
run run_apfgen.py --no-beam --name apfgen_pretrained_nobeam
[ -f outputs/_apfgen_retrained/outputs/checkpoints/best.pt ] || "$PY" -W ignore train_apfgen_official.py  # ~20 min GPU
run run_apfgen.py --checkpoint outputs/_apfgen_retrained/outputs/checkpoints/best.pt --name apfgen_retrained_official
run run_apfgen.py --checkpoint outputs/_apfgen_retrained/outputs/checkpoints/best.pt --no-beam --name apfgen_retrained_official_nobeam

# --- rule / cost based -----------------------------------------------------------------
run run_kanma.py
for m in parncutt jacobs badgerow balliauw hart random; do run run_pydactyl.py --model $m; done
run run_handthesia.py
run run_smart_piano_fingering.py
run run_bshakhovsky.py
for r in consensus parncutt jacobs; do run run_opennote.py --rules $r; done
run run_huukhang.py --pipeline simple
run run_huukhang.py --pipeline phrase
run run_valhala.py --variant bilateral
run run_valhala.py --variant mirrored
run run_pianoplayer.py --chord-stagger 0.05             # ~15 s/piece
run run_pianoplayer.py --name pianoplayer_pigreader_nostagger   # upstream PIG reader (+x fix)

# --- search / RL (slow) --------------------------------------------------------------------
run run_timkoornstra.py                                 # per-piece tabular Q-learning, ~2 s/piece
run run_pianofingering_jl.py --threads auto             # Julia Dyna-Q, ~15 s/piece (4 pieces crash)
run run_balliauw_vns.py --timeout 1800                  # C++ VNS, 10 s - 12 min per piece

# --- scoring -------------------------------------------------------------------------------
"$PY" score_baselines.py --split-name "$P" --crosscheck-cpp
"$PY" make_report.py
