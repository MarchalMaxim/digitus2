import { mirrorPitch } from '../fingering/geometry.js';
import { buildHandSequence } from '../fingering/sequence.js';
import { solveFingering } from '../fingering/solve.js';
import type { SolveOptions, SolveResult } from '../fingering/solve.js';
import { detectRuns } from '../fingering/templates.js';
import { lintFingering } from '../lint/index.js';
import { finalizeScore, ticksToSeconds } from '../score/build.js';
import { midiToSpelling, PIANO_MAX, PIANO_MIN } from '../score/pitch.js';
import type { Assignment, Hand, Note, Score } from '../score/types.js';

export type MetamorphicId = 'DET' | 'MR1' | 'MR2' | 'MR6' | 'MR7' | 'MR8' | 'MR10';
export interface MetamorphicCheck {
  id: MetamorphicId;
  title: string;
  passed: boolean;
  agreement: number;
  threshold: number;
  details: string;
}
export interface MetamorphicReport {
  checks: MetamorphicCheck[];
  passed: boolean;
}

const DEFAULT_THRESHOLDS: Record<MetamorphicId, number> = {
  DET: 1,
  MR1: 1,
  MR2: 1,
  MR10: 1,
  MR6: 0.9,
  MR7: 0.98,
  MR8: 1,
};

/**
 * Builds a transformed score without touching the input: every note is cloned before
 * `finalizeScore` (which writes chord ids and seconds onto the note objects it gets), and each
 * note keeps the seconds it was given, because `finalizeScore` would replace exact seconds (PIG
 * files) with tick-rounded ones and the transformed piece would no longer have the same timing as
 * the original.
 */
function rebuild(score: Score, notes: Note[], tempoMap = score.tempoMap): Score {
  const seconds = new Map(notes.map((n) => [n.id, [n.onsetSec, n.offsetSec] as const]));
  const out = finalizeScore({
    ...score,
    tempoMap,
    notes: notes.map((n) => ({ ...n, sourceIndices: [...n.sourceIndices] })),
  });
  for (const n of out.notes) {
    const s = seconds.get(n.id);
    if (s) [n.onsetSec, n.offsetSec] = s;
  }
  return out;
}

export function transposeScore(score: Score, semitones: number): Score {
  return rebuild(
    score,
    score.notes.map((n) => ({
      ...n,
      midi: n.midi + semitones,
      spelling: midiToSpelling(n.midi + semitones),
    })),
  );
}

export function mirrorScore(score: Score): Score {
  return rebuild(
    score,
    score.notes.map((n) => ({
      ...n,
      midi: mirrorPitch(n.midi),
      spelling: midiToSpelling(mirrorPitch(n.midi)),
      hand: n.hand === 'R' ? 'L' : 'R',
      staff: n.staff === 1 ? 2 : 1,
    })),
  );
}

/**
 * The piece followed by `copies - 1` copies of itself. Copy k starts k periods later (a period is
 * the piece's end plus `gapTicks`) and its ids carry k apostrophes. Every copy keeps the
 * original's timing exactly: seconds move by k times the period's duration, and the tempo map
 * repeats each period so ticks and seconds stay consistent.
 */
function repeatScore(score: Score, copies: number, gapTicks: number): Score {
  if (score.notes.length === 0) return rebuild(score, []);
  const period = Math.max(...score.notes.map((n) => n.offsetTick)) + gapTicks;
  const periodSec = ticksToSeconds(score.tempoMap, score.divisions, period);
  const once = score.tempoMap.filter((e) => e.tick < period);
  const repeatTempo = score.tempoMap.some((e) => e.tick <= 0);
  const tempoMap = [...once];
  const notes = [...score.notes];
  for (let k = 1; k < copies; k++) {
    const shift = k * period;
    const shiftSec = k * periodSec;
    if (repeatTempo)
      tempoMap.push(...once.map((e) => ({ ...e, tick: Math.max(0, e.tick) + shift })));
    const mark = "'".repeat(k);
    for (const n of score.notes)
      notes.push({
        ...n,
        id: `${n.id}${mark}`,
        onsetTick: n.onsetTick + shift,
        offsetTick: n.offsetTick + shift,
        onsetSec: n.onsetSec + shiftSec,
        offsetSec: n.offsetSec + shiftSec,
        sourceIndices: [],
      });
  }
  return rebuild(score, notes, repeatTempo ? tempoMap : score.tempoMap);
}

export function duplicateScore(score: Score, gapTicks = score.divisions): Score {
  return repeatScore(score, 2, gapTicks);
}

/** The note `perturbLastNote` moves: the latest onset, the highest pitch among ties. */
function lastNote(score: Score): Note | undefined {
  return [...score.notes].sort((a, b) => b.onsetTick - a.onsetTick || b.midi - a.midi)[0];
}

export function perturbLastNote(score: Score): Score {
  const last = lastNote(score);
  if (!last) return rebuild(score, []);
  const delta = last.midi + 2 <= PIANO_MAX ? 2 : -2;
  return rebuild(
    score,
    score.notes.map((n) =>
      n.id === last.id
        ? { ...n, midi: n.midi + delta, spelling: midiToSpelling(n.midi + delta) }
        : n,
    ),
  );
}

/**
 * Notes whose fingers may change with the moved note however far away they are: a textbook
 * template is chosen for a run as a whole (Task 8), so every run through the moved note, before or
 * after the move, and every run chained to one of those by a shared note.
 */
function runNotesThrough(score: Score, moved: Score, noteId: string, hand: Hand): Set<string> {
  const out = new Set<string>();
  for (const s of [score, moved]) {
    const seq = buildHandSequence(s, hand);
    const at = seq.notes.findIndex((n) => n.noteId === noteId);
    const runs = detectRuns(seq);
    const chained = runs.filter((r) => r.start <= at && at <= r.end);
    for (let grew = chained.length > 0; grew;) {
      grew = false;
      for (const r of runs) {
        if (chained.includes(r)) continue;
        if (chained.some((c) => r.start <= c.end && c.start <= r.end)) {
          chained.push(r);
          grew = true;
        }
      }
    }
    for (const r of chained) for (let i = r.start; i <= r.end; i++) out.add(seq.notes[i]!.noteId);
  }
  return out;
}

function fingers(score: Score, a: Assignment): Map<string, number> {
  return new Map(score.notes.map((n) => [n.id, a[n.id]?.finger ?? 0]));
}

function agreement<T>(
  a: Map<string, T>,
  b: Map<string, T>,
  ids: Iterable<string>,
  mapId: (id: string) => string = (x) => x,
): number {
  let total = 0;
  let same = 0;
  for (const id of ids) {
    total++;
    if (a.get(id) === b.get(mapId(id))) same++;
  }
  return total === 0 ? 1 : same / total;
}

/**
 * The complete solver output, serialized per note (assignment entry and explanation) and per hand
 * (cost, iterations, relaxation), so determinism is checked byte for byte, not only on fingers.
 */
function serialized(score: Score, r: SolveResult): Map<string, string> {
  const out = new Map(
    score.notes.map((n) => [
      n.id,
      JSON.stringify([r.assignment[n.id] ?? null, r.explanations[n.id] ?? null]),
    ]),
  );
  for (const h of r.hands) out.set(`hand ${h.hand}`, JSON.stringify(h));
  return out;
}

export function runMetamorphic(
  score: Score,
  opts: SolveOptions & { thresholds?: Partial<Record<MetamorphicId, number>> } = {},
): MetamorphicReport {
  const { thresholds, ...solveOpts } = opts;
  const th = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const first = solveFingering(score, solveOpts);
  const base = fingers(score, first.assignment);
  const ids = score.notes.map((n) => n.id);
  const checks: MetamorphicCheck[] = [];
  const add = (id: MetamorphicId, title: string, value: number, details: string): void => {
    checks.push({
      id,
      title,
      passed: value >= th[id] - 1e-12,
      agreement: value,
      threshold: th[id],
      details,
    });
  };

  // Byte-identical output (verification spec 3.4): fingers, confidences, alternatives and
  // explanations of every note and each hand's summary, not only the fingers. The agreement is
  // the share of those items that serialize identically.
  const second = solveFingering(score, solveOpts);
  const out1 = serialized(score, first);
  const out2 = serialized(score, second);
  const identical = JSON.stringify(first) === JSON.stringify(second);
  add(
    'DET',
    'Determinism',
    agreement(out1, out2, new Set([...out1.keys(), ...out2.keys()])),
    `two solves compared over ${score.notes.length} notes and ${first.hands.length} hand summaries; complete results ${identical ? 'byte-identical' : 'differ'}`,
  );

  const up = score.notes.every((n) => n.midi + 12 <= PIANO_MAX);
  const down = score.notes.every((n) => n.midi - 12 >= PIANO_MIN);
  if (up || down) {
    const t = transposeScore(score, up ? 12 : -12);
    add(
      'MR1',
      'Octave transposition',
      agreement(base, fingers(t, solveFingering(t, solveOpts).assignment), ids),
      `transposed by ${up ? '+12' : '-12'}`,
    );
  } else {
    add('MR1', 'Octave transposition', 1, 'skipped: piece spans the whole keyboard');
  }

  // The rule engine is mirror-symmetric by construction; the textbook templates are not (they are
  // the books' right- and left-hand fingerings, which are not mirror images of each other), so
  // this check compares the rule engine with templates switched off on both sides.
  const symmetric = { ...solveOpts, templates: false };
  const m = mirrorScore(score);
  add(
    'MR2',
    'Mirror symmetry',
    agreement(
      fingers(score, solveFingering(score, symmetric).assignment),
      fingers(m, solveFingering(m, symmetric).assignment),
      ids,
    ),
    'mirrored about D4 with hands swapped; textbook templates off on both sides',
  );

  const flat = rebuild(
    score,
    score.notes.map((n) => ({ ...n, spelling: midiToSpelling(n.midi, 'flat') })),
  );
  add(
    'MR10',
    'Enharmonic respelling',
    agreement(base, fingers(flat, solveFingering(flat, solveOpts).assignment), ids),
    'all spellings flattened',
  );

  // Identical passages in identical context (verification spec 3.4): of four copies, the second
  // and the third both have a copy of the piece before and after them, so only differences the
  // piece itself causes remain (the first and last copies each have one open end).
  const r = repeatScore(score, 4, score.divisions);
  const repFingers = fingers(r, solveFingering(r, solveOpts).assignment);
  add(
    'MR6',
    'Repeated passage',
    agreement(
      repFingers,
      repFingers,
      ids.map((id) => `${id}'`),
      (id) => `${id}'`,
    ),
    'third copy versus second copy of four (identical context on both sides)',
  );

  // Notes of a template run through the moved note are left out: the run's template is a decision
  // for the whole run, so a change there is legitimate wherever the run starts.
  const moved = lastNote(score);
  const p = perturbLastNote(score);
  const half =
    (Math.min(...score.notes.map((n) => n.onsetTick)) +
      Math.max(...score.notes.map((n) => n.onsetTick))) /
    2;
  const exempt =
    moved && solveOpts.templates !== false
      ? runNotesThrough(score, p, moved.id, moved.hand)
      : new Set<string>();
  const firstHalf = score.notes.filter((n) => n.onsetTick < half);
  const early = firstHalf.filter((n) => !exempt.has(n.id)).map((n) => n.id);
  add(
    'MR7',
    'Locality',
    agreement(base, fingers(p, solveFingering(p, solveOpts).assignment), early),
    `${early.length} notes in the first half compared after moving the last note` +
      ` (${firstHalf.length - early.length} left out as part of a template run through it)`,
  );

  const smallSolution = solveFingering(score, { ...solveOpts, profile: 'small' }).assignment;
  const largeSolution = solveFingering(score, { ...solveOpts, profile: 'large' }).assignment;
  const smallErrors = lintFingering(score, smallSolution, { profile: 'small' }).errors;
  const largeUnderSmall = lintFingering(score, largeSolution, { profile: 'small' }).errors;
  add(
    'MR8',
    'Smaller hand',
    smallErrors <= largeUnderSmall ? 1 : 0,
    `lint errors under the small profile: small solution ${smallErrors}, large solution ${largeUnderSmall}`,
  );

  return { checks, passed: checks.every((c) => c.passed) };
}
