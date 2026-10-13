#!/usr/bin/env bash
# Reproduce the whole baseline environment from scratch (Git Bash on Windows 11).
#
#   bash research/baselines/setup_baselines.sh            # everything
#   bash research/baselines/setup_baselines.sh python     # only the venv
#   bash research/baselines/setup_baselines.sh clones     # only clones + patches
#   bash research/baselines/setup_baselines.sh build      # only native builds
#   bash research/baselines/setup_baselines.sh julia      # only PianoFingering.jl runtime
#
# Requirements found on the reference machine: Python 3.11.9 (`python`), git, curl, unzip,
# Node.js 22 (`node`), MinGW.org g++ 9.2 in C:/MinGW/bin (no MSVC toolset), rustup/cargo,
# NVIDIA driver with CUDA 12.x for the PyTorch models (CPU also works, slower).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RESEARCH="$(cd "$HERE/.." && pwd)"
TP="$HERE/third_party"
VENV="$RESEARCH/.venv-baselines"
PY="$VENV/Scripts/python.exe"; [ -x "$PY" ] || PY="$VENV/bin/python"
what="${1:-all}"
mkdir -p "$TP" "$HERE/outputs" "$HERE/logs"

clone_at() {  # clone_at <url> <dir> <commit> [sparse patterns...]
  local url="$1" dir="$2" commit="$3"; shift 3
  if [ ! -d "$TP/$dir/.git" ]; then
    if [ "$#" -gt 0 ]; then
      git clone -q --filter=blob:none --no-checkout "$url" "$TP/$dir"
      git -C "$TP/$dir" sparse-checkout init --no-cone
      printf '%s\n' "$@" > "$TP/$dir/.git/info/sparse-checkout"
    else
      git clone -q "$url" "$TP/$dir"
    fi
  fi
  git -C "$TP/$dir" -c advice.detachedHead=false checkout -q "$commit" 2>/dev/null \
    || git -C "$TP/$dir" read-tree -mu "$commit"   # paths invalid on Windows are skipped by sparse rules
  echo "$dir @ $(git -C "$TP/$dir" rev-parse --short HEAD)"
}

apply_patch() {  # apply_patch <dir> <patch>
  if git -C "$TP/$1" apply --check "$HERE/patches/$2" 2>/dev/null; then
    git -C "$TP/$1" apply "$HERE/patches/$2" && echo "patched $1 with $2"
  else
    echo "$2 already applied to $1 (or does not apply)"
  fi
}

if [ "$what" = all ] || [ "$what" = python ]; then
  [ -d "$VENV" ] || python -m venv "$VENV"
  "$PY" -m pip install -q pip==24.2
  "$PY" -m pip install -q torch==2.5.1 --index-url https://download.pytorch.org/whl/cu124
  "$PY" -m pip install -q -r "$HERE/requirements-baselines.txt"
fi

if [ "$what" = all ] || [ "$what" = clones ]; then
  # PIG v1.2 copy (only used when research/data/pig is missing; the official download needs registration)
  if [ ! -d "$RESEARCH/data/pig/FingeringFiles" ] && [ ! -d "$TP/_pig_copy" ]; then
    clone_at https://github.com/lemonadedw/BACHprop.git _pig_mirror_bachprop ec4672194effa90891bc83af4b748f7b7c045051 '/PianoFingeringDataset_v1.2/'
    mkdir -p "$TP/_pig_copy" && cp -r "$TP/_pig_mirror_bachprop/PianoFingeringDataset_v1.2" "$TP/_pig_copy/"
  fi
  clone_at https://github.com/marcomusy/pianoplayer.git                 marcomusy__pianoplayer                 6fb0e2114d7b21f75c0be5208172e1243a57323e
  clone_at https://github.com/PRamoneda/Automatic-Piano-Fingering.git    PRamoneda__Automatic-Piano-Fingering   d0d2f433c926be5e89540cbafe38bf43820ad2d2 '/*' '!/output/' '!/results/'
  clone_at https://github.com/PRamoneda/RL_PianoFingering.git            PRamoneda__RL_PianoFingering           d9a42c3cb0777c54c1b3e2355128479ef97e8e63
  clone_at https://github.com/PRamoneda/APF_eval.git                     PRamoneda__APF_eval                    fcb93c80928a147a7e93b502efd33ae69f1aa613
  clone_at https://github.com/dvdrndlph/pydactyl.git                     dvdrndlph__pydactyl                    0ad656db9b778508453a7275dc698b9129ca765e
  clone_at https://github.com/Kanma/piano_fingering.git                  Kanma__piano_fingering                 88963cad52bb3c16438d69f600830a6d43d923ce
  clone_at https://github.com/JuliaMusic/PianoFingering.jl.git           JuliaMusic__PianoFingering.jl          d16a9d1bac0d4b752a27dce4421ce2c323af61cb
  clone_at https://github.com/TimKoornstra/automatic-piano-fingering.git TimKoornstra__automatic-piano-fingering 88cd37f8fa50cfef4794c97e1dad79e30007d26c
  clone_at https://github.com/thegreatkwanghyeon/autofingering.git       thegreatkwanghyeon__autofingering      b9b7f1081550ac29e6dd677802569cc7d65f979a
  clone_at https://github.com/lumikey/piano-fingering-model.git          lumikey__piano-fingering-model         e03c0da6bfe6b4299dbdacb421bd5792f1721631
  clone_at https://github.com/chrsztz/APF-Gen.git                        chrsztz__APF-Gen                       1078ee6f3a4b44c35c714490cfdcf9756be1e5d2
  clone_at https://github.com/MarcAlKareh/fingerflow.git                 MarcAlKareh__fingerflow                85f89ad39f8ac68c6e732f5c047d22b2190d2f63
  clone_at https://github.com/vibetuned/chirality.git                    vibetuned__chirality                   cd9c54e0dcdfaf0677690f03978cd23ecd90da22
  clone_at https://github.com/V9011N/pygame-piano-animator.git           V9011N__pygame-piano-animator          f8189c021d9235005fb35faa2c8cfbc09a3768a0
  clone_at https://github.com/emanuelemerlo/smart-piano-fingering.git    emanuelemerlo__smart-piano-fingering   15828ee9c85a06f632d9f001456ce2c44cf2d80c
  clone_at https://github.com/huukhangapcs/AutomaticPianoFingering.git   huukhangapcs__AutomaticPianoFingering  2ea024321f320971ac4269ea0e92da6acca17bf2
  clone_at https://github.com/jpsmith8488/valhala-fingering-solver.git   jpsmith8488__valhala-fingering-solver  16735999f071510015bd170ab781f06c30e5f2d4
  clone_at https://github.com/carlosrmz009/OpenNote.git                  carlosrmz009__OpenNote                 ed79e489aff3c766b5b42a0779537cc41c8bdb8e '/*' '!/showcases/' '!/assets/' '!/NOTICE.md'
  clone_at https://github.com/ackyedy/piano-fingering-analysis.git       ackyedy__piano-fingering-analysis      ea6f852c9f7d3453776cf81b7f97b16d02deccb0
  clone_at https://github.com/CHOWMHALVIN/Piano-Fingering-Suggestion-Model-with-Intuitive-UI.git CHOWMHALVIN__PFSM 0aebdd3b29db1f71d2d2708c298b051727363d91 '/*.py' '/*.md' '/*.txt'
  clone_at https://github.com/BShakhovsky/PianoFingering_CalcModule.git  BShakhovsky__PianoFingering_CalcModule 52dd07c81d8e27804cfc15be8be0714e3f9c0dcf
  clone_at https://github.com/anandaphan/EER-piano-fingering.git         anandaphan__EER-piano-fingering        60298201bf2985f41048e68fe6e0e1b657d87027
  clone_at https://github.com/guwalgiya/Piano-Fingering-Generators.git   guwalgiya__Piano-Fingering-Generators  c76831b746d953a77b19d654cc5b2b3736fb1213
  clone_at https://github.com/dlegs/Optimal-Piano-Fingering-Algorithm.git dlegs__Optimal-Piano-Fingering-Algorithm 6832249181d4b652feac4c450b9394ff04ea3407
  clone_at https://github.com/monde-lointain/piano-fingering.git         monde-lointain__piano-fingering        b447d18c2cf1ef5bc88eb21605ad2ee3a971ebbf
  clone_at https://bitbucket.org/mballiauw/piano-fingering-vns.git       mballiauw__piano-fingering-vns         ad84ad89f99b07f114a56697dfcb6aaf958abde1
  mkdir -p "$TP/statpianofingering_js"
  [ -d "$TP/statpianofingering_js/repo/.git" ] || git clone -q https://github.com/statpianofingering/statpianofingering.github.io.git "$TP/statpianofingering_js/repo"
  git -C "$TP/statpianofingering_js/repo" checkout -q 8950a16d7d8b3509e2a39d8e5967fedfa89d61ee
  apply_patch dvdrndlph__pydactyl pydactyl.patch
  apply_patch thegreatkwanghyeon__autofingering autofingering.patch
  apply_patch mballiauw__piano-fingering-vns balliauw_vns.patch
  apply_patch BShakhovsky__PianoFingering_CalcModule bshakhovsky.patch
fi

if [ "$what" = all ] || [ "$what" = build ]; then
  export PATH="/c/MinGW/bin:$PATH:$HOME/.cargo/bin"
  bash "$HERE/build_nakamura_hmm.sh"
  ( cd "$TP/mballiauw__piano-fingering-vns" && mkdir -p bin && g++ -O2 -static -o bin/apf.exe \
      main.cpp Move.cpp Move2.cpp Move3.cpp Move4.cpp Move5.cpp MusicInfo.cpp exportMusicXML.cpp \
      importMusicXML.cpp note.cpp score.cpp xmlParser.cpp )
  B="$TP/BShakhovsky__PianoFingering_CalcModule"
  mkdir -p "$HERE/cpp/bshakhovsky/build"
  g++ -std=c++17 -O2 -static -w -include "$HERE/cpp/bshakhovsky/compat/msvc_compat.h" \
      -I"$HERE/cpp/bshakhovsky/compat" -I"$B" -I"$B/PianoFingering" \
      "$B"/PianoFingering/{ChordFingVariations,CostRules,DistanceTable,HorizontalCost,MonoCosts,NodesLinker,PolyCosts,TrellisGraph_Facade,VerticalCost}.cpp \
      "$HERE/cpp/bshakhovsky/driver.cpp" -o "$HERE/cpp/bshakhovsky/build/bshakhovsky_driver.exe"
  rustup toolchain list | grep -q x86_64-pc-windows-gnu || rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal
  cargo +stable-x86_64-pc-windows-gnu build --release --manifest-path "$HERE/rust/opennote_pig/Cargo.toml"
fi

if [ "$what" = all ] || [ "$what" = julia ]; then
  T="$TP/_tools"; mkdir -p "$T"
  if [ ! -x "$T/julia-1.10.5/bin/julia.exe" ]; then
    curl -sL --fail -o "$T/julia-1.10.5-win64.zip" https://julialang-s3.julialang.org/bin/winnt/x64/1.10/julia-1.10.5-win64.zip
    echo "7b21b30c0a412df7bf2472ff5ee5d47aab5a9b4f184a7595da62eea3f10650b1  $T/julia-1.10.5-win64.zip" | sha256sum -c -
    unzip -q -o "$T/julia-1.10.5-win64.zip" -d "$T"
  fi
  export JULIA_DEPOT_PATH="$T/julia_depot" PYTHON="$PY"
  ( cd "$TP/JuliaMusic__PianoFingering.jl" && "$T/julia-1.10.5/bin/julia.exe" --project=. -e \
      'using Pkg; Pkg.instantiate(); Pkg.build("PyCall"); Pkg.precompile(); using PianoFingering; println("PianoFingering.jl OK")' )
fi
echo "setup done"
