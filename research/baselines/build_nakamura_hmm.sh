#!/usr/bin/env bash
# Download and build Nakamura, Saito & Yoshii (2020) fingering HMM programs.
#
# Sources: https://statpianofingering.github.io/data/SourceCode_v190921.zip
# (companion page of "Statistical Learning and Estimation of Piano Fingering",
# arXiv:1904.10237).  The zip has no license file => all rights reserved:
# use for benchmarking only, do not copy into the MIT code base.
#
# Needs a C++11 compiler.  On this Windows machine: MinGW.org g++ 9.2.0 at
# C:/MinGW/bin (no MSVC toolset installed).  -static avoids needing the MinGW
# runtime DLLs on PATH.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HERE/third_party/nakamura_hmm"
CXX="${CXX:-g++}"
if ! command -v "$CXX" >/dev/null 2>&1 && [ -x /c/MinGW/bin/g++.exe ]; then
  export PATH="/c/MinGW/bin:$PATH"
fi
mkdir -p "$DEST/_downloads"
cd "$DEST/_downloads"
for f in SourceCode_v190921.zip Result_FHMM1.zip Result_FHMM2.zip Result_FHMM3.zip; do
  [ -f "$f" ] || curl -sL --fail -o "$f" "https://statpianofingering.github.io/data/$f"
done
sha256sum -c - <<'SUMS'
e2c15638794a71ab8e4aed0ffaa89d38bf86b56f6c64c602b54531673eeaf26c  SourceCode_v190921.zip
3b9f12bb27edef90afd76bc8c01f12bfd1fddea76167553a17ab586e944c66f0  Result_FHMM1.zip
ce51388805378578d32c1eac25a94867c922348571bb274f7e9117f9bf8bd780  Result_FHMM2.zip
9c3121c5ae6c8a66a3950c96c75c053b5c5b170316903eb3088b5d32ff590a26  Result_FHMM3.zip
SUMS
cd "$DEST"
unzip -q -o _downloads/SourceCode_v190921.zip -d .
for i in 1 2 3; do unzip -q -o "_downloads/Result_FHMM$i.zip" -d results_released; done
rm -rf __MACOSX results_released/__MACOSX
cd SourceCode
mkdir -p Binary
build() { "$CXX" -O2 -static "./Code/$1.cpp" -o "./Binary/$2.exe"; echo "built $2"; }
build FingeringHMM1_Train_v190308 FingeringHMM1_Train
build FingeringHMM1_Run_v181122   FingeringHMM1_Run
build FingeringHMM2_Train_v190308 FingeringHMM2_Train
build FingeringHMM2_Run_v181125   FingeringHMM2_Run
build FingeringHMM3_Train_v190308 FingeringHMM3_Train
build FingeringHMM3_Run_v181125   FingeringHMM3_Run
build CHMM_Train_v190320          CHMM_Train
build CHMM_Run_v190321            CHMM_Run
build Evaluate_SimpleMatchRate    Evaluate_SimpleMatchRate
build Evaluate_MultipleGroundTruth Evaluate_MultipleGroundTruth
