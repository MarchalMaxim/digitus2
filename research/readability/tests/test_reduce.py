from readability.corpus import LH, RH, NoteRec
from readability.player_model import HandReader, infer_hand
from readability.reduce import minimal_sufficient


def mk(idx, beat, pitch, finger, hand=RH):
    return NoteRec(idx=idx, onset=beat * 0.6, offset=(beat + 1) * 0.6, pitch=pitch, hand=hand, finger=finger,
                   finger_raw=str(finger), beat=beat, dur_beats=1.0)


def reconstructs(notes, kept, model="rules"):
    res = infer_hand(notes, kept, model)
    return all(res[n.idx][0] == n.finger for n in notes if n.finger > 0)


def test_c_position_needs_only_the_first_digit():
    notes = [mk(i, i, p, f) for i, (p, f) in enumerate(zip([60, 62, 64, 65, 67, 65, 64, 62, 60], [1, 2, 3, 4, 5, 4, 3, 2, 1]))]
    kept, why = minimal_sufficient(HandReader(notes))
    assert kept == {0} and why == {0: "none"}
    assert reconstructs(notes, kept)


def test_scale_keeps_the_thumb_crossing_only():
    # C major RH one octave 1 2 3 1 2 3 4 5: the reader fails at F (needs 1), then continues
    pitches = [60, 62, 64, 65, 67, 69, 71, 72]
    fingers = [1, 2, 3, 1, 2, 3, 4, 5]
    notes = [mk(i, i, p, f) for i, (p, f) in enumerate(zip(pitches, fingers))]
    kept, why = minimal_sufficient(HandReader(notes))
    assert kept == {0, 3} and why[3] == "R2_wrong"
    assert reconstructs(notes, kept)


def test_chord_fill_and_wrong_position_choice():
    # C-E-G chord fingered 1-2-5 (not the default 1-3-5): the E must be printed
    notes = [mk(0, 0, 60, 1), mk(1, 0, 64, 2), mk(2, 0, 67, 5), mk(3, 1, 65, 4)]
    kept, why = minimal_sufficient(HandReader(notes))
    # C is kept (nothing before it), E is kept (chord fill from C says 3); the G is filled from
    # the nearest visible digit (E, 2 + 2 = 4) so it is kept too; F after the chord: R2 from E
    # (2 + 1 = 3) is wrong, so the 4 is kept as well
    assert kept == {0, 1, 2, 3} and why[1] == "R4_wrong" and why[3] == "R2_wrong"
    assert reconstructs(notes, kept)


def test_left_hand_position():
    notes = [mk(i, i, p, f, LH) for i, (p, f) in enumerate(zip([48, 50, 52, 53, 55], [5, 4, 3, 2, 1]))]
    kept, _ = minimal_sufficient(HandReader(notes))
    assert kept == {0}
    assert reconstructs(notes, kept)


def test_repeat_memory_drops_digits_on_the_second_statement():
    from readability.repeats import find_repeats, root_map

    # a phrase C D E F G A (1 2 3 1 2 3) stated twice, then stated again a tone higher with the same fingers
    phrase = [60, 62, 64, 65, 67, 69]
    fingers = [1, 2, 3, 1, 2, 3]
    notes = []
    for rep, shift in enumerate((0, 0, 2)):
        for k, (p, f) in enumerate(zip(phrase, fingers)):
            i = rep * 6 + k
            notes.append(mk(i, i, p + shift, f))
    reader = HandReader(notes)
    kept_plain, _ = minimal_sufficient(reader, "rules")
    root = root_map(len(reader.evs), find_repeats(reader.evs))
    assert root[6] == 0 and root[12] == 0
    kept_rep, why = minimal_sufficient(reader, "rules", root)
    assert kept_plain == {0, 3, 6, 9, 12, 15}          # the thumb crossing has to be printed in every statement
    assert kept_rep == {0, 3}                          # later statements are remembered
    assert reconstructs(notes, kept_plain)


def test_every_kept_digit_is_necessary():
    pitches = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]
    fingers = [1, 2, 3, 1, 2, 3, 4, 5, 4, 3, 2, 1, 3, 2, 1]
    notes = [mk(i, i, p, f) for i, (p, f) in enumerate(zip(pitches, fingers))]
    reader = HandReader(notes)
    kept, _ = minimal_sufficient(reader)
    assert reconstructs(notes, kept)
    for k in kept:
        assert not reconstructs(notes, kept - {k}), f"digit {k} is redundant"
