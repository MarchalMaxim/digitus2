import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from './run.js';
import type { CliIo } from './run.js';

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, out, err };
}

const fixture = fileURLToPath(new URL('../fixtures/two-staff.musicxml', import.meta.url));

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
