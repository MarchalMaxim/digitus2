// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMusicXml, type Score } from '@digitus2/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClickLevel } from './beats.js';
import { createPiano, createSilentInstrument, noteVelocity, PIANO_SOFTEST } from './instrument.js';
import { Transport } from './transport.js';

const { score } = parseMusicXml(
  readFileSync(new URL('../../fixtures/short-piano.musicxml', import.meta.url), 'utf8'),
);
/**
 * 3/4 at 100 qpm: a one-beat pickup in the right hand alone (D4 at 0 s, the left hand rests),
 * then three full bars; the left hand's first note is G2 at 0.6 s.
 */
const { score: pickup } = parseMusicXml(
  readFileSync(new URL('../../fixtures/pickup-piano.musicxml', import.meta.url), 'utf8'),
);

/** A stand-in for smplr's sampler: records its options, the notes it starts, and disposal. */
interface FakePiano {
  options: {
    baseUrl?: string;
    formats?: string[];
    storage?: { fetch(url: string): Promise<unknown> };
    notesToLoad: { notes: number[]; velocityRange: [number, number] };
  };
  starts: { note: number; velocity: number }[];
  disposed: boolean;
  ready: Promise<void>;
  resolve: () => void;
  start(e: { note: number; velocity: number }): void;
  stop(): void;
  dispose(): void;
}
const smplrMock = vi.hoisted(() => ({
  pianos: [] as FakePiano[],
  autoReady: true,
  failReady: false,
}));
vi.mock('smplr', () => ({
  SplendidGrandPiano: (_ctx: unknown, options: FakePiano['options']) => {
    let resolve = () => {};
    const ready = smplrMock.failReady
      ? Promise.reject(new Error('samples did not load'))
      : smplrMock.autoReady
        ? Promise.resolve()
        : new Promise<void>((r) => {
            resolve = r;
          });
    const piano: FakePiano = {
      options,
      starts: [],
      disposed: false,
      ready,
      resolve: () => resolve(),
      start: (e) => piano.starts.push({ note: e.note, velocity: e.velocity }),
      stop: () => {},
      dispose: () => {
        piano.disposed = true;
      },
    };
    smplrMock.pianos.push(piano);
    return piano;
  },
}));

let ctx: { currentTime: number };
let instrument: ReturnType<typeof createSilentInstrument>;
let clicks: { time: number; level: ClickLevel; accent: boolean }[];
function make({
  score: piece = score,
  ...opts
}: { tickMs?: number; lookAheadSec?: number; startDelaySec?: number; score?: Score } = {}) {
  return new Transport(
    {
      ctx,
      instrument,
      score: piece,
      click: (time, level) => {
        clicks.push({ time, level, accent: level === 'bar' });
      },
      setInterval: (() => 0) as never,
      clearInterval: () => {},
    },
    { startDelaySec: 0, lookAheadSec: 0.15, ...opts },
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

beforeEach(() => {
  ctx = { currentTime: 100 };
  instrument = createSilentInstrument();
  clicks = [];
  smplrMock.pianos.length = 0;
  smplrMock.autoReady = true;
  smplrMock.failReady = false;
});

describe('the sampled piano', () => {
  it("loads its samples from the app's own piano directory, in both formats", async () => {
    const piano = createPiano({} as AudioContext);
    await piano.load([60], [96]);
    const fake = smplrMock.pianos[0]!;
    expect(fake.options.baseUrl).toBe('/piano');
    expect(fake.options.formats).toEqual(['ogg', 'm4a']);
    expect(typeof fake.options.storage?.fetch).toBe('function');
  });
  it('plays the dynamics marks: loads their velocity layers and starts each note at its velocity', async () => {
    // short-piano opens with a p between the staves: both hands play every note at 68.
    expect(new Set(score.notes.map((n) => n.velocity))).toEqual(new Set([68]));
    const piano = createPiano({} as AudioContext);
    await piano.load(
      score.notes.map((n) => n.midi),
      score.notes.map(noteVelocity),
    );
    const t = new Transport(
      { ctx, instrument: piano, score, setInterval: (() => 0) as never, clearInterval: () => {} },
      { startDelaySec: 0 },
    );
    t.setCountIn(false);
    t.play();
    run(t, 21);
    expect(smplrMock.pianos).toHaveLength(1);
    const fake = smplrMock.pianos[0]!;
    expect(fake.options.notesToLoad.velocityRange).toEqual([68, 68]);
    expect(fake.starts).toHaveLength(67);
    expect(fake.starts.every((s) => s.velocity === 68)).toBe(true);
  });
  it("plays a note without a velocity at its hand's, the left hand softer", () => {
    const unmarked = { ...score, notes: score.notes.map(({ velocity: _, ...n }) => n) };
    const t = make({ score: unmarked });
    t.setCountIn(false);
    t.play();
    run(t, 21);
    expect(instrument.events).toHaveLength(67);
    const byHand = (h: string) =>
      new Set(instrument.events.filter((e) => e.hand === h).map((e) => e.velocity));
    expect(byHand('R')).toEqual(new Set([96]));
    expect(byHand('L')).toEqual(new Set([88]));
  });
  it('loads the layers from the softest velocity to the loudest and passes velocities through', async () => {
    const piano = createPiano({} as AudioContext);
    await piano.load([60, 62], [56, 96, 68]);
    const fake = smplrMock.pianos[0]!;
    expect(fake.options.notesToLoad.velocityRange).toEqual([56, 96]);
    piano.start({ midi: 60, time: 0, duration: 1, velocity: 56, hand: 'L' });
    piano.start({ midi: 62, time: 0, duration: 1, velocity: 96, hand: 'R' });
    expect(fake.starts.map((s) => s.velocity)).toEqual([56, 96]);
  });
  it('never plays or loads the muffled softest layer: a softer note plays at its floor', async () => {
    const piano = createPiano({} as AudioContext);
    await piano.load([60, 62], [20, 96]);
    const fake = smplrMock.pianos[0]!;
    expect(PIANO_SOFTEST).toBe(41); // smplr's ppp layer, 1 to 40, plays through a 1 kHz low-pass
    expect(fake.options.notesToLoad.velocityRange).toEqual([PIANO_SOFTEST, 96]);
    piano.start({ midi: 60, time: 0, duration: 1, velocity: 20, hand: 'L' });
    expect(fake.starts.map((s) => s.velocity)).toEqual([PIANO_SOFTEST]);
  });
  it('keeps the newest of two overlapping loads and disposes the older one', async () => {
    smplrMock.autoReady = false;
    const piano = createPiano({} as AudioContext);
    const first = piano.load([60], [96]);
    await vi.waitFor(() => expect(smplrMock.pianos).toHaveLength(1));
    const second = piano.load([62], [96]);
    await vi.waitFor(() => expect(smplrMock.pianos).toHaveLength(2));
    const [older, newer] = smplrMock.pianos as [FakePiano, FakePiano];
    newer.resolve();
    await second;
    older.resolve(); // the older load finishes last
    await first;
    expect(older.disposed).toBe(true);
    expect(newer.disposed).toBe(false);
    piano.start({ midi: 62, time: 0, duration: 1, velocity: 90, hand: 'R' });
    expect(newer.starts).toHaveLength(1);
    expect(older.starts).toHaveLength(0);
  });
  it('disposes the sampler of a load that fails, and the failure propagates', async () => {
    smplrMock.failReady = true;
    const piano = createPiano({} as AudioContext);
    await expect(piano.load([60], [96])).rejects.toThrow('samples did not load');
    expect(smplrMock.pianos).toHaveLength(1);
    expect(smplrMock.pianos[0]!.disposed).toBe(true);
  });
});

describe('Transport', () => {
  it('schedules every note exactly once, in onset order, at anchor + onset', () => {
    const t = make();
    t.setCountIn(false);
    t.play();
    run(t, 21);
    expect(instrument.events).toHaveLength(67);
    const times = instrument.events.map((e) => e.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBeCloseTo(100, 6);
    expect(new Set(instrument.events.map((e) => `${e.midi}@${e.time.toFixed(4)}`)).size).toBe(67);
    expect(t.state.playing).toBe(false); // stopped itself at the end
  });
  it('a note on a window boundary is scheduled once (half-open windows)', () => {
    // lookAhead 0.15 and ticks of 0.025 put boundaries at multiples of 0.025; onsets at 0.625 land exactly on one.
    const t = make({ lookAheadSec: 0.15 });
    t.setCountIn(false);
    t.play();
    run(t, 21);
    const at = instrument.events.filter((e) => Math.abs(e.time - 100.625) < 1e-9);
    expect(at.length).toBeGreaterThan(0);
    expect(at.length).toBe(new Set(at.map((e) => e.midi)).size);
  });
  it('tempo factor 2 halves the spacing; a change mid-way re-anchors without a jump', () => {
    const t = make();
    t.setCountIn(false);
    t.setTempoFactor(2);
    t.play();
    run(t, 11);
    const r = instrument.events.filter((e) => e.hand === 'R').map((e) => e.time);
    expect(r[1]! - r[0]!).toBeCloseTo(0.625 / 2, 6);
    expect(instrument.events).toHaveLength(67);
  });
  it('mutes the left hand', () => {
    const t = make();
    t.setCountIn(false);
    t.setMuted(['L']);
    t.play();
    run(t, 21);
    expect(instrument.events.every((e) => e.hand === 'R')).toBe(true);
    expect(instrument.events).toHaveLength(41);
  });
  it('clicks the metronome on every beat and counts in one bar before the first note', () => {
    const t = make();
    t.setMetronome(true);
    t.setCountIn(true);
    t.play();
    run(t, 23);
    expect(clicks.slice(0, 4).map((c) => c.time)).toEqual([100, 100.625, 101.25, 101.875]);
    expect(clicks.slice(0, 4).map((c) => c.accent)).toEqual([true, false, false, false]);
    expect(instrument.events[0]!.time).toBeCloseTo(102.5, 6);
    // The beats alone: four in the count-in, then 8 bars of 4 (the sub-beats are in
    // transport.metronome.test.ts).
    expect(clicks.filter((c) => c.level !== 'sub')).toHaveLength(4 + 32);
  });
  it('loops bars 2 to 3 seamlessly', () => {
    const t = make();
    t.setCountIn(false);
    t.setLoop({ from: 1, to: 2 });
    t.play();
    run(t, 11); // two full passes of 5 s plus a bit
    const starts = instrument.events.map((e) => e.time - 100);
    expect(Math.min(...starts)).toBeCloseTo(0, 6);
    const firstPass = instrument.events.filter((e) => e.time - 100 < 5);
    const secondPass = instrument.events.filter((e) => e.time - 100 >= 5 && e.time - 100 < 10);
    expect(secondPass.map((e) => e.midi)).toEqual(firstPass.map((e) => e.midi));
    expect(secondPass.map((e) => +(e.time - 5).toFixed(6))).toEqual(
      firstPass.map((e) => +e.time.toFixed(6)),
    );
    expect(t.positionSec()).toBeGreaterThanOrEqual(2.5);
    expect(t.positionSec()).toBeLessThan(7.5);
  });
  // UI batch review: the paused cursor shows where Play resumes, so it asks where play() starts.
  it('startSec, while stopped, is where play() starts: the position, or the loop start when the position lies outside the loop', () => {
    const t = make();
    t.seek(1);
    expect(t.startSec()).toBe(1);
    t.setLoop({ from: 1, to: 2 }); // 2.5 s to 7.5 s
    expect(t.startSec()).toBeCloseTo(2.5, 9);
    t.seek(3);
    expect(t.startSec()).toBe(3);
    t.seek(7.5);
    expect(t.startSec()).toBeCloseTo(2.5, 9);
    t.setLoop(null);
    t.seek(1e6); // the end: play() starts again from the top
    expect(t.startSec()).toBe(0);
    t.setCountIn(false);
    t.setLoop({ from: 1, to: 2 });
    t.seek(1);
    t.play();
    expect(t.positionSec()).toBeCloseTo(2.5, 9);
  });
  it('a tempo change while playing keeps the scheduled notes and the position continuous', () => {
    const t = make();
    t.setCountIn(false);
    t.play();
    run(t, 5);
    expect(t.positionSec()).toBeCloseTo(5, 6);
    t.setTempoFactor(2);
    expect(t.positionSec()).toBeCloseTo(5, 6);
    run(t, 1);
    // the 0.15 s already scheduled keep the old speed, the next 0.85 s run at double speed
    expect(t.positionSec()).toBeCloseTo(5 + 0.15 + 0.85 * 2, 6);
    run(t, 8);
    expect(instrument.events).toHaveLength(67);
    const times = instrument.events.map((e) => e.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(t.state.playing).toBe(false);
  });
  it('sounds a grace note 50 ms before its principal and reports the end once', () => {
    const t = make();
    let ends = 0;
    t.onEnd = () => ends++;
    t.setCountIn(false);
    t.play();
    run(t, 21);
    expect(ends).toBe(1);
    const grace = instrument.events.filter((e) => Math.abs(e.time - 102.45) < 1e-9);
    expect(grace.map((e) => e.midi)).toEqual([72]); // the C5 grace before bar 2
    expect(grace[0]!.duration).toBeCloseTo(0.1, 6);
    expect(t.state.positionSec).toBeCloseTo(20, 6);
  });
  it('starts with no count-in: a fresh transport plays its first note at once', () => {
    const t = make();
    expect(t.state.countIn).toBe(false);
    t.play();
    run(t, 0.2);
    expect(clicks).toHaveLength(0);
    expect(instrument.events[0]!.time).toBeCloseTo(100, 6);
  });
  it.each([-1, 0, NaN, Infinity])('ignores a tempo factor of %s', (bad) => {
    const t = make();
    t.setTempoFactor(0.5);
    t.setTempoFactor(bad);
    expect(t.state.tempoFactor).toBe(0.5);
  });
  describe('a tempo change in the middle of a trill', () => {
    // 4/4 at 120 qpm, one half note of C4 (1 s) trilled.
    const trill = (beats: number) =>
      parseMusicXml(
        '<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list>' +
          '<part id="P"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key>' +
          '<time><beats>2</beats><beat-type>4</beat-type></time></attributes>' +
          '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice>' +
          `<type>half</type><notations><ornaments><trill-mark beats="${beats}"/></ornaments></notations></note>` +
          '</measure></part></score-partwise>',
      ).score;
    const joined = (events: { time: number; duration: number }[]) =>
      events.every(
        (e, i) =>
          i === 0 || Math.abs(e.time - (events[i - 1]!.time + events[i - 1]!.duration)) < 1e-9,
      );

    it('never splits an attack already scheduled: the next one starts where it ends', () => {
      const t = make({ score: trill(9) });
      t.setCountIn(false);
      t.play();
      t.setTempoFactor(2);
      run(t, 0.6);
      expect(instrument.events.length).toBeGreaterThan(5);
      expect(joined(instrument.events)).toBe(true);
      expect(instrument.stopAllCalls).toBe(0);
    });
    it('treats an attack starting exactly where scheduling stopped as not yet scheduled', () => {
      // Eight attacks over 1 s: one every 0.125 s, so the second begins on the look-ahead edge.
      const t = make({ score: trill(8), lookAheadSec: 0.125 });
      t.setCountIn(false);
      t.play();
      expect(instrument.events.map((e) => e.time)).toEqual([100]);
      t.setTempoFactor(2);
      run(t, 0.5);
      // The attack on the edge belongs to the new tempo: half as long as the first.
      expect(instrument.events[1]!.duration).toBeCloseTo(instrument.events[0]!.duration / 2, 9);
      expect(instrument.events[1]!.time).toBeCloseTo(100.125, 9);
      expect(instrument.stopAllCalls).toBe(0);
    });
  });
  // A play carried across "Add notes between" (issue #67) goes on as the music did.
  it('plays without the count-in when the play says so, with the count-in on', () => {
    const t = make();
    t.setCountIn(true);
    t.play({ countIn: false });
    run(t, 1);
    expect(clicks).toEqual([]);
    expect(instrument.events[0]!.time).toBeCloseTo(100, 9);
    expect(t.state.countIn).toBe(true); // the setting itself is unchanged
  });
  it('clicks the count-in without the metronome, holds the position, and silences on pause', () => {
    const t = make();
    t.setCountIn(true);
    t.play();
    run(t, 1);
    expect(clicks.map((c) => c.time)).toEqual([100, 100.625]);
    expect(t.positionSec()).toBe(0);
    expect(instrument.events).toHaveLength(0);
    t.pause();
    expect(instrument.stopAllCalls).toBe(1);
    expect(t.positionSec()).toBe(0);
  });
  describe('the count-in reports (the status line counts, polish plan Task 3)', () => {
    // short-piano is in 4/4 at 96 qpm: the count-in clicks at 100, 100.625, 101.25 and 101.875,
    // and the first note sounds at 102.5 (the start delay is 0 here).
    const BEATS = [100, 100.625, 101.25, 101.875];
    const FIRST_NOTE = 102.5;
    const TICK = 0.025;

    /** Records every report with the context time it arrived at. */
    function listen(t: Transport) {
      const beats: { beat: number; beats: number; beatInBar: number; at: number }[] = [];
      const ends: number[] = [];
      t.onCountInBeat = (beat, total, beatInBar) =>
        beats.push({ beat, beats: total, beatInBar, at: ctx.currentTime });
      t.onCountInEnd = () => ends.push(ctx.currentTime);
      return { beats, ends };
    }

    it('reports beat 0 as play() starts the count-in, each later beat when it is heard, then the end when the first note is', () => {
      const t = make();
      t.setCountIn(true);
      const { beats, ends } = listen(t);
      t.play();
      expect(beats).toEqual([{ beat: 0, beats: 4, beatInBar: 1, at: 100 }]);
      run(t, 2.4);
      expect(t.positionSec()).toBe(0); // still counting in: the position holds at the start
      expect(ends).toEqual([]);
      run(t, 0.2);
      expect(beats.map((b) => [b.beat, b.beats, b.beatInBar])).toEqual([
        [0, 4, 1],
        [1, 4, 2],
        [2, 4, 3],
        [3, 4, 4],
      ]);
      // Each beat within one scheduler tick after its click, never before it.
      beats.forEach((b, k) => {
        expect(b.at).toBeGreaterThanOrEqual(BEATS[k]! - 1e-9);
        expect(b.at).toBeLessThanOrEqual(BEATS[k]! + TICK + 1e-9);
      });
      expect(ends).toHaveLength(1);
      expect(ends[0]).toBeGreaterThanOrEqual(FIRST_NOTE - 1e-9);
      expect(ends[0]).toBeLessThanOrEqual(FIRST_NOTE + TICK + 1e-9);
      expect(instrument.events[0]!.time).toBeCloseTo(FIRST_NOTE, 6);
      run(t, 3);
      expect(beats).toHaveLength(4);
      expect(ends).toHaveLength(1);
    });

    it('follows what is heard: with 200 ms of output latency every report comes 200 ms later', () => {
      const latent = {
        currentTime: 100,
        getOutputTimestamp: () => ({
          contextTime: latent.currentTime - 0.2,
          performanceTime: performance.now(),
        }),
      };
      ctx = latent;
      const t = make();
      t.setCountIn(true);
      const { beats, ends } = listen(t);
      t.play();
      run(t, 2.6);
      expect(ends).toEqual([]); // the first note is rendered at 102.5 but heard at 102.7
      run(t, 0.2);
      expect(beats.map((b) => b.beat)).toEqual([0, 1, 2, 3]);
      beats.slice(1).forEach((b, k) => {
        expect(b.at).toBeGreaterThanOrEqual(BEATS[k + 1]! + 0.2 - 1e-6);
        expect(b.at).toBeLessThanOrEqual(BEATS[k + 1]! + 0.2 + TICK + 1e-6);
      });
      expect(ends).toHaveLength(1);
      expect(ends[0]).toBeGreaterThanOrEqual(FIRST_NOTE + 0.2 - 1e-6);
      expect(ends[0]).toBeLessThanOrEqual(FIRST_NOTE + 0.2 + TICK + 1e-6);
    });

    it('reports nothing without a count-in, or when play() does not start on a bar line', () => {
      const t = make();
      t.setCountIn(false);
      const { beats, ends } = listen(t);
      t.play();
      run(t, 1);
      t.pause();
      t.setCountIn(true);
      t.play(); // resumes mid-bar: no count-in
      run(t, 1);
      expect(beats).toEqual([]);
      expect(ends).toEqual([]);
    });

    it('ends a count-in that a seek or a pause cuts short, and reports nothing after dispose', () => {
      const t = make();
      t.setCountIn(true);
      const sought = listen(t);
      t.play();
      run(t, 0.7);
      expect(sought.beats.map((b) => b.beat)).toEqual([0, 1]);
      t.seek(5);
      expect(sought.ends).toHaveLength(1);
      run(t, 3);
      expect(sought.beats).toHaveLength(2);
      expect(sought.ends).toHaveLength(1);

      const paused = make();
      paused.setCountIn(true);
      const p = listen(paused);
      paused.play();
      run(paused, 0.3);
      paused.pause();
      expect(p.ends).toHaveLength(1);
      run(paused, 3);
      expect(p.beats).toHaveLength(1);
      expect(p.ends).toHaveLength(1);

      const disposed = make();
      disposed.setCountIn(true);
      const d = listen(disposed);
      disposed.play();
      disposed.dispose();
      run(disposed, 3);
      expect(d.beats).toHaveLength(1);
      expect(d.ends).toEqual([]);
    });
  });
  // Polish plan Task 3 review: a piece that starts with a pickup counted in only the pickup's
  // length (Happy Birthday: a lone "1", 0.6 s), then a whole bar before it, which put the pickup
  // where the counted meter has beat 1 and the real downbeat on the counted beat 2. The count
  // now keeps the bar grid: the beats of the pickup's bar before it, and the pickup on its beat.
  it('counts in the beats of the bar before a pickup, so the pickup enters on its written beat', () => {
    const t = make({ score: pickup });
    t.setCountIn(true);
    t.setMetronome(true);
    const reported: { beat: number; beats: number; beatInBar: number }[] = [];
    t.onCountInBeat = (beat, beats, beatInBar) => reported.push({ beat, beats, beatInBar });
    t.play();
    run(t, 2.5);
    expect(pickup.measures[0]!.lengthTicks).toBe(pickup.divisions); // the pickup lasts one beat
    // 3/4 with a one-beat pickup on beat 3: the count is "1", "2", and the pickup is beat 3.
    expect(reported).toEqual([
      { beat: 0, beats: 2, beatInBar: 1 },
      { beat: 1, beats: 2, beatInBar: 2 },
    ]);
    const countIn = clicks.slice(0, 2);
    expect(countIn.map((c) => c.accent)).toEqual([true, false]);
    countIn.forEach((c, k) => expect(c.time).toBeCloseTo(100 + 0.6 * k, 6));
    // The pickup sounds exactly two beats (2 x 0.6 s) after the first click.
    expect(instrument.events[0]!.hand).toBe('R');
    expect(instrument.events[0]!.time - countIn[0]!.time).toBeCloseTo(2 * 0.6, 6);
    // The metronome goes on with beat 3 under the pickup, not accented, then the downbeat of
    // bar 1, accented, one beat later.
    const metronome = clicks
      .slice(2)
      .filter((c) => c.level !== 'sub')
      .slice(0, 2);
    expect(metronome.map((c) => c.accent)).toEqual([false, true]);
    expect(metronome[0]!.time).toBeCloseTo(101.2, 6);
    expect(metronome[1]!.time).toBeCloseTo(101.8, 6);
  });
  // Motion study 05: the red travels from Play to the first note and lands as the note sounds.
  describe('the lead before the first note (the red travels meanwhile)', () => {
    it('holds the start back by leadSec when that is longer than the start delay', () => {
      const t = make({ startDelaySec: 0.05 });
      t.setCountIn(false);
      t.play({ leadSec: 0.2 });
      run(t, 0.3);
      expect(instrument.events[0]!.time).toBeCloseTo(100.2, 6);
    });

    // T13: a seek while playing holds the music back as long as the red hops to the new bar.
    it('holds a seek back by leadSec too, and goes on from the target', () => {
      const t = make({ startDelaySec: 0.05 });
      t.setCountIn(false);
      t.play();
      run(t, 1);
      const before = instrument.events.length;
      t.seek(5, { leadSec: 0.3 });
      expect(t.positionSec()).toBe(5); // holds at the target meanwhile
      expect(t.leadInRemainingSec()).toBeCloseTo(0.3, 6);
      run(t, 0.5);
      const after = instrument.events.slice(before);
      expect(after[0]!.time).toBeCloseTo(ctx.currentTime - 0.5 + 0.3, 6);
      expect(t.positionSec()).toBeGreaterThan(5);
    });

    it('counts down to the first note of the hands played, then reports null', () => {
      const t = make({ score: pickup });
      t.setCountIn(false);
      t.setMuted(['R']);
      expect(t.leadInRemainingSec()).toBeNull(); // stopped
      t.play();
      expect(t.leadInRemainingSec()).toBeCloseTo(0.6, 6); // the left hand's G2, at 0.6 s
      run(t, 0.25);
      expect(t.leadInRemainingSec()).toBeCloseTo(0.35, 6);
      run(t, 0.4);
      expect(t.leadInRemainingSec()).toBeNull(); // heard: the lead-in is over
    });

    it('counts the count-in in', () => {
      const t = make({ score: pickup });
      t.setCountIn(true);
      t.setMuted(['R']);
      t.play();
      // Two counted beats (1.2 s), then the muted pickup (0.6 s) before the left hand enters.
      expect(t.leadInRemainingSec()).toBeCloseTo(1.8, 6);
    });
  });

  describe('the lead-in (the cursor waits for it; polish plan Task 3 review)', () => {
    const TICK = 0.025;

    /** Records every lead-in report with the context time it arrived at. */
    function listenLeadIn(t: Transport) {
      const changes: { leadingIn: boolean; at: number }[] = [];
      t.onLeadInChange = (leadingIn) => changes.push({ leadingIn, at: ctx.currentTime });
      return changes;
    }

    it('with the right hand muted, ends when the left hand is heard, not at the start (the right hand plays a pickup)', () => {
      const t = make({ score: pickup });
      t.setCountIn(false);
      t.setMuted(['R']);
      const changes = listenLeadIn(t);
      t.play();
      expect(changes).toEqual([{ leadingIn: true, at: 100 }]);
      run(t, 0.55);
      expect(changes).toHaveLength(1); // the start is heard, but the left hand rests
      run(t, 0.1);
      expect(changes.map((c) => c.leadingIn)).toEqual([true, false]);
      expect(changes[1]!.at).toBeGreaterThanOrEqual(100.6 - 1e-9);
      expect(changes[1]!.at).toBeLessThanOrEqual(100.6 + TICK + 1e-9);
      expect(instrument.events[0]!.hand).toBe('L');
      expect(instrument.events[0]!.time).toBeCloseTo(100.6, 6);
      run(t, 7); // to the end: nothing more to report
      expect(t.state.playing).toBe(false);
      expect(changes).toHaveLength(2);
    });

    it('lasts the count-in, then until the first note of the hands played is heard', () => {
      // Both hands start on the downbeat: the count-in and the lead-in end in the same tick.
      const both = make();
      both.setCountIn(true);
      const changes = listenLeadIn(both);
      let countInEnd = Number.NaN;
      both.onCountInEnd = () => (countInEnd = ctx.currentTime);
      both.play();
      run(both, 2.6);
      expect(changes.map((c) => c.leadingIn)).toEqual([true, false]);
      expect(changes[1]!.at).toBe(countInEnd);
      expect(countInEnd).toBeGreaterThanOrEqual(102.5 - 1e-9);
      expect(countInEnd).toBeLessThanOrEqual(102.5 + TICK + 1e-9);

      // The left hand alone after a pickup: the count-in (two beats, 1.2 s) ends as the muted
      // pickup starts, the lead-in 0.6 s later, when the left hand's first note is heard.
      ctx.currentTime = 200;
      const left = make({ score: pickup });
      left.setCountIn(true);
      left.setMuted(['R']);
      const leftChanges = listenLeadIn(left);
      let leftCountInEnd = Number.NaN;
      left.onCountInEnd = () => (leftCountInEnd = ctx.currentTime);
      left.play();
      run(left, 1.7);
      expect(leftCountInEnd).toBeGreaterThanOrEqual(201.2 - 1e-9);
      expect(leftCountInEnd).toBeLessThanOrEqual(201.2 + TICK + 1e-9);
      expect(leftChanges.map((c) => c.leadingIn)).toEqual([true]);
      run(left, 0.2);
      expect(leftChanges.map((c) => c.leadingIn)).toEqual([true, false]);
      expect(leftChanges[1]!.at).toBeGreaterThanOrEqual(201.8 - 1e-9);
      expect(leftChanges[1]!.at).toBeLessThanOrEqual(201.8 + TICK + 1e-9);
    });

    it('follows a tempo change made during the count-in', () => {
      const t = make({ score: pickup });
      t.setCountIn(true);
      t.setMuted(['R']);
      const changes = listenLeadIn(t);
      t.play();
      run(t, 1); // the count-in's two beats last until 101.2
      t.setTempoFactor(2); // the music starts at 101.2 as counted, then runs twice as fast
      run(t, 0.45);
      expect(changes).toHaveLength(1);
      run(t, 0.1);
      expect(changes.map((c) => c.leadingIn)).toEqual([true, false]);
      expect(changes[1]!.at).toBeGreaterThanOrEqual(101.5 - 1e-9);
      expect(changes[1]!.at).toBeLessThanOrEqual(101.5 + TICK + 1e-9);
      expect(instrument.events[0]!.time).toBeCloseTo(101.5, 6);
    });

    it('starts again on a seek while playing, follows a hand switch, and ends on a pause', () => {
      const t = make({ score: pickup });
      t.setCountIn(false);
      const changes = listenLeadIn(t);
      const leading = () => changes.map((c) => c.leadingIn);
      t.play(); // both hands: the pickup at the start is heard at once (no start delay here)
      expect(leading()).toEqual([true, false]);
      run(t, 1);
      t.setMuted(['R']); // after the lead-in: nothing to report
      expect(leading()).toEqual([true, false]);
      t.rewind(); // a seek while playing: wait for the left hand's first note again
      expect(leading()).toEqual([true, false, true]);
      const rewound = ctx.currentTime;
      run(t, 0.3);
      expect(leading()).toHaveLength(3);
      // Both hands again: the pickup went by unplayed while its hand was muted, so the wait is
      // for bar 1, where both hands play at 0.6 s.
      t.setMuted([]);
      run(t, 0.35);
      expect(leading()).toEqual([true, false, true, false]);
      expect(changes[3]!.at).toBeGreaterThanOrEqual(rewound + 0.6 - 1e-9);
      expect(changes[3]!.at).toBeLessThanOrEqual(rewound + 0.6 + TICK + 1e-9);
      t.setMuted(['R']);
      t.rewind();
      expect(leading()).toEqual([true, false, true, false, true]);
      t.pause();
      expect(leading()).toEqual([true, false, true, false, true, false]);
      run(t, 2);
      expect(changes).toHaveLength(6);
      t.seek(1); // stopped: a seek only moves the start, and nothing is reported
      expect(changes).toHaveLength(6);
    });

    it('does not end on a note whose hand is muted after it was scheduled: it sounds, but the cursor does not mark it', () => {
      const t = make({ score: pickup, startDelaySec: 0.1 });
      t.setCountIn(false);
      const changes = listenLeadIn(t);
      t.play(); // the right hand's pickup is scheduled at once, to sound at 100.1
      expect(instrument.events.map((e) => e.hand)).toEqual(['R']);
      t.setMuted(['R']);
      run(t, 0.55); // past 100.1, when the muted pickup is heard
      expect(changes.map((c) => c.leadingIn)).toEqual([true]);
      run(t, 0.2); // the left hand's first note: 0.6 s after the start, heard at 100.7
      expect(changes.map((c) => c.leadingIn)).toEqual([true, false]);
      expect(changes[1]!.at).toBeGreaterThanOrEqual(100.7 - 1e-9);
      expect(changes[1]!.at).toBeLessThanOrEqual(100.7 + TICK + 1e-9);
    });

    it('waits for good in a loop where the hands played have no note, and reports nothing after dispose', () => {
      const t = make({ score: pickup });
      t.setCountIn(false);
      t.setMuted(['R']);
      t.setLoop({ from: 0, to: 0 }); // the pickup bar: the left hand rests
      const changes = listenLeadIn(t);
      t.play();
      run(t, 3);
      expect(changes.map((c) => c.leadingIn)).toEqual([true]);
      expect(instrument.events).toHaveLength(0);
      t.setLoop({ from: 0, to: 1 }); // now with the left hand's first note: the wait ends there
      run(t, 1.2);
      expect(changes.map((c) => c.leadingIn)).toEqual([true, false]);
      expect(instrument.events[0]!.hand).toBe('L');
      expect(changes[1]!.at).toBeGreaterThanOrEqual(instrument.events[0]!.time - 1e-9);
      expect(changes[1]!.at).toBeLessThanOrEqual(instrument.events[0]!.time + TICK + 1e-9);

      const disposed = make({ score: pickup });
      disposed.setMuted(['R']);
      disposed.setCountIn(false);
      const d = listenLeadIn(disposed);
      disposed.play();
      disposed.dispose();
      run(disposed, 2);
      expect(d.map((c) => c.leadingIn)).toEqual([true]);
    });

    // Polish plan Task 3 review: Happy Birthday's left hand alone, looping the pickup bar and
    // bar 1. After every wrap the cursor marked the left hand's first chord through the muted
    // pickup, 0.6 s before it sounded. A wrap to a start where the hands played rest now starts
    // a lead-in when it is heard, as a seek does.
    it('starts again at each loop wrap to a start where the hands played rest, until their first note of the new pass is heard', () => {
      // The pickup bar and bar 1 (0 to 2.4 s), the right hand muted: every pass opens with the
      // muted pickup, and the left hand's G2 comes 0.6 s in. Wraps at 102.4 and 104.8.
      const t = make({ score: pickup });
      t.setCountIn(false);
      t.setMuted(['R']);
      t.setLoop({ from: 0, to: 1 });
      const changes = listenLeadIn(t);
      const leading = () => changes.map((c) => c.leadingIn);
      t.play();
      run(t, 2.39);
      expect(leading()).toEqual([true, false]); // the first pass: from Play until G2 at 100.6
      expect(t.leadingIn()).toBe(false);
      // The wrap is heard: the transport knows the lead-in at once (the cursor asks it on every
      // frame), and its next scheduler tick reports it.
      ctx.currentTime = 102.405;
      expect(t.leadingIn()).toBe(true);
      expect(changes).toHaveLength(2);
      t.step();
      expect(leading()).toEqual([true, false, true]);
      expect(changes[2]!.at).toBe(102.405);
      run(t, 2.25); // to 104.655, before the second wrap
      // Two passes: the lead-in ends when G2 of the second pass is heard, at 103.0.
      expect(leading()).toEqual([true, false, true, false]);
      expect(changes[3]!.at).toBeGreaterThanOrEqual(103.0 - 1e-9);
      expect(changes[3]!.at).toBeLessThanOrEqual(103.0 + TICK + 1e-9);
      expect(t.leadingIn()).toBe(false);
      run(t, 0.8); // the third pass: the same again from the wrap at 104.8 to G2 at 105.4
      expect(leading()).toEqual([true, false, true, false, true, false]);
      expect(changes[4]!.at).toBeGreaterThanOrEqual(104.8 - 1e-9);
      expect(changes[4]!.at).toBeLessThanOrEqual(104.8 + TICK + 1e-9);
      expect(changes[5]!.at).toBeGreaterThanOrEqual(105.4 - 1e-9);
      expect(changes[5]!.at).toBeLessThanOrEqual(105.4 + TICK + 1e-9);
      expect(new Set(instrument.events.map((e) => e.hand))).toEqual(new Set(['L']));
      expect(instrument.events.map((e) => +e.time.toFixed(6))).toEqual([100.6, 103, 105.4]);
    });

    it('starts none at a loop wrap to a note of the hands played, nor at a wrap scheduled before a seek', () => {
      // Both hands, the pickup bar and bar 1: every pass opens with the right hand's pickup.
      const both = make({ score: pickup });
      both.setCountIn(false);
      both.setLoop({ from: 0, to: 1 });
      const bothChanges = listenLeadIn(both);
      both.play();
      run(both, 2.4);
      expect(both.leadingIn()).toBe(false); // the wrap at 102.4 is heard, with the pickup
      run(both, 2.6);
      expect(bothChanges.map((c) => c.leadingIn)).toEqual([true, false]);

      // The left hand alone, bar 1 (0.6 to 2.4 s): every pass opens with its G2.
      ctx.currentTime = 200;
      const left = make({ score: pickup });
      left.setCountIn(false);
      left.setMuted(['R']);
      left.setLoop({ from: 1, to: 1 });
      const leftChanges = listenLeadIn(left);
      left.play();
      run(left, 1.8);
      expect(left.leadingIn()).toBe(false); // the wrap at 201.8 is heard, with G2
      run(left, 2);
      expect(leftChanges.map((c) => c.leadingIn)).toEqual([true, false]);

      // A seek just before a scheduled wrap is heard: the seek leads in to its own target, and the
      // wrap, which will not sound, starts nothing.
      ctx.currentTime = 300;
      const sought = make({ score: pickup });
      sought.setCountIn(false);
      sought.setMuted(['R']);
      sought.setLoop({ from: 0, to: 1 });
      const soughtChanges = listenLeadIn(sought);
      sought.play();
      run(sought, 2.35); // the wrap at 302.4 is scheduled (the look-ahead is 150 ms)
      sought.seek(0.6); // G2, heard at once (no start delay here)
      run(sought, 1.6); // past 302.4, before the seek's own wrap at 304.15
      expect(soughtChanges.map((c) => c.leadingIn)).toEqual([true, false, true, false]);
      expect(sought.leadingIn()).toBe(false);
    });
  });
  it('seek and pause', () => {
    const t = make();
    t.setCountIn(false);
    t.seek(10);
    t.play();
    run(t, 1);
    expect(instrument.events[0]!.time).toBeGreaterThanOrEqual(100);
    expect(Math.min(...instrument.events.map((e) => e.time - 100 + 10))).toBeGreaterThanOrEqual(10);
    t.pause();
    const n = instrument.events.length;
    run(t, 2);
    expect(instrument.events).toHaveLength(n);
    expect(t.state.playing).toBe(false);
    expect(t.positionSec()).toBeCloseTo(11, 2);
  });
});

describe('Transport in performance order (repeats and jumps, issue 50)', () => {
  // Whole notes C D E F G A at 120 qpm in 4/4: two seconds a bar.
  const form = (name: string): Score =>
    parseMusicXml(
      readFileSync(
        fileURLToPath(
          new URL(`../../../../packages/engine/fixtures/${name}.musicxml`, import.meta.url),
        ),
        'utf8',
      ),
    ).score;
  const repeat = form('form-repeat'); // bars 1 2 | 1 2
  const fine = form('form-dc-al-fine'); // bars 1 2 3 4 | 1 2
  const voltas = form('form-voltas'); // bars 1 2 3 | 1 2 | 4
  const heard = () => instrument.events.map((e) => [e.midi, e.time - 100] as const);

  function playToEnd(piece: Score, seconds: number) {
    const t = make({ score: piece });
    t.setCountIn(false);
    let ends = 0;
    t.onEnd = () => ends++;
    t.play();
    run(t, seconds);
    return { t, ends: () => ends };
  }

  it('plays the repeated bars again and ends once, with the position back in the written score', () => {
    const t = make({ score: repeat });
    t.setCountIn(false);
    let ends = 0;
    t.onEnd = () => ends++;
    t.play();
    run(t, 5);
    expect(t.positionSec()).toBeCloseTo(1, 2); // second hearing of bar 1
    run(t, 3.1);
    expect(ends).toBe(1);
    expect(heard().map(([midi, sec]) => [midi, Math.round(sec * 10) / 10])).toEqual([
      [60, 0],
      [62, 2],
      [60, 4],
      [62, 6],
    ]);
    expect(t.state.playing).toBe(false);
    expect(t.positionSec()).toBeCloseTo(4, 6);
    expect(t.startSec()).toBe(0);
  });

  it('resumes a pause on the second hearing without a third', () => {
    const t = make({ score: repeat });
    t.setCountIn(false);
    let ends = 0;
    t.onEnd = () => ends++;
    t.play();
    run(t, 5);
    t.pause();
    expect(t.positionSec()).toBeCloseTo(1, 2);
    expect(t.startSec()).toBeCloseTo(1, 2);
    t.play();
    run(t, 3.1);
    expect(ends).toBe(1);
  });

  it('seeks to the next hearing of a bar going forward and the last going back', () => {
    // Playing in the first hearing of bar 1 (at 1 s): bar 2 is next, at its first hearing (perf 2),
    // so the music runs on through the second pass: 6 s more, to perf 8. At its second hearing
    // (perf 6) it would end after 2 s.
    const forward = make({ score: repeat });
    forward.setCountIn(false);
    let forwardEnds = 0;
    forward.onEnd = () => forwardEnds++;
    forward.play();
    run(forward, 1);
    forward.seek(2);
    run(forward, 3.1); // perf 5.1: the second hearing of bar 1
    expect(forward.state.playing).toBe(true);
    expect(forward.positionSec()).toBeCloseTo(1.1, 1);
    run(forward, 3);
    expect(forwardEnds).toBe(1);
    // Playing in the second hearing of bar 1 (at 5): bar 2 is the second hearing, ending in 2 s.
    const second = make({ score: repeat });
    second.setCountIn(false);
    let ends = 0;
    second.onEnd = () => ends++;
    second.play();
    run(second, 5);
    second.seek(2);
    run(second, 2.1);
    expect(ends).toBe(1);
    // And back: from the second hearing of bar 2 (perf 7), bar 1 is its last hearing at or before,
    // perf 4.5, which ends 3.5 s on. The first hearing (perf 0.5) would play 7.5 s more.
    const back = make({ score: repeat });
    back.setCountIn(false);
    let backEnds = 0;
    back.onEnd = () => backEnds++;
    back.play();
    run(back, 7);
    back.seek(0.5);
    run(back, 0.1);
    expect(back.positionSec()).toBeCloseTo(0.6, 1);
    expect(back.state.playing).toBe(true);
    run(back, 3.5);
    expect(backEnds).toBe(1);
    expect(back.state.playing).toBe(false);
  });

  it('seeks, stopped, to the next hearing from where Play would start', () => {
    const t = make({ score: fine });
    t.setCountIn(false);
    t.seek(0);
    t.play();
    run(t, 13); // the whole piece, 12 s: ended
    expect(t.state.playing).toBe(false);
    t.seek(2); // bar 2, after the end: the next hearing from the top, not the last one
    expect(t.startSec()).toBeCloseTo(2, 6);
    t.play();
    run(t, 2.1);
    expect(t.state.playing).toBe(true);
    run(t, 10);
    expect(t.state.playing).toBe(false);
  });

  it('seeks to a bar the order does not end on: the last bar of a D.C. al Fine', () => {
    const t = make({ score: fine });
    t.setCountIn(false);
    t.seek(6); // bar 4, the D.C. bar, written 6 s
    expect(t.positionSec()).toBeCloseTo(6, 6);
    expect(t.startSec()).toBeCloseTo(6, 6);
    t.play();
    run(t, 0.5);
    expect(t.positionSec()).toBeCloseTo(6.5, 1);
    run(t, 6); // the D.C. bar, then bars 1 and 2 again, to the Fine
    expect(t.state.playing).toBe(false);
    expect(heard().map(([midi]) => midi)).toEqual([65, 60, 62]);
  });

  it('plays a D.C. al Fine to the Fine', () => {
    const { ends } = playToEnd(fine, 13);
    expect(heard().map(([midi]) => midi)).toEqual([60, 62, 64, 65, 60, 62]);
    expect(ends()).toBe(1);
  });

  it('ends at 12 s for the D.C. al Fine and reports the end of the last hearing', () => {
    const t = make({ score: fine });
    t.setCountIn(false);
    let endedAt = 0;
    t.onEnd = () => {
      endedAt = ctx.currentTime;
    };
    t.play();
    run(t, 13);
    expect(endedAt).toBeGreaterThanOrEqual(111.99);
    expect(endedAt).toBeLessThan(112.2);
  });

  it('moves a loop set while playing to its stretch of the performance, not the written seconds', () => {
    // Bars 1 2 3 | 1 2 | 4, two seconds each. Bars 3 and 4 are not heard in a row: the loop runs
    // from the first hearing of bar 3 to the end of bar 4, perf 4..12. Written, they are 4..8.
    const t = make({ score: voltas });
    t.setCountIn(false);
    t.play();
    run(t, 1);
    t.setLoop({ from: 2, to: 3 });
    run(t, 0.1);
    expect(t.positionSec()).toBeGreaterThanOrEqual(4 - 1e-6); // moved to the start of bar 3
    run(t, 5.5); // perf 9.6: inside the second hearing of bar 2, which a written loop never plays
    expect(t.positionSec()).toBeCloseTo(3.6, 1); // written bar 2
    expect(heard().map(([midi]) => midi)).toEqual([60, 64, 60, 62]); // C, then E C D from perf 4
    run(t, 6); // wraps at 12 and goes on
    expect(t.state.playing).toBe(true);
  });

  it('keeps a loop that holds the music where it is, in a later hearing', () => {
    const t = make({ score: repeat });
    t.setCountIn(false);
    t.play();
    run(t, 5); // the second hearing of bar 1, perf 5
    t.setLoop({ from: 0, to: 1 }); // the stretches are perf 0..4 and 4..8: the music is in the second
    run(t, 1.1); // perf 6.1
    expect(t.positionSec()).toBeCloseTo(2.1, 1);
    expect(heard().map(([midi, sec]) => [midi, Math.round(sec)])).toEqual([
      [60, 0],
      [62, 2],
      [60, 4],
      [62, 6],
    ]);
    run(t, 2.1); // wraps at 8 to 4: bar 1 again
    expect(t.state.playing).toBe(true);
    expect(heard().at(-1)![0]).toBe(60);
  });

  it('counts the metronome clicks of each hearing, the sub-beats too', () => {
    const t = make({ score: repeat });
    t.setCountIn(false);
    t.setMetronome(true);
    t.play();
    run(t, 8.1);
    // 4 clicks a beat, 4 beats a bar, 4 bars heard: the repeat clicks its own again.
    expect(clicks).toHaveLength(64);
  });

  describe('the position in performance seconds (play along, issue 182)', () => {
    it('seekPerformance, stopped, sets where play() starts: the second hearing of a repeat', () => {
      // Bars 1 2 | 1 2, two seconds a bar: perf 5 is one second into the second hearing of bar 1.
      const t = make({ score: repeat });
      t.setCountIn(false);
      let ends = 0;
      t.onEnd = () => ends++;
      t.seekPerformance(5);
      expect(t.performanceStartSec()).toBeCloseTo(5, 6);
      expect(t.startSec()).toBeCloseTo(1, 6); // written: one second into bar 1
      expect(t.positionSec()).toBeCloseTo(1, 6);
      t.play();
      run(t, 2.9);
      expect(ends).toBe(0);
      run(t, 0.3);
      expect(ends).toBe(1); // the third second of the second hearing: the piece ends at perf 8
      expect(t.state.playing).toBe(false);
    });

    it('enters the hearing it is told to, where a written seek takes the first', () => {
      // The same bar, written second 1: `seek` goes forward from the top and takes the first
      // hearing; a walk made of written seeks would loop there forever.
      const written = make({ score: repeat });
      written.seek(1);
      expect(written.performanceStartSec()).toBeCloseTo(1, 6);
      const performed = make({ score: repeat });
      performed.seekPerformance(5);
      expect(performed.performanceStartSec()).toBeCloseTo(5, 6);
    });

    it('seekPerformance clamps to the piece', () => {
      const t = make({ score: repeat });
      t.seekPerformance(-3);
      expect(t.performanceStartSec()).toBe(0);
      t.seekPerformance(99);
      expect(t.positionSec()).toBeCloseTo(4, 6); // the end of the order, back in the written score
    });

    it('performanceStartSec follows a loop: its start when the position lies outside it', () => {
      // Bars 1 2 3 | 1 2 | 4: the loop over bars 3 and 4 runs from perf 4 to 12.
      const t = make({ score: voltas });
      t.setLoop({ from: 2, to: 3 });
      expect(t.performanceLoop()).toEqual({ from: 4, to: 12 });
      expect(t.performanceStartSec()).toBe(4); // the position, 0, lies outside
      expect(t.startSec()).toBeCloseTo(4, 6);
      t.seekPerformance(8);
      expect(t.performanceStartSec()).toBe(8); // inside: unchanged
      expect(t.startSec()).toBeCloseTo(2, 6); // the second hearing of bar 2, written 2 s
      t.seekPerformance(2);
      expect(t.performanceStartSec()).toBe(4);
      t.seekPerformance(12); // the loop's end is outside it
      expect(t.performanceStartSec()).toBe(4);
      t.setLoop(null);
      expect(t.performanceStartSec()).toBe(0); // the end is the top again
    });

    it('performanceLoop is the stretch chosen at setLoop: the one holding the position, else the first', () => {
      const first = make({ score: repeat });
      expect(first.performanceLoop()).toBeNull();
      first.setLoop({ from: 0, to: 1 });
      expect(first.performanceLoop()).toEqual({ from: 0, to: 4 });
      first.setLoop(null);
      expect(first.performanceLoop()).toBeNull();

      const second = make({ score: repeat });
      second.seekPerformance(5);
      second.setLoop({ from: 0, to: 1 });
      expect(second.performanceLoop()).toEqual({ from: 4, to: 8 });
      second.seekPerformance(1); // a later seek does not choose another stretch
      expect(second.performanceLoop()).toEqual({ from: 4, to: 8 });
    });
  });
});
