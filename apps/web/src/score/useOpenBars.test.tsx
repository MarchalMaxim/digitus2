import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OnsetGroup } from './onsetGroups.js';
import { useOpenBars, wantedBars, type OpenBarsInput } from './useOpenBars.js';

/** Three bars of two notes each; bars are told apart by the drawn `g.measure`, not by an index. */
function sheet() {
  const host = document.createElement('div');
  const bar = (a: string, b: string) =>
    `<g class="measure"><g class="note" id="${a}"></g><g class="note" id="${b}"></g></g>`;
  host.innerHTML = `<svg><g class="system">${bar('a', 'b')}${bar('c', 'd')}${bar('e', 'f')}</g></svg>`;
  document.body.append(host);
  return host;
}
/** A group of one note in `hand`, in bar `bar` (0-based). */
const group = (id: string, bar: number, hand: 'L' | 'R' = 'R'): OnsetGroup =>
  ({
    tick: 0,
    sec: 0,
    endSec: 0,
    noteIds: [id],
    notes: [{ id, hand, measureIndex: bar }],
  }) as unknown as OnsetGroup;
const groups = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => group(id, Math.floor(i / 2)));
const mark = (host: Element, id: string) => {
  host.querySelectorAll('.is-red').forEach((e) => e.classList.remove('is-red'));
  host.querySelector(`#${id}`)!.classList.add('is-red');
};
const open = (host: Element) =>
  Array.from(host.querySelectorAll('g.measure')).flatMap((m, i) =>
    m.classList.contains('is-open') ? [i] : [],
  );

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const PAGES = ['p'];
const base = (host: Element): OpenBarsInput & { host: Element } => ({
  host,
  pages: PAGES,
  groups,
  currentGroup: -1,
  hopping: false,
  playing: false,
  hovered: null,
});

describe('wantedBars', () => {
  it('opens no bar while nothing is marked, not even bar 1', () => {
    expect([...wantedBars(base(sheet()))]).toEqual([]);
  });
  it("opens the cursor's bar, and waits for a hop to land", () => {
    const host = sheet();
    mark(host, 'c');
    expect([...wantedBars({ ...base(host), currentGroup: 2 })]).toEqual([1]);
    expect([...wantedBars({ ...base(host), currentGroup: 2, hopping: true })]).toEqual([]);
  });
  it('opens the next bar from the last onset group of the current one, only while playing', () => {
    const host = sheet();
    mark(host, 'a');
    expect([...wantedBars({ ...base(host), currentGroup: 0, playing: true })]).toEqual([0]);
    mark(host, 'b');
    expect([...wantedBars({ ...base(host), currentGroup: 1, playing: true })]).toEqual([0, 1]);
    expect([...wantedBars({ ...base(host), currentGroup: 1 })]).toEqual([0]);
  });
  it('skips onsets only a muted hand plays when looking for the next bar', () => {
    const host = sheet();
    // Bar 0 ends with a left-hand onset ('b'); the right hand's next onset is 'c' in bar 1.
    const gs = [group('a', 0), group('b', 0, 'L'), group('c', 1), group('d', 1)];
    mark(host, 'a');
    // Left muted: from 'a' the cursor goes straight to 'c', so bar 1 opens ahead.
    expect([
      ...wantedBars({
        ...base(host),
        groups: gs,
        currentGroup: 0,
        playing: true,
        mutedHands: ['L'],
      }),
    ]).toEqual([0, 1]);
    // Both hands played: 'b' is next and is in bar 0, so bar 1 stays closed.
    expect([...wantedBars({ ...base(host), groups: gs, currentGroup: 0, playing: true })]).toEqual([
      0,
    ]);
  });
  it("at the last group of a loop, opens the loop's first bar, not the bar after it", () => {
    const host = sheet();
    mark(host, 'c');
    const loop = { from: 0, to: 1 };
    // 'd' is the last group of bar 1, the loop's end; the music wraps to bar 0.
    mark(host, 'd');
    expect([...wantedBars({ ...base(host), currentGroup: 3, playing: true, loop })].sort()).toEqual(
      [0, 1],
    );
    // Without the loop the next bar is bar 2.
    expect([...wantedBars({ ...base(host), currentGroup: 3, playing: true })].sort()).toEqual([
      1, 2,
    ]);
  });
  it('adds the hovered bar, with or without a cursor', () => {
    const host = sheet();
    expect([...wantedBars({ ...base(host), hovered: 2 })]).toEqual([2]);
    mark(host, 'a');
    expect([...wantedBars({ ...base(host), currentGroup: 0, hovered: 2 })].sort()).toEqual([0, 2]);
  });
});

describe('useOpenBars', () => {
  it('toggles .is-open on the bars that change, fades the closing one, and survives new pages', () => {
    vi.useFakeTimers();
    const host = sheet();
    mark(host, 'a');
    const { rerender } = renderHook((p: OpenBarsInput) => useOpenBars(p), {
      initialProps: { ...base(host), currentGroup: 0 },
    });
    expect(open(host)).toEqual([0]);
    mark(host, 'c');
    rerender({ ...base(host), currentGroup: 2 });
    expect(open(host)).toEqual([1]);
    const first = host.querySelectorAll('g.measure')[0]!;
    expect(first.classList.contains('is-closing')).toBe(true);
    vi.advanceTimersByTime(400);
    expect(first.classList.contains('is-closing')).toBe(false);
    // A re-layout replaces the markup: the same open set is applied to the new bars.
    const fresh = sheet();
    mark(fresh, 'c');
    rerender({ ...base(fresh), pages: ['q'], currentGroup: 2 });
    expect(open(fresh)).toEqual([1]);
  });
  it('reads what is open from the markup after a new layout, not from the old record', () => {
    const old = sheet();
    mark(old, 'c');
    const { rerender } = renderHook((p: OpenBarsInput) => useOpenBars(p), {
      initialProps: { ...base(old), currentGroup: 2 },
    });
    expect(open(old)).toEqual([1]);
    // The new layout's page was decorated from the old record before the effect ran: bar 1
    // carries .is-open, and the cursor is now in bar 0.
    const fresh = sheet();
    fresh.querySelectorAll('g.measure')[1]!.classList.add('is-open');
    mark(fresh, 'a');
    rerender({ ...base(fresh), pages: ['q'], currentGroup: 0 });
    expect(open(fresh)).toEqual([0]);
  });
  it('gives a page built later its open bars', () => {
    const host = sheet();
    mark(host, 'c');
    const { result } = renderHook(() => useOpenBars({ ...base(host), currentGroup: 2 }));
    const page = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    page.setAttribute('data-first-bar', '1');
    page.setAttribute('data-bars', '2');
    page.innerHTML = '<g class="measure"></g><g class="measure"></g>';
    result.current(page);
    expect(
      Array.from(page.querySelectorAll('g.measure')).map((m) => m.classList.contains('is-open')),
    ).toEqual([true, false]);
  });
});
