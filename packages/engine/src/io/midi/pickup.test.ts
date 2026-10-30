/**
 * Fixtures read here (all from the Mutopia Project, https://www.mutopiaproject.org/):
 * - fixtures/SchumannOp15No07.mid: Schumann, Kinderszenen Op. 15 No. 7 (Traeumerei), Mutopia 504,
 *   typeset by Ying-Chun Liu with LilyPond 2.6.4, licence Public Domain. Its LilyPond source has
 *   `\partial 4` and 24 bars after it.
 * - fixtures/MozartK457-1.mid: Mozart, Piano Sonata K. 457, first movement (file sonata1.mid),
 *   Mutopia 356, licence Public Domain. It opens on the downbeat.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Hand } from '../../score/types.js';
import { separateHands } from './handSeparation.js';
import { detectPickup } from './pickup.js';
import { quantize } from './quantize.js';
import { parseMidiFile } from './read.js';

const bytesOf = (path: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(path, import.meta.url))));
const engineFixture = (name: string) => bytesOf(`../../../fixtures/${name}`);
const midiFixture = (name: string) => bytesOf(`./fixtures/${name}`);

/** The pipeline as importMidi runs it: read, quantize, separate the hands, detect. */
function pickupOf(bytes: Uint8Array): number {
  const data = parseMidiFile(bytes);
  const q = quantize(data);
  return detectPickup(q.notes, separateHands(q.notes), data.timeSignatures[0]!, q.divisions);
}

type Spec = [onset: number, offset: number, midi: number];
/** Notes by [onset, offset, midi]; hands by pitch (below 54 = left), so no DP is involved. */
function detect(specs: Spec[], time = { beats: 4, beatType: 4 }): number {
  const notes = [...specs]
    .sort((a, b) => a[0] - b[0] || a[2] - b[2])
    .map(([onset, offset, midi]) => ({ onset, offset, midi }));
  const hands: Hand[] = notes.map((n) => (n.midi < 54 ? 'L' : 'R'));
  return detectPickup(notes, hands, time);
}

/** The pitch split (below 60 = left) and the automatic separation must both find nothing. */
function detectBoth(specs: Spec[], time: { beats: number; beatType: number }): number[] {
  const notes = [...specs]
    .sort((a, b) => a[0] - b[0] || a[2] - b[2])
    .map(([onset, offset, midi]) => ({ onset, offset, midi }));
  const byPitch: Hand[] = notes.map((n) => (n.midi < 60 ? 'L' : 'R'));
  const quantized = notes.map((n, i) => ({
    ...n,
    onsetSec: 0,
    velocity: 80,
    channel: 0,
    track: 0,
    sources: [i],
  }));
  return [detectPickup(notes, byPitch, time), detectPickup(notes, separateHands(quantized), time)];
}

describe('detectPickup on pieces that open on beat 1 with a bar-long pattern', () => {
  it('finds no pickup in a 2/4 rag whose right hand ties over every barline above oom-pah eighths', () => {
    const specs: Spec[] = [];
    for (let bar = 0; bar < 10; bar++) {
      const t = bar * 960;
      if (bar === 0) specs.push([t, t + 240, 76]);
      specs.push([t + 240, t + 480, 79], [t + 480, t + 720, 76], [t + 720, t + 1200, 81]);
      specs.push([t, t + 240, 43], [t + 480, t + 720, 55], [t + 480, t + 720, 59]);
    }
    expect(detectBoth(specs, { beats: 2, beatType: 4 })).toEqual([0, 0]);
  });

  it('finds no pickup in a 3/4 waltz whose left hand rests on every beat 1', () => {
    const specs: Spec[] = [];
    for (let bar = 0; bar < 10; bar++) {
      const t = bar * 1440;
      for (let k = 0; k < 3; k++)
        specs.push([t + k * 480, t + (k + 1) * 480, 72 + ((bar + k) % 5)]);
      specs.push([t + 480, t + 960, 52], [t + 480, t + 960, 55]);
      specs.push([t + 960, t + 1440, 52], [t + 960, t + 1440, 55]);
    }
    expect(detectBoth(specs, { beats: 3, beatType: 4 })).toEqual([0, 0]);
  });

  it('finds no pickup in 4/4 with left-hand chords only on beats 2 and 4', () => {
    const specs: Spec[] = [];
    for (let bar = 0; bar < 10; bar++) {
      const t = bar * 1920;
      for (let k = 0; k < 4; k++)
        specs.push([t + k * 480, t + (k + 1) * 480, 72 + ((bar + k) % 5)]);
      specs.push([t + 480, t + 960, 48], [t + 480, t + 960, 55]);
      specs.push([t + 1440, t + 1920, 48], [t + 1440, t + 1920, 55]);
    }
    expect(detectBoth(specs, { beats: 4, beatType: 4 })).toEqual([0, 0]);
  });

  it('finds no pickup in a 4/4 melody whose anticipation is tied over every barline above a short bass', () => {
    const specs: Spec[] = [];
    for (let bar = 0; bar < 10; bar++) {
      const t = bar * 1920;
      if (bar === 0) specs.push([t, t + 480, 72]);
      specs.push([t + 480, t + 960, 74], [t + 960, t + 1440, 76], [t + 1440, t + 1680, 77]);
      specs.push([t + 1680, t + 2400, 79]);
      specs.push([t, t + 240, 48], [t + 960, t + 1200, 43]);
    }
    expect(detectBoth(specs, { beats: 4, beatType: 4 })).toEqual([0, 0]);
  });

  it('finds no pickup in the waltz with the left hand resting on beat 1 when a quarter-note chord closes it', () => {
    const specs: Spec[] = [];
    for (let bar = 0; bar < 15; bar++) {
      const t = bar * 1440;
      for (let k = 0; k < 3; k++)
        specs.push([t + k * 480, t + (k + 1) * 480, 72 + ((bar + k) % 5)]);
      specs.push([t + 480, t + 960, 52], [t + 480, t + 960, 55]);
      specs.push([t + 960, t + 1440, 52], [t + 960, t + 1440, 55]);
    }
    const end = 15 * 1440;
    specs.push([end, end + 480, 72], [end, end + 480, 76], [end, end + 480, 48]);
    expect(detectBoth(specs, { beats: 3, beatType: 4 })).toEqual([0, 0]);
  });

  it('finds no pickup in the backbeat piece with left-hand chords on beats 2 and 4 when a quarter-note chord closes it', () => {
    const specs: Spec[] = [];
    for (let bar = 0; bar < 15; bar++) {
      const t = bar * 1920;
      for (let k = 0; k < 4; k++)
        specs.push([t + k * 480, t + (k + 1) * 480, 72 + ((bar + k) % 5)]);
      specs.push([t + 480, t + 960, 48], [t + 480, t + 960, 55]);
      specs.push([t + 1440, t + 1920, 48], [t + 1440, t + 1920, 55]);
    }
    const end = 15 * 1920;
    specs.push([end, end + 480, 72], [end, end + 480, 76], [end, end + 480, 48]);
    expect(detectBoth(specs, { beats: 4, beatType: 4 })).toEqual([0, 0]);
  });

  it.each([1, 3, 5])(
    'finds no pickup in the closing-chord waltz when %i of its opening bars have a bass on beat 1',
    (bassBars) => {
      const specs: Spec[] = [];
      for (let bar = 0; bar < 16; bar++) {
        const t = bar * 1440;
        for (let k = 0; k < 3; k++)
          specs.push([t + k * 480, t + (k + 1) * 480, 72 + ((bar + k) % 5)]);
        if (bar >= 7 - bassBars && bar < 7) specs.push([t, t + 480, 45]);
        specs.push([t + 480, t + 960, 52], [t + 480, t + 960, 55]);
        specs.push([t + 960, t + 1440, 52], [t + 960, t + 1440, 55]);
      }
      const end = 16 * 1440;
      specs.push([end, end + 480, 72], [end, end + 480, 76], [end, end + 480, 48]);
      expect(detectBoth(specs, { beats: 3, beatType: 4 })).toEqual([0, 0]);
    },
  );

  it('finds no pickup in the closing-chord backbeat piece with one short bass on beat 1 of its eighth bar', () => {
    const specs: Spec[] = [];
    for (let bar = 0; bar < 16; bar++) {
      const t = bar * 1920;
      for (let k = 0; k < 4; k++)
        specs.push([t + k * 480, t + (k + 1) * 480, 72 + ((bar + k) % 5)]);
      if (bar === 7) specs.push([t, t + 120, 43]);
      specs.push([t + 480, t + 960, 48], [t + 480, t + 960, 55]);
      specs.push([t + 1440, t + 1920, 48], [t + 1440, t + 1920, 55]);
    }
    const end = 16 * 1920;
    specs.push([end, end + 480, 72], [end, end + 480, 76], [end, end + 480, 48]);
    expect(detectBoth(specs, { beats: 4, beatType: 4 })).toEqual([0, 0]);
  });

  it('finds no pickup in 4/4 whose left hand enters on beat 2 with no bass on the later downbeats and whose last note ends on beat 2', () => {
    const specs: Spec[] = [];
    specs.push([0, 480, 72]);
    specs.push([480, 960, 74], [480, 960, 48], [480, 960, 55]);
    for (let bar = 1; bar < 12; bar++) {
      const t = bar * 1920;
      for (let k = 0; k < 4; k++)
        specs.push([t + k * 480, t + (k + 1) * 480, 72 + ((bar + k) % 5)]);
      specs.push([t + 480, t + 960, 48], [t + 480, t + 960, 55]);
      specs.push([t + 1440, t + 1920, 48], [t + 1440, t + 1920, 55]);
    }
    const end = 12 * 1920;
    specs.push([end, end + 480, 72]);
    expect(detectBoth(specs, { beats: 4, beatType: 4 })).toEqual([0, 0]);
  });
});

describe('detectPickup', () => {
  it('finds a quarter-note pickup when the melody plays alone and the bass enters on the downbeat', () => {
    const specs: Spec[] = [[0, 480, 67]];
    for (let bar = 0; bar < 6; bar++) {
      const s = 480 + bar * 1920;
      // the bass on every downbeat: held across the unshifted barline in the first bars, then a half note
      specs.push([s, s + (bar < 4 ? 1680 : 960), 48]);
      for (let k = 0; k < 4; k++) specs.push([s + k * 480, s + (k + 1) * 480, 72 + k]);
    }
    specs.push([480 + 6 * 1920, 480 + 7 * 1920, 72]); // a closing bar-long note on the shifted downbeat
    expect(detect(specs)).toBe(480);
  });

  it('finds no pickup when the last note is a quarter on the last beat of the unshifted bar', () => {
    const specs: Spec[] = [[0, 480, 67]];
    for (let bar = 0; bar < 6; bar++) {
      const s = 480 + bar * 1920;
      specs.push([s, s + (bar < 4 ? 1680 : 960), 48]);
      for (let k = 0; k < 4; k++) specs.push([s + k * 480, s + (k + 1) * 480, 72 + k]);
    }
    expect(detect(specs)).toBe(0);
  });

  it('keeps a waltz whose left hand rests on beat 1 of the first bar and plays on beats 2 and 3', () => {
    const specs: Spec[] = [];
    for (let bar = 0; bar < 8; bar++) {
      const s = bar * 1440;
      for (let k = 0; k < 3; k++) specs.push([s + k * 480, s + (k + 1) * 480, 72 + k]);
      if (bar > 0) specs.push([s, s + 480, 45]); // the bass on beat 1 of every later bar
      specs.push([s + 480, s + 960, 52], [s + 480, s + 960, 55]);
      specs.push([s + 960, s + 1440, 52], [s + 960, s + 1440, 55]);
    }
    expect(detect(specs, { beats: 3, beatType: 4 })).toBe(0);
  });

  it('finds an eighth-note pickup in 6/8 when held notes cross the barlines of the unshifted grid', () => {
    const specs: Spec[] = [[0, 240, 67]];
    for (let bar = 0; bar < 8; bar++) {
      const s = 240 + bar * 1440;
      specs.push([s, s + 1440, 72]); // one held note per true bar
    }
    expect(detect(specs, { beats: 6, beatType: 8 })).toBe(240);
  });

  it('stands on the ending: the same opening without a last note on the shifted barline finds nothing', () => {
    const specs: Spec[] = [[0, 480, 67]];
    for (let bar = 0; bar < 6; bar++) {
      const s = 480 + bar * 1920;
      specs.push([s, s + (bar < 4 ? 1680 : 960), 48]);
      for (let k = 0; k < 4; k++) specs.push([s + k * 480, s + (k + 1) * 480, 72 + k]);
    }
    specs.push([480 + 6 * 1920, 480 + 7 * 1920, 72]);
    expect(detect(specs)).toBe(480);
    expect(detect([...specs, [15600, 16320, 72]])).toBe(0);
  });

  it('needs no ending when both rules propose the same pickup', () => {
    const specs: Spec[] = [[0, 480, 67]];
    for (let bar = 0; bar < 8; bar++) {
      const s = 480 + bar * 1920;
      specs.push([s, s + 1920, 72], [s, s + 1920, 48]); // whole notes tie each true bar to the next
    }
    expect(detect(specs)).toBe(480);
    expect(detect([...specs, [15840, 16560, 72]])).toBe(480);
  });

  it('finds no pickup of more than half a bar', () => {
    const specs: Spec[] = [];
    for (let k = 0; k < 5; k++) specs.push([k * 240, (k + 1) * 240, 67 + k]);
    for (let bar = 0; bar < 6; bar++) {
      const s = 1200 + bar * 1440;
      specs.push([s, s + 1440, 48]);
      for (let k = 0; k < 6; k++) specs.push([s + k * 240, s + (k + 1) * 240, 72 + k]);
    }
    expect(detect(specs, { beats: 6, beatType: 8 })).toBe(0);
  });

  it('does not trust the crossings alone when the last note starts off a downbeat', () => {
    const held: Spec[] = [[0, 240, 67]];
    for (let bar = 0; bar < 8; bar++) held.push([240 + bar * 1440, 240 + (bar + 1) * 1440, 72]);
    expect(detect(held, { beats: 6, beatType: 8 })).toBe(240);
    const lastBar = 240 + 7 * 1440;
    const ends: Spec[] = [...held, [lastBar + 1200, lastBar + 1440, 76]];
    expect(detect(ends, { beats: 6, beatType: 8 })).toBe(0);
  });

  it('leaves a file alone when the first note comes after a rest', () => {
    const specs: Spec[] = [[240, 480, 67]];
    for (let bar = 0; bar < 6; bar++) {
      const s = 480 + bar * 1920;
      specs.push([s, s + 960, 48]);
      for (let k = 0; k < 4; k++) specs.push([s + k * 480, s + (k + 1) * 480, 72 + k]);
    }
    expect(detect(specs)).toBe(0);
  });

  it('finds nothing when both hands start at tick 0', () => {
    const specs: Spec[] = [];
    for (let bar = 0; bar < 4; bar++)
      for (let k = 0; k < 4; k++) {
        const s = bar * 1920 + k * 480;
        specs.push([s, s + 480, 72], [s, s + 480, 48]);
      }
    expect(detect(specs)).toBe(0);
  });

  it('finds nothing for a time signature that gives no whole number of ticks', () => {
    const specs: Spec[] = [
      [0, 480, 67],
      [480, 960, 48],
      [960, 1440, 72],
    ];
    expect(detect(specs, { beats: 0, beatType: 4 })).toBe(0);
    expect(detect(specs, { beats: 4, beatType: 0 })).toBe(0);
    expect(detect(specs, { beats: 3, beatType: 7 })).toBe(0);
  });

  it('finds nothing in an empty score', () => {
    expect(detect([])).toBe(0);
  });

  it('finds the quarter-note pickup of Traeumerei (Mutopia 504)', () => {
    expect(pickupOf(midiFixture('SchumannOp15No07.mid'))).toBe(480);
  });

  it.each([
    ['twinkle.mid', () => engineFixture('twinkle.mid')],
    ['tempo-map.mid', () => engineFixture('tempo-map.mid')],
    ['MozartK457-1.mid, which opens on the downbeat', () => midiFixture('MozartK457-1.mid')],
  ])('finds no pickup in %s', (_name, bytes) => {
    expect(pickupOf(bytes())).toBe(0);
  });
});
