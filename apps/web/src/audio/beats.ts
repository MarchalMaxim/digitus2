// The subpath, not the engine's index: the index would bring the whole engine onto the main thread.
import { tickSeconds, ticksToSeconds } from '@digitus2/engine/score-build';
import type { MeasureInfo, Score, TimeSigEvent } from '@digitus2/engine';

export interface Beat {
  tick: number;
  sec: number;
  accent: boolean;
  measureIndex: number;
  /** Its beat in the bar, from 1: the number a player counts on it ("3" on a 3/4 pickup). */
  beatInBar: number;
}

const COMMON_TIME: TimeSigEvent = { tick: 0, beats: 4, beatType: 4 };

/** The time signature in force at `tick` (`sigs` sorted by tick); common time when there is none. */
function timeSignatureAt(sigs: readonly TimeSigEvent[], tick: number): TimeSigEvent {
  let sig = sigs[0] ?? COMMON_TIME;
  for (const s of sigs) {
    if (s.tick <= tick) sig = s;
    else break;
  }
  return sig;
}

function sortedTimeSignatures(score: Score): TimeSigEvent[] {
  return [...score.timeSignatures].sort((a, b) => a.tick - b.tick);
}

/**
 * The beat at `tick` in ticks: `divisions * 4 / beatType` of the time signature in force there,
 * the beat `buildBeats` clicks and `countInBar` counts (an eighth in 6/8, a half in 2/2).
 */
export function beatTicksAt(score: Score, tick: number): number {
  return (score.divisions * 4) / timeSignatureAt(sortedTimeSignatures(score), tick).beatType;
}

/** Tick tolerance when comparing positions in a bar (ticks are divisions, beats may be halves). */
const TICK_EPSILON = 1e-6;

/**
 * How far into its bar the first measure starts, in ticks: a pickup (a first measure shorter than
 * its time signature's bar) is the end of a bar, so 2 beats for a one-beat pickup in 3/4. Zero
 * for a full first measure, and for every later measure, which starts on its bar's first beat.
 */
function pickupLeadTicks(
  score: Score,
  measureIndex: number,
  sig: TimeSigEvent,
  beatTicks: number,
): number {
  const m = score.measures[measureIndex];
  if (measureIndex !== 0 || !m || !(sig.beats > 0)) return 0;
  const lead = sig.beats * beatTicks - m.lengthTicks;
  return lead > TICK_EPSILON ? lead : 0;
}

/**
 * One beat per beat of every measure, from the time signature in force at the measure start; the
 * first beat of a bar is accented. A pickup sits at the end of its bar: its beats are that bar's
 * last ones, on the beat grid of the bars that follow and none of them accented (Happy Birthday's
 * one-beat pickup in 3/4 is beat 3; an eighth-note pickup in 4/4, on the "and" of 4, has none).
 */
export function buildBeats(score: Score): Beat[] {
  const sigs = sortedTimeSignatures(score);
  const secAt = tickSeconds(score.tempoMap, score.divisions);
  const beats: Beat[] = [];
  score.measures.forEach((m, i) => {
    const sig = timeSignatureAt(sigs, m.startTick);
    const beatTicks = (score.divisions * 4) / sig.beatType;
    if (!(beatTicks > 0)) return;
    const lead = pickupLeadTicks(score, i, sig, beatTicks);
    for (let k = 0; k * beatTicks - lead < m.lengthTicks - TICK_EPSILON; k++) {
      const at = k * beatTicks - lead;
      if (at < -TICK_EPSILON) continue; // a beat of the pickup's bar before the pickup starts
      const tick = m.startTick + Math.max(0, at);
      beats.push({
        tick,
        sec: secAt(tick),
        accent: k === 0,
        measureIndex: m.index,
        beatInBar: k + 1,
      });
    }
  });
  return beats;
}

/** A metronome click's step on the ladder: a bar's first beat, another beat, a sub-beat (issue 203). */
export type ClickLevel = 'bar' | 'beat' | 'sub';

/** One click of the metronome: a beat of `buildBeats`, or one of the sub-beats between its beats. */
export interface Click {
  tick: number;
  /** Score seconds (tempo factor 1). */
  sec: number;
  level: ClickLevel;
  /** Its quarter of the beat, 0 to 3: 0 the beat itself, 2 its half. */
  part: number;
  /**
   * The shortest gap, in score seconds, from a click of its beat to the next point of the beat's
   * grid, a quarter of the beat on. The same for every click of the beat, so they all agree on
   * what a tempo mark in or after the beat does to its spacing.
   */
  quarterSec: number;
  /**
   * The shortest gap from the beat's click on the beat, or on its half, to the grid point two
   * quarters on; shared like `quarterSec`. Infinity for a beat with neither click.
   */
  halfSec: number;
}

/** The clicks of a beat: the beat itself and three sub-beats at its quarters. */
export const CLICKS_PER_BEAT = 4;

/**
 * The closest two clicks the metronome sounds, in heard seconds: nearer ones blur into a buzz
 * (11 a second), so `clickHeard` thins a beat's sub-beats before they come closer.
 */
export const MIN_CLICK_GAP_SEC = 0.09;

/**
 * The metronome's clicks: `CLICKS_PER_BEAT` to every beat of `buildBeats`, on the same bar grid at
 * steps of a quarter of the beat in ticks, so a pickup holds the sub-beats of the beats before it
 * even when none of them is its own (an eighth-note pickup in 4/4 has the "and" and the "a" of 4,
 * and no beat). The click on the beat itself is the beat of `buildBeats`, and the bar's first beat
 * is the `bar` level. Each click takes its seconds from its own tick, so a tempo change inside a
 * beat lands each of them right. Sorted by `sec`.
 *
 * The spacing a beat's clicks keep is read once per beat, from its five grid points (its four
 * clicks and the next beat's first), each at most the bar's end: a bar that ends off the grid
 * shortens the gap before its line, and a gap only counts from a click that exists, so a bar
 * ending on the grid short of a whole beat has no zero gap to a click it does not have.
 */
export function buildClicks(score: Score): Click[] {
  const sigs = sortedTimeSignatures(score);
  const secAt = tickSeconds(score.tempoMap, score.divisions);
  const clicks: Click[] = [];
  score.measures.forEach((m, i) => {
    const sig = timeSignatureAt(sigs, m.startTick);
    const beatTicks = (score.divisions * 4) / sig.beatType;
    if (!(beatTicks > 0)) return;
    const subTicks = beatTicks / CLICKS_PER_BEAT;
    const lead = pickupLeadTicks(score, i, sig, beatTicks);
    const endTick = m.startTick + m.lengthTicks;
    /** Where grid point `j` falls, in ticks from the measure start. */
    const at = (j: number) => j * subTicks - lead;
    const exists = (j: number) => at(j) >= -TICK_EPSILON && at(j) < m.lengthTicks - TICK_EPSILON;
    const secs: number[] = [];
    for (let first = 0; at(first) < m.lengthTicks - TICK_EPSILON; first += CLICKS_PER_BEAT) {
      if (at(first + CLICKS_PER_BEAT - 1) < -TICK_EPSILON) continue; // before the pickup starts
      for (let k = 0; k <= CLICKS_PER_BEAT; k++) {
        secs[k] = secAt(Math.min(endTick, m.startTick + Math.max(0, at(first + k))));
      }
      let quarterSec = Infinity;
      let halfSec = Infinity;
      for (let k = 0; k < CLICKS_PER_BEAT; k++) {
        if (!exists(first + k)) continue;
        quarterSec = Math.min(quarterSec, secs[k + 1]! - secs[k]!);
        if (k % 2 === 0) halfSec = Math.min(halfSec, secs[k + 2]! - secs[k]!);
      }
      for (let k = 0; k < CLICKS_PER_BEAT; k++) {
        if (!exists(first + k)) continue;
        clicks.push({
          tick: m.startTick + Math.max(0, at(first + k)),
          sec: secs[k]!,
          level: first + k === 0 ? 'bar' : k === 0 ? 'beat' : 'sub',
          part: k,
          quarterSec,
          halfSec,
        });
      }
    }
  });
  return clicks;
}

/**
 * Whether the metronome sounds `click` at tempo factor `factor`, so that no two clicks heard come
 * closer than `MIN_CLICK_GAP_SEC`. The beat itself always sounds. Its quarters (parts 1 and 3)
 * sound when the beat's shortest quarter gap, heard (`quarterSec / factor`), is at least that, its
 * half (part 2) when the shortest half gap is. So a beat sounds all its clicks, its half and
 * itself, or itself alone, and at the fast end it gives two clicks, then one.
 */
export function clickHeard(click: Click, factor: number): boolean {
  if (click.part === 0) return true;
  return (click.part === 2 ? click.halfSec : click.quarterSec) / factor >= MIN_CLICK_GAP_SEC;
}

function measureAt(score: Score, measureIndex: number): MeasureInfo | undefined {
  const last = score.measures.length - 1;
  return score.measures[Math.max(0, Math.min(last, Math.trunc(measureIndex)))];
}

/** Score seconds at the start of a measure (0-based index, clamped to the piece). */
export function measureStartSec(score: Score, measureIndex: number): number {
  const m = measureAt(score, measureIndex);
  return m ? ticksToSeconds(score.tempoMap, score.divisions, m.startTick) : 0;
}

/** Score seconds at the end of a measure (0-based index, clamped to the piece). */
export function measureEndSec(score: Score, measureIndex: number): number {
  const m = measureAt(score, measureIndex);
  return m ? ticksToSeconds(score.tempoMap, score.divisions, m.startTick + m.lengthTicks) : 0;
}

/** One click of a count-in. */
export interface CountInClick {
  /** Seconds from the count-in's start. */
  offsetSec: number;
  /** The first beat of a bar. */
  accent: boolean;
  /** Its beat in the bar, from 1: the number the status line shows and a player counts. */
  beatInBar: number;
}

/** The count-in before a measure: its clicks, from the count-in's start, and how long it lasts. */
export interface CountInBar {
  clicks: CountInClick[];
  lengthSec: number;
}

/** The fewest clicks a count-in before a pickup gives; with fewer it counts a whole bar first. */
const MIN_PICKUP_COUNT_IN_CLICKS = 2;

/**
 * The count-in before measure `measureIndex` (0-based; `beats` from `buildBeats`), on the bar
 * grid, so the music enters on its written beat. Seconds are score seconds (tempo factor 1) at
 * the tempo in force where the music starts.
 *
 * - A full measure: one whole bar, its own beats ("1 2 3 4", then the music on 1).
 * - A pickup (a first measure shorter than its bar, `pickupLeadTicks`): the beats of its bar that
 *   come before it, numbered by their beat in the bar, and the music enters where the pickup
 *   stands: Happy Birthday's one-beat pickup in 3/4 counts "1 2" and enters on 3; an eighth-note
 *   pickup in 4/4 counts "1 2 3 4" and enters on the "and" of 4. When that leaves fewer than two
 *   clicks (a three-beat pickup in 4/4 has only "1" before it), a whole bar comes first: "1 2 3 4
 *   1", and the music enters on 2.
 * - Another measure shorter than its bar (it starts on its bar's first beat, as `buildBeats` has
 *   it): one whole bar of its time signature, then the music on 1.
 */
export function countInBar(score: Score, beats: readonly Beat[], measureIndex: number): CountInBar {
  const m = score.measures[measureIndex];
  if (!m) return { clicks: [], lengthSec: 0 };
  const from = ticksToSeconds(score.tempoMap, score.divisions, m.startTick);
  const sig = timeSignatureAt(sortedTimeSignatures(score), m.startTick);
  const beatTicks = (score.divisions * 4) / sig.beatType;
  const barTicks = sig.beats * beatTicks;
  if (beatTicks > 0 && sig.beats > 0 && m.lengthTicks < barTicks - TICK_EPSILON) {
    const beatSec = ticksToSeconds(score.tempoMap, score.divisions, m.startTick + beatTicks) - from;
    const barSec = sig.beats * beatSec;
    /** The first `n` beats of a bar that starts `startSec` into the count-in. */
    const bar = (n: number, startSec = 0): CountInClick[] =>
      Array.from({ length: n }, (_, k) => ({
        offsetSec: startSec + k * beatSec,
        accent: k === 0,
        beatInBar: k + 1,
      }));
    const lead = pickupLeadTicks(score, measureIndex, sig, beatTicks);
    if (lead === 0) return { clicks: bar(sig.beats), lengthSec: barSec };
    let before = 0; // the beats of the pickup's bar before it starts
    while (before * beatTicks < lead - TICK_EPSILON) before++;
    const leadSec = (lead / beatTicks) * beatSec;
    if (before >= MIN_PICKUP_COUNT_IN_CLICKS) return { clicks: bar(before), lengthSec: leadSec };
    return {
      clicks: [...bar(sig.beats), ...bar(before, barSec)],
      lengthSec: barSec + leadSec,
    };
  }
  return {
    clicks: beats
      .filter((b) => b.measureIndex === m.index)
      .map((b) => ({ offsetSec: b.sec - from, accent: b.accent, beatInBar: b.beatInBar })),
    lengthSec: measureEndSec(score, measureIndex) - from,
  };
}
