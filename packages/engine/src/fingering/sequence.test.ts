import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../io/musicxml/read.js';
import { parsePig } from '../io/pig/read.js';
import { buildHandSequence, GRACE_IOI_SEC } from './sequence.js';

const H = '//Version: PianoFingering_v170101\n';
const pig = (rows: Array<[number, number, string, number]>) =>
  H +
  rows.map(([on, off, p, ch], i) => `${i}\t${on}\t${off}\t${p}\t80\t80\t${ch}\t0`).join('\n') +
  '\n';

describe('buildHandSequence', () => {
  it('orders right-hand chords by ascending pitch and left-hand chords by ascending mirrored pitch', () => {
    const { score } = parsePig(
      pig([
        [0, 1, 'C4', 0],
        [0, 1, 'G4', 0],
        [0, 1, 'E4', 0],
        [0, 1, 'C3', 1],
        [0, 1, 'G3', 1],
        [0, 1, 'E3', 1],
      ]),
    );
    const r = buildHandSequence(score, 'R');
    expect(r.notes.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(r.notes.map((n) => n.pitch)).toEqual([60, 64, 67]);
    const l = buildHandSequence(score, 'L');
    expect(l.notes.map((n) => n.midi)).toEqual([55, 52, 48]);
    expect(l.notes.map((n) => n.pitch)).toEqual([69, 72, 76]);
    expect(l.notes.every((n) => n.slice === 0)).toBe(true);
    expect(l.sliceCount).toBe(1);
  });
  it('computes inter-onset intervals and rests', () => {
    const { score } = parsePig(
      pig([
        [0, 0.5, 'C4', 0],
        [0.5, 1, 'D4', 0],
        [1, 1.25, 'E4', 0],
        [2, 2.5, 'F4', 0],
        [2, 3, 'A4', 0],
      ]),
    );
    const s = buildHandSequence(score, 'R');
    expect(s.notes.map((n) => n.slice)).toEqual([0, 1, 2, 3, 3]);
    expect(s.notes.map((n) => n.ioi)).toEqual([0, 0.5, 0.5, 1, 1]);
    expect(s.notes.map((n) => n.restBefore)).toEqual([false, false, false, true, true]);
  });
  it('does not flag a rest when an earlier note is still sounding', () => {
    const { score } = parsePig(
      pig([
        [0, 3, 'C3', 0],
        [1, 1.5, 'E4', 0],
        [2.5, 3, 'G4', 0],
      ]),
    );
    const s = buildHandSequence(score, 'R');
    expect(s.notes.map((n) => n.restBefore)).toEqual([false, false, false]);
  });
  it('gives a grace note its own slice before the principal', () => {
    const xml = readFileSync(
      fileURLToPath(new URL('../../fixtures/two-staff.musicxml', import.meta.url)),
      'utf8',
    );
    const { score } = parseMusicXml(xml);
    const s = buildHandSequence(score, 'R');
    const grace = s.notes.find((n) => n.isGrace)!;
    const principal = s.notes[grace.index + 1]!;
    expect(grace.midi).toBe(66);
    expect(principal.midi).toBe(67);
    expect(principal.slice).toBe(grace.slice + 1);
    expect(principal.ioi).toBe(GRACE_IOI_SEC);
    expect(new Set(s.notes.map((n) => n.slice)).size).toBe(s.sliceCount);
  });
  it('mirrors black keys onto black keys', () => {
    const { score } = parsePig(
      pig([
        [0, 1, 'C#3', 1],
        [1, 2, 'D3', 1],
      ]),
    );
    const s = buildHandSequence(score, 'L');
    expect(s.notes.map((n) => n.black)).toEqual([true, false]);
    expect(s.notes.map((n) => n.pitch)).toEqual([75, 74]);
  });
});
