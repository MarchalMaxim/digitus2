import { describe, expect, it } from 'vitest';
import {
  continuityWindow,
  CONTINUITY_MS,
  initialSweep,
  MAX_CONTINUITY_MS,
  PAUSE_MS,
  scaledMatrix,
  sweepRadii,
  sweepStep,
  validCorners,
  validView,
  viewPlace,
  invertMatrix,
  type Sweep,
} from './captureState.js';
import { project, type Matrix, type Point } from './vision.js';

const center = { x: 180, y: 240 };
const radii = sweepRadii(center);
/** One update of a sweep whose first photograph was taken at the centre. */
const step = (
  state: Sweep,
  now: number,
  point: Point | null,
  options: { views?: Point[]; sharp?: boolean; window?: number } = {},
) =>
  sweepStep(state, {
    now,
    point,
    center,
    sharp: options.sharp ?? true,
    views: options.views ?? [center],
    ...(options.window === undefined ? {} : { window: options.window }),
  });
/** The same place, held for `ms` at one update every `gap` ms. */
function pause(state: Sweep, from: number, ms: number, point: Point, gap = 100, views = [center]) {
  for (let now = from; now <= from + ms; now += gap) state = step(state, now, point, { views });
  return state;
}
const away = { x: center.x + radii.apart + 5, y: center.y };

describe('page corners', () => {
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
});

describe('issue 149: the sweep', () => {
  it('takes a view when the phone pauses somewhere new, in any direction', () => {
    for (const direction of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: -0.7, y: -0.7 },
    ]) {
      const point = {
        x: center.x + direction.x * (radii.apart + 2),
        y: center.y + direction.y * (radii.apart + 2),
      };
      let state = pause(initialSweep(), 0, PAUSE_MS - 100, point);
      expect(state).toMatchObject({ fresh: true, ready: false, since: 0 });
      state = step(state, PAUSE_MS, point);
      expect(state.ready).toBe(true);
    }
  });
  it('never takes the place of a view already taken, however long the pause', () => {
    // At the first photograph's place, and near a view taken since.
    expect(pause(initialSweep(), 0, 3000, center).ready).toBe(false);
    const near = { x: away.x + radii.apart / 2, y: away.y };
    const state = pause(initialSweep(), 0, 3000, near, 100, [center, away]);
    expect(state).toMatchObject({ fresh: false, ready: false });
  });
  it('a moving phone takes nothing; a slow drift within the steady step counts as a pause', () => {
    let fast = initialSweep();
    for (let now = 0; now <= 2000; now += 100)
      fast = step(fast, now, { x: away.x + (now / 100) * (radii.steady + 1), y: away.y });
    expect(fast.ready).toBe(false);
    let slow = initialSweep();
    for (let now = 0; now <= PAUSE_MS; now += 100)
      slow = step(slow, now, { x: away.x + (now / 100) * (radii.steady - 1), y: away.y });
    expect(slow.ready).toBe(true);
  });
  it('a blurred or lost update is forgiven once during a pause, never twice, and takes nothing', () => {
    let state = pause(initialSweep(), 0, 100, away);
    state = step(state, 200, away, { sharp: false });
    expect(state).toMatchObject({ ready: false, since: 0, misses: 1 });
    state = step(state, 300, away);
    expect(state).toMatchObject({ ready: true, since: 0 });
    state = step(state, 400, null);
    state = step(state, 500, null);
    expect(state.since).toBeNull();
  });
  it('restarts the pause when browser frame sampling was interrupted', () => {
    const state = step(initialSweep(), 0, away);
    expect(step(state, 1200, away)).toMatchObject({ since: 1200, ready: false });
  });
  it('issue 143: a slow phone pauses with its own, longer gaps between images', () => {
    // About 400 ms an update: never two images within 350 ms, so the fixed window never pauses.
    let fixed = initialSweep();
    for (const now of [0, 410, 820, 1230]) fixed = step(fixed, now, away);
    expect(fixed.ready).toBe(false);
    const window = continuityWindow([410, 400, 420, 410]);
    expect(window).toBeCloseTo(1025);
    let slow = step(initialSweep(), 0, away, { window });
    slow = step(slow, 410, away, { window });
    expect(slow).toMatchObject({ ready: true, since: 0 });
  });
  it('issue 143: the window follows the typical gap, within fixed floors', () => {
    expect(continuityWindow([])).toBe(CONTINUITY_MS);
    expect(continuityWindow([120, 125, 130])).toBe(CONTINUITY_MS);
    expect(continuityWindow([200, 210, 5000, 220])).toBeCloseTo(537.5);
    expect(continuityWindow([900, 1000, 1100])).toBe(MAX_CONTINUITY_MS);
  });
  it('issue 143: however slow the phone, a stale or repeated image never continues a pause', () => {
    const state = step(initialSweep(), 0, away, { window: 99_999 });
    // A gap beyond the longest window, even when the caller asks for more.
    expect(step(state, 1600, away, { window: 99_999 }).since).toBe(1600);
    // The same image again (a frozen camera repeats its timestamp) is not elapsed time.
    let frozen = state;
    for (let i = 0; i < 10; i++) frozen = step(frozen, 0, away, { window: 1500 });
    expect(frozen).toMatchObject({ since: 0, ready: false });
  });
  it('asks for less movement than the dots did', () => {
    // The dots sat a quarter of the page from the centre, about half the shorter half away.
    expect(radii.apart).toBeLessThan(Math.min(center.x, center.y) * 0.25);
  });
});

describe('tracking geometry', () => {
  it('issue 154: finds where on the page a view was taken, through perspective too', () => {
    // The phone moved so the page shifted 40 right and 30 down: the circle sat 40 left and 30 up.
    expect(viewPlace([1, 0, 40, 0, 1, 30, 0, 0, 1], center)).toEqual({ x: 140, y: 210 });
    const tilted: Matrix = [1.1, 0.05, -12, -0.02, 0.95, 8, 0.0004, -0.0002, 1];
    const inverse = invertMatrix(tilted)!;
    const back = project(tilted, project(inverse, center));
    expect(back.x).toBeCloseTo(center.x, 6);
    expect(back.y).toBeCloseTo(center.y, 6);
    expect(invertMatrix([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeNull();
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
  it('rejects failed, blurry and duplicate stills before keeping a view', () => {
    const identity: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const translation: Matrix = [1, 0, 90, 0, 1, 90, 0, 0, 1];
    const input = { matrix: translation, previous: [identity], center, sharp: true };
    expect(validView(input)).toBe(true);
    expect(validView({ ...input, matrix: null })).toBe(false);
    expect(validView({ ...input, sharp: false })).toBe(false);
    expect(validView({ ...input, matrix: identity })).toBe(false);
    expect(validView({ ...input, previous: [identity, translation] })).toBe(false);
    // A still that moved on a little after its pause is still kept.
    const moved: Matrix = [1, 0, radii.apart - radii.steady + 0.01, 0, 1, 0, 0, 0, 1];
    expect(validView({ ...input, matrix: moved })).toBe(true);
  });
});
