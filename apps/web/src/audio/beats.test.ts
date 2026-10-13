// @vitest-environment node
import { readFileSync } from 'node:fs';
import { parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { buildBeats, measureEndSec, measureStartSec } from './beats.js';

const { score } = parseMusicXml(
  readFileSync(new URL('../../fixtures/short-piano.musicxml', import.meta.url), 'utf8'),
);

describe('beats', () => {
  it('builds four beats per 4/4 bar at 96 qpm, accenting the downbeat', () => {
    const beats = buildBeats(score);
    expect(beats).toHaveLength(8 * 4);
    expect(beats.slice(0, 5).map((b) => b.sec)).toEqual([0, 0.625, 1.25, 1.875, 2.5]);
    expect(beats.slice(0, 5).map((b) => b.accent)).toEqual([true, false, false, false, true]);
    expect(beats[4]!.measureIndex).toBe(1);
  });
  it('maps measures to seconds', () => {
    expect(measureStartSec(score, 1)).toBeCloseTo(2.5, 6);
    expect(measureEndSec(score, 1)).toBeCloseTo(5.0, 6);
    expect(measureEndSec(score, 7)).toBeCloseTo(20.0, 6);
  });
});
