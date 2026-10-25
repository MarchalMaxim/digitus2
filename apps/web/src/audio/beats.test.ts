// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { parseMusicXml, type Score } from '@digitus2/engine';
import { ticksToSeconds } from '@digitus2/engine/score-build';
import { describe, expect, it } from 'vitest';
import {
  beatTicksAt,
  buildBeats,
  buildClicks,
  CLICKS_PER_BEAT,
  clickHeard,
  countInBar,
  measureEndSec,
  measureStartSec,
  MIN_CLICK_GAP_SEC,
  type Click,
  type ClickLevel,
} from './beats.js';

const { score } = parseMusicXml(
  readFileSync(new URL('../../fixtures/short-piano.musicxml', import.meta.url), 'utf8'),
);
/** 3/4 at 100 qpm with a one-beat pickup (bar 0, 0.6 s), then three full bars. */
const { score: pickup } = parseMusicXml(
  readFileSync(new URL('../../fixtures/pickup-piano.musicxml', import.meta.url), 'utf8'),
);

describe('beats', () => {
  it('builds four beats per 4/4 bar at 96 qpm, accenting the downbeat', () => {
    const beats = buildBeats(score);
    expect(beats).toHaveLength(8 * 4);
    expect(beats.slice(0, 5).map((b) => b.sec)).toEqual([0, 0.625, 1.25, 1.875, 2.5]);
    expect(beats.slice(0, 5).map((b) => b.accent)).toEqual([true, false, false, false, true]);
    expect(beats[4]!.measureIndex).toBe(1);
  });
  it('maps measures to seconds', () => {
    expect(measureStartSec(score, 1)).toBeCloseTo(2.5, 6);
    expect(measureEndSec(score, 1)).toBeCloseTo(5.0, 6);
    expect(measureEndSec(score, 7)).toBeCloseTo(20.0, 6);
  });
  it('counts in one full bar before a full measure: its own beats, numbered 1 to 4', () => {
    const full = countInBar(score, buildBeats(score), 1);
    expect(full.clicks).toHaveLength(4);
    full.clicks.forEach((c, k) => expect(c.offsetSec).toBeCloseTo(0.625 * k, 9));
    expect(full.clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
    expect(full.clicks.map((c) => c.beatInBar)).toEqual([1, 2, 3, 4]);
    expect(full.lengthSec).toBeCloseTo(2.5, 9);
  });

  // Polish plan Task 3 review: the count-in before a pickup was its length alone (a lone "1"
  // before Happy Birthday), then a whole bar, which put the pickup where the counted meter has
  // beat 1 and the real downbeat on the counted beat 2. It now keeps the bar grid.
  it('counts in the beats of the bar before a pickup, so the pickup enters on its written beat', () => {
    // 3/4 at 100 qpm, a one-beat pickup: "1", "2", and the pickup is beat 3, 1.2 s later.
    expect(pickup.measures[0]!.lengthTicks).toBe(pickup.divisions);
    const beats = buildBeats(pickup);
    const bar = countInBar(pickup, beats, 0);
    expect(bar.clicks.map((c) => c.beatInBar)).toEqual([1, 2]);
    expect(bar.clicks.map((c) => c.accent)).toEqual([true, false]);
    bar.clicks.forEach((c, k) => expect(c.offsetSec).toBeCloseTo(0.6 * k, 9));
    expect(bar.lengthSec).toBeCloseTo(1.2, 9);
    // The first full bar of the same piece counts its own three beats.
    const next = countInBar(pickup, beats, 1);
    expect(next.clicks.map((c) => c.beatInBar)).toEqual([1, 2, 3]);
    next.clicks.forEach((c, k) => expect(c.offsetSec).toBeCloseTo(0.6 * k, 9));
    expect(next.lengthSec).toBeCloseTo(1.8, 9);

    // 4/4 at 120 qpm, an eighth-note pickup: "1 2 3 4", and it enters on the "and" of 4.
    const eighth = withPickup(4, 1);
    const eighthBar = countInBar(eighth, buildBeats(eighth), 0);
    expect(eighthBar.clicks.map((c) => c.beatInBar)).toEqual([1, 2, 3, 4]);
    expect(eighthBar.clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
    eighthBar.clicks.forEach((c, k) => expect(c.offsetSec).toBeCloseTo(0.5 * k, 9));
    expect(eighthBar.lengthSec).toBeCloseTo(1.75, 9);

    // 4/4 at 120 qpm, a three-beat pickup: only "1" comes before it, too short to count with, so
    // a whole bar comes first: "1 2 3 4 1", and it enters on 2.
    const long = withPickup(4, 6);
    const longBar = countInBar(long, buildBeats(long), 0);
    expect(longBar.clicks.map((c) => c.beatInBar)).toEqual([1, 2, 3, 4, 1]);
    expect(longBar.clicks.map((c) => c.accent)).toEqual([true, false, false, false, true]);
    longBar.clicks.forEach((c, k) => expect(c.offsetSec).toBeCloseTo(0.5 * k, 9));
    expect(longBar.lengthSec).toBeCloseTo(2.5, 9);
  });

  // Polish plan Task 3 review: the metronome accented the pickup's beat as a downbeat.
  it("puts a pickup on the beat grid of its bar: its beats are the bar's last ones, none accented", () => {
    const beats = buildBeats(pickup);
    const inPickup = beats.filter((b) => b.measureIndex === 0);
    expect(inPickup).toEqual([{ tick: 0, sec: 0, accent: false, measureIndex: 0, beatInBar: 3 }]);
    // Bar 1 starts on an accented beat 1, 0.6 s in.
    const bar1 = beats.filter((b) => b.measureIndex === 1);
    expect(bar1.map((b) => b.beatInBar)).toEqual([1, 2, 3]);
    expect(bar1.map((b) => b.accent)).toEqual([true, false, false]);
    expect(bar1[0]!.sec).toBeCloseTo(0.6, 9);

    // An eighth-note pickup in 4/4 holds no beat of its own (it is the "and" of 4).
    const eighth = buildBeats(withPickup(4, 1));
    expect(eighth.filter((b) => b.measureIndex === 0)).toEqual([]);
    expect(eighth[0]).toMatchObject({ measureIndex: 1, accent: true, beatInBar: 1 });
    expect(eighth[0]!.sec).toBeCloseTo(0.25, 9);

    // A three-beat pickup in 4/4 holds beats 2, 3 and 4.
    const long = buildBeats(withPickup(4, 6)).filter((b) => b.measureIndex === 0);
    expect(long.map((b) => b.beatInBar)).toEqual([2, 3, 4]);
    expect(long.map((b) => b.accent)).toEqual([false, false, false]);
    long.forEach((b, k) => expect(b.sec).toBeCloseTo(0.5 * k, 9));
  });

  it('gives a short bar after the first no pickup lead: it starts on beat 1', () => {
    // 4/4 at 120 qpm: a full first bar, then a bar of two quarters (a short bar, not a pickup).
    const short = withShortSecondBar();
    expect(short.measures[1]!.lengthTicks).toBe(short.divisions * 2);
    const bar1 = buildBeats(short).filter((b) => b.measureIndex === 1);
    expect(bar1.map((b) => b.beatInBar)).toEqual([1, 2]);
    expect(bar1.map((b) => b.accent)).toEqual([true, false]);
    expect(bar1[0]!.sec).toBeCloseTo(2, 9);
    expect(bar1[1]!.sec).toBeCloseTo(2.5, 9);
  });
});

/** A score that is only its divisions and time signatures, for the beat length. */
function signed(divisions: number, timeSignatures: Score['timeSignatures']): Score {
  return {
    meta: {},
    divisions,
    tempoMap: [{ tick: 0, qpm: 60 }],
    timeSignatures,
    keySignatures: [],
    measures: [],
    notes: [],
  };
}

describe('beatTicksAt', () => {
  // Divisions 4: a quarter is 4 ticks, an eighth 2, a half 8.
  it('is a quarter in 4/4 and in 3/4', () => {
    expect(beatTicksAt(signed(4, [{ tick: 0, beats: 4, beatType: 4 }]), 0)).toBe(4);
    expect(beatTicksAt(signed(4, [{ tick: 0, beats: 3, beatType: 4 }]), 7)).toBe(4);
  });

  it('is an eighth in 6/8 and in 3/8', () => {
    expect(beatTicksAt(signed(4, [{ tick: 0, beats: 6, beatType: 8 }]), 0)).toBe(2);
    expect(beatTicksAt(signed(4, [{ tick: 0, beats: 3, beatType: 8 }]), 5)).toBe(2);
  });

  it('is a half in 2/2', () => {
    expect(beatTicksAt(signed(4, [{ tick: 0, beats: 2, beatType: 2 }]), 0)).toBe(8);
  });

  it('is the signature in force after a change, whatever order they come in', () => {
    const changing = signed(4, [
      { tick: 16, beats: 6, beatType: 8 },
      { tick: 0, beats: 4, beatType: 4 },
    ]);
    expect(beatTicksAt(changing, 0)).toBe(4);
    expect(beatTicksAt(changing, 15)).toBe(4);
    expect(beatTicksAt(changing, 16)).toBe(2);
    expect(beatTicksAt(changing, 1000)).toBe(2);
  });

  it('is a quarter in common time when no signature is written', () => {
    expect(beatTicksAt(signed(480, []), 100)).toBe(480);
  });

  it('is the beat buildBeats spaces its clicks by', () => {
    const sixEight: Score = {
      ...signed(4, [{ tick: 0, beats: 6, beatType: 8 }]),
      measures: [{ index: 0, startTick: 0, lengthTicks: 12, number: '1' }],
    };
    for (const piece of [score, pickup, sixEight]) {
      const beats = buildBeats(piece);
      let compared = 0;
      for (let i = 1; i < beats.length; i++) {
        const a = beats[i - 1]!;
        const b = beats[i]!;
        if (a.measureIndex !== b.measureIndex) continue;
        expect(b.tick - a.tick).toBeCloseTo(beatTicksAt(piece, a.tick), 9);
        compared++;
      }
      expect(compared).toBeGreaterThan(0);
    }
  });
});

/**
 * A score of `bars` full bars in `beats` over `beatType`, divisions 4 (a quarter is 4 ticks), and
 * no notes: the clicks depend on the bars and the tempo alone. The default tempo is 60 qpm.
 */
function barred(
  beats: number,
  beatType: number,
  bars: number,
  tempoMap: Score['tempoMap'] = [{ tick: 0, qpm: 60 }],
): Score {
  const lengthTicks = (beats * 4 * 4) / beatType;
  return {
    ...signed(4, [{ tick: 0, beats, beatType }]),
    tempoMap,
    measures: Array.from({ length: bars }, (_, i) => ({
      index: i,
      startTick: i * lengthTicks,
      lengthTicks,
      number: String(i + 1),
    })),
  };
}

/** 4/4 at 150 qpm, divisions 4 (a tick is 0.1 s): bars of 16 ticks, `middle` ticks and 16 ticks. */
function withMiddleBar(middle: number): Score {
  return {
    ...signed(4, [{ tick: 0, beats: 4, beatType: 4 }]),
    tempoMap: [{ tick: 0, qpm: 150 }],
    measures: [
      { index: 0, startTick: 0, lengthTicks: 16, number: '1' },
      { index: 1, startTick: 16, lengthTicks: middle, number: '2' },
      { index: 2, startTick: 16 + middle, lengthTicks: 16, number: '3' },
    ],
  };
}

/** 60 qpm, divisions 4: a 4/4 bar, then two 6/8 bars. */
function mixedSignatures(): Score {
  return {
    ...signed(4, [
      { tick: 0, beats: 4, beatType: 4 },
      { tick: 16, beats: 6, beatType: 8 },
    ]),
    measures: [
      { index: 0, startTick: 0, lengthTicks: 16, number: '1' },
      { index: 1, startTick: 16, lengthTicks: 12, number: '2' },
      { index: 2, startTick: 28, lengthTicks: 12, number: '3' },
    ],
  };
}

/** The levels of a 4/4 bar's sixteen clicks, and of a beat's four. */
const BEAT_LEVELS: ClickLevel[] = ['beat', 'sub', 'sub', 'sub'];
const BAR_44: ClickLevel[] = [
  'bar',
  'sub',
  'sub',
  'sub',
  ...BEAT_LEVELS,
  ...BEAT_LEVELS,
  ...BEAT_LEVELS,
];

// The metronome clicks four times a beat (issue 203): the beat and three sub-beats at its quarters.
describe('buildClicks', () => {
  it('gives a 4/4 bar sixteen clicks on the quarter-beat grid: the bar, three subs, a beat, three subs, ...', () => {
    expect(CLICKS_PER_BEAT).toBe(4);
    const clicks = buildClicks(score);
    expect(clicks).toHaveLength(8 * 16);
    const bar = clicks.slice(0, 16);
    expect(bar.map((c) => c.level)).toEqual(BAR_44);
    expect(bar.map((c) => c.part)).toEqual(Array.from({ length: 16 }, (_, i) => i % 4));
    // 96 qpm: a beat is 0.625 s, a quarter of it 0.15625 s; divisions 12 put a click every 3 ticks.
    bar.forEach((c, i) => expect(c.sec).toBeCloseTo(i * 0.15625, 9));
    bar.forEach((c, i) => expect(c.tick).toBe(i * 3));
    // A quarter of the beat, and its half, are the shortest gaps of every beat at one tempo.
    expect(clicks.every((c) => Math.abs(c.quarterSec - 0.15625) < 1e-9)).toBe(true);
    expect(clicks.every((c) => Math.abs(c.halfSec - 0.3125) < 1e-9)).toBe(true);
    // Every bar of the piece repeats the pattern, the next one starting with a bar click.
    expect(clicks.slice(16, 32).map((c) => c.level)).toEqual(BAR_44);
    expect(clicks[16]!.sec).toBeCloseTo(2.5, 9);
  });

  it('puts the beat itself where buildBeats does: same tick and second, the bar level where it accents', () => {
    const pieces = [
      score,
      pickup,
      withPickup(4, 1),
      withPickup(4, 6),
      withShortSecondBar(),
      barred(6, 8, 3),
      barred(2, 2, 3),
      mixedSignatures(),
      withMiddleBar(14.5),
    ];
    for (const piece of pieces) {
      const onBeat = buildClicks(piece)
        .filter((c) => c.part === 0)
        .map((c) => ({ tick: c.tick, sec: c.sec, accent: c.level === 'bar' }));
      const beats = buildBeats(piece).map((b) => ({ tick: b.tick, sec: b.sec, accent: b.accent }));
      expect(beats.length).toBeGreaterThan(0);
      expect(onBeat).toEqual(beats);
    }
  });

  it('gives a 3/4 bar twelve clicks', () => {
    const clicks = buildClicks(barred(3, 4, 2));
    expect(clicks).toHaveLength(24);
    expect(clicks.slice(0, 12).map((c) => c.level)).toEqual([
      'bar',
      'sub',
      'sub',
      'sub',
      ...BEAT_LEVELS,
      ...BEAT_LEVELS,
    ]);
    clicks.forEach((c, i) => expect(c.sec).toBeCloseTo(i * 0.25, 9)); // 60 qpm: a beat is 1 s
    expect(clicks.every((c) => c.quarterSec === 0.25 && c.halfSec === 0.5)).toBe(true);
  });

  it('subdivides the eighth in 6/8: twenty-four clicks a bar, the beat an eighth long', () => {
    const clicks = buildClicks(barred(6, 8, 2));
    expect(clicks).toHaveLength(48);
    const levels = clicks.slice(0, 24).map((c) => c.level);
    expect(levels.filter((l) => l === 'bar')).toHaveLength(1);
    expect(levels.filter((l) => l === 'beat')).toHaveLength(5);
    expect(levels.filter((l) => l === 'sub')).toHaveLength(18);
    expect(levels[0]).toBe('bar');
    expect(levels.filter((_, i) => i % 4 === 0).slice(1)).toEqual(Array(5).fill('beat'));
    // 60 qpm, divisions 4: an eighth is 2 ticks and 0.5 s, so a click comes every 0.125 s.
    clicks.forEach((c, i) => expect(c.sec).toBeCloseTo(i * 0.125, 9));
    expect(clicks.every((c) => c.quarterSec === 0.125 && c.halfSec === 0.25)).toBe(true);
    expect(clicks[24]).toMatchObject({ level: 'bar', part: 0 });
  });

  it('subdivides the half in 2/2: eight clicks a bar, the beat a half long', () => {
    const clicks = buildClicks(barred(2, 2, 2));
    expect(clicks).toHaveLength(16);
    expect(clicks.slice(0, 8).map((c) => c.level)).toEqual([
      'bar',
      'sub',
      'sub',
      'sub',
      ...BEAT_LEVELS,
    ]);
    clicks.forEach((c, i) => expect(c.sec).toBeCloseTo(i * 0.5, 9)); // a half is 2 s
    expect(clicks.every((c) => c.quarterSec === 0.5 && c.halfSec === 1)).toBe(true);
  });

  it('gives an eighth-note pickup in 4/4 the subs on the "and" and the "a" of 4, and no beat', () => {
    // 120 qpm: a beat is 0.5 s, a click 0.125 s; the pickup is one eighth, 0.25 s long.
    const clicks = buildClicks(withPickup(4, 1));
    const inPickup = clicks.filter((c) => c.sec < 0.25 - 1e-9);
    expect(inPickup.map((c) => c.part)).toEqual([2, 3]);
    expect(inPickup.map((c) => c.level)).toEqual(['sub', 'sub']);
    expect(inPickup[0]!.sec).toBeCloseTo(0, 9);
    expect(inPickup[1]!.sec).toBeCloseTo(0.125, 9);
    // The full bar after it starts on a bar click and keeps the grid.
    expect(clicks[2]).toMatchObject({ level: 'bar', part: 0 });
    expect(clicks[2]!.sec).toBeCloseTo(0.25, 9);
    expect(clicks).toHaveLength(2 + 16);
  });

  it("gives a one-beat pickup in 3/4 its bar's beat 3 and the three subs after it", () => {
    // 100 qpm: a beat is 0.6 s; the pickup is beat 3 of its bar, so no click is a bar click in it.
    const clicks = buildClicks(pickup);
    const inPickup = clicks.filter((c) => c.sec < 0.6 - 1e-9);
    expect(inPickup.map((c) => c.level)).toEqual(['beat', 'sub', 'sub', 'sub']);
    expect(inPickup.map((c) => c.part)).toEqual([0, 1, 2, 3]);
    inPickup.forEach((c, i) => expect(c.sec).toBeCloseTo(i * 0.15, 9));
    const bar1 = clicks.filter((c) => c.sec >= 0.6 - 1e-9 && c.sec < 2.4 - 1e-9);
    expect(bar1).toHaveLength(12);
    expect(bar1[0]).toMatchObject({ level: 'bar', part: 0 });
    expect(bar1[0]!.sec).toBeCloseTo(0.6, 9);
  });

  it('starts a short bar after the first on its first beat, as a bar click', () => {
    // 120 qpm: a full bar of 2 s, then a bar of two quarters.
    const short = withShortSecondBar();
    const bar1 = buildClicks(short).filter((c) => c.sec >= 2 - 1e-9);
    expect(bar1).toHaveLength(8);
    expect(bar1.map((c) => c.level)).toEqual(['bar', 'sub', 'sub', 'sub', ...BEAT_LEVELS]);
    expect(bar1[0]!.sec).toBeCloseTo(2, 9);
    expect(bar1[4]!.sec).toBeCloseTo(2.5, 9);
  });

  it('puts each click at the second of its own tick when the tempo changes inside a beat', () => {
    // Divisions 4, 4/4: the beat from tick 4 to 8 holds the change from 60 to 120 qpm at tick 6.
    const tempoMap = [
      { tick: 0, qpm: 60 },
      { tick: 6, qpm: 120 },
    ];
    const changing = barred(4, 4, 2, tempoMap);
    const clicks = buildClicks(changing);
    expect(clicks).toHaveLength(32);
    for (const c of clicks) expect(c.sec).toBeCloseTo(ticksToSeconds(tempoMap, 4, c.tick), 9);
    // Beat 2 starts at 1 s; the tempo doubles halfway, so its clicks are not an even split of it.
    const beat2 = clicks.filter((c) => c.tick >= 4 && c.tick < 8);
    expect(beat2.map((c) => c.sec)).toEqual([1, 1.25, 1.5, 1.625]);
    // Its grid is 1, 1.25, 1.5, 1.625 and 1.75 s: the shortest quarter is 0.125 s (after the
    // change), the shortest half 0.25 s, and every click of the beat shares both.
    expect(beat2.map((c) => c.quarterSec)).toEqual([0.125, 0.125, 0.125, 0.125]);
    expect(beat2.map((c) => c.halfSec)).toEqual([0.25, 0.25, 0.25, 0.25]);
    // The beat after it is wholly at 120 qpm.
    expect(clicks.find((c) => c.tick === 8)).toMatchObject({ quarterSec: 0.125, halfSec: 0.25 });
  });

  it('lists the clicks in order of their seconds', () => {
    const tempoMap = [
      { tick: 0, qpm: 60 },
      { tick: 6, qpm: 120 },
    ];
    for (const piece of [
      score,
      pickup,
      withPickup(4, 1),
      withShortSecondBar(),
      barred(4, 4, 3, tempoMap),
    ]) {
      const clicks = buildClicks(piece);
      expect(clicks.length).toBeGreaterThan(0);
      for (let i = 1; i < clicks.length; i++) {
        expect(clicks[i]!.sec).toBeGreaterThan(clicks[i - 1]!.sec);
      }
    }
  });

  it('is common time when no signature is written, and empty for a score without measures', () => {
    const unsigned: Score = {
      ...signed(4, []),
      measures: [{ index: 0, startTick: 0, lengthTicks: 16, number: '1' }],
    };
    expect(buildClicks(unsigned)).toHaveLength(16);
    expect(buildClicks(signed(4, [{ tick: 0, beats: 4, beatType: 4 }]))).toEqual([]);
  });

  it('follows each bar its own beat when the time signature changes', () => {
    // 60 qpm, divisions 4: a 4/4 bar of 16 ticks (a click every tick), then two 6/8 bars of 12
    // ticks (a click every half tick, on the eighth's quarters).
    const clicks = buildClicks(mixedSignatures());
    expect(clicks).toHaveLength(16 + 24 + 24);
    const four = clicks.filter((c) => c.tick < 16);
    const six = clicks.filter((c) => c.tick >= 16 && c.tick < 28);
    expect(four.map((c) => c.tick)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(six.map((c) => c.tick)).toEqual(Array.from({ length: 24 }, (_, i) => 16 + i / 2));
    expect(six.filter((c) => c.part === 0).map((c) => c.tick)).toEqual([16, 18, 20, 22, 24, 26]);
    expect(six[0]).toMatchObject({ level: 'bar', part: 0 });
    expect(clicks[40]).toMatchObject({ level: 'bar', tick: 28 });
    expect(four.every((c) => c.quarterSec === 0.25 && c.halfSec === 0.5)).toBe(true);
    expect(six.every((c) => c.quarterSec === 0.125 && c.halfSec === 0.25)).toBe(true);
  });

  // Each click used to look one beat ahead from itself, so the clicks of a beat that lay before a
  // tempo mark disagreed about the same gaps.
  it('thins every click of a beat alike at a tempo mark on the next bar line', () => {
    // Bar 1 at 120 qpm (quarters of 125 ms), bar 2 at 60 qpm (250 ms); factor 1.5 puts the
    // quarters of bar 1 at 83 ms: the halves only, in every beat, the last one included.
    const clicks = buildClicks(
      barred(4, 4, 2, [
        { tick: 0, qpm: 120 },
        { tick: 16, qpm: 60 },
      ]),
    );
    const bar1 = clicks.filter((c) => c.tick < 16);
    const bar2 = clicks.filter((c) => c.tick >= 16);
    expect(bar1.filter((c) => clickHeard(c, 1.5)).map((c) => c.part)).toEqual([
      0, 2, 0, 2, 0, 2, 0, 2,
    ]);
    expect(bar1.every((c) => c.quarterSec === 0.125 && c.halfSec === 0.25)).toBe(true);
    // Bar 2's quarters are 167 ms heard: all four.
    expect(bar2.filter((c) => clickHeard(c, 1.5)).map((c) => c.part)).toEqual(
      Array.from({ length: 16 }, (_, i) => i % 4),
    );
  });

  it('keeps a beat whole when the tempo rises at the beat after it, and thins that beat', () => {
    // 155 qpm: quarters of 96.8 ms; 200 qpm from tick 8 (beat 3): 75 ms. At factor 1 beats 1 and
    // 2 sound all four, with no hole before beat 3, and beats 3 and 4 their halves.
    const clicks = buildClicks(
      barred(4, 4, 2, [
        { tick: 0, qpm: 155 },
        { tick: 8, qpm: 200 },
      ]),
    );
    const heardParts = (list: Click[]) => list.filter((c) => clickHeard(c, 1)).map((c) => c.part);
    expect(heardParts(clicks.slice(0, 16))).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 2, 0, 2]);
    expect(heardParts(clicks.slice(16))).toEqual([0, 2, 0, 2, 0, 2, 0, 2]);
  });

  it('shortens the last gaps of a bar that ends off the grid, so its sub-beat before the bar line thins', () => {
    // 150 qpm, a tick is 0.1 s; bar 2 is 14.5 ticks long, so its last beat (ticks 28 to 32) has
    // clicks at 28, 29 and 30, and bar 3 starts at 30.5, half a tick after the click at 30.
    const clicks = buildClicks(withMiddleBar(14.5));
    const last = clicks.filter((c) => c.tick >= 28 && c.tick < 30.5);
    expect(last.map((c) => c.part)).toEqual([0, 1, 2]);
    for (const c of last) {
      expect(c.quarterSec).toBeCloseTo(0.05, 9);
      expect(c.halfSec).toBeCloseTo(0.05, 9);
    }
    expect(last.filter((c) => clickHeard(c, 1)).map((c) => c.part)).toEqual([0]);
    expect(clicks.find((c) => c.tick === 30.5)).toMatchObject({ level: 'bar', part: 0 });
  });

  it('measures the gaps of a bar 2.5 beats long over the clicks it has', () => {
    // Bar 2 is 10 ticks: its third beat has the clicks at 24 and 25, and bar 3 starts at 26, where
    // the beat's half would be. No gap is the zero between the bar line and a click that is not there.
    const clicks = buildClicks(withMiddleBar(10));
    const third = clicks.filter((c) => c.tick >= 24 && c.tick < 26);
    expect(third.map((c) => c.part)).toEqual([0, 1]);
    for (const c of third) {
      expect(c.quarterSec).toBeCloseTo(0.1, 9);
      expect(c.halfSec).toBeCloseTo(0.2, 9);
    }
    expect(third.filter((c) => clickHeard(c, 1)).map((c) => c.part)).toEqual([0, 1]);
    expect(third.filter((c) => clickHeard(c, 1.5)).map((c) => c.part)).toEqual([0]);
    expect(clicks.find((c) => c.tick === 26)).toMatchObject({ level: 'bar', part: 0 });
  });
});

describe('clickHeard', () => {
  /**
   * A click at part `part` of a beat whose shortest quarter and half gaps are `quarterSec` and
   * `halfSec`; where it stands in time does not matter here.
   */
  const click = (part: number, quarterSec: number, halfSec = 2 * quarterSec): Click => ({
    tick: 0,
    sec: 0,
    level: part === 0 ? 'beat' : 'sub',
    part,
    quarterSec,
    halfSec,
  });
  const heard = (quarterSec: number, factor: number, halfSec?: number) =>
    [0, 1, 2, 3].filter((part) => clickHeard(click(part, quarterSec, halfSec), factor));

  it('always hears the beat itself, at any tempo', () => {
    expect(clickHeard(click(0, 0.0025), 1.5)).toBe(true);
    expect(clickHeard(click(0, 0.125), 0.5)).toBe(true);
  });
  it('hears all four clicks of a beat whose quarters are 90 ms apart or more', () => {
    expect(MIN_CLICK_GAP_SEC).toBe(0.09);
    expect(heard(0.125, 1)).toEqual([0, 1, 2, 3]);
    expect(heard(0.09, 1)).toEqual([0, 1, 2, 3]); // exactly 90 ms between quarters
  });
  it('thins a beat to the one on its half when its quarters would come closer than 90 ms', () => {
    expect(heard(0.125, 1.5)).toEqual([0, 2]); // 83 ms quarters, 167 ms halves
    expect(heard(0.05, 1)).toEqual([0, 2]); // 50 ms quarters, 100 ms halves
  });
  it('thins a beat to the beat alone when its halves would come closer than 90 ms', () => {
    expect(heard(0.0625, 1.5)).toEqual([0]); // 42 ms quarters, 83 ms halves
    expect(heard(0.025, 1)).toEqual([0]);
  });
  it('hears every click of a beat the tempo factor slows down', () => {
    expect(heard(0.125, 0.5)).toEqual([0, 1, 2, 3]);
    expect(heard(0.05, 0.5)).toEqual([0, 1, 2, 3]); // 100 ms quarters
  });
  it("reads the half's own gap: a half shortened by a bar line thins the half, not the quarters", () => {
    expect(heard(0.05, 1, 0.1)).toEqual([0, 2]);
    expect(heard(0.05, 1, 0.05)).toEqual([0]);
    expect(heard(0.1, 1, 0.2)).toEqual([0, 1, 2, 3]);
  });
});

// The strong check (issue 203): whatever the score and the tempo factor, the clicks heard are
// never closer than the floor, and each beat sounds all it has, its half, or itself alone.
describe('the clicks heard', () => {
  /** The clicks grouped by the beat they belong to, by the tick their beat's grid starts at. */
  function byBeat(piece: Score, clicks: Click[]): Click[][] {
    const beats = new Map<number, Click[]>();
    for (const c of clicks) {
      const start = c.tick - (c.part * beatTicksAt(piece, c.tick)) / CLICKS_PER_BEAT;
      const key = Math.round(start * 1e6);
      beats.set(key, [...(beats.get(key) ?? []), c]);
    }
    return [...beats.values()];
  }

  /** Divisions 4, 4/4 or 6/8, with a tempo mark every few ticks, across and inside beats. */
  function tempoful(beats: number, beatType: number): Score {
    const qpms = [155, 200, 90, 120, 75, 180, 140];
    const tempoMap = Array.from({ length: 40 }, (_, i) => ({ tick: i * 5, qpm: qpms[i % 7]! }));
    return barred(beats, beatType, 14, tempoMap);
  }

  const fixtureDir = new URL('../../fixtures/', import.meta.url);
  const fixtures = [fixtureDir, new URL('scan/', fixtureDir)].flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.musicxml'))
      .map((name): [string, Score] => [
        name,
        parseMusicXml(readFileSync(new URL(name, dir), 'utf8')).score,
      ]),
  );
  const pieces: [string, Score][] = [
    ...fixtures,
    [
      'scenario A',
      barred(4, 4, 3, [
        { tick: 0, qpm: 120 },
        { tick: 16, qpm: 60 },
      ]),
    ],
    [
      'scenario B',
      barred(4, 4, 3, [
        { tick: 0, qpm: 155 },
        { tick: 8, qpm: 200 },
      ]),
    ],
    ['an eighth-note pickup', withPickup(4, 1)],
    ['a three-beat pickup', withPickup(4, 6)],
    ['a short bar', withShortSecondBar()],
    ['6/8', barred(6, 8, 6, [{ tick: 0, qpm: 90 }])],
    ['a tempo mark every few beats in 4/4', tempoful(4, 4)],
    ['a tempo mark every few beats in 6/8', tempoful(6, 8)],
    ['4/4 then 6/8', mixedSignatures()],
    ['a bar that ends off the grid', withMiddleBar(14.5)],
    ['a bar 2.5 beats long', withMiddleBar(10)],
  ];

  it('covers the fixtures of the app', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(7);
  });

  for (const [name, piece] of pieces) {
    for (const factor of [0.5, 1, 1.5]) {
      it(`keeps the gaps and the beats' shapes: ${name} at ${factor} times`, () => {
        const clicks = buildClicks(piece);
        expect(clicks.length).toBeGreaterThan(0);
        const heard = clicks.filter((c) => clickHeard(c, factor));
        for (let i = 1; i < heard.length; i++) {
          const gap = (heard[i]!.sec - heard[i - 1]!.sec) / factor;
          expect(gap, `heard click ${i} at tick ${heard[i]!.tick}`).toBeGreaterThanOrEqual(
            MIN_CLICK_GAP_SEC - 1e-9,
          );
        }
        for (const beat of byBeat(piece, clicks)) {
          const has = beat.map((c) => c.part);
          const sounded = beat.filter((c) => clickHeard(c, factor)).map((c) => c.part);
          const shapes = [has.filter((p) => p === 0), has.filter((p) => p === 0 || p === 2), has];
          expect(shapes, `the beat at tick ${beat[0]!.tick}`).toContainEqual(sounded);
        }
      });
    }
  }
});

/** 4/4 at 120 qpm: one full bar of quarter notes, then a bar of only two quarters. */
function withShortSecondBar(): Score {
  const note =
    '<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration>' +
    '<type>quarter</type></note>';
  const attributes =
    '<attributes><divisions>2</divisions><key><fifths>0</fifths></key>' +
    '<time><beats>4</beats><beat-type>4</beat-type></time>' +
    '<clef><sign>G</sign><line>2</line></clef></attributes>' +
    '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
    '<per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>';
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">' +
    '<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>' +
    `<part id="P1"><measure number="1">${attributes}${note.repeat(4)}</measure>` +
    `<measure number="2">${note.repeat(2)}</measure></part></score-partwise>`;
  return parseMusicXml(xml).score;
}

/**
 * A one-staff melody in `beats`/4 at 120 qpm (a beat is 0.5 s): a first measure of
 * `pickupEighths` eighth notes, then one full bar of quarter notes.
 */
function withPickup(beats: number, pickupEighths: number): Score {
  const note = (eighths: number, type: string) =>
    `<note><pitch><step>C</step><octave>5</octave></pitch><duration>${eighths}</duration>` +
    `<type>${type}</type></note>`;
  const attributes =
    '<attributes><divisions>2</divisions><key><fifths>0</fifths></key>' +
    `<time><beats>${beats}</beats><beat-type>4</beat-type></time>` +
    '<clef><sign>G</sign><line>2</line></clef></attributes>' +
    '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
    '<per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>';
  const pickupBar = Array.from({ length: pickupEighths }, () => note(1, 'eighth')).join('');
  const fullBar = Array.from({ length: beats }, () => note(2, 'quarter')).join('');
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">' +
    '<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>' +
    `<part id="P1"><measure number="0" implicit="yes">${attributes}${pickupBar}</measure>` +
    `<measure number="1">${fullBar}</measure></part></score-partwise>`;
  const { score: piece } = parseMusicXml(xml);
  expect(piece.measures[0]!.lengthTicks).toBe((pickupEighths * piece.divisions) / 2);
  return piece;
}
