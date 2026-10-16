"""Read-only tiny-anchor checks. Never generates or repairs recognized MusicXML."""
import argparse
from fractions import Fraction
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile


def xml_bytes(path):
    path = Path(path)
    if path.suffix.lower() == '.mxl':
        with zipfile.ZipFile(path) as z:
            if sum(e.file_size for e in z.infolist()) > 20 * 1024 * 1024:
                raise ValueError('oversize archive')
            container = ET.fromstring(z.read('META-INF/container.xml'))
            roots = container.findall('.//{*}rootfile')
            if len(roots) != 1:
                raise ValueError('ambiguous archive')
            data = z.read(roots[0].get('full-path'))
    else:
        data = path.read_bytes()
    if len(data) > 20 * 1024 * 1024 or b'<!ENTITY' in data.upper():
        raise ValueError('oversize/entity XML')
    return data


def events(data):
    root = ET.fromstring(data)
    if root.tag != 'score-partwise':
        raise ValueError('expected score-partwise')
    rows = []
    measures = []
    for part_index, part in enumerate(root.findall('part')):
        divisions = 1
        for ordinal, measure in enumerate(part.findall('measure')):
            divisions = int(measure.findtext('attributes/divisions', str(divisions)))
            cursor = Fraction(0)
            previous = Fraction(0)
            for el in measure:
                duration = Fraction(el.findtext('duration', '0')) / divisions
                if el.tag == 'backup':
                    cursor -= duration
                elif el.tag == 'forward':
                    cursor += duration
                elif el.tag == 'note':
                    chord = el.find('chord') is not None
                    onset = previous if chord else cursor
                    if not chord:
                        previous = onset
                        cursor += duration
                    pitch = el.find('pitch')
                    rows.append({'part': part_index, 'measure': ordinal,
                                 'staff': el.findtext('staff', '1'),
                                 'voice': el.findtext('voice', '1'),
                                 'onset': str(onset), 'duration': str(duration),
                                 'pitch': None if pitch is None else
                                     pitch.findtext('step') +
                                     ({'1': '#', '-1': 'b', '0': ''}.get(pitch.findtext('alter', '0'), '?')) +
                                     pitch.findtext('octave'),
                                 'rest': el.find('rest') is not None,
                                 'ties': sorted({t.get('type') for t in el.findall('tie') + el.findall('notations/tied')})})
            measures.append({'part': part_index, 'ordinal': ordinal,
                             'pitchedStaves': sorted({r['staff'] for r in rows
                                 if r['part'] == part_index and r['measure'] == ordinal and r['pitch']})})
    return {'partCount': len(root.findall('part')),
            'measureCounts': [len(p.findall('measure')) for p in root.findall('part')],
            'declaredStaves': [x.text for x in root.findall('.//staves')],
            'times': [ET.tostring(x, encoding='unicode') for x in root.findall('.//time')],
            'measures': measures, 'events': rows}


def check(score, truth):
    checks = []
    def add(name, actual, expected):
        checks.append({'name': name, 'pass': actual == expected, 'actual': actual, 'expected': expected})
    if 'partCount' in truth:
        add('partCount', score['partCount'], truth['partCount'])
    if 'measureCounts' in truth:
        add('measureCounts', score['measureCounts'], truth['measureCounts'])
    if truth.get('bothStavesEveryMeasure'):
        add('bothStavesEveryMeasure', all(m['pitchedStaves'] == ['1', '2'] for m in score['measures']), True)
    for anchor in truth.get('anchors', []):
        ordinal = score['measureCounts'][anchor.get('part', 0)] - 1 if anchor['measure'] == 'last' else anchor['measure']
        selected = [r for r in score['events'] if r['part'] == anchor.get('part', 0)
                    and r['measure'] == ordinal and r['staff'] == str(anchor['staff'])
                    and Fraction(r['onset']) == Fraction(anchor['onset'])]
        if 'rest' not in anchor['pitches']:
            selected = [r for r in selected if r['pitch']]  # Silent spare-voice rests are not extra chord tones.
        actual = sorted((r['pitch'] or 'rest', r['duration']) for r in selected)
        expected = sorted((p, str(Fraction(anchor['duration']))) for p in anchor['pitches'])
        add(anchor['name'], actual, expected)
    for region in truth.get('regions', []):
        selected = [r for r in score['events'] if r['part'] == region.get('part', 0)
                    and r['measure'] == region['measure'] and r['staff'] == str(region['staff'])]
        if 'extent' in region:
            extent = max((Fraction(r['onset']) + Fraction(r['duration']) for r in selected), default=Fraction(0))
            add(region['name'] + ' extent', str(extent), str(Fraction(region['extent'])))
        if 'pitchFamily' in region:
            family = region['pitchFamily']
            found = any(r['pitch'] and r['pitch'].startswith(family['step'])
                        and r['pitch'].endswith(str(family['octave'])) for r in selected)
            add(region['name'] + ' pitch family', found, True)
        if 'tiesAt' in region:
            tie = region['tiesAt']
            at = [r for r in selected if Fraction(r['onset']) == Fraction(tie['onset'])]
            for kind in ['start', 'stop']:
                if kind in tie:
                    add(region['name'] + ' tie ' + kind,
                        sorted(r['pitch'] for r in at if kind in r.get('ties', [])), sorted(tie[kind]))
        if 'attacks' in region:
            actual = sorted({(r['onset'], r['duration']) for r in selected if r['pitch']}, key=lambda p: Fraction(p[0]))
            expected = [(str(Fraction(a)), str(Fraction(b))) for a,b in region['attacks']]
            add(region['name'] + ' attacks', actual, expected)
    return {'method': 'private-tiny-anchors-not-corpus-accuracy', 'allChecksPass': all(c['pass'] for c in checks), 'checks': checks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('score', type=Path)
    parser.add_argument('--truth', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    score = events(xml_bytes(args.score))
    result = {'recognitionExecuted': False, 'score': str(args.score), 'structure': score}
    if args.truth:
        result['acceptance'] = check(score, json.loads(args.truth.read_text(encoding='utf-8-sig')))
    args.out.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result.get('acceptance', {k:v for k,v in score.items() if k != 'events'}), indent=2))

if __name__ == '__main__':
    main()
