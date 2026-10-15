"""Inventory the local Mutopia archive and cache published MIDI in four workers.

Downloaded files are data only. Run from the root with Python -I; --download
hydrates the inventory. Source-header rights are preliminary; the canonical
edition RDF must authorize redistribution before any MIDI is downloaded.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime
import hashlib
import html.parser
import io
import json
import pathlib
import re
import sys
import urllib.parse
import urllib.request
import uuid
import zipfile
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIRROR = ROOT / 'research/data/mutopia_src/ftp'
CACHE = ROOT / 'content/_raw/bulk/mutopia'
OUTPUT = ROOT / 'content/tools/bulk-candidates.json'
BASE = 'https://www.mutopiaproject.org/ftp/'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def field(text, name):
    match = re.search(r'(?m)^\s*' + name + r'\s*=\s*"((?:[^"\\]|\\.)*)"', text)
    return match.group(1).replace('\\"', '"') if match else ''


def allowed_license(value):
    return value.lower() == 'public domain' or bool(re.fullmatch(r'(?:Creative Commons )?Attribution(?:-ShareAlike)?(?:\s+[\d.]+)?(?: International)?', value, re.I)) or value in ('CC0', 'CC0 1.0')


def inventory():
    existing = set()
    for path in [ROOT / 'content/tools/catalog.json', *sorted((ROOT / 'content/tools/catalog.d').glob('*.json'))]:
        existing.update(p.get('ftpDir') for p in json.loads(path.read_text(encoding='utf-8'))['pieces'])
    records = []
    for path in sorted(MIRROR.rglob('*.ly')):
        data = path.read_bytes()
        text = data.decode('utf-8', 'replace')
        instrument = field(text, 'mutopiainstrument')
        # Exact instrument declarations avoid vocal/accompaniment, ensembles,
        # four-hands and arrangements for multiple keyboards.
        if not re.fullmatch(r'(?:Piano|Harpsichord|Clavichord|Keyboard|Organ|Orgue)(?:\s*[,/]\s*(?:Piano|Harpsichord|Clavichord|Keyboard|Organ|Orgue))*', instrument, re.I):
            continue
        title = field(text, 'mutopiatitle')
        if not title:
            continue
        license_name = field(text, 'license') or field(text, 'copyright')
        allowed = allowed_license(license_name)
        relative = path.relative_to(MIRROR).as_posix()
        directory = path.parent.relative_to(MIRROR).as_posix()
        # The source mirror expands multi-file archives into NAME-lys/;
        # published MIDI/RDF belong to the enclosing canonical FTP directory.
        parts = pathlib.PurePosixPath(directory).parts
        archive_index = next((i for i, part in enumerate(parts) if part.endswith('-lys')), None)
        subdir = ''
        if archive_index is not None:
            subdir = '/'.join(parts[archive_index:])
            directory = '/'.join(parts[:archive_index])
        records.append(dict(id=relative, ftpDir=directory, main=path.name,
                            subdir=subdir,
                            title=title, composer=field(text, 'mutopiacomposer'),
                            composerDisplay=field(text, 'composer'), catalogue=field(text, 'mutopiaopus'),
                            instrument=instrument, license=license_name, rightsAllowed=allowed,
                            requiresPedalReview=bool(re.search(r'Organ|Orgue', instrument, re.I)),
                            maintainer=field(text, 'maintainer'), sourceEdition=field(text, 'source'),
                            sourceUrl=BASE + urllib.parse.quote(relative),
                            sourcePath='research/data/mutopia_src/ftp/' + relative,
                            sourceSha256=sha(data), existingCatalogDirectory=directory in existing,
                            midiFiles=[], status='inventoried' if allowed else 'excluded-rights'))
    return records


class Links(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.links.extend(v for k, v in attrs if k == 'href' and v and '/' not in v and not v.startswith('?'))


def get(url, target):
    if target.exists():
        return target.read_bytes()
    request = urllib.request.Request(url, headers={'User-Agent': 'digitus2-bulk-content/1.0 (bounded four-worker archival fetch)'})
    with urllib.request.urlopen(request, timeout=35) as response:
        data = response.read()
    target.parent.mkdir(parents=True, exist_ok=True)
    write_bytes(target, data)
    return data


def write_bytes(target, data):
    temporary = target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_bytes(data)
    temporary.replace(target)


def hydrate(record):
    result = dict(record)
    directory = record['ftpDir']
    dest = CACHE / directory
    url = BASE + urllib.parse.quote(directory) + '/'
    try:
        links = Links()
        links.feed(get(url, dest / 'index.html').decode('utf-8', 'replace'))
        names = sorted(set(n for n in links.links if n.endswith(('.mid', '.midi', '-mids.zip', '.rdf'))), key=lambda n: (not n.endswith('.rdf'), n))
        result['downloadFiles'] = []
        result['midiFiles'] = []
        result['rightsAllowed'] = False
        if not any(name.endswith('.rdf') for name in names):
            result['status'] = 'missing-rights-metadata'
            return result
        for name in names:
            # Only direct safe file names from this canonical directory.
            if pathlib.PurePosixPath(name).name != name or '\\' in name:
                continue
            if not name.endswith('.rdf') and not result['rightsAllowed']:
                continue
            data = get(url + urllib.parse.quote(name), dest / name)
            result['downloadFiles'].append(dict(url=url + name, path=(dest / name).relative_to(ROOT).as_posix(), sha256=sha(data), bytes=len(data)))
            if name.endswith('.rdf'):
                tree = ET.fromstring(data)
                result['rdfLicense'] = tree.findtext('.//{http://www.mutopiaproject.org/piece-data/0.1/}licence', default='')
                result['rightsAllowed'] = allowed_license(result['rdfLicense'])
            elif name.endswith(('.mid', '.midi')):
                if not data.startswith(b'MThd'):
                    raise ValueError('published MIDI has no MThd header')
                result['midiFiles'].append((dest / name).relative_to(ROOT).as_posix())
            elif name.endswith('-mids.zip'):
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    for entry in archive.infolist():
                        if entry.is_dir() or not entry.filename.lower().endswith(('.mid', '.midi')):
                            continue
                        target = (dest / 'midi' / entry.filename).resolve()
                        if (dest / 'midi').resolve() not in target.parents:
                            raise ValueError('unsafe archive path')
                        payload = archive.read(entry)
                        if not payload.startswith(b'MThd'):
                            raise ValueError('archive MIDI has no MThd header')
                        target.parent.mkdir(parents=True, exist_ok=True)
                        write_bytes(target, payload)
                        result['midiFiles'].append((dest / 'midi' / entry.filename).relative_to(ROOT).as_posix())
        result['status'] = ('acquired' if result['midiFiles'] else 'no-published-midi') if result['rightsAllowed'] else 'excluded-rights'
    except Exception as exc:
        result['status'] = 'download-error'
        result['error'] = str(exc)
    return result


def hydrate_all(records):
    """Fetch each edition once, preserving metadata for its alternative mains."""
    groups = {}
    for index, row in enumerate(records):
        groups.setdefault(row['ftpDir'], []).append(index)
    fields = ('downloadFiles', 'midiFiles', 'rdfLicense', 'rightsAllowed', 'status', 'error')
    representatives = [records[indexes[0]] for indexes in groups.values()]
    results = [dict(row) for row in records]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as workers:
        for count, result in enumerate(workers.map(hydrate, representatives), 1):
            for index in groups[result['ftpDir']]:
                for field_name in fields:
                    results[index].pop(field_name, None)
                    if field_name in result:
                        results[index][field_name] = result[field_name]
            if count % 25 == 0:
                save(results)
    return results


def admission_records(records):
    """Regenerate durable decisions from catalog truth, independently of downloads."""
    fragment = ROOT / 'content/tools/catalog.d/expansion-bulk.json'
    decisions = json.loads(fragment.read_text(encoding='utf-8')) if fragment.exists() else {}
    accepted = {p['ftpDir']: p for p in decisions.get('pieces', [])}
    held = {p['ftpDir']: p for p in decisions.get('rejected', [])}
    seen = {}
    for row in records:
        directory = row['ftpDir']
        if directory in accepted:
            piece = accepted[directory]
            selected = '/'.join(p for p in (directory, piece.get('subdir', ''), piece['main']) if p)
            decision = dict(status='accepted', catalogSlug=piece['slug'],
                            selectedSourceMain=row['id'] == selected,
                            reason='Accepted catalog edition; production gates and independent review passed.')
        elif directory in held:
            piece = held[directory]
            decision = dict(status='held', catalogSlug=None, decisionRecord=piece['slug'],
                            reason=piece['reason'].splitlines()[0][:180])
        elif row.get('existingCatalogDirectory'):
            decision = dict(status='already-in-library', catalogSlug=None,
                            reason='Source directory is represented by the earlier catalog.')
        else:
            decision = dict(status='pending', catalogSlug=None, reason='Not accepted by the current catalog.')
        row['admission'] = decision
        seen[directory] = decision['status']
    return dict(uniqueSourceDirectories=len(seen), acceptedNewLibraryPieces=sum(v == 'accepted' for v in seen.values()),
                heldSourceDirectories=sum(v == 'held' for v in seen.values()),
                alreadyRepresentedDirectories=sum(v == 'already-in-library' for v in seen.values()),
                pendingSourceDirectories=sum(v == 'pending' for v in seen.values()),
                note='Admission is regenerated from the bulk catalog on every save; acquisition status is independent. Full held reasons remain in the catalog rejected records.')


def save(records):
    for row in records:
        row['requiresPedalReview'] = bool(re.search(r'Organ|Orgue', row['instrument'], re.I))
        row['midiSha256'] = {name: sha((ROOT / name).read_bytes()) for name in row['midiFiles']}
        for rdf in sorted((CACHE / row['ftpDir']).glob('*.rdf')):
            try:
                tree = ET.fromstring(rdf.read_bytes())
                namespace = {'mp': 'http://www.mutopiaproject.org/piece-data/0.1/'}
                def value(key):
                    return tree.findtext('.//mp:' + key, default='', namespaces=namespace)
                row['rdfLicense'] = value('licence')
                row['rdfLyFile'] = value('lyFile')
                row['rdfMainMatches'] = row['main'] == value('lyFile')
                row['rdfRightsAllowed'] = allowed_license(value('licence'))
                row['rdfPath'] = rdf.relative_to(ROOT).as_posix()
                row['rdfSha256'] = sha(rdf.read_bytes())
            except ET.ParseError as exc:
                row['rdfError'] = str(exc)
    composers = {}
    for row in records:
        composers[row['composer']] = composers.get(row['composer'], 0) + 1
    summary = dict(candidates=len(records), rightsAllowed=sum(r['rightsAllowed'] for r in records),
                   missingCatalogDirectories=len({r['ftpDir'] for r in records if not r['existingCatalogDirectory'] and r['rightsAllowed']}),
                   acquired=sum(r['status'] == 'acquired' for r in records),
                   midiFiles=len({f for r in records for f in r['midiFiles']}),
                   uniqueAcquiredDirectories=len({r['ftpDir'] for r in records if r['status'] == 'acquired'}),
                   rdfVerifiedDirectories=len({r['ftpDir'] for r in records if r.get('rdfRightsAllowed')}), composers=composers)
    admissions = admission_records(records)
    full = dict(schemaVersion=1, retrievedAt=datetime.date.today().isoformat(),
                                    source='https://github.com/MutopiaProject/MutopiaProject',
                                    reusePolicy='https://www.mutopiaproject.org/legal.html',
                                    note='Candidates are acquired source editions, not accepted app library entries. Integration requires a verified canonical RDF licence and all library gates.',
                                    summary=summary, admissionSummary=admissions, candidates=records)
    inventory_path = ROOT / 'content/_raw/bulk/inventory.json'
    inventory_path.parent.mkdir(parents=True, exist_ok=True)
    inventory_path.write_text(json.dumps(full, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    # Full, reproducible acquisition facts belong beside the ignored downloads.
    # The committed index retains source/RDF pins and durable catalog decisions.
    keys = ('id', 'ftpDir', 'main', 'subdir', 'title', 'composer', 'instrument', 'license',
            'rdfLicense', 'rightsAllowed', 'sourceUrl', 'sourceSha256', 'rdfSha256', 'status', 'admission')
    compact = [{**{key: row[key] for key in keys if key in row}, 'midiCount': len(row['midiFiles'])} for row in records]
    full.update(schemaVersion=2, acquisitionInventory='content/_raw/bulk/inventory.json', candidates=compact)
    temporary = OUTPUT.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(full, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(OUTPUT)
    print(json.dumps({k: v for k, v in summary.items() if k != 'composers'}, ensure_ascii=True), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--refresh', action='store_true', help='Reconcile cached metadata without resetting downloaded status')
    args = parser.parse_args()
    if args.refresh:
        path = ROOT / 'content/_raw/bulk/inventory.json'
        if not path.exists():
            raise SystemExit('No full acquisition inventory; run bulk_sources.py --download to recreate the cache.')
        save(json.loads(path.read_text(encoding='utf-8'))['candidates'])
        return
    records = inventory()
    records.sort(key=lambda r: (r['composer'] not in ('RachmaninoffS', 'RachmaninovS', 'BeethovenLv', 'ChopinFF'), r['existingCatalogDirectory'], r['id']))
    save(records)
    if args.download:
        save(hydrate_all(records))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
