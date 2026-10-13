import type { Assignment, Finger, FingerAssignment, Hand, Score } from '../score/types.js';
import { makeContext, pairTerms, tripleTerms, unaryTerms, weightedSum } from './rules.js';
import type { RuleContext, RuleWeights, Term } from './rules.js';
import { buildHandSequence } from './sequence.js';
import type { HandSequence, SeqNote } from './sequence.js';
import { resolveProfile } from './spans.js';
import type { HandProfile, HandProfileId } from './spans.js';
import { detectRuns, matchTemplates, templateFingerAt, TEXTBOOK_TEMPLATES } from './templates.js';
import type { TemplateMatch } from './templates.js';
import { decode } from './viterbi.js';

export interface SolveOptions {
  profile?: HandProfileId | HandProfile;
  weights?: Partial<RuleWeights>;
  pins?: Assignment;
  respectEditorial?: boolean;
  hands?: Hand[];
  maxHeldIterations?: number;
  confidenceTemperature?: number;
  /** Textbook template bonus for scale, arpeggio and chromatic runs (default true). */
  templates?: boolean;
}
/**
 * A rule term with its weighted cost (`points * weight`). A rule whose weight is 0 still appears,
 * with `weighted` 0; the template term (points -1) appears whenever the chosen finger is the
 * template's finger.
 */
export interface ExplainedTerm extends Term {
  weighted: number;
}
export interface NoteExplanation {
  terms: ExplainedTerm[];
  total: number;
  /**
   * Cost gap of each finger (index finger - 1) against the cheapest finger for this note: its
   * min-sum marginal minus the smallest marginal. 0 for the best finger, +Infinity for a finger no
   * complete path can give (a pin elsewhere in the chord, or a crossed chord).
   */
  gaps?: number[];
  /** Fingers this note cannot take because an earlier note of the hand still holds them. */
  heldBy?: Array<{ finger: Finger; noteId: string }>;
}
export interface HandSolution {
  hand: Hand;
  /** Decoded cost: the weighted rule terms plus any penalty the decode had to pay. */
  cost: number;
  /** Decodes run by the held-note loop (1 when the first decode had no held-note conflict). */
  iterations: number;
  /** The hard decode had no finite path (pins against the chord rules), so a soft decode ran. */
  relaxed: boolean;
  notes: number;
}
export interface SolveResult {
  assignment: Assignment;
  explanations: Record<string, NoteExplanation>;
  hands: HandSolution[];
}
export interface HandConstraints {
  pinned: Map<number, Finger>;
  /**
   * Fingers a note should not take (HELD_PENALTY each): the held-note loop puts here the finger of
   * a note that sounds with it and every finger that would cross that note.
   */
  forbidden: Map<number, Set<Finger>>;
  /** Notes whose finger the held-note loop keeps (HELD_PENALTY for any other finger). */
  kept?: Map<number, Finger>;
  soft: boolean;
}

const INF = Number.POSITIVE_INFINITY;
/** Cost of a crossed or doubled finger inside a chord of at most five notes in a soft decode. */
const SOFT_PENALTY = 1000;
/**
 * Cost of reusing a finger while the note it plays still sounds, in every decode mode. It is
 * finite on purpose: a texture with more than five keys held at once (a notated pedal bass under a
 * chord) then pays for a few reused fingers instead of making the decode infeasible, while a
 * fingering that keeps every held finger, when the held-note loop finds one, is far cheaper.
 */
const HELD_PENALTY = 1000;
/**
 * Cost of each pair of adjacent chord notes that share a finger in a slice of more than five
 * notes, on top of the pair's chord span terms; twice that unless it is the thumb on two adjacent
 * white keys (the one double lint L01 accepts). A slice of k > 5 notes needs k - 5 such pairs, and
 * this cost keeps it at exactly that many; the span terms then pick the narrowest pair.
 */
const DOUBLED_FINGER_COST = 50;
const HELD_EPS = 1e-3;
const FINGERS: Finger[] = [1, 2, 3, 4, 5];

function sounding(a: SeqNote, b: SeqNote): boolean {
  return a.slice !== b.slice && a.offsetSec > b.onsetSec + HELD_EPS;
}

/**
 * Decodes one hand. Pins are hard in every mode: a pinned note can only take its pinned finger.
 * Fingers in a slice of at most five notes strictly increase with (mirrored) pitch: a violation
 * costs +Infinity, or SOFT_PENALTY when `soft`, so a soft decode always has a finite path that
 * keeps every pin. Reusing the finger of a note that still sounds, a finger in `forbidden`, or
 * another finger than the one `kept` keeps costs HELD_PENALTY in both modes. A note inside a
 * template match earns the bonus `-weights.template` for the template's finger.
 */
export function solveHand(
  seq: HandSequence,
  ctx: RuleContext,
  constraints: HandConstraints = { pinned: new Map(), forbidden: new Map(), soft: false },
  templates: TemplateMatch[] = [],
): { fingers: Finger[]; cost: number; marginals: number[][] } {
  const v = seq.notes;
  const penalty = constraints.soft ? SOFT_PENALTY : INF;
  const sliceSize = new Map<number, number>();
  for (const n of v) sliceSize.set(n.slice, (sliceSize.get(n.slice) ?? 0) + 1);
  const template = v.map((_, i) => templateFingerAt(templates, i));
  const result = decode({
    n: v.length,
    unary: (i, f0) => {
      const f = (f0 + 1) as Finger;
      const pin = constraints.pinned.get(i);
      if (pin !== undefined && pin !== f) return INF;
      let cost = weightedSum(ctx, unaryTerms(ctx, v[i]!, f, v[i - 1], v[i + 1]));
      if (constraints.forbidden.get(i)?.has(f)) cost += HELD_PENALTY;
      const keep = constraints.kept?.get(i);
      if (keep !== undefined && keep !== f) cost += HELD_PENALTY;
      if (template[i] === f) cost -= ctx.weights.template;
      return cost;
    },
    pair: (i, g0, f0) => {
      const g = (g0 + 1) as Finger;
      const f = (f0 + 1) as Finger;
      const a = v[i - 1]!;
      const b = v[i]!;
      const terms = weightedSum(ctx, pairTerms(ctx, a, g, b, f));
      if (a.slice === b.slice) {
        if (f === g && (sliceSize.get(b.slice) ?? 0) > 5) {
          // Lint (L01) lets the thumb take two adjacent white keys; any other double is an error.
          const thumbPair = g === 1 && !a.black && !b.black && b.pitch - a.pitch <= 2;
          return (thumbPair ? 1 : 2) * DOUBLED_FINGER_COST + terms;
        }
        if (f <= g) return penalty + terms;
      } else if (g === f && sounding(a, b)) {
        return HELD_PENALTY + terms;
      }
      return terms;
    },
    triple: (i, h0, g0, f0) => {
      const h = (h0 + 1) as Finger;
      const g = (g0 + 1) as Finger;
      const f = (f0 + 1) as Finger;
      const a = v[i - 2]!;
      const c = v[i]!;
      // Same finger on notes one apart in a slice: impossible in a hard decode (fingers increase),
      // and in a soft decode it keeps a relaxed chord from doubling a finger.
      if (h === f && a.slice === c.slice && (sliceSize.get(c.slice) ?? 0) <= 5) return penalty;
      const terms = weightedSum(ctx, tripleTerms(ctx, a, h, v[i - 1]!, g, c, f));
      return h === f && sounding(a, c) ? HELD_PENALTY + terms : terms;
    },
  });
  return {
    fingers: result.fingers.map((f) => (f + 1) as Finger),
    cost: result.cost,
    marginals: result.marginals,
  };
}

/**
 * Calls `visit(m, i)` for every pair of notes where note m (m < i, another slice) still sounds at
 * note i's onset. Sequence onsets never decrease, so a note that has stopped sounding is dropped
 * from the active list for good.
 */
function forEachSounding(v: SeqNote[], visit: (m: number, i: number) => void): void {
  let active: number[] = [];
  for (let i = 0; i < v.length; i++) {
    const n = v[i]!;
    active = active.filter((m) => v[m]!.offsetSec > n.onsetSec + HELD_EPS);
    for (const m of active) if (v[m]!.slice !== n.slice) visit(m, i);
    active.push(i);
  }
}

interface HeldConflict {
  held: number;
  later: number;
  finger: Finger;
}

/**
 * Held-note conflicts farther than two steps back (the decoder's pair and triple terms cover the
 * nearer ones): note `held` still sounds at note `later`'s onset, in another slice, with the same
 * finger. Sorted by the later note.
 */
function heldConflicts(v: SeqNote[], fingers: Finger[]): HeldConflict[] {
  const out: HeldConflict[] = [];
  forEachSounding(v, (m, i) => {
    if (m <= i - 3 && fingers[m] === fingers[i])
      out.push({ held: m, later: i, finger: fingers[i]! });
  });
  return out;
}

/**
 * Turns the conflicts of the last decode into constraints for the next one and says whether any is
 * new. One note of each conflict moves off the shared finger (it gets `forbidden` fingers) and the
 * other keeps it (it joins `kept`). Keeping the other side stops the constraints from piling up,
 * as they do when only the later note is forbidden the finger: the decoder then moves the held
 * note to another finger, which is forbidden next, until no finger is left.
 *
 * The moving note goes to the side of the kept finger that matches its pitch (a finger above it
 * for a higher note), so the two notes that sound together do not cross; only when neither note
 * can do that does it just leave the shared finger. A pinned or already kept note stays; otherwise
 * the note whose cheapest allowed finger costs less moves (min-sum marginals of the last decode; a
 * tie moves the later note). A conflict with a note that already moves in this round waits for
 * the next decode, and one between two notes that both stay (two pins) is left to lint.
 */
function resolveHeldConflicts(
  v: SeqNote[],
  conflicts: HeldConflict[],
  marginals: number[][],
  c: HandConstraints,
): boolean {
  const kept = c.kept ?? new Map<number, Finger>();
  c.kept = kept;
  let added = false;
  const moving = new Set<number>();
  const stays = (k: number): boolean => c.pinned.has(k) || kept.has(k);
  const cost = (k: number, ok: (g: Finger) => boolean): number =>
    stays(k) ? INF : Math.min(INF, ...FINGERS.filter(ok).map((g) => marginals[k]![g - 1]!));
  for (const x of conflicts) {
    if (moving.has(x.held) || moving.has(x.later)) continue;
    if (stays(x.held) && stays(x.later)) continue;
    const f = x.finger;
    const d = Math.sign(v[x.later]!.pitch - v[x.held]!.pitch);
    const other = (g: Finger): boolean => g !== f;
    let laterOk = d === 0 ? other : (g: Finger) => (g - f) * d > 0;
    let heldOk = d === 0 ? other : (g: Finger) => (f - g) * d > 0;
    let later = cost(x.later, laterOk);
    let heldCost = cost(x.held, heldOk);
    if (later === INF && heldCost === INF) {
      laterOk = heldOk = other;
      later = cost(x.later, other);
      heldCost = cost(x.held, other);
    }
    const moveHeld = stays(x.later) || (!stays(x.held) && heldCost < later);
    const move = moveHeld ? x.held : x.later;
    const keep = moveHeld ? x.later : x.held;
    const ok = moveHeld ? heldOk : laterOk;
    moving.add(move);
    const set = c.forbidden.get(move) ?? new Set<Finger>();
    for (const g of FINGERS) {
      if (ok(g) || set.has(g)) continue;
      set.add(g);
      added = true;
    }
    c.forbidden.set(move, set);
    if (!stays(keep)) {
      kept.set(keep, f);
      added = true;
    }
  }
  return added;
}

export function solveFingering(score: Score, opts: SolveOptions = {}): SolveResult {
  const profile = resolveProfile(opts.profile);
  const ctx = makeContext(profile, opts.weights);
  const hands = opts.hands ?? ['R', 'L'];
  const T = opts.confidenceTemperature ?? 2;
  const maxIter = opts.maxHeldIterations ?? 8;
  const assignment: Assignment = {};
  const explanations: Record<string, NoteExplanation> = {};
  const solutions: HandSolution[] = [];

  for (const hand of hands) {
    const seq = buildHandSequence(score, hand);
    const v = seq.notes;
    const pinned = new Map<number, Finger>();
    for (const n of v) {
      const pin = opts.pins?.[n.noteId];
      if (pin && (pin.pinned || (opts.respectEditorial && pin.source === 'editorial')))
        pinned.set(n.index, pin.finger);
    }
    const templates =
      opts.templates === false
        ? []
        : matchTemplates(seq, detectRuns(seq), TEXTBOOK_TEMPLATES[hand]);
    const constraints: HandConstraints = {
      pinned,
      forbidden: new Map(),
      kept: new Map(),
      soft: false,
    };
    let solved = solveHand(seq, ctx, constraints, templates);
    // Held-note rules are finite, so only pins against the chord rules make the hard decode
    // infinite; the soft decode then keeps the pins and breaks the fewest chord rules.
    let relaxed = false;
    if (!Number.isFinite(solved.cost)) {
      constraints.soft = true;
      relaxed = true;
      solved = solveHand(seq, ctx, constraints, templates);
    }
    let iterations = 1;
    while (iterations < maxIter) {
      const conflicts = heldConflicts(v, solved.fingers);
      if (!resolveHeldConflicts(v, conflicts, solved.marginals, constraints)) break;
      solved = solveHand(seq, ctx, constraints, templates);
      iterations++;
    }
    const fingers = solved.fingers;
    const heldBy = new Map<number, Array<{ finger: Finger; noteId: string }>>();
    forEachSounding(v, (m, i) => {
      const list = heldBy.get(i) ?? [];
      list.push({ finger: fingers[m]!, noteId: v[m]!.noteId });
      heldBy.set(i, list);
    });
    for (let i = 0; i < v.length; i++) {
      const n = v[i]!;
      const m = solved.marginals[i]!;
      const best = Math.min(...m.filter(Number.isFinite));
      const weights = m.map((x) => (Number.isFinite(x) ? Math.exp(-(x - best) / T) : 0));
      const z = weights.reduce((a, b) => a + b, 0);
      const f = fingers[i]!;
      const alternatives = FINGERS.filter((k) => k !== f && Number.isFinite(m[k - 1]!))
        .map((k) => ({ finger: k, cost: m[k - 1]! - best }))
        .sort((a, b) => a.cost - b.cost)
        .slice(0, 2);
      const pin = opts.pins?.[n.noteId];
      const entry: FingerAssignment = {
        finger: f,
        confidence: z > 0 ? weights[f - 1]! / z : 0,
        alternatives,
        source: pinned.has(i) && pin ? pin.source : 'engine',
      };
      if (pinned.has(i)) entry.pinned = true;
      assignment[n.noteId] = entry;

      const terms: Term[] = [...unaryTerms(ctx, n, f, v[i - 1], v[i + 1])];
      if (templateFingerAt(templates, i) === f) terms.push({ rule: 'template', points: -1 });
      if (i >= 1) terms.push(...pairTerms(ctx, v[i - 1]!, fingers[i - 1]!, n, f));
      if (i >= 2)
        terms.push(
          ...tripleTerms(ctx, v[i - 2]!, fingers[i - 2]!, v[i - 1]!, fingers[i - 1]!, n, f),
        );
      // `+ 0` turns the -0 of a negative-point term under weight 0 into 0.
      const explained = terms.map((t) => ({
        ...t,
        weighted: t.points * ctx.weights[t.rule] + 0,
      }));
      const explanation: NoteExplanation = {
        terms: explained,
        total: explained.reduce((s, t) => s + t.weighted, 0),
        gaps: m.map((x) => (Number.isFinite(x) ? x - best : INF)),
      };
      const holders = heldBy.get(i);
      if (holders) explanation.heldBy = holders;
      explanations[n.noteId] = explanation;
    }
    solutions.push({ hand, cost: solved.cost, iterations, relaxed, notes: v.length });
  }
  return { assignment, explanations, hands: solutions };
}
