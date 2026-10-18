"""Lossless export normalisation: a measure that holds no music joins its neighbour."""
import xml.etree.ElementTree as ET

from normalize_export import merge_empty_measures

NOTE = "<note><pitch><step>C</step><octave>5</octave></pitch><duration>6</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note>"
HEAD = "<attributes><divisions>2</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>"


def score(*measures):
    body = "".join(f'<measure number="{i + 1}">{m}</measure>' for i, m in enumerate(measures))
    return f'<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">{body}</part></score-partwise>'.encode()


def measures(data):
    return ET.fromstring(data).find("part").findall("measure")


def test_an_ending_stop_written_as_its_own_measure_moves_onto_the_bar_it_closes():
    data = score(
        HEAD + NOTE,
        '<barline location="left"><ending type="start" number="1"/></barline>' + NOTE + '<barline location="right"><repeat direction="backward"/></barline>',
        '<barline location="right"><ending type="stop" number="1"/></barline>',
        '<barline location="left"><ending type="start" number="2"/></barline>' + NOTE,
    )
    fixed, merged = merge_empty_measures(data)
    assert merged == 1
    bars = measures(fixed)
    assert [m.get("number") for m in bars] == ["1", "2", "3"]
    right = [b for b in bars[1].findall("barline") if b.get("location") == "right"]
    assert len(right) == 1
    # MusicXML order inside a barline: ending before repeat.
    assert [child.tag for child in right[0]] == ["ending", "repeat"]
    assert right[0].find("ending").get("type") == "stop"
    # Every note is still there, in order.
    assert sum(1 for _ in ET.fromstring(fixed).iter("note")) == 3


def test_music_is_never_moved_and_a_conflict_leaves_the_file_unchanged():
    # A measure with a rest holds time: it stays.
    rest = score(HEAD + NOTE, "<note><rest/><duration>6</duration><voice>1</voice></note>")
    assert merge_empty_measures(rest) == (rest, 0)
    # Two endings stopping at one barline cannot be merged into one element: keep the file as is.
    clash = score(
        HEAD + NOTE + '<barline location="right"><ending type="stop" number="1"/></barline>',
        '<barline location="right"><ending type="stop" number="2"/></barline>',
        NOTE,
    )
    assert merge_empty_measures(clash) == (clash, 0)


def test_attributes_and_directions_of_an_empty_measure_open_the_next_one():
    data = score(
        HEAD + NOTE,
        "<attributes><key><fifths>1</fifths></key></attributes><direction><direction-type><words>dolce</words></direction-type></direction>",
        NOTE,
    )
    fixed, merged = merge_empty_measures(data)
    assert merged == 1
    bars = measures(fixed)
    assert len(bars) == 2
    assert [child.tag for child in bars[1]][:3] == ["attributes", "direction", "note"]


def test_parts_merge_only_where_every_part_is_empty():
    two = (
        b'<score-partwise version="4.0"><part-list><score-part id="P1"/><score-part id="P2"/></part-list>'
        b'<part id="P1"><measure number="1">' + (HEAD + NOTE).encode() + b'</measure><measure number="2"><barline location="right"><bar-style>light-heavy</bar-style></barline></measure></part>'
        b'<part id="P2"><measure number="1">' + (HEAD + NOTE).encode() + b'</measure><measure number="2">' + NOTE.encode() + b"</measure></part></score-partwise>"
    )
    assert merge_empty_measures(two) == (two, 0)


from normalize_export import ties_from_slurs


def n(step, octave, duration, voice, slur=None, staff=1, kind="quarter"):
    notations = f'<notations><slur type="{slur}" number="1"/></notations>' if slur else ""
    return f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch><duration>{duration}</duration><voice>{voice}</voice><type>{kind}</type><staff>{staff}</staff>{notations}</note>"


def ties(data):
    return [
        (note.findtext("pitch/step"), [t.get("type") for t in note.findall("tie")], [t.get("type") for t in note.findall("notations/tied")], len(note.findall("notations/slur")))
        for note in ET.fromstring(data).iter("note")
    ]


def test_a_slur_joining_one_pitch_to_its_continuation_is_a_tie_whatever_the_voice_labels():
    # homr labels the held E5 voice 2 and its continuation voice 1, so its own rule misses it.
    data = score(HEAD + n("C", 5, 4, 1, kind="half") + n("E", 5, 2, 2, "start"), n("E", 5, 2, 1, "stop") + n("D", 5, 4, 1, kind="half"))
    fixed, count = ties_from_slurs(data)
    assert count == 1
    assert ties(fixed) == [("C", [], [], 0), ("E", ["start"], ["start"], 0), ("E", ["stop"], ["stop"], 0), ("D", [], [], 0)]


def test_a_slur_to_another_pitch_or_across_a_gap_stays_a_slur():
    other = score(HEAD + n("C", 5, 4, 1, kind="half") + n("E", 5, 2, 2, "start"), n("F", 5, 2, 1, "stop") + n("D", 5, 4, 1, kind="half"))
    assert ties_from_slurs(other) == (other, 0)
    gap = score(HEAD + n("E", 5, 2, 2, "start") + n("C", 5, 4, 1, kind="half"), n("E", 5, 2, 1, "stop") + n("D", 5, 4, 1, kind="half"))
    assert ties_from_slurs(gap) == (gap, 0)


def test_two_possible_continuations_leave_the_slur_alone():
    chord = '<note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>3</voice><type>quarter</type><staff>1</staff><notations><slur type="stop" number="1"/></notations></note>'
    data = score(HEAD + n("C", 5, 4, 1, kind="half") + n("E", 5, 2, 2, "start"), n("E", 5, 2, 1, "stop") + chord + n("D", 5, 4, 1, kind="half"))
    assert ties_from_slurs(data) == (data, 0)


from normalize_export import normalize


def clef(sign, line):
    return f"<attributes><clef><sign>{sign}</sign><line>{line}</line></clef></attributes>"


def test_a_piano_page_read_as_one_staff_with_alternating_clefs_is_reported_not_repaired():
    unpaired = score(HEAD + clef("G", 2) + NOTE, clef("F", 4) + NOTE, clef("G", 2) + NOTE, clef("F", 4) + NOTE)
    data, audit, warnings = normalize(unpaired)
    assert data == unpaired
    assert [w["code"] for w in warnings] == ["recognition-grand-staff-unpaired"]
    # One clef change on a single staff is ordinary music, not a lost grand staff.
    plain = score(HEAD + clef("G", 2) + NOTE, clef("F", 4) + NOTE, NOTE)
    assert normalize(plain)[2] == []


def test_normalize_reports_what_it_changed():
    data = score(
        HEAD + n("C", 5, 4, 1, kind="half") + n("E", 5, 2, 2, "start"),
        '<barline location="right"><ending type="stop" number="1"/></barline>',
        n("E", 5, 2, 1, "stop") + n("D", 5, 4, 1, kind="half"),
    )
    fixed, audit, warnings = normalize(data)
    assert audit == {"emptyMeasuresMerged": 1, "slursReadAsTies": 1}
    assert [w["code"] for w in warnings] == ["recognition-export-normalized"]
    assert "1 empty measure" in warnings[0]["message"] and "1 slur" in warnings[0]["message"]


def test_a_chain_of_slurred_continuations_becomes_a_tie_chain():
    # E5 (bar 1) - E5 (bar 2, slur stop and start) - a third E5 where the second ends.
    data = score(
        HEAD + n("C", 5, 4, 1, kind="half") + n("E", 5, 2, 2, "start"),
        n("E", 5, 2, 1, "stop").replace("</notations>", '<slur type="start" number="1"/></notations>') + n("E", 5, 2, 1, "stop") + n("D", 5, 2, 1),
    )
    fixed, count = ties_from_slurs(data)
    assert count == 2
    marks = ties(fixed)
    assert marks[1][1] == ["start"] and marks[2][1] == ["stop", "start"] and marks[3][1] == ["stop"]


def test_slurs_with_different_numbers_are_not_paired():
    data = score(
        HEAD + n("C", 5, 4, 1, kind="half") + n("E", 5, 2, 2, "start").replace('number="1"', 'number="2"'),
        n("E", 5, 2, 1, "stop") + n("D", 5, 4, 1, kind="half"),
    )
    assert ties_from_slurs(data) == (data, 0)


def test_two_empty_measures_in_a_row_are_left_alone():
    data = score(
        HEAD + NOTE,
        '<barline location="right"><ending type="stop" number="1"/></barline>',
        '<barline location="right"><repeat direction="backward"/></barline>',
        NOTE,
    )
    assert merge_empty_measures(data) == (data, 0)
