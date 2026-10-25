// @vitest-environment node
import { readFileSync } from 'node:fs';
import { parseMusicXml, type Score } from '@digitus2/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioClock } from './clock.js';
import { buildBeats, countInBar, measureEndSec, measureStartSec } from './beats.js';
import { createSilentInstrument } from './instrument.js';
import type { PassSpan } from './timeline.js';
import { Transport } from './transport.js';

// The timeline the play-along's timing reads (issue 192): `heardAt`, the performance second the
// listener hears at an instant, with its pass, never clamped or folded; and `runPasses`, the
// passes of the current or last run of Play.

const { score } = parseMusicXml(
  readFileSync(new URL('../../fixtures/short-piano.musicxml', import.meta.url), 'utf8'),
);
/** short-piano is 4/4 at 96 qpm: the count-in's length, the loop over bars 2 and 3, the end. */
const COUNT_IN_SEC = countInBar(score, buildBeats(score), 0).lengthSec;
const LOOP = { from: 1, to: 2 };
const LOOP_FROM = measureStartSec(score, LOOP.from);
const LOOP_TO = measureEndSec(score, LOOP.to);
const LOOP_SEC = LOOP_TO - LOOP_FROM;
const BAR3 = measureStartSec(score, 2);
const BAR4 = measureStartSec(score, 3);
const END_SEC = measureEndSec(score, score.measures.length - 1);
const LOOK_AHEAD_SEC = 0.15;

/** 2/4 at 120 qpm: one half note of C4 (1 s), trilled with `beats` attacks. */
const trill = (beats: number): Score =>
  parseMusicXml(
    '<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list>' +
      '<part id="P"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key>' +
      '<time><beats>2</beats><beat-type>4</beat-type></time></attributes>' +
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice>' +
      `<type>half</type><notations><ornaments><trill-mark beats="${beats}"/></ornaments></notations></note>` +
      '</measure></part></score-partwise>',
  ).score;

let ctx: AudioClock;
let instrument: ReturnType<typeof createSilentInstrument>;
function make(piece: Score = score) {
  return new Transport(
    {
      ctx,
      instrument,
      score: piece,
      click: () => {},
      setInterval: (() => 0) as never,
      clearInterval: () => {},
    },
    { startDelaySec: 0, lookAheadSec: LOOK_AHEAD_SEC },
  );
}
/** Advance the fake clock in 25 ms ticks, calling step() each time. */
function run(t: Transport, seconds: number) {
  const end = ctx.currentTime + seconds;
  while (ctx.currentTime < end - 1e-9) {
    t.step();
    ctx.currentTime = Math.min(end, ctx.currentTime + 0.025);
  }
  t.step();
}
/** A pass as `runPasses` gives it, with its seconds compared to 6 places. */
function span(
  pass: number,
  fromSec: number,
  toSec: number | null,
  wrapped: boolean,
  countedIn: boolean,
) {
  return {
    pass,
    fromSec: expect.closeTo(fromSec, 6),
    toSec: toSec === null ? null : expect.closeTo(toSec, 6),
    wrapped,
    countedIn,
  };
}

beforeEach(() => {
  ctx = { currentTime: 100 };
  instrument = createSilentInstrument();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Transport.heardAt (issue 192)', () => {
  it('is null before the first Play and after a pause', () => {
    const t = make();
    expect(t.heardAt()).toBeNull();
    t.setCountIn(false);
    t.play();
    expect(t.heardAt()).not.toBeNull();
    run(t, 0.5);
    t.pause();
    expect(t.heardAt()).toBeNull();
    expect(t.heardAt(performance.now())).toBeNull();
  });

  it('reads the performance second heard, with the pass and the tempo factor', () => {
    const t = make();
    t.setCountIn(false);
    t.seek(BAR3);
    t.play();
    const { pass } = t.runPasses()[0]!;
    run(t, 0.3);
    expect(t.heardAt()).toEqual({ pass, perfSec: expect.closeTo(BAR3 + 0.3, 6), factor: 1 });
  });

  it('reads before the start during a count-in, linear in time, in the same pass', () => {
    const t = make();
    t.setCountIn(true);
    t.setTempoFactor(0.8);
    t.play();
    const { pass, fromSec } = t.runPasses()[0]!;
    expect(fromSec).toBe(0);
    // The count-in lasts its score seconds over the factor.
    const countInRealSec = COUNT_IN_SEC / 0.8;
    let elapsed = 0;
    for (const x of [0, 0.3, 1.1, 2.9]) {
      run(t, x - elapsed);
      elapsed = x;
      const at = t.heardAt()!;
      expect(at.pass).toBe(pass);
      expect(at.factor).toBe(0.8);
      expect(at.perfSec).toBeCloseTo(fromSec - (countInRealSec - x) * 0.8, 6);
      expect(at.perfSec).toBeLessThan(fromSec);
    }
  });

  it('goes to the next pass when a loop wrap is heard, and never folds the pass before it', () => {
    vi.spyOn(performance, 'now').mockReturnValue(50_000);
    const t = make();
    t.setCountIn(false);
    t.setLoop(LOOP);
    t.play();
    const first = t.runPasses()[0]!;
    expect(first.fromSec).toBeCloseTo(LOOP_FROM, 9);
    run(t, LOOP_SEC - 0.05);
    // The wrap is scheduled (the look-ahead) but not heard yet: still the first pass.
    expect(t.runPasses()).toHaveLength(2);
    const before = t.heardAt()!;
    expect(before.pass).toBe(first.pass);
    expect(before.perfSec).toBeCloseTo(LOOP_TO - 0.05, 6);
    run(t, 0.1);
    const after = t.heardAt()!;
    expect(after.pass).toBe(first.pass + 1);
    expect(after.perfSec).toBeCloseTo(LOOP_FROM + 0.05, 6);
    // A key 100 ms ago was heard before the wrap: the first pass, past nothing folded back.
    const earlier = t.heardAt(performance.now() - 100)!;
    expect(earlier.pass).toBe(first.pass);
    expect(earlier.perfSec).toBeCloseTo(LOOP_TO - 0.05, 6);
  });

  it('keeps the pass through a tempo change and takes the new factor from its boundary', () => {
    const t = make();
    t.setCountIn(false);
    t.play();
    const { pass } = t.runPasses()[0]!;
    run(t, 1);
    t.setTempoFactor(1.5);
    // What is scheduled keeps the old speed: the factor changes where scheduling had reached.
    expect(t.heardAt()).toEqual({ pass, perfSec: expect.closeTo(1, 6), factor: 1 });
    run(t, 0.3);
    expect(t.heardAt()).toEqual({
      pass,
      perfSec: expect.closeTo(1 + LOOK_AHEAD_SEC + (0.3 - LOOK_AHEAD_SEC) * 1.5, 6),
      factor: 1.5,
    });
    expect(instrument.stopAllCalls).toBe(0); // no resync
    expect(t.runPasses()).toHaveLength(1);
  });

  it('starts a new pass at a seek while playing, read before the target during its lead', () => {
    const t = make();
    t.setCountIn(false);
    t.play();
    const first = t.runPasses()[0]!.pass;
    run(t, 1);
    t.seekPerformance(BAR4, { leadSec: 0.5 });
    const lead = t.heardAt()!;
    expect(lead.pass).toBe(first + 1);
    expect(lead.perfSec).toBeCloseTo(BAR4 - 0.5, 6);
    run(t, 0.7);
    expect(t.heardAt()).toEqual({
      pass: first + 1,
      perfSec: expect.closeTo(BAR4 + 0.2, 6),
      factor: 1,
    });
    expect(t.runPasses()).toEqual([
      span(first, 0, 1, false, false),
      span(first + 1, BAR4, null, false, false),
    ]);
  });

  it('counts a key time back from now on the fallback clock (no output timestamp)', () => {
    vi.spyOn(performance, 'now').mockReturnValue(50_000);
    const t = make();
    t.setCountIn(false);
    t.setTempoFactor(1.5);
    t.play();
    run(t, 1);
    const now = performance.now();
    const at = t.heardAt(now)!;
    const earlier = t.heardAt(now - 100)!;
    expect(at.perfSec).toBeCloseTo(1.5, 9);
    expect(earlier.pass).toBe(at.pass);
    expect(earlier.perfSec).toBeCloseTo(at.perfSec - 0.1 * 1.5, 9);
    expect(t.heardAt()).toEqual(at);
  });

  it('counts a key time back from now with an output timestamp too', () => {
    vi.spyOn(performance, 'now').mockReturnValue(50_000);
    const latent = {
      currentTime: 100,
      // 200 ms of output latency, stamped now.
      getOutputTimestamp: () => ({
        contextTime: latent.currentTime - 0.2,
        performanceTime: performance.now(),
      }),
    };
    ctx = latent;
    const t = make();
    t.setCountIn(false);
    t.play();
    run(t, 1);
    const now = performance.now();
    const at = t.heardAt(now)!;
    expect(at.perfSec).toBeCloseTo(0.8, 9); // heard 200 ms behind what is rendered
    expect(t.heardAt(now - 100)!.perfSec).toBeCloseTo(0.7, 9);
  });
});

describe('Transport.runPasses (issue 192)', () => {
  it('is empty before the first Play', () => {
    expect(make().runPasses()).toEqual([]);
  });

  it('logs each loop pass: the wrapped ones end at the loop end, the last where it was paused', () => {
    const t = make();
    t.setCountIn(false);
    t.setLoop(LOOP);
    t.play();
    run(t, 2 * LOOP_SEC + 1);
    t.pause();
    const p = t.runPasses()[0]!.pass;
    expect(t.performanceStartSec()).toBeCloseTo(LOOP_FROM + 1, 6);
    expect(t.runPasses()).toEqual([
      span(p, LOOP_FROM, LOOP_TO, true, false),
      span(p + 1, LOOP_FROM, LOOP_TO, true, false),
      span(p + 2, LOOP_FROM, LOOP_FROM + 1, false, false),
    ]);
  });

  it('drops a wrap scheduled but not heard at a pause, and the pass before it is cut there', () => {
    const t = make();
    t.setCountIn(false);
    t.setLoop(LOOP);
    t.play();
    const p = t.runPasses()[0]!.pass;
    run(t, LOOP_SEC - 0.1);
    expect(t.runPasses()).toEqual([
      span(p, LOOP_FROM, LOOP_TO, true, false),
      span(p + 1, LOOP_FROM, null, false, false),
    ]);
    t.pause();
    expect(t.runPasses()).toEqual([span(p, LOOP_FROM, LOOP_TO - 0.1, false, false)]);
  });

  it('drops a wrap rendered but not yet heard (the output latency) at a pause', () => {
    const latent = {
      currentTime: 100,
      getOutputTimestamp: () => ({
        contextTime: latent.currentTime - 0.2,
        performanceTime: performance.now(),
      }),
    };
    ctx = latent;
    const t = make();
    t.setCountIn(false);
    t.setLoop(LOOP);
    t.play();
    const p = t.runPasses()[0]!.pass;
    run(t, LOOP_SEC + 0.1); // rendered 100 ms past the wrap, heard 100 ms before it
    t.pause();
    const passes = t.runPasses();
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({ pass: p, wrapped: false });
    expect(passes[0]!.toSec).toBeCloseTo(LOOP_TO - 0.1, 3);
  });

  it('leaves one empty pass after a pause in the count-in', () => {
    const t = make();
    t.setCountIn(true);
    t.play();
    run(t, 0.3);
    t.pause();
    const passes = t.runPasses();
    expect(passes).toEqual([span(passes[0]!.pass, 0, 0, false, true)]);
    expect(passes[0]!.toSec).toBe(passes[0]!.fromSec);
  });

  it('closes the last pass at the end of the piece', () => {
    const t = make();
    t.setCountIn(false);
    t.play();
    const p = t.runPasses()[0]!.pass;
    run(t, END_SEC + 1);
    expect(t.state.playing).toBe(false);
    expect(t.runPasses()).toEqual([span(p, 0, END_SEC, false, false)]);
  });

  it('closes the pass at the heard position on dispose while playing', () => {
    const t = make();
    t.setCountIn(false);
    t.play();
    const p = t.runPasses()[0]!.pass;
    run(t, 1.2);
    t.dispose();
    expect(t.runPasses()).toEqual([span(p, 0, 1.2, false, false)]);
  });

  it('survives the stop, gives copies, and is replaced by the next play()', () => {
    const t = make();
    t.setCountIn(false);
    t.play();
    run(t, 1);
    t.pause();
    const paused = t.runPasses();
    run(t, 3);
    expect(t.runPasses()).toEqual(paused);
    paused[0]!.toSec = 99;
    paused.push({ pass: -1, fromSec: 0, toSec: 0, wrapped: false, countedIn: false });
    expect(t.runPasses()).toHaveLength(1);
    expect(t.runPasses()[0]!.toSec).toBeCloseTo(1, 6);
    t.play();
    const resumed = t.runPasses();
    expect(resumed).toHaveLength(1);
    expect(resumed[0]!.pass).toBeGreaterThan(paused[0]!.pass);
    expect(resumed[0]).toEqual(span(resumed[0]!.pass, 1, null, false, false));
  });

  it('never repeats a pass number across plays, nor across two transports', () => {
    const passes: PassSpan[] = [];
    const a = make();
    a.setCountIn(false);
    a.setLoop(LOOP);
    a.play();
    run(a, 2 * LOOP_SEC + 1);
    a.seekPerformance(LOOP_FROM + 1);
    run(a, 0.5);
    a.pause();
    passes.push(...a.runPasses());
    a.play();
    run(a, 0.5);
    a.pause();
    passes.push(...a.runPasses());
    a.dispose();
    // A new score: a new transport, whose passes still never meet the old one's.
    const b = make();
    b.setCountIn(false);
    b.play();
    run(b, 0.5);
    b.pause();
    passes.push(...b.runPasses());
    const numbers = passes.map((p) => p.pass);
    expect(numbers).toHaveLength(6);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual([...numbers].sort((x, y) => x - y));
  });

  describe('countedIn', () => {
    it('is true after a count-in from a bar start, and false with the count-in off', () => {
      const on = make();
      on.setCountIn(true);
      on.play();
      expect(on.runPasses()[0]!.countedIn).toBe(true);
      const off = make();
      off.setCountIn(false);
      off.play();
      expect(off.runPasses()[0]!.countedIn).toBe(false);
      const told = make();
      told.setCountIn(true);
      told.play({ countIn: false }); // a play carried across "Add notes between"
      expect(told.runPasses()[0]!.countedIn).toBe(false);
    });

    it('is false on a resume mid-bar, and true on a Play after Pause from a bar start', () => {
      const t = make();
      t.setCountIn(false);
      t.play();
      run(t, 1);
      t.pause();
      t.setCountIn(true);
      t.play(); // mid-bar: no count-in
      expect(t.runPasses()[0]!.countedIn).toBe(false);
      run(t, 0.5);
      t.pause();
      t.seek(BAR3);
      t.play();
      expect(t.runPasses()[0]).toEqual(span(t.runPasses()[0]!.pass, BAR3, null, false, true));
    });

    it('carries on through a loop wrap', () => {
      for (const countIn of [true, false]) {
        const t = make();
        t.setCountIn(countIn);
        t.setLoop(LOOP);
        t.play();
        run(t, (countIn ? COUNT_IN_SEC : 0) + LOOP_SEC + 0.5);
        const passes = t.runPasses();
        expect(passes).toHaveLength(2);
        expect(passes.map((p) => p.countedIn)).toEqual([countIn, countIn]);
        expect(passes[0]!.wrapped).toBe(true);
      }
    });

    it('is false on the pass a seek starts, also one that cuts the count-in short', () => {
      const t = make();
      t.setCountIn(true);
      t.play();
      const p = t.runPasses()[0]!.pass;
      run(t, 0.7);
      t.seekPerformance(BAR3);
      expect(t.runPasses()).toEqual([
        span(p, 0, 0, false, true),
        span(p + 1, BAR3, null, false, false),
      ]);
    });
  });

  it('continues the pass at a resync: the new pass starts where the old one was closed', () => {
    const t = make(trill(2));
    t.setCountIn(false);
    t.play();
    const p = t.runPasses()[0]!.pass;
    run(t, 0.1);
    // The first attack of the trill runs past what a tempo change may wait for: a resync.
    t.setTempoFactor(2);
    expect(instrument.stopAllCalls).toBe(1);
    const [prev, next] = t.runPasses();
    expect(t.runPasses()).toHaveLength(2);
    expect(prev).toEqual(span(p, 0, 0.1, false, false));
    expect(next).toEqual(span(p + 1, 0.1, null, false, false));
    expect(next!.fromSec).toBe(prev!.toSec);
  });
});
