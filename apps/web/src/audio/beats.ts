import { ticksToSeconds } from '@digitus2/engine';
import type { MeasureInfo, Score, TimeSigEvent } from '@digitus2/engine';

export interface Beat {
  tick: number;
  sec: number;
  accent: boolean;
  measureIndex: number;
}

const COMMON_TIME: TimeSigEvent = { tick: 0, beats: 4, beatType: 4 };

/**
 * One beat per beat of every measure, from the time signature in force at the measure start; the
 * first beat of a measure is accented. A pickup bar yields only the beats that fit in its length.
 */
export function buildBeats(score: Score): Beat[] {
  const sigs = [...score.timeSignatures].sort((a, b) => a.tick - b.tick);
  const beats: Beat[] = [];
  for (const m of score.measures) {
    let sig = sigs[0] ?? COMMON_TIME;
    for (const s of sigs) {
      if (s.tick <= m.startTick) sig = s;
      else break;
    }
    const beatTicks = (score.divisions * 4) / sig.beatType;
    if (!(beatTicks > 0)) continue;
    for (let k = 0; k * beatTicks < m.lengthTicks; k++) {
      const tick = m.startTick + k * beatTicks;
      beats.push({
        tick,
        sec: ticksToSeconds(score.tempoMap, score.divisions, tick),
        accent: k === 0,
        measureIndex: m.index,
      });
    }
  }
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
