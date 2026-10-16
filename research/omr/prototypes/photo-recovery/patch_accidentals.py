"""Add an explicit display-only patch to an isolated HOMR source copy."""
from __future__ import annotations
import argparse
import difflib
import hashlib
from pathlib import Path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args=parser.parse_args()
    module=args.source/'homr/music_xml_generator.py'
    before=module.read_text(encoding='utf-8')
    needle='    convert_ties(part)\n    return part'
    if before.count(needle)!=1:
        raise ValueError('Unexpected upstream generator; patch not applied')
    after=before.replace('from homr import constants\n','from homr import constants\nfrom homr.accidental_display import spell_accidentals\n',1)
    after=after.replace(needle,'    convert_ties(part)\n    spell_accidentals(part)\n    return part',1)
    module.write_text(after, encoding='utf-8', newline='\r\n')
    helper=Path(__file__).with_name('accidental_display.py')
    # Preserve the pinned vendor format: LF body and a CRLF final terminator,
    # independently of whether Git checked out this helper with LF or CRLF.
    helper_text=helper.read_text(encoding='utf-8')
    if not helper_text.endswith('\n'):
        raise ValueError('Expected a newline-terminated accidental helper')
    (args.source/'homr/accidental_display.py').write_bytes(helper_text[:-1].encode('utf-8') + b'\r\n')
    diff=''.join(difflib.unified_diff(before.splitlines(keepends=True),after.splitlines(keepends=True),fromfile='a/homr/music_xml_generator.py',tofile='b/homr/music_xml_generator.py'))
    diff+=''.join(difflib.unified_diff([],helper.read_text(encoding='utf-8').splitlines(keepends=True),fromfile='/dev/null',tofile='b/homr/accidental_display.py'))
    retained=Path(__file__).with_name('upstream-accidentals.patch').read_text(encoding='utf-8')
    if retained != diff:
        raise ValueError('Generated accidental patch differs from the retained upstream diff')
    print(hashlib.sha256(diff.encode()).hexdigest())

if __name__=='__main__':
    main()
