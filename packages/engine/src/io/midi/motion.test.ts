import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { benchmarkEntries } from '../../library/benchmarkSet.js';
import { parseMusicXml } from '../musicxml/read.js';
import raw from './params/hand-motion.json' with { type: 'json' };
import {
  addCounts,
  chordCentre,
  emptyCounts,
  HAND_MOTION,
  loadHandMotion,
  motionCounts,
  moveIndex,
  positionIndex,
  scoreMotionCounts,
  spanIndex,
} from './motion.js';

const repo = new URL('../../../../../', import.meta.url);
const manifest = benchmarkEntries(
  JSON.parse(readFileSync(fileURLToPath(new URL('content/manifest.json', repo)), 'utf8')) as Array<{
    slug: string;
    benchmarkSet?: string | null;
    files: { score: string };
  }>,
);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('hand-motion statistics', () => {
  it('rounds half up and clamps the same way as the Python script', () => {
    expect(chordCentre([60, 64, 67])).toBe(63.5);
    expect(moveIndex(-0.5)).toBe(24);
    expect(moveIndex(1.5)).toBe(26);
    expect(moveIndex(-1.5)).toBe(23);
    expect(moveIndex(-40)).toBe(0);
    expect(moveIndex(40)).toBe(48);
    expect(spanIndex(30)).toBe(24);
    expect(positionIndex(20)).toBe(0);
    expect(positionIndex(63.5)).toBe(43);
  });
  it('counts a small passage by the shared definition', () => {
    const c = motionCounts([
      { onset: 0, midi: 60, hand: 'R' },
      { onset: 0, midi: 64, hand: 'R' },
      { onset: 0, midi: 48, hand: 'L' },
      { onset: 1, midi: 62, hand: 'R' },
      { onset: 3, midi: 67, hand: 'R' },
      { onset: 3, midi: 43, hand: 'L' },
    ]);
    expect(c.moveRight[24]).toBe(1);
    expect(c.moveRight[29]).toBe(1);
    expect(c.moveLeft[19]).toBe(1);
    expect(c.spanRight[4]).toBe(1);
    expect(c.pattern).toEqual({
      L: { L: 0, R: 0, LR: 0 },
      R: { L: 0, R: 0, LR: 1 },
      LR: { L: 0, R: 1, LR: 1 },
    });
  });
  it('counts the 30 library pieces exactly as make_hand_motion.py recorded them', () => {
    const total = emptyCounts();
    for (const p of manifest) {
      const xml = readFileSync(fileURLToPath(new URL(`content/${p.files.score}`, repo)));
      addCounts(total, scoreMotionCounts(parseMusicXml(xml).score));
    }
    expect(total).toEqual(raw.counts.library);
  });
  it('ships normalised tables fitted without PIG data', () => {
    expect(HAND_MOTION.moveLeft).toHaveLength(49);
    expect(HAND_MOTION.spanRight).toHaveLength(25);
    expect(HAND_MOTION.positionRight).toHaveLength(88);
    for (const t of [
      HAND_MOTION.moveLeft,
      HAND_MOTION.moveRight,
      HAND_MOTION.spanLeft,
      HAND_MOTION.spanRight,
      HAND_MOTION.positionLeft,
      HAND_MOTION.positionRight,
    ])
      expect(sum(t)).toBeCloseTo(1, 9);
    for (const row of Object.values(HAND_MOTION.pattern))
      expect(sum(Object.values(row))).toBeCloseTo(1, 9);
    expect(raw.provenance.sources.map((s) => s.name)).toEqual(['library', 'mutopia-train']);
    expect(HAND_MOTION.moveRight[24]!).toBeGreaterThan(HAND_MOTION.moveRight[48]!);
    expect(HAND_MOTION.spanRight[0]!).toBeGreaterThan(HAND_MOTION.spanRight[24]!);
  });
  it('rejects malformed parameter files and names the field', () => {
    expect(() => loadHandMotion({ ...raw, moveLeft: [1] })).toThrow(/moveLeft/);
    expect(() => loadHandMotion({ ...raw, idleSec: 0 })).toThrow(/idleSec/);
    expect(() => loadHandMotion({ ...raw, pattern: { L: { L: 1 } } })).toThrow(/pattern/);
  });
  it('accepts a crossing and an idle penalty of 0 but not a negative one', () => {
    expect(loadHandMotion({ ...raw, mu: 0 }).mu).toBe(0);
    expect(loadHandMotion({ ...raw, nu: 0 }).nu).toBe(0);
    expect(() => loadHandMotion({ ...raw, mu: -1 })).toThrow(/mu/);
    expect(() => loadHandMotion({ ...raw, nu: -1 })).toThrow(/nu/);
  });
});
