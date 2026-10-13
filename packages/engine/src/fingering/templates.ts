// Type-only: eval/textbook.ts imports the solver, which imports this module, so a value import from
// it would make a load-order cycle. The type is erased at build time.
import type { TextbookEntry } from '../eval/textbook.js';
import type { Finger, Hand } from '../score/types.js';
import arpeggios from './params/textbook/arpeggios.json' with { type: 'json' };
import chromatic from './params/textbook/chromatic.json' with { type: 'json' };
import scales from './params/textbook/scales.json' with { type: 'json' };
import type { HandSequence } from './sequence.js';

/** A run of single notes over inclusive sequence indices `start..end`. */
export interface Run {
  start: number;
  end: number;
  kind: 'scale' | 'arpeggio' | 'chromatic';
  direction: 1 | -1;
}
/** Textbook fingers for the notes `start..end` (inclusive) of a hand sequence. */
export interface TemplateMatch {
  start: number;
  end: number;
  fingers: Finger[];
  entryId: string;
}

/** True when every value is a finger number 1..5. */
function isFingers(xs: readonly unknown[]): xs is Finger[] {
  return xs.every((f) => f === 1 || f === 2 || f === 3 || f === 4 || f === 5);
}
function isNumbers(xs: unknown): xs is number[] {
  return Array.isArray(xs) && xs.every((x) => typeof x === 'number' && Number.isFinite(x));
}
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Reads one oracle copy (`{ entries: [...] }`, hands `rh` / `lh`). It keeps an entry only when its
 * midi and fingers have the same nonzero length, every finger is 1..5 and it spans at most two
 * octaves (missing `octaves` counts as one). The files are not edited; templates.test.ts checks
 * that this reader keeps the same entries as `normalizeTextbookEntries`.
 */
function readTemplates(raw: unknown): TextbookEntry[] {
  const list: unknown = isRecord(raw) ? raw.entries : undefined;
  if (!Array.isArray(list)) return [];
  const items: unknown[] = list;
  const out: TextbookEntry[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const hand: Hand | undefined = item.hand === 'rh' ? 'R' : item.hand === 'lh' ? 'L' : undefined;
    const { midi, fingers, octaves } = item;
    if (!hand || !isNumbers(midi) || !Array.isArray(fingers)) continue;
    if (midi.length === 0 || midi.length !== fingers.length || !isFingers(fingers)) continue;
    if (typeof octaves === 'number' && octaves > 2) continue;
    const entry: TextbookEntry = {
      id: String(item.id),
      family: String(item.family ?? 'unknown'),
      hand,
      direction: String(item.direction ?? ''),
      midi,
      fingers,
    };
    if (typeof item.key === 'string') entry.key = item.key;
    if (typeof item.mode === 'string') entry.mode = item.mode;
    if (typeof octaves === 'number') entry.octaves = octaves;
    out.push(entry);
  }
  return out;
}

function load(): Record<Hand, TextbookEntry[]> {
  const all = [scales, arpeggios, chromatic].flatMap((raw: unknown) => readTemplates(raw));
  return { R: all.filter((e) => e.hand === 'R'), L: all.filter((e) => e.hand === 'L') };
}
/** Textbook entries of at most two octaves per hand, in file order: scales, arpeggios, chromatic. */
export const TEXTBOOK_TEMPLATES: Record<Hand, TextbookEntry[]> = load();

/**
 * Runs (literature 6.6 item 2): maximal stretches of consecutive single-note slices (no chords, no
 * grace notes) in one direction. Steps of 1 or 2 semitones over at least 4 notes make a scale
 * (chromatic when every step is 1); steps of 3 to 5 semitones over at least 3 notes make an
 * arpeggio. Consecutive runs share their turning note.
 */
export function detectRuns(seq: HandSequence): Run[] {
  const notes = seq.notes;
  const sliceSize = new Map<number, number>();
  for (const n of notes) sliceSize.set(n.slice, (sliceSize.get(n.slice) ?? 0) + 1);
  const single = (i: number): boolean => sliceSize.get(notes[i]!.slice) === 1 && !notes[i]!.isGrace;
  const kindOf = (s: number): 'step' | 'leap' => (Math.abs(s) <= 2 ? 'step' : 'leap');
  const runs: Run[] = [];
  let i = 0;
  while (i < notes.length) {
    if (!single(i)) {
      i++;
      continue;
    }
    // Extend a stretch of consistent direction with steps in 1..5 semitones.
    let j = i;
    let dir: 1 | -1 | 0 = 0;
    const steps: number[] = [];
    while (j + 1 < notes.length && single(j + 1)) {
      const step = notes[j + 1]!.midi - notes[j]!.midi;
      const d: 1 | -1 | 0 = step > 0 ? 1 : step < 0 ? -1 : 0;
      if (d === 0 || Math.abs(step) > 5 || (dir !== 0 && d !== dir)) break;
      if (steps.length > 0 && kindOf(steps[0]!) !== kindOf(step)) break;
      dir = d;
      steps.push(step);
      j++;
    }
    const len = j - i + 1;
    const first = steps[0];
    if (first !== undefined) {
      // Every step has the sign of the first one (the loop breaks on a change of direction).
      const direction = first > 0 ? 1 : -1;
      if (Math.abs(first) <= 2 && len >= 4) {
        const kind = steps.every((s) => Math.abs(s) === 1) ? 'chromatic' : 'scale';
        runs.push({ start: i, end: j, kind, direction });
      } else if (Math.abs(first) >= 3 && len >= 3) {
        runs.push({ start: i, end: j, kind: 'arpeggio', direction });
      }
    }
    i = len > 1 ? j : i + 1;
  }
  return runs;
}

/**
 * Shortest runs that take a template. A scale or chromatic run of up to five notes, or an arpeggio
 * of three (a broken triad), fits in one hand position; a template there is usually the middle of
 * a longer textbook fingering, often from another key, with a thumb crossing the position does not
 * need (five-finger melodies such as G A B C D C B A G would lose 1 2 3 4 5 4 3 2 1).
 */
const MIN_TEMPLATE_RUN: Record<Run['kind'], number> = { scale: 6, chromatic: 6, arpeggio: 4 };

/**
 * How well an entry is aligned to a run (literature 6.6 item 2: "aligned to the run's start note
 * and key"): 0 when the entry's tonic (its first note: entries start on the tonic or chord root)
 * has the pitch class of the run's first note, 1 when it has that of the run's last note, else 2.
 */
function alignment(e: TextbookEntry, midi: number[]): number {
  const tonic = pitchClass(e.midi[0]!);
  if (tonic === pitchClass(midi[0]!)) return 0;
  if (tonic === pitchClass(midi[midi.length - 1]!)) return 1;
  return 2;
}
function pitchClass(m: number): number {
  return ((m % 12) + 12) % 12;
}

/**
 * Matches runs to textbook entries of the same hand: an entry matches when the run's midi list is a
 * contiguous part of the entry's midi list up to a whole number of octaves; the template is the
 * entry's fingers over that part. Runs shorter than MIN_TEMPLATE_RUN take no template. Longer runs
 * go first. Among the matching entries, one whose tonic is the run's first note wins, then one
 * whose tonic is its last note, then file order. A later run never overrides fingers already
 * assigned by an earlier (longer) match: indices already taken are trimmed from its ends (two runs
 * share a turning note), and a match that would still overlap is dropped.
 */
export function matchTemplates(
  seq: HandSequence,
  runs: Run[],
  entries: TextbookEntry[],
): TemplateMatch[] {
  const matches: TemplateMatch[] = [];
  const taken = new Set<number>();
  const ordered = runs
    .filter((r) => r.end - r.start + 1 >= MIN_TEMPLATE_RUN[r.kind])
    .sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  for (const run of ordered) {
    const midi = seq.notes.slice(run.start, run.end + 1).map((n) => n.midi);
    let found: { fingers: Finger[]; entryId: string } | undefined;
    let rank = Number.POSITIVE_INFINITY;
    for (const e of entries) {
      const at = findShifted(e.midi, midi);
      if (at < 0) continue;
      const fingers = e.fingers.slice(at, at + midi.length);
      if (!isFingers(fingers)) continue;
      const r = alignment(e, midi);
      if (r >= rank) continue;
      found = { fingers, entryId: e.id };
      rank = r;
      if (r === 0) break;
    }
    if (!found) continue;
    let start = run.start;
    let end = run.end;
    while (start <= end && taken.has(start)) start++;
    while (end >= start && taken.has(end)) end--;
    if (start > end || indexRange(start, end).some((k) => taken.has(k))) continue;
    for (const k of indexRange(start, end)) taken.add(k);
    matches.push({
      start,
      end,
      fingers: found.fingers.slice(start - run.start, end - run.start + 1),
      entryId: found.entryId,
    });
  }
  return matches.sort((a, b) => a.start - b.start);
}

function indexRange(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, k) => a + k);
}

/** Index in `haystack` where `needle` occurs contiguously up to an octave shift, or -1. */
function findShifted(haystack: number[], needle: number[]): number {
  if (needle.length > haystack.length) return -1;
  for (let at = 0; at + needle.length <= haystack.length; at++) {
    const shift = haystack[at]! - needle[0]!;
    if (shift % 12 !== 0) continue;
    let ok = true;
    for (let k = 1; k < needle.length; k++) {
      if (haystack[at + k]! - needle[k]! !== shift) {
        ok = false;
        break;
      }
    }
    if (ok) return at;
  }
  return -1;
}

/** The template finger for sequence index `i`, or undefined outside every match. */
export function templateFingerAt(matches: TemplateMatch[], i: number): Finger | undefined {
  for (const m of matches) if (i >= m.start && i <= m.end) return m.fingers[i - m.start];
  return undefined;
}
