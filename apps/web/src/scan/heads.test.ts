import { describe, expect, it } from 'vitest';
import { headPageFrom, placeHead, type HeadNote, type HeadPage } from './heads.js';

const SPACE = 10;
const WIDTH = 400;

interface Head {
  x: number;
  y: number;
  /** 0 is black, 255 is the paper. */
  lum?: number;
  hollow?: boolean;
}

/** A page of staves drawn with their middle line at each `centres`, and noteheads at known places. */
function page(
  centres: number[],
  heads: Head[],
  { height = 300, traced = true, tilt = 0 } = {},
): HeadPage {
  const lum = new Uint8Array(WIDTH * height).fill(255);
  // A tilted page: the lines run `tilt` rows per column, level at x = 200.
  for (const centre of centres)
    for (let line = -2; line <= 2; line++)
      for (let x = 0; x < WIDTH; x++)
        lum[(centre + line * SPACE + Math.round(tilt * (x - 200))) * WIDTH + x] = 60;
  for (const { x: cx, y: cy, lum: shade = 20, hollow = false } of heads) {
    const a = 0.62 * SPACE;
    const b = 0.46 * SPACE;
    const tilt = (-20 * Math.PI) / 180;
    for (let y = cy - 8; y <= cy + 8; y++)
      for (let x = cx - 10; x <= cx + 10; x++) {
        const u = (x - cx) * Math.cos(tilt) + (y - cy) * Math.sin(tilt);
        const v = -(x - cx) * Math.sin(tilt) + (y - cy) * Math.cos(tilt);
        const r = Math.hypot(u / a, v / b);
        if (hollow ? r <= 1.1 && r >= 0.7 : r <= 1) lum[y * WIDTH + x] = shade;
      }
  }
  const xs = [0, WIDTH - 1];
  return {
    width: WIDTH,
    height,
    lum,
    scale: 1,
    space: SPACE,
    staves: traced ? centres.map((c) => ({ xs, centers: [c, c], spacings: [SPACE, SPACE] })) : [],
  };
}

// F4 is the first space of a treble staff, whose bottom line E4 is 30 steps from C0.
const F4: HeadNote = { step: 'F', octave: 4, rest: false, clef: 30 };
const near = (placed: { x: number; y: number } | undefined, x: number, y: number, spaces = 0.2) => {
  expect(placed).toBeDefined();
  expect(Math.hypot(placed!.x - x, placed!.y - y)).toBeLessThanOrEqual(spaces * SPACE);
};

describe('placing a note on its notehead (issue 226)', () => {
  it('finds the head when homr put the point 0.6 spaces right and 0.7 up', () => {
    const p = page([80], [{ x: 200, y: 95 }]);
    near(placeHead(p, { ...F4, imgpos: { x: 206, y: 88 } }), 200, 95);
  });

  it('takes the head nearest the point, not the darkest one', () => {
    const p = page(
      [80],
      [
        { x: 187, y: 95, lum: 60 },
        { x: 200, y: 95, lum: 0 },
      ],
    );
    near(placeHead(p, { ...F4, imgpos: { x: 188, y: 90 } }), 187, 95);
    near(placeHead(p, { ...F4, imgpos: { x: 199, y: 90 } }), 200, 95);
  });

  it('still finds a head when the pitch was misread by one or two steps', () => {
    const p = page([80], [{ x: 200, y: 95 }]);
    // G4 and A4 are one and two steps above F4.
    near(placeHead(p, { ...F4, step: 'G', imgpos: { x: 204, y: 92 } }), 200, 95, 0.35);
    near(placeHead(p, { ...F4, step: 'A', imgpos: { x: 204, y: 92 } }), 200, 95, 0.35);
  });

  it('finds a hollow head', () => {
    const p = page([80], [{ x: 200, y: 95, hollow: true }]);
    near(placeHead(p, { ...F4, imgpos: { x: 206, y: 90 } }), 200, 95);
  });

  it('gives up where there is no head, a rest, or no staff in reach', () => {
    const p = page([80], [{ x: 200, y: 95 }]);
    expect(placeHead(p, { ...F4, imgpos: { x: 330, y: 95 } })).toBeUndefined();
    expect(placeHead(p, { ...F4, imgpos: { x: 200, y: 200 } })).toBeUndefined();
    expect(placeHead(p, { ...F4, rest: true, step: undefined, imgpos: { x: 200, y: 95 } })).toBe(
      undefined,
    );
    expect(placeHead(p, { ...F4 })).toBeUndefined();
  });

  it('picks the staff by pitch on a grand staff', () => {
    // Middle C under a bass clef (bottom line G2 = 18) is one ledger line above the lower staff.
    const p = page([80, 190], [{ x: 200, y: 160 }]);
    const c4 = { step: 'C', octave: 4, rest: false, clef: 18 } as const;
    near(placeHead(p, { ...c4, imgpos: { x: 206, y: 140 } }), 200, 160);
    // The same point and pitch read under a treble clef would sit on the upper staff, far away.
    expect(placeHead(p, { ...c4, clef: 30, imgpos: { x: 206, y: 140 } })).toBeUndefined();
  });

  it('reads the staff lines from the photo where the tracer found none, level or tilted', () => {
    near(
      placeHead(page([80], [{ x: 200, y: 95 }], { traced: false }), {
        ...F4,
        imgpos: { x: 206, y: 88 },
      }),
      200,
      95,
    );
    // The page tilts 2 degrees, so the lines are 7 rows higher 200 columns on.
    const tilted = page([120], [{ x: 200, y: 135 }], { traced: false, tilt: 0.035 });
    near(placeHead(tilted, { ...F4, imgpos: { x: 206, y: 128 } }), 200, 135);
  });

  it('reads the lines of a staff tilted 4.5 degrees, as a phone held at an angle gives', () => {
    const tilted = page([120], [{ x: 200, y: 135 }], { traced: false, tilt: 0.08 });
    near(placeHead(tilted, { ...F4, imgpos: { x: 206, y: 128 } }), 200, 135);
  });

  it('finds the heads of a dim photo, whose paper is grey and whose ink is not black', () => {
    // Paper at 170 and ink at 110: unstretched, a head stands out from its ring by too little.
    const printed = page([80], [{ x: 200, y: 95 }]);
    const data = new Uint8ClampedArray(printed.lum.length * 4);
    printed.lum.forEach((v, i) => {
      data.fill(Math.round(110 + (v * 60) / 255), i * 4, i * 4 + 3);
      data[i * 4 + 3] = 255;
    });
    const geometry = {
      width: WIDTH,
      height: printed.height,
      xs: [0, WIDTH - 1],
      targetRows: [],
      sourceRows: [],
      staves: [
        {
          targetCenter: 80,
          targetSpacing: SPACE,
          sourceCenters: [80, 80],
          sourceSpacings: [SPACE, SPACE],
          coverage: 1,
        },
      ],
      maxDisplacement: 0,
    };
    const dim = headPageFrom({ width: WIDTH, height: printed.height, data }, geometry, 1)!;
    near(placeHead(dim, { ...F4, imgpos: { x: 206, y: 88 } }), 200, 95);
  });

  it('maps through the analysis scale back to the photo as uploaded', () => {
    const p = { ...page([80], [{ x: 200, y: 95 }]), scale: 0.5 };
    // The photo is twice the size of the analysis copy: the head is at (400.x, 190.x) there.
    near(placeHead(p, { ...F4, imgpos: { x: 412, y: 176 } }), 401, 191, 0.5 * 2 * 0.2);
  });
});
