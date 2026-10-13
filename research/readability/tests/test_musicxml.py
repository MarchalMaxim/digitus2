from pathlib import Path

from readability import corpus
from readability.musicxml import parse_fingered_musicxml

XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="0" implicit="yes">
      <attributes><divisions>2</divisions><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff>
        <notations><technical><fingering>1</fingering></technical></notations></note>
    </measure>
    <measure number="1">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff>
        <tie type="start"/><notations><technical><fingering>3</fingering></technical></notations></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff><tie type="stop"/></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff>
        <notations><technical><fingering substitution="yes">5</fingering></technical></notations></note>
      <backup><duration>6</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>6</duration><voice>5</voice><staff>2</staff>
        <notations><technical><fingering>5</fingering></technical></notations></note>
      <note><chord/><pitch><step>E</step><octave>3</octave></pitch><duration>6</duration><voice>5</voice><staff>2</staff></note>
      <note><chord/><pitch><step>G</step><octave>3</octave></pitch><duration>6</duration><voice>5</voice><staff>2</staff>
        <notations><technical><fingering>1</fingering></technical></notations></note>
    </measure>
  </part>
</score-partwise>
"""


def test_parse_small_score(tmp_path: Path):
    p = tmp_path / "x.fingered.musicxml"
    p.write_text(XML, encoding="utf-8")
    notes = parse_fingered_musicxml(p, tempo_bpm=120)
    # anacrusis G4, tied C5 merged into one note, E5, and the LH chord C3 E3 G3
    # onset order, RH before LH at equal onsets (as in the Mutopia PIG files)
    assert [(n.pitch, n.hand, n.finger) for n in notes] == [(67, 0, 1), (72, 0, 3), (48, 1, 5), (52, 1, 0), (55, 1, 1), (76, 0, 5)]
    g, c5, c3, e3, g3, e5 = notes
    assert g.bar == -1 and g.bar_pos == 2.0 and g.bar_len == 3.0       # pickup: last beat of a 3/4 bar
    assert c5.beat == 1.0 and c5.dur_beats == 2.0 and c5.bar == 0 and c5.bar_pos == 0.0
    assert e5.beat == 3.0 and e5.substitution is True
    assert c3.beat == 1.0 and e3.beat == 1.0 and g3.beat == 1.0 and c3.dur_beats == 3.0
    assert abs(c5.onset - 0.5) < 1e-9 and abs(c5.offset - 1.5) < 1e-9   # 120 bpm -> 0.5 s per beat
    evs = corpus.events([n for n in notes if n.hand == 1])
    assert len(evs) == 1 and [n.pitch for n in evs[0]] == [48, 52, 55]


def test_library_counts_match_content_library_report():
    # fingering counts after merging tied continuations and substitution markers (see
    # docs/research/content-library.md): K.545 has 378 printed digits
    parts = {p.meta["slug"]: p for p in corpus.iter_library()}
    assert parts["mozart-sonata-k545-mvt1"].n_printed == 378
    assert parts["burgmuller-op100-no1-la-candeur"].n_printed == 46
    assert parts["chopin-waltz-op69-no2"].n_printed == 60
    assert all(p.beats_known for p in parts.values())
