import { describe, expect, it } from 'vitest';
import { SYSTEM_TOP_MARGIN } from './useCursor.js';
import { practiceOpenScroll, raiseTallest, readerSystemIndex, systemRoom } from './ScoreView.js';

// Opening the Practice panel on a phone (issue 244): the page scrolls so that the reader's
// system stands above the dock, and the panel keeps room above it for the tallest system.

const systems = [
  { top: 100, bottom: 260 },
  { top: 280, bottom: 440 },
  { top: 460, bottom: 620 },
];

describe('the reader’s system', () => {
  it('is the marked one when there is one', () => {
    expect(readerSystemIndex(systems, 2, 0)).toBe(2);
    expect(readerSystemIndex(systems, 0, 300)).toBe(0);
  });

  it('is otherwise the first system that starts at or below the top of the band', () => {
    expect(readerSystemIndex(systems, -1, 0)).toBe(0);
    expect(readerSystemIndex(systems, -1, 101)).toBe(1);
    expect(readerSystemIndex(systems, -1, 280)).toBe(1);
  });

  it('is otherwise the first system cut at the top of the band', () => {
    expect(readerSystemIndex(systems, -1, 621)).toBe(-1);
    const cut = [
      { top: -40, bottom: 120 },
      { top: 140, bottom: 300 },
    ];
    expect(readerSystemIndex(cut, -1, 301)).toBe(-1);
    expect(readerSystemIndex([{ top: -40, bottom: 120 }], -1, 0)).toBe(0);
  });

  it('is none when there are no systems', () => {
    expect(readerSystemIndex([], -1, 0)).toBe(-1);
  });
});

describe('the scroll that opening Practice makes', () => {
  const band = { top: 0, bottom: 400 };

  it('is none while the system is wholly above the dock', () => {
    expect(practiceOpenScroll({ top: 20, bottom: 180 }, band)).toBeNull();
  });

  it('puts the system’s top a margin below the top of the band when it does not fit above the dock', () => {
    expect(practiceOpenScroll({ top: 300, bottom: 460 }, band)).toBe(300 - SYSTEM_TOP_MARGIN);
  });

  it('shrinks the margin when the system only just fits', () => {
    // 395 high in a band of 400: five pixels of margin left.
    expect(practiceOpenScroll({ top: 350, bottom: 745 }, band)).toBe(350 - 5);
  });

  it('centres a system taller than the band', () => {
    expect(practiceOpenScroll({ top: 300, bottom: 800 }, band)).toBe(300 - (400 - 500) / 2);
  });
});

describe('the room kept for the tallest system', () => {
  it('is the tallest system and its margin', () => {
    expect(systemRoom([140, 165, 120])).toBe(165 + SYSTEM_TOP_MARGIN);
  });

  it('is none while no system is built', () => {
    expect(systemRoom([])).toBeNull();
  });
});

describe('the tallest system of a layout', () => {
  const room = () => document.documentElement.style.getPropertyValue('--system-room');

  it('never shrinks when a page built later has smaller systems', () => {
    const pages = ['a', 'b'];
    const tallest = { pages, height: 0 };
    raiseTallest(tallest, pages, [184, 150]);
    expect(room()).toBe(`${184 + SYSTEM_TOP_MARGIN}px`);
    raiseTallest(tallest, pages, [175]);
    expect(room()).toBe(`${184 + SYSTEM_TOP_MARGIN}px`);
    raiseTallest(tallest, pages, [209]);
    expect(room()).toBe(`${209 + SYSTEM_TOP_MARGIN}px`);
  });

  it('starts again when the layout changes', () => {
    const tallest = { pages: ['a'], height: 0 };
    raiseTallest(tallest, tallest.pages, [200]);
    raiseTallest(tallest, ['b'], [120]);
    expect(room()).toBe(`${120 + SYSTEM_TOP_MARGIN}px`);
  });
});
