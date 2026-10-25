import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haloProgress, haloRadius, type Halo } from './halo.js';
import { useAlongHalo } from './useAlongHalo.js';

// The halo's drawing (issue 204): a ring in the g.note of the topmost marked notehead, closing in
// frame by frame on fake time, under StrictMode like the app.

const BOXES: Record<string, { x: number; y: number; width: number; height: number }> = {
  a: { x: 0, y: 0, width: 10, height: 8 },
  b: { x: 0, y: 30, width: 10, height: 8 },
  c: { x: 0, y: 20, width: 10, height: 8 },
};

function makeHost(): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML =
    '<svg><g class="note" id="a"><g class="notehead"></g></g>' +
    '<g class="chord is-red"><g class="note" id="b"><g class="notehead"></g></g>' +
    '<g class="note" id="c"><g class="notehead"></g></g></g></svg>';
  document.body.appendChild(el);
  return el;
}

const rings = (h: Element) => Array.from(h.querySelectorAll('.along-halo'));
const radius = (h: Element) => rings(h)[0]?.getAttribute('r');
const rounded = (r: number) => String(Math.round(r * 100) / 100);

function newHalo(): Halo {
  return { index: 1, startMs: performance.now(), ms: 1000, beats: 2 };
}

/** Lets `ms` go by, then runs the next frame: the clock lands on a frame, where the ring was just set. */
function to(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
    vi.advanceTimersToNextFrame();
  });
}

let host: HTMLElement;
// happy-dom's SVG elements carry their own getBBox, so the stub goes where it is defined.
const proto = SVGGraphicsElement.prototype;
const ownBBox = Object.getOwnPropertyDescriptor(proto, 'getBBox');

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
  Object.defineProperty(proto, 'getBBox', {
    configurable: true,
    value(this: Element) {
      return BOXES[this.closest('.note')?.id ?? 'a'];
    },
  });
  host = makeHost();
});
afterEach(() => {
  cleanup();
  host.remove();
  vi.restoreAllMocks();
  if (ownBBox) Object.defineProperty(proto, 'getBBox', ownBBox);
  else delete (proto as unknown as Record<string, unknown>).getBBox;
  vi.useRealTimers();
});

function mount(h: Halo | null) {
  return renderHook(({ halo }: { halo: Halo | null }) => useAlongHalo(host, halo, 0), {
    initialProps: { halo: h },
    wrapper: StrictMode,
  });
}

describe('useAlongHalo', () => {
  it('draws one ring in the g.note of the topmost marked notehead', () => {
    mount(newHalo());
    expect(rings(host)).toHaveLength(1);
    const ring = rings(host)[0]!;
    expect(ring.parentElement?.id).toBe('c');
    expect(ring.getAttribute('aria-hidden')).toBe('true');
    expect(ring.getAttribute('r')).toBe(rounded(haloRadius(10, 0)));
  });

  it('closes in linearly', () => {
    const halo = newHalo();
    mount(halo);
    const seen: number[] = [];
    for (const ms of [250, 250, 250]) {
      to(ms);
      const p = (performance.now() - halo.startMs) / 1000;
      expect(radius(host)).toBe(rounded(haloRadius(10, p)));
      seen.push(Number(radius(host)));
    }
    expect(seen[0]!).toBeGreaterThan(seen[1]!);
    expect(seen[1]!).toBeGreaterThan(seen[2]!);
  });

  it('is gone when the gap is up, and the loop stops', () => {
    mount(newHalo());
    to(1000);
    to(0);
    expect(rings(host)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('draws nothing for a halo already over', () => {
    mount({ index: 1, startMs: performance.now() - 2000, ms: 1000, beats: 2 });
    expect(rings(host)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('steps once per beat under reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const halo = newHalo();
    mount(halo);
    expect(radius(host)).toBe(rounded(haloRadius(10, 0)));
    to(400);
    expect(performance.now() - halo.startMs).toBeLessThan(500);
    expect(radius(host)).toBe(rounded(haloRadius(10, 0)));
    to(200);
    expect(performance.now() - halo.startMs).toBeGreaterThanOrEqual(500);
    expect(radius(host)).toBe(rounded(haloRadius(10, 0.5)));
    expect(haloProgress(halo, performance.now(), true)).toBe(0.5);
    to(300);
    expect(radius(host)).toBe(rounded(haloRadius(10, 0.5)));
    to(300);
    expect(rings(host)).toHaveLength(0);
  });

  it('goes when the halo goes', () => {
    const view = mount(newHalo());
    expect(rings(host)).toHaveLength(1);
    view.rerender({ halo: null });
    expect(rings(host)).toHaveLength(0);
  });

  it('moves to the next note for the next halo', () => {
    const view = mount(newHalo());
    host.querySelector('.is-red')!.classList.remove('is-red');
    host.querySelector('#a')!.classList.add('is-red');
    view.rerender({ halo: newHalo() });
    expect(rings(host)).toHaveLength(1);
    expect(rings(host)[0]!.parentElement?.id).toBe('a');
  });

  it('draws nothing when no notehead is marked', () => {
    host.querySelector('.is-red')!.classList.remove('is-red');
    mount(newHalo());
    expect(rings(host)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('one ring under StrictMode, none after unmount', () => {
    const view = mount(newHalo());
    expect(rings(host)).toHaveLength(1);
    view.unmount();
    expect(rings(host)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops when its page is rebuilt', () => {
    mount(newHalo());
    host.querySelector('#c')!.remove();
    to(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
