"""Trainer behaviour pinned by the M3 plan's Task 3 tests."""
import numpy as np

from learn.corpus import piece_from_files
from learn.decoder import solve_hand
from learn.features import FAMILY_ORDER, FeatureSet, path_features
from learn.scoring import macro, score_pieces
from learn.trainer import TrainOptions, train
from fingering_eval.pig_io import PigFile, make_note

NAMES = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def midi(name: str) -> int:
    return 12 * (int(name[-1]) + 1) + NAMES[name[:-1]]


def melody(names, fingers, ch=0):
    return PigFile(notes=[make_note(i, i * 0.5, (i + 1) * 0.5, midi(n), ch, (f if ch == 0 else -f) if f else 0)
                          for i, (n, f) in enumerate(zip(names, fingers))])


def piece(pid, files):
    return piece_from_files("pig", pid, files)


FS = FeatureSet(["rules", "colour", "trans"])
SCALE = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"]


def test_one_update_lowers_the_cost_of_the_target_relative_to_the_decoded_path():
    p = piece("t", {"1": melody(SCALE, [1, 2, 3, 4, 5, 1, 2, 3])})  # a non-standard expert
    ex = p.hands["R"]
    t = ex.tensors(FS)
    w0 = FS.parncutt_weights()
    gold = ex.golds[0].astype(np.int64)
    decoded0, _ = solve_hand(t, w0)
    gap0 = w0 @ path_features(t, gold, FS.n) - w0 @ path_features(t, decoded0, FS.n)
    r = train([ex], FS, TrainOptions(epochs=1, C=0.5, rho=1, seed=1, average=False))
    w1 = r.weights
    gap1 = w1 @ path_features(t, gold, FS.n) - w1 @ path_features(t, decoded0, FS.n)
    assert gap1 < gap0
    assert r.epochs[0].updates >= 1


def test_toy_corpus_reaches_100_percent_and_is_deterministic():
    pieces = [
        piece("a", {"1": melody(SCALE, [1, 2, 3, 1, 2, 3, 4, 5])}),
        piece("b", {"1": melody(list(reversed(SCALE)), [5, 4, 3, 2, 1, 3, 2, 1])}),
        piece("c", {"1": melody(["C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4"], [5, 4, 3, 2, 1, 3, 2, 1], 1)}),
        piece("d", {"1": melody(["C4", "E4", "G4", "C5"], [1, 2, 3, 5])}),
    ]
    exs = [ex for p in pieces for ex in p.examples()]
    a = train(exs, FS, TrainOptions(epochs=5, C=0.05, rho=1, seed=7))
    b = train(exs, FS, TrainOptions(epochs=5, C=0.05, rho=1, seed=7))
    assert np.array_equal(a.weights, b.weights)
    m = macro(score_pieces(pieces, a.weights, FS))
    assert m["m_gen"] == 100.0
    for rid in ("stretch", "beyondPractical", "hop"):
        assert a.weights[FS.index[rid]] >= 0


def test_unfingered_notes_contribute_nothing():
    partial = piece("p", {"1": melody(SCALE, [0, 0, 0, 0, 0, 0, 0, 0])})
    assert partial.hands == {}  # an annotation that fingers nothing is dropped
    half = piece("h", {"1": melody(SCALE, [1, 2, 3, 0, 0, 0, 0, 0])})
    ex = half.hands["R"]
    assert ex.fingered() == 3
    r = train([ex], FS, TrainOptions(epochs=2, C=0.5, rho=1, seed=1))
    # the standard fingering already starts 1 2 3: nothing to learn, no update
    assert all(e.updates == 0 for e in r.epochs)
    assert np.array_equal(r.weights, FS.parncutt_weights())
    # a partial gold that contradicts the decode does produce an update, only on fingered notes
    odd = piece("o", {"1": melody(SCALE, [2, 3, 4, 0, 0, 0, 0, 0])}).hands["R"]
    r2 = train([odd], FS, TrainOptions(epochs=1, C=0.5, rho=1, seed=1))
    assert r2.epochs[0].updates == 1
    assert r2.epochs[0].hamming_rate <= 1.0


def test_latent_target_picks_the_closest_annotator():
    p = piece("m", {"1": melody(SCALE, [1, 2, 3, 1, 2, 3, 4, 5]), "2": melody(SCALE, [2, 3, 4, 1, 2, 3, 4, 5])})
    ex = p.hands["R"]
    assert ex.golds.shape == (2, 8)
    # With rho = 0 the Parncutt decode already equals the standard annotation: no update. (With a
    # Hamming margin rho > 0 the augmented decode can still find a cheap wrong path, so the M3
    # plan's "updates === 0" expectation only holds for rho = 0.)
    r = train([ex], FS, TrainOptions(epochs=2, C=0.5, rho=0, seed=1, target="latent"))
    assert r.epochs[0].updates == 0
    r1 = train([ex], FS, TrainOptions(epochs=1, C=0.5, rho=1, seed=1, target="latent"))
    assert r1.epochs[0].updates == 1 and r1.epochs[0].mean_loss <= 1.0 * 8
    assert macro(score_pieces([p], r.weights, FS))["m_high"] == 100.0


def test_validation_selects_the_best_epoch():
    p = piece("v", {"1": melody(SCALE[:5], [1, 2, 3, 4, 5])})
    r = train(p.examples(), FS, TrainOptions(epochs=3, C=0.05, rho=1, seed=1), validation=[p])
    assert [e.epoch for e in r.epochs] == [1, 2, 3]
    assert r.best_epoch >= 1
    best = max(e.validation["m_gen"] for e in r.epochs)
    assert r.epochs[r.best_epoch - 1].validation["m_gen"] == best


def test_full_feature_set_trains_and_projection_keeps_penalties_non_negative():
    full = FeatureSet(FAMILY_ORDER)
    p = piece("f", {"1": melody(SCALE, [1, 2, 3, 4, 5, 1, 2, 3])})
    r = train(p.examples(), full, TrainOptions(epochs=3, C=1.0, rho=2, seed=3, init="zeros", project=True))
    assert (r.weights[full.penalty_mask] >= 0).all()
    r2 = train(p.examples(), full, TrainOptions(epochs=3, C=1.0, rho=2, seed=3, init="zeros", project=False,
                                                variant="perceptron", eta=0.1))
    assert r2.epochs[0].updates >= 1
