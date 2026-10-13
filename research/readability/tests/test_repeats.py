"""Tests for readability.repeats (synthetic hands, no corpus needed)."""
from readability.corpus import NoteRec, Part, events
from readability.repeats import (Occurrence, _new_tally, analyse_parts, event_tokens, find_repeats,
                                 root_map, summarise, tally_hand)

SEC = 0.6


def make_events(spec, hand=0):
    """spec: list of (pitches, dur_beats, ioi_beats[, fingers]) -> events (list of lists of NoteRec)."""
    notes, beat, idx = [], 0.0, 0
    for item in spec:
        pitches, dur, ioi = item[0], item[1], item[2]
        fingers = item[3] if len(item) > 3 else [0] * len(pitches)
        for p, f in zip(pitches, fingers):
            notes.append(NoteRec(idx=idx, onset=beat * SEC, offset=(beat + dur) * SEC, pitch=p, hand=hand,
                                 finger=f, beat=beat, dur_beats=dur))
            idx += 1
        beat += ioi
    return events(notes), notes


def single(pitches, dur=1.0, ioi=1.0, fingers=None):
    fingers = fingers or [0] * len(pitches)
    return [((p,), dur, ioi, [f]) for p, f in zip(pitches, fingers)]


def check_invariants(occs, n_events):
    later_owner = [None] * n_events
    for k, o in enumerate(occs):
        assert o.length >= 4
        assert o.later >= o.first + o.length, "a later occurrence overlaps its first occurrence"
        assert o.later + o.length <= n_events
        for t in range(o.later, o.later + o.length):
            assert later_owner[t] is None, "two later occurrences overlap"
            later_owner[t] = k
    root = root_map(n_events, occs)
    for e in range(n_events):
        assert later_owner[root[e]] is None, "a root lies inside a later occurrence"
        assert root[e] <= e


def test_exact_repeat_with_chord():
    motif = [((60, 64, 67), 1.0, 1.0)] + single([62, 64, 65, 67])
    evs, _ = make_events(motif + motif)
    occs = find_repeats(evs)
    assert occs == [Occurrence(first=0, later=5, length=5, shift=0, kind="exact")]
    assert occs[0].adjacent
    t = _new_tally()
    tally_hand(evs, occs, t)
    c = t["cats"]["all"]
    assert c["pairs"] == 7 and c["later_n"] == 7 and c["first_n"] == 7


def test_transposed_same_black_white_pattern():
    # C D E F G -> G A B C D: same intervals, all white keys
    evs, _ = make_events(single([60, 62, 64, 65, 67]) + single([67, 69, 71, 72, 74]))
    occs = find_repeats(evs)
    assert occs == [Occurrence(first=0, later=5, length=5, shift=7, kind="transposed_same_pattern")]


def test_transposed_different_black_white_pattern():
    # C D E F G -> D E F# G A: same intervals, F# is black
    evs, _ = make_events(single([60, 62, 64, 65, 67]) + single([62, 64, 66, 67, 69]))
    occs = find_repeats(evs)
    assert occs == [Occurrence(first=0, later=5, length=5, shift=2, kind="transposed_diff_pattern")]


def test_distant_repeat_and_maximal_extension():
    motif = single([60, 62, 64, 65, 67, 69, 71])
    filler = single([90, 40, 85])
    evs, _ = make_events(motif + filler + motif)
    occs = find_repeats(evs)
    assert occs == [Occurrence(first=0, later=10, length=7, shift=0, kind="exact")]
    assert not occs[0].adjacent and occs[0].in_category("distant")


def test_overlapping_occurrences_are_not_allowed():
    # 7 identical notes: the only 4-event repeats would overlap (0..3 vs 3..6)
    evs, _ = make_events(single([60] * 7))
    assert find_repeats(evs) == []
    # 8 identical notes: exactly one non-overlapping pair
    evs, _ = make_events(single([60] * 8))
    assert find_repeats(evs) == [Occurrence(first=0, later=4, length=4, shift=0, kind="exact")]


def test_periodic_pattern_aligns_to_earliest_statement():
    evs, _ = make_events(single([60, 64] * 8))
    occs = find_repeats(evs)
    check_invariants(occs, len(evs))
    # maximal non-overlapping extensions double; every note still aligns with the first cell
    assert [(o.first, o.later, o.length) for o in occs] == [(0, 4, 4), (0, 8, 8)]
    assert root_map(len(evs), occs) == [0, 1, 2, 3] * 4


def test_phrase_with_internal_repeat_is_one_long_segment():
    x = [60, 62, 64, 65]
    y = [72, 71, 69, 67, 65, 64, 62, 59]
    evs, _ = make_events(single(x + x + y + x + x + y))
    occs = find_repeats(evs)
    check_invariants(occs, len(evs))
    assert [(o.first, o.later, o.length, o.kind) for o in occs] == [(0, 4, 4, "exact"), (0, 16, 16, "exact")]
    root = root_map(len(evs), occs)
    assert root[16:24] == [0, 1, 2, 3, 0, 1, 2, 3] and root[24:32] == list(range(8, 16))


def test_mixed_shift_through_roots():
    x = [60, 62, 64, 65]
    x2 = [p + 2 for p in x]
    evs, _ = make_events(single(x + x2 + x + x2))
    occs = find_repeats(evs)
    assert [(o.first, o.later, o.length, o.shift, o.kind) for o in occs] == [
        (0, 4, 4, 2, "transposed_diff_pattern"), (0, 8, 8, 0, "mixed_shift")]


def test_three_event_repeat_is_ignored():
    evs, _ = make_events(single([60, 62, 64, 72, 60, 62, 64, 48]))
    assert find_repeats(evs) == []


def test_ioi_and_duration_must_match():
    a = single([60, 62, 64, 65, 67], dur=0.5, ioi=1.0)
    b = single([60, 62, 64, 65, 67], dur=0.5, ioi=1.0)
    b[2] = ((64,), 0.5, 0.5)                   # one IOI differs in the middle
    evs, _ = make_events(a + b)
    assert all(o.length < 5 for o in find_repeats(evs))
    c = single([60, 62, 64, 65, 67], dur=0.5, ioi=1.0)
    d = single([60, 62, 64, 65, 67], dur=0.25, ioi=1.0)   # durations differ
    evs, _ = make_events(c + d)
    assert find_repeats(evs) == []
    # the IOI after the last event of a segment is not compared
    e = single([60, 62, 64, 65], ioi=1.0) + [((67,), 1.0, 3.0)]
    f = single([60, 62, 64, 65], ioi=1.0) + [((67,), 1.0, 1.0)]
    evs, _ = make_events(e + f)
    assert find_repeats(evs) == [Occurrence(first=0, later=5, length=5, shift=0, kind="exact")]


def test_tokens_are_transposition_invariant():
    evs1, _ = make_events([((60, 64), 1.0, 1.0), ((62, 65), 1.0, 1.0)])
    evs2, _ = make_events([((65, 69), 1.0, 1.0), ((67, 70), 1.0, 1.0)])
    s1, l1, low1 = event_tokens(evs1)
    s2, l2, low2 = event_tokens(evs2)
    assert l1[0] == -1 and low1 == [60, 62] and low2 == [65, 67]
    # ids are per call, so compare structure: same shape at both positions in each, links defined
    assert (s1[0] == s1[1]) == (s2[0] == s2[1])


def test_print_rate_bookkeeping():
    motif = [60, 62, 64, 65, 67]
    spec = (single(motif, fingers=[1, 0, 3, 0, 5]) + single(motif, fingers=[1, 0, 4, 2, 0])
            + single([90, 40], fingers=[2, 0]))
    evs, _ = make_events(spec)
    occs = find_repeats(evs)
    assert occs == [Occurrence(first=0, later=5, length=5, shift=0, kind="exact")]
    t = _new_tally()
    tally_hand(evs, occs, t)
    assert (t["n_notes"], t["n_printed"], t["none_n"], t["none_printed"]) == (12, 7, 2, 1)
    s = summarise(t)
    c = s["categories"]["all"]
    assert c["first_occurrence_notes"] == {"n": 5, "k": 3, "p": 0.6}
    assert c["later_occurrence_notes"] == {"n": 5, "k": 3, "p": 0.6}
    assert c["aligned_pairs"] == 5
    assert c["p_later_printed_given_first_printed"] == {"n": 3, "k": 2, "p": 0.6667}
    assert c["p_later_printed_given_first_unprinted"] == {"n": 2, "k": 1, "p": 0.5}
    assert c["same_digit_given_both_printed"] == {"n": 2, "k": 1, "p": 0.5}
    assert s["baseline_no_repeat"] == {"n": 2, "k": 1, "p": 0.5}
    assert s["categories"]["exact"]["aligned_pairs"] == 5
    assert s["categories"]["transposed_same_pattern"]["aligned_pairs"] == 0
    assert c["length_events"]["median"] == 5 and c["length_events"]["max"] == 5


def test_analyse_parts_groups():
    motif = [60, 62, 64, 65, 67]
    _, notes = make_events(single(motif, fingers=[1, 2, 3, 4, 5]) + single(motif))
    part = Part(id="x", source="mutopia", composer="C", title="T", level_group="teaching", level=None,
                license="", notes=notes)
    tallies = analyse_parts([part])
    assert tallies["overall"]["n_notes"] == tallies["teaching"]["n_notes"] == 10
    assert tallies["concert"]["n_notes"] == 0
    s = summarise(tallies["teaching"])
    assert s["categories"]["all"]["first_occurrence_notes"]["p"] == 1.0
    assert s["categories"]["all"]["later_occurrence_notes"]["p"] == 0.0
