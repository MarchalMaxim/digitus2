"""The Viterbi port against brute force, including +Infinity entries and tie-breaking."""
import numpy as np

from learn.decoder import INF, brute_force, viterbi


def random_problem(rng, n, p_inf=0.1, integer=True):
    cu = rng.integers(0, 4, size=(n, 5)).astype(float)
    cp = rng.integers(0, 4, size=(n, 5, 5)).astype(float)
    ct = rng.integers(0, 3, size=(n, 5, 5, 5)).astype(float)
    if not integer:
        cu += rng.random(cu.shape)
    cu[rng.random(cu.shape) < p_inf] = INF
    cp[rng.random(cp.shape) < p_inf] = INF
    ct[rng.random(ct.shape) < p_inf / 2] = INF
    cp[0] = 0
    ct[:2] = 0
    return cu, cp, ct


def test_matches_brute_force_with_ties_and_infinities():
    rng = np.random.default_rng(3)
    for trial in range(60):
        n = int(rng.integers(1, 7))
        cu, cp, ct = random_problem(rng, n, p_inf=0.15 if trial % 2 else 0.0, integer=True)
        f, c = viterbi(cu, cp, ct)
        bf, bc = brute_force(cu, cp, ct)
        assert c == bc, (trial, c, bc)
        if np.isfinite(bc):
            assert (f == bf).all(), (trial, f, bf)


def test_all_infinite_returns_infinite_cost():
    cu = np.full((3, 5), INF)
    cp = np.zeros((3, 5, 5))
    ct = np.zeros((3, 5, 5, 5))
    f, c = viterbi(cu, cp, ct)
    assert c == INF and len(f) == 3


def test_single_note_and_empty():
    f, c = viterbi(np.array([[3.0, 1.0, 2.0, 1.0, 5.0]]), np.zeros((1, 5, 5)), np.zeros((1, 5, 5, 5)))
    assert f.tolist() == [1] and c == 1.0
    f, c = viterbi(np.zeros((0, 5)), np.zeros((0, 5, 5)), np.zeros((0, 5, 5, 5)))
    assert len(f) == 0 and c == 0.0
