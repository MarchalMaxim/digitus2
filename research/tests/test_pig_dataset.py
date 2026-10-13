"""Integration tests on the real PIG v1.2 data (skipped if it has not been downloaded).

Download first:  research/.venv/Scripts/python.exe -I research/scripts/download_datasets.py pig pig_hmm
"""
import pytest

from conftest import DATA
from fingering_eval import metrics as M
from fingering_eval.datasets import load_pig
from fingering_eval.pig_io import read_pig

pig_present = (DATA / "pig" / "FingeringFiles").is_dir()
hmm_present = (DATA / "pig_hmm" / "Result_FHMM1").is_dir()
needs_pig = pytest.mark.skipif(not pig_present, reason="PIG not downloaded")
needs_hmm = pytest.mark.skipif(not (pig_present and hmm_present), reason="PIG HMM outputs not downloaded")


@needs_pig
def test_pig_counts():
    ds = load_pig(DATA / "pig")
    assert len(ds) == 150
    assert sum(len(a) for a in ds.values()) == 309
    assert sum(len(f) for a in ds.values() for f in a.values()) == 100040
    test = load_pig(DATA / "pig", split="test")
    assert len(test) == 30 and sum(len(a) for a in test.values()) == 150


# Table 2 of Nakamura, Saito & Yoshii (2020): M_gen, M_high, M_soft, M_rec (%)
TABLE2 = {"Result_FHMM1": (61.7, 68.3, 82.8, 74.0),
          "Result_FHMM2": (64.3, 70.8, 85.3, 77.6),
          "Result_FHMM3": (64.5, 71.0, 85.5, 77.8)}
HUMAN = (71.4, 79.1, 90.8, 84.3)


@needs_hmm
@pytest.mark.parametrize("model", sorted(TABLE2))
def test_reproduce_table2_hmm(model):
    gold = load_pig(DATA / "pig", split="test")
    scores = []
    for piece, anns in gold.items():
        est = read_pig(DATA / "pig_hmm" / model / f"{piece}-1_fingering.txt")
        scores.append(M.evaluate_piece([a for _, a in sorted(anns.items())], est, piece, mode="official"))
    agg = M.aggregate(scores)
    got = [100 * agg[f"macro_{m}"] for m in M.METRIC_NAMES]
    # the paper prints one decimal: every value must round to the printed number
    assert all(abs(g - t) <= 0.05 + 1e-9 for g, t in zip(got, TABLE2[model])), (got, TABLE2[model])


@needs_pig
def test_reproduce_table2_human():
    gold = load_pig(DATA / "pig", split="test")
    per_piece = []
    for piece, anns in gold.items():
        loo = M.leave_one_out({k: v.notes for k, v in anns.items()}, piece, mode="official")
        per_piece.append([sum(getattr(s, m) for s in loo) / len(loo) for m in M.METRIC_NAMES])
    got = [100 * sum(x[i] for x in per_piece) / len(per_piece) for i in range(4)]
    assert all(abs(g - t) <= 0.05 + 1e-9 for g, t in zip(got, HUMAN)), (got, HUMAN)
