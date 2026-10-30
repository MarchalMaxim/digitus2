import { finalizeScore, validateScore } from '../../score/build.js';
import type {
  Hand,
  KeySigEvent,
  MeasureInfo,
  Note,
  Score,
  TempoEvent,
  TimeSigEvent,
} from '../../score/types.js';
import { MAX_HAND_SPAN, MAX_NOTES_PER_HAND } from './handSeparation.js';
import { estimateKey, spellMidi } from './key.js';
import { count } from './plural.js';
import type { QuantizedNotes } from './quantize.js';
import type { MidiData } from './read.js';

/** Tempo changes move to the nearest 32nd note so the engraver can place them. */
export const TEMPO_SNAP_TICKS = 60;
export const MAX_CROWDED_WARNINGS = 5;
export interface MidiToScoreOptions {
  title?: string;
  composer?: string;
  source?: string;
  /**
   * Ticks of a short first measure (a pickup, numbered 0); the full measures follow it. Used
   * only when it is shorter than the first measure's signature and the music is longer, and
   * dropped when it would push a time signature change off its barline.
   */
  pickupTicks?: number;
}

interface Draft {
  onset: number;
  offset: number;
  midi: number;
  hand: Hand;
  velocity: number;
}

/**
 * Builds a Score from quantized MIDI and a hand per quantized note: ids m0, m1, ... in score
 * order, one voice per hand (right: staff 1, voice 1; left: staff 2, voice 5), measures from the
 * file's time signatures, the file's key or else the Krumhansl-Schmuckler estimate.
 */
export function midiToScore(
  data: MidiData,
  quantized: QuantizedNotes,
  hands: readonly Hand[],
  opts: MidiToScoreOptions = {},
): { score: Score; warnings: string[] } {
  if (hands.length !== quantized.notes.length)
    throw new Error(`midiToScore: ${hands.length} hands for ${quantized.notes.length} notes`);
  const D = quantized.divisions;
  const scale = D / data.ppq;
  const warnings: string[] = [];

  const tempoMap: TempoEvent[] = [];
  for (const t of data.tempos) {
    const tick = Math.round((t.tick * scale) / TEMPO_SNAP_TICKS) * TEMPO_SNAP_TICKS;
    const qpm = 60e6 / t.usPerQuarter;
    const last = tempoMap[tempoMap.length - 1];
    if (last && last.tick === tick) last.qpm = qpm;
    else tempoMap.push({ tick, qpm });
  }
  if (tempoMap.length === 0 || tempoMap[0]!.tick > 0) tempoMap.unshift({ tick: 0, qpm: 120 });

  const drafts: Draft[] = quantized.notes.map((n, i) => ({
    onset: n.onset,
    offset: n.offset,
    midi: n.midi,
    hand: hands[i]!,
    velocity: n.velocity,
  }));
  // One voice per hand: the notes of one hand that start together end together, at the latest of
  // their ends, cut back to that hand's next onset.
  let shortened = 0;
  const crowded: Array<{ onset: number; hand: Hand; notes: number; span: number }> = [];
  for (const hand of ['R', 'L'] as const) {
    const own = drafts
      .filter((d) => d.hand === hand)
      .sort((a, b) => a.onset - b.onset || a.midi - b.midi);
    for (let i = 0; i < own.length;) {
      let j = i;
      while (j < own.length && own[j]!.onset === own[i]!.onset) j++;
      const slice = own.slice(i, j);
      const next = own[j]?.onset;
      let end = Math.max(...slice.map((d) => d.offset));
      if (next !== undefined && end > next) end = next;
      for (const d of slice) {
        if (d.offset > end) shortened++;
        d.offset = end;
      }
      const spread = slice[slice.length - 1]!.midi - slice[0]!.midi;
      if (slice.length > MAX_NOTES_PER_HAND || spread > MAX_HAND_SPAN)
        crowded.push({ onset: slice[0]!.onset, hand, notes: slice.length, span: spread });
      i = j;
    }
  }
  if (shortened > 0)
    warnings.push(
      `${shortened === 1 ? '1 note was' : `${shortened} notes were`} shortened so each hand has one voice`,
    );

  // Measures start at tick 0 and follow the time signatures until they cover the last offset; a
  // change inside a measure takes effect at the next barline. A loop, not Math.max(...spread),
  // which throws beyond about 130 000 arguments.
  let endTick = 0;
  for (const d of drafts) if (d.offset > endTick) endTick = d.offset;
  // A time signature must give a measure a positive whole number of ticks, or the measure loop
  // below never ends (midi-file reads a numerator of 0, and a denominator 1 << byte that is
  // negative for a byte of 31 and 2 ** 30 for a byte of 30).
  const measureTicks = (t: { beats: number; beatType: number }) => (t.beats * 4 * D) / t.beatType;
  const usable = (t: { beats: number; beatType: number }) =>
    Number.isInteger(t.beats) &&
    t.beats >= 1 &&
    t.beatType >= 1 &&
    Number.isInteger(measureTicks(t));
  const unusable = data.timeSignatures.filter((t) => !usable(t)).length;
  if (unusable > 0)
    warnings.push(
      `ignored ${count(unusable, 'unusable time signature', 'unusable time signatures')}`,
    );
  const changes = data.timeSignatures
    .filter(usable)
    .map((t) => ({ tick: Math.round(t.tick * scale), beats: t.beats, beatType: t.beatType }))
    .sort((a, b) => a.tick - b.tick);
  let built = buildMeasures(changes, endTick, 0, measureTicks);
  if (opts.pickupTicks !== undefined && opts.pickupTicks > 0) {
    const shifted = buildMeasures(changes, endTick, opts.pickupTicks, measureTicks);
    // A time signature the file puts on its own barline beats the guess of a pickup.
    if (shifted.pickup && shifted.moved <= built.moved) built = shifted;
  }
  const { measures, timeSignatures, moved } = built;
  if (moved > 0)
    warnings.push(
      `${count(moved, 'time signature change', 'time signature changes')} moved to the next barline`,
    );
  const measureAt = (tick: number): number => {
    let lo = 0;
    let hi = measures.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (measures[mid]!.startTick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const estimate = () => {
    const e = estimateKey(
      drafts.map((d) => ({ midi: d.midi, duration: (d.offset - d.onset) / D })),
    );
    return { fifths: e.fifths, mode: e.mode };
  };
  const key = data.keySignature ?? estimate();
  const keySignatures: KeySigEvent[] = [{ tick: 0, fifths: key.fifths, mode: key.mode }];

  crowded.sort((a, b) => a.onset - b.onset || (a.hand === b.hand ? 0 : a.hand === 'R' ? -1 : 1));
  for (const c of crowded.slice(0, MAX_CROWDED_WARNINGS)) {
    const where = `measure ${measures[measureAt(c.onset)]!.number}`;
    const hand = c.hand === 'R' ? 'right' : 'left';
    warnings.push(
      c.notes > MAX_NOTES_PER_HAND
        ? `${where}: ${c.notes} notes in the ${hand} hand at one time`
        : `${where}: the ${hand} hand spans ${c.span} semitones at one time`,
    );
  }
  if (crowded.length > MAX_CROWDED_WARNINGS)
    warnings.push(
      `and ${count(crowded.length - MAX_CROWDED_WARNINGS, 'more crowded chord', 'more crowded chords')}`,
    );

  const ordered = [...drafts].sort(
    (a, b) =>
      a.onset - b.onset || (a.hand === b.hand ? 0 : a.hand === 'R' ? -1 : 1) || a.midi - b.midi,
  );
  const notes: Note[] = ordered.map((d, i) => ({
    id: `m${i}`,
    onsetTick: d.onset,
    offsetTick: d.offset,
    onsetSec: 0,
    offsetSec: 0,
    midi: d.midi,
    spelling: spellMidi(d.midi, key),
    hand: d.hand,
    staff: d.hand === 'R' ? 1 : 2,
    voice: d.hand === 'R' ? 1 : 5,
    measureIndex: measureAt(d.onset),
    isGrace: false,
    chordId: '',
    sourceIndices: [],
    velocity: d.velocity,
  }));
  const meta: Score['meta'] = {};
  if (opts.title !== undefined) meta.title = opts.title;
  if (opts.composer !== undefined) meta.composer = opts.composer;
  if (opts.source !== undefined) meta.source = opts.source;
  const score = finalizeScore({
    meta,
    divisions: D,
    tempoMap,
    timeSignatures,
    keySignatures,
    measures,
    notes,
  });
  const problems = validateScore(score);
  if (problems.length > 0) throw new Error(`invalid score from MIDI: ${problems.join('; ')}`);
  return { score, warnings };
}

interface Change {
  tick: number;
  beats: number;
  beatType: number;
}

/**
 * Measures from tick 0 that follow the time signature changes until they cover `endTick`; a
 * change inside a measure takes effect at the next barline (`moved` counts them). With a
 * `pickup` shorter than the first measure and `endTick` beyond it, the first measure is that
 * short one, numbered 0, and the full measures start after it.
 */
function buildMeasures(
  changes: readonly Change[],
  endTick: number,
  pickup: number,
  measureTicks: (t: Change) => number,
): { measures: MeasureInfo[]; timeSignatures: TimeSigEvent[]; moved: number; pickup: boolean } {
  const measures: MeasureInfo[] = [];
  const timeSignatures: TimeSigEvent[] = [];
  let current: Change = { tick: 0, beats: 4, beatType: 4 };
  let nextChange = 0;
  let moved = 0;
  let start = 0;
  let shortened = false;
  do {
    while (nextChange < changes.length && changes[nextChange]!.tick <= start) {
      current = changes[nextChange]!;
      if (current.tick !== start) moved++;
      nextChange++;
    }
    let length = measureTicks(current);
    if (start === 0 && pickup > 0 && pickup < length && endTick > pickup) {
      length = pickup;
      shortened = true;
    }
    const last = timeSignatures[timeSignatures.length - 1];
    if (!last || last.beats !== current.beats || last.beatType !== current.beatType)
      timeSignatures.push({ tick: start, beats: current.beats, beatType: current.beatType });
    measures.push({
      index: measures.length,
      startTick: start,
      lengthTicks: length,
      number: String(shortened ? measures.length : measures.length + 1),
    });
    start += length;
  } while (start < endTick);
  return { measures, timeSignatures, moved, pickup: shortened };
}
