// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { verovioOptions } from '../score/render/options.js';
import { toMusicXml } from './musicxml.js';
import type { Key } from './rhythm.js';

/**
 * The review draws the score with Verovio, which shows a sharp, flat or natural only where the
 * file has an `<accidental>`: a note outside the key's scale without one would be drawn as the
 * wrong note, though it sounds right.
 */
async function draw(pitches: number[], key: Key): Promise<string> {
  const xml = toMusicXml({
    bpm: 100,
    key,
    notes: pitches.map((midi, i) => ({ midi, start: i * 4, length: 4 })),
  });
  const { default: createVerovioModule } = await import('verovio/wasm');
  const { VerovioToolkit } = await import('verovio/esm');
  const tk = new VerovioToolkit(await createVerovioModule());
  tk.setOptions(verovioOptions(900));
  expect(tk.loadData(xml)).toBeTruthy();
  const svg = tk.renderToSVG(1);
  tk.destroy();
  return svg;
}
const accidentals = (svg: string) => svg.match(/<g\b[^>]*\bclass="accid"/g)?.length ?? 0;

describe('the whistled score as Verovio draws it', () => {
  it('draws a sharp where a note is outside the key, and no accidental inside it', async () => {
    expect(accidentals(await draw([60, 62, 64, 65], { fifths: 0, mode: 'major' }))).toBe(0);
    expect(accidentals(await draw([60, 61, 62, 64], { fifths: 0, mode: 'major' }))).toBe(1);
  });

  it('draws the raised seventh of a minor key and a natural against a sharp key', async () => {
    expect(accidentals(await draw([69, 71, 72, 68], { fifths: 0, mode: 'minor' }))).toBe(1);
    // F natural (65) in G major, whose signature has F sharp.
    expect(accidentals(await draw([67, 65, 66, 67], { fifths: 1, mode: 'major' }))).toBe(2);
  });

  it('draws the key signature of the key', async () => {
    const svg = await draw([67, 69, 71, 72], { fifths: 1, mode: 'major' });
    expect(svg.match(/<g\b[^>]*\bclass="keySig"/g)).toHaveLength(1);
    expect(accidentals(svg)).toBe(0);
  });
});
