import { count } from './plural.js';
import { midiTickToSeconds, type MidiData } from './read.js';

/** Ticks per quarter of every quantized position; lcm(4, 6, 8) divides it. */
export const QUANT_DIVISIONS = 480;
export type GridKind = '16th' | '16th-triplet' | '32nd';
/** Candidate grids in simplicity order: a richer grid must earn its place (see chooseGrid). */
export const GRID_KINDS: readonly GridKind[] = ['16th', '16th-triplet', '32nd'];
export const GRID_UNIT: Readonly<Record<GridKind, number>> = {
  '16th': 120,
  '16th-triplet': 80,
  '32nd': 60,
};
/** A richer grid wins only when it at least halves the beat's total displacement ... */
export const GRID_GAIN = 2;
/** ... and saves more than this many ticks per onset (plan decision 4). */
export const GRID_TOLERANCE_TICKS = 8;
/** A 64th note: snapping to the 16th grid never moves an onset more than a 32nd (decision 3). */
export const MOVED_THRESHOLD_TICKS = 30;
/** An onset up to a 64th note early belongs to the next beat. */
const BEAT_LEAD = 30;

export interface QuantizedNote {
  /** QUANT_DIVISIONS ticks. */
  onset: number;
  offset: number;
  /** Seconds of the snapped onset through the file's tempo map. */
  onsetSec: number;
  midi: number;
  velocity: number;
  channel: number;
  track: number;
  /** Indices into MidiData.notes merged into this note, ascending. */
  sources: number[];
}
export interface QuantizedNotes {
  /** QUANT_DIVISIONS. */
  divisions: number;
  /** Sorted by onset, then midi. */
  notes: QuantizedNote[];
  /** Quarter-note beats that contain onsets, and the grid each one uses. */
  beatGrids: Array<{ beat: number; grid: GridKind }>;
  /** How many of those beats use each grid. */
  grids: Record<GridKind, number>;
  /** Share of source notes whose onset moved more than a 64th note (0..1). */
  movedShare: number;
  /** Onset displacement in milliseconds, over source notes. */
  displacementMs: { mean: number; p95: number; max: number };
  warnings: string[];
}
export interface QuantizeOptions {
  /** Candidate grids in simplicity order; default GRID_KINDS. */
  grids?: readonly GridKind[];
}

export function snapTo(position: number, grid: GridKind): number {
  const unit = GRID_UNIT[grid];
  return Math.round(position / unit) * unit;
}

export function beatOf(position: number): number {
  return Math.floor((position + BEAT_LEAD) / QUANT_DIVISIONS);
}

/**
 * The grid of one beat: start from the simplest and move to the next only when the current one's
 * total displacement exceeds GRID_GAIN times the next one's plus GRID_TOLERANCE_TICKS per onset.
 */
export function chooseGrid(
  onsets: readonly number[],
  grids: readonly GridKind[] = GRID_KINDS,
): GridKind {
  const displacement = (g: GridKind) => onsets.reduce((s, p) => s + Math.abs(p - snapTo(p, g)), 0);
  let best = grids[0] ?? '16th';
  let bestD = displacement(best);
  for (const g of grids.slice(1)) {
    const d = displacement(g);
    if (bestD > GRID_GAIN * d + onsets.length * GRID_TOLERANCE_TICKS) {
      best = g;
      bestD = d;
    }
  }
  return best;
}

/**
 * Snaps every note to a per-beat grid at QUANT_DIVISIONS ticks per quarter. Onsets snap to their
 * beat's grid; offsets snap to the grid of the beat they fall in (the first candidate grid when
 * that beat has no onsets) and end at least one grid unit after the onset. Notes with the same
 * snapped onset and key merge; a note that passes the next onset on its key ends there.
 */
export function quantize(data: MidiData, opts: QuantizeOptions = {}): QuantizedNotes {
  const grids = opts.grids ?? GRID_KINDS;
  const scale = QUANT_DIVISIONS / data.ppq;
  const raw = data.notes.map((n) => ({ on: n.tick * scale, off: n.endTick * scale }));

  const onsetsByBeat = new Map<number, number[]>();
  for (const r of raw) {
    const b = beatOf(r.on);
    const list = onsetsByBeat.get(b);
    if (list) list.push(r.on);
    else onsetsByBeat.set(b, [r.on]);
  }
  const gridOfBeat = new Map<number, GridKind>();
  const counts: Record<GridKind, number> = { '16th': 0, '16th-triplet': 0, '32nd': 0 };
  const beats = [...onsetsByBeat.keys()].sort((a, b) => a - b);
  for (const b of beats) {
    const g = chooseGrid(onsetsByBeat.get(b)!, grids);
    gridOfBeat.set(b, g);
    counts[g]++;
  }
  const fallback = grids[0] ?? '16th';
  const gridAt = (p: number): GridKind => gridOfBeat.get(beatOf(p)) ?? fallback;
  const seconds = (p: number) => midiTickToSeconds(data, p / scale);

  const movedTicks: number[] = [];
  const movedMs: number[] = [];
  const snapped: QuantizedNote[] = data.notes.map((n, i) => {
    const r = raw[i]!;
    const g = gridAt(r.on);
    const onset = snapTo(r.on, g);
    let offset = snapTo(r.off, gridAt(r.off));
    if (offset < onset + GRID_UNIT[g]) offset = onset + GRID_UNIT[g];
    movedTicks.push(Math.abs(onset - r.on));
    movedMs.push(Math.abs(seconds(onset) - seconds(r.on)) * 1000);
    return {
      onset,
      offset,
      onsetSec: seconds(onset),
      midi: n.midi,
      velocity: n.velocity,
      channel: n.channel,
      track: n.track,
      sources: [i],
    };
  });

  snapped.sort((a, b) => a.onset - b.onset || a.midi - b.midi || a.sources[0]! - b.sources[0]!);
  const notes: QuantizedNote[] = [];
  let duplicates = 0;
  for (const n of snapped) {
    const last = notes[notes.length - 1];
    if (last && last.onset === n.onset && last.midi === n.midi) {
      last.offset = Math.max(last.offset, n.offset);
      last.velocity = Math.max(last.velocity, n.velocity);
      last.sources.push(...n.sources);
      duplicates++;
    } else notes.push(n);
  }
  const byKey = new Map<number, QuantizedNote[]>();
  for (const n of notes) {
    const list = byKey.get(n.midi);
    if (list) list.push(n);
    else byKey.set(n.midi, [n]);
  }
  let shortened = 0;
  for (const list of byKey.values())
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i]!;
      const b = list[i + 1]!;
      if (a.offset > b.onset) {
        a.offset = b.onset;
        shortened++;
      }
    }

  const warnings: string[] = [];
  if (duplicates > 0)
    warnings.push(`merged ${count(duplicates, 'duplicate note', 'duplicate notes')}`);
  if (shortened > 0)
    warnings.push(
      `shortened ${count(shortened, 'note that overlapped', 'notes that overlapped')} the next note on the same key`,
    );
  const sortedMs = [...movedMs].sort((a, b) => a - b);
  const n = movedMs.length;
  return {
    divisions: QUANT_DIVISIONS,
    notes,
    beatGrids: beats.map((beat) => ({ beat, grid: gridOfBeat.get(beat)! })),
    grids: counts,
    movedShare: n === 0 ? 0 : movedTicks.filter((t) => t > MOVED_THRESHOLD_TICKS).length / n,
    displacementMs: {
      mean: n === 0 ? 0 : movedMs.reduce((s, x) => s + x, 0) / n,
      p95: n === 0 ? 0 : sortedMs[Math.ceil(0.95 * n) - 1]!,
      max: n === 0 ? 0 : sortedMs[n - 1]!,
    },
    warnings,
  };
}
