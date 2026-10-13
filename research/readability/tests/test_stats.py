from readability import stats
from readability.corpus import LH, RH, NoteRec, Part
from readability.features import compute_features


def mk(idx, beat, pitch, hand=RH, finger=0):
    return NoteRec(idx=idx, onset=beat * 0.6, offset=(beat + 1) * 0.6, pitch=pitch, hand=hand, finger=finger,
                   finger_raw=str(finger), beat=beat, dur_beats=1.0, bar=0, bar_pos=beat, bar_len=4.0)


def test_quantiles_and_density_tables():
    q = stats.quantiles([0.1, 0.2, 0.3, 0.4])
    assert q["n"] == 4 and q["median"] == 0.25 and q["min"] == 0.1 and q["max"] == 0.4
    p1 = Part(id="a", source="mutopia", composer="DiabelliA", title="t", level_group="teaching", level=None,
              license="PD", notes=[mk(0, 0, 60, RH, 1), mk(1, 1, 62), mk(2, 0, 48, LH, 5), mk(3, 1, 50, LH)])
    p2 = Part(id="b", source="mutopia", composer="ClementiM", title="t", level_group="teaching", level=None,
              license="PD", notes=[mk(0, 0, 60, RH, 1), mk(1, 1, 62, RH, 2)])
    d = stats.density_tables([p1, p2])
    g = d["by_group"]["teaching"]
    assert g["parts"] == 2 and g["notes"] == 6 and g["printed"] == 4 and g["density_note_weighted"] == round(4 / 6, 4)
    assert g["part_density"]["min"] == 0.5 and g["part_density"]["max"] == 1.0
    assert d["by_group"]["teaching_excl_clementi"]["parts"] == 1
    assert d["by_hand"]["teaching/L"] == {"notes": 2, "printed": 1, "density": 0.5}
    assert d["by_composer"]["ClementiM"]["density_note_weighted"] == 1.0


def test_print_rate_by_context_and_printed_contexts():
    p = Part(id="a", source="mutopia", composer="DiabelliA", title="t", level_group="teaching", level=None,
             license="PD", notes=[mk(0, 0, 60, RH, 1), mk(1, 1, 62, RH, 2), mk(2, 2, 64), mk(3, 3, 65, RH, 4)])
    rows = compute_features(p)
    ctx = stats.print_rate_by_context(rows)
    first = [r for r in ctx if r["context"] == "first_of_hand" and r["value"] == 1][0]
    assert first["teaching_printed"] == 1 and first["teaching_notes"] == 1 and first["teaching_rate"] == 100.0
    assert first["teaching_lift"] == round(1.0 / 0.75, 2)
    pc = stats.printed_contexts(rows)["teaching"]
    assert pc["printed"] == 3 and pc["printed_with_printed_previous_event"] == 1   # only D after C
    assert pc["isolated_digits"]["n"] == 2       # the C (first) and the F (after an unprinted E)
    assert pc["events_since_previous_digit"]["hist"] == {"1": 1, "2": 1}
