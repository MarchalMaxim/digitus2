import { describe, expect, it } from 'vitest';
import {
  barElement,
  barOrdinal,
  markSpare,
  setOpenBars,
  settleClosing,
  sweepDimming,
} from './dom.js';

// The edition's digits (issue 94): the spare mark, the bars that open, the hand switch.
const digit = (n: number) =>
  `<g class="fing" data-startid="#n${n}"><text><tspan><tspan>1</tspan></tspan></text></g>`;

function host() {
  const div = document.createElement('div');
  div.innerHTML = `<svg><g class="measure">${digit(1)}${digit(2)}</g></svg>`;
  return div;
}

/** Two pages of two bars each: the bars are numbered across the pages. */
function pages(windowed: boolean) {
  const div = document.createElement('div');
  const bar = (n: number) => `<g class="measure"><g class="fing" data-startid="#n${n}"></g></g>`;
  div.innerHTML = [0, 2]
    .map((first) => {
      const stated = windowed ? ` data-first-bar="${first}" data-bars="2"` : '';
      return `<svg${stated}><g class="system">${bar(first)}${bar(first + 1)}</g></svg>`;
    })
    .join('');
  return div;
}

describe('markSpare', () => {
  it('marks the digits whose note is not printed, and clears the mark when printed is null', () => {
    const h = host();
    expect(markSpare(h, new Set(['n1']))).toBe(1);
    const [a, b] = Array.from(h.querySelectorAll('g.fing'));
    expect(a!.classList.contains('is-spare')).toBe(false);
    expect(b!.classList.contains('is-spare')).toBe(true);
    // Another set moves the mark; the digits stay in the markup.
    expect(markSpare(h, new Set(['n2']))).toBe(1);
    expect(a!.classList.contains('is-spare')).toBe(true);
    expect(b!.classList.contains('is-spare')).toBe(false);
    expect(markSpare(h, null)).toBe(0);
    expect(h.querySelectorAll('.is-spare')).toHaveLength(0);
    expect(h.querySelectorAll('g.fing')).toHaveLength(2);
  });
});

describe('the drawn bars', () => {
  it.each([true, false])('are numbered across the pages (windowed: %s)', (windowed) => {
    const h = pages(windowed);
    const third = barElement(h, 2)!;
    expect(third.querySelector('g.fing')!.getAttribute('data-startid')).toBe('#n2');
    expect(barOrdinal(h, third.querySelector('g.fing')!)).toBe(2);
    expect(barOrdinal(h, h.querySelector('svg')!)).toBeNull();
    expect(barElement(h, 4)).toBeNull();
  });

  it('open and close only as they change, with a closing fade only when asked', () => {
    const h = pages(false);
    const none = new Set<number>();
    expect(setOpenBars(h, none, new Set([1, 2]), true)).toEqual([]);
    expect(h.querySelectorAll('.is-open')).toHaveLength(2);
    const closing = setOpenBars(h, new Set([1, 2]), new Set([2, 3]), true);
    expect(closing).toHaveLength(1);
    expect(closing[0]!.classList.contains('is-closing')).toBe(true);
    expect(closing[0]!.classList.contains('is-open')).toBe(false);
    expect(barElement(h, 3)!.classList.contains('is-open')).toBe(true);
    // Opening a bar that is closing stops its closing.
    setOpenBars(h, new Set([2, 3]), new Set([1, 2, 3]), true);
    expect(barElement(h, 1)!.classList.contains('is-closing')).toBe(false);
    settleClosing(closing);
    // Reduced motion: no closing class at all.
    expect(setOpenBars(h, new Set([1, 2, 3]), none, false)).toEqual([]);
    expect(h.querySelectorAll('.is-open, .is-closing')).toHaveLength(0);
  });
});

describe('a hand switch', () => {
  it('sweeps no spare digit outside an open bar, and one inside it as any digit', () => {
    const h = pages(false);
    const fings = Array.from(h.querySelectorAll('g.fing'));
    for (const f of fings.slice(0, 2)) {
      f.classList.add('is-muted', 'is-spare');
    }
    barElement(h, 0)!.classList.add('is-open');
    const systems = new Set(Array.from(h.querySelectorAll('g.system')));
    const marked = sweepDimming(h, fings.slice(0, 2), 100, systems);
    expect(marked).toBe(1);
    expect(fings[0]!.classList.contains('is-sweeping')).toBe(true);
    expect(fings[1]!.classList.contains('is-sweeping')).toBe(false);
    expect(fings[1]!.classList.contains('is-returning')).toBe(false);
  });
});
