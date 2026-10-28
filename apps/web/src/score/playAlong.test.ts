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
  spendAll,
  stepAfter,
  stepGapSec,
  type AlongStep,
  type Keys,
  type PerfRange,
  type Presses,
  type StepNotes,
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
    const r = advance([step(0, 60), step(1, 62)], 0, held(60), NO_PRESSES, null);
    expect(r.move).toEqual({ kind: 'cue', index: 1 });
    expect(r.passed).toBe(1);
    expect(state(r.keys)).toEqual([[60, false]]);
  });

  it('stays on a wrong key and spends nothing', () => {
    const keys = held(61);
    const r = advance([step(0, 60), step(1, 62)], 0, keys, NO_PRESSES, null);
    expect(r.move).toEqual({ kind: 'stay' });
    expect(r.passed).toBe(0);
    expect(r.keys).toBe(keys);
  });

  it('stays with no key held', () => {
    expect(advance([step(0, 60)], 0, NO_KEYS, NO_PRESSES, null).move).toEqual({ kind: 'stay' });
  });

  it('stays on a chord with two of three keys, then the third passes', () => {
    const steps = [step(0, 60, 64, 67), step(1, 72)];
    const two = advance(steps, 0, held(60, 64), NO_PRESSES, null);
    expect(two.move).toEqual({ kind: 'stay' });
    expect(two.passed).toBe(0);
    const three = advance(steps, 0, pressKey(two.keys, 67), NO_PRESSES, null);
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
      const r = advance(steps, 0, keys, NO_PRESSES, null);
      expect(r.move).toEqual({ kind: 'stay' });
      keys = r.keys;
    }
    keys = pressKey(keys, 67);
    expect(advance(steps, 0, keys, NO_PRESSES, null).move).toEqual({ kind: 'cue', index: 1 });
  });

  it('stays when a chord key was released before the last was down', () => {
    const steps = [step(0, 60, 64), step(1, 72)];
    let keys = held(60);
    keys = advance(steps, 0, keys, NO_PRESSES, null).keys;
    keys = releaseKey(keys, 60);
    keys = pressKey(keys, 64);
    expect(advance(steps, 0, keys, NO_PRESSES, null).move).toEqual({ kind: 'stay' });
    // Pressing the first key again completes it.
    expect(advance(steps, 0, pressKey(keys, 60), NO_PRESSES, null).move).toEqual({
      kind: 'cue',
      index: 1,
    });
  });

  it('needs a release and a fresh press for a repeated pitch (C C)', () => {
    const first = advance(twinkle, 0, held(60), NO_PRESSES, null);
    expect(first.move).toEqual({ kind: 'cue', index: 1 });
    expect(first.passed).toBe(1);
    // The same C, still held and used, does not pass the second C.
    const again = advance(twinkle, 1, first.keys, NO_PRESSES, null);
    expect(again.move).toEqual({ kind: 'stay' });
    // Released and pressed again, it does.
    const fresh = pressKey(releaseKey(first.keys, 60), 60);
    const second = advance(twinkle, 1, fresh, NO_PRESSES, null);
    expect(second.move).toEqual({ kind: 'cue', index: 2 });
    expect(second.passed).toBe(1);
  });

  it('chains an early press of the next steps into one cue at the end of the chain', () => {
    const r = advance(twinkle, 0, held(60, 67), NO_PRESSES, null);
    // Step 0 passes on C; step 1 (C again) needs a fresh C and stops the chain at step 1.
    expect(r.move).toEqual({ kind: 'cue', index: 1 });
    const steps = [step(0, 60), step(1, 62), step(2, 64), step(3, 65)];
    const chained = advance(steps, 0, held(60, 62, 64), NO_PRESSES, null);
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
    const r = advance(steps, 1, held(62, 64), NO_PRESSES, null);
    expect(r.move).toEqual({ kind: 'cue', index: 3 });
    expect(r.passed).toBe(2);
  });

  it('finishes on the last step without a loop', () => {
    const steps = [step(0, 60), step(1, 62)];
    const r = advance(steps, 1, held(62), NO_PRESSES, null);
    expect(r.move).toEqual({ kind: 'finish' });
    expect(r.passed).toBe(1);
    expect(state(r.keys)).toEqual([[62, false]]);
  });

  it('finishes at the end of a chain that runs off the piece', () => {
    const steps = [step(0, 60), step(1, 62), step(2, 64)];
    const r = advance(steps, 0, held(60, 62, 64), NO_PRESSES, null);
    expect(r.move).toEqual({ kind: 'finish' });
    expect(r.passed).toBe(3);
  });

  it('wraps from the last step of a loop to its first', () => {
    const steps = [step(0, 60), step(1, 62), step(2, 64), step(3, 65), step(4, 67)];
    const loop: PerfRange = { from: 2, to: 4 };
    const r = advance(steps, 3, held(65), NO_PRESSES, loop);
    expect(r.move).toEqual({ kind: 'cue', index: 2 });
    expect(r.passed).toBe(1);
    // Inside the loop it moves on as usual.
    expect(advance(steps, 2, held(64), NO_PRESSES, loop).move).toEqual({ kind: 'cue', index: 3 });
  });

  it('never finishes inside a loop, also when the loop ends at the last step', () => {
    const steps = [step(0, 60), step(1, 62)];
    const r = advance(steps, 1, held(62), NO_PRESSES, { from: 0, to: 2 });
    expect(r.move).toEqual({ kind: 'cue', index: 0 });
  });

  it('needs a fresh press every lap of a one-step loop', () => {
    const steps = [step(0, 60), step(1, 62)];
    const loop: PerfRange = { from: 1, to: 2 };
    const lap = advance(steps, 1, held(62), NO_PRESSES, loop);
    expect(lap.move).toEqual({ kind: 'cue', index: 1 });
    expect(lap.passed).toBe(1);
    const stuck = advance(steps, 1, lap.keys, NO_PRESSES, loop);
    expect(stuck.move).toEqual({ kind: 'stay' });
    const next = advance(steps, 1, pressKey(releaseKey(lap.keys, 62), 62), NO_PRESSES, loop);
    expect(next.move).toEqual({ kind: 'cue', index: 1 });
    expect(next.passed).toBe(1);
  });

  it('makes held keys need a fresh press after an external move (spendAll)', () => {
    const steps = [step(0, 60), step(1, 62)];
    const keys = spendAll(held(60));
    expect(advance(steps, 0, keys, NO_PRESSES, null).move).toEqual({ kind: 'stay' });
    expect(advance(steps, 0, pressKey(releaseKey(keys, 60), 60), NO_PRESSES, null).move).toEqual({
      kind: 'cue',
      index: 1,
    });
    // Pressing the held key again, without a release, also refreshes it.
    expect(advance(steps, 0, pressKey(keys, 60), NO_PRESSES, null).move).toEqual({
      kind: 'cue',
      index: 1,
    });
  });

  it('ignores extra held keys and leaves them as they are', () => {
    const r = advance([step(0, 60), step(1, 62)], 0, held(60, 90, 30), NO_PRESSES, null);
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
    const r = advance(empty, 1, NO_KEYS, NO_PRESSES, loop);
    expect(r.passed).toBe(empty.length);
    expect(r.move).toEqual({ kind: 'cue', index: 1 });
    // Without a loop the same steps run off the end.
    const open = advance(empty, 0, NO_KEYS, NO_PRESSES, null);
    expect(open.move).toEqual({ kind: 'finish' });
    expect(open.passed).toBe(empty.length);
  });

  it('stays for an index outside the steps', () => {
    const keys = held(60);
    expect(advance([step(0, 60)], -1, keys, NO_PRESSES, null).move).toEqual({ kind: 'stay' });
    expect(advance([step(0, 60)], 1, keys, NO_PRESSES, null).move).toEqual({ kind: 'stay' });
    expect(advance([], 0, keys, NO_PRESSES, null).move).toEqual({ kind: 'stay' });
  });

  it('never changes the map it was given', () => {
    const keys = held(60, 62);
    const before = state(keys);
    advance([step(0, 60), step(1, 62), step(2, 64)], 0, keys, NO_PRESSES, null);
    expect(state(keys)).toEqual(before);
  });

  it('treats a loop that holds no step as no loop', () => {
    const steps = [step(0, 60), step(1, 62)];
    const r = advance(steps, 1, held(62), NO_PRESSES, { from: 5, to: 9 });
    expect(r.move).toEqual({ kind: 'finish' });
  });

  describe('last, the step passed last (issue 184)', () => {
    const steps = [step(0, 60), step(1, 62), step(2, 64), step(3, 65), step(4, 67)];

    it('is the step a single pass left', () => {
      expect(advance(steps, 0, held(60), NO_PRESSES, null).last).toBe(0);
      expect(advance(steps, 2, held(64), NO_PRESSES, null).last).toBe(2);
    });

    it('is the end of a chain, not its start', () => {
      const r = advance(steps, 0, held(60, 62, 64), NO_PRESSES, null);
      expect(r.passed).toBe(3);
      expect(r.move).toEqual({ kind: 'cue', index: 3 });
      expect(r.last).toBe(2);
      const from = advance(steps, 1, held(62, 64), NO_PRESSES, null);
      expect(from.passed).toBe(2);
      expect(from.last).toBe(2);
    });

    it('is the final step on finish', () => {
      const r = advance(steps, 4, held(67), NO_PRESSES, null);
      expect(r.move).toEqual({ kind: 'finish' });
      expect(r.last).toBe(4);
      const chain = advance(steps, 3, held(65, 67), NO_PRESSES, null);
      expect(chain.move).toEqual({ kind: 'finish' });
      expect(chain.last).toBe(4);
    });

    it("is the loop's last step when the pass wraps", () => {
      const loop: PerfRange = { from: 2, to: 4 };
      const r = advance(steps, 3, held(65), NO_PRESSES, loop);
      expect(r.move).toEqual({ kind: 'cue', index: 2 });
      expect(r.last).toBe(3);
      // A one-step loop wraps onto itself.
      const lap = advance([step(0, 60), step(1, 62)], 1, held(62), NO_PRESSES, { from: 1, to: 2 });
      expect(lap.move).toEqual({ kind: 'cue', index: 1 });
      expect(lap.last).toBe(1);
    });

    it('is the step before the wrap when a chain ends just after one', () => {
      const loop: PerfRange = { from: 2, to: 4 };
      // Passes step 3 (the loop's last), wraps to step 2, passes it: lands on step 3.
      const r = advance(steps, 3, held(65, 64), NO_PRESSES, loop);
      expect(r.passed).toBe(2);
      expect(r.move).toEqual({ kind: 'cue', index: 3 });
      expect(r.last).toBe(2);
    });

    it('is -1 on stay', () => {
      expect(advance(steps, 0, NO_KEYS, NO_PRESSES, null).last).toBe(-1);
      expect(advance(steps, 0, held(61), NO_PRESSES, null).last).toBe(-1);
      expect(advance(steps, -1, held(60), NO_PRESSES, null).last).toBe(-1);
      expect(advance(steps, 9, held(60), NO_PRESSES, null).last).toBe(-1);
      expect(advance([], 0, held(60), NO_PRESSES, null).last).toBe(-1);
    });
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
      'lists the non-grace notes of the hands played at each step, left hand first: %s',
      (_name, build, muted) => {
        const perf = performanceOf(build());
        const { notes } = alongPlanNotes(perf, muted);
        const byId = new Map(perf.score.notes.map((n) => [n.id, n]));
        for (const n of notes) {
          expect(n.ids.length).toBeGreaterThan(0);
          const heard = n.ids.map((id) => byId.get(id)!);
          expect(new Set(heard.map((x) => x.onsetTick)).size).toBe(1);
          for (const x of heard) {
            expect(muted).not.toContain(x.hand);
            expect(x.isGrace).toBe(false);
          }
          const hands = heard.map((x) => x.hand);
          expect(hands).toEqual([...hands].sort());
        }
        // Every non-grace note of the hands played is in exactly one step.
        expect(notes.flatMap((n) => [...n.ids]).sort()).toEqual(
          perf.score.notes
            .filter((n) => !n.isGrace && !muted.includes(n.hand))
            .map((n) => n.id)
            .sort(),
        );
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
      const idsOf = (muted: Hand[]) =>
        alongPlanNotes(performanceOf(score), muted).notes.map((n) => [...n.ids]);
      expect(idsOf([])).toEqual([
        // The left hand's note, then the right hand's two in score order; the grace note is out.
        [id[3], id[1], id[2]],
        // Both voices of a unison in one hand: both notes.
        [id[4], id[5]],
        [id[6]],
        // A unison across the hands: the left hand's first.
        [id[8], id[7]],
      ]);
      // A muted hand has no notes, and a step only in that hand is gone.
      expect(idsOf(['L'])).toEqual([[id[1], id[2]], [id[4], id[5]], [id[7]]]);
    });

    it('lists the note of the upper start of a trill, which asks for its upper pitch', () => {
      const score = scoreOf([
        { midi: 60, tick: 0, ticks: 4, ornament: trill },
        { midi: 65, tick: 4 },
      ]);
      const { steps, notes } = alongPlanNotes(performanceOf(score), []);
      expect(steps[0]!.pitches).toEqual([62]);
      expect(notes[0]!.ids).toEqual([score.notes[0]!.id]);
    });

    it('gives the performance ids of a repeated bar, one per hearing', () => {
      const perf = performanceOf(repeated());
      const { notes } = alongPlanNotes(perf, []);
      const ids = notes.flatMap((n) => [...n.ids]);
      expect(ids).toEqual(
        [...perf.score.notes].sort((a, b) => a.onsetTick - b.onsetTick).map((n) => n.id),
      );
      expect(ids.every((id) => /@\d+$/.test(id))).toBe(true);
    });

    /** The tick of each step, read from its first note in the performance. */
    const ticksOf = (perf: ReturnType<typeof performanceOf>, notes: StepNotes[]): number[] =>
      notes.map((n) => perf.score.notes.find((x) => x.id === n.ids[0])!.onsetTick);

    /** The felt beat at `tick` in ticks: three beats in 6/8, 9/8, 12/8 and 6/16, else the beat. */
    const feltTicks = (score: Score, tick: number): number => {
      const sigs = score.timeSignatures
        .filter((s) => s.tick <= tick)
        .sort((a, b) => a.tick - b.tick);
      const sig = sigs[sigs.length - 1];
      const compound = !!sig && sig.beatType >= 8 && sig.beats > 3 && sig.beats % 3 === 0;
      return compound ? 3 * beatTicksAt(score, tick) : beatTicksAt(score, tick);
    };

    /** What the felt beat should be at each step, from the beat and tempo helpers. */
    const expectFeltBeats = (score: Score): StepNotes[] => {
      const perf = performanceOf(score);
      const { notes } = alongPlanNotes(perf, []);
      const { tempoMap, divisions } = perf.score;
      const sec = (tick: number) => ticksToSeconds(tempoMap, divisions, tick);
      ticksOf(perf, notes).forEach((tick, i) => {
        expect(notes[i]!.beatSec).toBeCloseTo(
          sec(tick + feltTicks(perf.score, tick)) - sec(tick),
          9,
        );
      });
      return notes;
    };

    it('gives the beat at each step in 3/4, with a one-beat pickup', () => {
      const notes = expectFeltBeats(parseMusicXml(fixture('pickup-piano')).score);
      expect(notes.length).toBeGreaterThan(1);
    });

    it('gives the beat at each step in 4/4', () => {
      const notes = expectFeltBeats(parseMusicXml(fixture('short-piano')).score);
      expect(notes.length).toBeGreaterThan(1);
    });

    it('gives a dotted quarter for the felt beat in 6/8', () => {
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
      const notes = expectFeltBeats(sixEight);
      expect(notes).toHaveLength(2);
      // At divisions 2 and 120 qpm a tick is a quarter of a second: three of them.
      for (const n of notes) expect(n.beatSec).toBeCloseTo(0.75, 9);
    });

    it.each([
      [6, 8, 6, true],
      [9, 8, 6, true],
      [12, 8, 6, true],
      [12, 16, 3, true],
      [6, 16, 3, true],
      [3, 8, 2, false],
      [3, 4, 4, false],
      [4, 4, 4, false],
      [2, 2, 8, false],
      [6, 4, 4, false],
    ])(
      'feels %i/%i with a beat of %i ticks at divisions 4 (compound: %s)',
      (beats, beatType, ticks, compound) => {
        const score: Score = {
          ...scoreOf([{ midi: 60, tick: 0 }]),
          divisions: 4,
          timeSignatures: [{ tick: 0, beats, beatType }],
        };
        const { notes } = alongPlanNotes(performanceOf(score), []);
        // 120 qpm at divisions 4: a tick is 0.125 s.
        expect(notes[0]!.beatSec).toBeCloseTo(ticks * 0.125, 9);
        expect(notes[0]!.compound).toBe(compound);
      },
    );

    it('feels the time signature in force at the step', () => {
      const changing: Score = {
        ...scoreOf(
          [
            { midi: 60, tick: 0 },
            { midi: 62, tick: 4 },
          ],
          2,
        ),
        divisions: 2,
        timeSignatures: [
          { tick: 0, beats: 4, beatType: 4 },
          { tick: 4, beats: 6, beatType: 8 },
        ],
      };
      const { notes } = alongPlanNotes(performanceOf(changing), []);
      // A quarter (two ticks of 0.25 s) in 4/4, then a dotted quarter (three ticks) in 6/8.
      expect(notes[0]!.beatSec).toBeCloseTo(0.5, 9);
      expect(notes[1]!.beatSec).toBeCloseTo(0.75, 9);
      expect(notes.map((n) => n.compound)).toEqual([false, true]);
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
      const notes = expectFeltBeats(changing);
      // Half the tempo, twice the beat.
      expect(notes[1]!.beatSec).toBeCloseTo(2 * notes[0]!.beatSec, 9);
      expect(notes[2]!.beatSec).toBeCloseTo((notes[1]!.beatSec * 60) / 90, 9);
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

describe('runSince', () => {
  const down = (...pressed: Array<[number, number]>): { keys: Keys; presses: Presses } => ({
    keys: pressed.reduce((keys, [midi]) => pressKey(keys, midi), NO_KEYS),
    presses: pressed.reduce((times, [midi, ms]) => pressAt(times, midi, ms), NO_PRESSES),
  });
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

describe('advance with presses (issue 204)', () => {
  // Four steps: [60] at 0, [62] at 0.5, [48 64] at 1 and [60] at 1.5.
  const four = (): Plan =>
    planOf([
      { midi: 60, tick: 0 },
      { midi: 62, tick: 1 },
      { midi: 48, tick: 2, hand: 'L' },
      { midi: 64, tick: 2 },
      { midi: 60, tick: 3 },
    ]);
  const down = (...pressed: Array<[number, number]>): { keys: Keys; presses: Presses } => ({
    keys: pressed.reduce((keys, [midi]) => pressKey(keys, midi), NO_KEYS),
    presses: pressed.reduce((times, [midi, ms]) => pressAt(times, midi, ms), NO_PRESSES),
  });
  const state = (keys: Keys): Array<[number, boolean]> => [...keys].sort((a, b) => a[0] - b[0]);
  const run = (
    held: { keys: Keys; presses: Presses },
    index = 0,
    loop: PerfRange | null = null,
  ): ReturnType<typeof advance> => advance(four().steps, index, held.keys, held.presses, loop);
  /** The invariants of every result. */
  const expectNamed = (r: ReturnType<typeof advance>, held: { presses: Presses }): void => {
    expect(r.passedRuns.map((p) => p.index)).toEqual(r.passedSteps);
    expect(r.presses).toBe(held.presses);
  };

  it('passes at the press, with no clock', () => {
    const held = down([60, 1000]);
    const r = run(held);
    expect(r.move).toEqual({ kind: 'cue', index: 1 });
    expect(r.passed).toBe(1);
    expect(r.passedRuns).toEqual([{ index: 0, sinceMs: 1000 }]);
    expect(r.last).toBe(0);
    expect(r.at).toBe(1);
    expectNamed(r, held);
  });

  it('moves nothing on a wrong key', () => {
    const held = down([61, 0]);
    const r = run(held);
    expect(r.move).toEqual({ kind: 'stay' });
    expect(r.passed).toBe(0);
    expect(r.at).toBe(0);
    expect(state(r.keys)).toEqual(state(held.keys));
    expect(r.passedRuns).toEqual([]);
    expect(r.last).toBe(-1);
    expectNamed(r, held);
  });

  it('chains from keys pressed ahead, each from its own press', () => {
    const held = down([62, 50], [60, 200]);
    const r = run(held);
    expect(r.passedRuns).toEqual([
      { index: 0, sinceMs: 200 },
      { index: 1, sinceMs: 50 },
    ]);
    expect(r.at).toBe(2);
    expectNamed(r, held);
  });

  it('counts a rolled chord from its last key', () => {
    const held = down([48, 1000], [64, 1030]);
    const r = run(held, 2);
    expect(r.passedRuns).toEqual([{ index: 2, sinceMs: 1030 }]);
    expectNamed(r, held);
  });

  it('stays on a chord with one key missing', () => {
    const held = down([48, 1000]);
    const r = run(held, 2);
    expect(r.move).toEqual({ kind: 'stay' });
    expect(r.at).toBe(2);
    expect(state(r.keys)).toEqual([[48, true]]);
    expectNamed(r, held);
  });

  it('wraps the loop', () => {
    const held = down([64, 0], [48, 0], [62, 10]);
    const r = run(held, 2, { from: 0.5, to: 1.5 });
    expect(r.passedRuns.map((p) => [p.index, p.sinceMs])).toEqual([
      [2, 0],
      [1, 10],
    ]);
    expect(r.move).toEqual({ kind: 'cue', index: 2 });
    expectNamed(r, held);
  });

  it('finishes', () => {
    const held = down([60, 0]);
    const r = run(held, 3);
    expect(r.move).toEqual({ kind: 'finish' });
    expect(r.at).toBe(-1);
    expect(r.last).toBe(3);
    expect(r.passedRuns).toEqual([{ index: 3, sinceMs: 0 }]);
    expectNamed(r, held);
  });

  it('names the same steps in passedSteps and passedRuns', () => {
    const held = down([60, 5], [62, 6], [48, 7], [64, 8], [60, 9]);
    const r = run(held);
    expect(r.passedSteps).toEqual([0, 1, 2]);
    expectNamed(r, held);
  });

  it('stays for an index outside the steps', () => {
    const held = down([60, 0]);
    for (const index of [-1, 9]) {
      const r = run(held, index);
      expect(r.move).toEqual({ kind: 'stay' });
      expect(r.at).toBe(index);
      expect(r.passed).toBe(0);
      expectNamed(r, held);
    }
  });

  it('never changes the maps it was given', () => {
    const held = down([60, 0], [62, 10]);
    const keysBefore = state(held.keys);
    const pressesBefore = [...held.presses];
    run(held);
    expect(state(held.keys)).toEqual(keysBefore);
    expect([...held.presses]).toEqual(pressesBefore);
  });

  it('keeps HOLD_TOLERANCE for the key levels (issue 200)', () => {
    expect(HOLD_TOLERANCE).toBe(0.8);
  });
});

describe('stepGapSec (issue 204)', () => {
  const at = (...secs: number[]): AlongStep[] =>
    secs.map((perfSec, i) => ({ perfSec, pitches: [60 + i] }));
  const quarters = at(0, 0.5, 1, 1.5, 2);

  it('is the gap to the next step', () => {
    expect(stepGapSec(quarters, 1, null)).toBe(0.5);
  });

  it('counts a rest after the note in the gap', () => {
    expect(stepGapSec(at(0, 1), 0, null)).toBe(1);
  });

  it("runs the loop's last step to the loop's end", () => {
    expect(stepGapSec(quarters, 2, { from: 0, to: 1.25 })).toBeCloseTo(0.25, 12);
  });

  it("has none after the piece's last step", () => {
    expect(stepGapSec(quarters, 4, null)).toBeNull();
  });

  it('runs inside a loop that ends at the last step', () => {
    expect(stepGapSec(quarters, 4, { from: 0, to: 2.5 })).toBe(0.5);
  });

  it('has none for an index outside the steps', () => {
    expect(stepGapSec(quarters, -1, null)).toBeNull();
    expect(stepGapSec(quarters, 5, null)).toBeNull();
  });

  it('counts a loop that holds no step as no loop', () => {
    expect(stepGapSec(quarters, 1, { from: 0.1, to: 0.2 })).toBe(0.5);
  });
});
