import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../src/io/musicxml/read.js';
import { main } from './run.js';
import type { CliIo } from './run.js';

const twinkle = fileURLToPath(new URL('../fixtures/twinkle.mid', import.meta.url));
function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, out, err };
}
const outFile = () => join(mkdtempSync(join(tmpdir(), 'digitus2-import-')), 'twinkle.musicxml');

describe('digitus2 import', () => {
  it('writes a MusicXML file that parseMusicXml reads back with every note', () => {
    const out = outFile();
    const c = capture();
    expect(main(['import', twinkle, '--out', out], c.io)).toBe(0);
    const { score } = parseMusicXml(readFileSync(out));
    expect(score.notes).toHaveLength(64);
    expect(score.meta.title).toBe('twinkle');
    expect(c.out.join('')).toMatch(
      /^imported twinkle\.mid: 64 notes \(\d+ right, \d+ left\), 12 measures, key C major; 0 % of notes moved more than a 64th note\n$/,
    );
    expect(c.err).toEqual([]);
  });
  it('prints the MusicXML on stdout and the summary on stderr without --out', () => {
    const c = capture();
    expect(main(['import', twinkle, '--title', 'Twinkle'], c.io)).toBe(0);
    expect(c.out.join('')).toMatch(/^<\?xml/);
    expect(c.out.join('')).toContain('<work-title>Twinkle</work-title>');
    expect(c.err.join('')).toMatch(/^imported twinkle\.mid: 64 notes/);
  });
  it('honours a fixed hand split', () => {
    const out = outFile();
    const c = capture();
    expect(main(['import', twinkle, '--out', out, '--split', '60'], c.io)).toBe(0);
    const { score } = parseMusicXml(readFileSync(out));
    expect(score.notes.filter((n) => n.hand === 'R')).toHaveLength(42);
    expect(c.out.join('')).toContain('(42 right, 22 left)');
    expect(c.out.join('')).toContain('; hand split at C4');
  });
  it('refuses a split outside the keyboard and a missing file name', () => {
    expect(main(['import', twinkle, '--split', 'x'], capture().io)).toBe(2);
    expect(main(['import', twinkle, '--split', '200'], capture().io)).toBe(2);
    expect(main(['import'], capture().io)).toBe(2);
  });
});
