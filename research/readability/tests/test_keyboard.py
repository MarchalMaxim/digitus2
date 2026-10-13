import pytest

from readability import keyboard as K


def test_x14_and_columns():
    assert K.x14(60) == 70            # C4
    assert K.x14(61) == 71            # C#4 (odd = black)
    assert K.x14(64) == 74            # E4
    assert K.x14(65) == 76            # F4 skips the imaginary black key
    assert K.x14(72) == 84            # C5 = C4 + 14
    assert K.column(60) == 35.0
    assert K.column(61) == 35.5
    assert K.white_column(61) == 35   # black key shares the column of the white key below
    assert [K.is_black(p) for p in range(60, 72)] == [False, True, False, True, False, False, True, False, True, False, True, False]


def test_anchor_rh_and_lh():
    # RH thumb on C4: anchor is C4's column whatever the finger used higher up in the position
    assert K.anchor(60, 1, K.RH) == 35.0
    assert K.anchor(64, 3, K.RH) == 35.0          # E4 with finger 3
    assert K.anchor(67, 5, K.RH) == 35.0          # G4 with finger 5
    # LH mirrored: thumb on G4, finger 5 on C4
    assert K.anchor(67, 1, K.LH) == K.anchor(60, 5, K.LH) == 39.0
    assert K.finger_from_anchor(64, 35.0, K.RH) == 3.0
    assert K.finger_from_anchor(62, 39.0, K.LH) == 4.0  # D4 under a LH position with thumb on G4
    with pytest.raises(ValueError):
        K.anchor(60, 0, K.RH)


def test_white_distance():
    assert K.white_distance(60, 64) == 2.0
    assert K.white_distance(60, 61) == 0.5
    assert K.white_distance(64, 65) == 1.0
