import { describe, expect, it } from 'vitest';
import { HOP_MAX_MS, HOP_MIN_MS } from '../design/motion.js';
import { flightFrames, hopLift, hopMs, liveHeads } from './RedFlight.js';

const button = { x: 100, y: 600, w: 96, h: 44 };
const note = { x: 300, y: 200, w: 10, h: 8 };

// Motion study 05: the red travels between Play and the cursor as one shape.
describe('the red flight', () => {
  it("leaves Play with Play's exact box and lands on the notehead, round and tilted", () => {
    const f = flightFrames({ dir: 'out', button, note, durationMs: 200 });
    expect(f.x).toEqual([{ transform: 'translateX(100px)' }, { transform: 'translateX(300px)' }]);
    expect(f.y).toEqual([{ transform: 'translateY(600px)' }, { transform: 'translateY(200px)' }]);
    expect(f.shape[0]).toMatchObject({
      width: '96px',
      height: '44px',
      borderRadius: '0%',
      transform: 'rotate(0deg)',
    });
    expect(f.shape[1]).toMatchObject({
      width: '10px',
      borderRadius: '50%',
      transform: 'rotate(-20deg)',
    });
    // One easing per axis: the path bows instead of running straight.
    expect(f.xEasing).not.toBe(f.yEasing);
  });

  it('flies home along the same frames, backwards', () => {
    const out = flightFrames({ dir: 'out', button, note, durationMs: 200 });
    const home = flightFrames({ dir: 'home', button, note, durationMs: 200 });
    expect(home.x).toEqual([...out.x].reverse());
    expect(home.y).toEqual([...out.y].reverse());
    expect(home.shape).toEqual([...out.shape].reverse());
  });
});

// T13: a seek makes the red hop from where it is to the bar sought.
describe('the hop', () => {
  const from = { x: 100, y: 300, w: 10, h: 8 };
  const to = { x: 400, y: 340, w: 12, h: 9 };

  it('arcs above the higher end, higher for a longer hop, and lands round on the notehead', () => {
    const f = flightFrames({
      dir: 'hop',
      from,
      fromNote: true,
      note: to,
      durationMs: 260,
      playing: false,
    });
    expect(f.x).toEqual([{ transform: 'translateX(100px)' }, { transform: 'translateX(400px)' }]);
    expect(f.y[0]!.transform).toBe('translateY(300px)');
    expect(f.y[f.y.length - 1]!.transform).toBe('translateY(340px)');
    const peak = Number(/translateY\((.+)px\)/.exec(String(f.y[1]!.transform))![1]);
    expect(peak).toBeLessThan(300);
    expect(300 - peak).toBe(hopLift(Math.hypot(300, 40)));
    expect(hopLift(1000)).toBeGreaterThan(hopLift(100));
    expect(hopLift(0)).toBeGreaterThan(0); // a hop on the spot still leaves the ground
    const last = f.shape[f.shape.length - 1]!;
    expect(last).toMatchObject({ width: '12px', borderRadius: '50%', transform: 'rotate(-20deg)' });
    // It squashes as it lands: wider and flatter just before it settles.
    const squash = f.shape[f.shape.length - 2]!;
    expect(parseFloat(String(squash.width))).toBeGreaterThan(12);
    expect(squash.borderRadius).toBe('50%'); // squashed, still a notehead, never a square
  });

  it("leaves Play with Play's exact box when the red is on Play", () => {
    const f = flightFrames({
      dir: 'hop',
      from: button,
      fromNote: false,
      note: to,
      durationMs: 260,
      playing: true,
    });
    expect(f.shape[0]).toMatchObject({ width: '96px', height: '44px', borderRadius: '0%' });
  });

  it('takes a little longer across the page than to a neighbour, within bounds', () => {
    expect(hopMs(0)).toBe(HOP_MIN_MS);
    expect(hopMs(300)).toBeGreaterThan(hopMs(50));
    expect(hopMs(5000)).toBe(HOP_MAX_MS);
  });
});

// The last noteheads are held weakly (issue 99): a page torn down by the page window must not stay
// alive through them, and a flight home or the finish never leaves from one.
describe('the last noteheads', () => {
  it('keeps only those still in the page', () => {
    const page = document.createElement('div');
    const kept = page.appendChild(document.createElement('span'));
    const torn = document.createElement('span');
    document.body.append(page);
    try {
      expect(liveHeads([new WeakRef(kept), new WeakRef(torn)])).toEqual([kept]);
      page.remove();
      expect(liveHeads([new WeakRef(kept)])).toEqual([]);
    } finally {
      page.remove();
    }
  });
});
