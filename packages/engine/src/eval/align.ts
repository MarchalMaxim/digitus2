import type { Assignment, Hand, Note, Score } from '../score/types.js';
import { pigMetrics } from './metrics.js';
import type { FingerSeq, PigMetrics } from './metrics.js';

/**
 * First finger of each note in `score.notes` order; `undefined` for unassigned notes. Used as a
 * ground truth, `undefined` is an unfingered note (PIG finger `0`), which the metrics mask out.
 */
export function fingerSeq(score: Score, assignment: Assignment): FingerSeq {
  return score.notes.map((n) => assignment[n.id]?.finger);
}

/**
 * Pairs each gold note with a predicted note, as [predId, goldId] in gold order: by id when
 * every gold id exists in pred, else by (onsetSec, hand, midi) order.
 */
export function alignScores(pred: Score, gold: Score): Array<[string, string]> {
  if (pred.notes.length !== gold.notes.length) {
    throw new Error(
      `note count mismatch: prediction has ${pred.notes.length}, gold has ${gold.notes.length}`,
    );
  }
  const predIds = new Set(pred.notes.map((n) => n.id));
  if (gold.notes.every((n) => predIds.has(n.id))) return gold.notes.map((n) => [n.id, n.id]);
  const byPosition = (s: Score): Note[] =>
    [...s.notes].sort(
      (a, b) =>
        a.onsetSec - b.onsetSec ||
        (a.hand === b.hand ? 0 : a.hand === 'R' ? -1 : 1) ||
        a.midi - b.midi,
    );
  const p = byPosition(pred);
  const g = byPosition(gold);
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < g.length; i++) {
    if (p[i]!.midi !== g[i]!.midi)
      throw new Error(`pitch mismatch at gold note ${g[i]!.id}: ${p[i]!.midi} vs ${g[i]!.midi}`);
    pairs.push([p[i]!.id, g[i]!.id]);
  }
  const order = new Map(gold.notes.map((n, i) => [n.id, i]));
  return pairs.sort((a, b) => order.get(a[1])! - order.get(b[1])!);
}

/**
 * PIG metrics of a prediction against one or more annotated scores of the same piece. Notes are
 * aligned to the first gold score; hands come from the prediction (the official tool takes them
 * from the sign of the estimated finger). Substitution fingers are passed on, so `gen` compares
 * whole finger fields as the official tool does (see `pigMetrics`). A gold note without a finger
 * (PIG finger `0`: `parsePig` leaves it unassigned) is unknown; when any annotation leaves a note
 * unfingered, the note is masked out of every rate and of `notes`, as
 * `research/fingering_eval/evaluate.py` masks gold `0`.
 */
export function metricsForScores(
  pred: { score: Score; assignment: Assignment },
  golds: Array<{ score: Score; assignment: Assignment }>,
): PigMetrics {
  const reference = golds[0];
  if (!reference) throw new Error('at least one ground truth is required');
  // The recombination rate depends on note order within a chord; follow the gold file's order
  // within each onset, as the official tool (which reads notes in file order) does.
  const refNotes = new Map(reference.score.notes.map((n) => [n.id, n]));
  const fileOrder = (id: string): [number, number] => {
    const n = refNotes.get(id)!;
    return [n.onsetSec, n.sourceIndices[0] ?? 0];
  };
  const pairs = alignScores(pred.score, reference.score).sort((a, b) => {
    const [sa, ia] = fileOrder(a[1]);
    const [sb, ib] = fileOrder(b[1]);
    return sa - sb || ia - ib;
  });
  const predNotes = new Map(pred.score.notes.map((n) => [n.id, n]));
  const predSeq: FingerSeq = pairs.map(([p]) => pred.assignment[p]?.finger);
  const predSubs: FingerSeq = pairs.map(([p]) => pred.assignment[p]?.substitution);
  const hands = pairs.map(([p]) => predNotes.get(p)!.hand);
  const goldSeqs: FingerSeq[] = [];
  const goldSubs: FingerSeq[] = [];
  const goldHands: Hand[][] = [];
  for (const g of golds) {
    const toGold = new Map(alignScores(g.score, reference.score).map(([a, b]) => [b, a]));
    const notes = new Map(g.score.notes.map((n) => [n.id, n]));
    const ids = pairs.map(([, refId]) => toGold.get(refId)!);
    goldSeqs.push(ids.map((id) => g.assignment[id]?.finger));
    goldSubs.push(ids.map((id) => g.assignment[id]?.substitution));
    goldHands.push(ids.map((id) => notes.get(id)!.hand));
  }
  return pigMetrics(predSeq, goldSeqs, hands, goldHands, { pred: predSubs, golds: goldSubs });
}
