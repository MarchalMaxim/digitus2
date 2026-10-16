// The subpath, not the engine's index: the index would bring the whole engine onto the main thread.
import { ticksToSeconds } from '@digitus2/engine/score-build';
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
        sec: ticksToSeconds(score.tempoMap, score.divisions, tick),
        accent: k === 0,
        measureIndex: m.index,
        beatInBar: k + 1,
      });
    }
  });
  return beats;
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
