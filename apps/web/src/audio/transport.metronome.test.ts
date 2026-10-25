// @vitest-environment node
import { readFileSync } from 'node:fs';
import { parseMusicXml, type Score } from '@digitus2/engine';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ClickLevel } from './beats.js';
import { measureStartSec } from './beats.js';
import type { AudioClock } from './clock.js';
import { createSilentInstrument } from './instrument.js';
import { Transport } from './transport.js';

// The metronome clicks four times a beat (issue 203): the beat and three sub-beats at its
// quarters, the bar's first beat above the other beats above the sub-beats, thinned where the
// heard spacing would blur. The count-in clicks beats only.

/** short-piano is 4/4 at 96 qpm: a beat is 0.625 s, a quarter of it 0.15625 s, a bar 2.5 s. */
const { score } = parseMusicXml(
  readFileSync(new URL('../../fixtures/short-piano.musicxml', import.meta.url), 'utf8'),
);
const QUARTER_SEC = 0.15625;
const BAR_SEC = 2.5;

/** 4/4 at `qpm`: `bars` bars of four quarter notes. */
function quarters(qpm: number, bars: number): Score {
  const note =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration>' +
    '<voice>1</voice><type>quarter</type></note>';
  const attributes =
    '<attributes><divisions>2</divisions><key><fifths>0</fifths></key>' +
    '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
    '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
    `<per-minute>${qpm}</per-minute></metronome></direction-type><sound tempo="${qpm}"/></direction>`;
  const measures = Array.from(
    { length: bars },
    (_, i) => `<measure number="${i + 1}">${i === 0 ? attributes : ''}${note.repeat(4)}</measure>`,
  ).join('');
  return parseMusicXml(
    '<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part>' +
      `</part-list><part id="P">${measures}</part></score-partwise>`,
  ).score;
}

/** A beat's four clicks, by level, and a 4/4 bar's sixteen. */
const BEAT: ClickLevel[] = ['beat', 'sub', 'sub', 'sub'];
const BAR: ClickLevel[] = ['bar', 'sub', 'sub', 'sub', ...BEAT, ...BEAT, ...BEAT];
/** A bar of beats alone, and of beats and their halves. */
const BAR_OF_BEATS: ClickLevel[] = ['bar', 'beat', 'beat', 'beat'];
const BAR_OF_HALVES: ClickLevel[] = ['bar', 'sub', 'beat', 'sub', 'beat', 'sub', 'beat', 'sub'];

let ctx: AudioClock;
let instrument: ReturnType<typeof createSilentInstrument>;
/** What the transport handed the click callback, with the spy it got back as the click's stop. */
let clicks: { time: number; level: ClickLevel; stop: Mock<() => void> }[];
/** A transport with the metronome on and the count-in off, clicking into `clicks`. */
function make(piece: Score = score) {
  const t = new Transport(
    {
      ctx,
      instrument,
      score: piece,
      click: (time, level) => {
        const stop = vi.fn();
        clicks.push({ time, level, stop });
        return stop;
      },
      setInterval: (() => 0) as never,
      clearInterval: () => {},
    },
    { startDelaySec: 0, lookAheadSec: 0.15 },
  );
  t.setMetronome(true);
  t.setCountIn(false);
  return t;
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
/** The clicks that sound in `[from, to)` context seconds. */
const within = (from: number, to: number) =>
  clicks.filter((c) => c.time >= from - 1e-6 && c.time < to - 1e-6);
const levels = (list: { level: ClickLevel }[]) => list.map((c) => c.level);
const repeated = <T>(items: T[], times: number): T[] =>
  Array.from({ length: times }, () => items).flat();

beforeEach(() => {
  ctx = { currentTime: 100 };
  instrument = createSilentInstrument();
  clicks = [];
});

describe('the metronome of the transport (issue 203)', () => {
  it('clicks four times a beat, the bar above the beats above the sub-beats', () => {
    const t = make();
    t.play();
    run(t, 21);
    expect(clicks).toHaveLength(8 * 16);
    expect(levels(clicks)).toEqual(repeated(BAR, 8));
    clicks.forEach((c, i) => expect(c.time).toBeCloseTo(100 + i * QUARTER_SEC, 6));
  });

  it('counts in beats only and starts the sub-beats with the music', () => {
    const t = make();
    t.setCountIn(true);
    t.play();
    run(t, 4);
    // One whole bar of four beats, 0.625 s apart; the music enters 2.5 s after Play.
    const countIn = within(100, 100 + BAR_SEC);
    expect(countIn.map((c) => c.time)).toEqual([100, 100.625, 101.25, 101.875]);
    expect(levels(countIn)).toEqual(['bar', 'beat', 'beat', 'beat']);
    const music = within(100 + BAR_SEC, 105);
    expect(levels(music).slice(0, 8)).toEqual(BAR.slice(0, 8));
    music.slice(0, 8).forEach((c, i) => {
      expect(c.time).toBeCloseTo(100 + BAR_SEC + i * QUARTER_SEC, 6);
    });
    expect(instrument.events[0]!.time).toBeCloseTo(100 + BAR_SEC, 6);
  });

  it('clicks two a beat at a fast tempo, and four at half of it', () => {
    // 200 qpm: a beat is 0.3 s, a quarter of it 75 ms, under the 90 ms floor; a half is 150 ms.
    const fast = make(quarters(200, 2));
    fast.play();
    run(fast, 3);
    expect(levels(clicks)).toEqual(repeated(BAR_OF_HALVES, 2));
    clicks.forEach((c, i) => expect(c.time).toBeCloseTo(100 + i * 0.15, 6));

    // At half speed the quarters are 150 ms apart: all four are heard.
    clicks = [];
    ctx.currentTime = 200;
    const slowed = make(quarters(200, 2));
    slowed.setTempoFactor(0.5);
    slowed.play();
    run(slowed, 5.5);
    expect(levels(clicks)).toEqual(repeated(BAR, 2));
    clicks.forEach((c, i) => expect(c.time).toBeCloseTo(200 + i * 0.15, 6));
  });

  it('clicks the beats alone when even the halves would blur', () => {
    // 400 qpm: a beat is 0.15 s, a half of it 75 ms.
    const t = make(quarters(400, 3));
    t.play();
    run(t, 2);
    expect(levels(clicks)).toEqual(repeated(BAR_OF_BEATS, 3));
    clicks.forEach((c, i) => expect(c.time).toBeCloseTo(100 + i * 0.15, 6));
  });

  it('thins the clicks scheduled after a tempo change that crosses the floor', () => {
    // 150 qpm: a beat is 0.4 s and a quarter of it 100 ms. At 1.5 times the quarters are 67 ms
    // apart and the halves 133 ms.
    const t = make(quarters(150, 4));
    t.play();
    run(t, 1);
    t.setTempoFactor(1.5);
    run(t, 8);
    // What was scheduled up to 101.15 (the look-ahead when the tempo changed) keeps its four.
    const before = within(100, 101.15);
    expect(before).toHaveLength(12);
    before.forEach((c, i) => expect(c.time).toBeCloseTo(100 + i * 0.1, 6));
    // After it the beats and their halves alone: clicks 12, 14, ... 62 of the 64, 0.2 s of score
    // apart and so 133 ms heard apart.
    const after = within(101.15, 110);
    expect(after).toHaveLength(26);
    after.forEach((c, i) => {
      expect(c.time).toBeCloseTo(101.15 + (0.2 * (i + 6) - 1.15) / 1.5, 6);
    });
    expect(clicks).toHaveLength(before.length + after.length);
  });

  it('brings the sub-beats back when a tempo change takes the floor away', () => {
    const t = make(quarters(150, 8));
    t.setTempoFactor(1.5);
    t.play();
    run(t, 1);
    expect(levels(within(100, 101))).toEqual(BAR_OF_HALVES); // the halves alone, 133 ms apart
    t.setTempoFactor(1);
    run(t, 2);
    // From the first click after the change on, a click every 100 ms again.
    const back = within(101.2, 103);
    expect(back.length).toBeGreaterThan(15);
    for (let i = 1; i < back.length; i++) {
      expect(back[i]!.time - back[i - 1]!.time).toBeCloseTo(0.1, 6);
    }
  });

  it('clicks each pass of a loop on its own grid, and none at or past the loop end', () => {
    const t = make();
    t.setLoop({ from: 1, to: 2 }); // bars 2 and 3: 2.5 s to 7.5 s, 5 s a pass
    t.play();
    run(t, 10);
    const first = within(100, 105);
    const second = within(105, 110);
    expect(levels(first)).toEqual(repeated(BAR, 2));
    expect(levels(second)).toEqual(repeated(BAR, 2));
    first.forEach((c, i) => expect(c.time).toBeCloseTo(100 + i * QUARTER_SEC, 6));
    second.forEach((c, i) => expect(c.time).toBeCloseTo(105 + i * QUARTER_SEC, 6));
    // The pass ends with its last sub-beat, 5 - 0.15625 s in; the next opens on a bar click at 105.
    expect(first[first.length - 1]!.time).toBeCloseTo(105 - QUARTER_SEC, 6);
    expect(second[0]!.level).toBe('bar');
    expect(second[0]!.time).toBeCloseTo(105, 6);
    // The third pass has begun, on a bar click.
    expect(within(110, 111)[0]).toMatchObject({ level: 'bar' });
  });

  it('resumes on the grid after a seek to a bar: a bar click at the seek, nothing before it', () => {
    const t = make();
    t.play();
    run(t, 1);
    const sounded = clicks.length;
    t.seek(measureStartSec(score, 2)); // bar 3, 5 s in; the music comes in at 101 now
    run(t, 1);
    const after = clicks.slice(sounded);
    expect(after[0]).toMatchObject({ time: 101, level: 'bar' });
    expect(levels(after).slice(0, 5)).toEqual(BAR.slice(0, 5));
    after.forEach((c, i) => expect(c.time).toBeCloseTo(101 + i * QUARTER_SEC, 6));
  });

  it('resumes on the grid after a seek between two clicks: the next click, never one already past', () => {
    const t = make();
    t.play();
    run(t, 1);
    const sounded = clicks.length;
    t.seek(3); // 0.5 s into bar 2: between the sub-beats at 2.96875 s and the beat at 3.125 s
    run(t, 1);
    const after = clicks.slice(sounded);
    expect(after.every((c) => c.time >= 101)).toBe(true);
    expect(after[0]!.level).toBe('beat');
    expect(after[0]!.time).toBeCloseTo(101 + (3.125 - 3), 6);
    expect(levels(after).slice(0, 4)).toEqual(['beat', 'sub', 'sub', 'sub']);
  });
});

// A click handed to the audio clock sounds at its time unless it is stopped, like a note: Pause
// and a seek cut the ones still to come, which with sub-beats are most of the look-ahead.
describe('the clicks still to sound when the music stops (issue 203)', () => {
  it('stops the clicks not yet heard at Pause, and none already heard', () => {
    const t = make();
    t.play();
    run(t, 1); // heard up to 101, scheduled up to 101.15
    const heard = clicks.filter((c) => c.time <= 101);
    const pending = clicks.filter((c) => c.time > 101);
    expect(heard.length).toBeGreaterThan(5);
    expect(pending.length).toBeGreaterThan(0);
    t.pause();
    for (const c of pending) expect(c.stop).toHaveBeenCalledTimes(1);
    for (const c of heard) expect(c.stop).not.toHaveBeenCalled();
  });

  it('stops a count-in click not yet heard at Pause too', () => {
    const t = make();
    t.setCountIn(true);
    t.play();
    run(t, 0.5); // the first beat is heard; the second, at 100.625, is scheduled
    expect(clicks.map((c) => c.time)).toEqual([100, 100.625]);
    t.pause();
    expect(clicks[0]!.stop).not.toHaveBeenCalled();
    expect(clicks[1]!.stop).toHaveBeenCalledTimes(1);
  });

  it('stops the clicks not yet heard at a seek while playing, and not the ones it schedules', () => {
    const t = make();
    t.play();
    run(t, 1);
    const sounded = clicks.length;
    const pending = clicks.filter((c) => c.time > 101);
    const heard = clicks.filter((c) => c.time <= 101);
    t.seek(measureStartSec(score, 2));
    run(t, 1);
    for (const c of pending) expect(c.stop).toHaveBeenCalledTimes(1);
    for (const c of heard) expect(c.stop).not.toHaveBeenCalled();
    const after = clicks.slice(sounded);
    expect(after.length).toBeGreaterThan(5);
    for (const c of after) expect(c.stop).not.toHaveBeenCalled();
  });

  it('calls each stop once: a later Pause leaves the earlier ones alone', () => {
    const t = make();
    t.play();
    run(t, 1);
    const first = clicks.filter((c) => c.time > 101);
    t.pause();
    t.play();
    run(t, 1);
    t.pause();
    expect(first.length).toBeGreaterThan(0);
    for (const c of first) expect(c.stop).toHaveBeenCalledTimes(1);
  });

  it('stops the clicks not yet heard when the transport is disposed while playing', () => {
    const t = make();
    t.play();
    run(t, 1);
    const pending = clicks.filter((c) => c.time > 101);
    t.dispose();
    expect(pending.length).toBeGreaterThan(0);
    for (const c of pending) expect(c.stop).toHaveBeenCalledTimes(1);
  });

  it('lets the clicks of the piece play out to its end', () => {
    const t = make(quarters(120, 1));
    t.play();
    run(t, 3); // 2 s of music: the end is heard, the transport halts by itself
    expect(t.state.playing).toBe(false);
    expect(clicks.length).toBe(16);
    for (const c of clicks) expect(c.stop).not.toHaveBeenCalled();
  });
});
