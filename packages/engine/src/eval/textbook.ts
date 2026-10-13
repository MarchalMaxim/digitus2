import { solveFingering } from '../fingering/solve.js';
import type { SolveOptions } from '../fingering/solve.js';
import { finalizeScore } from '../score/build.js';
import { midiToSpelling } from '../score/pitch.js';
import type { Hand, Note, Score } from '../score/types.js';

export interface TextbookEntry {
  id: string;
  family: string;
  key?: string;
  mode?: string;
  hand: Hand;
  direction: string;
  octaves?: number;
  midi: number[];
  fingers: number[];
  source?: { name: string; url?: string };
  alternatives?: Array<{ fingers: number[]; source?: { name: string; url?: string } }>;
}

function hand(v: unknown): Hand | undefined {
  const s = String(v ?? '').toLowerCase();
  if (s === 'r' || s === 'rh' || s === 'right') return 'R';
  if (s === 'l' || s === 'lh' || s === 'left') return 'L';
  return undefined;
}

export function normalizeTextbookEntries(raw: unknown): {
  entries: TextbookEntry[];
  warnings: string[];
} {
  const list = Array.isArray(raw) ? raw : ((raw as { entries?: unknown[] })?.entries ?? []);
  const entries: TextbookEntry[] = [];
  const warnings: string[] = [];
  list.forEach((item, k) => {
    const e = item as Record<string, unknown>;
    const h = hand(e.hand);
    const midi = Array.isArray(e.midi) ? (e.midi as number[]) : [];
    const fingers = Array.isArray(e.fingers) ? (e.fingers as number[]) : [];
    const id = String(e.id ?? `entry-${k}`);
    if (!h || midi.length === 0 || midi.length !== fingers.length) {
      warnings.push(
        `${id}: skipped (hand ${String(e.hand)}, ${midi.length} notes, ${fingers.length} fingers)`,
      );
      return;
    }
    const alternatives = Array.isArray(e.alternatives)
      ? (
          e.alternatives as Array<{ fingers: number[]; source?: { name: string; url?: string } }>
        ).filter((a) => Array.isArray(a.fingers) && a.fingers.length === midi.length)
      : [];
    const entry: TextbookEntry = {
      id,
      family: String(e.family ?? 'unknown'),
      hand: h,
      direction: String(e.direction ?? ''),
      midi,
      fingers,
      alternatives,
    };
    if (typeof e.key === 'string') entry.key = e.key;
    if (typeof e.mode === 'string') entry.mode = e.mode;
    if (typeof e.octaves === 'number') entry.octaves = e.octaves;
    if (e.source && typeof e.source === 'object')
      entry.source = e.source as NonNullable<TextbookEntry['source']>;
    entries.push(entry);
  });
  return { entries, warnings };
}

export function scoreFromTextbookEntry(e: TextbookEntry, opts: { qpm?: number } = {}): Score {
  const qpm = opts.qpm ?? 120;
  const divisions = 480;
  const notes: Note[] = e.midi.map((midi, i) => ({
    id: `t${i}`,
    onsetTick: i * divisions,
    offsetTick: (i + 1) * divisions,
    onsetSec: 0,
    offsetSec: 0,
    midi,
    spelling: midiToSpelling(midi),
    hand: e.hand,
    staff: e.hand === 'R' ? 1 : 2,
    voice: 1,
    measureIndex: 0,
    isGrace: false,
    chordId: '',
    sourceIndices: [i],
  }));
  return finalizeScore({
    meta: { title: e.id },
    divisions,
    tempoMap: [{ tick: 0, qpm }],
    timeSignatures: [],
    keySignatures: [],
    measures: [],
    notes,
  });
}

export interface TextbookFamilyStats {
  entries: number;
  exact: number;
  noteAccuracy: number;
}
export interface TextbookReport {
  entries: number;
  exact: number;
  exactRate: number;
  noteAccuracy: number;
  byFamily: Record<string, TextbookFamilyStats>;
  failures: Array<{
    id: string;
    family: string;
    hand: Hand;
    expected: number[];
    got: number[];
    alternatives: number[][];
  }>;
}

/**
 * Solves every entry as a single-hand melody and scores it against the primary fingering and the
 * alternatives. `scoreOpts.qpm` sets the tempo of the generated quarter notes (default 120, so one
 * note every 0.5 s); the rule costs depend on the inter-onset interval, so the tempo matters.
 */
export function evaluateTextbook(
  entries: TextbookEntry[],
  solveOpts: SolveOptions = {},
  scoreOpts: { qpm?: number } = {},
): TextbookReport {
  const byFamily: Record<string, TextbookFamilyStats> = {};
  const failures: TextbookReport['failures'] = [];
  let exact = 0;
  let accSum = 0;
  for (const e of entries) {
    const score = scoreFromTextbookEntry(e, scoreOpts);
    const { assignment } = solveFingering(score, { ...solveOpts, hands: [e.hand] });
    const got = score.notes.map((n) => assignment[n.id]!.finger as number);
    const candidates = [e.fingers, ...(e.alternatives ?? []).map((a) => a.fingers)];
    const rate = (c: number[]) => c.reduce((s, f, i) => s + (f === got[i] ? 1 : 0), 0) / c.length;
    const best = Math.max(...candidates.map(rate));
    const isExact = best === 1;
    const fam = (byFamily[e.family] ??= { entries: 0, exact: 0, noteAccuracy: 0 });
    fam.entries++;
    fam.noteAccuracy += best;
    if (isExact) {
      exact++;
      fam.exact++;
    } else {
      failures.push({
        id: e.id,
        family: e.family,
        hand: e.hand,
        expected: e.fingers,
        got,
        alternatives: (e.alternatives ?? []).map((a) => a.fingers),
      });
    }
    accSum += best;
  }
  for (const fam of Object.values(byFamily))
    fam.noteAccuracy = fam.entries ? fam.noteAccuracy / fam.entries : 0;
  const n = entries.length;
  return {
    entries: n,
    exact,
    exactRate: n ? exact / n : 0,
    noteAccuracy: n ? accSum / n : 0,
    byFamily,
    failures,
  };
}
