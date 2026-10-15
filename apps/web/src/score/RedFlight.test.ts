import { describe, expect, it } from 'vitest';
import { flightFrames } from './RedFlight.js';

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
