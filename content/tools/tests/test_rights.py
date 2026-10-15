"""Rights text must distinguish licensed original compositions from PD repertoire."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build


def test_licensed_original_work_is_not_called_public_domain():
    source = dict(typesetter='Andrew Sidwell', mutopiaId='Mutopia-2006/10/06-834',
                  license='CC-BY-SA-2.5', licenseUrl='https://creativecommons.org/licenses/by-sa/2.5/',
                  edition='Original work')
    text = build.rights_text({}, source)
    assert 'Composition in the public domain' not in text
    assert 'Composition and engraving' in text
    assert all(source[key] in text for key in ('typesetter', 'mutopiaId', 'licenseUrl', 'license'))


def test_xml_compaction_preserves_content_and_attributes():
    data = b'<score>\n  <words>Keep  two spaces</words>\n  <note id="n1">\n    <pitch>C</pitch>\n  </note>\n</score>'
    assert build.compact_xml(data) == b'<score><words>Keep  two spaces</words><note id="n1"><pitch>C</pitch></note></score>'
