import type { MeasureInfo, Note, Score } from '../score/types.js';

export interface OmrMetric {
  matched: number;
  reference: number;
  recognized: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface OmrMetrics {
  pitch: OmrMetric;
  onsetPitch: OmrMetric;
  duration: OmrMetric;
  staff: OmrMetric;
  voice: OmrMetric;
  fullNote: OmrMetric;
}

export interface OmrBarEvaluation {
  /** Zero-based position in the measure arrays, independent of printed bar numbers. */
  ordinal: number;
  referenceMeasureIndex: number | null;
  recognizedMeasureIndex: number | null;
  referenceNotes: number;
  recognizedNotes: number;
  metrics: OmrMetrics;
  timing: {
    /** Reduced rational quarter-note units; null denotes an absent bar. */
    referenceStart: string | null;
    recognizedStart: string | null;
    referenceLength: string | null;
    recognizedLength: string | null;
    startMatches: boolean;
    lengthMatches: boolean;
  };
}

export interface OmrEvaluation {
  referenceNotes: number;
  recognizedNotes: number;
  referenceBars: number;
  recognizedBars: number;
  missingBars: number;
  extraBars: number;
  /** Bars with unequal absolute starts, lengths, or an absent counterpart. */
  barTimingMismatches: number;
  metrics: OmrMetrics;
  bars: OmrBarEvaluation[];
}

const metricNames = ['pitch', 'onsetPitch', 'duration', 'staff', 'voice', 'fullNote'] as const;
type Projection = Record<keyof OmrMetrics, string[]>;
interface PreparedBar {
  measure: MeasureInfo;
  start: string;
  length: string;
  notes: Note[];
  projections: Projection;
}

function integer(value: number, name: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer >= ${minimum}`);
  }
}

/** BigInt arithmetic preserves exact equality even for large safe tick values. */
function quarters(ticks: bigint, divisions: number): string {
  let a = ticks < 0n ? -ticks : ticks;
  let b = BigInt(divisions);
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return `${ticks / a}/${BigInt(divisions) / a}`;
}

function projections(notes: Note[], measure: MeasureInfo, divisions: number): Projection {
  const result: Projection = {
    pitch: [],
    onsetPitch: [],
    duration: [],
    staff: [],
    voice: [],
    fullNote: [],
  };
  const onsetPitches = notes.map(
    (n) => [quarters(BigInt(n.onsetTick) - BigInt(measure.startTick), divisions), n.midi] as const,
  );
  // A voice is its multiset of onset/pitch events on this staff in this bar. Literal
  // voice labels and the order of chord members carry no recognition information.
  const voices = new Map<string, string[]>();
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    const label = JSON.stringify([n.staff, n.voice]);
    const events = voices.get(label) ?? [];
    events.push(JSON.stringify(onsetPitches[i]));
    voices.set(label, events);
  }
  const partitions = new Map(
    [...voices].map(([label, events]) => [label, JSON.stringify(events.sort())]),
  );
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    const onsetPitch = onsetPitches[i]!;
    const duration = quarters(BigInt(n.offsetTick) - BigInt(n.onsetTick), divisions);
    const voice = partitions.get(JSON.stringify([n.staff, n.voice]))!;
    result.pitch.push(JSON.stringify([n.midi]));
    result.onsetPitch.push(JSON.stringify(onsetPitch));
    result.duration.push(JSON.stringify([...onsetPitch, duration]));
    result.staff.push(JSON.stringify([...onsetPitch, n.staff]));
    result.voice.push(JSON.stringify([...onsetPitch, n.staff, voice]));
    result.fullNote.push(JSON.stringify([...onsetPitch, duration, n.staff, n.isGrace, voice]));
  }
  return result;
}

function prepare(score: Score, side: string): PreparedBar[] {
  integer(score.divisions, `${side}.divisions`, 1);
  const byIndex = new Map<number, PreparedBar>();
  const bars = score.measures.map((measure) => {
    integer(measure.index, `${side}.measure.index`);
    integer(measure.startTick, `${side}.measure.startTick`);
    integer(measure.lengthTicks, `${side}.measure.lengthTicks`);
    if (byIndex.has(measure.index)) {
      throw new RangeError(`${side}.measure.index must be unique`);
    }
    const bar: PreparedBar = {
      measure,
      start: quarters(BigInt(measure.startTick), score.divisions),
      length: quarters(BigInt(measure.lengthTicks), score.divisions),
      notes: [],
      projections: { pitch: [], onsetPitch: [], duration: [], staff: [], voice: [], fullNote: [] },
    };
    byIndex.set(measure.index, bar);
    return bar;
  });
  for (const n of score.notes) {
    integer(n.onsetTick, `${side}.note.onsetTick`);
    integer(n.offsetTick, `${side}.note.offsetTick`);
    integer(n.measureIndex, `${side}.note.measureIndex`);
    integer(n.midi, `${side}.note.midi`);
    integer(n.staff, `${side}.note.staff`, 1);
    integer(n.voice, `${side}.note.voice`);
    if (n.midi > 127) throw new RangeError(`${side}.note.midi must be <= 127`);
    if (n.offsetTick < n.onsetTick) {
      throw new RangeError(`${side}.note.offsetTick must be >= onsetTick`);
    }
    const bar = byIndex.get(n.measureIndex);
    if (!bar) throw new RangeError(`${side}.note.measureIndex must refer to a measure`);
    if (n.onsetTick < bar.measure.startTick) {
      throw new RangeError(`${side}.note.onsetTick must be >= its measure startTick`);
    }
    bar.notes.push(n);
  }
  for (const bar of bars) {
    bar.projections = projections(bar.notes, bar.measure, score.divisions);
  }
  return bars;
}

function metric(matched: number, reference: number, recognized: number): OmrMetric {
  // Empty vs empty is exact agreement. A one-sided empty input scores zero on
  // all rates, avoiding an undefined precision or recall in reports and JSON.
  const empty = reference === 0 && recognized === 0;
  return {
    matched,
    reference,
    recognized,
    precision: recognized ? matched / recognized : Number(empty),
    recall: reference ? matched / reference : Number(empty),
    f1: empty ? 1 : (2 * matched) / (reference + recognized),
  };
}

function compare(reference: readonly string[], recognized: readonly string[]): OmrMetric {
  const available = new Map<string, number>();
  for (const key of reference) available.set(key, (available.get(key) ?? 0) + 1);
  let matched = 0;
  for (const key of recognized) {
    const count = available.get(key) ?? 0;
    if (count > 0) {
      matched++;
      available.set(key, count - 1);
    }
  }
  return metric(matched, reference.length, recognized.length);
}

function emptyMetrics(): OmrMetrics {
  return {
    pitch: metric(0, 0, 0),
    onsetPitch: metric(0, 0, 0),
    duration: metric(0, 0, 0),
    staff: metric(0, 0, 0),
    voice: metric(0, 0, 0),
    fullNote: metric(0, 0, 0),
  };
}

/**
 * Independent multiset projections, paired by ordinal bar; rates are in [0, 1].
 * Notes use exact local onset and sounding duration in quarter-note units.
 * IDs, spelling, chord order, hand labels, seconds and literal voice numbers
 * are ignored. Ties follow Score's merged sounding-note representation.
 * Parse MusicXML inputs with { preserveNotation: true } on both sides: ordinary
 * application import removes duplicate notes and normalizes chord durations.
 * Caller-built scores must use global staff identities across all parts.
 *
 * Voice membership is a per-bar, per-staff partition of onset/pitch events.
 * A changed partition affects all its member notes, not just the changed note.
 * Full-note matching includes that partition, duration, staff and grace status.
 *
 * This baseline deliberately does no heuristic measure alignment: an inserted
 * or deleted middle bar misaligns subsequent bars. Missing/extra counts describe
 * unmatched trailing bars. Inspect barTimingMismatches as well as note metrics:
 * note-only metrics cannot detect added empty measures or corrupt silent time.
 */
export function evaluateOmr(reference: Score, recognized: Score): OmrEvaluation {
  const refBars = prepare(reference, 'reference');
  const recBars = prepare(recognized, 'recognized');
  const bars: OmrBarEvaluation[] = [];
  const totals = emptyMetrics();
  let barTimingMismatches = 0;
  for (let ordinal = 0; ordinal < Math.max(refBars.length, recBars.length); ordinal++) {
    const ref = refBars[ordinal];
    const rec = recBars[ordinal];
    const metrics = emptyMetrics();
    for (const name of metricNames) {
      const current = compare(ref?.projections[name] ?? [], rec?.projections[name] ?? []);
      metrics[name] = current;
      const total = totals[name];
      totals[name] = metric(
        total.matched + current.matched,
        total.reference + current.reference,
        total.recognized + current.recognized,
      );
    }
    const startMatches = ref !== undefined && rec !== undefined && ref.start === rec.start;
    const lengthMatches = ref !== undefined && rec !== undefined && ref.length === rec.length;
    if (!startMatches || !lengthMatches) barTimingMismatches++;
    bars.push({
      ordinal,
      referenceMeasureIndex: ref?.measure.index ?? null,
      recognizedMeasureIndex: rec?.measure.index ?? null,
      referenceNotes: ref?.notes.length ?? 0,
      recognizedNotes: rec?.notes.length ?? 0,
      metrics,
      timing: {
        referenceStart: ref?.start ?? null,
        recognizedStart: rec?.start ?? null,
        referenceLength: ref?.length ?? null,
        recognizedLength: rec?.length ?? null,
        startMatches,
        lengthMatches,
      },
    });
  }
  return {
    referenceNotes: reference.notes.length,
    recognizedNotes: recognized.notes.length,
    referenceBars: refBars.length,
    recognizedBars: recBars.length,
    missingBars: Math.max(0, refBars.length - recBars.length),
    extraBars: Math.max(0, recBars.length - refBars.length),
    barTimingMismatches,
    metrics: totals,
    bars,
  };
}
