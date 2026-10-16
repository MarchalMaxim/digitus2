"""Display-only regression cases; pitch, timing and note identity must stay unchanged."""
import copy
import xml.etree.ElementTree as ET
import pytest
from accidental_display import spell_accidentals


def note(step='F', octave=4, alter=1, *, duration=1, voice=1, staff=1, chord=False, ties=()):
    n=ET.Element('note')
    if chord: ET.SubElement(n,'chord')
    p=ET.SubElement(n,'pitch')
    ET.SubElement(p,'step').text=step
    if alter: ET.SubElement(p,'alter').text=str(alter)
    ET.SubElement(p,'octave').text=str(octave)
    ET.SubElement(n,'duration').text=str(duration)
    for kind in ties: ET.SubElement(n,'tie',type=kind)
    ET.SubElement(n,'voice').text=str(voice)
    ET.SubElement(n,'type').text='quarter'
    ET.SubElement(n,'stem').text='up'
    ET.SubElement(n,'staff').text=str(staff)
    return n


def score(*measures):
    r=ET.Element('score-partwise',version='4.0');p=ET.SubElement(r,'part',id='P1')
    for items in measures:
        m=ET.SubElement(p,'measure',number=str(len(p)+1))
        for item in items:m.append(item)
    return r


def key(fifths, staff=None):
    a=ET.Element('attributes');k=ET.SubElement(a,'key',**({'number':str(staff)} if staff else {}));ET.SubElement(k,'fifths').text=str(fifths);return a


def marks(root):return [n.findtext('accidental') for n in root.findall('.//note')]


def unchanged_except_accidentals(before, after):
    for n in after.findall('.//note'):
        for a in n.findall('accidental'):n.remove(a)
    assert ET.tostring(before)==ET.tostring(after)


def test_repeats_natural_cancellation_and_new_bar():
    r=score([note(),note(),note(alter=0),note(alter=0),note()], [note()])
    before=copy.deepcopy(r);assert spell_accidentals(r)=={'addedAccidentalGlyphs':4}
    assert marks(r)==['sharp',None,'natural',None,'sharp','sharp']
    unchanged_except_accidentals(before,r)


def test_key_signature_octaves_and_cancellation():
    r=score([key(1),note(),note(octave=5),note(alter=0),note(octave=5),note()], [note()])
    spell_accidentals(r)
    assert marks(r)==[None,None,'natural',None,'sharp',None]


def test_flat_key_and_double_accidentals():
    r=score([key(-2),note('B',alter=-1),note('B',alter=0),note('F',alter=2),note('F',alter=-2)])
    spell_accidentals(r);assert marks(r)==[None,'natural','double-sharp','flat-flat']


def test_octaves_and_staves_do_not_share_accidentals():
    r=score([note(),note(octave=5),note(staff=2),note(),note(octave=5),note(staff=2)])
    spell_accidentals(r);assert marks(r)==['sharp','sharp','sharp',None,None,None]


def test_chords_and_duplicate_unisons():
    r=score([note(),note('A',alter=-1,chord=True),note(chord=True),note()])
    spell_accidentals(r);assert marks(r)==['sharp','flat',None,None]


def test_voices_are_sorted_by_musical_time_not_xml_order():
    backup=ET.fromstring('<backup><duration>2</duration></backup>')
    r=score([note(),note(alter=0),backup,note(voice=2),note(alter=0,voice=2)])
    spell_accidentals(r);assert marks(r)==['sharp','natural',None,None]


def test_conflicting_concurrent_voices_do_not_choose_last_xml_voice():
    backup=ET.fromstring('<backup><duration>2</duration></backup>')
    r=score([note(),note(),backup,note(alter=0,voice=2)])
    spell_accidentals(r);assert marks(r)==['sharp','sharp',None]


def test_tie_across_bar_does_not_establish_later_new_attack():
    r=score([note(ties=('start',))],[note(ties=('stop',)),note(),note()])
    spell_accidentals(r);assert marks(r)==['sharp',None,'sharp',None]


def test_orphan_tie_stop_does_not_hide_accidental():
    r=score([note(ties=('stop',))]);spell_accidentals(r);assert marks(r)==['sharp']


def test_key_change_in_measure_and_numbered_staff():
    r=score([key(1),key(-1,2),note(),note('B',alter=-1,staff=2),note('B',alter=-1),key(0),note()])
    spell_accidentals(r);assert marks(r)==[None,None,'flat','sharp']


def test_existing_accidental_is_preserved_and_idempotent():
    n=note();a=ET.Element('accidental',cautionary='yes');a.text='sharp';n.insert(6,a)
    r=score([n,note()]);before=ET.tostring(r)
    assert spell_accidentals(r)['addedAccidentalGlyphs']==0
    assert ET.tostring(r)==before


def test_added_element_follows_type_before_stem_and_staff():
    r=score([note()]);spell_accidentals(r)
    tags=[n.tag for n in r.find('.//note')]
    assert tags.index('type')<tags.index('accidental')<tags.index('stem')<tags.index('staff')


def test_microtonal_pitch_is_not_guessed():
    r=score([note(alter='0.5')])
    with pytest.raises(ValueError,match='microtonal'):spell_accidentals(r)
    assert r.findtext('.//pitch/alter')=='0.5'
