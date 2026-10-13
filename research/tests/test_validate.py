from fingering_eval import validate as V
from fingering_eval.pig_io import make_note


def checks_of(anoms):
    return {a.check for a in anoms}


def N(i, t, pitch, ch, f, dur=0.5):
    return make_note(i, t, t + dur, pitch, ch, f)


def test_clean_file_has_no_errors():
    notes = [N(0, 0.0, 60, 0, 1), N(1, 0.5, 62, 0, 2), N(2, 1.0, 64, 0, 3),
             N(3, 0.0, 48, 1, -5), N(4, 0.0, 55, 1, -1)]
    notes.sort(key=lambda n: n.onset)
    notes = [make_note(i, n.onset, n.offset, n.pitch, n.channel, n.finger) for i, n in enumerate(notes)]
    an = V.validate_notes(notes)
    assert not [a for a in an if a.severity == "error"], an


def test_finger_and_hand_checks():
    notes = [N(0, 0.0, 60, 0, "7"), N(1, 0.5, 62, 0, "-2"), N(2, 1.0, 64, 1, "3"), N(3, 1.5, 65, 0, "4_"),
             N(4, 2.0, 67, 0, "abc")]
    c = checks_of(V.validate_notes(notes))
    assert {"finger_irregular", "hand_channel_mismatch", "finger_malformed"} <= c


def test_onset_monotone_and_duration():
    notes = [N(0, 1.0, 60, 0, 1), N(1, 0.5, 62, 0, 2), make_note(2, 2.0, 2.0, 64, 0, 3)]
    c = checks_of(V.validate_notes(notes))
    assert "onset_not_monotone" in c and "nonpositive_duration" in c


def test_same_finger_chord_and_thumb_exception():
    # finger 2 on C4 and G4 at once: impossible
    a = V.validate_notes([N(0, 0, 60, 0, 2), N(1, 0, 67, 0, 2)])
    assert "same_finger_simultaneous" in checks_of(a)
    assert any(x.severity == "error" for x in a if x.check == "same_finger_simultaneous")
    # thumb on two keys a whole tone apart: accepted technique -> info
    b = V.validate_notes([N(0, 0, 69, 0, 1), N(1, 0, 71, 0, 1)])
    assert "thumb_two_keys" in checks_of(b) and "same_finger_simultaneous" not in checks_of(b)


def test_span_and_order():
    a = V.validate_notes([N(0, 0, 48, 0, 1), N(1, 0, 67, 0, 5)])        # 19 semitones
    assert "chord_span_impossible" in checks_of(a)
    b = V.validate_notes([N(0, 0, 60, 0, 1), N(1, 0, 76, 0, 5)])        # 16 semitones
    assert "chord_span_large" in checks_of(b) and "chord_span_impossible" not in checks_of(b)
    c = V.validate_notes([N(0, 0, 60, 0, 3), N(1, 0, 64, 0, 1)])        # RH crossing in a chord
    assert "chord_finger_order" in checks_of(c)
    d = V.validate_notes([N(0, 0, 48, 1, -1), N(1, 0, 55, 1, -5)])      # LH thumb below little finger
    assert "chord_finger_order" in checks_of(d)
    e = V.validate_notes([N(0, 0, 48, 1, -5), N(1, 0, 55, 1, -1)])      # correct LH order
    assert "chord_finger_order" not in checks_of(e)


def test_duplicates_ranges_ids():
    a = V.validate_notes([N(0, 0, 60, 0, 1), N(1, 0, 60, 1, -1)])
    assert "duplicate_note" in checks_of(a)
    b = V.validate_notes([N(0, 0, 30, 0, 1), N(1, 1, 96, 1, -1), N(2, 2, 15, 0, 1)])
    assert {"pitch_range_hand", "pitch_out_of_piano_range"} <= checks_of(b)
    c = V.validate_notes([make_note(0, 0, 1, 60, 0, 1), make_note(2, 1, 2, 62, 0, 2)])
    assert "note_id_sequence" in checks_of(c)


def test_unlabeled_notes_skipped():
    a = V.validate_notes([N(0, 0, 60, 0, "0"), N(1, 0, 64, 0, "0")])
    assert not [x for x in a if x.severity == "error"]


def test_held_finger_reuse_is_info():
    a = V.validate_notes([N(0, 0, 60, 0, 1, dur=2.0), N(1, 0.5, 62, 0, 1)])
    assert any(x.check == "held_key_finger_reuse" and x.severity == "info" for x in a)


def test_cross_annotation_alignment():
    a = [N(0, 0, 60, 0, 1), N(1, 1, 62, 0, 2)]
    b = [N(0, 0, 60, 0, 1), N(1, 1, 63, 1, -2)]
    c = [N(0, 0, 60, 0, 1)]
    an = V.check_annotations_aligned({"1": a, "2": b, "3": c}, "p")
    ch = checks_of(an)
    assert {"pitch_mismatch_across_annotations", "hand_assignment_differs", "note_count_mismatch"} <= ch


def test_stats_and_agreement():
    a = [N(0, 0, 60, 0, 1), N(1, 1, 62, 0, 2), N(2, 2, 64, 0, "3_1")]
    st = V.FingerStats()
    st.add(a)
    d = st.as_dict()
    assert d["n_labeled"] == 3 and d["n_substitutions"] == 1
    assert d["usage_counts"]["R"] == {1: 1, 2: 1, 3: 1}
    assert ("1->2", 1) in d["top_transitions"]["R"]
    agr = V.pairwise_agreement({"1": a, "2": [N(0, 0, 60, 0, 1), N(1, 1, 62, 0, 3), N(2, 2, 64, 0, 3)]})
    assert agr[("1", "2")] == 2 / 3
