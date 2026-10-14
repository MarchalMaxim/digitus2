import { buildHandSequence } from '../fingering/sequence.js';
import type { HandSequence } from '../fingering/sequence.js';
import type { Assignment, Finger, Hand, Score } from '../score/types.js';

/**
 * Training data for the learner (M3 Task 2). Pure: the corpora are read from disk by
 * `cli/corpora.ts`; this module turns a piece and its annotations into one example per hand.
 */

/** A gold finger, or `0` for a note the annotation leaves unfingered (unknown, never "finger 0"). */
export type GoldFinger = Finger | 0;

export interface HandExample {
  /** `<corpus>:<piece>:<hand>` */
  id: string;
  seq: HandSequence;
  /** One array per annotation, aligned with `seq.notes`; `0` = unfingered (unknown). */
  golds: GoldFinger[][];
  /** Sample weight; 1 (the learning prototype measured no effect of corpus weights). */
  weight: number;
}

export type CorpusName = 'pig' | 'textbook' | 'beringer' | 'mutopia';

export interface TrainingPiece {
  corpus: CorpusName;
  id: string;
  /** The first annotation's notes: every annotation is an assignment on these note ids. */
  score: Score;
  /** One assignment per annotation; a note without an entry is unfingered in that annotation. */
  annotations: Assignment[];
  license?: string;
}

const HANDS: readonly Hand[] = ['R', 'L'];

/**
 * One example per hand that has notes and at least one annotation fingering one of them, right
 * hand first. `golds[k][i]` is annotation k's key-press finger for `seq.notes[i]` (`0` when the
 * annotation has no entry for that note); an annotation that fingers nothing in a hand is dropped
 * for that hand, and a hand left without annotations gives no example.
 */
export function toHandExamples(p: TrainingPiece): HandExample[] {
  const out: HandExample[] = [];
  for (const hand of HANDS) {
    if (!p.score.notes.some((n) => n.hand === hand)) continue;
    const seq = buildHandSequence(p.score, hand);
    if (seq.notes.length === 0) continue;
    const golds = p.annotations
      .map((a) => seq.notes.map((n): GoldFinger => a[n.noteId]?.finger ?? 0))
      .filter((g) => g.some((f) => f !== 0));
    if (golds.length === 0) continue;
    out.push({ id: `${p.corpus}:${p.id}:${hand}`, seq, golds, weight: 1 });
  }
  return out;
}

/** Notes of the example that at least one annotation fingers. */
export function fingeredCount(ex: HandExample): number {
  let count = 0;
  for (let i = 0; i < ex.seq.notes.length; i++) if (ex.golds.some((g) => g[i] !== 0)) count++;
  return count;
}

/**
 * Annotation `other` (another file of the same piece) as an assignment on `base`'s note ids. Notes
 * are aligned by their line in the file (`sourceIndices[0]`, the PIG note line), and the two files
 * must have the same pitch on every line. A note that `other` puts in the other hand than `base`
 * gets no entry, so its gold is `0` for that annotation instead of a finger copied from the other
 * hand (learning prototype report, section 3; measured on the 120 PIG train pieces: 6 of the 39
 * second-or-later annotation files move 66 notes to the other hand). `label` names the annotation
 * in errors.
 */
export function annotationOn(
  base: Score,
  other: { score: Score; assignment: Assignment },
  label = 'annotation',
): Assignment {
  if (other.score.notes.length !== base.notes.length) {
    throw new Error(
      `${label}: the first annotation has ${base.notes.length} notes, this one ${other.score.notes.length}`,
    );
  }
  const byLine = new Map<number, Score['notes'][number]>();
  for (const n of other.score.notes) byLine.set(n.sourceIndices[0] ?? -1, n);
  const out: Assignment = {};
  for (const b of base.notes) {
    const line = b.sourceIndices[0] ?? -1;
    const o = byLine.get(line);
    if (!o || o.midi !== b.midi) {
      throw new Error(
        `${label}: different notes than the first annotation at note line ${line} (MIDI ${o?.midi ?? 'none'} vs ${b.midi})`,
      );
    }
    const f = other.assignment[o.id];
    if (f && o.hand === b.hand) out[b.id] = f;
  }
  return out;
}
