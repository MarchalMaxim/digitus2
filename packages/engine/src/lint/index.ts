import { x14 } from '../fingering/geometry.js';
import { forEachHold, HOLD_EPS } from '../fingering/reach.js';
import { isReleased } from '../fingering/rules.js';
import { buildHandSequence, isThumbCrossing } from '../fingering/sequence.js';
import type { SeqNote } from '../fingering/sequence.js';
import { resolveProfile, span } from '../fingering/spans.js';
import type { HandProfile, HandProfileId } from '../fingering/spans.js';
import type { Assignment, Finger, Hand, Score } from '../score/types.js';
import { lintHand } from './rules.js';
import type { LintIssue, LintRuleId } from './rules.js';

export { LINT_RULES } from './rules.js';
export type { LintIssue, LintRuleId, LintSeverity } from './rules.js';

export interface LintOptions {
  profile?: HandProfileId | HandProfile;
  hopFastSec?: number;
  repeatFastSec?: number;
  beginner?: boolean;
  /**
   * Hold tolerance in seconds of the held-key laws L03 and L05 (`forEachHold`), as the solver's
   * `SolveOptions.holdEpsSec`; default `HOLD_EPS` (1 ms).
   */
  holdEpsSec?: number;
}
export interface LintReport {
  issues: LintIssue[];
  counts: Partial<Record<LintRuleId, number>>;
  errors: number;
  warnings: number;
  infos: number;
  notes: number;
}

export function lintFingering(
  score: Score,
  assignment: Assignment,
  opts: LintOptions = {},
): LintReport {
  const profile = resolveProfile(opts.profile);
  const ctx = {
    tables: profile.tables,
    hopFastSec: opts.hopFastSec ?? 0.25,
    repeatFastSec: opts.repeatFastSec ?? 0.18,
    beginner: opts.beginner ?? false,
    holdEpsSec: opts.holdEpsSec ?? HOLD_EPS,
  };
  const issues: LintIssue[] = [];
  for (const hand of ['R', 'L'] as Hand[]) {
    const seq = buildHandSequence(score, hand);
    const fingered = seq.notes
      .filter((n) => assignment[n.noteId] !== undefined)
      .map((n) => ({
        note: n,
        finger: assignment[n.noteId]!.finger,
        substitution: assignment[n.noteId]!.substitution,
      }));
    issues.push(...lintHand(hand, fingered, ctx));
  }
  const counts: Partial<Record<LintRuleId, number>> = {};
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const i of issues) {
    counts[i.rule] = (counts[i.rule] ?? 0) + 1;
    if (i.severity === 'error') errors++;
    else if (i.severity === 'warning') warnings++;
    else infos++;
  }
  return { issues, counts, errors, warnings, infos, notes: score.notes.length };
}

const HANDS: Hand[] = ['R', 'L'];

/** Each hand's sequence notes that `assignment` fingers, in sequence order, with their fingers. */
function fingeredNotes(score: Score, assignment: Assignment, hand: Hand) {
  return buildHandSequence(score, hand)
    .notes.filter((n) => assignment[n.noteId] !== undefined)
    .map((n) => ({ note: n, finger: assignment[n.noteId]!.finger }));
}

/**
 * The five-finger anchor a note played by finger f implies, in white keys (x14 / 2, a black key
 * half way): where the thumb would be. The hand-position model of literature 6.6 item 1, as the
 * solver's handPositionShift term reads it (`rules.ts`).
 */
const anchorOf = (n: SeqNote, f: Finger): number => x14(n.pitch) / 2 - (f - 1);

/**
 * Hand-position changes of a fingering (M3 Task 8; verification spec goals row "Be easy to play"):
 * over both hands, the neighbouring fingered notes of a hand's sequence in different slices whose
 * implied five-finger anchor moves by at least one white key. Literature 6.6 item 1 counts any
 * move (a_n != a_{n-1}), but a black key under finger 2, 3 or 4 moves the anchor half a key while
 * the hand stays (D E F# G A under 1 2 3 4 5 is one position), so half a key is not a change. The
 * notes of one slice are one event, so a chord's own fingering is not a change. A measure, not a
 * lint rule: it reports no issue.
 */
export function positionChanges(score: Score, assignment: Assignment): number {
  let changes = 0;
  for (const hand of HANDS) {
    const notes = fingeredNotes(score, assignment, hand);
    for (let k = 1; k < notes.length; k++) {
      const a = notes[k - 1]!;
      const b = notes[k]!;
      const moved = Math.abs(anchorOf(b.note, b.finger) - anchorOf(a.note, a.finger));
      if (a.note.slice !== b.note.slice && moved >= 1) changes++;
    }
  }
  return changes;
}

/** Widest span, in semitones, that is not a stretch wider than an octave. */
const OCTAVE = 12;

/** A span of more than an octave that a fingering asks one hand to stretch over (`wideStretches`). */
export interface WideStretch {
  /**
   * `held`: a key still down at a later note's onset, the solver's and lint's held pair
   * (`forEachHold`, which takes a hold no hand of the profile can span for a pedal or a release).
   * `reach`: two neighbouring single notes played legato (no rest, the first key not released
   * before the second starts) by two fingers that open the hand across the leap: different
   * fingers, no thumb crossing, the leap within their practical span, so the fingering spans it
   * instead of moving the hand.
   */
  kind: 'held' | 'reach';
  hand: Hand;
  noteIds: string[];
  /** Semitones between the two keys. */
  semitones: number;
}

/**
 * Stretches wider than an octave of a fingering (M3 Task 8; verification spec goals row "Be easy
 * to play", literature 4.2 P12), both hands, each pair once (a held pair is not also a reach). A
 * leap that a rest, a released key, the same finger or a pair of fingers that cannot span it
 * turns into a hand shift is no stretch, nor is a move between two chords. A measure, not a lint
 * rule. `opts.profile` sets the practical spans and the reach of a hold (default large, as lint).
 */
export function wideStretches(
  score: Score,
  assignment: Assignment,
  opts: Pick<LintOptions, 'profile' | 'holdEpsSec'> = {},
): WideStretch[] {
  const t = resolveProfile(opts.profile).tables;
  const out: WideStretch[] = [];
  for (const hand of HANDS) {
    const notes = fingeredNotes(score, assignment, hand);
    const v = notes.map((x) => x.note);
    const size = new Map<number, number>();
    for (const n of v) size.set(n.slice, (size.get(n.slice) ?? 0) + 1);
    const held = new Set<string>();
    forEachHold(
      v,
      t,
      (m, k) => {
        held.add(`${m} ${k}`);
        const semitones = Math.abs(v[k]!.pitch - v[m]!.pitch);
        if (semitones > OCTAVE)
          out.push({ kind: 'held', hand, noteIds: [v[m]!.noteId, v[k]!.noteId], semitones });
      },
      undefined,
      opts.holdEpsSec ?? HOLD_EPS,
    );
    for (let k = 1; k < notes.length; k++) {
      const a = notes[k - 1]!;
      const b = notes[k]!;
      const i = b.note.pitch - a.note.pitch;
      if (Math.abs(i) <= OCTAVE || held.has(`${k - 1} ${k}`)) continue;
      if (size.get(a.note.slice) !== 1 || size.get(b.note.slice) !== 1) continue;
      if (b.note.restBefore || isReleased(a.note, b.note)) continue;
      const g = a.finger;
      const f = b.finger;
      if (g === f || isThumbCrossing(g, f, i)) continue;
      if (i > span(t, 'maxPrac', g, f) || i < span(t, 'minPrac', g, f)) continue;
      out.push({
        kind: 'reach',
        hand,
        noteIds: [a.note.noteId, b.note.noteId],
        semitones: Math.abs(i),
      });
    }
  }
  return out;
}
