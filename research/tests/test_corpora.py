"""Integration checks on the derived / secondary corpora (skipped when not built/downloaded)."""
import json

import pytest

from conftest import DATA
from fingering_eval.datasets import load_beringer, load_mutopia, load_pianovam, split_files


def test_official_split_file():
    sp = json.loads((DATA / "splits" / "pig_official.json").read_text(encoding="utf-8"))
    test = sp["splits"]["nakamura2020"]["test"]["files"]
    train = sp["splits"]["nakamura2020"]["train"]["files"]
    assert len(test) == 150 and len(train) == 159 and not set(test) & set(train)
    assert split_files("test") == set(test)
    if "ramoneda2022" in sp["splits"]:
        r = sp["splits"]["ramoneda2022"]
        assert len(r["test"]["files"]) == 130 and len(r["test_omitted_vs_nakamura2020"]) == 20


@pytest.mark.skipif(not (DATA / "pianovam" / "Fingering_GT").is_dir(), reason="PianoVAM not downloaded")
def test_pianovam_auto_vs_manual_matches_published_accuracy():
    gt, auto = load_pianovam(which="Fingering_GT"), load_pianovam(which="Fingering")
    tot = lab = ok = 0
    for k, a in gt.items():
        g = a["0"].notes
        au = auto[k]["0"].notes[:len(g)]
        assert [n.pitch for n in g] == [n.pitch for n in au]
        tot += len(g)
        lab += sum(n.finger != "0" for n in au)
        ok += sum(x.finger == y.finger for x, y in zip(g, au) if y.finger != "0")
    # PianoVAM v1.2 README: 1,800 notes, 88.2% labelled, 95.7% of labelled correct
    assert tot == 1800 and round(lab / tot, 3) == 0.882 and round(ok / lab, 3) == 0.957


@pytest.mark.skipif(not (DATA / "beringer_fingering" / "FingeringFiles").is_dir(), reason="Beringer not converted")
def test_beringer_corpus():
    ds = load_beringer()
    assert len(ds) == 84 and sum(len(a) for a in ds.values()) == 128
    c_major = ds["ScalesCMajor"]["1"].notes
    rh = [n.finger for n in c_major if n.channel == 0][:15]
    assert rh[:8] == ["1", "2", "3", "1", "2", "3", "4", "1"]  # the C major scale fingering


@pytest.mark.skipif(not (DATA / "mutopia_fingering" / "manifest.json").exists(), reason="Mutopia not built")
def test_mutopia_manifest_consistent_with_files():
    rows = json.loads((DATA / "mutopia_fingering" / "manifest.json").read_text(encoding="utf-8"))
    ds = load_mutopia()
    assert {r["piece_id"] for r in rows} == set(ds)
    for r in rows[:50]:
        notes = ds[r["piece_id"]]["0"].notes
        assert len(notes) == r["n_notes"]
        assert sum(n.finger != "0" for n in notes) == r["n_fingered"]
        assert r["status"] in ("ok", "suspect") and r["license"]
