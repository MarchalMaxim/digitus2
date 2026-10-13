"""Tests for readability.predictor (synthetic rows, no corpus needed)."""
import math

import numpy as np
import pytest

from readability.predictor import (FEATURE_NAMES, build_matrix, density_threshold, make_folds, make_logistic,
                                   make_tree, metrics, overlapping_mutopia_parts, rule_predict, target)


def base_row(**kw):
    r = {"part_id": "p0", "source": "mutopia", "level_group": "teaching", "printed": 0,
         "first_of_hand": 0, "first_of_piece": 0, "after_rest": 0, "after_rest_beat": 0, "gap_beats": 0.0,
         "after_long_note": 0, "prev_dur_beats": 1.0, "leap_abs": 2, "leap_bin": "step", "direction": 1,
         "black": 0, "prev_black": 0, "is_chord": 0, "chord_outer": 0, "chord_pos": "single", "chord_size": 1,
         "repeated": 0, "in_run": 0, "run_len": 0, "run_pos": "none", "notes_per_sec": 3.0, "dur_beats": 1.0,
         "downbeat": 0, "on_beat": 1, "hand": "R", "grace": 0, "rel_pos": 0.5}
    r.update(kw)
    return r


def col(X, names, name):
    return X[:, names.index(name)]


def test_matrix_one_hot_columns_present():
    X, names = build_matrix([base_row(), base_row(leap_bin="over_octave", chord_pos="top", run_pos="start")])
    assert names == FEATURE_NAMES and X.shape == (2, len(names))
    for c in ("leap_bin=none", "leap_bin=repeat", "leap_bin=step", "leap_bin=third", "leap_bin=fourth_fifth",
              "leap_bin=sixth_octave", "leap_bin=over_octave", "chord_pos=single", "chord_pos=bottom",
              "chord_pos=inner", "chord_pos=top", "run_pos=none", "run_pos=start", "run_pos=mid", "run_pos=end"):
        assert c in names
    assert col(X, names, "leap_bin=step").tolist() == [1, 0]
    assert col(X, names, "leap_bin=over_octave").tolist() == [0, 1]
    assert col(X, names, "chord_pos=top").tolist() == [0, 1]
    assert col(X, names, "run_pos=start").tolist() == [0, 1]
    # each one-hot group sums to one per row
    for prefix in ("leap_bin=", "chord_pos=", "run_pos="):
        idx = [k for k, n in enumerate(names) if n.startswith(prefix)]
        assert X[:, idx].sum(axis=1).tolist() == [1, 1]
    for leaky in ("prev_printed", "prev_finger", "anchor", "since_printed", "until_printed", "crossing"):
        assert not any(n.startswith(leaky) for n in names)


def test_matrix_clipping_and_none_handling():
    r = base_row(gap_beats=20.0, prev_dur_beats=None, leap_abs=30, chord_size=9, run_len=20, notes_per_sec=31.0,
                 dur_beats=12.0, prev_black=None, hand="L", rel_pos=1.0)
    r2 = base_row(gap_beats=None, leap_abs=None, leap_bin="none", first_of_hand=1, gap_beats_extra=1,
                  dur_beats=-1.0)
    X, names = build_matrix([r, r2])
    assert col(X, names, "gap_beats").tolist() == [8.0, 0.0]
    assert col(X, names, "prev_dur_beats").tolist() == [0.0, 1.0]
    assert col(X, names, "leap_abs").tolist() == [24.0, 0.0]
    assert col(X, names, "chord_size").tolist() == [6.0, 1.0]
    assert col(X, names, "run_len").tolist() == [16.0, 0.0]
    assert col(X, names, "notes_per_sec").tolist() == [16.0, 3.0]
    assert col(X, names, "dur_beats").tolist() == [8.0, 0.0]
    assert col(X, names, "prev_black").tolist() == [0.0, 0.0]
    assert col(X, names, "hand_R").tolist() == [0.0, 1.0]
    assert col(X, names, "first_of_hand").tolist() == [0.0, 1.0]
    assert not np.isnan(X).any()


def test_rule_predictor():
    rows = [
        base_row(),                                     # nothing fires
        base_row(first_of_hand=1, leap_abs=None),       # first note of the hand
        base_row(after_rest_beat=1),
        base_row(leap_abs=5),
        base_row(leap_abs=4),                           # below the leap threshold
        base_row(chord_outer=1, is_chord=1, chord_pos="top"),
        base_row(run_pos="start", in_run=1),
        base_row(run_pos="mid", in_run=1),
        base_row(after_long_note=1),
    ]
    assert rule_predict(rows, "rule_spec").tolist() == [0, 1, 1, 1, 0, 1, 1, 0, 0]
    assert rule_predict(rows, "rule_spec_plus_after_long_note").tolist() == [0, 1, 1, 1, 0, 1, 1, 0, 1]
    assert rule_predict(rows, "rule_spec_minus_chord_outer").tolist() == [0, 1, 1, 1, 0, 0, 1, 0, 0]


def test_density_threshold():
    s = np.array([0.9, 0.8, 0.7, 0.6, 0.5])
    t = density_threshold(s, 0.4)
    assert t == 0.8 and np.mean(s >= t) == 0.4
    assert density_threshold(s, 0.0) == math.inf
    assert np.mean(s >= density_threshold(s, 1.0)) == 1.0
    # ties: four scores of 0.5 and one of 0.9; a target of 2 of 5 is closer to 1 (t=0.9) than to 5 (t=0.5)
    tied = np.array([0.5, 0.5, 0.9, 0.5, 0.5])
    assert density_threshold(tied, 0.4) == 0.9
    assert density_threshold(tied, 0.8) == 0.5
    # unsorted input, larger vector
    rng = np.random.default_rng(1)
    v = rng.random(1000)
    t = density_threshold(v, 0.23)
    assert abs(np.mean(v >= t) - 0.23) < 1e-9


def test_folds_are_grouped_and_deterministic():
    pids = [f"p{k % 37}" for k in range(1000)]
    f1 = make_folds(pids)
    f2 = make_folds(pids)
    assert (f1 == f2).all() and set(f1.tolist()) == {0, 1, 2, 3, 4}
    by_part = {}
    for p, f in zip(pids, f1):
        by_part.setdefault(p, set()).add(int(f))
    assert all(len(v) == 1 for v in by_part.values())


def synthetic_rows(n, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for k in range(n):
        leap = int(rng.integers(0, 15))
        first = int(rng.random() < 0.05)
        rest = int(rng.random() < 0.1)
        p_print = 0.05 + 0.6 * (leap >= 5) + 0.3 * first + 0.2 * rest
        rows.append(base_row(part_id=f"p{k % 20}", leap_abs=leap, leap_bin="step" if leap <= 2 else "fourth_fifth",
                             first_of_hand=first, after_rest_beat=rest, after_rest=rest,
                             notes_per_sec=float(rng.random() * 10), hand="R" if rng.random() < 0.5 else "L",
                             printed=int(rng.random() < min(p_print, 0.95))))
    return rows


def test_logistic_and_tree_smoke():
    rows = synthetic_rows(400)
    X, names = build_matrix(rows)
    y = target(rows)
    lr = make_logistic().fit(X, y)
    s = lr.predict_proba(X)[:, 1]
    m = metrics(y, s, (s >= density_threshold(s, y.mean())).astype(int))
    assert m["auc"] > 0.65
    assert m["density_matched"]["pred_density"] == pytest.approx(y.mean(), abs=0.01)
    coef = dict(zip(names, lr[-1].coef_[0]))
    assert coef["leap_abs"] > 0
    tree = make_tree().fit(X, y)          # min_samples_leaf=200 -> at most two leaves on 400 rows
    assert tree.get_n_leaves() <= 2


def test_metrics_binary_and_degenerate():
    y = np.array([1, 0, 1, 0])
    pred = np.array([1, 0, 0, 0])
    m = metrics(y, pred)
    assert m["at_0_5"]["precision"] == 1.0 and m["at_0_5"]["recall"] == 0.5
    assert m["auc"] == 0.75
    m0 = metrics(np.array([0, 0]), np.array([0.1, 0.2]))
    assert m0["auc"] is None and m0["at_0_5"]["precision"] is None


def test_overlap_matching():
    manifest = [
        {"piece_id": "A", "composer": "BurgmullerJFF", "title": "La Candeur", "opus": "Opus 100."},
        {"piece_id": "B", "composer": "SchumannR", "title": "Album pour la jeunesse - 1.Mélodie ", "opus": "O 68 n°1"},
        {"piece_id": "C", "composer": "CzernyC", "title": "50 Melodische Übungsstücke, No. 1", "opus": "Op. 840"},
        {"piece_id": "D", "composer": "MozartWA", "title": "Sonata Facile - First movement", "opus": "K 545"},
        {"piece_id": "E", "composer": "MozartWA", "title": "Sonata Facile - Second movement", "opus": "K 545"},
        {"piece_id": "F", "composer": "BeethovenLv", "title": "Sonata No. 14 “Moonlight” (1st Movement: Adagio sostenuto)",
         "opus": "Op. 27, No. 2"},
        {"piece_id": "G", "composer": "BeethovenLv", "title": "Sonata No. 14 “Moonlight” (3rd Movement: Presto agitato)",
         "opus": ""},
        {"piece_id": "H", "composer": "ChopinFF", "title": "Walzer h-moll", "opus": "Op. 69, No. 2"},
        {"piece_id": "I", "composer": "ChopinFF", "title": "Walzer As-dur", "opus": "Op. 69, No. 1"},
    ]
    out = overlapping_mutopia_parts(manifest, {r["piece_id"] for r in manifest})
    assert out["burgmuller-op100-no1-la-candeur"] == ["A"]
    assert out["schumann-op68-no1-melody"] == ["B"]
    assert out["mozart-sonata-k545-mvt1"] == ["D"]
    assert out["beethoven-moonlight-sonata-mvt1"] == ["F"]
    assert out["chopin-waltz-op69-no2"] == ["H"]
    assert out["burgmuller-op100-no2-arabesque"] == []
