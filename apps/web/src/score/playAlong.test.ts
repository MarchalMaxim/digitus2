// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  midiToSpelling,
  parseMusicXml,
  ticksToSeconds,
  type Hand,
  type Note,
  type Score,
} from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { beatTicksAt } from '../audio/beats.js';
import { performanceOf, toWrittenSec } from '../audio/performance.js';
import {
  ALONG_EPS,
  HOLD_TOLERANCE,
  NO_KEYS,
  NO_PRESSES,
  advance,
  alongPlan,
  alongPlanNotes,
  alongSteps,
  anchorStep,
  holdSec,
  liftAt,
  pressAt,
  pressKey,
  releaseKey,
  runSince,
  settle,
  spendAll,
  stepAfter,
  type AlongStep,
  type Keys,
  type PerfRange,
  type Presses,
  type Settled,
  type StepNotes,
  type StepTime,
} from './playAlong.js';

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

/** Bars of four quarter notes: divisions 1 and 120 qpm, so a tick is half a second. */
const BAR_TICKS = 4;
const TICK_SEC = 0.5;

interface NoteSpec {
  midi: number;
  tick: number;
  hand?: Hand;
  grace?: boolean;
  /** Ticks the note lasts (default 1). */
  ticks?: number;
  ornament?: Note['ornament'];
  sourceIndices?: number[];
}

let nextId = 0;
function note(spec: NoteSpec): Note {
  const onsetSec = spec.tick * TICK_SEC;
  const ticks = spec.grace ? 0 : (spec.ticks ?? 1);
  return {
    id: `n${nextId++}`,
    onsetTick: spec.tick,
    offsetTick: spec.tick + ticks,
    onsetSec,
    offsetSec: onsetSec + ticks * TICK_SEC,
    midi: spec.midi,
    spelling: midiToSpelling(spec.midi),
    hand: spec.hand ?? 'R',
    staff: spec.hand === 'L' ? 2 : 1,
    voice: 1,
    measureIndex: Math.floor(spec.tick / BAR_TICKS),
    isGrace: spec.grace ?? false,
    chordId: `c${nextId}`,
    sourceIndices: spec.sourceIndices ?? [nextId],
    ...(spec.ornament ? { ornament: spec.ornament } : {}),
  };
}

function scoreOf(specs: NoteSpec[], bars = 4): Score {
  return {
    meta: {},
    divisions: 1,
    tempoMap: [{ tick: 0, qpm: 120 }],
    timeSignatures: [{ tick: 0, beats: 4, beatType: 4 }],
    keySignatures: [],
    measures: Array.from({ length: bars }, (_, i) => ({
      index: i,
      startTick: i * BAR_TICKS,
      lengthTicks: BAR_TICKS,
      number: String(i + 1),
    })),
    notes: specs.map(note),
  };
}

function stepsOf(specs: NoteSpec[], muted: Hand[] = []): AlongStep[] {
  return alongSteps(performanceOf(scoreOf(specs)), muted);
}

const pitches = (steps: AlongStep[]): number[][] => steps.map((s) => [...s.pitches]);

describe('alongSteps', () => {
  it('makes one step per onset, with the pitches distinct and ascending', () => {
    const steps = stepsOf([
      { midi: 67, tick: 0 },
      { midi: 60, tick: 0 },
      { midi: 64, tick: 0 },
      { midi: 62, tick: 1 },
      { midi: 65, tick: 3 },
    ]);
    expect(pitches(steps)).toEqual([[60, 64, 67], [62], [65]]);
    expect(steps.map((s) => s.perfSec)).toEqual([0, 0.5, 1.5]);
  });

  it('orders the steps by onset whatever order the notes arrive in', () => {
    // Staff after staff, as the reader writes them.
    const steps = stepsOf([
      { midi: 72, tick: 0 },
      { midi: 74, tick: 1 },
      { midi: 48, tick: 0, hand: 'L' },
      { midi: 50, tick: 1, hand: 'L' },
    ]);
    expect(pitches(steps)).toEqual([
      [48, 72],
      [50, 74],
    ]);
    expect(steps.map((s) => s.perfSec)).toEqual([0, 0.5]);
  });

  it('does not require a held bass again at the melody next onset', () => {
    const steps = stepsOf([
      { midi: 48, tick: 0, hand: 'L', ticks: 4 },
      { midi: 60, tick: 0 },
      { midi: 62, tick: 1 },
      { midi: 64, tick: 2 },
    ]);
    expect(pitches(steps)).toEqual([[48, 60], [62], [64]]);
  });

  it('asks only for the left hand with the right hand muted, and drops a right-hand-only onset', () => {
    const specs: NoteSpec[] = [
      { midi: 72, tick: 0 },
      { midi: 48, tick: 0, hand: 'L' },
      { midi: 74, tick: 1 },
      { midi: 72, tick: 2 },
      { midi: 50, tick: 2, hand: 'L' },
    ];
    const steps = stepsOf(specs, ['R']);
    expect(pitches(steps)).toEqual([[48], [50]]);
    expect(steps.map((s) => s.perfSec)).toEqual([0, 1]);
    expect(pitches(stepsOf(specs, ['L']))).toEqual([[72], [74], [72]]);
    expect(stepsOf(specs, ['L', 'R'])).toEqual([]);
  });

  it('never requires a grace note', () => {
    const steps = stepsOf([
      { midi: 59, tick: 0, grace: true },
      { midi: 60, tick: 0 },
      { midi: 62, tick: 1 },
    ]);
    expect(pitches(steps)).toEqual([[60], [62]]);
    expect(steps[0]!.perfSec).toBe(0);
  });

  it('drops an onset where the played hands have only grace notes', () => {
    const specs: NoteSpec[] = [
      { midi: 60, tick: 0 },
      { midi: 61, tick: 1, grace: true },
      { midi: 48, tick: 1, hand: 'L' },
      { midi: 62, tick: 2 },
    ];
    expect(pitches(stepsOf(specs))).toEqual([[60], [48], [62]]);
    // With the left hand muted, the onset holds only a grace note: it is no step.
    const muted = stepsOf(specs, ['L']);
    expect(pitches(muted)).toEqual([[60], [62]]);
    expect(muted.map((s) => s.perfSec)).toEqual([0, 1]);
    // A grace note with nothing else at its onset is no step either.
    expect(
      pitches(
        stepsOf([
          { midi: 61, tick: 1, grace: true },
          { midi: 62, tick: 2 },
        ]),
      ),
    ).toEqual([[62]]);
  });

  describe('ornaments', () => {
    const trill = (startNote: 'main' | 'upper' | 'below'): NonNullable<Note['ornament']> => ({
      kind: 'trill-mark',
      long: false,
      upperMidi: 62,
      lowerMidi: 59,
      startNote,
      endTick: 4,
      endSec: 2,
    });

    it('requires the upper note of a trill that starts on it', () => {
      const steps = stepsOf([
        { midi: 60, tick: 0, ticks: 4, ornament: trill('upper') },
        { midi: 65, tick: 4 },
      ]);
      expect(pitches(steps)).toEqual([[62], [65]]);
    });

    it('requires the principal of a trill that starts on it', () => {
      const steps = stepsOf([
        { midi: 60, tick: 0, ticks: 4, ornament: trill('main') },
        { midi: 65, tick: 4 },
      ]);
      expect(pitches(steps)).toEqual([[60], [65]]);
    });

    it('requires the lower note of a trill that starts below', () => {
      const steps = stepsOf([{ midi: 60, tick: 0, ticks: 4, ornament: trill('below') }]);
      expect(pitches(steps)).toEqual([[59]]);
    });

    it('requires the principal of a mordent', () => {
      const steps = stepsOf([
        {
          midi: 60,
          tick: 0,
          ticks: 2,
          ornament: {
            kind: 'mordent',
            long: false,
            upperMidi: 62,
            lowerMidi: 59,
            startNote: 'main',
            endTick: 2,
            endSec: 1,
          },
        },
      ]);
      expect(pitches(steps)).toEqual([[60]]);
    });

    it('asks for the pitch the keyboard shows, together with a plain left hand note', () => {
      const steps = stepsOf([
        { midi: 60, tick: 0, ticks: 4, ornament: trill('upper') },
        { midi: 48, tick: 0, hand: 'L', ticks: 4 },
      ]);
      expect(pitches(steps)).toEqual([[48, 62]]);
    });
  });

  it('makes a tied note one step, with no step for its continuation', () => {
    const steps = stepsOf([
      { midi: 60, tick: 0, ticks: 8, sourceIndices: [0, 1] },
      { midi: 62, tick: 4 },
      { midi: 64, tick: 8 },
    ]);
    expect(pitches(steps)).toEqual([[60], [62], [64]]);
    // The tie itself is one engine note: it contributes the one onset.
    const tiedOnly = stepsOf([{ midi: 60, tick: 0, ticks: 8, sourceIndices: [0, 1] }]);
    expect(pitches(tiedOnly)).toEqual([[60]]);
  });

  it('makes a unison of both hands, or of two voices, one pitch', () => {
    const steps = stepsOf([
      { midi: 60, tick: 0 },
      { midi: 60, tick: 0, hand: 'L' },
      { midi: 64, tick: 1 },
      { midi: 64, tick: 1 },
    ]);
    expect(pitches(steps)).toEqual([[60], [64]]);
  });

  it('gives no steps for a score with no notes', () => {
    expect(stepsOf([])).toEqual([]);
  });

  describe('in the order heard', () => {
    it('walks a backward repeat over bars 1 and 2 as bars 1 2 1 2 3', () => {
      const score = scoreOf(
        [
          { midi: 60, tick: 0 },
          { midi: 62, tick: 4 },
          { midi: 64, tick: 8 },
        ],
        3,
      );
      score.measures[0]!.form = { repeatStart: true };
      score.measures[1]!.form = { repeatEnd: 2 };
      const perf = performanceOf(score);
      expect(perf.written).toEqual([0, 1, 0, 1, 2]);
      const steps = alongSteps(perf, []);
      expect(pitches(steps)).toEqual([[60], [62], [60], [62], [64]]);
      expect(steps.map((s) => s.perfSec)).toEqual([0, 2, 4, 6, 8]);
      for (let i = 1; i < steps.length; i++)
        expect(steps[i]!.perfSec).toBeGreaterThan(steps[i - 1]!.perfSec);
      // Each step lands on the written group within the cursor's slack.
      const written = steps.map((s) => toWrittenSec(perf, s.perfSec));
      expect(written).toEqual([0, 2, 0, 2, 4]);
    });

    it('walks the voltas as heard: the first ending once, then the second', () => {
      const { score } = parseMusicXml(form('form-voltas'));
      const perf = performanceOf(score);
      const steps = alongSteps(perf, []);
      // Bars 1 2 3(1st) | 1 2 4(2nd): C D E C D F.
      expect(pitches(steps)).toEqual([[60], [62], [64], [60], [62], [65]]);
      expect(steps.map((s) => s.perfSec)).toEqual([0, 2, 4, 6, 8, 10]);
      expect(steps.map((s) => toWrittenSec(perf, s.perfSec))).toEqual([0, 2, 4, 0, 2, 6]);
    });

    it('walks a D.C. al Fine to the Fine', () => {
      const { score } = parseMusicXml(form('form-dc-al-fine'));
      const perf = performanceOf(score);
      const steps = alongSteps(perf, []);
      expect(pitches(steps)).toEqual([[60], [62], [64], [65], [60], [62]]);
      expect(steps.map((s) => s.perfSec)).toEqual([0, 2, 4, 6, 8, 10]);
    });

    it.each([63, 70, 77, 90, 93, 100, 110, 120, 130, 137, 144, 151])(
      'lands every step on its written group at %s qpm, where the seconds do not add up exactly',
      (qpm) => {
        const q = (step: string) =>
          `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`;
        const bar = (n: number, steps: string[], extra = '') =>
          `<measure number="${n}">${
            n === 1
              ? `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><words>x</words></direction-type><sound tempo="${qpm}"/></direction>`
              : ''
          }${n === 2 ? '<barline location="left"><repeat direction="forward"/></barline>' : ''}${steps.map(q).join('')}${extra}</measure>`;
        // Bars 1 2 3 with a repeat over bars 2 and 3: heard as 1 2 3 2 3, the second hearing of
        // bar 2 entered by a jump to a bar that does not start at second 0.
        const source = `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P">${bar(1, ['C', 'C', 'C', 'C'])}${bar(2, ['D', 'E', 'F', 'G'])}${bar(3, ['A', 'B', 'A', 'G'], '<barline location="right"><repeat direction="backward"/></barline>')}</part></score-partwise>`;
        const { score } = parseMusicXml(source);
        const perf = performanceOf(score);
        expect(perf.written).toEqual([0, 1, 2, 1, 2]);
        const steps = alongSteps(perf, []);
        const writtenNotes = perf.written.flatMap((w) =>
          score.notes.filter((n) => n.measureIndex === w).sort((a, b) => a.onsetTick - b.onsetTick),
        );
        expect(steps).toHaveLength(writtenNotes.length);
        steps.forEach((step, i) => {
          expect(toWrittenSec(perf, step.perfSec)).toBeCloseTo(writtenNotes[i]!.onsetSec, 9);
          expect([...step.pitches]).toEqual([writtenNotes[i]!.midi]);
        });
      },
    );

    it('leaves the hands out of a repeated bar as it does elsewhere', () => {
      const score = scoreOf([
        { midi: 72, tick: 0 },
        { midi: 48, tick: 0, hand: 'L' },
        { midi: 74, tick: 4 },
      ]);
      score.measures[0]!.form = { repeatEnd: 2 };
      const steps = alongSteps(performanceOf(score), ['R']);
      expect(pitches(steps)).toEqual([[48], [48]]);
      expect(steps.map((s) => s.perfSec)).toEqual([0, 2]);
    });
  });
});

describe('anchorStep', () => {
  const at = (...secs: number[]): AlongStep[] =>
    secs.map((perfSec) => ({ perfSec, pitches: [60] }));
  const steps = at(0.5, 1, 2, 3);

  it("'next' is the first step at or after the position", () => {
    expect(anchorStep(steps, 1, null, 'next')).toBe(1);
    expect(anchorStep(steps, 1 + ALONG_EPS / 10, null, 'next')).toBe(1);
    expect(anchorStep(steps, 1 - ALONG_EPS / 10, null, 'next')).toBe(1);
    expect(anchorStep(steps, 1.2, null, 'next')).toBe(2);
    expect(anchorStep(steps, 0, null, 'next')).toBe(0);
    expect(anchorStep(steps, -4, null, 'next')).toBe(0);
    expect(anchorStep(steps, 3, null, 'next')).toBe(3);
  });

  it("'next' past the last step is the first step", () => {
    expect(anchorStep(steps, 3.5, null, 'next')).toBe(0);
    expect(anchorStep(steps, 1e9, null, 'next')).toBe(0);
  });

  it("'marked' is the last step at or before the position", () => {
    expect(anchorStep(steps, 2, null, 'marked')).toBe(2);
    expect(anchorStep(steps, 2 - ALONG_EPS / 10, null, 'marked')).toBe(2);
    expect(anchorStep(steps, 2.5, null, 'marked')).toBe(2);
    expect(anchorStep(steps, 0.5, null, 'marked')).toBe(0);
    expect(anchorStep(steps, 99, null, 'marked')).toBe(3);
  });

  it("'marked' before the first step is the first step", () => {
    expect(anchorStep(steps, 0.2, null, 'marked')).toBe(0);
    expect(anchorStep(steps, -1, null, 'marked')).toBe(0);
  });

  it('is -1 when there are no steps', () => {
    expect(anchorStep([], 0, null, 'next')).toBe(-1);
    expect(anchorStep([], 0, null, 'marked')).toBe(-1);
    expect(anchorStep([], 0, { from: 0, to: 4 }, 'next')).toBe(-1);
  });

  describe('with a loop', () => {
    // The loop holds the steps at 1 and 2; the step at 3 is where it ends.
    const loop: PerfRange = { from: 1, to: 3 };

    it('keeps a position inside the loop', () => {
      expect(anchorStep(steps, 1, loop, 'next')).toBe(1);
      expect(anchorStep(steps, 1.5, loop, 'next')).toBe(2);
      expect(anchorStep(steps, 2, loop, 'next')).toBe(2);
      expect(anchorStep(steps, 1.5, loop, 'marked')).toBe(1);
      expect(anchorStep(steps, 2.5, loop, 'marked')).toBe(2);
    });

    it('gives the loop first step for a position outside it', () => {
      expect(anchorStep(steps, 0, loop, 'next')).toBe(1);
      expect(anchorStep(steps, 0.5, loop, 'marked')).toBe(1);
      expect(anchorStep(steps, 3, loop, 'next')).toBe(1);
      expect(anchorStep(steps, 3, loop, 'marked')).toBe(1);
      expect(anchorStep(steps, 7, loop, 'next')).toBe(1);
    });

    it('gives the loop first step past its last step', () => {
      expect(anchorStep(steps, 2.5, loop, 'next')).toBe(1);
      expect(anchorStep(steps, 2.999, loop, 'next')).toBe(1);
    });

    it("gives the loop first step for 'marked' before its first step, inside the loop", () => {
      const early: PerfRange = { from: 0.7, to: 3 };
      expect(anchorStep(steps, 0.8, early, 'marked')).toBe(1);
      expect(anchorStep(steps, 0.8, early, 'next')).toBe(1);
    });

    it('is -1 when the loop holds no step', () => {
      expect(anchorStep(steps, 1.2, { from: 1.2, to: 1.8 }, 'next')).toBe(-1);
      expect(anchorStep(steps, 1.5, { from: 1.2, to: 1.8 }, 'marked')).toBe(-1);
      expect(anchorStep(steps, 0, { from: 5, to: 9 }, 'next')).toBe(-1);
    });

    it('counts a step at the loop start in and a step at its end out', () => {
      expect(anchorStep(steps, 5, { from: 0.5, to: 1 }, 'next')).toBe(0);
      expect(anchorStep(steps, 5, { from: 2, to: 3 }, 'next')).toBe(2);
    });
  });
});

describe('keys', () => {
  it('presses a key held and fresh, and a second press refreshes it', () => {
    const one = pressKey(NO_KEYS, 60);
    expect([...one]).toEqual([[60, true]]);
    const spent = spendAll(one);
    expect([...spent]).toEqual([[60, false]]);
    expect([...pressKey(spent, 60)]).toEqual([[60, true]]);
  });

  it('releases a key, and leaves the others', () => {
    const keys = pressKey(pressKey(NO_KEYS, 60), 64);
    expect([...releaseKey(keys, 60)]).toEqual([[64, true]]);
    expect(releaseKey(keys, 62)).toBe(keys);
  });

  it('never changes the map it was given', () => {
    const keys = pressKey(NO_KEYS, 60);
    const before = [...keys];
    pressKey(keys, 62);
    releaseKey(keys, 60);
    spendAll(keys);
    expect([...keys]).toEqual(before);
    expect(NO_KEYS.size).toBe(0);
  });

  it('gives back the same map when nothing changes', () => {
    const fresh = pressKey(NO_KEYS, 60);
    expect(pressKey(fresh, 60)).toBe(fresh);
    expect(spendAll(NO_KEYS)).toBe(NO_KEYS);
    const spent = spendAll(fresh);
    expect(spendAll(spent)).toBe(spent);
  });
});

describe('advance', () => {
  const step = (perfSec: number, ...p: number[]): AlongStep => ({ perfSec, pitches: p });
  const held = (...midis: number[]): Keys => midis.reduce(pressKey, NO_KEYS);
  const state = (keys: Keys): Array<[number, boolean]> => [...keys].sort((a, b) => a[0] - b[0]);
  const twinkle = [step(0, 60), step(1, 60), step(2, 67), step(3, 67), step(4, 69)];

  it('passes a single fresh key and marks it used', () => {
    const r = advance([step(0, 60), step(1, 62)], 0, held(60), null);
    expect(r.move).toEqual({ kind: 'cue', index: 1 });
    expect(r.passed).toBe(1);
    expect(state(r.keys)).toEqual([[60, false]]);
  });

  it('stays on a wrong key and spends nothing', () => {
    const keys = held(61);
    const r = advance([step(0, 60), step(1, 62)], 0, keys, null);
    expect(r.move).toEqual({ kind: 'stay' });
    expect(r.passed).toBe(0);
    expect(r.keys).toBe(keys);
  });

  it('stays with no key held', () => {
    expect(advance([step(0, 60)], 0, NO_KEYS, null).move).toEqual({ kind: 'stay' });
  });

  it('stays on a chord with two of three keys, then the third passes', () => {
    const steps = [step(0, 60, 64, 67), step(1, 72)];
    const two = advance(steps, 0, held(60, 64), null);
    expect(two.move).toEqual({ kind: 'stay' });
    expect(two.passed).toBe(0);
    const three = advance(steps, 0, pressKey(two.keys, 67), null);
    expect(three.move).toEqual({ kind: 'cue', index: 1 });
    expect(three.passed).toBe(1);
    expect(state(three.keys)).toEqual([
      [60, false],
      [64, false],
      [67, false],
    ]);
  });

  it('passes a chord played apart while the keys stay held', () => {
    const steps = [step(0, 60, 64, 67), step(1, 72)];
    let keys = NO_KEYS;
    for (const midi of [60, 64]) {
      keys = pressKey(keys, midi);
      const r = advance(steps, 0, keys, null);
      expect(r.move).toEqual({ kind: 'stay' });
      keys = r.keys;
    }
    keys = pressKey(keys, 67);
    expect(advance(steps, 0, keys, null).move).toEqual({ kind: 'cue', index: 1 });
  });

  it('stays when a chord key was released before the last was down', () => {
    const steps = [step(0, 60, 64), step(1, 72)];
    let keys = held(60);
    keys = advance(steps, 0, keys, null).keys;
    keys = releaseKey(keys, 60);
    keys = pressKey(keys, 64);
    expect(advance(steps, 0, keys, null).move).toEqual({ kind: 'stay' });
    // Pressing the first key again completes it.
    expect(advance(steps, 0, pressKey(keys, 60), null).move).toEqual({ kind: 'cue', index: 1 });
  });

  it('needs a release and a fresh press for a repeated pitch (C C)', () => {
    const first = advance(twinkle, 0, held(60), null);
    expect(first.move).toEqual({ kind: 'cue', index: 1 });
    expect(first.passed).toBe(1);
    // The same C, still held and used, does not pass the second C.
    const again = advance(twinkle, 1, first.keys, null);
    expect(again.move).toEqual({ kind: 'stay' });
    // Released and pressed again, it does.
    const fresh = pressKey(releaseKey(first.keys, 60), 60);
    const second = advance(twinkle, 1, fresh, null);
    expect(second.move).toEqual({ kind: 'cue', index: 2 });
    expect(second.passed).toBe(1);
  });

  it('chains an early press of the next steps into one cue at the end of the chain', () => {
    const r = advance(twinkle, 0, held(60, 67), null);
    // Step 0 passes on C; step 1 (C again) needs a fresh C and stops the chain at step 1.
    expect(r.move).toEqual({ kind: 'cue', index: 1 });
    const steps = [step(0, 60), step(1, 62), step(2, 64), step(3, 65)];
    const chained = advance(steps, 0, held(60, 62, 64), null);
    expect(chained.move).toEqual({ kind: 'cue', index: 3 });
    expect(chained.passed).toBe(3);
    expect(state(chained.keys)).toEqual([
      [60, false],
      [62, false],
      [64, false],
    ]);
  });

  it('chains from a step other than the first', () => {
    const steps = [step(0, 60), step(1, 62), step(2, 64), step(3, 65)];
    const r = advance(steps, 1, held(62, 64), null);
    expect(r.move).toEqual({ kind: 'cue', index: 3 });
    expect(r.passed).toBe(2);
  });

  it('finishes on the last step without a loop', () => {
    const steps = [step(0, 60), step(1, 62)];
    const r = advance(steps, 1, held(62), null);
    expect(r.move).toEqual({ kind: 'finish' });
    expect(r.passed).toBe(1);
    expect(state(r.keys)).toEqual([[62, false]]);
  });

  it('finishes at the end of a chain that runs off the piece', () => {
    const steps = [step(0, 60), step(1, 62), step(2, 64)];
    const r = advance(steps, 0, held(60, 62, 64), null);
    expect(r.move).toEqual({ kind: 'finish' });
    expect(r.passed).toBe(3);
  });

  it('wraps from the last step of a loop to its first', () => {
    const steps = [step(0, 60), step(1, 62), step(2, 64), step(3, 65), step(4, 67)];
    const loop: PerfRange = { from: 2, to: 4 };
    const r = advance(steps, 3, held(65), loop);
    expect(r.move).toEqual({ kind: 'cue', index: 2 });
    expect(r.passed).toBe(1);
    // Inside the loop it moves on as usual.
    expect(advance(steps, 2, held(64), loop).move).toEqual({ kind: 'cue', index: 3 });
  });

  it('never finishes inside a loop, also when the loop ends at the last step', () => {
    const steps = [step(0, 60), step(1, 62)];
    const r = advance(steps, 1, held(62), { from: 0, to: 2 });
    expect(r.move).toEqual({ kind: 'cue', index: 0 });
  });

  it('needs a fresh press every lap of a one-step loop', () => {
    const steps = [step(0, 60), step(1, 62)];
    const loop: PerfRange = { from: 1, to: 2 };
    const lap = advance(steps, 1, held(62), loop);
    expect(lap.move).toEqual({ kind: 'cue', index: 1 });
    expect(lap.passed).toBe(1);
    const stuck = advance(steps, 1, lap.keys, loop);
    expect(stuck.move).toEqual({ kind: 'stay' });
    const next = advance(steps, 1, pressKey(releaseKey(lap.keys, 62), 62), loop);
    expect(next.move).toEqual({ kind: 'cue', index: 1 });
    expect(next.passed).toBe(1);
  });

  it('makes held keys need a fresh press after an external move (spendAll)', () => {
    const steps = [step(0, 60), step(1, 62)];
    const keys = spendAll(held(60));
    expect(advance(steps, 0, keys, null).move).toEqual({ kind: 'stay' });
    expect(advance(steps, 0, pressKey(releaseKey(keys, 60), 60), null).move).toEqual({
      kind: 'cue',
      index: 1,
    });
    // Pressing the held key again, without a release, also refreshes it.
    expect(advance(steps, 0, pressKey(keys, 60), null).move).toEqual({ kind: 'cue', index: 1 });
  });

  it('ignores extra held keys and leaves them as they are', () => {
    const r = advance([step(0, 60), step(1, 62)], 0, held(60, 90, 30), null);
    expect(r.move).toEqual({ kind: 'cue', index: 1 });
    expect(state(r.keys)).toEqual([
      [30, true],
      [60, false],
      [90, true],
    ]);
  });

  it('bounds the chain by the step count', () => {
    // Steps that need nothing always pass: the chain must still end.
    const empty = [step(0), step(1), step(2)];
    const loop: PerfRange = { from: 0, to: 3 };
    const r = advance(empty, 1, NO_KEYS, loop);
    expect(r.passed).toBe(empty.length);
    expect(r.move).toEqual({ kind: 'cue', index: 1 });
    // Without a loop the same steps run off the end.
    const open = advance(empty, 0, NO_KEYS, null);
    expect(open.move).toEqual({ kind: 'finish' });
    expect(open.passed).toBe(empty.length);
  });

  it('stays for an index outside the steps', () => {
    const keys = held(60);
    expect(advance([step(0, 60)], -1, keys, null).move).toEqual({ kind: 'stay' });
    expect(advance([step(0, 60)], 1, keys, null).move).toEqual({ kind: 'stay' });
    expect(advance([], 0, keys, null).move).toEqual({ kind: 'stay' });
  });

  it('never changes the map it was given', () => {
    const keys = held(60, 62);
    const before = state(keys);
    advance([step(0, 60), step(1, 62), step(2, 64)], 0, keys, null);
    expect(state(keys)).toEqual(before);
  });

  it('treats a loop that holds no step as no loop', () => {
    const steps = [step(0, 60), step(1, 62)];
    const r = advance(steps, 1, held(62), { from: 5, to: 9 });
    expect(r.move).toEqual({ kind: 'finish' });
  });

  describe('last, the step passed last (issue 184)', () => {
    const steps = [step(0, 60), step(1, 62), step(2, 64), step(3, 65), step(4, 67)];

    it('is the step a single pass left', () => {
      expect(advance(steps, 0, held(60), null).last).toBe(0);
      expect(advance(steps, 2, held(64), null).last).toBe(2);
    });

    it('is the end of a chain, not its start', () => {
      const r = advance(steps, 0, held(60, 62, 64), null);
      expect(r.passed).toBe(3);
      expect(r.move).toEqual({ kind: 'cue', index: 3 });
      expect(r.last).toBe(2);
      const from = advance(steps, 1, held(62, 64), null);
      expect(from.passed).toBe(2);
      expect(from.last).toBe(2);
    });

    it('is the final step on finish', () => {
      const r = advance(steps, 4, held(67), null);
      expect(r.move).toEqual({ kind: 'finish' });
      expect(r.last).toBe(4);
      const chain = advance(steps, 3, held(65, 67), null);
      expect(chain.move).toEqual({ kind: 'finish' });
      expect(chain.last).toBe(4);
    });

    it("is the loop's last step when the pass wraps", () => {
      const loop: PerfRange = { from: 2, to: 4 };
      const r = advance(steps, 3, held(65), loop);
      expect(r.move).toEqual({ kind: 'cue', index: 2 });
      expect(r.last).toBe(3);
      // A one-step loop wraps onto itself.
      const lap = advance([step(0, 60), step(1, 62)], 1, held(62), { from: 1, to: 2 });
      expect(lap.move).toEqual({ kind: 'cue', index: 1 });
      expect(lap.last).toBe(1);
    });

    it('is the step before the wrap when a chain ends just after one', () => {
      const loop: PerfRange = { from: 2, to: 4 };
      // Passes step 3 (the loop's last), wraps to step 2, passes it: lands on step 3.
      const r = advance(steps, 3, held(65, 64), loop);
      expect(r.passed).toBe(2);
      expect(r.move).toEqual({ kind: 'cue', index: 3 });
      expect(r.last).toBe(2);
    });

    it('is -1 on stay', () => {
      expect(advance(steps, 0, NO_KEYS, null).last).toBe(-1);
      expect(advance(steps, 0, held(61), null).last).toBe(-1);
      expect(advance(steps, -1, held(60), null).last).toBe(-1);
      expect(advance(steps, 9, held(60), null).last).toBe(-1);
      expect(advance([], 0, held(60), null).last).toBe(-1);
    });
  });

  it('is the untimed settle: times of zero, no presses, the clock at infinity (issue 185)', () => {
    const zero: StepTime = { shortestSec: 0, lengthSec: [], beats: [] };
    const steps = [step(0, 60), step(1, 62), step(2, 64), step(3, 65), step(4, 67)];
    const loop: PerfRange = { from: 2, to: 4 };
    const cases: Array<[number, Keys, PerfRange | null]> = [
      [0, held(60), null],
      [0, held(60, 62, 64), null],
      [1, held(62, 64), null],
      [4, held(67), null],
      [4, held(67), { from: 0, to: 5 }],
      [3, held(65), loop],
      [2, held(64, 65), loop],
      [0, held(61), null],
      [0, NO_KEYS, null],
      [0, spendAll(held(60)), null],
      [9, held(60), null],
      [-1, held(60), null],
    ];
    for (const [index, keys, range] of cases) {
      const plain = advance(steps, index, keys, range);
      const timed = settle({
        steps,
        times: steps.map(() => zero),
        index,
        keys,
        presses: NO_PRESSES,
        loop: range,
        nowMs: Infinity,
        factor: 1,
      });
      expect(timed.keys).toEqual(plain.keys);
      expect(timed.move).toEqual(plain.move);
      expect(timed.passed).toBe(plain.passed);
    }
  });
});

describe('presses', () => {
  it('records when a key went down, and forgets it when it comes up', () => {
    const one = pressAt(NO_PRESSES, 60, 120);
    expect([...one]).toEqual([[60, 120]]);
    const two = pressAt(one, 64, 300);
    expect([...two]).toEqual([
      [60, 120],
      [64, 300],
    ]);
    expect([...liftAt(two, 60)]).toEqual([[64, 300]]);
  });

  it('takes the newer time when a key goes down again', () => {
    expect([...pressAt(pressAt(NO_PRESSES, 60, 120), 60, 800)]).toEqual([[60, 800]]);
  });

  it('gives back the same map when nothing changes', () => {
    const one = pressAt(NO_PRESSES, 60, 120);
    expect(pressAt(one, 60, 120)).toBe(one);
    expect(liftAt(one, 62)).toBe(one);
  });

  it('never changes the map it was given', () => {
    const one = pressAt(NO_PRESSES, 60, 120);
    pressAt(one, 64, 5);
    pressAt(one, 60, 9);
    liftAt(one, 60);
    expect([...one]).toEqual([[60, 120]]);
    expect(NO_PRESSES.size).toBe(0);
  });
});

describe('stepAfter', () => {
  const at = (...secs: number[]): AlongStep[] =>
    secs.map((perfSec) => ({ perfSec, pitches: [60] }));
  const steps = at(0, 1, 2, 3, 4);

  it('is the next step, and -1 after the last', () => {
    expect(stepAfter(steps, 0, null)).toBe(1);
    expect(stepAfter(steps, 3, null)).toBe(4);
    expect(stepAfter(steps, 4, null)).toBe(-1);
  });

  it('wraps from the last step of a loop to its first', () => {
    const loop: PerfRange = { from: 1, to: 3 };
    expect(stepAfter(steps, 1, loop)).toBe(2);
    expect(stepAfter(steps, 2, loop)).toBe(1);
    // A loop that ends at the last step never finishes.
    expect(stepAfter(steps, 4, { from: 3, to: 5 })).toBe(3);
  });

  it('treats a loop that holds no step as no loop', () => {
    expect(stepAfter(steps, 4, { from: 7, to: 9 })).toBe(-1);
    expect(stepAfter(steps, 1, { from: 7, to: 9 })).toBe(2);
  });

  it('is -1 for an index outside the steps', () => {
    expect(stepAfter(steps, -1, null)).toBe(-1);
    expect(stepAfter(steps, 5, null)).toBe(-1);
    expect(stepAfter([], 0, null)).toBe(-1);
  });
});

/** The plan of a hand-built score (divisions 1, 120 qpm): a quarter note is 0.5 s. */
const planOf = (specs: NoteSpec[], muted: Hand[] = []) =>
  alongPlan(performanceOf(scoreOf(specs)), muted);
type Plan = ReturnType<typeof planOf>;
const holdsOf = (plan: Plan, loop: PerfRange | null = null): number[] =>
  plan.steps.map((_, i) => holdSec(plan.steps, plan.times, i, loop));

describe('alongPlan', () => {
  const trill: NonNullable<Note['ornament']> = {
    kind: 'trill-mark',
    long: false,
    upperMidi: 62,
    lowerMidi: 59,
    startNote: 'upper',
    endTick: 4,
    endSec: 2,
  };
  const repeated = (): Score => {
    const score = scoreOf(
      [
        { midi: 60, tick: 0 },
        { midi: 62, tick: 2, ticks: 4 },
        { midi: 64, tick: 4 },
      ],
      2,
    );
    score.measures[0]!.form = { repeatEnd: 2 };
    return score;
  };
  const scenarios: Array<[string, () => Score, Hand[]]> = [
    [
      'a chord, a held bass and a rest',
      () =>
        scoreOf([
          { midi: 67, tick: 0 },
          { midi: 60, tick: 0 },
          { midi: 48, tick: 0, hand: 'L', ticks: 4 },
          { midi: 65, tick: 3 },
        ]),
      [],
    ],
    [
      'a muted hand',
      () =>
        scoreOf([
          { midi: 72, tick: 0 },
          { midi: 48, tick: 0, hand: 'L' },
          { midi: 74, tick: 1 },
        ]),
      ['R'],
    ],
    [
      'a grace note, a trill and a tie',
      () =>
        scoreOf([
          { midi: 59, tick: 0, grace: true },
          { midi: 60, tick: 0, ticks: 4, ornament: trill },
          { midi: 62, tick: 4, ticks: 8, sourceIndices: [7, 8] },
        ]),
      [],
    ],
    ['a repeat', repeated, []],
    ['a repeat with a hand muted', repeated, ['L']],
    ['voltas', () => parseMusicXml(form('form-voltas')).score, []],
    ['a D.C. al Fine', () => parseMusicXml(form('form-dc-al-fine')).score, []],
    ['no notes', () => scoreOf([]), []],
  ];

  it.each(scenarios)('gives the steps of alongSteps, one time each: %s', (_name, build, muted) => {
    const perf = performanceOf(build());
    const plan = alongPlan(perf, muted);
    expect(plan.steps).toEqual(alongSteps(perf, muted));
    expect(plan.times).toHaveLength(plan.steps.length);
    plan.times.forEach((t, i) => {
      expect(t.lengthSec).toHaveLength(plan.steps[i]!.pitches.length);
      expect(t.beats).toHaveLength(plan.steps[i]!.pitches.length);
    });
  });

  it('gives each pitch the length of its note, and the step the shortest', () => {
    const plan = planOf([
      { midi: 48, tick: 0, hand: 'L', ticks: 4 },
      { midi: 60, tick: 0 },
      { midi: 64, tick: 0, ticks: 2 },
      { midi: 62, tick: 2 },
    ]);
    expect(plan.steps[0]!.pitches).toEqual([48, 60, 64]);
    expect(plan.times[0]).toEqual({ shortestSec: 0.5, lengthSec: [2, 0.5, 1], beats: [4, 1, 2] });
    expect(plan.times[1]).toEqual({ shortestSec: 0.5, lengthSec: [0.5], beats: [1] });
  });

  it('counts a tie inside one run whole', () => {
    // The tie is one engine note of two quarters, then the next step a half and a quarter in.
    const plan = planOf([
      { midi: 60, tick: 0, ticks: 2, sourceIndices: [0, 1] },
      { midi: 62, tick: 3 },
    ]);
    expect(plan.times[0]).toEqual({ shortestSec: 1, lengthSec: [1], beats: [2] });
    expect(holdsOf(plan)[0]).toBe(1);
  });

  it('makes a unison of two voices one pitch: the longer length, the shorter shortest', () => {
    const plan = planOf([
      { midi: 60, tick: 0 },
      { midi: 60, tick: 0, hand: 'L', ticks: 2 },
      { midi: 64, tick: 2 },
    ]);
    expect(plan.steps[0]!.pitches).toEqual([60]);
    expect(plan.times[0]).toEqual({ shortestSec: 0.5, lengthSec: [1], beats: [2] });
  });

  it('gives the upper pitch of an upper-start trill the length of the principal note', () => {
    const plan = planOf([
      { midi: 60, tick: 0, ticks: 4, ornament: trill },
      { midi: 65, tick: 4 },
    ]);
    expect(plan.steps[0]!.pitches).toEqual([62]);
    expect(plan.times[0]).toEqual({ shortestSec: 2, lengthSec: [2], beats: [4] });
  });

  it('leaves grace notes out of the shortest', () => {
    const plan = planOf([
      { midi: 59, tick: 0, grace: true },
      { midi: 60, tick: 0 },
      { midi: 62, tick: 1 },
    ]);
    expect(plan.times[0]).toEqual({ shortestSec: 0.5, lengthSec: [0.5], beats: [1] });
  });

  it('leaves the hands left out out of the times', () => {
    const specs: NoteSpec[] = [
      { midi: 72, tick: 0 },
      { midi: 48, tick: 0, hand: 'L', ticks: 2 },
      { midi: 74, tick: 2 },
    ];
    // The quarter of the right hand is not played: the step is the left half note alone.
    const right = planOf(specs, ['R']);
    expect(right.steps.map((s) => [...s.pitches])).toEqual([[48]]);
    expect(right.times).toEqual([{ shortestSec: 1, lengthSec: [1], beats: [2] }]);
    expect(holdsOf(right)).toEqual([1]);
    const left = planOf(specs, ['L']);
    expect(left.times[0]).toEqual({ shortestSec: 0.5, lengthSec: [0.5], beats: [1] });
  });

  it('counts the beats of the time signature: a half in 4/4, a dotted quarter in 6/8', () => {
    expect(planOf([{ midi: 60, tick: 0, ticks: 2 }]).times[0]!.beats).toEqual([2]);
    // Divisions 2 and 6/8: the beat is an eighth, one tick; a dotted quarter is three of them.
    const sixEight: Score = {
      ...scoreOf(
        [
          { midi: 60, tick: 0, ticks: 3 },
          { midi: 62, tick: 3, ticks: 3 },
        ],
        1,
      ),
      divisions: 2,
      timeSignatures: [{ tick: 0, beats: 6, beatType: 8 }],
    };
    expect(alongPlan(performanceOf(sixEight), []).times.map((t) => t.beats)).toEqual([[3], [3]]);
  });

  it('counts the beats of the signature in force at the step', () => {
    const changing: Score = {
      ...scoreOf(
        [
          { midi: 60, tick: 0, ticks: 4 },
          { midi: 62, tick: 8, ticks: 3 },
        ],
        4,
      ),
      divisions: 2,
      timeSignatures: [
        { tick: 0, beats: 4, beatType: 4 },
        { tick: 8, beats: 6, beatType: 8 },
      ],
    };
    expect(alongPlan(performanceOf(changing), []).times.map((t) => t.beats)).toEqual([[2], [3]]);
  });

  it('is counted in the order heard: a note running past a repeat end is cut there', () => {
    // Heard bar 1 bar 1 bar 2. The long note of the first hearing runs into the repeat and is
    // cut at its run's end (1 s of it); the second hearing runs on into bar 2 whole (2 s).
    const plan = alongPlan(performanceOf(repeated()), []);
    expect(plan.steps.map((s) => s.perfSec)).toEqual([0, 1, 2, 3, 4]);
    expect(plan.times.map((t) => t.lengthSec)).toEqual([[0.5], [1], [0.5], [2], [0.5]]);
    // The hold of the first hearing's last step is its shortest note (1 s), the gap to the
    // repeated bar's first step being just as long; the second hearing's is held to the next bar.
    expect(holdsOf(plan)).toEqual([0.5, 1, 0.5, 1, 0.5]);
  });

  describe('alongPlanNotes, the notes of each step (issue 192)', () => {
    const unison = (): Score =>
      scoreOf([
        { midi: 60, tick: 0 },
        { midi: 60, tick: 0, hand: 'L' },
        { midi: 64, tick: 1 },
        { midi: 64, tick: 1 },
      ]);
    const all: Array<[string, () => Score, Hand[]]> = [
      ...scenarios,
      ['a unison of both hands and of two voices', unison, []],
      ['a unison with a hand muted', unison, ['R']],
    ];

    it.each(all)('gives exactly the steps and times of alongPlan: %s', (_name, build, muted) => {
      const perf = performanceOf(build());
      const plan = alongPlan(perf, muted);
      const withNotes = alongPlanNotes(perf, muted);
      expect(withNotes.steps).toEqual(plan.steps);
      expect(withNotes.times).toEqual(plan.times);
      expect(withNotes.notes).toHaveLength(plan.steps.length);
      expect(Object.keys(plan).sort()).toEqual(['steps', 'times']);
    });

    it.each(all)(
      'splits each step into its hands, whose pitches make up the step: %s',
      (_name, build, muted) => {
        const perf = performanceOf(build());
        const { steps, notes } = alongPlanNotes(perf, muted);
        notes.forEach((n, i) => {
          expect(n.parts.length).toBeGreaterThan(0);
          expect(n.parts.map((p) => p.hand)).toEqual(
            (['L', 'R'] as const).filter((h) => n.parts.some((p) => p.hand === h)),
          );
          for (const p of n.parts) {
            expect(muted).not.toContain(p.hand);
            expect([...p.pitches]).toEqual([...new Set(p.pitches)].sort((a, b) => a - b));
          }
          const union = [...new Set(n.parts.flatMap((p) => p.pitches))].sort((a, b) => a - b);
          expect(union).toEqual([...steps[i]!.pitches]);
        });
      },
    );

    it('lists the non-grace notes of each hand at the tick, in score order', () => {
      const score = scoreOf([
        { midi: 59, tick: 0, grace: true },
        { midi: 64, tick: 0 },
        { midi: 60, tick: 0 },
        { midi: 48, tick: 0, hand: 'L', ticks: 2 },
        { midi: 62, tick: 1 },
        { midi: 62, tick: 1 },
        { midi: 55, tick: 2, hand: 'L' },
        { midi: 60, tick: 3 },
        { midi: 60, tick: 3, hand: 'L' },
      ]);
      const id = score.notes.map((n) => n.id);
      const parts = (muted: Hand[]) =>
        alongPlanNotes(performanceOf(score), muted).notes.map((n) =>
          n.parts.map((p) => ({ hand: p.hand, ids: [...p.ids], pitches: [...p.pitches] })),
        );
      expect(parts([])).toEqual([
        [
          { hand: 'L', ids: [id[3]], pitches: [48] },
          { hand: 'R', ids: [id[1], id[2]], pitches: [60, 64] },
        ],
        // Both voices of a unison in one hand: one pitch, both notes.
        [{ hand: 'R', ids: [id[4], id[5]], pitches: [62] }],
        [{ hand: 'L', ids: [id[6]], pitches: [55] }],
        // A unison across the hands: a part in each.
        [
          { hand: 'L', ids: [id[8]], pitches: [60] },
          { hand: 'R', ids: [id[7]], pitches: [60] },
        ],
      ]);
      // A muted hand has no part, and a step only in that hand is gone.
      expect(parts(['L'])).toEqual([
        [{ hand: 'R', ids: [id[1], id[2]], pitches: [60, 64] }],
        [{ hand: 'R', ids: [id[4], id[5]], pitches: [62] }],
        [{ hand: 'R', ids: [id[7]], pitches: [60] }],
      ]);
    });

    it('asks a part for the pitch the keyboard shows: the upper start of a trill', () => {
      const score = scoreOf([
        { midi: 60, tick: 0, ticks: 4, ornament: trill },
        { midi: 65, tick: 4 },
      ]);
      const { notes } = alongPlanNotes(performanceOf(score), []);
      expect(notes[0]!.parts).toEqual([{ hand: 'R', ids: [score.notes[0]!.id], pitches: [62] }]);
    });

    it('gives the performance ids of a repeated bar, one per hearing', () => {
      const perf = performanceOf(repeated());
      const { notes } = alongPlanNotes(perf, []);
      const ids = notes.flatMap((n) => n.parts.flatMap((p) => [...p.ids]));
      expect(ids).toEqual(
        [...perf.score.notes].sort((a, b) => a.onsetTick - b.onsetTick).map((n) => n.id),
      );
      expect(ids.every((id) => /@\d+$/.test(id))).toBe(true);
    });

    /** The tick of each step, read from its first note in the performance. */
    const ticksOf = (perf: ReturnType<typeof performanceOf>, notes: StepNotes[]): number[] =>
      notes.map((n) => perf.score.notes.find((x) => x.id === n.parts[0]!.ids[0])!.onsetTick);

    /** What the beat and the bar should be at each step, from the beat and tempo helpers. */
    const expectBeatsAndBars = (score: Score): StepNotes[] => {
      const perf = performanceOf(score);
      const { notes } = alongPlanNotes(perf, []);
      const { tempoMap, divisions, measures } = perf.score;
      const sec = (tick: number) => ticksToSeconds(tempoMap, divisions, tick);
      ticksOf(perf, notes).forEach((tick, i) => {
        const beatTicks = beatTicksAt(perf.score, tick);
        const m = measures.find((x) => x.startTick <= tick && tick < x.startTick + x.lengthTicks)!;
        expect(notes[i]!.beatSec).toBeCloseTo(sec(tick + beatTicks) - sec(tick), 9);
        expect(notes[i]!.barSec).toBeCloseTo(
          sec(m.startTick + m.lengthTicks) - sec(m.startTick),
          9,
        );
      });
      return notes;
    };

    it('gives the beat and the bar at each step in 3/4, with a one-beat pickup', () => {
      const notes = expectBeatsAndBars(parseMusicXml(fixture('pickup-piano')).score);
      // The pickup's bar is its one beat; the full bars are three.
      expect(notes[0]!.barSec).toBeCloseTo(notes[0]!.beatSec, 9);
      expect(notes[notes.length - 1]!.barSec).toBeCloseTo(3 * notes[notes.length - 1]!.beatSec, 9);
    });

    it('gives the beat and the bar at each step in 4/4', () => {
      const notes = expectBeatsAndBars(parseMusicXml(fixture('short-piano')).score);
      for (const n of notes) expect(n.barSec).toBeCloseTo(4 * n.beatSec, 9);
    });

    it('gives an eighth for the beat in 6/8, as the metronome counts', () => {
      const sixEight: Score = {
        ...scoreOf(
          [
            { midi: 60, tick: 0, ticks: 3 },
            { midi: 62, tick: 3, ticks: 3 },
          ],
          1,
        ),
        divisions: 2,
        measures: [{ index: 0, startTick: 0, lengthTicks: 6, number: '1' }],
        timeSignatures: [{ tick: 0, beats: 6, beatType: 8 }],
      };
      const notes = expectBeatsAndBars(sixEight);
      expect(notes).toHaveLength(2);
      for (const n of notes) expect(n.barSec).toBeCloseTo(6 * n.beatSec, 9);
    });

    it('takes the tempo in force at the step', () => {
      const changing: Score = {
        ...scoreOf([
          { midi: 60, tick: 0 },
          { midi: 62, tick: 4 },
          { midi: 64, tick: 6 },
        ]),
        tempoMap: [
          { tick: 0, qpm: 120 },
          { tick: 4, qpm: 60 },
          { tick: 6, qpm: 90 },
        ],
      };
      const notes = expectBeatsAndBars(changing);
      // Half the tempo, twice the beat; the second bar holds two tempos.
      expect(notes[1]!.beatSec).toBeCloseTo(2 * notes[0]!.beatSec, 9);
      expect(notes[2]!.beatSec).toBeCloseTo((notes[1]!.beatSec * 60) / 90, 9);
      expect(notes[2]!.barSec).toBe(notes[1]!.barSec);
    });
  });
});

describe('the hold of a step', () => {
  it('is the gap to the next step: quarters hold a quarter', () => {
    const plan = planOf([0, 1, 2, 3].map((tick) => ({ midi: 60 + tick, tick })));
    expect(holdsOf(plan)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('is never longer than the gap, nor than the shortest note', () => {
    const plan = planOf([
      { midi: 60, tick: 0, ticks: 2 },
      { midi: 62, tick: 1 },
      { midi: 64, tick: 3 },
    ]);
    // The half note is cut by the quarter that follows; the quarter, by its own length.
    expect(holdsOf(plan)).toEqual([0.5, 0.5, 0.5]);
  });

  it('is capped at the shortest note: a whole-note bass under a quarter holds a quarter', () => {
    const plan = planOf([
      { midi: 48, tick: 0, hand: 'L', ticks: 4 },
      { midi: 60, tick: 0 },
      { midi: 62, tick: 2 },
    ]);
    expect(holdsOf(plan)[0]).toBe(0.5);
  });

  it('does not wait out a rest: a quarter and a quarter rest hold a quarter, not a half', () => {
    const plan = planOf([
      { midi: 60, tick: 0 },
      { midi: 62, tick: 2 },
    ]);
    expect(holdsOf(plan)).toEqual([0.5, 0.5]);
  });

  it('is, for the last step of the piece, its shortest note', () => {
    expect(holdsOf(planOf([{ midi: 60, tick: 0, ticks: 2 }]))).toEqual([1]);
    const plan = planOf([
      { midi: 60, tick: 0 },
      { midi: 62, tick: 1, ticks: 2 },
      { midi: 48, tick: 1, hand: 'L', ticks: 4 },
    ]);
    expect(holdsOf(plan)).toEqual([0.5, 1]);
  });

  it('is never below 0: a note of no length holds nothing', () => {
    const plan = planOf([
      { midi: 60, tick: 0, ticks: 0 },
      { midi: 62, tick: 1 },
    ]);
    expect(holdsOf(plan)).toEqual([0, 0.5]);
  });

  describe('in a loop', () => {
    it('ends the loop last step at the loop end when its note runs to it', () => {
      // Steps at 0, 0.5, 1 (a half note) and 2.
      const plan = planOf([
        { midi: 60, tick: 0 },
        { midi: 62, tick: 1 },
        { midi: 64, tick: 2, ticks: 2 },
        { midi: 65, tick: 4 },
      ]);
      expect(holdsOf(plan)).toEqual([0.5, 0.5, 1, 0.5]);
      // The loop ends at 1.5: the half note sounds half a second before Play would loop back.
      expect(holdsOf(plan, { from: 0, to: 1.5 })).toEqual([0.5, 0.5, 0.5, 0.5]);
    });

    it('does not wait out a rest before the loop end', () => {
      const plan = planOf([
        { midi: 60, tick: 0 },
        { midi: 62, tick: 1 },
        { midi: 64, tick: 2 },
      ]);
      // The last step sounds a quarter, then the loop has a second of rest left.
      expect(holdsOf(plan, { from: 0, to: 2 })).toEqual([0.5, 0.5, 0.5]);
    });

    it('treats a loop that holds no step as no loop', () => {
      const plan = planOf([
        { midi: 60, tick: 0 },
        { midi: 62, tick: 1, ticks: 2 },
      ]);
      expect(holdsOf(plan, { from: 5, to: 9 })).toEqual(holdsOf(plan));
    });
  });
});

describe('settle', () => {
  const quarters = (...midis: number[]): Plan =>
    planOf(midis.map((midi, tick) => ({ midi, tick })));
  /** The keys held, each with the time (performance.now ms) it went down. */
  const down = (...pressed: Array<[number, number]>): { keys: Keys; presses: Presses } => ({
    keys: pressed.reduce((keys, [midi]) => pressKey(keys, midi), NO_KEYS),
    presses: pressed.reduce((times, [midi, ms]) => pressAt(times, midi, ms), NO_PRESSES),
  });
  const settleAt = (
    plan: Plan,
    held: { keys: Keys; presses: Presses },
    nowMs: number,
    o: { index?: number; loop?: PerfRange | null; factor?: number; releasing?: number } = {},
  ): Settled =>
    settle({
      steps: plan.steps,
      times: plan.times,
      index: o.index ?? 0,
      keys: held.keys,
      presses: held.presses,
      loop: o.loop ?? null,
      nowMs,
      factor: o.factor ?? 1,
      ...(o.releasing === undefined ? {} : { releasing: o.releasing }),
    });
  const state = (keys: Keys): Array<[number, boolean]> => [...keys].sort((a, b) => a[0] - b[0]);
  // Every step below holds 500 ms at 120 qpm and factor 1.

  describe('passedSteps', () => {
    it('names the steps of the chain, in order', () => {
      const plan = quarters(60, 62, 64, 65);
      const r = settleAt(plan, down([60, 0], [62, 0], [64, 0]), 500);
      expect(r.passed).toBe(3);
      expect(r.passedSteps).toEqual([0, 1, 2]);
      expect(r.at).toBe(3);
    });

    it('is empty when nothing passes, and names the last step on a finish', () => {
      const plan = quarters(60, 62);
      expect(settleAt(plan, down([60, 0]), 499).passedSteps).toEqual([]);
      const done = settleAt(plan, down([62, 0]), 500, { index: 1 });
      expect(done.move).toEqual({ kind: 'finish' });
      expect(done.passedSteps).toEqual([1]);
    });

    it('names the step passed at a release', () => {
      const plan = quarters(60, 62);
      expect(settleAt(plan, down([60, 0]), 400, { releasing: 60 }).passedSteps).toEqual([0]);
    });
  });

  describe('last, the step passed last (issue 184)', () => {
    it('is the end of the chain, and -1 when nothing passes', () => {
      const plan = quarters(60, 62, 64, 65);
      expect(settleAt(plan, down([60, 0], [62, 0], [64, 0]), 500).last).toBe(2);
      expect(settleAt(plan, down([60, 0]), 499).last).toBe(-1);
      expect(settleAt(plan, down([60, 0]), 500).last).toBe(0);
    });

    it('is the final step on a finish, and the step passed at a release', () => {
      const plan = quarters(60, 62);
      expect(settleAt(plan, down([62, 0]), 500, { index: 1 }).last).toBe(1);
      expect(settleAt(plan, down([60, 0]), 400, { releasing: 60 }).last).toBe(0);
    });

    it('is the same as advance gives with no hold', () => {
      const plan = quarters(60, 62, 64);
      const keys = pressKey(pressKey(NO_KEYS, 60), 62);
      const untimed = advance(plan.steps, 0, keys, null);
      const timed = settleAt(plan, { keys, presses: NO_PRESSES }, 0);
      expect(timed.last).toBe(untimed.last);
    });
  });

  describe('runSince', () => {
    const chord: AlongStep = { perfSec: 0, pitches: [60, 64] };

    it('is the latest press among the keys of the step', () => {
      const a = down([60, 100], [64, 250]);
      expect(runSince(chord, a.keys, a.presses)).toBe(250);
      const b = down([64, 100], [60, 250]);
      expect(runSince(chord, b.keys, b.presses)).toBe(250);
    });

    it('is null while a key is missing or spent', () => {
      const one = down([60, 100]);
      expect(runSince(chord, one.keys, one.presses)).toBeNull();
      const both = down([60, 100], [64, 250]);
      expect(runSince(chord, spendAll(both.keys), both.presses)).toBeNull();
    });

    it('ignores the keys the step does not ask for', () => {
      const a = down([60, 100], [64, 250], [90, 900]);
      expect(runSince(chord, a.keys, a.presses)).toBe(250);
    });

    it('counts a key with no press time as held since forever, and an empty step too', () => {
      expect(runSince(chord, pressKey(pressKey(NO_KEYS, 60), 64), NO_PRESSES)).toBe(-Infinity);
      expect(runSince({ perfSec: 0, pitches: [] }, NO_KEYS, NO_PRESSES)).toBe(-Infinity);
    });
  });

  it('does not pass before the hold, and passes at it', () => {
    const plan = quarters(60, 62);
    const held = down([60, 100]);
    const early = settleAt(plan, held, 599);
    expect(early.move).toEqual({ kind: 'stay' });
    expect(early.passed).toBe(0);
    expect(early.early).toBe(false);
    expect(early.at).toBe(0);
    expect(early.keys).toBe(held.keys);
    const due = settleAt(plan, held, 600);
    expect(due.move).toEqual({ kind: 'cue', index: 1 });
    expect(due.passed).toBe(1);
    expect(due.at).toBe(1);
    expect(state(due.keys)).toEqual([[60, false]]);
    // The slack of a millionth of a millisecond covers the float sum.
    expect(settleAt(plan, held, 600 - 1e-7).passed).toBe(1);
  });

  it('is due at the run start plus the hold, and not due while the step does not run', () => {
    const plan = planOf([
      { midi: 60, tick: 0 },
      { midi: 64, tick: 0 },
      { midi: 67, tick: 1 },
    ]);
    const half = settleAt(plan, down([60, 0]), 100);
    expect(half.wakeAtMs).toBeNull();
    expect(half.run).toBeNull();
    const whole = settleAt(plan, down([60, 0], [64, 50]), 100);
    expect(whole.run).toEqual({ index: 0, sinceMs: 50 });
    expect(whole.wakeAtMs).toBe(550);
    expect(whole.move).toEqual({ kind: 'stay' });
  });

  it('scales the hold by the tempo factor: due at 2, 1 and 2/3 of it at 0.5, 1 and 1.5', () => {
    const plan = quarters(60, 62);
    const wake = (factor: number): number | null =>
      settleAt(plan, down([60, 100]), 100, { factor }).wakeAtMs;
    expect(wake(0.5)).toBeCloseTo(100 + 1000, 9);
    expect(wake(1)).toBeCloseTo(100 + 500, 9);
    expect(wake(1.5)).toBeCloseTo(100 + 500 / 1.5, 9);
    // And the pass comes there: 1000 ms at half speed, 333 ms at one and a half.
    expect(settleAt(plan, down([60, 100]), 1099, { factor: 0.5 }).passed).toBe(0);
    expect(settleAt(plan, down([60, 100]), 1100, { factor: 0.5 }).passed).toBe(1);
    expect(settleAt(plan, down([60, 100]), 100 + 330, { factor: 1.5 }).passed).toBe(0);
    expect(settleAt(plan, down([60, 100]), 100 + 334, { factor: 1.5 }).passed).toBe(1);
  });

  it('passes a release after 4/5 of the hold at the release, taking the key away', () => {
    expect(HOLD_TOLERANCE * 500).toBe(400);
    const plan = quarters(60, 62);
    const r = settleAt(plan, down([60, 0]), 400, { releasing: 60 });
    expect(r.move).toEqual({ kind: 'cue', index: 1 });
    expect(r.passed).toBe(1);
    expect(r.early).toBe(false);
    expect(r.keys.has(60)).toBe(false);
    expect(r.presses.has(60)).toBe(false);
  });

  it('leaves the red for a release before 4/5 of the hold, and the other keys fresh', () => {
    const plan = planOf([
      { midi: 60, tick: 0 },
      { midi: 64, tick: 0 },
      { midi: 67, tick: 1 },
    ]);
    const r = settleAt(plan, down([60, 0], [64, 0]), 399, { releasing: 64 });
    expect(r.move).toEqual({ kind: 'stay' });
    expect(r.passed).toBe(0);
    expect(r.early).toBe(true);
    expect(r.at).toBe(0);
    expect(state(r.keys)).toEqual([[60, true]]);
    expect([...r.presses]).toEqual([[60, 0]]);
    expect(r.run).toBeNull();
    expect(r.wakeAtMs).toBeNull();
  });

  it('runs again from a re-press after an early release', () => {
    const plan = planOf([
      { midi: 60, tick: 0 },
      { midi: 64, tick: 0 },
      { midi: 67, tick: 1 },
    ]);
    const released = settleAt(plan, down([60, 0], [64, 0]), 300, { releasing: 64 });
    expect(released.early).toBe(true);
    const again = {
      keys: pressKey(released.keys, 64),
      presses: pressAt(released.presses, 64, 1000),
    };
    const r = settleAt(plan, again, 1000);
    expect(r.run).toEqual({ index: 0, sinceMs: 1000 });
    expect(r.wakeAtMs).toBe(1500);
    expect(settleAt(plan, again, 1499).passed).toBe(0);
    expect(settleAt(plan, again, 1500).passed).toBe(1);
  });

  it('counts an early press for the next step from its own press', () => {
    const plan = quarters(60, 62, 64);
    const held = down([60, 0], [62, 200]);
    const first = settleAt(plan, held, 500);
    expect(first.passed).toBe(1);
    expect(first.move).toEqual({ kind: 'cue', index: 1 });
    expect(first.run).toEqual({ index: 1, sinceMs: 200 });
    expect(first.wakeAtMs).toBe(700);
    const next = { keys: first.keys, presses: first.presses };
    expect(settleAt(plan, next, 699, { index: 1 }).passed).toBe(0);
    const second = settleAt(plan, next, 700, { index: 1 });
    expect(second.passed).toBe(1);
    expect(second.move).toEqual({ kind: 'cue', index: 2 });
  });

  it('chains the steps whose time is up, as a timer that fires late would find them', () => {
    const plan = quarters(60, 62, 64);
    const held = down([60, 0], [62, 600], [64, 1200]);
    const late = settleAt(plan, held, 1600);
    expect(late.passed).toBe(2);
    expect(late.move).toEqual({ kind: 'cue', index: 2 });
    expect(late.at).toBe(2);
    expect(late.run).toEqual({ index: 2, sinceMs: 1200 });
    expect(late.wakeAtMs).toBe(1700);
    const due = settleAt(plan, held, 1700);
    expect(due.passed).toBe(3);
    expect(due.move).toEqual({ kind: 'finish' });
    expect(due.at).toBe(-1);
    expect(due.wakeAtMs).toBeNull();
    expect(due.run).toBeNull();
  });

  it('takes a release that is neither a pass nor early when the key is not of the running step', () => {
    const plan = quarters(60, 62);
    const r = settleAt(plan, down([60, 0], [90, 0]), 100, { releasing: 90 });
    expect(r.passed).toBe(0);
    expect(r.early).toBe(false);
    expect(state(r.keys)).toEqual([[60, true]]);
    expect(r.presses.has(90)).toBe(false);
    // An early press for the next step, let go while the red's step is not yet due, is no different.
    const next = settleAt(quarters(60, 62, 64), down([60, 0], [62, 50]), 100, { releasing: 62 });
    expect(next.passed).toBe(0);
    expect(next.early).toBe(false);
    expect(next.at).toBe(0);
    expect(state(next.keys)).toEqual([[60, true]]);
  });

  it('judges a release the same whether the timer fired on time or late', () => {
    const plan = quarters(60, 62, 64);
    const held = down([60, 0], [62, 200]);
    // 62 is held from 200, so 4/5 of its hold is up at 600.
    for (const [releaseMs, passed, early] of [
      [550, 1, true],
      [600, 2, false],
      [650, 2, false],
    ] as const) {
      const late = settleAt(plan, held, releaseMs, { releasing: 62 });
      const timer = settleAt(plan, held, 500);
      const release = settleAt(plan, timer, releaseMs, { index: timer.at, releasing: 62 });
      expect(late.passed).toBe(passed);
      expect(late.passed).toBe(timer.passed + release.passed);
      expect(late.early).toBe(early);
      expect(late.early).toBe(release.early);
      expect(late.at).toBe(release.at);
      expect(late.keys).toEqual(release.keys);
      expect(late.presses).toEqual(release.presses);
    }
  });

  it('takes a release while the step does not run as neither a pass nor early', () => {
    const plan = planOf([
      { midi: 60, tick: 0 },
      { midi: 64, tick: 0 },
      { midi: 67, tick: 1 },
    ]);
    const r = settleAt(plan, down([60, 0]), 100, { releasing: 60 });
    expect(r.passed).toBe(0);
    expect(r.early).toBe(false);
    expect(r.keys.size).toBe(0);
    // A spent key of the step (C C: the first C is still held) is no early release either.
    const cc = quarters(60, 60);
    const first = settleAt(cc, down([60, 0]), 500);
    expect(first.move).toEqual({ kind: 'cue', index: 1 });
    const letGo = settleAt(cc, { keys: first.keys, presses: first.presses }, 600, {
      index: 1,
      releasing: 60,
    });
    expect(letGo.passed).toBe(0);
    expect(letGo.early).toBe(false);
    expect(letGo.keys.size).toBe(0);
  });

  it('wraps the loop, finishes the piece, and bounds the chain', () => {
    const plan = quarters(60, 62, 64, 65);
    const loop: PerfRange = { from: 1, to: 2 };
    const wrapped = settleAt(plan, down([65, 0]), 500, { index: 3, loop });
    expect(wrapped.move).toEqual({ kind: 'cue', index: 2 });
    expect(wrapped.passed).toBe(1);
    expect(wrapped.at).toBe(2);
    const done = settleAt(plan, down([65, 0]), 500, { index: 3 });
    expect(done.move).toEqual({ kind: 'finish' });
    expect(done.at).toBe(-1);
    expect(done.passed).toBe(1);
    // Steps that ask for nothing always pass: the chain still ends.
    const none: StepTime = { shortestSec: 0, lengthSec: [], beats: [] };
    const steps: AlongStep[] = [0, 1, 2].map((perfSec) => ({ perfSec, pitches: [] }));
    const bounded = settle({
      steps,
      times: steps.map(() => none),
      index: 1,
      keys: NO_KEYS,
      presses: NO_PRESSES,
      loop: { from: 0, to: 3 },
      nowMs: 0,
      factor: 1,
    });
    expect(bounded.passed).toBe(3);
    expect(bounded.move).toEqual({ kind: 'cue', index: 1 });
  });

  it('passes a step of no length at the press', () => {
    const plan = planOf([
      { midi: 60, tick: 0, ticks: 0 },
      { midi: 62, tick: 1 },
    ]);
    const r = settleAt(plan, down([60, 100]), 100);
    expect(r.passed).toBe(1);
    expect(r.move).toEqual({ kind: 'cue', index: 1 });
  });

  it('stays for an index outside the steps, still taking the released key away', () => {
    const plan = quarters(60);
    const r = settleAt(plan, down([60, 0]), 900, { index: 4, releasing: 60 });
    expect(r.move).toEqual({ kind: 'stay' });
    expect(r.passed).toBe(0);
    expect(r.early).toBe(false);
    expect(r.keys.size).toBe(0);
    expect(r.run).toBeNull();
    expect(r.wakeAtMs).toBeNull();
  });

  it('never changes the maps it was given', () => {
    const plan = quarters(60, 62);
    const held = down([60, 0], [62, 0]);
    const keys = state(held.keys);
    const presses = [...held.presses];
    settleAt(plan, held, 900, { releasing: 62 });
    settleAt(plan, held, 100, { releasing: 60 });
    expect(state(held.keys)).toEqual(keys);
    expect([...held.presses]).toEqual(presses);
  });
});
