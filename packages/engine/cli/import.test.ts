import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeMidi, type MidiEvent } from 'midi-file';
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
const traumerei = fileURLToPath(
  new URL('../src/io/midi/fixtures/SchumannOp15No07.mid', import.meta.url),
);
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
  it('titles a file without --title from its readable name and keeps its pickup bar', () => {
    const out = outFile();
    const c = capture();
    expect(main(['import', traumerei, '--out', out], c.io)).toBe(0);
    const { score } = parseMusicXml(readFileSync(out));
    expect(score.meta.title).toBe('Schumann Op. 15 No. 7');
    expect(score.measures).toHaveLength(25);
    expect(score.measures[0]!.lengthTicks).toBe(score.divisions);
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
  it('reports the share of notes moved onto the grid as a whole percentage', () => {
    // Four quarter notes; the second and fourth are played 40 ticks (about 42 ms) late, so half moved.
    const late = [0, 40, 0, 40];
    const events: MidiEvent[] = [];
    let at = 0;
    late.forEach((l, i) => {
      const on = i * 480 + l;
      events.push(
        { deltaTime: on - at, type: 'noteOn', channel: 0, noteNumber: 60 + i, velocity: 80 },
        { deltaTime: 400, type: 'noteOff', channel: 0, noteNumber: 60 + i, velocity: 0 },
      );
      at = on + 400;
    });
    events.push({ deltaTime: 0, meta: true, type: 'endOfTrack' });
    const file = join(mkdtempSync(join(tmpdir(), 'digitus2-import-')), 'late.mid');
    writeFileSync(
      file,
      Buffer.from(
        writeMidi({ header: { format: 1, numTracks: 1, ticksPerBeat: 480 }, tracks: [events] }),
      ),
    );
    const c = capture();
    expect(main(['import', file, '--out', outFile()], c.io)).toBe(0);
    expect(c.out.join('')).toContain('50 % of notes moved more than a 64th note');
  });
  it('refuses a split outside the keyboard and a missing file name', () => {
    expect(main(['import', twinkle, '--split', 'x'], capture().io)).toBe(2);
    expect(main(['import', twinkle, '--split', '200'], capture().io)).toBe(2);
    expect(main(['import'], capture().io)).toBe(2);
  });
});
