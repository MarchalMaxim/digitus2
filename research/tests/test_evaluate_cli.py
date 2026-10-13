from fingering_eval import evaluate as E
from fingering_eval.pig_io import make_note, read_pig, write_pig


def _write(dirpath, name, fingers, pitches=(60, 62, 64, 48)):
    notes = [make_note(i, 0.5 * i, 0.5 * i + 0.4, p, 0 if p >= 60 else 1, f)
             for i, (p, f) in enumerate(zip(pitches, fingers))]
    write_pig(dirpath / name, notes)


def test_cli_gold_vs_itself(tmp_path, capsys):
    gold = tmp_path / "gold"
    gold.mkdir()
    _write(gold, "p01-1_fingering.txt", [1, 2, 3, -5])
    _write(gold, "p01-2_fingering.txt", [1, 3, 4, -5])
    rc = E.main(["--gold", str(gold), "--pred", str(gold), "--pred-annotation", "1", "--gold-annotations", "1"])
    out = capsys.readouterr().out
    assert rc == 0 and "100.00" in out
    rc = E.main(["--gold", str(gold), "--pred", str(gold / "p01-2_fingering.txt"), "--json", str(tmp_path / "r.json")])
    out = capsys.readouterr().out
    assert rc == 0
    import json
    agg = json.loads((tmp_path / "r.json").read_text())["aggregate"]
    # vs {ann1, ann2}: M_gen = (2/4 + 4/4)/2, M_high = 1
    assert abs(agg["macro_m_gen"] - 0.75) < 1e-9 and agg["macro_m_high"] == 1.0


def test_cli_masks_unlabeled_gold(tmp_path, capsys):
    gold = tmp_path / "gold"
    gold.mkdir()
    _write(gold, "p02-0_fingering.txt", [1, "0", 3, "0"])
    pred = tmp_path / "pred"
    pred.mkdir()
    _write(pred, "p02_fingering.txt", [1, 5, 2, -1])
    E.main(["--gold", str(gold), "--pred", str(pred), "--json", str(tmp_path / "r.json")])
    import json
    d = json.loads((tmp_path / "r.json").read_text())
    assert d["pieces"][0]["n_notes"] == 2 and d["aggregate"]["macro_m_gen"] == 0.5


def test_cli_reports_mismatch(tmp_path, capsys):
    gold = tmp_path / "gold"
    gold.mkdir()
    _write(gold, "p03-1_fingering.txt", [1, 2, 3, -5])
    pred = tmp_path / "pred"
    pred.mkdir()
    _write(pred, "p03_fingering.txt", [1, 2, 3], pitches=(60, 62, 64))
    rc = E.main(["--gold", str(gold), "--pred", str(pred)])
    out = capsys.readouterr().out
    assert rc == 1 and "problem" in out


def test_align_to_gold_reorders_chords(tmp_path):
    gold = [make_note(0, 0, 1, 60, 0, 1), make_note(1, 0, 1, 64, 0, 3)]
    pred = [make_note(0, 0, 1, 64, 0, 4), make_note(1, 0, 1, 60, 0, 2)]
    al = E.align_to_gold(pred, gold)
    assert [n.pitch for n in al] == [60, 64] and [n.finger for n in al] == ["2", "4"]
    assert E.align_to_gold(pred[:1], gold) is None
