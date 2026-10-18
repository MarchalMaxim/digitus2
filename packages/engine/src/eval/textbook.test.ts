import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { solveFingering } from '../fingering/solve.js';
import { evaluateTextbook, normalizeTextbookEntries, scoreFromTextbookEntry } from './textbook.js';
import type { TextbookEntry, TextbookReport } from './textbook.js';

const dir = fileURLToPath(new URL('../../../../benchmarks/textbook/', import.meta.url));
const files = existsSync(dir)
  ? readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('provenance'))
  : [];

// Tempo. Textbook entries default to quarter notes at 120 qpm (IOI 0.5 s). Planned rules: at IOI >=
// hopFastSec (0.25 s) a same-finger hop cost only 0.5 x 3 = 1.5, and under the rules alone the hop
// path was the exact optimum: right-hand C major 1 2 2 1 1 2 3 4 cost 12 = E hop 1.5 +
// handPositionShift 1; F largeSpan 2 + thumbPassing 1 + handPositionShift 2; G hop 1.5 +
// handPositionShift 1; C5 weakFinger 1 + threeToFour 1, against 18 for the textbook 1 2 3 1 2 3 4 5
// (F largeSpan 4 + thumbPassing 1 + handPositionShift 3; G positionChangeCount 2 +
// positionChangeSize 4; B weakFinger 1 + threeToFour 1; C5 weakFifth 1 + threeFourFive 1). The M2
// review fixed the hop rule (weight 10, and a hop within a perfect fourth costs 2 points at any
// tempo), so each of those hops costs 20, the hop path 49, and the textbook path is the optimum at
// both tempos, with or without the Task 8 template bonus. The sixteenths runs (qpm 480, IOI
// 0.125 s, the tempo of the Task 5 scale goldens) stay as a second tempo.
const SIXTEENTHS = { qpm: 480 };
const C_MAJOR_RH = {
  id: 'c',
  family: 'scale',
  hand: 'R',
  direction: 'asc',
  midi: [60, 62, 64, 65, 67, 69, 71, 72],
  fingers: [1, 2, 3, 1, 2, 3, 4, 5],
};

describe('textbook entries', () => {
  it('normalizes hands and shapes', () => {
    const { entries, warnings } = normalizeTextbookEntries({
      entries: [
        {
          id: 'a',
          family: 'scale',
          hand: 'RH',
          direction: 'ascending',
          midi: [60, 62],
          fingers: [1, 2],
        },
        {
          id: 'b',
          family: 'scale',
          hand: 'left',
          direction: 'desc',
          midi: [60, 62, 64],
          fingers: [1, 2],
        },
      ],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.hand).toBe('R');
    expect(warnings).toHaveLength(1);
  });
  it('builds a playable score', () => {
    const [e] = normalizeTextbookEntries([
      {
        id: 'a',
        family: 'scale',
        hand: 'L',
        direction: 'asc',
        midi: [48, 50, 52],
        fingers: [5, 4, 3],
      },
    ]).entries;
    const s = scoreFromTextbookEntry(e!);
    expect(s.notes.map((n) => [n.midi, n.hand, n.onsetSec])).toEqual([
      [48, 'L', 0],
      [50, 'L', 0.5],
      [52, 'L', 1],
    ]);
    expect(scoreFromTextbookEntry(e!, SIXTEENTHS).notes.map((n) => n.onsetSec)).toEqual([
      0, 0.125, 0.25,
    ]);
  });
  // The 'chord' entry is played as a broken triad C E G. It fits in one hand position, so it takes
  // no Task 8 template and the rules alone give 1 3 5 (the alternative).
  it('scores exact matches and alternatives (sixteenths)', () => {
    const { entries } = normalizeTextbookEntries([
      {
        id: 'c',
        family: 'scale',
        hand: 'R',
        direction: 'asc',
        midi: [60, 62, 64, 65, 67, 69, 71, 72],
        fingers: [1, 2, 3, 1, 2, 3, 4, 5],
      },
      {
        id: 'd',
        family: 'chord',
        hand: 'R',
        direction: 'asc',
        midi: [60, 64, 67],
        fingers: [9, 9, 9],
        alternatives: [{ fingers: [1, 3, 5] }],
      },
    ]);
    const r = evaluateTextbook(entries, {}, SIXTEENTHS);
    expect(r.entries).toBe(2);
    expect(r.byFamily.scale!.exact).toBe(1);
    expect(r.byFamily.chord!.exact).toBe(1);
    expect(r.exactRate).toBe(1);
    // The chord's primary fingering [9, 9, 9] is unreachable; only its alternative matches.
    expect(r.exact).toBe(2);
    expect(r.noteAccuracy).toBe(1);
    expect(r.failures).toEqual([]);
  });
  // The planned test at the default tempo: the rules alone finger the scale 1 2 2 1 1 2 3 4 here;
  // the Task 8 template closes it.
  it('scores exact matches and alternatives at quarter = 120', () => {
    const { entries } = normalizeTextbookEntries([
      {
        id: 'c',
        family: 'scale',
        hand: 'R',
        direction: 'asc',
        midi: [60, 62, 64, 65, 67, 69, 71, 72],
        fingers: [1, 2, 3, 1, 2, 3, 4, 5],
      },
      {
        id: 'd',
        family: 'chord',
        hand: 'R',
        direction: 'asc',
        midi: [60, 64, 67],
        fingers: [9, 9, 9],
        alternatives: [{ fingers: [1, 3, 5] }],
      },
    ]);
    const r = evaluateTextbook(entries);
    expect(r.entries).toBe(2);
    expect(r.byFamily.scale!.exact).toBe(1);
    expect(r.byFamily.chord!.exact).toBe(1);
    expect(r.exactRate).toBe(1);
    // The chord's primary fingering [9, 9, 9] is unreachable; only its alternative matches.
    expect(r.exact).toBe(2);
    expect(r.noteAccuracy).toBe(1);
    expect(r.failures).toEqual([]);
  });
  // Planned: templates off gave exact rate 0 here (the slow hop path). Since the M2 review hop rule
  // the rules alone finger the scale exactly too.
  it('Task 8 templates finger the C major scale exactly at quarter = 120', () => {
    const { entries } = normalizeTextbookEntries([C_MAJOR_RH]);
    expect(evaluateTextbook(entries).exactRate).toBe(1);
    expect(evaluateTextbook(entries, { templates: false }).exactRate).toBe(1);
  });
  it('counts exact matches through the primary or an alternative and keeps the best note rate', () => {
    const midi = [60, 62, 64, 65, 67];
    const base = { family: 'scale', hand: 'R', direction: 'asc', midi };
    const [probe] = normalizeTextbookEntries([
      { ...base, id: 'probe', fingers: [1, 1, 1, 1, 1] },
    ]).entries;
    const score = scoreFromTextbookEntry(probe!);
    const { assignment } = solveFingering(score, { hands: ['R'] });
    const got = score.notes.map((n) => assignment[n.id]!.finger as number);
    const wrong = got.map((f) => (f % 5) + 1); // differs from the solver at every note
    const partial = got.map((f, i) => (i < 2 ? (f % 5) + 1 : f)); // matches 3 of 5 notes
    const { entries } = normalizeTextbookEntries([
      { ...base, id: 'p', fingers: got },
      { ...base, id: 'a', fingers: wrong, alternatives: [{ fingers: got }] },
      {
        ...base,
        id: 'm',
        family: 'arpeggio',
        fingers: wrong,
        alternatives: [{ fingers: partial }, { fingers: got.slice(0, 4) }],
      },
    ]);
    const r = evaluateTextbook(entries);
    expect(r.entries).toBe(3);
    expect(r.exact).toBe(2);
    expect(r.exactRate).toBeCloseTo(2 / 3, 12);
    expect(r.noteAccuracy).toBeCloseTo((1 + 1 + 0.6) / 3, 12);
    expect(r.byFamily).toEqual({
      scale: { entries: 2, exact: 2, noteAccuracy: 1 },
      arpeggio: { entries: 1, exact: 0, noteAccuracy: 0.6 },
    });
    // The wrong-length alternative was dropped by normalization and is not reported.
    expect(r.failures).toEqual([
      { id: 'm', family: 'arpeggio', hand: 'R', expected: wrong, got, alternatives: [partial] },
    ]);
    expect(evaluateTextbook([])).toEqual({
      entries: 0,
      exact: 0,
      exactRate: 0,
      noteAccuracy: 0,
      byFamily: {},
      failures: [],
    });
  });
});

describe('textbook oracle (benchmarks/textbook)', () => {
  let cache: { all: TextbookEntry[]; quarter: TextbookReport } | undefined;
  const oracle = () => {
    if (!cache) {
      const all = files.flatMap(
        (f) => normalizeTextbookEntries(JSON.parse(readFileSync(join(dir, f), 'utf8'))).entries,
      );
      cache = { all, quarter: evaluateTextbook(all) };
    }
    return cache;
  };
  const summary = (r: TextbookReport) => ({
    entries: r.entries,
    exactRate: r.exactRate,
    noteAccuracy: r.noteAccuracy,
    byFamily: r.byFamily,
  });

  // Floors live in benchmarks/floor.json (`textbook`), the single place the verification loop
  // reads them from: measured minus 0.01, rounded down to two decimals. History: before Task 8
  // (rules alone) quarter = 120 note 0.337, scale 0.332, arpeggio 0.352, chromatic 0.328;
  // sixteenths note 0.541, scale 0.577, arpeggio 0.481, chromatic 0.458, right hand 0.533, left
  // hand 0.549. After Task 8: quarter note 0.527 (exact 29 of 672), scale 0.552, arpeggio 0.498,
  // chromatic 0.427; sixteenths note 0.756 (exact 171), scale 0.822, arpeggio 0.640, chromatic
  // 0.632, right 0.763, left 0.750. The M2 review values are in floor.json's note.
  const floorFile = fileURLToPath(new URL('../../../../benchmarks/floor.json', import.meta.url));
  type HandFloors = { scale: number; arpeggio: number; chromatic: number; R: number; L: number };
  const floors = () => {
    const tb = (
      JSON.parse(readFileSync(floorFile, 'utf8')) as {
        textbook: {
          noteAccuracy: number;
          scaleNoteAccuracy: number;
          quarter: Omit<HandFloors, 'scale'>;
          sixteenths: HandFloors & { note: number };
        };
      }
    ).textbook;
    return {
      quarter: { ...tb.quarter, note: tb.noteAccuracy, scale: tb.scaleNoteAccuracy },
      sixteenths: tb.sixteenths,
    };
  };
  // Solves the 672 entries at both tempos and per hand: about 4 s alone since the consistent-repeats
  // pass (M3 Task 7), so the default 5 s timed out under the parallel `pnpm test` (M3 Task 9). Its
  // time is not a measure; the floors are.
  it.skipIf(files.length === 0)(
    'reports accuracy per family and keeps its floors',
    () => {
      const FLOOR = floors();
      const { all, quarter } = oracle();
      expect(all.length).toBeGreaterThan(0);
      console.info('textbook oracle:', JSON.stringify(summary(quarter)));
      const fast = evaluateTextbook(all, {}, SIXTEENTHS);
      const byHand = (qpm?: { qpm: number }) =>
        Object.fromEntries(
          (['R', 'L'] as const).map((h) => [
            h,
            evaluateTextbook(
              all.filter((e) => e.hand === h),
              {},
              qpm ?? {},
            ).noteAccuracy,
          ]),
        ) as Record<'R' | 'L', number>;
      const quarterHands = byHand();
      const fastHands = byHand(SIXTEENTHS);
      console.info('textbook oracle by hand (quarter = 120):', JSON.stringify(quarterHands));
      console.info(
        'textbook oracle (sixteenths, IOI 0.125 s):',
        JSON.stringify({ ...summary(fast), byHand: fastHands }),
      );
      expect(quarter.noteAccuracy).toBeGreaterThanOrEqual(FLOOR.quarter.note);
      expect(fast.noteAccuracy).toBeGreaterThanOrEqual(FLOOR.sixteenths.note);
      for (const fam of ['scale', 'arpeggio', 'chromatic'] as const) {
        expect(quarter.byFamily[fam]!.noteAccuracy, fam).toBeGreaterThanOrEqual(FLOOR.quarter[fam]);
        expect(fast.byFamily[fam]!.noteAccuracy, fam).toBeGreaterThanOrEqual(FLOOR.sixteenths[fam]);
      }
      // Each hand on its own guards the left-hand mirror: solving the left-hand entries without the
      // mirror (as right-hand notes) scored 0.28 at sixteenths after Task 8, against 0.75 with it
      // (0.26 against 0.55 on the rules alone).
      for (const h of ['R', 'L'] as const) {
        expect(quarterHands[h], `quarter ${h}`).toBeGreaterThanOrEqual(FLOOR.quarter[h]);
        expect(fastHands[h], `sixteenths ${h}`).toBeGreaterThanOrEqual(FLOOR.sixteenths[h]);
      }
    },
    30_000,
  );
  // The planned Task 7 sanity floor. It held after Task 8 only once runs were aligned to their
  // tonic: 0.527 (0.497 when matched in file order whatever the key).
  it.skipIf(files.length === 0)('note accuracy above 0.5 at quarter = 120', () => {
    expect(oracle().quarter.noteAccuracy).toBeGreaterThan(0.5);
  });
});
