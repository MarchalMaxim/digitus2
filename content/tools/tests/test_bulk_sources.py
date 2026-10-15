"""Untrusted download boundaries and one request per source edition."""
import io
import json
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bulk_sources as bulk


def record(**extra):
    return dict(ftpDir='Composer/Piece', id='source.ly', main='source.ly',
                rightsAllowed=True, midiFiles=[], **extra)


def serve(monkeypatch, tmp_path, files):
    monkeypatch.setattr(bulk, 'ROOT', tmp_path)
    monkeypatch.setattr(bulk, 'CACHE', tmp_path / 'cache')
    requests = []

    def get(url, target):
        requests.append(target.name)
        data = files[target.name]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return data

    monkeypatch.setattr(bulk, 'get', get)
    return requests


def rdf(license_name):
    return ('<r xmlns="http://www.mutopiaproject.org/piece-data/0.1/">'
            f'<licence>{license_name}</licence></r>').encode()


@pytest.mark.parametrize('metadata,expected', [
    (None, 'missing-rights-metadata'),
    ('Attribution-NonCommercial-ShareAlike 4.0', 'excluded-rights'),
])
def test_source_header_does_not_authorize_download_without_canonical_rights(
        monkeypatch, tmp_path, metadata, expected):
    files = {'index.html': b'<a href="piece.mid">MIDI</a>'}
    if metadata:
        files['index.html'] += b'<a href="piece.rdf">RDF</a>'
        files['piece.rdf'] = rdf(metadata)
    requests = serve(monkeypatch, tmp_path, files)
    result = bulk.hydrate(record())
    assert result['status'] == expected
    assert result['rightsAllowed'] is False
    assert result['midiFiles'] == []
    assert 'piece.mid' not in requests


def test_canonical_rights_precede_midi_and_reject_invalid_payload(monkeypatch, tmp_path):
    requests = serve(monkeypatch, tmp_path, {
        'index.html': b'<a href="piece.mid">MIDI</a><a href="piece.rdf">RDF</a>',
        'piece.rdf': rdf('Public Domain'), 'piece.mid': b'<html>error</html>',
    })
    result = bulk.hydrate(record())
    assert requests == ['index.html', 'piece.rdf', 'piece.mid']
    assert result['status'] == 'download-error'
    assert result['midiFiles'] == []


def test_archive_cannot_write_outside_edition_cache(monkeypatch, tmp_path):
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w') as zipped:
        zipped.writestr('../../../escape.mid', b'MThd\x00\x00')
    serve(monkeypatch, tmp_path, {
        'index.html': b'<a href="piece-mids.zip">MIDI</a><a href="piece.rdf">RDF</a>',
        'piece.rdf': rdf('Public Domain'), 'piece-mids.zip': archive.getvalue(),
    })
    result = bulk.hydrate(record())
    assert result['status'] == 'download-error'
    assert 'unsafe archive path' in result['error']
    assert not list(tmp_path.rglob('escape.mid'))


def test_alternative_mains_share_one_download_without_losing_identity(monkeypatch):
    seen = []

    def hydrate(row):
        seen.append(row['ftpDir'])
        return {**row, 'status': 'acquired', 'rdfLicense': 'Public Domain',
                'midiFiles': ['shared.mid'], 'downloadFiles': []}

    monkeypatch.setattr(bulk, 'hydrate', hydrate)
    first = record()
    second = {**first, 'id': 'letter.ly', 'main': 'letter.ly'}
    results = bulk.hydrate_all([first, second])
    assert seen == ['Composer/Piece']
    assert [row['main'] for row in results] == ['source.ly', 'letter.ly']
    assert all(row['midiFiles'] == ['shared.mid'] for row in results)
    assert first['midiFiles'] == []


def test_save_and_refresh_regenerate_catalog_admission(monkeypatch, tmp_path):
    monkeypatch.setattr(bulk, 'ROOT', tmp_path)
    monkeypatch.setattr(bulk, 'CACHE', tmp_path / 'cache')
    monkeypatch.setattr(bulk, 'OUTPUT', tmp_path / 'bulk-candidates.json')
    fragment = tmp_path / 'content/tools/catalog.d/expansion-bulk.json'
    fragment.parent.mkdir(parents=True)
    fragment.write_text(json.dumps({'pieces': [{'ftpDir': 'Composer/Piece', 'main': 'source.ly', 'slug': 'accepted'}], 'rejected': []}))
    rows = [record(instrument='Piano', composer='Composer', status='acquired', existingCatalogDirectory=False)]
    rows[0]['id'] = 'Composer/Piece/source.ly'
    bulk.save(rows)
    first = json.loads(bulk.OUTPUT.read_text())
    assert first['admissionSummary']['acceptedNewLibraryPieces'] == 1
    assert first['candidates'][0]['admission']['selectedSourceMain'] is True
    assert first['candidates'][0]['status'] == 'acquired'
    fragment.write_text(json.dumps({'pieces': [], 'rejected': [{'ftpDir': 'Composer/Piece', 'slug': 'accepted', 'reason': 'unsupported notation'}]}))
    monkeypatch.setattr(sys, 'argv', ['bulk_sources.py', '--refresh'])
    bulk.main()
    refreshed = json.loads(bulk.OUTPUT.read_text())
    assert refreshed['admissionSummary']['acceptedNewLibraryPieces'] == 0
    assert refreshed['admissionSummary']['heldSourceDirectories'] == 1
    assert refreshed['candidates'][0]['admission']['reason'] == 'unsupported notation'
    assert refreshed['candidates'][0]['status'] == 'acquired'
