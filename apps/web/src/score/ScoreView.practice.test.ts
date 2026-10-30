import { describe, expect, it } from 'vitest';
import { SYSTEM_TOP_MARGIN } from './useCursor.js';
import {
  practiceOpenScroll,
  practiceScroll,
  publishSystemRoom,
  raiseTallest,
  readerSystemIndex,
  startTallest,
  systemRoom,
  type TallestSystem,
} from './usePracticePlacement.js';

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

describe('the scroll that opening Practice makes, given the room the panel keeps', () => {
  // A 375 x 812 phone: the open dock's top is at 414 and the tallest system is 170 high.
  const band = { top: 0, bottom: 414 };
  const room = 170 + SYSTEM_TOP_MARGIN;

  it('is none while the dock leaves the system as it stands, even if the cap could cover it', () => {
    // Minuet's first system, 217 to 382: above the dock, and below the room the cap keeps.
    expect(practiceScroll({ top: 217, bottom: 382 }, band, room, true)).toBeNull();
  });

  it('places a covered system within the room, so a panel that grows covers no more of it', () => {
    expect(practiceScroll({ top: 300, bottom: 470 }, band, room, true)).toBe(
      300 - SYSTEM_TOP_MARGIN,
    );
    // A room larger than the band changes nothing: the band is the limit.
    expect(practiceScroll({ top: 300, bottom: 470 }, { top: 0, bottom: 180 }, 900, true)).toBe(
      300 - (180 - 170),
    );
  });

  it('judges the dock as tall as it can get while a row may still arrive', () => {
    // 217 to 382 is above today's dock but below the room: placed, within the room.
    expect(practiceScroll({ top: 217, bottom: 382 }, band, room, false)).toBe(
      217 - SYSTEM_TOP_MARGIN,
    );
    // Already within the room: nothing to move.
    expect(practiceScroll({ top: 20, bottom: 180 }, band, room, false)).toBeNull();
  });

  it('has no room to place within before a system is built', () => {
    expect(practiceScroll({ top: 300, bottom: 470 }, band, null, true)).toBe(
      300 - SYSTEM_TOP_MARGIN,
    );
  });
});

describe('the room kept for the tallest system', () => {
  it('is the tallest system and its margin', () => {
    expect(systemRoom(165)).toBe(165 + SYSTEM_TOP_MARGIN);
  });

  it('is none while no system is built', () => {
    expect(systemRoom(0)).toBeNull();
  });
});

describe('the tallest system of a layout', () => {
  const room = () => document.documentElement.style.getPropertyValue('--system-room');
  const fresh = (): TallestSystem => ({ pages: [], width: 0, height: 0 });

  it('is counted from the systems built with the layout', () => {
    const tallest = fresh();
    startTallest(tallest, ['a'], 360, [184, 150]);
    expect(tallest.height).toBe(184);
  });

  it('is raised by a page built later and never lowered by a smaller one', () => {
    const tallest = fresh();
    startTallest(tallest, ['a'], 360, [184]);
    raiseTallest(tallest, [175]);
    expect(tallest.height).toBe(184);
    raiseTallest(tallest, [150, 209]);
    expect(tallest.height).toBe(209);
  });

  it('starts again for a new layout', () => {
    const tallest = fresh();
    startTallest(tallest, ['a'], 360, [200]);
    startTallest(tallest, ['a'], 740, [120]);
    expect(tallest.height).toBe(120);
  });

  it('is published as the room, or taken off while no system is built', () => {
    publishSystemRoom(184);
    expect(room()).toBe(`${184 + SYSTEM_TOP_MARGIN}px`);
    publishSystemRoom(0);
    expect(room()).toBe('');
  });
});
