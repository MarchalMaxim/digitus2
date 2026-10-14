import type { Finger, Hand } from '../score/types.js';

/**
 * One finger per note (the key-press finger for substitutions); `undefined` means unassigned.
 * Metrics follow Nakamura, Saito & Yoshii (2020), section 6.2 and Appendix A, and match the
 * official evaluation tool as reproduced by `research/fingering_eval/metrics.py` in its default
 * "official" mode (checked on a real PIG piece by `metrics.reference.test.ts`).
 */
export type FingerSeq = Array<Finger | undefined>;

/**
 * A ground truth aligned note by note with the prediction. `0` or `undefined` marks a note the
 * annotation leaves unfingered (PIG finger `0`, a partially fingered corpus such as Mutopia): the
 * finger is unknown, not wrong, so the note is masked out of every metric (see `pigMetrics`).
 */
export type GoldSeq = ReadonlyArray<Finger | 0 | undefined>;

/**
 * Substitution fingers (the finger after `_` in a PIG field such as `3_1`), aligned note by note
 * with the prediction and with each ground truth; `undefined` means no substitution. Omitted
 * sequences have no substitutions.
 */
export interface Substitutions {
  pred?: FingerSeq;
  golds?: Array<FingerSeq | undefined>;
}

export interface PigMetrics {
  gen: number;
  high: number;
  soft: number;
  rec: number;
  notes: number;
  annotators: number;
}

/** Cost of switching annotators in a recombined ground truth (C_rec in the paper). */
const SWITCH_COST = 1;

/** A signed PIG finger (negative = left hand), or undefined for an unassigned note. */
type Key = number | undefined;

/** Share of the gold's fingered notes that `pred` fingers the same way; 0 when none is fingered. */
export function matchRate(pred: FingerSeq, gold: GoldSeq): number {
  if (pred.length !== gold.length)
    throw new Error(`length mismatch: ${pred.length} vs ${gold.length}`);
  let notes = 0;
  let hits = 0;
  for (let i = 0; i < pred.length; i++) {
    const g = gold[i];
    if (!isFinger(g)) continue;
    notes++;
    if (isHit(pred[i], g)) hits++;
  }
  return notes === 0 ? 0 : hits / notes;
}

/**
 * The four PIG match rates of `pred` against the ground truths `golds`.
 *
 * `hands` gives the predicted hand of each note. When it is given, `high` picks the closest
 * ground truth and `rec` recombines independently along each hand's own note sequence, as the
 * official evaluation tool does. `goldHands[k]` gives the hand ground truth k plays each note
 * with (default: `hands`); like the official tool, which compares signed PIG fingers, a gold
 * finger on the other hand never matches, and two ground truths agree on a note only when
 * both finger and hand are equal.
 *
 * Substitutions, as in the official tool: `gen` compares the whole finger field, so `3_1`
 * differs from `3` and from `3_2`; `high`, `soft` and `rec` compare the key-press finger only
 * (the tool reads the field with C `atoi`). Without `substitutions` every field is a plain
 * finger. A chained field such as `2_4_5` (two notes in PIG) is compared by its first two fingers.
 *
 * Unfingered gold (M3): a note that any ground truth leaves without a finger (`0` or
 * `undefined`) is removed before anything is computed, from the numerator and the denominator of
 * every rate, and `notes` counts the kept notes only. This is the rule of the Python reference,
 * `research/fingering_eval/evaluate.py`, which keeps a note only when every ground truth labels it
 * (`all(is_labeled(g[i]) for g in gts)`), so a note is never half-scored against the annotators
 * that do finger it. Recombination and the per-hand closest annotator then run along the kept notes,
 * as the reference does on its filtered sequences. With no kept note every rate is 0 (no NaN).
 */
export function pigMetrics(
  pred: FingerSeq,
  golds: GoldSeq[],
  hands?: Hand[],
  goldHands?: Array<Hand[] | undefined>,
  substitutions?: Substitutions,
): PigMetrics {
  if (golds.length === 0) throw new Error('at least one ground truth is required');
  const n = pred.length;
  for (const g of golds)
    if (g.length !== n) throw new Error(`length mismatch: ${n} vs ${g.length}`);
  if (hands && hands.length !== n)
    throw new Error(`length mismatch: ${n} notes vs ${hands.length} hands`);
  if (goldHands) {
    if (goldHands.length !== golds.length) {
      throw new Error(
        `length mismatch: ${golds.length} ground truths vs ${goldHands.length} hand lists`,
      );
    }
    for (const h of goldHands)
      if (h && h.length !== n) throw new Error(`length mismatch: ${n} notes vs ${h.length} hands`);
  }
  const predSubs = substitutions?.pred;
  const goldSubs = substitutions?.golds;
  if (predSubs && predSubs.length !== n)
    throw new Error(`length mismatch: ${n} notes vs ${predSubs.length} substitutions`);
  if (goldSubs) {
    if (goldSubs.length !== golds.length) {
      throw new Error(
        `length mismatch: ${golds.length} ground truths vs ${goldSubs.length} substitution lists`,
      );
    }
    for (const s of goldSubs)
      if (s && s.length !== n)
        throw new Error(`length mismatch: ${n} notes vs ${s.length} substitutions`);
  }
  const annotators = golds.length;
  const keep: number[] = [];
  for (let i = 0; i < n; i++) if (golds.every((g) => isFinger(g[i]))) keep.push(i);
  if (keep.length === 0) return { gen: 0, high: 0, soft: 0, rec: 0, notes: 0, annotators };
  return rates(
    pick(pred, keep),
    golds.map((g) => pick(g, keep) as FingerSeq),
    hands && pick(hands, keep),
    goldHands?.map((h) => h && pick(h, keep)),
    predSubs && pick(predSubs, keep),
    goldSubs?.map((s) => s && pick(s, keep)),
  );
}

/** `a` restricted to the indices `keep`. */
function pick<T>(a: readonly T[], keep: number[]): T[] {
  return keep.map((i) => a[i] as T);
}

function isFinger(f: Finger | 0 | undefined): f is Finger {
  return f !== undefined && f !== 0;
}

/** The four rates on notes that every ground truth fingers (the body of `pigMetrics`). */
function rates(
  pred: FingerSeq,
  golds: FingerSeq[],
  hands: Hand[] | undefined,
  goldHands: Array<Hand[] | undefined> | undefined,
  predSubs: FingerSeq | undefined,
  goldSubs: Array<FingerSeq | undefined> | undefined,
): PigMetrics {
  const n = pred.length;
  const annotators = golds.length;
  const predKeys = signed(pred, hands);
  const goldKeys = golds.map((g, k) => signed(g, goldHands?.[k] ?? hands));
  // gen: whole-field hits. Equal signed key-press fingers imply the same hand, so the unsigned
  // substitution fingers decide the rest of the field.
  const hitsPer = goldKeys.map((g, k) =>
    g.reduce<number>(
      (s, key, i) => s + (isHit(predKeys[i], key) && predSubs?.[i] === goldSubs?.[k]?.[i] ? 1 : 0),
      0,
    ),
  );
  const gen = hitsPer.reduce((a, b) => a + b, 0) / (n * annotators);
  let softHits = 0;
  for (let i = 0; i < n; i++) if (goldKeys.some((g) => isHit(predKeys[i], g[i]))) softHits++;

  let highErrors = 0;
  let recErrors = 0;
  for (const idx of handGroups(n, hands)) {
    highErrors += Math.min(
      ...goldKeys.map((g) => idx.reduce((e, i) => e + (isHit(predKeys[i], g[i]) ? 0 : 1), 0)),
    );
    recErrors += recombinationCost(predKeys, goldKeys, idx);
  }
  return {
    gen,
    high: (n - highErrors) / n,
    soft: softHits / n,
    rec: (n - recErrors) / n,
    notes: n,
    annotators,
  };
}

function signed(seq: FingerSeq, hands: Hand[] | undefined): Key[] {
  return seq.map((f, i) => (f === undefined ? undefined : hands?.[i] === 'L' ? -f : f));
}

function isHit(pred: Key, gold: Key): boolean {
  return gold !== undefined && pred === gold;
}

function handGroups(n: number, hands: Hand[] | undefined): number[][] {
  if (!hands) return [Array.from({ length: n }, (_, i) => i)];
  const byHand = new Map<Hand, number[]>();
  hands.forEach((h, i) => {
    const list = byHand.get(h) ?? [];
    list.push(i);
    byHand.set(h, list);
  });
  return [...byHand.values()];
}

/**
 * Minimum edit cost of a recombined ground truth along the note indices `idx`: one per
 * mismatch with `pred`, plus SWITCH_COST per change of annotator. A change from annotator k'
 * to k before note t is allowed only when k' and k agree on note t-1, so every consecutive
 * finger pair of the recombined sequence occurs in a single ground truth.
 */
function recombinationCost(pred: Key[], golds: Key[][], idx: number[]): number {
  if (idx.length === 0) return 0;
  const K = golds.length;
  const miss = (k: number, t: number): number => (isHit(pred[idx[t]!], golds[k]![idx[t]!]) ? 0 : 1);
  let cost = Array.from({ length: K }, (_, k) => miss(k, 0));
  for (let t = 1; t < idx.length; t++) {
    const prev = idx[t - 1]!;
    const next = new Array<number>(K);
    for (let k = 0; k < K; k++) {
      let incoming = cost[k]!;
      for (let kp = 0; kp < K; kp++) {
        if (kp === k || golds[kp]![prev] !== golds[k]![prev]) continue;
        incoming = Math.min(incoming, cost[kp]! + SWITCH_COST);
      }
      next[k] = incoming + miss(k, t);
    }
    cost = next;
  }
  return Math.min(...cost);
}
