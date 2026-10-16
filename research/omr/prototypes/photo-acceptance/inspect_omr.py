"""Inspect saved Audiveris grid geometry without executing Audiveris or extracting paths."""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile


def inspect(path):
    with zipfile.ZipFile(path) as archive:
        if sum(e.file_size for e in archive.infolist()) > 64 * 1024 * 1024:
            raise ValueError('oversize OMR archive')
        sheet_names = [n for n in archive.namelist() if n.startswith('sheet#') and n.endswith('.xml')]
        result = []
        for name in sheet_names:
            data = archive.read(name)
            if b'<!ENTITY' in data.upper():
                raise ValueError('entity XML')
            root = ET.fromstring(data)
            staffs = []
            for system in root.findall('.//page/system'):
                for part in system.findall('part'):
                    for staff in part.findall('staff'):
                        lines = []
                        for line in staff.findall('lines/line'):
                            points = [{k: float(point.get(k)) for k in ['x', 'y']} for point in line.findall('point')]
                            lines.append(points)
                        staffs.append({'system': system.get('id'), 'part': part.get('id'),
                                       'staff': staff.get('id'), 'left': staff.get('left'),
                                       'right': staff.get('right'), 'lines': lines})
            result.append({'entry': name, 'picture': root.find('picture').attrib,
                           'scale': {c.tag: c.attrib for c in root.find('scale')} if root.find('scale') is not None else {},
                           'skew': root.find('skew').attrib if root.find('skew') is not None else {},
                           'detectedStaffCount': len(staffs), 'staves': staffs})
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('omr', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    result = {'recognitionExecuted': False, 'source': str(args.omr), 'sheets': inspect(args.omr)}
    args.out.write_text(json.dumps(result, indent=2), encoding='utf8')
    print(json.dumps([{'entry':s['entry'], 'detectedStaffCount':s['detectedStaffCount'], 'scale':s['scale'], 'skew':s['skew']} for s in result['sheets']], indent=2))

if __name__ == '__main__':
    main()
