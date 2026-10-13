#!/usr/bin/env python
"""Write research/data/splits/pig_official.json (PIG train/test splits with provenance).

Run from the project root:  research/.venv/Scripts/python.exe -I research/scripts/make_pig_splits.py
Requires research/data/pig (and research/data/ramoneda for the ArGNN split).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

RESEARCH = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RESEARCH))

from fingering_eval.pig_io import list_pig_files, pig_ids, read_pig_list_csv  # noqa: E402

DATA = RESEARCH / "data"


def main() -> int:
    files = [p.name for p in list_pig_files(DATA / "pig")]
    if len(files) != 309:
        print(f"expected 309 PIG files, found {len(files)}", file=sys.stderr)
        return 1
    meta = read_pig_list_csv(DATA / "pig")
    test = sorted(f for f in files if int(pig_ids(f)[0]) <= 30)
    train = sorted(f for f in files if int(pig_ids(f)[0]) > 30)

    out = {
        "dataset": "PIG Dataset v1.2 (Nakamura, Saito & Yoshii; README.pdf dated 2022/5/12)",
        "file_naming": "<piece>-<annotation slot>_fingering.txt; annotator initials per slot in List.csv",
        "default_split": "nakamura2020",
        "splits": {
            "nakamura2020": {
                "provenance": (
                    "E. Nakamura, Y. Saito, K. Yoshii, 'Statistical learning and estimation of piano fingering', "
                    "Information Sciences 517 (2020) 68-85, arXiv:1904.10237, Sec. 6.1: 'We used the miscellaneous "
                    "subset for training and used the three composer-specific subsets for testing. In the testing "
                    "stage, we used the musical notes in the upper and lower staves as the RH and LH parts, "
                    "respectively.' Table 2: 'The match rates are averaged over the 30 pieces in the test data.'"),
                "verification": (
                    "Using the authors' published HMM outputs (statpianofingering.github.io Result_FHMM1-3.zip) "
                    "against these test files, fingering_eval.metrics (mode='official') reproduces every entry "
                    "of Table 2 for 1st/2nd/3rd-order HMM and the Human row to the printed precision."),
                "test": {"pieces": sorted({pig_ids(f)[0] for f in test}), "files": test,
                         "description": "composer-specific subsets: Bach 001-010 (4 fingerings each), Mozart "
                                        "011-020 (6 each), Chopin 021-030 (5 each) = 150 fingerings"},
                "train": {"pieces": sorted({pig_ids(f)[0] for f in train}), "files": train,
                          "description": "miscellaneous subset 031-150 = 159 fingerings (no validation set is "
                                         "defined by the paper)"},
            },
        },
        "annotators": {p: m["annotators"] for p, m in meta.items()},
    }

    ram = DATA / "ramoneda" / "official_split.json"
    if ram.exists():
        r = json.loads(ram.read_text(encoding="utf-8"))
        missing = sorted(set(test) - set(r["test"]))
        out["splits"]["ramoneda2022"] = {
            "provenance": (
                "P. Ramoneda, D. Jeong, E. Nakamura, X. Serra, M. Miron, 'Automatic Piano Fingering from Partially "
                "Annotated Scores using Autoregressive Neural Networks', ACM Multimedia 2022 (ArGNN/ArLSTM). File "
                "PianoFingeringDataset_v1.02/official_split.json in https://github.com/PRamoneda/Automatic-Piano-"
                "Fingering at commit d0d2f433c926be5e89540cbafe38bf43820ad2d2 (MIT)."),
            "notes": (
                f"train+val = the 159 miscellaneous-subset files (130 train / 29 val, val is one annotation of 29 "
                f"pieces); test = 130 of the 150 composer-subset files: the {len(missing)} annotations by annotator "
                f"'EF' (Mozart slot 7, Chopin slot 3) are omitted (reason undocumented). 'test_input' lists 30 "
                f"'<piece>-0' input files that are not part of PIG."),
            "train": {"files": sorted(r["train"])},
            "val": {"files": sorted(r["val"])},
            "test": {"files": sorted(r["test"])},
            "test_omitted_vs_nakamura2020": missing,
        }
    out["splits_not_obtainable"] = {
        "moryossef2019_srivatsan2022": (
            "Srivatsan & Berg-Kirkpatrick, 'Checklist Models for Improved Output Fluency in Piano Fingering "
            "Prediction' (ISMIR 2022) state they 'use alternate splits created by [Moryossef et al. 2019] which "
            "increase the relative size of the train and validation sets'. Neither paper publishes the file "
            "lists and the referenced code (github.com/AmitMY/piano-fingering-extraction) is gone (HTTP 404). "
            "Moryossef et al. 2023 (arXiv:2303.03745) instead keep Nakamura's split and move one (unnamed) "
            "training piece to a development set."),
    }
    dst = DATA / "splits" / "pig_official.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"wrote {dst} (test {len(test)} files / 30 pieces, train {len(train)} files / 120 pieces)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
