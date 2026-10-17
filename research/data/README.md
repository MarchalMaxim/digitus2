# research/data — piano-fingering ground truth for digitus2

Everything in this folder is either **downloaded** by `research/scripts/download_datasets.py`
(pinned commits / hashes, safe to re-run and to run concurrently) or **derived** from those
downloads by the build scripts. Only small, redistributable files are committed (see
`.gitignore`); everything else is recreated with the commands below.

Full analysis and verdicts: [`docs/research/datasets.md`](../../docs/research/datasets.md).

## Recreate everything

```bash
# from the project root (Windows paths shown; use bin/python on Linux/macOS)
python -m venv research/.venv
research/.venv/Scripts/python.exe -m pip install -r research/requirements.txt
research/.venv/Scripts/python.exe -I research/scripts/download_datasets.py          # all default sources
research/.venv/Scripts/python.exe -I research/scripts/make_pig_splits.py            # splits/pig_official.json
research/.venv/Scripts/python.exe -I research/scripts/make_pig_validation.py        # splits/pig_validation.json
research/.venv/Scripts/python.exe -I research/scripts/build_mutopia_fingering.py    # mutopia_fingering/
research/.venv/Scripts/python.exe -I -m learn.make_mutopia_split                    # splits/mutopia_split.json (needs mutopia_fingering/manifest.json)
research/.venv/Scripts/python.exe -I research/scripts/crosscheck_mutopia_midi.py    # + MIDI check (downloads Mutopia MIDI)
research/.venv/Scripts/python.exe -I research/scripts/convert_pydactyl_beringer.py  # beringer_fingering/
research/.venv/Scripts/python.exe -I research/scripts/validate_datasets.py          # reports/*_validation.json, *_anomalies.csv
research/.venv/Scripts/python.exe -I research/scripts/crosscheck_official_eval.py   # reports/official_eval_crosscheck.json
research/.venv/Scripts/python.exe -I research/scripts/compare_mutopia_pig_overlap.py
research/.venv/Scripts/python.exe -I research/scripts/check_music21_corpus.py
# optional, 1.9 GB download: research/.venv/Scripts/python.exe -I research/scripts/download_datasets.py pdmx_fingered
#   then research/.venv/Scripts/python.exe -I research/scripts/convert_pdmx_sample.py --n 150
```

`research/.venv` contains a `digitus2_research.pth` file that puts `research/` on `sys.path`, so
`python -I -m fingering_eval.evaluate ...` works from anywhere with the venv interpreter. Without
it use `PYTHONPATH=research` (bash) or `$env:PYTHONPATH='research'` (PowerShell).

`download_datasets.py --list` shows every source, `--verify` checks the extracted folders against
their manifests.

## What is where

| Path | Content | Source / provenance | Licence | Committed? |
|---|---|---|---|---|
| `pig/` | PIG Dataset **v1.2** (2022/5/12): `FingeringFiles/` (309 files), `ScorePDF/` (150), `List.csv/.pdf`, `README.pdf` | Official page <https://beam.kisarazu.ac.jp/research/PianoFingeringDataset/> requires a registration form, so the files come from a public GitHub copy: `CHOWMHALVIN/Piano-Fingering-Suggestion-Model-with-Intuitive-UI@0aebdd3b` (fallback `lemonadedw/BACHprop@ec467219`). All 463 files are byte-identical (git blob SHA-1) across the two; the 309 fingering files also match `chrsztz/xlpro-model` and `HACkerrr121/KeyGenius`. Hashes in `manifests/pig_v1.2_files.json`. | "**Only nonprofit, academic use is allowed.**" and "Upon the use of PIG Dataset, we kindly ask every user to explicitly cite/mention the following paper" (Nakamura, Saito, Yoshii, *Statistical Learning and Estimation of Piano Fingering*, Information Sciences 517:68-85, 2020), per the dataset web page and README.pdf | no (no redistribution) |
| `pig_hmm/` | Authors' C++ source (`SourceCode_v190921.zip`: HMM1/2/3, chord HMM, training, `Evaluate_SimpleMatchRate`, `Evaluate_MultipleGroundTruth`) and published HMM outputs on the 30 test pieces (`Result_FHMM1-3`) | <https://statpianofingering.github.io/demo.html> (sha256 pinned in `manifests/archives.json`) | no licence stated; used locally to verify our metrics only | no |
| `ramoneda/` | `official_split.json` of ArGNN/ArLSTM (ACM MM 2022) | `PRamoneda/Automatic-Piano-Fingering@d0d2f433` | MIT (Copyright (c) 2022 Pedro Ramoneda) | no |
| `splits/pig_official.json` | PIG train/test splits with provenance: `nakamura2020` (official; test = 30 composer-subset pieces 001-030 / 150 files, train = 120 miscellaneous pieces 031-150 / 159 files) and `ramoneda2022` (train/val/test file lists) | `scripts/make_pig_splits.py` | ours | **yes** |
| `splits/pig_validation.json` | The 20 validation pieces, drawn from the `nakamura2020` train pieces with a fixed seed (20261013); the PIG test pieces are never in it | `scripts/make_pig_validation.py` | ours | **yes** |
| `splits/mutopia_split.json` | 70/30 split of the Mutopia pieces by Mutopia piece id (seed 20261013) | `learn/make_mutopia_split.py` | ours | **yes** |
| `mutopia_src/` | LilyPond sources of the 827 keyboard pieces of the Mutopia Project | `MutopiaProject/MutopiaProject@2144afd6` (`ftp/` tree, filtered by `mutopiainstrument`) | per piece: Public Domain, CC BY 2.5/3.0/4.0, CC BY-SA 2.5/3.0/4.0 (in each `\header`) | no |
| `mutopia_fingering/` | **Our editorial-fingering corpus**: `FingeringFiles/<piece>-0_fingering.txt` in PIG format (finger `0` = no fingering printed), `manifest.csv/json` (one row per two-hand part: composer, title, Mutopia id + URL, licence, note/fingering counts, parse checks, MIDI recall, status), `failures.csv`, `summary.json` | built by `scripts/build_mutopia_fingering.py` + `scripts/crosscheck_mutopia_midi.py` | each file inherits its piece's licence (attribution: Mutopia Project + typesetter, URL in the manifest; CC BY-SA files are share-alike) | manifest/summary/failures **yes**; FingeringFiles no (regenerated) |
| `mutopia_midi/` | Mutopia piece-info pages, MIDI files and (for mismatches) the website's own `.ly` sources | <https://www.mutopiaproject.org/ftp/...> | as above | no |
| `pydactyl/` | `data/corpora/` of D. Randolph's pydactyl (abcD transcriptions of Beringer & Dunhill 1900 scales, arpeggios, broken chords; unfingered WTC abc files) | `dvdrndlph/pydactyl@0ad656db` | MIT (Copyright (c) 2014-2018 David A. Randolph); the 1900 fingerings are public domain | no |
| `beringer_fingering/` | PIG-format conversion of the abcD fingerings (`<Exercise>-<n>_fingering.txt`, n = abcD fingering number, 1 = Beringer's main fingering, 2+ = his alternatives), `manifest.csv`, `summary.json` | `scripts/convert_pydactyl_beringer.py` | as pydactyl | manifest/summary **yes** |
| `pianovam/` | PianoVAM v1.2 `Fingering/` (automatic per-note labels, 106 recordings), `Fingering_GT/` (manual, 1,800 notes), `TSV/`, `metadata.json`, `README.md` (no audio/video) | HF `PianoVAM/PianoVAM_v1@1f039ab9` | CC BY-NC-SA 4.0 | no |
| `pdmx_fingered/` (opt-in) | MuseScore public-domain MusicXML (PDMX) filtered to the 978 keyboard scores containing `<fingering>` (`mxl/`, `fingered_keyboard_index.json`), `PDMX.csv`, and `sample_pig/` (150-score sample converted by `scripts/convert_pdmx_sample.py`) | Zenodo 10.5281/zenodo.15571083 (md5 pinned) | CC BY 4.0 (dataset); scores published as public domain / CC0 on MuseScore | no |
| `reports/` | validation summaries and anomaly lists for every corpus, official-tool cross-check, Mutopia MIDI cross-check, Mutopia-vs-PIG comparison, music21 corpus survey | our scripts | ours | **yes** |
| `manifests/` | per-file hashes (sha256 + git blob SHA-1) of every extracted source; pinned archive hashes | written on first download, verified afterwards (`download_datasets.py --verify`) | ours | **yes** |
| `_downloads/`, `.locks/`, `_build/` | archive cache, lock files, compiled official evaluation tool, complete anomaly dumps (`_build/reports/*_anomalies_full.csv`) | — | — | no |

Tracked files stay under 1 MB. An anomaly list that would exceed 900 KB (the PianoVAM automatic
labels) is committed as errors and warnings only, capped at 300 rows per check; the per-check
counts in `*_validation.json` are always complete.

## Why most data is not committed

* PIG's licence permits only non-profit academic *use* and asks users to obtain it from the
  authors; we must not redistribute it (digitus2 is MIT-licensed and public).
* The authors' C++ code carries no licence; PianoVAM is NC-SA; Mutopia pieces are partly
  share-alike. Keeping derived note files out of the repository avoids mixing licences; the
  build scripts regenerate them deterministically from pinned sources.
* Size (PDMX alone is 1.9 GB).

## File format of every `*_fingering.txt` here

PIG format (see `fingering_eval/pig_io.py`): `//` header lines, then one note per line:
`id onset offset spelled_pitch onset_velocity offset_velocity channel finger` with channel
0 = right hand, 1 = left hand, fingers 1..5 (RH) / -1..-5 (LH), substitutions `3_1`, and in our
derived corpora `0` = finger not given (partial annotation). Loaders:
`fingering_eval.datasets.load_pig / load_mutopia / load_beringer / load_pianovam`.
