// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { declareUtf8, handle } from './handlers.js';
import { sourceKind } from './protocol.js';

const bytes = new Uint8Array(
  readFileSync(new URL('../../fixtures/short-piano.musicxml', import.meta.url)),
);

function load() {
  const r = handle({
    id: 1,
    type: 'load',
    kind: 'musicxml',
    input: bytes,
    source: 'short-piano.musicxml',
  });
  if (!r.ok || r.type !== 'load') throw new Error('load failed');
  return r;
}

describe('engine handlers', () => {
  it('refuses repaired notation only for explicit scan imports', () => {
    const input =
      '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><tie type="stop"/><voice>1</voice></note></measure></part></score-partwise>';
    const request = {
      id: 1,
      type: 'load' as const,
      kind: 'musicxml' as const,
      input,
      source: 'scan.musicxml',
    };
    expect(handle(request).ok).toBe(true);
    expect(handle({ ...request, preserveNotation: true }).ok).toBe(false);
  });
  it('loads the fixture: 67 notes, 67 editorial fingerings, the XML text', () => {
    const r = load();
    expect(r.score.notes).toHaveLength(67);
    expect(Object.keys(r.editorial)).toHaveLength(67);
    expect(r.xml).toContain('<score-partwise');
    expect(r.warnings).toEqual([]);
  });
  it('solves every note with a finger 1..5, deterministically', () => {
    const { score } = load();
    const a = handle({ id: 2, type: 'solve', score, profile: 'medium' });
    const b = handle({ id: 3, type: 'solve', score, profile: 'medium' });
    if (!a.ok || a.type !== 'solve' || !b.ok || b.type !== 'solve') throw new Error('solve failed');
    expect(Object.keys(a.assignment)).toHaveLength(67);
    for (const n of score.notes) expect([1, 2, 3, 4, 5]).toContain(a.assignment[n.id]!.finger);
    expect(a.assignment).toEqual(b.assignment);
    expect(a.ms).toBeGreaterThanOrEqual(0);
  });
  it('respects pins', () => {
    const { score } = load();
    const first = score.notes[0]!;
    const r = handle({
      id: 4,
      type: 'solve',
      score,
      profile: 'medium',
      pins: { [first.id]: { finger: 4, pinned: true, source: 'user' } },
    });
    if (!r.ok || r.type !== 'solve') throw new Error('solve failed');
    expect(r.assignment[first.id]!.finger).toBe(4);
  });
  it('writes the assignment into the XML', () => {
    const { score, xml } = load();
    const solved = handle({ id: 5, type: 'solve', score, profile: 'medium' });
    if (!solved.ok || solved.type !== 'solve') throw new Error('solve failed');
    const r = handle({ id: 6, type: 'fingeredXml', xml, score, assignment: solved.assignment });
    if (!r.ok || r.type !== 'fingeredXml') throw new Error('inject failed');
    expect(r.xml.match(/<fingering/g)).toHaveLength(67);
  });
  it('declares UTF-8 in the text of a UTF-16 file, so the export is read as what it is', () => {
    const text = new TextDecoder().decode(bytes).replace('encoding="UTF-8"', 'encoding="UTF-16"');
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    const be = Buffer.from(le);
    be.swap16(); // the same text, big-endian, with the BOM FE FF
    for (const [name, input] of [
      ['le.musicxml', le],
      ['be.musicxml', be],
    ] as const) {
      const r = handle({
        id: 8,
        type: 'load',
        kind: 'musicxml',
        input: new Uint8Array(input),
        source: name,
      });
      if (!r.ok || r.type !== 'load') throw new Error(`${name}: load failed`);
      expect(r.score.notes, name).toHaveLength(67);
      expect(r.xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="no"?>'), name).toBe(
        true,
      );
      const solved = handle({ id: 9, type: 'solve', score: r.score, profile: 'medium' });
      if (!solved.ok || solved.type !== 'solve') throw new Error('solve failed');
      const out = handle({
        id: 10,
        type: 'fingeredXml',
        xml: r.xml,
        score: r.score,
        assignment: solved.assignment,
      });
      if (!out.ok || out.type !== 'fingeredXml') throw new Error('inject failed');
      expect(out.xml, name).toMatch(/^<\?xml[^>]*encoding="UTF-8"/);
      expect(out.xml, name).not.toMatch(/UTF-16/i);
    }
  });
  it('leaves a declaration without an encoding, and a document without a declaration, alone', () => {
    expect(declareUtf8('<?xml version="1.0"?><a encoding="x"/>')).toBe(
      '<?xml version="1.0"?><a encoding="x"/>',
    );
    expect(declareUtf8("<?xml version='1.0' encoding='ISO-8859-1'?><a/>")).toBe(
      "<?xml version='1.0' encoding='UTF-8'?><a/>",
    );
    expect(declareUtf8('<score-partwise/>')).toBe('<score-partwise/>');
  });
  it('turns a bad input into an error response with the request id', () => {
    const r = handle({
      id: 7,
      type: 'load',
      kind: 'musicxml',
      input: 'this is not xml',
      source: 'bad.xml',
    });
    expect(r.ok).toBe(false);
    expect(r.id).toBe(7);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
});

const midi = new Uint8Array(readFileSync(new URL('../../fixtures/twinkle.mid', import.meta.url)));

describe('engine handlers: MIDI', () => {
  it('loads a MIDI file as generated MusicXML with two hands and 64 notes', () => {
    const r = handle({ id: 11, type: 'load', kind: 'midi', input: midi, source: 'twinkle.mid' });
    if (!r.ok || r.type !== 'load') throw new Error(r.ok ? 'wrong response type' : r.error);
    expect(r.score.notes).toHaveLength(64);
    const right = r.score.notes.filter((n) => n.hand === 'R').length;
    expect(right).toBeGreaterThan(0);
    expect(64 - right).toBeGreaterThan(0);
    expect(Math.abs(right - 42)).toBeLessThanOrEqual(2);
    expect(r.xml).toContain('<work-title>twinkle</work-title>');
    for (const n of r.score.notes) expect(r.xml).toContain(`<note id="${n.id}">`);
    expect(r.editorial).toEqual({});
    expect(r.midiInfo).toMatchObject({ quantizedMovedShare: 0, splitMidi: null });
  });
  it('honours a fixed hand split and runs the rest of the pipeline unchanged', () => {
    const r = handle({
      id: 12,
      type: 'load',
      kind: 'midi',
      input: midi,
      source: 'twinkle.mid',
      splitMidi: 60,
    });
    if (!r.ok || r.type !== 'load') throw new Error(r.ok ? 'wrong response type' : r.error);
    expect(r.score.notes.filter((n) => n.hand === 'R')).toHaveLength(42);
    expect(r.midiInfo?.splitMidi).toBe(60);
    expect(r.warnings).toEqual([]);
    const solved = handle({ id: 13, type: 'solve', score: r.score, profile: 'medium' });
    if (!solved.ok || solved.type !== 'solve') throw new Error('solve failed');
    expect(Object.keys(solved.assignment)).toHaveLength(64);
    const out = handle({
      id: 14,
      type: 'fingeredXml',
      xml: r.xml,
      score: r.score,
      assignment: solved.assignment,
    });
    if (!out.ok || out.type !== 'fingeredXml') throw new Error('inject failed');
    expect(out.xml.match(/<fingering/g)).toHaveLength(64);
  });
  it('answers a MusicXML load with midiInfo null', () => {
    const r = handle({
      id: 15,
      type: 'load',
      kind: 'musicxml',
      input: bytes,
      source: 'short-piano.musicxml',
    });
    if (!r.ok || r.type !== 'load') throw new Error('load failed');
    expect(r.midiInfo).toBeNull();
  });
  it('reports a broken MIDI file as an error response', () => {
    const r = handle({
      id: 16,
      type: 'load',
      kind: 'midi',
      input: new TextEncoder().encode('MThd'),
      source: 'broken.mid',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^not a MIDI file/);
  });
  it('decides the kind from the file name', () => {
    expect(sourceKind('Tune.MID')).toBe('midi');
    expect(sourceKind('a.midi')).toBe('midi');
    expect(sourceKind('a.musicxml')).toBe('musicxml');
    expect(sourceKind('a.mxl')).toBe('musicxml');
  });
});
