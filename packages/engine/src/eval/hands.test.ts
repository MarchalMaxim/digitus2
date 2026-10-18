import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../io/musicxml/read.js';
import { HAND_MOTION, HAND_PATTERNS } from '../io/midi/motion.js';
import type { HandMotionParams } from '../io/midi/motion.js';
import { parsePig } from '../io/pig/read.js';
import { benchmarkEntries } from '../library/benchmarkSet.js';
import { evaluateHands, scoreToMidiData } from './hands.js';

const repo = new URL('../../../../', import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, repo)));
/** The core30 benchmark set: the library measurement never moves when the library grows. */
const manifest = benchmarkEntries(
  JSON.parse(read('content/manifest.json').toString('utf8')) as Array<{
    slug: string;
    files: { score: string };
    benchmarkSet?: string | null;
  }>,
);
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
  it('keeps the time signatures of the score and falls back to 4/4 when it has none', () => {
    const score = pigSample();
    expect(scoreToMidiData({ ...score, timeSignatures: [] }).timeSignatures).toEqual([
      { tick: 0, beats: 4, beatType: 4 },
    ]);
    expect(
      scoreToMidiData({ ...score, timeSignatures: [{ tick: 0, beats: 3, beatType: 4 }] })
        .timeSignatures,
    ).toEqual([{ tick: 0, beats: 3, beatType: 4 }]);
    const two = [
      { tick: 0, beats: 3, beatType: 4 },
      { tick: 1440, beats: 6, beatType: 8 },
    ];
    expect(scoreToMidiData({ ...score, timeSignatures: two }).timeSignatures).toEqual(two);
  });
  it('counts exactly the notes whose quantized note got their true hand', () => {
    const score = parsePig(
      [
        '//Version: PianoFingering_v170101',
        '0\t0.000000\t1.000000\tC5\t80\t80\t0\t1',
        '1\t0.000000\t1.000000\tC2\t80\t80\t1\t-5',
        '',
      ].join('\n'),
    ).score;
    expect(evaluateHands(score)).toEqual({ notes: 2, correct: 2, accuracy: 100 });
  });
  it('separates with the given motion parameters instead of the shipped ones', () => {
    // Parameters that make a right-hand pattern overwhelmingly likely: every note goes right.
    const pattern = Object.fromEntries(
      HAND_PATTERNS.map((a) => [
        a,
        Object.fromEntries(HAND_PATTERNS.map((b) => [b, b === 'R' ? 1 - 2e-9 : 1e-9])),
      ]),
    ) as HandMotionParams['pattern'];
    const rightish: HandMotionParams = { ...HAND_MOTION, pattern };
    const score = parsePig(
      [
        '//Version: PianoFingering_v170101',
        ...['C3', 'D3', 'E3', 'F3'].map(
          (p, k) => `${k}\t${k * 0.5}\t${k * 0.5 + 0.5}\t${p}\t80\t80\t1\t-${k + 1}`,
        ),
        '',
      ].join('\n'),
    ).score;
    expect(evaluateHands(score).correct).toBe(4);
    expect(evaluateHands(score, { params: rightish }).correct).toBe(0);
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
