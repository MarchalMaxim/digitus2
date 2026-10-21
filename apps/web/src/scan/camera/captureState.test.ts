import { describe, expect, it } from 'vitest';
import {
  alignmentStep,
  initialAlignment,
  scaledMatrix,
  targetPoints,
  validView,
  validCorners,
} from './captureState.js';

describe('real image alignment', () => {
  it('blocks crossed, reversed, nonfinite, tiny and out-of-frame page corners', () => {
    const corners = [
      { x: 20, y: 20 },
      { x: 340, y: 20 },
      { x: 340, y: 340 },
      { x: 20, y: 340 },
    ];
    expect(validCorners(corners, 360, 360)).toBe(true);
    expect(validCorners([corners[0]!, corners[2]!, corners[1]!, corners[3]!], 360, 360)).toBe(
      false,
    );
    expect(validCorners([...corners].reverse(), 360, 360)).toBe(false);
    expect(
      validCorners(
        corners.map((point) => ({ x: point.x / 10, y: point.y / 10 })),
        360,
        360,
      ),
    ).toBe(false);
    expect(validCorners([{ x: NaN, y: 20 }, ...corners.slice(1)], 360, 360)).toBe(false);
    expect(validCorners([{ x: -1, y: 20 }, ...corners.slice(1)], 360, 360)).toBe(false);
  });
  it('never completes a stationary camera even after a long hold', () => {
    let state = initialAlignment();
    for (let now = 0; now < 3000; now += 100)
      state = alignmentStep(state, {
        now,
        point: { x: 90, y: 90 },
        center: { x: 180, y: 180 },
        sharp: true,
      });
    expect(state.ready).toBe(false);
    expect(state.aligned).toBe(false);
  });
  it('requires consecutive stable, sharp alignment and resets on drift or loss', () => {
    const sample = (now: number) => ({
      now,
      point: { x: 182, y: 179 },
      center: { x: 180, y: 180 },
      sharp: true,
    });
    let state = alignmentStep(initialAlignment(), sample(100));
    state = alignmentStep(state, sample(400));
    expect(state.ready).toBe(false);
    state = alignmentStep(state, { ...sample(500), point: { x: 210, y: 180 } });
    state = alignmentStep(state, sample(600));
    state = alignmentStep(state, sample(900));
    state = alignmentStep(state, sample(1100));
    expect(state.ready).toBe(false);
    state = alignmentStep(state, sample(1300));
    expect(state.ready).toBe(true);
    expect(alignmentStep(state, { ...sample(1400), sharp: false }).ready).toBe(false);
    expect(
      alignmentStep(state, { now: 1400, point: null, center: { x: 180, y: 180 }, sharp: true })
        .ready,
    ).toBe(false);
  });
  it('resets when browser frame sampling was interrupted', () => {
    const input = { point: { x: 180, y: 180 }, center: { x: 180, y: 180 }, sharp: true };
    const state = alignmentStep(initialAlignment(), { ...input, now: 0 });
    expect(alignmentStep(state, { ...input, now: 1200 }).ready).toBe(false);
  });
  it('resets a hold when the page rotates around an otherwise aligned target', () => {
    const input = {
      point: { x: 180, y: 180 },
      center: { x: 180, y: 180 },
      sharp: true,
      anchors: [
        { x: 90, y: 90 },
        { x: 270, y: 270 },
      ],
    };
    let state = alignmentStep(initialAlignment(), { ...input, now: 0 });
    state = alignmentStep(state, { ...input, now: 300 });
    state = alignmentStep(state, {
      ...input,
      now: 600,
      anchors: [
        { x: 120, y: 90 },
        { x: 240, y: 270 },
      ],
    });
    state = alignmentStep(state, {
      ...input,
      now: 700,
      anchors: [
        { x: 120, y: 90 },
        { x: 240, y: 270 },
      ],
    });
    expect(state.ready).toBe(false);
  });
  it('anchors four distinct targets inside the edited page quadrilateral', () => {
    const points = targetPoints([
      { x: 20, y: 20 },
      { x: 340, y: 20 },
      { x: 340, y: 340 },
      { x: 20, y: 340 },
    ]);
    expect(points).toEqual([
      { x: 100, y: 100 },
      { x: 260, y: 100 },
      { x: 260, y: 260 },
      { x: 100, y: 260 },
    ]);
  });
  it('converts tracking homographies to full capture pixels, including perspective', () => {
    expect(scaledMatrix([1, 0, 18, 0, 1, -9, 0.001, 0, 1], 5)).toEqual([
      1, 0, 90, 0, 1, -45, 0.0002, 0, 1,
    ]);
  });
  it('preserves unequal rounding scales between tracking and full capture geometry', () => {
    expect(scaledMatrix([1, 2, 3, 4, 5, 6, 0.1, 0.2, 1], 4, 2)).toEqual([
      1, 4, 12, 2, 5, 12, 0.025, 0.1, 1,
    ]);
  });
  it('rejects failed, blurry, misaligned and duplicate stills before advancing the target', () => {
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const translation = [1, 0, 90, 0, 1, 90, 0, 0, 1];
    const input = {
      matrix: translation,
      previous: [identity],
      center: { x: 180, y: 180 },
      target: { x: 90, y: 90 },
      sharp: true,
    };
    expect(validView(input)).toBe(true);
    expect(validView({ ...input, matrix: null })).toBe(false);
    expect(validView({ ...input, sharp: false })).toBe(false);
    expect(validView({ ...input, matrix: identity })).toBe(false);
    expect(validView({ ...input, previous: [identity, translation] })).toBe(false);
  });
});
