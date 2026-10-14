import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFingerField, parsePig } from './read.js';
import { writePig } from './write.js';

const fixture = readFileSync(
  fileURLToPath(new URL('../../../fixtures/pig-sample.txt', import.meta.url)),
  'utf8',
);

describe('parsePig', () => {
  it('reads notes, hands, fingers and substitutions', () => {
    const { score, assignment, warnings } = parsePig(fixture);
    expect(warnings).toEqual([]);
    expect(score.notes).toHaveLength(6);
    const byId = Object.fromEntries(score.notes.map((n) => [n.id, n]));
    expect(byId['0']!.midi).toBe(60);
    expect(byId['0']!.hand).toBe('R');
    expect(byId['3']!.hand).toBe('L');
    expect(byId['3']!.onsetSec).toBe(0);
    expect(byId['3']!.offsetSec).toBe(1);
    expect(byId['1']!.onsetTick).toBe(480);
    expect(byId['0']!.velocity).toBe(80);
    expect(assignment['0']).toEqual({ finger: 1, source: 'editorial' });
    expect(assignment['2']).toEqual({ finger: 3, substitution: 1, source: 'editorial' });
    expect(assignment['3']).toEqual({ finger: 5, source: 'editorial' });
    expect(assignment['5']).toEqual({ finger: 5, substitution: 4, source: 'editorial' });
  });
  it('groups simultaneous notes of one hand into a chord', () => {
    const { score } = parsePig(fixture);
    const c3 = score.notes.find((n) => n.id === '3')!;
    const e3 = score.notes.find((n) => n.id === '4')!;
    expect(c3.chordId).toBe(e3.chordId);
  });
  it('accepts CRLF line endings and spaces instead of tabs', () => {
    const text = fixture.replace(/\n/g, '\r\n').replace(/\t/g, '  ');
    expect(parsePig(text).score.notes).toHaveLength(6);
  });
  it('warns when the finger sign disagrees with the channel and keeps the channel', () => {
    const text = `${fixture.split('\n')[0]}\n0\t0\t0.5\tC4\t80\t80\t0\t-2\n`;
    const { score, assignment, warnings } = parsePig(text);
    expect(score.notes[0]!.hand).toBe('R');
    expect(assignment['0']!.finger).toBe(2);
    expect(warnings).toHaveLength(1);
  });
  it('leaves notes without a usable finger unassigned', () => {
    const text = `${fixture.split('\n')[0]}\n0\t0\t0.5\tC4\t80\t80\t0\t0\n`;
    const { assignment } = parsePig(text);
    expect(assignment['0']).toBeUndefined();
  });
  it('treats finger 0 as unfingered: the note exists, the assignment has no entry', () => {
    const text =
      '//Version: PianoFingering_v170101\n0\t0\t0.5\tC4\t80\t80\t0\t0\n1\t0.5\t1\tD4\t80\t80\t0\t2\n2\t1\t1.5\tC3\t80\t80\t1\t-0\n';
    const { score, assignment, warnings } = parsePig(text);
    expect(score.notes).toHaveLength(3);
    expect(Object.keys(assignment)).toHaveLength(1);
    expect(assignment[score.notes.find((n) => n.midi === 62)!.id]!.finger).toBe(2);
    // An unfingered note carries no sign, so it never triggers the wrong-sign warning.
    expect(warnings).toEqual([]);
  });
  it('rejects malformed lines with the line number', () => {
    expect(() => parsePig('//h\n0\t0\t0.5\tC4\n')).toThrow(/line 2/);
  });
  it('keeps the exact seconds from the file rather than tick-rounded ones', () => {
    const text = `${fixture.split('\n')[0]}\n0\t0.156289\t0.4591\tC4\t64\t80\t0\t1\n`;
    const { score } = parsePig(text);
    expect(score.notes[0]!.onsetSec).toBe(0.156289);
    expect(score.notes[0]!.offsetSec).toBe(0.4591);
    expect(score.notes[0]!.onsetTick).toBe(150);
  });
});

describe('parseFingerField', () => {
  it('parses plain, negative and substitution fields', () => {
    expect(parseFingerField('3', 'R')).toEqual({ finger: 3 });
    expect(parseFingerField('-3', 'L')).toEqual({ finger: 3 });
    expect(parseFingerField('3_1', 'R')).toEqual({ finger: 3, substitution: 1 });
    expect(parseFingerField('-5_-4', 'L')).toEqual({ finger: 5, substitution: 4 });
  });
  it('reads 0, -0 and the unlabeled marks of the Python reference as no finger', () => {
    // research/fingering_eval/validate.py UNLABELED = {"0", "x", "X", "?", "-0"}.
    for (const t of ['0', '-0', 'x', 'X', '?', '0_2', '-0_-2']) {
      expect(parseFingerField(t, 'R')).toEqual({});
      expect(parseFingerField(t, 'L')).toEqual({});
    }
  });
});

describe('writePig', () => {
  it('round-trips the fixture', () => {
    const first = parsePig(fixture);
    const text = writePig(first.score, first.assignment);
    const second = parsePig(text);
    expect(
      second.score.notes.map((n) => [n.id, n.midi, n.hand, n.onsetSec, n.offsetSec, n.velocity]),
    ).toEqual(
      first.score.notes.map((n) => [n.id, n.midi, n.hand, n.onsetSec, n.offsetSec, n.velocity]),
    );
    expect(second.assignment).toEqual(first.assignment);
    expect(text.startsWith('//Version: PianoFingering_v170101\n')).toBe(true);
    expect(text.split('\n')[3]).toMatch(/^2\t1(\.0+)?\t1\.5(0+)?\tE4\t80\t80\t0\t3_1$/);
  });
  it('round-trips real-file seconds with up to 8 decimals unchanged', () => {
    const text = `${fixture.split('\n')[0]}\n0\t0.15628912\t0.4591\tC4\t64\t80\t0\t1\n`;
    const first = parsePig(text);
    const line = writePig(first.score, first.assignment).split('\n')[1]!;
    expect(line.split('\t').slice(1, 3)).toEqual(['0.15628912', '0.4591']);
  });
  it('writes left-hand fingers negative and unassigned notes as 0', () => {
    const { score } = parsePig(fixture);
    const text = writePig(score, { '3': { finger: 2, source: 'engine' } });
    const lines = text.trim().split('\n');
    expect(lines[4]!.endsWith('\t1\t-2')).toBe(true);
    expect(lines[1]!.endsWith('\t0\t0')).toBe(true);
  });
  it('keeps the original line order', () => {
    const { score, assignment } = parsePig(fixture);
    const ids = writePig(score, assignment)
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => l.split('\t')[0]);
    expect(ids).toEqual(['0', '1', '2', '3', '4', '5']);
  });
});
