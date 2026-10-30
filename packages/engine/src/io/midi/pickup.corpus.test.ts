/**
 * The pickup detector over every Mutopia MIDI file in research/data/mutopia_midi (about 150
 * files, public domain or Creative Commons, downloaded and not committed: this test is skipped
 * where they are absent). The truth for each piece is the first `\partial` in its LilyPond
 * source under research/data/mutopia_src, or, when the library holds the same piece, the first
 * bar of its MusicXML. The opening rules were chosen on this corpus; the ending conditions
 * that keep false pickups out were chosen on the built-in library (pickup.library.test.ts), so
 * this corpus checks them on real MIDI files; see docs/experiments.md.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../musicxml/read.js';
import { separateHands } from './handSeparation.js';
import { detectPickup } from './pickup.js';
import { quantize } from './quantize.js';
import { parseMidiFile } from './read.js';

const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const MIDI = join(repo, 'research/data/mutopia_midi');
const SRC = join(repo, 'research/data/mutopia_src');
const CONTENT = join(repo, 'content');

/** '4' -> 1, '8' -> 0.5, '2.' -> 3, '4*3' -> 3, '16*5' -> 1.25 (quarter notes), NaN if unknown. */
function partialQuarters(text: string): number {
  const m = text.match(/^(\d+)(\.*)(?:\*(\d+)(?:\/(\d+))?)?$/);
  if (!m) return Number.NaN;
  let q = 4 / Number(m[1]);
  let add = q / 2;
  for (let i = 0; i < m[2]!.length; i++) {
    q += add;
    add /= 2;
  }
  if (m[3]) q *= Number(m[3]) / (m[4] ? Number(m[4]) : 1);
  return q;
}

/** Mutopia id -> quarter notes in the first bar of the library's MusicXML (0 when full). */
function libraryPickups(): Map<string, number> {
  const out = new Map<string, number>();
  const manifestPath = join(CONTENT, 'manifest.json');
  if (!existsSync(manifestPath)) return out;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Array<{
    source?: { mutopiaId?: string };
    files?: { score?: string };
  }>;
  for (const piece of manifest) {
    const id = piece.source?.mutopiaId ? String(piece.source.mutopiaId).split('-').pop() : null;
    const file = piece.files?.score ? join(CONTENT, piece.files.score) : null;
    if (!id || !file || !existsSync(join(MIDI, id)) || !existsSync(file)) continue;
    const score = parseMusicXml(readFileSync(file, 'utf8')).score;
    const time = score.timeSignatures[0]!;
    const nominal = (time.beats * 4 * score.divisions) / time.beatType;
    const first = score.measures[0]!;
    out.set(id, first.lengthTicks < nominal ? first.lengthTicks / score.divisions : 0);
  }
  return out;
}

/** The `\partial` values of the LilyPond files beside the piece's source, or null if absent. */
function sourcePartials(dir: string): string[] | null {
  const html = readFileSync(join(dir, 'piece-info.html'), 'utf8');
  const ftp = html.match(/ftp\/[^"]*\.(?:ly|log|mid|zip|png|svg)/)?.[0];
  if (!ftp) return null;
  const folder = dirname(join(SRC, ftp));
  if (!existsSync(folder)) return null;
  const partials: string[] = [];
  let found = false;
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(join(d, f.name));
      else if (/\.i?ly$/.test(f.name)) {
        found = true;
        const text = readFileSync(join(d, f.name), 'latin1').replace(/%.*$/gm, '');
        for (const m of text.matchAll(/\\partial\s+([0-9.*/]+)/g)) partials.push(m[1]!);
      }
    }
  };
  walk(folder);
  return found ? partials : null;
}

describe.skipIf(!existsSync(MIDI) || !existsSync(SRC))(
  'pickup detection over the Mutopia MIDI corpus',
  () => {
    it('finds no false pickup and no wrong length, and finds at least 7 pickups', () => {
      const library = libraryPickups();
      const found: string[] = [];
      const wrong: string[] = [];
      const falsePickups: string[] = [];
      let compared = 0;
      for (const id of readdirSync(MIDI).filter((d) => /^\d+$/.test(d))) {
        const dir = join(MIDI, id);
        const files = readdirSync(dir).filter((f) => /\.midi?$/i.test(f));
        if (files.length !== 1) continue;
        let expectedQuarters: number | null = null;
        if (library.has(id)) expectedQuarters = library.get(id)!;
        else {
          const partials = sourcePartials(dir);
          if (partials !== null)
            expectedQuarters = partials.length > 0 ? partialQuarters(partials[0]!) : 0;
        }
        if (expectedQuarters === null || Number.isNaN(expectedQuarters)) continue;
        compared++;
        const data = parseMidiFile(new Uint8Array(readFileSync(join(dir, files[0]!))));
        const q = quantize(data);
        const ticks = detectPickup(
          q.notes,
          separateHands(q.notes),
          data.timeSignatures[0]!,
          q.divisions,
        );
        const label = `${id} ${files[0]}`;
        if (ticks === 0) continue;
        if (expectedQuarters === 0) falsePickups.push(label);
        else if (ticks !== expectedQuarters * q.divisions) wrong.push(`${label}: ${ticks}`);
        else found.push(id);
      }
      expect(compared).toBeGreaterThan(100);
      expect(falsePickups).toEqual([]);
      expect(wrong).toEqual([]);
      expect(found.length).toBeGreaterThanOrEqual(7);
      expect(found).toContain('504');
    });
  },
);
