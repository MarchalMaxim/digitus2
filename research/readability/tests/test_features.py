from readability import corpus, features
from readability.corpus import LH, RH, NoteRec, Part


def mk(idx, beat, dur, pitch, hand=RH, finger=0):
    return NoteRec(idx=idx, onset=beat * 0.6, offset=(beat + dur) * 0.6, pitch=pitch, hand=hand,
                   finger=finger, finger_raw=str(finger), beat=beat, dur_beats=dur,
                   bar=int(beat // 4), bar_pos=beat % 4, bar_len=4.0)


def part(notes, pid="t"):
    return Part(id=pid, source="test", composer="x", title="t", level_group="teaching", level=None,
                license="PD", notes=notes)


def rows_by_idx(p):
    return {r["idx"]: r for r in features.compute_features(p)}


def test_first_notes_and_rests():
    # RH: C4 D4 E4 | rest of 2 beats | F4 ; LH: single long C3 then rest then E3
    notes = [mk(0, 0, 1, 60, RH, 1), mk(1, 1, 1, 62), mk(2, 2, 1, 64), mk(3, 5, 1, 65),
             mk(4, 0, 2, 48, LH, 5), mk(5, 2.5, 1, 52, LH)]
    r = rows_by_idx(part(notes))
    assert r[0]["first_of_piece"] == 1 and r[0]["first_of_hand"] == 1 and r[0]["leap_bin"] == "none"
    assert r[4]["first_of_piece"] == 1 and r[4]["first_of_hand"] == 1
    assert r[1]["first_of_hand"] == 0 and r[1]["leap_bin"] == "step" and r[1]["interval"] == 2
    assert r[3]["gap_beats"] == 2.0 and r[3]["after_rest"] == 1 and r[3]["after_rest_beat"] == 1
    assert r[1]["after_rest"] == 0 and r[1]["gap_beats"] == 0.0
    assert r[5]["gap_beats"] == 0.5 and r[5]["after_rest"] == 1 and r[5]["after_rest_beat"] == 0
    assert r[5]["prev_dur_beats"] == 2.0 and r[5]["after_long_note"] == 0   # a rest intervenes
    assert r[1]["prev_printed"] == 1 and r[1]["prev_finger"] == 1
    assert r[1]["since_printed"] == 1 and r[2]["since_printed"] == 2


def test_long_note_then_note():
    notes = [mk(0, 0, 2, 60), mk(1, 2, 1, 67)]
    r = rows_by_idx(part(notes))
    assert r[1]["after_long_note"] == 1 and r[1]["leap_bin"] == "fourth_fifth" and r[1]["leap_abs"] == 7


def test_chords_and_repeats():
    # C-E-G chord then the same chord again, then a single G
    notes = [mk(0, 0, 1, 60), mk(1, 0, 1, 64), mk(2, 0, 1, 67), mk(3, 1, 1, 60), mk(4, 1, 1, 64),
             mk(5, 1, 1, 67), mk(6, 2, 1, 67)]
    r = rows_by_idx(part(notes))
    assert r[0]["chord_pos"] == "bottom" and r[1]["chord_pos"] == "inner" and r[2]["chord_pos"] == "top"
    assert r[0]["chord_outer"] == 1 and r[1]["chord_outer"] == 0 and r[0]["chord_size"] == 3
    assert r[3]["repeated"] == 1 and r[3]["leap_bin"] == "repeat"
    assert r[6]["repeated"] == 1 and r[6]["chord_pos"] == "single" and r[6]["is_chord"] == 0


def test_stepwise_runs():
    # C D E F G (5-note run up) then a leap, then A G F (3 notes: not a run)
    pitches = [60, 62, 64, 65, 67, 72, 69, 67, 65]
    notes = [mk(i, i, 1, p) for i, p in enumerate(pitches)]
    r = rows_by_idx(part(notes))
    assert [r[i]["in_run"] for i in range(9)] == [1, 1, 1, 1, 1, 0, 0, 0, 0]
    assert r[0]["run_pos"] == "start" and r[4]["run_pos"] == "end" and r[2]["run_pos"] == "mid"
    assert r[0]["run_len"] == 5
    # a turn: C D E F G F E D -> two runs sharing the G
    pitches = [60, 62, 64, 65, 67, 65, 64, 62]
    notes = [mk(i, i, 1, p) for i, p in enumerate(pitches)]
    r = rows_by_idx(part(notes))
    assert all(r[i]["in_run"] for i in range(8))
    assert r[4]["run_pos"] == "start"     # the turning note starts the descending run


def test_bar_positions_and_density():
    notes = [mk(i, i * 0.5, 0.5, 60 + i) for i in range(8)]   # eighths across two beats... one bar
    r = rows_by_idx(part(notes))
    assert r[0]["bar_pos_bin"] == "downbeat" and r[1]["bar_pos_bin"] == "off_beat" and r[2]["bar_pos_bin"] == "on_beat"
    assert r[2]["notes_per_sec"] > 2


def test_printed_derived_anchor_and_crossing():
    # RH: E4(3) F4(4) G4(1): thumb under; then A4(2) G4(1)?? -> finger_over is 1 then 2-4 moving down
    notes = [mk(0, 0, 1, 64, RH, 3), mk(1, 1, 1, 65, RH, 4), mk(2, 2, 1, 67, RH, 1), mk(3, 3, 1, 65, RH, 3)]
    r = rows_by_idx(part(notes))
    assert r[1]["anchor_delta"] == 0.0 and r[1]["crossing"] == ""
    assert r[2]["crossing"] == "thumb_under" and r[2]["anchor_delta"] == 4.0   # new position
    assert r[3]["crossing"] == "finger_over"
    # LH mirrored: G3(1) going down to F3 with 2 is finger over? No: LH moving down = outward;
    # thumb under in the LH is 1 after 2-4 moving *down*.
    notes = [mk(0, 0, 1, 57, LH, 2), mk(1, 1, 1, 55, LH, 1), mk(2, 2, 1, 57, LH, 3)]
    r = rows_by_idx(part(notes))
    assert r[1]["crossing"] == "thumb_under" and r[2]["crossing"] == "finger_over"


def test_events_grouping_keeps_graces_separate():
    g = mk(0, 0, 0, 60)
    g.grace = True
    n = mk(1, 0, 1, 64)
    evs = corpus.events([g, n])
    assert len(evs) == 2
