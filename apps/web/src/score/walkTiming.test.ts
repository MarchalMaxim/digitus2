// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { midiToSpelling, parseMusicXml, type Hand, type Note, type Score } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { performanceOf } from '../audio/performance.js';
import { alongPlan } from './playAlong.js';
import {
  MAX_RINGS_PER_BAR,
  judgeBar,
  marksOf,
  resolveOnset,
  walkTimingPlan,
  writtenNoteId,
  type Judged,
  type NotePress,
  type Onset,
  type PlanStep,
  type Verdict,
  type WalkPlanStep,
} from './walkTiming.js';

const form = (name: string): string =>
  readFileSync(
    fileURLToPath(
      new URL(`../../../../packages/engine/fixtures/${name}.musicxml`, import.meta.url),
    ),
    'utf8',
  );

/** A fixture of the web app (`apps/web/fixtures`). */
const fixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/${name}.musicxml`, import.meta.url), 'utf8');

/** The float slack of a bar line: 3 beats of 0.5 s are not always exactly 1.5. */
const SLACK = 1e-9;

/**
 * A plan from note lengths in beats: perfSec cumulative at `secPerBeat`, bars of `beatsPerBar`,
 * after an optional pickup of `pickup` beats (bar 0), so bar = pickup ? (pos < pickup ? 0 :
 * 1 + floor((pos - pickup) / beatsPerBar)) : floor(pos / beatsPerBar). beatSec = o.beatSec ??
 * secPerBeat. holdSec = (holds[i] ?? beats[i]) * secPerBeat (no rests unless `holds` says so).
 */
function planOf(
  beats: number[],
  o: {
    secPerBeat?: number;
    beatsPerBar?: number;
    pickup?: number;
    beatSec?: number;
    holds?: Record<number, number>;
    /** The felt beat is three of the time signature's beats (6/8). */
    compound?: boolean;
  } = {},
): PlanStep[] {
  const secPerBeat = o.secPerBeat ?? 0.5;
  const beatsPerBar = o.beatsPerBar ?? 4;
  const pickup = o.pickup ?? 0;
  let pos = 0;
  return beats.map((length, i) => {
    const bar = pickup
      ? pos < pickup - SLACK
        ? 0
        : 1 + Math.floor((pos - pickup + SLACK) / beatsPerBar)
      : Math.floor((pos + SLACK) / beatsPerBar);
    const step: PlanStep = {
      perfSec: pos * secPerBeat,
      beatSec: o.beatSec ?? secPerBeat,
      bar,
      holdSec: (o.holds?.[i] ?? length) * secPerBeat,
      ...(o.compound ? { compound: true } : {}),
    };
    pos += length;
    return step;
  });
}

/**
 * Onsets 0..upTo played at `msPerSec` real ms per performance second from `start` (1000):
 * ms = start + perfSec * msPerSec + offsets[i] + the sum of extra[k] for k <= i; the chain grows
 * by one at each index in `breaks`.
 */
function play(
  plan: PlanStep[],
  msPerSec: number,
  o: {
    offsets?: Record<number, number>;
    extra?: Record<number, number>;
    breaks?: number[];
    start?: number;
    upTo?: number;
  } = {},
): Onset[] {
  const upTo = o.upTo ?? plan.length - 1;
  const start = o.start ?? 1000;
  let chain = 0;
  let extra = 0;
  const out: Onset[] = [];
  for (let i = 0; i <= upTo; i++) {
    if (o.breaks?.includes(i)) chain++;
    extra += o.extra?.[i] ?? 0;
    out.push({
      index: i,
      ms: start + plan[i]!.perfSec * msPerSec + (o.offsets?.[i] ?? 0) + extra,
      chain,
    });
  }
  return out;
}

/**
 * As the hook does: judgeBar at each bar's last onset (the next onset is in another bar, is not
 * index + 1, or there is none), on the onsets up to it; all the results concatenated.
 */
function judgeEach(plan: PlanStep[], onsets: Onset[]): Judged[] {
  const all: Judged[] = [];
  onsets.forEach((onset, i) => {
    const next = onsets[i + 1];
    if (
      !next ||
      plan[next.index]!.bar !== plan[onset.index]!.bar ||
      next.index !== onset.index + 1
    ) {
      all.push(...judgeBar(plan, onsets.slice(0, i + 1)));
    }
  });
  return all;
}

/** Onsets from explicit gaps: ms_0 = 1000, ms_k = ms_{k-1} + gaps[k-1], indices 0.., chain 0. */
function fromGaps(gaps: number[]): Onset[] {
  const out: Onset[] = [{ index: 0, ms: 1000, chain: 0 }];
  gaps.forEach((gap, k) => out.push({ index: k + 1, ms: out[k]!.ms + gap, chain: 0 }));
  return out;
}

const off = (r: Judged[]): Judged[] => r.filter((x) => x.verdict !== 'onTime');
const indices = (r: Judged[]): number[] => r.map((x) => x.index);
const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const allOnTime = (r: Judged[]): boolean => r.every((x) => x.verdict === 'onTime');

/** A seeded uniform generator (mulberry32), so a jitter test gives the same answer every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A normal deviate with the standard deviation `sigma` (Box-Muller). */
function gaussian(uniform: () => number, sigma: number): number {
  return sigma * Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

/** What `off(result)` must be: exactly these entries, in this order (`offsetMs` within 1, `tolMs` within 0.5). */
interface Want {
  index: number;
  verdict: Verdict;
  offsetMs?: number;
  tolMs?: number;
}
function expectOff(result: Judged[], want: Want[]): void {
  const got = off(result);
  expect(got.map((x) => ({ index: x.index, verdict: x.verdict }))).toEqual(
    want.map((w) => ({ index: w.index, verdict: w.verdict })),
  );
  want.forEach((w, i) => {
    if (w.offsetMs !== undefined) {
      expect(Math.abs(got[i]!.offsetMs - w.offsetMs)).toBeLessThanOrEqual(1);
    }
    if (w.tolMs !== undefined) expect(Math.abs(got[i]!.tolMs - w.tolMs)).toBeLessThanOrEqual(0.5);
  });
}

/** Bars of q e e q e e, six steps per bar, four bars. */
const QEE = Array.from({ length: 4 }, () => [1, 0.5, 0.5, 1, 0.5, 0.5]).flat();
/** Sixteen quarter notes: bar k is steps 4k..4k+3. */
const Q16 = Array.from({ length: 16 }, () => 1);
/** Twinkle's shape. */
const TW = [1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1];

describe('judgeBar', () => {
  describe('an even rhythm', () => {
    it('judges the last bar of steady q-e-e at a slow tempo', () => {
      const plan = planOf(QEE);
      const r = judgeBar(plan, play(plan, 2000, { upTo: 11 }));
      expect(indices(r)).toEqual(range(6, 11));
      expect(allOnTime(r)).toBe(true);
    });

    it('judges the same at a fast tempo', () => {
      const plan = planOf(QEE);
      const r = judgeBar(plan, play(plan, 800, { upTo: 11 }));
      expect(indices(r)).toEqual(range(6, 11));
      expect(allOnTime(r)).toBe(true);
    });

    it('judges the first bar from its third onset, the gap into step 1 being the first', () => {
      const plan = planOf(QEE);
      const r = judgeBar(plan, play(plan, 2000, { upTo: 5 }));
      expect(indices(r)).toEqual(range(2, 5));
      expect(allOnTime(r)).toBe(true);
    });

    it('does not punish a slow, steady reader for pausing', () => {
      const plan = planOf(Q16);
      const r = judgeEach(plan, play(plan, 6000));
      expect(indices(r)).toEqual(range(2, 15));
      expect(allOnTime(r)).toBe(true);
    });

    it('leaves lengthened short notes alone when the bars stay even', () => {
      // Bars of q e e in 2/4, each 2000 ms, the quarter 1.6 times each eighth: 889, 556, 556.
      const plan = planOf(Array.from({ length: 4 }, () => [1, 0.5, 0.5]).flat(), {
        beatsPerBar: 2,
      });
      const onsets: Onset[] = [];
      let ms = 1000;
      plan.forEach((_, i) => {
        onsets.push({ index: i, ms, chain: 0 });
        ms += i % 3 === 0 ? (2000 * 1.6) / 3.6 : (2000 - (2000 * 1.6) / 3.6) / 2;
      });
      const r = judgeEach(plan, onsets);
      expect(indices(r)).toEqual(range(3, 11));
      expect(off(r)).toEqual([]);
    });

    it('does not punish a slow drift', () => {
      const plan = planOf(Q16);
      for (const rate of [1.01, 1.02]) {
        const onsets = fromGaps(Array.from({ length: 15 }, (_, k) => 1000 * rate ** (k + 1)));
        for (const count of [4, 8, 12, 16]) {
          const r = judgeBar(plan, onsets.slice(0, count));
          expect(indices(r), `${rate} x ${count}`).toEqual(
            range(Math.max(count - 4, 2), count - 1),
          );
          expect(off(r), `${rate} x ${count}`).toEqual([]);
        }
      }
    });

    it('takes the tempo locally: a change of tempo is not an error', () => {
      // Eight gaps of a second, then seven of 650 ms: the last bar is steady at its own tempo.
      // (Against the median of the whole piece instead, its four notes would all come early.)
      const plan = planOf(Q16);
      const gaps = [...Array(8).fill(1000), ...Array(7).fill(650)] as number[];
      const r = judgeBar(plan, fromGaps(gaps));
      expect(indices(r)).toEqual(range(12, 15));
      expect(allOnTime(r)).toBe(true);
    });
  });

  describe('a note clearly early or late', () => {
    it('rings one eighth rushed in a bar', () => {
      const plan = planOf(QEE);
      const r = judgeBar(plan, play(plan, 2000, { upTo: 11, offsets: { 8: -400 } }));
      // The gap into an eighth is shorter than the beat: its tolerance is a third of the beat.
      expectOff(r, [{ index: 8, verdict: 'early', offsetMs: -400, tolMs: 1000 / 3 }]);
      const entry = off(r)[0]!;
      expect(entry.offsetSec).toBeCloseTo(-0.2, 3);
    });

    it('rings a note rushed in the first bar', () => {
      const plan = planOf(QEE);
      expectOff(judgeBar(plan, play(plan, 2000, { upTo: 5, offsets: { 2: -400 } })), [
        { index: 2, verdict: 'early' },
      ]);
    });

    it('judges a half note cut short against the tolerance of its long gap', () => {
      const plan = planOf([2, 1, 1, 2, 1, 1, 2, 1, 1]);
      const r = judgeBar(plan, play(plan, 2000, { upTo: 5, offsets: { 4: -500 } }));
      expect(indices(r)).toEqual([3, 4, 5]);
      expectOff(r, [{ index: 4, verdict: 'early', offsetMs: -500, tolMs: 400 }]);
    });

    it('rings the dragged note once: the gap that puts it back is undone', () => {
      const plan = planOf(Q16);
      const r = judgeBar(plan, play(plan, 2000, { upTo: 7, offsets: { 5: 600 } }));
      expect(indices(r)).toEqual(range(4, 7));
      expectOff(r, [{ index: 5, verdict: 'late', offsetMs: 600 }]);
    });

    it('rings two early notes in one bar, each', () => {
      const plan = planOf(Q16);
      const r = judgeBar(plan, play(plan, 2000, { upTo: 7, offsets: { 4: -400, 6: -300 } }));
      expectOff(r, [
        { index: 4, verdict: 'early', offsetMs: -400 },
        { index: 6, verdict: 'early', offsetMs: -300 },
      ]);
    });

    it('rings a note early with a pickup bar for context', () => {
      const plan = planOf(Array(9).fill(1), { pickup: 1 });
      const r = judgeBar(plan, play(plan, 2000, { upTo: 4, offsets: { 2: -400 } }));
      expect(indices(r)).toEqual([2, 3, 4]);
      expectOff(r, [{ index: 2, verdict: 'early' }]);
    });
  });

  describe('a lasting shift', () => {
    it('rings a short hesitation once, on the note after it, and judges the rest afresh', () => {
      const plan = planOf(Q16);
      const r = judgeBar(plan, play(plan, 2000, { upTo: 7, extra: { 5: 1000 } }));
      expectOff(r, [{ index: 5, verdict: 'late', offsetMs: 1000 }]);
      expect(
        r.filter((x) => x.index === 6 || x.index === 7).every((x) => x.verdict === 'onTime'),
      ).toBe(true);
    });

    it('rings a hesitation into the bar on the first note of the bar', () => {
      const plan = planOf(Q16);
      const r = judgeBar(plan, play(plan, 2000, { upTo: 7, extra: { 4: 1000 } }));
      expectOff(r, [{ index: 4, verdict: 'late' }]);
      expect(r.filter((x) => x.index >= 5).every((x) => x.verdict === 'onTime')).toBe(true);
    });

    it('rings a hesitation at a fast tempo against the floor', () => {
      const plan = planOf(Q16);
      const r = judgeBar(plan, play(plan, 400, { upTo: 7, extra: { 6: 400 } }));
      expectOff(r, [{ index: 6, verdict: 'late', tolMs: 120 }]);
    });

    it('never rings the first gap of a stretch', () => {
      const plan = planOf(Q16);
      const r = judgeBar(plan, play(plan, 2000, { upTo: 3, extra: { 1: 600 } }));
      expect(indices(r)).toEqual([2, 3]);
      expect(allOnTime(r)).toBe(true);
    });

    it('rings a carried shift once when every bar is judged at its exit (bar 1)', () => {
      const plan = planOf(Q16);
      const r = judgeEach(plan, play(plan, 2000, { extra: { 5: 600 } }));
      expect(indices(r)).toEqual(range(2, 15));
      expectOff(r, [{ index: 5, verdict: 'late', offsetMs: 600 }]);
    });

    it('rings a carried shift at a bar end on that note, not on the next bar', () => {
      const plan = planOf(Q16);
      const r = judgeEach(plan, play(plan, 2000, { extra: { 7: 600 } }));
      expectOff(r, [{ index: 7, verdict: 'late', offsetMs: 600 }]);
      expect(allOnTime(r.filter((x) => x.index >= 8 && x.index <= 11))).toBe(true);
    });

    it('rings an early note at a bar end once: the gap into the next bar is undone at its exit', () => {
      const plan = planOf(Q16);
      const r = judgeEach(plan, play(plan, 2000, { offsets: { 7: -400 } }));
      expectOff(r, [{ index: 7, verdict: 'early', offsetMs: -400 }]);
      expect(allOnTime(r.filter((x) => x.index >= 8 && x.index <= 11))).toBe(true);
    });

    it('rings a carried shift in a one-bar visit', () => {
      const plan = planOf([1, 1, 1, 1]);
      const r = judgeBar(plan, play(plan, 2000, { extra: { 2: 600 } }));
      expect(indices(r)).toEqual([2, 3]);
      expectOff(r, [{ index: 2, verdict: 'late', offsetMs: 600 }]);
    });

    it('rings a note after a long one against its own gap', () => {
      const plan = planOf(TW);
      const r = judgeEach(plan, play(plan, 2000, { extra: { 7: -500 } }));
      expectOff(r, [{ index: 7, verdict: 'early', offsetMs: -500, tolMs: 400 }]);
    });
  });

  describe('the tolerance', () => {
    it('follows the reader tempo: 150 ms early passes at 2000 and rings at 400', () => {
      const plan = planOf(Q16);
      const slow = judgeBar(plan, play(plan, 2000, { upTo: 7, offsets: { 5: -150 } }));
      expect(indices(slow)).toEqual(range(4, 7));
      expect(off(slow)).toEqual([]);
      const fast = judgeBar(plan, play(plan, 400, { upTo: 7, offsets: { 5: -150 } }));
      expectOff(fast, [{ index: 5, verdict: 'early', tolMs: 120 }]);
    });

    it('grows with a long note: 500 ms past a whole note passes, 900 ms rings', () => {
      const plan = planOf([1, 1, 1, 1, 4, 1, 1, 1, 1]);
      const passes = judgeEach(plan, play(plan, 2000, { extra: { 5: 500 } }));
      expect(indices(passes)).toContain(5);
      expect(off(passes)).toEqual([]);
      expectOff(judgeEach(plan, play(plan, 2000, { extra: { 5: 900 } })), [
        { index: 5, verdict: 'late', tolMs: 800 },
      ]);
    });

    it('rings a whole note held one beat long', () => {
      const plan = planOf([1, 1, 1, 1, 4, 1, 1, 1, 1]);
      expectOff(judgeEach(plan, play(plan, 2000, { extra: { 5: 1000 } })), [
        { index: 5, verdict: 'late', offsetMs: 1000 },
      ]);
    });

    it('takes the felt beat in 6/8 as the dotted quarter, not the eighth', () => {
      const bars = [2, 1, 2, 1, 3, 3, 2, 1, 2, 1, 3, 3];
      const felt = planOf(bars, {
        secPerBeat: 0.25,
        beatsPerBar: 6,
        beatSec: 0.75,
        compound: true,
      });
      // 3 * 0.25 s at 2000 ms per second: the felt beat is 1500 ms, a quarter of it is 375 ms.
      const dotted = judgeEach(felt, play(felt, 2000, { offsets: { 3: 250 } }));
      expect(indices(dotted)).toContain(3);
      expect(off(dotted)).toEqual([]);
      // The eighth as the beat: the gap into step 3 is a half note's (1000 ms), and a fifth of it
      // is the tolerance.
      const eighth = planOf(bars, { secPerBeat: 0.25, beatsPerBar: 6, beatSec: 0.25 });
      expectOff(judgeEach(eighth, play(eighth, 2000, { offsets: { 3: 250 } })), [
        { index: 3, verdict: 'late', tolMs: 200 },
      ]);
    });
  });

  describe('the tolerance of a gap inside a beat', () => {
    it('is a third of a beat in a simple meter: an eighth 330 ms too long passes, 340 rings', () => {
      // 1000 ms to the beat: the gap into an eighth is 500 ms, and a third of a beat is 333 ms.
      const plan = planOf(QEE);
      for (const held of [200, 330]) {
        const r = judgeEach(plan, play(plan, 2000, { extra: { 8: held } }));
        expect(off(r), `${held}`).toEqual([]);
      }
      for (const held of [340, 500]) {
        expectOff(judgeEach(plan, play(plan, 2000, { extra: { 8: held } })), [
          { index: 8, verdict: 'late', offsetMs: held, tolMs: 1000 / 3 },
        ]);
      }
    });

    it('stays a quarter of the felt beat in a compound meter: an eighth held as a quarter in 6/8 rings', () => {
      // Six eighths a bar, the felt beat three of them (1500 ms at 2000 ms per second): an eighth
      // gap is 500 ms, a third of a beat would be exactly an eighth and make the slip a tie.
      const plan = planOf(Array(18).fill(1), {
        secPerBeat: 0.25,
        beatsPerBar: 6,
        beatSec: 0.75,
        compound: true,
      });
      for (const held of [495, 500, 505]) {
        expectOff(judgeEach(plan, play(plan, 2000, { extra: { 9: held } })), [
          { index: 9, verdict: 'late', offsetMs: held, tolMs: 375 },
        ]);
      }
    });
  });

  describe('pauses and rests after a note', () => {
    it('does not judge across a 3 s hesitation: it starts a new stretch', () => {
      const plan = planOf(Q16);
      const short = judgeBar(plan, play(plan, 2000, { upTo: 7, extra: { 6: 3000 } }));
      expect(indices(short)).toEqual([4, 5]);
      expect(allOnTime(short)).toBe(true);
      const long = judgeBar(plan, play(plan, 2000, { upTo: 11, extra: { 6: 3000 } }));
      expect(indices(long)).toEqual(range(8, 11));
      expect(allOnTime(long)).toBe(true);
    });

    it('takes a search for the next notes after a whole note as a pause', () => {
      const plan = planOf([1, 1, 1, 1, 4, 1, 1, 1, 1]);
      for (const extra of [1500, 2000]) {
        const r = judgeEach(plan, play(plan, 2000, { extra: { 5: extra } }));
        expect(off(r), `${extra}`).toEqual([]);
        expect(indices(r), `${extra}`).toEqual([2, 3, 4, 7, 8]);
      }
    });

    it('takes a fermata held as written as a pause', () => {
      const plan = planOf(TW);
      const r = judgeEach(plan, play(plan, 2000, { extra: { 7: 2000 } }));
      expect(off(r)).toEqual([]);
      expect(indices(r)).toEqual([2, 3, 4, 5, 6, 9, 10]);
    });

    it('does not judge a rest after a note', () => {
      // Bars of q q (q + a quarter rest); the third note lasts one beat, and the
      // reader presses the next bar's first step at 0.7 of the written gap.
      const plan = planOf(Array.from({ length: 4 }, () => [1, 1, 2]).flat(), {
        holds: { 2: 1, 5: 1, 8: 1, 11: 1 },
      });
      const onsets: Onset[] = [];
      let ms = 1000;
      plan.forEach((step, i) => {
        onsets.push({ index: i, ms, chain: 0 });
        const written = (plan[i + 1]?.perfSec ?? step.perfSec + 1) - step.perfSec;
        ms += (i % 3 === 2 ? 0.7 : 1) * written * 2000;
      });
      const r = judgeEach(plan, onsets);
      expect(off(r)).toEqual([]);
      for (const skipped of [3, 6, 9]) expect(indices(r)).not.toContain(skipped);
      expect(indices(r)).toEqual([4, 5, 7, 8, 10, 11]);
    });

    describe('the note after a rest the red does not wait out', () => {
      // Two bars of q q q q, a bar of q q (q + a quarter rest) whose last step the red leaves after
      // one beat, then two more bars of q q q q: step 10 holds one beat of its two, step 11 is the
      // note after the rest, step 12 the one after it. 1000 ms to the beat.
      const restPlan = (): PlanStep[] =>
        planOf([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1], { holds: { 10: 1 } });

      it('does not blame the note on the count for the note that came at the red', () => {
        // The cue moves the red as the note before the rest ends, a whole beat early: the reader
        // who presses then and goes on counting is not late on the next note.
        const plan = restPlan();
        for (const early of [1000, 400]) {
          const r = judgeEach(plan, play(plan, 2000, { offsets: { 11: -early } }));
          expect(off(r), `${early}`).toEqual([]);
          expect(indices(r), `${early}`).toContain(12);
        }
      });

      it('does not blame the note on the count for a rest waited out too long', () => {
        const plan = restPlan();
        const r = judgeEach(plan, play(plan, 2000, { offsets: { 11: 500 } }));
        expect(off(r)).toEqual([]);
        expect(indices(r)).toContain(12);
      });

      it('still rings a note really late after a rest waited out', () => {
        const plan = restPlan();
        expectOff(judgeEach(plan, play(plan, 2000, { offsets: { 12: 500 } })), [
          { index: 12, verdict: 'late', offsetMs: 500, tolMs: 250 },
        ]);
      });

      it('still rings a note that drags after one pressed early at the red', () => {
        // Step 11 400 ms early, step 12 and the rest 500 ms late: the gap into 12 is 900 ms too
        // long, which does not only put the early press back.
        const plan = restPlan();
        expectOff(
          judgeEach(plan, play(plan, 2000, { offsets: { 11: -400 }, extra: { 12: 500 } })),
          [{ index: 12, verdict: 'late', offsetMs: 900, tolMs: 250 }],
        );
      });

      it('does not judge a long search for the key after the rest', () => {
        // The search is a hesitation (the rest was waited out and then some); the pulse resumes
        // from the key found.
        const plan = restPlan();
        const r = judgeEach(plan, play(plan, 2000, { extra: { 11: 2500 } }));
        expect(off(r)).toEqual([]);
        const dragged = judgeEach(plan, play(plan, 2000, { extra: { 12: 2500 } }));
        expect(off(dragged)).toEqual([]);
      });
    });
  });

  describe('dotted and triplet subdivisions inside a beat', () => {
    // Bars of q q (dotted eighth, sixteenth) q in 4/4: five steps a bar, the sixteenth the fourth.
    const BARS = 8;
    const dotted = (secPerBeat: number): PlanStep[] =>
      planOf(Array.from({ length: BARS }, () => [1, 1, 0.75, 0.25, 1]).flat(), { secPerBeat });
    const sixteenths = range(0, BARS - 1).map((bar) => bar * 5 + 3);
    /** Every onset jittered by `sigma` ms; the sixteenth moved by `shift` beats. */
    function jittered(plan: PlanStep[], bpm: number, shift: number, sigma: number, seed: number) {
      const uniform = seeded(seed);
      const beatMs = 60000 / bpm;
      const offsets: Record<number, number> = {};
      plan.forEach((_, i) => {
        offsets[i] = gaussian(uniform, sigma) + (i % 5 === 3 ? shift * beatMs : 0);
      });
      return judgeEach(plan, play(plan, 1000, { offsets }));
    }

    it('does not ring a dotted pair played as two even notes, at any tempo a beginner walks', () => {
      // The sixteenth comes a quarter of a beat early. With a pulse of 10 to 15 ms in every onset
      // (a careful reader on a good connection), it is not rung from 50 to 120 beats a minute;
      // the same pair played right is never rung.
      for (const bpm of [50, 60, 80, 100, 120]) {
        const plan = dotted(60 / bpm);
        let rung = 0;
        let judgedPairs = 0;
        let wrong = 0;
        for (let trial = 0; trial < 100; trial++) {
          const flat = jittered(plan, bpm, -0.25, 15, bpm * 1000 + trial);
          judgedPairs += flat.filter((x) => sixteenths.includes(x.index)).length;
          rung += off(flat).length;
          wrong += off(jittered(plan, bpm, 0, 15, bpm * 7000 + trial)).length;
        }
        expect(judgedPairs, `${bpm}`).toBeGreaterThan(0);
        expect(rung / judgedPairs, `${bpm}`).toBeLessThan(0.03);
        expect(wrong, `${bpm}`).toBe(0);
      }
    });

    it('does not tip over at the old edge: a few milliseconds either way of an even pair', () => {
      // 60 bpm: an even pair puts the sixteenth 250 ms early, which was exactly the tolerance.
      const plan = dotted(1);
      for (const nudge of [-40, -5, 0, 5, 40]) {
        const offsets = Object.fromEntries(sixteenths.map((i) => [i, -250 + nudge]));
        const r = judgeEach(plan, play(plan, 1000, { offsets }));
        expect(indices(r), `${nudge}`).toEqual(expect.arrayContaining(sixteenths));
        expect(off(r), `${nudge}`).toEqual([]);
      }
    });

    it('still rings a sixteenth clearly early: played as two sixteenths', () => {
      // 60 bpm: the sixteenth comes half a beat early, 500 ms against a third of a beat.
      const plan = dotted(1);
      const r = judgeEach(
        plan,
        play(plan, 1000, { offsets: Object.fromEntries(sixteenths.map((i) => [i, -500])) }),
      );
      expect(off(r).map((x) => [x.index, x.verdict])).toEqual(sixteenths.map((i) => [i, 'early']));
    });

    it('does not ring a triplet played with a long first note', () => {
      // Bars of q q and a beat of three triplet notes, then q; the second triplet note comes a
      // sixth of a beat late (long, short, short) at 60 beats a minute.
      const plan = planOf(
        Array.from({ length: BARS }, () => [1, 1, 1 / 3, 1 / 3, 1 / 3, 1]).flat(),
        {
          secPerBeat: 1,
        },
      );
      const second = range(0, BARS - 1).map((bar) => bar * 6 + 3);
      const r = judgeEach(
        plan,
        play(plan, 1000, { offsets: Object.fromEntries(second.map((i) => [i, 1000 / 6])) }),
      );
      expect(indices(r)).toEqual(expect.arrayContaining(second.slice(1)));
      expect(off(r)).toEqual([]);
    });
  });

  describe('the chain', () => {
    it('breaks at a loop wrap: the wrap gap is never used', () => {
      const plan = planOf([1, 1, 1, 1]);
      const a = play(plan, 2000);
      const b = play(plan, 2000, { start: a[3]!.ms + 100 }).map((x) => ({ ...x, chain: 1 }));
      const r = judgeBar(plan, [...a, ...b]);
      expect(indices(r)).toEqual([2, 3]);
      expect(allOnTime(r)).toBe(true);
    });

    it('breaks at a forward jump even with the same chain id', () => {
      const plan = planOf(Q16);
      const a = play(plan, 2000, { upTo: 3 });
      const b = [8, 9, 10, 11].map((index, j) => ({
        index,
        ms: a[3]!.ms + 100 + j * 1000,
        chain: 0,
      }));
      const r = judgeBar(plan, [...a, ...b]);
      expect(indices(r)).toEqual([10, 11]);
      expect(allOnTime(r)).toBe(true);
    });

    it('breaks at a chain break in the middle of a bar', () => {
      const plan = planOf(Q16);
      const r = judgeBar(plan, play(plan, 2000, { upTo: 7, breaks: [6] }));
      expect(indices(r)).toEqual([4, 5]);
    });

    it('judges nothing for a pickup bar alone', () => {
      const plan = planOf(Array(9).fill(1), { pickup: 1 });
      expect(judgeBar(plan, play(plan, 2000, { upTo: 0 }))).toEqual([]);
    });

    it('judges nothing with too few gaps around a note', () => {
      const plan = planOf(Array(9).fill(1), { beatsPerBar: 3 });
      expect(judgeBar(plan, play(plan, 2000, { upTo: 2 }))).toEqual([]);
    });

    it('judges nothing when there is no onset', () => {
      expect(judgeBar(planOf(Q16), [])).toEqual([]);
    });

    it('treats onsets out of order as a broken link, without throwing', () => {
      const plan = planOf(Q16);
      const onsets = play(plan, 2000, { upTo: 7 });
      onsets[6] = { ...onsets[6]!, ms: onsets[5]!.ms - 10 };
      const r = judgeBar(plan, onsets);
      expect(indices(r)).toEqual([4, 5]);
      expect(indices(r)).not.toContain(6);
    });

    it('treats a written gap of 0 as a broken link, without throwing', () => {
      const plan = planOf(Q16);
      const same = plan.map((step, i) => (i === 6 ? { ...step, perfSec: plan[5]!.perfSec } : step));
      expect(() => judgeBar(same, play(same, 2000, { upTo: 7 }))).not.toThrow();
      expect(indices(judgeBar(same, play(same, 2000, { upTo: 7 })))).toEqual([4, 5]);
    });
  });
});

describe('resolveOnset', () => {
  const press = (midi: number, arrivalMs: number, atMs: number): NotePress => ({
    midi,
    arrivalMs,
    atMs,
  });

  it('takes the event time of the press that started the run', () => {
    expect(resolveOnset(1000, [60], [press(60, 1000.002, 960)])).toBe(960);
  });

  it('counts a rolled chord from its last key', () => {
    const log = [press(48, 1000, 990), press(60, 1030, 1020)];
    expect(resolveOnset(1030, [48, 60], log)).toBe(1020);
  });

  it('skips a later re-press', () => {
    const log = [press(60, 1000, 990), press(60, 1600, 1590)];
    expect(resolveOnset(1000, [60], log)).toBe(990);
  });

  it('absorbs a stall between the two listeners', () => {
    expect(resolveOnset(1012, [60], [press(60, 1000, 990)])).toBe(990);
  });

  it('falls back to the arrival time when no press is near enough', () => {
    expect(resolveOnset(1000, [60], [press(60, 900, 890)])).toBe(1000);
  });

  it('ignores a press of another pitch', () => {
    expect(resolveOnset(1000, [60], [press(62, 1000, 990)])).toBe(1000);
  });

  it('falls back to the arrival time with an empty log', () => {
    expect(resolveOnset(1234, [60], [])).toBe(1234);
  });
});

describe('marksOf', () => {
  /** n steps a half second apart, ids `s0`, `s1`, ... */
  const steps = (n: number): WalkPlanStep[] =>
    Array.from({ length: n }, (_, i) => ({
      perfSec: i * 0.5,
      beatSec: 0.5,
      bar: Math.floor(i / 4),
      holdSec: 0.5,
      writtenBar: Math.floor(i / 4),
      pitches: [60 + i],
      ids: [`s${i}`],
    }));
  const verdict = (
    index: number,
    kind: Verdict,
    offsetMs: number,
    tolMs = 250,
    offsetSec = offsetMs / 2000,
  ): Judged => ({ index, verdict: kind, offsetMs, offsetSec, tolMs });

  it('marks the late step with its neighbours, and nothing for the on-time ones', () => {
    const plan: WalkPlanStep[] = [
      { perfSec: 0, beatSec: 0.5, bar: 0, holdSec: 0.5, writtenBar: 0, pitches: [60], ids: ['a'] },
      {
        perfSec: 0.5,
        beatSec: 0.5,
        bar: 0,
        holdSec: 0.5,
        writtenBar: 0,
        pitches: [62, 64],
        ids: ['b', 'c'],
      },
      { perfSec: 1, beatSec: 0.5, bar: 0, holdSec: 0.5, writtenBar: 0, pitches: [65], ids: ['d'] },
    ];
    const judged: Judged[] = [
      { index: 1, verdict: 'late', offsetMs: 300, offsetSec: 0.15, tolMs: 250 },
      { index: 2, verdict: 'onTime', offsetMs: 10, offsetSec: 0.005, tolMs: 250 },
    ];
    expect(marksOf(plan, judged)).toEqual([
      {
        ids: ['b', 'c'],
        verdict: 'late',
        offsetSec: 0.15,
        prev: { ids: ['a'], dSec: 0.5 },
        next: { ids: ['d'], dSec: 0.5 },
      },
    ]);
  });

  it('keeps one mark per bar: the step furthest past its tolerance', () => {
    expect(MAX_RINGS_PER_BAR).toBe(1);
    const marks = marksOf(steps(8), [verdict(4, 'early', -400), verdict(6, 'early', -300)]);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.ids).toEqual(['s4']);
  });

  it('weighs each note against its own tolerance, not in milliseconds', () => {
    // 400 ms of 250 is 1.6 tolerances; 500 ms of 300 is 1.67: the second is furthest past.
    const marks = marksOf(steps(8), [verdict(4, 'early', -400, 250), verdict(6, 'late', 500, 300)]);
    expect(marks.map((m) => m.ids)).toEqual([['s6']]);
    expect(marks[0]!.verdict).toBe('late');
  });

  it('breaks a tie by the lower index', () => {
    const marks = marksOf(steps(8), [verdict(6, 'early', -400), verdict(5, 'late', 400)]);
    expect(marks.map((m) => m.ids)).toEqual([['s5']]);
  });

  it('gives no neighbour before the first step or after the last', () => {
    const plan = steps(4);
    const first = marksOf(plan, [verdict(0, 'early', -400)]);
    expect(first[0]!.prev).toBeNull();
    expect(first[0]!.next).toEqual({ ids: ['s1'], dSec: 0.5 });
    const last = marksOf(plan, [verdict(3, 'late', 400)]);
    expect(last[0]!.prev).toEqual({ ids: ['s2'], dSec: 0.5 });
    expect(last[0]!.next).toBeNull();
  });

  it('gives no mark when every note was on time, or none judged', () => {
    expect(marksOf(steps(4), [verdict(2, 'onTime', 30), verdict(3, 'onTime', -20)])).toEqual([]);
    expect(marksOf(steps(4), [])).toEqual([]);
  });
});

describe('writtenNoteId', () => {
  it('strips the pass of a performance id, and only that', () => {
    const repeated = performanceOf(parseMusicXml(form('form-repeat')).score);
    const plain = performanceOf(parseMusicXml(fixture('short-piano')).score);
    expect(repeated.identity).toBe(false);
    expect(plain.identity).toBe(true);
    expect(writtenNoteId(repeated, 'n12@3')).toBe('n12');
    expect(writtenNoteId(repeated, 'a@b')).toBe('a@b');
    expect(writtenNoteId(plain, 'a@b')).toBe('a@b');
    expect(writtenNoteId(plain, 'n12@3')).toBe('n12@3');
  });
});

describe('walkTimingPlan', () => {
  interface NoteSpec {
    midi: number;
    tick: number;
    hand?: Hand;
    /** Ticks the note lasts (default: one beat). */
    ticks?: number;
  }
  interface Meter {
    divisions: number;
    beats: number;
    beatType: number;
  }
  const FOUR_FOUR: Meter = { divisions: 1, beats: 4, beatType: 4 };

  let nextId = 0;
  /** A hand-built score at 120 qpm: `tickSec` is a quarter note (0.5 s) over the divisions. */
  function scoreOf(specs: NoteSpec[], bars: number, meter: Meter = FOUR_FOUR): Score {
    const tickSec = 0.5 / meter.divisions;
    const barTicks = (meter.beats * 4 * meter.divisions) / meter.beatType;
    const beatTicks = (4 * meter.divisions) / meter.beatType;
    const notes = specs.map((spec): Note => {
      const ticks = spec.ticks ?? beatTicks;
      const onsetSec = spec.tick * tickSec;
      return {
        id: `w${nextId++}`,
        onsetTick: spec.tick,
        offsetTick: spec.tick + ticks,
        onsetSec,
        offsetSec: onsetSec + ticks * tickSec,
        midi: spec.midi,
        spelling: midiToSpelling(spec.midi),
        hand: spec.hand ?? 'R',
        staff: spec.hand === 'L' ? 2 : 1,
        voice: 1,
        measureIndex: Math.floor(spec.tick / barTicks),
        isGrace: false,
        chordId: `wc${nextId}`,
        sourceIndices: [nextId],
      };
    });
    return {
      meta: {},
      divisions: meter.divisions,
      tempoMap: [{ tick: 0, qpm: 120 }],
      timeSignatures: [{ tick: 0, beats: meter.beats, beatType: meter.beatType }],
      keySignatures: [],
      measures: Array.from({ length: bars }, (_, i) => ({
        index: i,
        startTick: i * barTicks,
        lengthTicks: barTicks,
        number: String(i + 1),
      })),
      notes,
    };
  }

  /** 4/4: a left-hand whole note 48 at tick 0, right-hand quarters 60 62 64 65 and 67 at ticks 0..4. */
  const twoBars = (): Score =>
    scoreOf(
      [
        { midi: 48, tick: 0, hand: 'L', ticks: 4 },
        ...[60, 62, 64, 65, 67].map((midi, tick) => ({ midi, tick })),
      ],
      2,
    );

  it('has one step per onset, in the bars they sit in', () => {
    const plan = walkTimingPlan(performanceOf(twoBars()), []);
    expect(plan.steps).toHaveLength(5);
    expect(plan.steps.map((s) => s.bar)).toEqual([0, 0, 0, 0, 1]);
    expect(plan.steps.map((s) => s.writtenBar)).toEqual([0, 0, 0, 0, 1]);
    expect(plan.steps.map((s) => s.perfSec)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(plan.steps.map((s) => [...s.pitches])).toEqual([[48, 60], [62], [64], [65], [67]]);
  });

  it('is aligned with alongPlan, whose steps and times it keeps', () => {
    const perf = performanceOf(twoBars());
    for (const muted of [[], ['L'], ['R']] as Hand[][]) {
      const plan = walkTimingPlan(perf, muted);
      const along = alongPlan(perf, muted);
      expect(plan.along).toEqual(along.steps);
      expect(plan.times).toEqual(along.times);
      expect(plan.steps.map((s) => s.perfSec)).toEqual(along.steps.map((s) => s.perfSec));
      expect(plan.steps.map((s) => [...s.pitches])).toEqual(along.steps.map((s) => [...s.pitches]));
    }
  });

  it('lists the notes of the hands played, and leaves a muted hand out', () => {
    const score = twoBars();
    const [whole, ...quarters] = score.notes;
    const both = walkTimingPlan(performanceOf(score), []);
    expect([...both.steps[0]!.ids].sort()).toEqual([whole!.id, quarters[0]!.id].sort());
    const right = walkTimingPlan(performanceOf(score), ['L']);
    expect(right.steps[0]!.ids).toEqual([quarters[0]!.id]);
    expect(right.steps[0]!.pitches).toEqual([60]);
  });

  it('gives the beat and the hold in performance seconds', () => {
    const plan = walkTimingPlan(performanceOf(twoBars()), []);
    expect(plan.steps.map((s) => s.beatSec)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(plan.steps.slice(0, 4).map((s) => s.holdSec)).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(plan.steps[4]!.holdSec).toBeGreaterThan(0);
  });

  it('feels the dotted quarter as the beat in 6/8', () => {
    const sixEight = scoreOf(
      [
        { midi: 60, tick: 0, ticks: 3 },
        { midi: 62, tick: 3, ticks: 3 },
      ],
      1,
      { divisions: 2, beats: 6, beatType: 8 },
    );
    const plan = walkTimingPlan(performanceOf(sixEight), []);
    expect(plan.steps).toHaveLength(2);
    for (const s of plan.steps) expect(s.beatSec).toBeCloseTo(0.75, 9);
    expect(plan.steps.map((s) => s.compound)).toEqual([true, true]);
  });

  it('does not call a simple meter compound', () => {
    const plan = walkTimingPlan(performanceOf(scoreOf([{ midi: 60, tick: 0 }], 1)), []);
    expect(plan.steps.map((s) => s.compound)).toEqual([false]);
  });

  it('writes the two hearings of a repeated bar with the written ids and bar', () => {
    const { score } = parseMusicXml(form('form-repeat'));
    const perf = performanceOf(score);
    expect(perf.identity).toBe(false);
    const plan = walkTimingPlan(perf, []);
    expect(plan.steps).toHaveLength(4);
    const bar1 = score.notes.find((n) => n.measureIndex === 0)!.id;
    const bar2 = score.notes.find((n) => n.measureIndex === 1)!.id;
    expect(plan.steps.map((s) => [...s.ids])).toEqual([[bar1], [bar2], [bar1], [bar2]]);
    expect(plan.steps.map((s) => s.writtenBar)).toEqual([0, 1, 0, 1]);
    expect(plan.steps.map((s) => s.bar)).toEqual([0, 1, 2, 3]);
    for (const s of plan.steps) {
      expect(s.writtenBar).toBe(perf.written[s.bar]);
      expect(s.ids.some((id) => id.includes('@'))).toBe(false);
    }
  });

  it('lists both voices of a unison, each id once', () => {
    const score = scoreOf(
      [
        { midi: 60, tick: 0 },
        { midi: 60, tick: 0 },
      ],
      1,
    );
    const plan = walkTimingPlan(performanceOf(score), []);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.ids).toEqual(score.notes.map((n) => n.id));
    expect(new Set(plan.steps[0]!.ids).size).toBe(plan.steps[0]!.ids.length);
  });
});
