// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMusicXml, type Hand } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { performanceOf } from '../audio/performance.js';
import type { PassSpan } from '../audio/timeline.js';
import {
  MIN_MATCHED,
  SEEK_GAP_SEC,
  estimateBias,
  judgeRun,
  passOffsets,
  timingSteps,
  writtenNoteId,
  type RunJudgement,
  type StepPart,
  type TimedPress,
  type TimingStep,
  type UnitVerdict,
} from './timing.js';

const form = (name: string): string =>
  readFileSync(
    fileURLToPath(
      new URL(`../../../../packages/engine/fixtures/${name}.musicxml`, import.meta.url),
    ),
    'utf8',
  );
const fixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/${name}.musicxml`, import.meta.url), 'utf8');

/** Quarter notes at 100 qpm in 4/4: the beat and the bar in performance seconds. */
const BEAT = 0.6;
const BAR = 2.4;
/** The right hand's pitches, cycling so that neighbours differ. */
const CYCLE = [60, 62, 64, 65, 67];
/** The left hand's, for the steps in both hands. */
const LEFT = [48, 50, 52, 53, 55];

interface PartSpec {
  hand?: Hand;
  pitches: number[];
  /** The written id; the step's own id by default, so each step is its own unit. */
  id?: string;
}

/** A step at `perfSec` with the given parts (one id per part, so the key is the id). */
function stepAt(perfSec: number, parts: PartSpec[], id: string): TimingStep {
  const built: StepPart[] = parts.map((p) => {
    const ids = [p.id ?? `${id}${p.hand === 'L' ? 'L' : ''}`];
    return { hand: p.hand ?? 'R', pitches: p.pitches, ids, key: ids[0]!, prev: null, next: null };
  });
  const pitches = [...new Set(parts.flatMap((p) => p.pitches))].sort((a, b) => a - b);
  return { perfSec, pitches, beatSec: BEAT, barSec: BAR, parts: built };
}

/** `n` quarter notes from `from`, one right-hand pitch each, ids `s0`, `s1`, ... */
function quarters(n: number, from = 0): TimingStep[] {
  return Array.from({ length: n }, (_, i) =>
    stepAt(from + i * BEAT, [{ pitches: [CYCLE[i % CYCLE.length]!] }], `s${i}`),
  );
}

/** One pass over the steps, closed a bar after the last one (clear of the cut guard). */
function onePass(steps: readonly TimingStep[], over: Partial<PassSpan> = {}): PassSpan {
  return {
    pass: 1,
    fromSec: 0,
    toSec: steps[steps.length - 1]!.perfSec + BAR,
    wrapped: false,
    countedIn: true,
    ...over,
  };
}

/** `n` passes of a loop from `from` to `to`: every one wrapped but the last, which is closed. */
function loopPasses(n: number, from: number, to: number, over: Partial<PassSpan> = {}): PassSpan[] {
  return Array.from({ length: n }, (_, i) => ({
    pass: i + 1,
    fromSec: from,
    toSec: to,
    wrapped: i < n - 1,
    countedIn: true,
    ...over,
  }));
}

interface PressOptions {
  /** Off by this many real milliseconds. */
  ms?: number;
  pass?: number;
  factor?: number;
  /** Only these pitches of the step. */
  pitches?: readonly number[];
}

/** The note-ons of a step, off by `ms` real milliseconds. */
function press(step: TimingStep, o: PressOptions = {}): TimedPress[] {
  const factor = o.factor ?? 1;
  return (o.pitches ?? step.pitches).map((midi) => ({
    pass: o.pass ?? 1,
    perfSec: step.perfSec + ((o.ms ?? 0) / 1000) * factor,
    midi,
    factor,
  }));
}

/** Every step pressed in `pass`, with `ms` per step index where it is not on time. */
function pressAll(
  steps: readonly TimingStep[],
  o: { pass?: number; factor?: number; ms?: Record<number, number>; skip?: number[] } = {},
): TimedPress[] {
  return steps.flatMap((s, i) =>
    o.skip?.includes(i)
      ? []
      : press(s, { pass: o.pass ?? 1, factor: o.factor ?? 1, ms: o.ms?.[i] ?? 0 }),
  );
}

function judge(
  steps: readonly TimingStep[],
  presses: readonly TimedPress[],
  passes: readonly PassSpan[] = [onePass(steps)],
  factor = 1,
): RunJudgement | null {
  return judgeRun({ steps, passes, presses, factor });
}

/** The judgement, which must not be null. */
function judged(...args: Parameters<typeof judge>): RunJudgement {
  const j = judge(...args);
  expect(j).not.toBeNull();
  return j!;
}

const unit = (j: RunJudgement, key: string): UnitVerdict | undefined =>
  j.verdicts.find((v) => v.key === key);
const verdictOf = (j: RunJudgement, key: string) => unit(j, key)?.verdict;
const keysOf = (j: RunJudgement): string[] => j.verdicts.map((v) => v.key);
const notOnTime = (j: RunJudgement) =>
  j.verdicts.filter((v) => v.verdict !== 'onTime').map((v) => [v.key, v.verdict]);

describe('judgeRun (issue 192)', () => {
  it('1. every note at its onset is on time', () => {
    const steps = quarters(12);
    const j = judged(steps, pressAll(steps));
    expect(j.verdicts).toHaveLength(12);
    expect(j.verdicts.every((v) => v.verdict === 'onTime')).toBe(true);
    expect(j.onTime).toBe(j.total);
    expect(j.total).toBe(12);
    expect(j.biasMs).toBeCloseTo(0, 6);
    expect(j.playedShare).toBe(1);
  });

  describe('2. a steady lag or lead is not judged', () => {
    it.each([200, 350, 450])('every press %s ms late: all on time', (lag) => {
      const steps = quarters(12);
      const ms = Object.fromEntries(steps.map((_, i) => [i, lag]));
      const j = judged(steps, pressAll(steps, { ms }));
      expect(notOnTime(j)).toEqual([]);
      expect(j.total).toBe(12);
      expect(j.biasMs).toBeCloseTo(lag, 6);
    });

    it.each([200, 350, 450])('every press %s ms late at factor 1.5: all on time', (lag) => {
      const steps = quarters(12);
      const ms = Object.fromEntries(steps.map((_, i) => [i, lag]));
      const j = judged(steps, pressAll(steps, { ms, factor: 1.5 }), [onePass(steps)], 1.5);
      expect(notOnTime(j)).toEqual([]);
      expect(j.total).toBe(12);
      expect(j.biasMs).toBeCloseTo(lag, 6);
    });

    it('every press 150 ms early: all on time', () => {
      const steps = quarters(12);
      const ms = Object.fromEntries(steps.map((_, i) => [i, -150]));
      const j = judged(steps, pressAll(steps, { ms }));
      expect(notOnTime(j)).toEqual([]);
      expect(j.biasMs).toBeCloseTo(-150, 6);
    });
  });

  it('3. one note late and one early among on-time notes', () => {
    const steps = quarters(14);
    const j = judged(steps, pressAll(steps, { ms: { 4: 250, 9: -250 } }));
    expect(notOnTime(j)).toEqual([
      ['s4', 'late'],
      ['s9', 'early'],
    ]);
    expect(unit(j, 's4')!.offsetMs).toBeCloseTo(250, 0);
    expect(unit(j, 's9')!.offsetMs).toBeCloseTo(-250, 0);
    expect(unit(j, 's4')!.offsetSec).toBeCloseTo(0.25, 6);
    expect(j.onTime).toBe(12);
    expect(j.total).toBe(14);
  });

  it('4. a note 0.6 beat late is late, not missed', () => {
    const steps = quarters(10);
    const j = judged(steps, pressAll(steps, { ms: { 5: 360 } }));
    expect(notOnTime(j)).toEqual([['s5', 'late']]);
  });

  describe('5. the tolerance', () => {
    it('is 150 ms at 100 qpm: +149 is on time, +151 late', () => {
      const steps = quarters(10);
      expect(notOnTime(judged(steps, pressAll(steps, { ms: { 5: 149 } })))).toEqual([]);
      const j = judged(steps, pressAll(steps, { ms: { 5: 151 } }));
      expect(notOnTime(j)).toEqual([['s5', 'late']]);
      expect(unit(j, 's5')!.tolMs).toBeCloseTo(150, 6);
    });

    it('is 300 ms at factor 0.5: +290 is on time', () => {
      const steps = quarters(10);
      const j = judged(steps, pressAll(steps, { ms: { 5: 290 }, factor: 0.5 }), undefined, 0.5);
      expect(notOnTime(j)).toEqual([]);
      expect(unit(j, 's5')!.tolMs).toBeCloseTo(300, 6);
    });

    it('is the 120 ms floor at factor 1.5: +130 is late', () => {
      const steps = quarters(10);
      const j = judged(steps, pressAll(steps, { ms: { 5: 130 }, factor: 1.5 }), undefined, 1.5);
      expect(notOnTime(j)).toEqual([['s5', 'late']]);
      expect(unit(j, 's5')!.tolMs).toBe(120);
    });
  });

  it('6. a skipped note is missed', () => {
    const steps = quarters(10);
    const j = judged(steps, pressAll(steps, { skip: [4] }));
    expect(notOnTime(j)).toEqual([['s4', 'missed']]);
    expect(unit(j, 's4')!.offsetMs).toBeNull();
    expect(unit(j, 's4')!.offsetSec).toBeNull();
    expect(j.total).toBe(10);
  });

  describe('7. a wrong key on the beat', () => {
    const steps = quarters(10);

    it('leaves that note out: neither missed nor in the total', () => {
      const presses = [
        ...pressAll(steps, { skip: [4] }),
        { pass: 1, perfSec: steps[4]!.perfSec, midi: 61, factor: 1 },
      ];
      const j = judged(steps, presses);
      expect(unit(j, 's4')).toBeUndefined();
      expect(j.total).toBe(9);
      const all = judged(steps, pressAll(steps));
      expect(j.verdicts).toEqual(all.verdicts.filter((v) => v.key !== 's4'));
    });

    it('changes nothing when the wrong key is 0.5 s from the skipped note', () => {
      const presses = [
        ...pressAll(steps, { skip: [4] }),
        { pass: 1, perfSec: steps[4]!.perfSec + 0.5, midi: 61, factor: 1 },
      ];
      expect(judged(steps, presses)).toEqual(judged(steps, pressAll(steps, { skip: [4] })));
    });
  });

  describe('8. extra presses', () => {
    const steps = quarters(10);

    it('ignores a second press of the same pitch 100 ms after a matched one', () => {
      const j = judged(steps, [...pressAll(steps), ...press(steps[5]!, { ms: 100 })]);
      expect(notOnTime(j)).toEqual([]);
      expect(unit(j, 's5')!.offsetMs).toBeCloseTo(0, 6);
    });

    it('matches the press nearest the centre', () => {
      const presses = [
        ...pressAll(steps, { skip: [5] }),
        ...press(steps[5]!, { ms: 200 }),
        ...press(steps[5]!, { ms: 50 }),
      ];
      const j = judged(steps, presses);
      expect(notOnTime(j)).toEqual([]);
      expect(unit(j, 's5')!.offsetMs).toBeCloseTo(50, 6);
    });
  });

  it('9. repeated eighths: a press nearer the second is the second', () => {
    const t = 2.4;
    const steps = [
      ...quarters(4),
      stepAt(t, [{ pitches: [70] }], 'e0'),
      stepAt(t + 0.3, [{ pitches: [70] }], 'e1'),
      stepAt(t + 0.6, [{ pitches: [70] }], 'e2'),
      stepAt(t + 1.2, [{ pitches: [67] }], 'q4'),
      stepAt(t + 1.8, [{ pitches: [60] }], 'q5'),
      stepAt(t + 2.4, [{ pitches: [62] }], 'q6'),
    ];
    const presses = [
      ...pressAll(steps).filter((p) => p.midi !== 70),
      { pass: 1, perfSec: t + 0.2, midi: 70, factor: 1 },
      { pass: 1, perfSec: t + 0.6, midi: 70, factor: 1 },
    ];
    const j = judged(steps, presses);
    expect(verdictOf(j, 'e0')).toBe('missed');
    expect(verdictOf(j, 'e1')).toBe('onTime');
    expect(unit(j, 'e1')!.offsetMs).toBeCloseTo(-100, 6);
    expect(verdictOf(j, 'e2')).toBe('onTime');
    expect(notOnTime(j)).toEqual([['e0', 'missed']]);
  });

  it('10. a pause right after repeated eighths: the first is missed, not late', () => {
    const t = 2.4;
    const steps = [
      ...quarters(4),
      stepAt(t, [{ pitches: [70] }], 'e0'),
      stepAt(t + 0.3, [{ pitches: [70] }], 'e1'),
    ];
    const presses = [
      ...pressAll(steps.slice(0, 4)),
      { pass: 1, perfSec: t + 0.2, midi: 70, factor: 1 },
    ];
    const j = judged(steps, presses, [onePass(steps, { toSec: t + 0.6 })]);
    expect(verdictOf(j, 'e0')).toBe('missed');
    // The second eighth took the press but is inside the cut guard: not counted.
    expect(unit(j, 'e1')).toBeUndefined();
    expect(j.total).toBe(5);
  });

  it('11. a chord in one hand is one unit, judged on its middle', () => {
    const steps = [
      ...quarters(4),
      stepAt(2.4, [{ pitches: [60, 64, 67] }], 'chord'),
      ...quarters(4, 3.0).map((s, i) => ({
        ...s,
        parts: s.parts.map((p) => ({ ...p, ids: [`t${i}`], key: `t${i}` })),
      })),
    ];
    const chord = steps[4]!;
    const rest = pressAll(steps).filter((p) => p.perfSec !== chord.perfSec);
    const rolled = [
      ...rest,
      ...press(chord, { pitches: [60], ms: 0 }),
      ...press(chord, { pitches: [64], ms: 20 }),
      ...press(chord, { pitches: [67], ms: 40 }),
    ];
    const j = judged(steps, rolled);
    expect(keysOf(j).filter((k) => k === 'chord')).toHaveLength(1);
    expect(verdictOf(j, 'chord')).toBe('onTime');
    expect(unit(j, 'chord')!.offsetMs).toBeCloseTo(20, 6);
    // One pitch of the chord is enough.
    const one = judged(steps, [...rest, ...press(chord, { pitches: [60], ms: 30 })]);
    expect(verdictOf(one, 'chord')).toBe('onTime');
    expect(unit(one, 'chord')!.offsetMs).toBeCloseTo(30, 6);
  });

  it('12. hands not together: each hand of a step is its own unit', () => {
    const steps = Array.from({ length: 10 }, (_, i) =>
      stepAt(
        i * BEAT,
        [
          { hand: 'L', pitches: [LEFT[i % 5]!] },
          { hand: 'R', pitches: [CYCLE[i % 5]!] },
        ],
        `s${i}`,
      ),
    );
    const left = steps[4]!.parts[0]!.pitches[0]!;
    const presses = [
      ...pressAll(steps).filter((p) => !(p.perfSec === steps[4]!.perfSec && p.midi === left)),
      ...press(steps[4]!, { pitches: [left], ms: 300 }),
    ];
    const j = judged(steps, presses);
    expect(notOnTime(j)).toEqual([['s4L', 'late']]);
    expect(verdictOf(j, 's4')).toBe('onTime');
    expect(unit(j, 's4L')!.hand).toBe('L');
    expect(j.total).toBe(20);
  });

  it('13. a hand not played is not judged', () => {
    const steps = Array.from({ length: 10 }, (_, i) => {
      const parts: PartSpec[] = [];
      if (i % 2 === 0) parts.push({ hand: 'L', pitches: [LEFT[i % 5]!] });
      if (i !== 3 && i !== 7) parts.push({ hand: 'R', pitches: [CYCLE[i % 5]!] });
      else if (parts.length === 0) parts.push({ hand: 'L', pitches: [LEFT[i % 5]!] });
      return stepAt(i * BEAT, parts, `s${i}`);
    });
    const right = new Set(steps.flatMap((s) => s.parts.filter((p) => p.hand === 'R')));
    const presses = steps.flatMap((s) =>
      s.parts.filter((p) => right.has(p)).flatMap((p) => press(s, { pitches: p.pitches })),
    );
    const j = judged(steps, presses);
    expect(j.verdicts.some((v) => v.hand === 'L')).toBe(false);
    expect(j.total).toBe(right.size);
    expect(j.onTime).toBe(right.size);
  });

  describe('14. barely played', () => {
    const only = (steps: TimingStep[], played: number[]) =>
      judge(
        steps,
        pressAll(steps, { skip: steps.map((_, i) => i).filter((i) => !played.includes(i)) }),
      );

    it('shows nothing with 3 matched of 10', () => {
      expect(only(quarters(10), [0, 4, 9])).toBeNull();
    });

    it('judges 4 of 10: exactly the share, and the rule is "less than"', () => {
      const j = only(quarters(10), [0, 3, 6, 9]);
      expect(j).not.toBeNull();
      expect(j!.playedShare).toBeCloseTo(0.4, 9);
    });

    it('shows nothing with 7 of 20', () => {
      expect(only(quarters(20), [0, 3, 6, 9, 12, 15, 19])).toBeNull();
    });

    it('shows nothing with no presses', () => {
      expect(judge(quarters(10), [])).toBeNull();
    });
  });

  describe('15. listening is not judged', () => {
    const loop = quarters(4);

    it('a loop played in passes 1 to 3 and silent in 4 and 5 is judged on passes 1 to 3', () => {
      const played = [1, 2, 3].flatMap((pass) => pressAll(loop, { pass }));
      const five = judged(loop, played, loopPasses(5, 0, BAR));
      const three = judged(loop, played, loopPasses(3, 0, BAR));
      expect(five).toEqual(three);
      expect(five.verdicts.some((v) => v.verdict === 'missed')).toBe(false);
      expect(five.verdicts.every((v) => v.hearings === 3)).toBe(true);
    });

    it('stopping after 8 notes judges those 8, with nothing missed', () => {
      const steps = quarters(20);
      const j = judged(steps, pressAll(steps.slice(0, 8)));
      expect(keysOf(j)).toEqual(steps.slice(0, 8).map((s) => s.parts[0]!.key));
      expect(notOnTime(j)).toEqual([]);
    });

    it('joining at step 6 leaves steps 0 to 5 out', () => {
      const steps = quarters(14);
      const j = judged(steps, pressAll(steps, { skip: [0, 1, 2, 3, 4, 5] }));
      expect(keysOf(j)).toEqual(steps.slice(6).map((s) => s.parts[0]!.key));
      expect(notOnTime(j)).toEqual([]);
    });

    it('a loop of 5 passes played only in the last 2 is judged on those', () => {
      const played = [4, 5].flatMap((pass) => pressAll(loop, { pass }));
      const j = judged(loop, played, loopPasses(5, 0, BAR));
      expect(j.total).toBe(4);
      expect(notOnTime(j)).toEqual([]);
      expect(j.verdicts.every((v) => v.hearings === 2)).toBe(true);
    });

    it('8 on time, then 2 unplayed before the stop: every note on time', () => {
      const steps = quarters(10);
      const j = judged(steps, pressAll(steps, { skip: [8, 9] }), [
        onePass(steps, { toSec: steps[9]!.perfSec + 0.5 }),
      ]);
      expect(j.total).toBe(8);
      expect(j.onTime).toBe(8);
    });

    it('inside the played span, 5 unplayed quarters are listening and 3 are missed', () => {
      const steps = quarters(16);
      const sat = judged(steps, pressAll(steps, { skip: [5, 6, 7, 8, 9] }));
      expect(notOnTime(sat)).toEqual([]);
      expect(sat.total).toBe(11);
      const slipped = judged(steps, pressAll(steps, { skip: [5, 6, 7] }));
      expect(notOnTime(slipped)).toEqual([
        ['s5', 'missed'],
        ['s6', 'missed'],
        ['s7', 'missed'],
      ]);
      expect(slipped.total).toBe(16);
    });
  });

  describe('16. a loop of three passes judges the last three hearings', () => {
    const loop = quarters(4);
    const passes = loopPasses(3, 0, BAR);
    const run = (per: (pass: number) => { ms?: Record<number, number>; skip?: number[] }) =>
      judged(
        loop,
        [1, 2, 3].flatMap((pass) => pressAll(loop, { pass, ...per(pass) })),
        passes,
      );

    it('forgives one slip in three', () => {
      const j = run((pass) => (pass === 2 ? { skip: [1] } : {}));
      expect(verdictOf(j, 's1')).toBe('onTime');
      expect(unit(j, 's1')!.hearings).toBe(3);
    });

    it('calls two misses in three missed', () => {
      const j = run((pass) => (pass !== 3 ? { skip: [1] } : {}));
      expect(verdictOf(j, 's1')).toBe('missed');
    });

    it('calls a note late in passes 2 and 3 late', () => {
      const j = run((pass) => (pass !== 1 ? { ms: { 1: 250 } } : {}));
      expect(verdictOf(j, 's1')).toBe('late');
      expect(unit(j, 's1')!.offsetMs).toBeCloseTo(250, 6);
    });

    it('with 5 passes takes only the last 3', () => {
      const played = [1, 2, 3, 4, 5].flatMap((pass) =>
        pressAll(loop, { pass, ...(pass <= 3 ? { skip: [1] } : {}) }),
      );
      const j = judged(loop, played, loopPasses(5, 0, BAR));
      expect(verdictOf(j, 's1')).toBe('onTime');
      expect(unit(j, 's1')!.hearings).toBe(3);
    });
  });

  it('17. a press early across a wrap is the next pass first note', () => {
    // Play started mid-loop: pass 1 hears the loop's second half, pass 2 the whole loop.
    const loop = quarters(4);
    const passes: PassSpan[] = [
      { pass: 1, fromSec: 1.2, toSec: BAR, wrapped: true, countedIn: true },
      { pass: 2, fromSec: 0, toSec: BAR, wrapped: false, countedIn: true },
    ];
    const presses = [
      ...pressAll(loop.slice(2), { pass: 1 }),
      { pass: 1, perfSec: BAR - 0.2, midi: 60, factor: 1 },
      ...pressAll(loop.slice(1), { pass: 2 }),
    ];
    const j = judged(loop, presses, passes);
    expect(notOnTime(j)).toEqual([['s0', 'early']]);
    expect(unit(j, 's0')!.offsetMs).toBeCloseTo(-200, 6);
    expect(unit(j, 's0')!.hearings).toBe(1);
  });

  it('18. a repeated bar is one unit with two hearings', () => {
    const steps = Array.from({ length: 8 }, (_, i) =>
      stepAt(i * BEAT, [{ pitches: [CYCLE[i % 4]!], id: `r${i % 4}` }], `s${i}`),
    );
    const j = judged(steps, pressAll(steps));
    expect(keysOf(j)).toEqual(['r0', 'r1', 'r2', 'r3']);
    expect(j.verdicts.every((v) => v.hearings === 2)).toBe(true);
    expect(j.total).toBe(4);
  });

  describe('19. the count-in', () => {
    const steps = quarters(8);

    it('judges a press in the count-in for the first note early', () => {
      const j = judged(steps, pressAll(steps, { ms: { 0: -200 } }));
      expect(notOnTime(j)).toEqual([['s0', 'early']]);
    });

    it('ignores a press beyond the search and the window, and leaves the first note out', () => {
      const j = judged(steps, pressAll(steps, { ms: { 0: -700 } }));
      expect(unit(j, 's0')).toBeUndefined();
      expect(j.total).toBe(7);
      expect(notOnTime(j)).toEqual([]);
    });
  });

  describe('20. no count-in: the reaction to the first sound', () => {
    const steps = quarters(8);
    const cold = [onePass(steps, { countedIn: false })];

    it('does not judge a late first note', () => {
      const j = judged(steps, pressAll(steps, { ms: { 0: 300 } }), cold);
      expect(unit(j, 's0')).toBeUndefined();
      expect(j.total).toBe(7);
      expect(notOnTime(j)).toEqual([]);
    });

    it('judges an early first note', () => {
      const j = judged(steps, pressAll(steps, { ms: { 0: -200 } }), cold);
      expect(notOnTime(j)).toEqual([['s0', 'early']]);
    });

    it('judges a late first note in a pass that began with a wrap', () => {
      const loop = quarters(4);
      const passes: PassSpan[] = [
        { pass: 1, fromSec: 1.2, toSec: BAR, wrapped: true, countedIn: false },
        { pass: 2, fromSec: 0, toSec: BAR, wrapped: false, countedIn: false },
      ];
      const presses = [
        ...pressAll(loop.slice(2), { pass: 1 }),
        ...pressAll(loop, { pass: 2, ms: { 0: 300 } }),
      ];
      const j = judged(loop, presses, passes);
      expect(notOnTime(j)).toEqual([['s0', 'late']]);
      // The pass's own first note, on time inside the reaction window, counts.
      expect(unit(j, 's2')!.hearings).toBe(2);
    });
  });

  describe('21. a pass cut by the stop', () => {
    const steps = quarters(8);
    const last = steps[7]!.perfSec;

    it('does not judge a late note closer to the stop than the window', () => {
      const j = judged(steps, pressAll(steps, { ms: { 7: 300 } }), [
        onePass(steps, { toSec: last + 0.4 }),
      ]);
      expect(unit(j, 's7')).toBeUndefined();
      expect(notOnTime(j)).toEqual([]);
    });

    it('judges the same press on a note further from the stop', () => {
      const j = judged(steps, pressAll(steps, { ms: { 6: 300 } }), [
        onePass(steps, { toSec: last + 0.4 }),
      ]);
      expect(notOnTime(j)).toEqual([['s6', 'late']]);
    });
  });

  it('22. a seek: each side is judged, and no press matches across it', () => {
    const before = quarters(4);
    const after = [9.4, 10.0, 10.6, 11.2, 11.8, 12.4].map((sec, i) =>
      stepAt(sec, [{ pitches: [CYCLE[(i + 4) % 5]!] }], `a${i}`),
    );
    const steps = [...before, ...after];
    const passes: PassSpan[] = [
      { pass: 1, fromSec: 0, toSec: 2.0, wrapped: false, countedIn: true },
      { pass: 2, fromSec: 10.0, toSec: 13.6, wrapped: false, countedIn: false },
    ];
    const first = after[1]!;
    expect(first.pitches).toEqual([60]);
    const presses = [
      ...pressAll(before, { pass: 1 }),
      // A press of the next side's first pitch just before the seek.
      { pass: 1, perfSec: 1.95, midi: 60, factor: 1 },
      { pass: 2, perfSec: 9.9, midi: 60, factor: 1 },
      ...pressAll(after.slice(2), { pass: 2 }),
    ];
    const j = judged(steps, presses, passes);
    expect(verdictOf(j, 'a1')).toBe('onTime');
    expect(unit(j, 'a1')!.offsetMs).toBeCloseTo(-100, 6);
    expect(unit(j, 'a0')).toBeUndefined();
    expect(verdictOf(j, 's0')).toBe('onTime');
    expect(notOnTime(j)).toEqual([]);
  });

  it('23. a resync continues the pass: no gap, no cut, no reaction rule', () => {
    const steps = quarters(10, 0.3);
    const passes: PassSpan[] = [
      { pass: 1, fromSec: 0, toSec: 3.0, wrapped: false, countedIn: true },
      { pass: 2, fromSec: 3.0, toSec: 7.0, wrapped: false, countedIn: false },
    ];
    expect(passOffsets(passes)).toEqual([0, 3.0]);
    const presses = [
      ...pressAll(steps.slice(0, 5), { pass: 1, ms: { 4: 300 } }),
      ...pressAll(steps.slice(5), { pass: 2, ms: { 0: 300 } }),
    ];
    const j = judged(steps, presses, passes);
    expect(steps[4]!.perfSec).toBeCloseTo(2.7, 9);
    expect(notOnTime(j)).toEqual([
      ['s4', 'late'],
      ['s5', 'late'],
    ]);
  });

  it('23b. a pass a seek emptied in its count-in is not continued: the seek starts cold', () => {
    // Rewind (or a click on bar 1) during the count-in: the counted-in pass is closed where it
    // started (nothing heard), and the seek's pass starts from the same second with no count-in.
    const steps = quarters(8);
    const presses = pressAll(steps, { pass: 2, ms: { 0: 300 } });
    const emptied: PassSpan[] = [
      { pass: 1, fromSec: 0, toSec: 0, wrapped: false, countedIn: true },
      onePass(steps, { pass: 2, countedIn: false }),
    ];
    const alone = judged(steps, presses, [onePass(steps, { pass: 2, countedIn: false })]);
    expect(unit(alone, 's0')).toBeUndefined();
    const j = judged(steps, presses, emptied);
    expect(unit(j, 's0')).toBeUndefined();
    expect(j.total).toBe(alone.total);
    expect(notOnTime(j)).toEqual([]);
    expect(passOffsets(emptied)).toEqual([0, SEEK_GAP_SEC]);
  });

  it('24. notes before the pass start are not heard', () => {
    const steps = quarters(10);
    const j = judged(steps, pressAll(steps), [onePass(steps, { fromSec: 1.2 })]);
    expect(unit(j, 's0')).toBeUndefined();
    expect(unit(j, 's1')).toBeUndefined();
    expect(j.total).toBe(8);
  });

  it('25. a press with an unknown pass is dropped', () => {
    const steps = quarters(10);
    const presses = [...pressAll(steps, { skip: [4] }), ...press(steps[4]!, { pass: 99 })];
    expect(notOnTime(judged(steps, presses))).toEqual([['s4', 'missed']]);
  });

  it("26. an offset converts to ms with its own press's factor", () => {
    const steps = quarters(10);
    const presses = [
      ...pressAll(steps, { skip: [5] }),
      { pass: 1, perfSec: steps[5]!.perfSec + 0.15, midi: steps[5]!.pitches[0]!, factor: 0.75 },
    ];
    const j = judged(steps, presses);
    expect(unit(j, 's5')!.offsetMs).toBeCloseTo(200, 6);
    expect(unit(j, 's5')!.offsetSec).toBeCloseTo(0.15, 9);
    expect(verdictOf(j, 's5')).toBe('late');
  });

  it('matches a unison across the hands once, for both parts', () => {
    const steps = [
      ...quarters(4),
      stepAt(
        2.4,
        [
          { hand: 'L', pitches: [60] },
          { hand: 'R', pitches: [60] },
        ],
        'u',
      ),
      ...quarters(4, 3.0).map((s, i) => ({
        ...s,
        parts: s.parts.map((p) => ({ ...p, ids: [`t${i}`], key: `t${i}` })),
      })),
    ];
    const unison = steps[4]!;
    expect(unison.pitches).toEqual([60]);
    const presses = [
      ...pressAll(steps).filter((p) => p.perfSec !== unison.perfSec),
      ...press(unison, { ms: 200 }),
    ];
    const j = judged(steps, presses);
    expect(notOnTime(j)).toEqual([
      ['uL', 'late'],
      ['u', 'late'],
    ]);
    expect(unit(j, 'uL')!.offsetMs).toBeCloseTo(200, 6);
    expect(unit(j, 'u')!.offsetMs).toBe(unit(j, 'uL')!.offsetMs);
  });

  it('takes the presses of a grace note and of later trill attacks as extras', () => {
    // The trill asks for its upper start (alongPlan's rule); its later attacks repeat the pitches.
    const steps = quarters(10);
    const trill = steps[5]!;
    const upper = trill.pitches[0]!;
    const extras: TimedPress[] = [
      { pass: 1, perfSec: trill.perfSec - 0.04, midi: upper - 2, factor: 1 },
      { pass: 1, perfSec: trill.perfSec + 0.08, midi: upper - 1, factor: 1 },
      { pass: 1, perfSec: trill.perfSec + 0.16, midi: upper, factor: 1 },
      { pass: 1, perfSec: trill.perfSec + 0.24, midi: upper - 1, factor: 1 },
    ];
    const plain = judged(steps, pressAll(steps));
    expect(judged(steps, [...pressAll(steps), ...extras]).verdicts).toEqual(plain.verdicts);
  });

  it('keeps the order of first counted hearing and passes the neighbours through', () => {
    const steps = quarters(6);
    const neighbour = { ids: ['x'], dSec: 0.6 };
    const linked = steps.map((s) => ({
      ...s,
      parts: s.parts.map((p) => ({ ...p, prev: neighbour, next: null })),
    }));
    const j = judged(linked, pressAll(linked));
    expect(keysOf(j)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5']);
    expect(j.verdicts[2]!.prev).toBe(neighbour);
    expect(j.verdicts[2]!.next).toBeNull();
    expect(j.verdicts[2]!.ids).toEqual(['s2']);
  });
});

describe('27. the judge steps', () => {
  it('writtenNoteId strips the pass of a performance id, and only that', () => {
    const repeated = performanceOf(parseMusicXml(form('form-repeat')).score);
    const plain = performanceOf(parseMusicXml(fixture('short-piano')).score);
    expect(repeated.identity).toBe(false);
    expect(plain.identity).toBe(true);
    expect(writtenNoteId(repeated, 'n12@3')).toBe('n12');
    expect(writtenNoteId(repeated, 'a@b')).toBe('a@b');
    expect(writtenNoteId(plain, 'a@b')).toBe('a@b');
    expect(writtenNoteId(plain, 'n12@3')).toBe('n12@3');
  });

  it('gives the two hearings of a repeated bar one key, with neighbours in order heard', () => {
    const { score } = parseMusicXml(form('form-repeat'));
    const steps = timingSteps(performanceOf(score), []);
    const bar1 = score.notes.find((n) => n.measureIndex === 0)!.id;
    const bar2 = score.notes.find((n) => n.measureIndex === 1)!.id;
    expect(steps.map((s) => s.parts.map((p) => p.key))).toEqual([[bar1], [bar2], [bar1], [bar2]]);
    const parts = steps.map((s) => s.parts[0]!);
    const d = (i: number) => steps[i + 1]!.perfSec - steps[i]!.perfSec;
    expect(parts[0]!.prev).toBeNull();
    expect(parts[0]!.next).toEqual({ ids: [bar2], dSec: d(0) });
    expect(parts[1]!.prev).toEqual({ ids: [bar1], dSec: d(0) });
    expect(parts[1]!.next).toEqual({ ids: [bar1], dSec: d(1) });
    expect(parts[3]!.next).toBeNull();
    expect(steps.every((s) => s.beatSec > 0 && s.barSec > 0)).toBe(true);
  });

  it('takes each neighbour from the same hand', () => {
    const steps = timingSteps(performanceOf(parseMusicXml(fixture('short-piano')).score), []);
    let skipped = false;
    steps.forEach((step, i) => {
      for (const part of step.parts) {
        let j = i - 1;
        while (j >= 0 && !steps[j]!.parts.some((p) => p.hand === part.hand)) j--;
        if (j < 0) {
          expect(part.prev).toBeNull();
          continue;
        }
        if (j < i - 1) skipped = true;
        const before = steps[j]!.parts.find((p) => p.hand === part.hand)!;
        expect(part.prev).toEqual({ ids: before.ids, dSec: step.perfSec - steps[j]!.perfSec });
        expect(before.next).toEqual({ ids: part.ids, dSec: step.perfSec - steps[j]!.perfSec });
        expect(part.key).toBe([...new Set(part.ids)].sort().join(' '));
      }
    });
    expect(skipped).toBe(true);
  });

  it('leaves out the hands muted', () => {
    const score = parseMusicXml(fixture('short-piano')).score;
    const steps = timingSteps(performanceOf(score), ['L']);
    expect(steps.every((s) => s.parts.every((p) => p.hand === 'R'))).toBe(true);
  });
});

describe('28. the run axis and the bias', () => {
  it('joins wrapped passes and a resync, and puts a gap after a cut pass', () => {
    expect(passOffsets(loopPasses(3, 0, BAR))).toEqual([0, BAR, 2 * BAR]);
    expect(
      passOffsets([
        { pass: 1, fromSec: 0, toSec: 3.0, wrapped: false, countedIn: true },
        { pass: 2, fromSec: 3.0, toSec: 5.0, wrapped: false, countedIn: false },
      ]),
    ).toEqual([0, 3.0]);
    expect(
      passOffsets([
        { pass: 1, fromSec: 0, toSec: 2.0, wrapped: false, countedIn: true },
        { pass: 2, fromSec: 10.0, toSec: 12.0, wrapped: false, countedIn: false },
      ]),
    ).toEqual([0, 2.0 + SEEK_GAP_SEC]);
    // An empty pass (cut in its count-in) followed by a seek to its start is not a resync.
    expect(
      passOffsets([
        { pass: 1, fromSec: 4.0, toSec: 4.0, wrapped: false, countedIn: true },
        { pass: 2, fromSec: 4.0, toSec: 6.0, wrapped: false, countedIn: false },
      ]),
    ).toEqual([0, SEEK_GAP_SEC]);
    expect(passOffsets([])).toEqual([]);
  });

  it('estimates no bias from fewer than MIN_MATCHED offsets', () => {
    const steps = quarters(10);
    const late = (n: number) =>
      pressAll(steps.slice(0, n), { ms: { 0: 300, 1: 300, 2: 300, 3: 300 } });
    expect(MIN_MATCHED).toBe(4);
    expect(estimateBias({ steps, passes: [onePass(steps)], presses: late(3), factor: 1 })).toBe(0);
    expect(
      estimateBias({ steps, passes: [onePass(steps)], presses: late(4), factor: 1 }),
    ).toBeCloseTo(0.3, 9);
  });
});
