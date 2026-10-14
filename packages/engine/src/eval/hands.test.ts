import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../io/musicxml/read.js';
import { parsePig } from '../io/pig/read.js';
import { evaluateHands, scoreToMidiData } from './hands.js';

const repo = new URL('../../../../', import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, repo)));
const manifest = JSON.parse(read('content/manifest.json').toString('utf8')) as Array<{
  slug: string;
  files: { score: string };
}>;
const pigSample = () =>
  parsePig(read('packages/engine/fixtures/pig-sample.txt').toString('utf8')).score;

describe('evaluateHands', () => {
  it('turns a score into MIDI-like data with the score timing', () => {
    const score = pigSample();
    const data = scoreToMidiData(score);
    expect(data.ppq).toBe(score.divisions);
    expect(data.tempos).toEqual([{ tick: 0, usPerQuarter: 500_000 }]);
    expect(data.notes.map((n) => [n.tick, n.endTick, n.midi])).toEqual(
      score.notes.map((n) => [n.onsetTick, n.offsetTick, n.midi]),
    );
  });
  it('scores the PIG sample note by note', () => {
    const r = evaluateHands(pigSample());
    expect(r.notes).toBe(6);
    expect(r.correct).toBeGreaterThanOrEqual(4);
    expect(r.accuracy).toBeCloseTo((100 * r.correct) / 6, 9);
  });
  it('separates Twinkle with at most two notes in the wrong hand', () => {
    const r = evaluateHands(
      parseMusicXml(read('content/scores/twinkle-twinkle-little-star.musicxml')).score,
    );
    expect(r.notes).toBe(64);
    expect(r.correct).toBeGreaterThanOrEqual(62);
  });
  it('reaches at least 85 percent on the built-in library (macro average over 30 simple textures)', () => {
    const rows = manifest.map((p) => ({
      slug: p.slug,
      ...evaluateHands(parseMusicXml(read(`content/${p.files.score}`)).score),
    }));
    const macro = rows.reduce((s, r) => s + r.accuracy, 0) / rows.length;
    expect(
      macro,
      rows.map((r) => `${r.slug} ${r.accuracy.toFixed(1)}`).join('\n'),
    ).toBeGreaterThanOrEqual(85);
  }, 60_000);
});
