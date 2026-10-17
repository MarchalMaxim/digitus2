import { readFileSync } from 'node:fs';
import { parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { barAt, barIndexAt, barStartSecs, clampBar, seekKey, type BarBox } from './bars.js';

const PICKUP_PIANO = '../../fixtures/pickup-piano.musicxml';

/** 3/4 at 100 qpm: a one-beat pickup (0.6 s), then three full bars of 1.8 s. */
const { score: pickup } = parseMusicXml(
  readFileSync(new URL(PICKUP_PIANO, import.meta.url), 'utf8'),
);

// T13: the score is the timeline; a seek goes to a bar's start.
describe('seeking by bar', () => {
  it('reads when each bar starts, a pickup included', () => {
    const starts = barStartSecs(pickup);
    expect(starts).toHaveLength(pickup.measures.length);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBeCloseTo(0.6, 9);
    expect(starts[2]).toBeCloseTo(2.4, 9);
  });

  it('finds the bar a time lies in, its start included', () => {
    const starts = [0, 0.6, 2.4, 4.2];
    expect(barIndexAt(starts, 0)).toBe(0);
    expect(barIndexAt(starts, 0.59)).toBe(0);
    expect(barIndexAt(starts, 0.6)).toBe(1);
    // A start read back through the tempo arithmetic may be a hair early: still that bar.
    expect(barIndexAt(starts, 2.4 - 1e-12)).toBe(2);
    expect(barIndexAt(starts, 99)).toBe(3);
    expect(barIndexAt(starts, -1)).toBe(0);
  });

  it('keeps a step inside the piece, and inside the loop when one is set', () => {
    expect(clampBar(-1, 10, null)).toBe(0);
    expect(clampBar(12, 10, null)).toBe(9);
    expect(clampBar(4, 10, null)).toBe(4);
    expect(clampBar(1, 10, { from: 3, to: 5 })).toBe(3);
    expect(clampBar(8, 10, { from: 3, to: 5 })).toBe(5);
    expect(clampBar(4, 10, { from: 3, to: 5 })).toBe(4);
  });

  it('reads Left, Right, Shift for four bars and Home, unless a control takes the key', () => {
    const press = (
      key: string,
      more: Partial<KeyboardEvent> = {},
      target: EventTarget | null = null,
    ) =>
      seekKey({
        key,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        defaultPrevented: false,
        isComposing: false,
        ...more,
        target,
      });
    expect(press('ArrowLeft')).toEqual({ kind: 'step', bars: -1 });
    expect(press('ArrowRight')).toEqual({ kind: 'step', bars: 1 });
    expect(press('ArrowLeft', { shiftKey: true })).toEqual({ kind: 'step', bars: -4 });
    expect(press('ArrowRight', { shiftKey: true })).toEqual({ kind: 'step', bars: 4 });
    expect(press('Home')).toEqual({ kind: 'start' });
    expect(press('ArrowUp')).toBeNull();
    expect(press('ArrowLeft', { altKey: true })).toBeNull(); // the browser's Back
    expect(press('ArrowLeft', { metaKey: true })).toBeNull();
    expect(press('ArrowLeft', { defaultPrevented: true })).toBeNull();

    const slider = document.createElement('input');
    slider.type = 'range';
    const radio = document.createElement('div');
    radio.setAttribute('role', 'radio');
    const button = document.createElement('button');
    expect(press('ArrowLeft', {}, slider)).toBeNull();
    expect(press('Home', {}, slider)).toBeNull();
    expect(press('ArrowRight', {}, radio)).toBeNull();
    expect(press('ArrowRight', {}, button)).toEqual({ kind: 'step', bars: 1 });
    expect(press('ArrowRight', {}, document.body)).toEqual({ kind: 'step', bars: 1 });
  });

  it('finds the bar drawn under a point', () => {
    const boxes: BarBox[] = [
      { bar: 0, left: 0, right: 100, top: 0, bottom: 80 },
      { bar: 1, left: 100, right: 180, top: 0, bottom: 80 },
      { bar: 2, left: 0, right: 120, top: 120, bottom: 200 },
    ];
    expect(barAt(boxes, 50, 40)?.bar).toBe(0);
    expect(barAt(boxes, 100, 40)?.bar).toBe(1); // a bar line belongs to the bar it opens
    expect(barAt(boxes, 60, 150)?.bar).toBe(2);
    expect(barAt(boxes, 60, 100)).toBeNull(); // between the systems
    expect(barAt(boxes, 190, 40)).toBeNull(); // right of the last bar
  });
});
