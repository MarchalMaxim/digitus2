import { parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { parseScanXml, readScanScore } from '../scan/notes.js';
import type { Rhythm } from './rhythm.js';
import { quantise } from './rhythm.js';
import { notesOf } from './notes.js';
import { pitchTrack } from './pitch.js';
import { toMusicXml } from './musicxml.js';
import { ODE_TO_JOY, perform, synthesize, TWINKLE } from './testing/synth.js';

const rhythm = (
  notes: [midi: number, start: number, length: number][],
  extra: Partial<Rhythm> = {},
): Rhythm => ({
  bpm: 100,
  key: { fifths: 0, mode: 'major' },
  notes: notes.map(([midi, start, length]) => ({ midi, start, length })),
  ...extra,
});

/** The notes as the app's strict import reads them, in quarter notes. */
function imported(xml: string) {
  const { score } = parseMusicXml(xml, { preserveNotation: true });
  return score.notes.map((n) => ({
    midi: n.midi,
    start: n.onsetTick / score.divisions,
    length: (n.offsetTick - n.onsetTick) / score.divisions,
  }));
}

describe('toMusicXml', () => {
  it('writes notes the strict import reads back with their pitches and lengths', () => {
    const xml = toMusicXml(
      rhythm([
        [64, 0, 4],
        [65, 4, 2],
        [67, 6, 2],
        [69, 8, 6],
        [71, 14, 2],
      ]),
    );
    expect(imported(xml)).toEqual([
      { midi: 64, start: 0, length: 1 },
      { midi: 65, start: 1, length: 0.5 },
      { midi: 67, start: 1.5, length: 0.5 },
      { midi: 69, start: 2, length: 1.5 },
      { midi: 71, start: 3.5, length: 0.5 },
    ]);
  });

  it('ties a note across the barline into one sounding note', () => {
    const xml = toMusicXml(rhythm([[60, 12, 8]]));
    expect(imported(xml)).toEqual([{ midi: 60, start: 3, length: 2 }]);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    expect([...doc.querySelectorAll('tie')].map((t) => t.getAttribute('type'))).toEqual([
      'start',
      'stop',
    ]);
  });

  it('writes lengths that no one note shows as tied notes', () => {
    const xml = toMusicXml(
      rhythm([
        [60, 0, 5],
        [62, 5, 7],
      ]),
    );
    expect(imported(xml)).toEqual([
      { midi: 60, start: 0, length: 1.25 },
      { midi: 62, start: 1.25, length: 1.75 },
    ]);
  });

  it('fills the gaps with rests and completes the last bar', () => {
    const xml = toMusicXml(
      rhythm([
        [60, 0, 4],
        [62, 12, 4],
        [64, 16, 4],
      ]),
    );
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const measures = [...doc.querySelectorAll('measure')];
    expect(measures).toHaveLength(2);
    for (const measure of measures) {
      const sum = [...measure.querySelectorAll('note > duration')].reduce(
        (total, d) => total + Number(d.textContent),
        0,
      );
      expect(sum).toBe(16);
    }
    expect(doc.querySelectorAll('note > rest').length).toBeGreaterThan(1);
    expect(imported(xml).map((n) => n.start)).toEqual([0, 3, 4]);
  });

  it('states the key, the meter, the tempo, a treble clef and a final barline', () => {
    const xml = toMusicXml(rhythm([[66, 0, 4]], { bpm: 88, key: { fifths: 2, mode: 'major' } }));
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    expect(doc.querySelector('part-name')?.textContent).toBe('Piano');
    expect(doc.querySelector('key > fifths')?.textContent).toBe('2');
    expect(doc.querySelector('time > beats')?.textContent).toBe('4');
    expect(doc.querySelector('time > beat-type')?.textContent).toBe('4');
    expect(doc.querySelector('clef > sign')?.textContent).toBe('G');
    expect(doc.querySelector('sound')?.getAttribute('tempo')).toBe('88');
    expect(doc.querySelector('barline > bar-style')?.textContent).toBe('light-heavy');
    expect(doc.querySelector('pitch > step')?.textContent).toBe('F');
    expect(doc.querySelector('pitch > alter')?.textContent).toBe('1');
  });

  it('spells black keys with flats in a flat key and with sharps otherwise', () => {
    const spell = (fifths: number) => {
      const doc = new DOMParser().parseFromString(
        toMusicXml(rhythm([[70, 0, 4]], { key: { fifths, mode: 'major' } })),
        'text/xml',
      );
      return [
        doc.querySelector('pitch > step')?.textContent,
        doc.querySelector('pitch > alter')?.textContent,
      ];
    };
    expect(spell(-1)).toEqual(['B', '-1']);
    expect(spell(1)).toEqual(['A', '1']);
  });

  it('writes an accidental where a note is not what the key and the bar have in force', () => {
    const marks = (notes: [number, number, number][], key: Rhythm['key']) => {
      const doc = new DOMParser().parseFromString(toMusicXml(rhythm(notes, { key })), 'text/xml');
      return [...doc.querySelectorAll('note')].map(
        (n) => n.querySelector('accidental')?.textContent ?? '',
      );
    };
    const major = { fifths: 0, mode: 'major' } as const;
    // C sharp, again C sharp (held in the bar), C natural; then C sharp in the next bar. Verovio
    // draws a sharp for any note off the key without the element; the element is for the rest.
    expect(
      marks(
        [
          [61, 0, 4],
          [61, 4, 4],
          [60, 8, 4],
          [62, 12, 4],
          [61, 16, 4],
        ],
        major,
      ).slice(0, 5),
    ).toEqual(['sharp', '', 'natural', '', 'sharp']);
    // In G major F sharp is in the signature and F natural is not.
    expect(
      marks(
        [
          [66, 0, 4],
          [65, 4, 4],
        ],
        { fifths: 1, mode: 'major' },
      ).slice(0, 2),
    ).toEqual(['', 'natural']);
    // In F major B flat is in the signature and B natural is not.
    expect(
      marks(
        [
          [70, 0, 4],
          [71, 4, 4],
        ],
        { fifths: -1, mode: 'major' },
      ).slice(0, 2),
    ).toEqual(['', 'natural']);
    // A rest, then a C sharp tied over the barline: it shows its sharp once, not again after the tie.
    expect(marks([[61, 12, 8]], major).slice(0, 3)).toEqual(['', 'sharp', '']);
  });

  it('is read by the scanning review as it reads a scan: one part, one staff, the same notes', () => {
    const xml = toMusicXml(
      rhythm([
        [60, 0, 4],
        [62, 4, 4],
        [64, 8, 8],
      ]),
    );
    const score = readScanScore(parseScanXml(xml));
    const notes = score.notes.filter((n) => !n.rest);
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 64]);
    expect(new Set(notes.map((n) => n.part)).size).toBe(1);
    expect(notes.every((n) => n.staves === 1)).toBe(true);
    expect(score.bars).toHaveLength(1);
  });

  it('carries a whole whistled tune through the import', () => {
    for (const melody of [ODE_TO_JOY, TWINKLE]) {
      const { tones, written } = perform(melody, { rubato: 0.05 });
      const samples = synthesize(tones, { sampleRate: 16000, vibratoCents: 25, noiseDb: -30 });
      const xml = toMusicXml(quantise(notesOf(pitchTrack(samples, 16000))));
      expect(imported(xml)).toEqual(
        written.map((w) => ({ midi: w.midi, start: w.beat, length: w.beats })),
      );
    }
  });

  it('writes a score for no notes that is still a bar of rest', () => {
    const doc = new DOMParser().parseFromString(toMusicXml(rhythm([])), 'text/xml');
    expect(doc.querySelectorAll('measure')).toHaveLength(1);
    expect(doc.querySelectorAll('note > pitch')).toHaveLength(0);
  });
});
