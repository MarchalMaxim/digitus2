// @vitest-environment node
import { readFileSync } from 'node:fs';
import { parseMusicXml, type Score } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { beatTicksAt, buildBeats, countInBar, measureEndSec, measureStartSec } from './beats.js';

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
