import { describe, expect, it } from 'vitest';
import {
  alignmentStep,
  captureRadii,
  continuityWindow,
  CONTINUITY_MS,
  MAX_CONTINUITY_MS,
  initialAlignment,
  scaledMatrix,
  targetPoints,
  validView,
  viewTargets,
  validCorners,
} from './captureState.js';
import type { Matrix, Point } from './vision.js';

function expectReachableViews(corners: Point[], width: number, height: number) {
  const center = { x: width / 2, y: height / 2 };
  const previous: Matrix[] = [[1, 0, 0, 0, 1, 0, 0, 0, 1]];
  const targets = targetPoints(corners, center);
  expect(targets).toHaveLength(4);
  for (const target of targets) {
    const matrix: Matrix = [1, 0, center.x - target.x, 0, 1, center.y - target.y, 0, 0, 1];
    expect(validView({ matrix, previous, target, center, sharp: true })).toBe(true);
    // Every accepted hold, including its tolerance edge, must still be a distinct view.
    const tolerance = captureRadii(center).hold;
    for (const dx of [-tolerance * 0.999, 0, tolerance * 0.999]) {
      const shifted = [...matrix];
      shifted[2]! += dx;
      expect(validView({ matrix: shifted, previous, target, center, sharp: true })).toBe(true);
    }
    previous.push(matrix);
  }
}

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
    const drift = (now: number) => ({ ...sample(now), point: { x: 220, y: 180 } });
    let state = alignmentStep(initialAlignment(), sample(100));
    state = alignmentStep(state, sample(400));
    expect(state.ready).toBe(false);
    // Issue 147: one twitch past the ring is forgiven; it never completes a view itself.
    state = alignmentStep(state, drift(500));
    expect(state).toMatchObject({ aligned: true, ready: false, since: 100 });
    state = alignmentStep(state, sample(600));
    expect(state.ready).toBe(false);
    state = alignmentStep(state, sample(700));
    expect(state.ready).toBe(true);
    // Two in a row empty it.
    state = alignmentStep(state, drift(800));
    state = alignmentStep(state, drift(900));
    expect(state.aligned).toBe(false);
    state = alignmentStep(state, sample(1000));
    state = alignmentStep(state, sample(1300));
    expect(state.ready).toBe(false);
    state = alignmentStep(state, sample(1600));
    expect(state.ready).toBe(true);
    expect(alignmentStep(state, { ...sample(1700), sharp: false }).ready).toBe(false);
    expect(
      alignmentStep(state, { now: 1700, point: null, center: { x: 180, y: 180 }, sharp: true })
        .ready,
    ).toBe(false);
  });
  it('issue 147: catches the dot inside the circle and keeps it within the wider ring', () => {
    const center = { x: 180, y: 135 };
    const radii = captureRadii(center);
    const at = (now: number, dx: number) => ({
      now,
      point: { x: center.x + dx, y: center.y },
      center,
      sharp: true,
    });
    // Outside the circle: not caught.
    expect(alignmentStep(initialAlignment(), at(0, radii.enter + 1)).aligned).toBe(false);
    // Inside it: caught, then held while a shaking hand stays within the ring.
    let state = alignmentStep(initialAlignment(), at(0, radii.enter - 1));
    for (const [now, dx] of [
      [100, radii.enter + 4],
      [200, radii.hold - 1],
      [300, radii.enter],
      [400, radii.hold - 2],
      [500, radii.enter - 3],
      [600, radii.hold - 1],
    ] as const)
      state = alignmentStep(state, at(now, dx));
    expect(state).toMatchObject({ aligned: true, ready: true, since: 0 });
    // The old rule: 6.5 % of the shorter half, and half that between updates.
    expect(radii.enter).toBeGreaterThan(135 * 0.065 * 1.5);
    expect(radii.steady).toBeGreaterThan(135 * 0.065 * 0.5 * 2);
  });
  it('resets when browser frame sampling was interrupted', () => {
    const input = { point: { x: 180, y: 180 }, center: { x: 180, y: 180 }, sharp: true };
    const state = alignmentStep(initialAlignment(), { ...input, now: 0 });
    expect(alignmentStep(state, { ...input, now: 1200 }).ready).toBe(false);
  });
  it('issue 143: a slow phone holds a view with its own, longer gaps between images', () => {
    const input = { point: { x: 181, y: 180 }, center: { x: 180, y: 180 }, sharp: true };
    // About 400 ms an update: never two images within 350 ms, so the fixed window never holds.
    const times = [0, 410, 820, 1230];
    let fixed = initialAlignment();
    for (const now of times) fixed = alignmentStep(fixed, { ...input, now });
    expect(fixed.ready).toBe(false);
    const window = continuityWindow([410, 400, 420, 410]);
    expect(window).toBeCloseTo(1025);
    let slow = initialAlignment();
    slow = alignmentStep(slow, { ...input, now: 0, window });
    slow = alignmentStep(slow, { ...input, now: 410, window });
    // The ring still takes HOLD_MS of real time, whatever the number of images.
    expect(slow.ready).toBe(false);
    slow = alignmentStep(slow, { ...input, now: 820, window });
    expect(slow.ready).toBe(true);
    expect(slow.since).toBe(0);
  });
  it('issue 143: the window follows the typical gap, within fixed floors', () => {
    expect(continuityWindow([])).toBe(CONTINUITY_MS);
    expect(continuityWindow([120, 125, 130])).toBe(CONTINUITY_MS);
    expect(continuityWindow([200, 210, 5000, 220])).toBeCloseTo(537.5);
    expect(continuityWindow([900, 1000, 1100])).toBe(MAX_CONTINUITY_MS);
  });
  it('issue 143: however slow the phone, a stale or repeated image never continues a hold', () => {
    const input = { point: { x: 180, y: 180 }, center: { x: 180, y: 180 }, sharp: true };
    const state = alignmentStep(initialAlignment(), { ...input, now: 0, window: 99_999 });
    // A gap beyond the longest window, even when the caller asks for more.
    expect(alignmentStep(state, { ...input, now: 1600, window: 99_999 }).since).toBe(1600);
    // The same image again (a frozen camera repeats its timestamp) is not elapsed time.
    expect(alignmentStep(state, { ...input, now: 0, window: 99_999 }).since).toBe(0);
    let frozen = state;
    for (let i = 0; i < 10; i++) frozen = alignmentStep(frozen, { ...input, now: 0, window: 1500 });
    expect(frozen.ready).toBe(false);
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
    const points = targetPoints(
      [
        { x: 20, y: 20 },
        { x: 340, y: 20 },
        { x: 340, y: 340 },
        { x: 20, y: 340 },
      ],
      { x: 180, y: 180 },
    );
    expect(points).toEqual([
      { x: 100, y: 100 },
      { x: 260, y: 100 },
      { x: 260, y: 260 },
      { x: 100, y: 260 },
    ]);
  });
  it('can finish an accepted off-center crop whose quarter-page target is at frame center', () => {
    const corners = [
      { x: 119, y: 119 },
      { x: 359, y: 119 },
      { x: 359, y: 359 },
      { x: 119, y: 359 },
    ];
    expect(validCorners(corners, 360, 360)).toBe(true);
    expectReachableViews(corners, 360, 360);
  });
  it('offers four reachable distinct views for every accepted diverse crop', () => {
    let accepted = 0;
    for (const [width, height] of [
      [360, 360],
      [270, 360],
      [360, 203],
      [2560, 1441],
    ]) {
      for (const left of [0.005, 0.1, 0.33]) {
        for (const top of [0.005, 0.1, 0.33]) {
          for (const span of [0.5, 0.66]) {
            for (const skew of [-0.04, 0, 0.04]) {
              const corners = [
                { x: width! * left, y: height! * top },
                { x: width! * (left + span), y: height! * (top + 0.04) },
                { x: width! * (left + span + skew), y: height! * (top + span) },
                { x: width! * (left + 0.04), y: height! * (top + span - 0.03) },
              ];
              if (!validCorners(corners, width!, height!)) continue;
              accepted++;
              expectReachableViews(corners, width!, height!);
            }
          }
        }
      }
    }
    expect(accepted).toBeGreaterThan(100);
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

describe('issue 147: dots where the music is', () => {
  const page = [
    { x: 20, y: 20 },
    { x: 340, y: 20 },
    { x: 340, y: 460 },
    { x: 20, y: 460 },
  ];
  const center = { x: 180, y: 240 };
  it('keeps the page dots for a page of music', () => {
    const content = { left: 30, top: 30, right: 330, bottom: 440 };
    expect(viewTargets(page, center, content)).toEqual(targetPoints(page, center));
    expect(viewTargets(page, center)).toEqual(targetPoints(page, center));
  });
  it('narrows the dots to music in the top third, each still a distinct, reachable view', () => {
    const content = { left: 30, top: 40, right: 330, bottom: 180 };
    const targets = viewTargets(page, center, content);
    expect(targets).toHaveLength(4);
    const previous: Matrix[] = [[1, 0, 0, 0, 1, 0, 0, 0, 1]];
    for (const target of targets) {
      // Near the music: no dot asks the camera down to the blank paper.
      expect(target.y).toBeLessThan(content.bottom + 80);
      const matrix: Matrix = [1, 0, center.x - target.x, 0, 1, center.y - target.y, 0, 0, 1];
      expect(validView({ matrix, previous, target, center, sharp: true })).toBe(true);
      previous.push(matrix);
    }
    const pageTargets = targetPoints(page, center);
    expect(Math.max(...targets.map((t) => t.y))).toBeLessThan(
      Math.max(...pageTargets.map((t) => t.y)),
    );
  });
  it('widens a small patch of music until four distinct dots fit, inside the page', () => {
    const content = { left: 150, top: 60, right: 210, bottom: 100 };
    const targets = viewTargets(page, center, content);
    expect(targets).toHaveLength(4);
    for (const target of targets) {
      expect(target.x).toBeGreaterThanOrEqual(20);
      expect(target.x).toBeLessThanOrEqual(340);
      expect(target.y).toBeGreaterThanOrEqual(20);
      expect(target.y).toBeLessThanOrEqual(460);
    }
  });
});
