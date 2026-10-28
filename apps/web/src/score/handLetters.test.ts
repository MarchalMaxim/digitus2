import { readFileSync } from 'node:fs';
import { parseMusicXml, type Hand, type Note } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import {
  CLOSE_SEMITONES,
  handGap,
  hiddenHand,
  latchApplies,
  letteredBars,
  lettersShown,
} from './handLetters.js';
import { buildOnsetGroups, type OnsetGroup } from './onsetGroups.js';

/** A library score, parsed as the app parses it. A path held in a variable stays a file URL. */
function library(slug: string): OnsetGroup[] {
  const path = `../../../../content/scores/${slug}.musicxml`;
  return buildOnsetGroups(
    parseMusicXml(readFileSync(new URL(path, import.meta.url), 'utf8')).score,
  );
}

let id = 0;
/** A note in bar `bar` (0-based) at `tick`, lasting `ticks`. */
function n(hand: Hand, midi: number, bar: number, tick: number, ticks = 1): Note {
  return {
    id: `n${id++}`,
    onsetTick: tick,
    offsetTick: tick + ticks,
    onsetSec: tick,
    offsetSec: tick + ticks,
    midi,
    hand,
    measureIndex: bar,
    staff: hand === 'R' ? 1 : 2,
    voice: 1,
    isGrace: false,
    chordId: '',
    sourceIndices: [],
    spelling: { step: 'C', alter: 0, octave: 4 },
  } as unknown as Note;
}
const groups = (...notes: Note[]): OnsetGroup[] =>
  buildOnsetGroups({ notes } as unknown as Parameters<typeof buildOnsetGroups>[0]);

/**
 * What the cursor works from with one hand muted (`activeGroups` in useCursor.ts): the muted
 * hand's notes removed, and the groups left with no note dropped.
 */
const withoutHand = (full: readonly OnsetGroup[], muted: Hand): OnsetGroup[] =>
  full
    .map((g) => {
      const notes = g.notes.filter((x) => x.hand !== muted);
      return { ...g, notes, noteIds: notes.map((x) => x.id) };
    })
    .filter((g) => g.notes.length > 0);

const MINUET_BARS = [0, 6, 7, 11, 14, 24, 25, 26, 27, 31];
const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

describe('the gap between the hands (spec 15)', () => {
  it('is the lowest right-hand key minus the highest left-hand key', () => {
    expect(CLOSE_SEMITONES).toBe(7);
    expect(handGap([n('L', 48, 0, 0), n('L', 55, 0, 0), n('R', 62, 0, 0)])).toBe(7);
    expect(handGap([n('L', 60, 0, 0), n('R', 57, 0, 0)])).toBe(-3); // interleaved
    expect(handGap([n('R', 60, 0, 0), n('R', 64, 0, 0)])).toBeNull(); // one hand
  });
});

describe('the bars that show letters', () => {
  it('one hand alone: never', () => {
    expect(letteredBars(groups(n('R', 60, 0, 0), n('R', 62, 1, 4)))).toEqual(new Set());
  });
  it('far apart (two octaves): never', () => {
    expect(letteredBars(groups(n('L', 36, 0, 0), n('R', 60, 0, 0)))).toEqual(new Set());
  });
  it('a fifth apart: yes; a sixth apart: no', () => {
    expect(letteredBars(groups(n('L', 53, 0, 0), n('R', 60, 0, 0)))).toEqual(new Set([0]));
    expect(letteredBars(groups(n('L', 52, 0, 0), n('R', 60, 0, 0)))).toEqual(new Set());
  });
  it("within an octave but more than a fifth: no (the TODO's octave is superseded, spec 15)", () => {
    expect(letteredBars(groups(n('L', 48, 0, 0), n('R', 60, 0, 0)))).toEqual(new Set()); // 12
    expect(letteredBars(groups(n('L', 50, 0, 0), n('R', 60, 0, 0)))).toEqual(new Set()); // 10
  });
  it('interleaved: yes', () => {
    expect(letteredBars(groups(n('L', 64, 0, 0), n('R', 60, 0, 0)))).toEqual(new Set([0]));
  });
  it('reads the score with both hands: the view with a hand muted would letter nothing', () => {
    // The cursor's own groups leave the muted hand out; the letters must not be decided from
    // them, or one-hand practice would never letter a bar. ScoreView passes the full groups.
    const full = library('bach-minuet-g-major-bwv-anh-114');
    expect(sorted(letteredBars(full))).toEqual(MINUET_BARS);
    expect(letteredBars(withoutHand(full, 'L'))).toEqual(new Set());
    expect(letteredBars(withoutHand(full, 'R'))).toEqual(new Set());
  });
  it('counts a note still held from an earlier onset', () => {
    // the left hand's G3 held from tick 0 to 4; the right hand's D4 at tick 2 is a fifth above it
    expect(letteredBars(groups(n('L', 55, 0, 0, 4), n('R', 72, 0, 0), n('R', 62, 0, 2)))).toEqual(
      new Set([0]),
    );
  });
  it('letters a lone bar between two lettered bars, and only one', () => {
    const close = (bar: number) => [n('L', 55, bar, bar * 4), n('R', 60, bar, bar * 4)];
    const far = (bar: number) => [n('L', 36, bar, bar * 4), n('R', 72, bar, bar * 4)];
    expect(letteredBars(groups(...close(0), ...far(1), ...close(2)))).toEqual(new Set([0, 1, 2]));
    expect(letteredBars(groups(...close(0), ...far(1), ...far(2), ...close(3)))).toEqual(
      new Set([0, 3]),
    );
  });
  it('always close: every bar', () => {
    const close = (bar: number) => [n('L', 55, bar, bar * 4), n('R', 60, bar, bar * 4)];
    expect(letteredBars(groups(...close(0), ...close(1), ...close(2)))).toEqual(new Set([0, 1, 2]));
  });
});

describe('the library (the replay of spec section 15)', () => {
  it('Amazing Grace: none', () =>
    expect(letteredBars(library('amazing-grace'))).toEqual(new Set()));
  it('Twinkle: bars 3 to 7 and 11 (0-based)', () =>
    expect(sorted(letteredBars(library('twinkle-twinkle-little-star')))).toEqual([
      3, 4, 5, 6, 7, 11,
    ]));
  it('the G major minuet: 10 of 32 bars', () =>
    expect(sorted(letteredBars(library('bach-minuet-g-major-bwv-anh-114')))).toEqual(MINUET_BARS));
});

describe('whether the keyboard shows letters now', () => {
  it("follows the cursor's group; nothing marked shows none", () => {
    const g = groups(n('L', 55, 0, 0), n('R', 60, 0, 0), n('L', 36, 1, 4), n('R', 72, 1, 4));
    const bars = new Set([0]);
    expect(lettersShown(g, 0, bars)).toBe(true);
    expect(lettersShown(g, 1, bars)).toBe(false);
    expect(lettersShown(g, -1, bars)).toBe(false);
  });
});

describe('the hand out of view (spec 15, rule 5)', () => {
  const key = (hand: Hand, visible: boolean) => ({ hand, visible });
  it('names the hand whose keys are all out of view while the other has one in view', () => {
    expect(hiddenHand([key('L', false), key('R', true)])).toBe('L');
    expect(hiddenHand([key('L', true), key('R', false), key('R', false)])).toBe('R');
    expect(hiddenHand([key('L', false), key('R', true), key('R', false)])).toBe('L');
  });
  it('is null with one hand only, both in view, a hand part in view, or nothing in view', () => {
    expect(hiddenHand([])).toBeNull();
    expect(hiddenHand([key('R', false), key('R', false)])).toBeNull();
    expect(hiddenHand([key('L', true), key('R', true)])).toBeNull();
    expect(hiddenHand([key('L', false), key('L', true), key('R', true)])).toBeNull();
    expect(hiddenHand([key('L', false), key('R', false)])).toBeNull();
  });

  // bars 0 to 4: bar 2 has two onsets (groups 2 and 3); the score letters bar 0 only
  const g = groups(
    n('R', 60, 0, 0),
    n('R', 60, 1, 4),
    n('R', 60, 2, 8),
    n('R', 60, 2, 9),
    n('R', 60, 3, 12),
    n('R', 60, 4, 16),
  );
  const bars = new Set([0]);
  it('with no hidden bar it behaves as before', () => {
    for (let i = -1; i < 6; i++)
      expect(lettersShown(g, i, bars, null)).toBe(lettersShown(g, i, bars));
    expect(lettersShown(g, 2, bars, null)).toBe(false);
  });
  it('the latch shows in its bar only, onset after onset, and not in the next bar', () => {
    expect(lettersShown(g, 2, bars, 2)).toBe(true);
    expect(lettersShown(g, 3, bars, 2)).toBe(true); // the second onset of bar 2
    expect(lettersShown(g, 4, bars, 2)).toBe(false); // the next bar: the latch has ended
    expect(lettersShown(g, 1, bars, 2)).toBe(false); // the bar before
    expect(lettersShown(g, -1, bars, 2)).toBe(false); // nothing marked
  });
  it('a lone bar between a latched bar and a lettered bar shows too (the one-bar bridge)', () => {
    expect(lettersShown(g, 4, new Set([0, 4]), 2)).toBe(true); // bar 3 sits between 2 and 4
    expect(lettersShown(g, 4, new Set([0, 5]), 2)).toBe(false); // bar 4 is not lettered
    expect(lettersShown(g, 1, new Set([0]), 2)).toBe(false); // the bridge goes forward only
  });
  it('a seek within the same bar keeps the latch; a seek to another bar drops it', () => {
    expect(lettersShown(g, 3, bars, 2)).toBe(true);
    expect(lettersShown(g, 2, bars, 2)).toBe(true);
    expect(lettersShown(g, 5, bars, 2)).toBe(false);
    expect(lettersShown(g, 1, bars, 2)).toBe(false);
  });
});

describe('whether a latched bar still applies (one continuous visit)', () => {
  const bars = new Set([0, 4]);
  it('holds in its own bar', () => {
    expect(latchApplies(2, 2, bars)).toBe(true);
  });
  it('holds in the next bar only when the bridge applies there (a lettered bar after it)', () => {
    expect(latchApplies(2, 3, bars)).toBe(true); // bar 4 is lettered: the lone bar 3 is bridged
    expect(latchApplies(2, 3, new Set([0, 5]))).toBe(false);
    expect(latchApplies(3, 4, new Set([0, 5]))).toBe(true);
    expect(latchApplies(2, 3, new Set([0, 4]))).toBe(true);
  });
  it('ends on a seek away, a loop wrap or a rewind to another bar, and with no cursor', () => {
    expect(latchApplies(2, 0, bars)).toBe(false); // wrap or rewind to an earlier bar
    expect(latchApplies(2, 5, bars)).toBe(false); // a seek ahead
    expect(latchApplies(2, 1, bars)).toBe(false); // the bridge goes forward only
    expect(latchApplies(2, null, bars)).toBe(false);
  });
});
