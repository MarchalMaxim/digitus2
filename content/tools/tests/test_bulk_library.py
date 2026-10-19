"""Admission invariants specific to the full-edition bulk source batch."""
import json
from pathlib import Path

import pytest

CONTENT = Path(__file__).resolve().parents[2]
CATALOG = json.loads((CONTENT / 'tools/catalog.d/expansion-bulk.json').read_text(encoding='utf-8'))
VERIFICATION = json.loads((CONTENT / 'verification.json').read_text(encoding='utf-8'))
MANIFEST = json.loads((CONTENT / 'manifest.json').read_text(encoding='utf-8'))


@pytest.mark.parametrize('piece', CATALOG['pieces'], ids=lambda piece: piece['slug'])
def test_complete_editions_have_independent_published_midi_evidence(piece):
    record = VERIFICATION[piece['slug']]
    for origin in ('lilypond224Midi', 'mutopiaMidi'):
        comparison = record['midiChecks'][origin]
        assert comparison['exact'] is True, (piece['slug'], origin)
        assert comparison['only_xml_count'] == comparison['only_midi_count'] == 0
        assert comparison['matched'] > 0
    assert piece['publishedMidi']
    assert not piece.get('excerpt')
    assert not piece.get('convert')
    assert len(piece['sourceSha256']) == 64
    assert piece.get('fidelityReview'), 'MIDI equality alone cannot verify score notation'


def test_held_editions_do_not_leak_into_the_playable_library():
    accepted = {piece['slug'] for piece in CATALOG['pieces']}
    held = {piece['slug'] for piece in CATALOG['rejected']}
    playable = {piece['slug'] for piece in MANIFEST}
    assert len(accepted) == 115
    assert len(held) == 404
    assert accepted <= playable
    assert held.isdisjoint(playable)
    assert accepted.isdisjoint(held)
