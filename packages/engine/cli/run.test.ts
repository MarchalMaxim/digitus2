import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadScore } from './inspect.js';
import { main } from './run.js';
import type { CliIo } from './run.js';

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, out, err };
}

const fixture = fileURLToPath(new URL('../fixtures/two-staff.musicxml', import.meta.url));
const pigSample = fileURLToPath(new URL('../fixtures/pig-sample.txt', import.meta.url));

describe('cli main', () => {
  it('reports a missing file as one prefixed line and exit code 1', () => {
    const c = capture();
    expect(main(['inspect', 'no/such/file.musicxml'], c.io)).toBe(1);
    expect(c.out).toEqual([]);
    expect(c.err).toHaveLength(1);
    expect(c.err[0]).toMatch(/^digitus2: ENOENT.*\n$/);
  });
  it('reports an unknown option as one prefixed line and exit code 1', () => {
    const c = capture();
    expect(main(['eval', '--nope'], c.io)).toBe(1);
    expect(c.err).toHaveLength(1);
    expect(c.err[0]).toMatch(/^digitus2: .*--nope/);
  });
  it('prints usage and exits 2 without a command', () => {
    const c = capture();
    expect(main([], c.io)).toBe(2);
    expect(c.err.join('')).toContain('digitus2 <command>');
  });
  it('inspects a MusicXML file', () => {
    const c = capture();
    expect(main(['inspect', fixture], c.io)).toBe(0);
    expect(c.err).toEqual([]);
    expect(c.out.join('')).toContain('title:     Fixture');
  });
});

const H = '//Version: PianoFingering_v170101\n';
/** One PIG line per [pitch, finger, onset?]; onsets default to 0.5 s apart, right hand. */
const pig = (notes: Array<[string, string, number?]>) =>
  H +
  notes
    .map(([p, f, on], i) => {
      const t = on ?? i * 0.5;
      return `${i}\t${t}\t${t + 0.5}\t${p}\t80\t80\t${f.startsWith('-') ? 1 : 0}\t${f}`;
    })
    .join('\n') +
  '\n';
const scale = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const scalePig = (fingers: number[]) => pig(scale.map((p, i) => [p, String(fingers[i])]));
const tmp = () => mkdtempSync(join(tmpdir(), 'digitus2-cli-'));

/** A two-piece gold set (001 matches the engine's C major fingering, 002 does not). */
function toyBench(engine: null | Record<string, number>): { root: string; args: string[] } {
  const root = tmp();
  const gold = join(root, 'gold', 'FingeringFiles');
  mkdirSync(gold, { recursive: true });
  writeFileSync(join(gold, '001-1_fingering.txt'), scalePig([1, 2, 3, 1, 2, 3, 4, 5]));
  writeFileSync(join(gold, '001-2_fingering.txt'), scalePig([1, 2, 3, 1, 2, 3, 4, 5]));
  writeFileSync(join(gold, '002-1_fingering.txt'), scalePig([1, 2, 3, 4, 1, 2, 3, 4]));
  const split = join(root, 'split.json');
  writeFileSync(
    split,
    JSON.stringify({ default_split: 'toy', splits: { toy: { test: { pieces: ['001', '002'] } } } }),
  );
  const floor = join(root, 'floor.json');
  writeFileSync(floor, JSON.stringify({ engine }));
  const args = ['bench', '--gold', join(root, 'gold'), '--split', split, '--floor', floor];
  return { root, args: [...args, '--out', join(root, 'runs'), '--label', 'toy'] };
}

describe('cli finger', () => {
  it('lists finger, lint and bench in the usage', () => {
    const c = capture();
    expect(main([], c.io)).toBe(2);
    const usage = c.err.join('');
    expect(usage).toMatch(/^ +finger <file>/m);
    expect(usage).toMatch(/^ +lint <file>/m);
    expect(usage).toMatch(/^ +bench --gold/m);
  });
  it('fingers a MusicXML file as PIG with a signed finger on every note', () => {
    const c = capture();
    expect(main(['finger', fixture, '--format', 'pig'], c.io)).toBe(0);
    expect(c.err).toEqual([]);
    const lines = c.out.join('').trim().split('\n');
    expect(lines[0]).toBe('//Version: PianoFingering_v170101');
    expect(lines).toHaveLength(1 + loadScore(fixture).notes.length);
    for (const line of lines.slice(1)) {
      const cols = line.split('\t');
      expect(cols[7]).toMatch(cols[6] === '1' ? /^-[1-5]$/ : /^[1-5]$/);
    }
  });
  it('writes MusicXML with one fingering per sounding note to --out', () => {
    const out = join(tmp(), 'out.musicxml');
    const c = capture();
    expect(main(['finger', fixture, '--out', out], c.io)).toBe(0);
    expect(c.out).toEqual([]);
    const text = readFileSync(out, 'utf8');
    expect(text.match(/<fingering[ >]/g)).toHaveLength(loadScore(fixture).notes.length);
  });
  it('fingers a PIG file as PIG and pins its own fingers only with --editorial', () => {
    const file = join(tmp(), 'run.txt');
    writeFileSync(file, pig(scale.slice(0, 5).map((p, i) => [p, i === 0 ? '5' : '0'])));
    const finger0 = (args: string[]) => {
      const c = capture();
      expect(main(['finger', file, ...args], c.io)).toBe(0);
      const lines = c.out.join('').trim().split('\n');
      expect(lines).toHaveLength(6);
      return lines[1]!.split('\t')[7];
    };
    expect(finger0(['--editorial'])).toBe('5');
    expect(finger0([])).toBe('1');
  });
  it('rejects MusicXML output for PIG input and unknown option values', () => {
    const c = capture();
    expect(main(['finger', pigSample, '--format', 'musicxml'], c.io)).toBe(1);
    expect(c.err.join('')).toContain('musicxml output needs MusicXML input');
    expect(main(['finger', fixture, '--profile', 'huge'], capture().io)).toBe(2);
    expect(main(['finger', fixture, '--hand', 'X'], capture().io)).toBe(2);
    expect(main(['finger', fixture, '--format', 'abc'], capture().io)).toBe(2);
    expect(main(['finger'], capture().io)).toBe(2);
  });
  it('fingers only the requested hand', () => {
    const c = capture();
    expect(main(['finger', fixture, '--format', 'pig', '--hand', 'R'], c.io)).toBe(0);
    for (const line of c.out.join('').trim().split('\n').slice(1)) {
      const cols = line.split('\t');
      expect(cols[7] === '0').toBe(cols[6] === '1');
    }
  });
});

describe('cli lint', () => {
  it('lints a file and exits 1 on an error-severity issue', () => {
    const file = join(tmp(), 'chord.txt');
    // C4 and E4 struck together with the same finger: L01.
    writeFileSync(
      file,
      pig([
        ['C4', '1', 0],
        ['E4', '1', 0],
      ]),
    );
    const c = capture();
    expect(main(['lint', file], c.io)).toBe(1);
    const text = c.out.join('');
    expect(text).toMatch(/^2 notes: [1-9]\d* errors/);
    expect(text).toMatch(/^L01: 1$/m);
    const j = capture();
    expect(main(['lint', file, '--json'], j.io)).toBe(1);
    const report = JSON.parse(j.out.join('')) as { errors: number; counts: { L01?: number } };
    expect(report.counts.L01).toBe(1);
  });
  it('lints a clean PIG file with exit code 0', () => {
    const file = join(tmp(), 'scale.txt');
    writeFileSync(file, scalePig([1, 2, 3, 1, 2, 3, 4, 5]));
    const c = capture();
    expect(main(['lint', file], c.io)).toBe(0);
    expect(c.out.join('')).toMatch(/^8 notes: 0 errors/);
  });
  it('lints a PIG prediction against a MusicXML score by note id and refuses a partial one', () => {
    const dir = tmp();
    const pred = join(dir, 'pred.txt');
    expect(main(['finger', fixture, '--format', 'pig', '--out', pred], capture().io)).toBe(0);
    const c = capture();
    expect(main(['lint', fixture, '--fingering', pred, '--json'], c.io)).toBe(0);
    const report = JSON.parse(c.out.join('')) as { notes: number; errors: number };
    expect(report.notes).toBe(loadScore(fixture).notes.length);
    expect(report.errors).toBe(0);
    const partial = join(dir, 'partial.txt');
    writeFileSync(partial, readFileSync(pred, 'utf8').replace(/\n[^\n]*\n$/, '\n'));
    const p = capture();
    expect(main(['lint', fixture, '--fingering', partial], p.io)).toBe(1);
    expect(p.err.join('')).toContain('note count mismatch');
  });
});

describe('cli bench', () => {
  it('prints the scorecard, writes latest.json and exits 1 on a floor breach', () => {
    const { root, args } = toyBench({ gen: 99, high: 0, soft: 0, rec: 0 });
    const c = capture();
    expect(main(args, c.io)).toBe(1);
    const text = c.out.join('');
    expect(text).toMatch(
      /^bench toy @ \S+ engine \S+ profile large split toy\/test: 2 pieces, 0 skipped/,
    );
    expect(text).toMatch(/^gen +\d+\.\d\d +- +\d+\.\d\d +99\.00$/m);
    expect(c.err.join('')).toMatch(/gen \d+\.\d\d below floor 99\.00/);
    expect(existsSync(join(root, 'latest.json'))).toBe(true);
    expect(existsSync(join(root, 'errors', 'toy', '002.md'))).toBe(true);
    expect(existsSync(join(root, 'errors', 'toy', '001.md'))).toBe(false);
  });
  it('prints deltas against the previous latest.json and says when no floor is set', () => {
    const { args } = toyBench(null);
    expect(main(args, capture().io)).toBe(0);
    const c = capture();
    expect(main(args, c.io)).toBe(0);
    const text = c.out.join('');
    expect(text).toMatch(/^gen +\d+\.\d\d +0\.00 +\d+\.\d\d +none$/m);
    expect(text).toContain('no floor set');
  });
  it('--limit scores the first pieces only and never updates latest.json', () => {
    const { root, args } = toyBench(null);
    const c = capture();
    expect(main([...args, '--limit', '1'], c.io)).toBe(0);
    expect(c.out.join('')).toMatch(/^bench toy-limit1 .*: 1 pieces, 0 skipped/);
    expect(existsSync(join(root, 'latest.json'))).toBe(false);
    expect(main([...args, '--limit', '0'], capture().io)).toBe(2);
    expect(main([...args, '--subset', 'validation'], capture().io)).toBe(2);
  });
  it('--ablate prints a delta row per non-zero rule and writes the table as JSON', () => {
    const { root, args } = toyBench(null);
    const c = capture();
    expect(main([...args, '--ablate'], c.io)).toBe(0);
    expect(c.out.join('')).toMatch(/^ablation/m);
    const rows = JSON.parse(readFileSync(join(root, 'ablation-toy.json'), 'utf8')) as Array<{
      rule: string;
      gen: number;
    }>;
    expect(rows.map((r) => r.rule)).toContain('template');
    expect(c.out.join('')).toMatch(/^template +-?\d+\.\d\d/m);
  });
});
