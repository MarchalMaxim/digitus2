import type { Assignment, Finger, FingerAssignment, Hand, Score } from '../score/types.js';
import { heldPairs } from './reach.js';
import { makeContext, pairTerms, tripleTerms, unaryTerms, weightedSum } from './rules.js';
import type { RuleContext, RuleWeights, Term } from './rules.js';
import { buildHandSequence } from './sequence.js';
import type { HandSequence, SeqNote } from './sequence.js';
import { resolveProfile, span } from './spans.js';
import type { HandProfile, HandProfileId, SpanTables } from './spans.js';
import { detectRuns, matchTemplates, TEXTBOOK_TEMPLATES } from './templates.js';
import type { TemplateMatch } from './templates.js';
import { decode } from './viterbi.js';

export interface SolveOptions {
  profile?: HandProfileId | HandProfile;
  weights?: Partial<RuleWeights>;
  pins?: Assignment;
  respectEditorial?: boolean;
  hands?: Hand[];
  /** Decodes the held-note loop may run, counting the first (default 8). */
  maxHeldIterations?: number;
  /**
   * Decodes the chord loop may run, counting the first (default 8). The loop forbids a decoded
   * chord configuration that breaks more practical spans between two of its notes than the slice
   * must (any pair in a slice with a legal configuration; the decoder prices nearer pairs itself,
   * so these are pairs three or more apart) and decodes again.
   */
  maxChordIterations?: number;
  confidenceTemperature?: number;
  /** Textbook template bonus for scale, arpeggio and chromatic runs (default true). */
  templates?: boolean;
  /**
   * Forbid from the start (HELD_PENALTY) every finger that no fingering keeping the laws between
   * two notes can give a note (`lawDomains`; default true). false leaves the holds more than two
   * steps back to the held-note loop alone, as before the pass existed.
   */
  lawDomains?: boolean;
}
/**
 * A rule term with its weighted cost (`points * weight`). A rule whose weight is 0 still appears,
 * with `weighted` 0; the template term (points -1, or -chromaticTemplatePoints on a chromatic run)
 * appears whenever the chosen finger is the template's finger.
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
  /**
   * Earlier notes of the hand whose keys are still down at this note's onset (`forEachHold`), with
   * their fingers: this note cannot take those fingers, nor one that cannot span the interval to
   * a held key.
   */
  heldBy?: Array<{ finger: Finger; noteId: string }>;
}
export interface HandSolution {
  hand: Hand;
  /** Decoded cost: the weighted rule terms plus any penalty the decode had to pay. */
  cost: number;
  /** Decodes run: 1, plus one per round of the chord loop and of the held-note loop. */
  iterations: number;
  /** The hard decode had no finite path (pins against the chord rules), so a soft decode ran. */
  relaxed: boolean;
  notes: number;
  /**
   * Slices (chords) with no legal configuration, in sequence order: more than five notes, or no
   * assignment of distinct fingers rising with (mirrored) pitch that keeps the slice's pins and
   * every pair of its notes within the practical span. A slice of at most five notes among them
   * gets a configuration that breaks the fewest pairs (the chord loop), its spans priced by
   * chordBeyondPractical instead of the chord law; lint reports them (L05).
   */
  infeasibleSlices: Array<{ slice: number; noteIds: string[] }>;
}
export interface SolveResult {
  assignment: Assignment;
  explanations: Record<string, NoteExplanation>;
  hands: HandSolution[];
}
export interface HandConstraints {
  pinned: Map<number, Finger>;
  /**
   * Fingers a note should not take (HELD_PENALTY each): the held-note loop puts here, for a note
   * that sounds with a note whose finger it keeps, every finger that would break the held-note law
   * with it (the same finger, or a span beyond practical), and when it can every finger that
   * would cross it.
   */
  forbidden: Map<number, Set<Finger>>;
  /** Notes whose finger the held-note loop keeps (HELD_PENALTY for any other finger). */
  kept?: Map<number, Finger>;
  /**
   * Chord configurations the chord loop forbids, by slice: the fingers of the slice's notes in
   * sequence order. Each breaks more practical spans than the slice must, between notes three or
   * more apart (which the second-order decoder cannot see in one term) or, in a slice with no legal
   * configuration, anywhere; it costs the chord-law penalty.
   */
  forbiddenConfigs?: Map<number, Finger[][]>;
  soft: boolean;
}

const INF = Number.POSITIVE_INFINITY;
/**
 * Cost of a crossed or doubled finger inside a chord of at most five notes, and of a chord pair
 * beyond its practical span in a slice that has a legal configuration, in a soft decode (+Infinity
 * in a hard one).
 */
const SOFT_PENALTY = 1000;
/**
 * Cost of breaking the held-note law, in every decode mode: a note that starts while an earlier
 * key of the hand is still down (`forEachHold`) must take another finger than the held key's (lint
 * L03) and one that spans the interval to it within the practical span (L05), as a chord partner
 * would. It is finite on purpose: a texture with more than five keys held at once, or a hold
 * under a note no free finger can reach, then pays for the fewest broken holds instead of making
 * the decode infeasible, while a fingering that keeps every hold, when one exists, is far cheaper.
 */
const HELD_PENALTY = 1000;
const FINGERS: Finger[] = [1, 2, 3, 4, 5];

/** True when interval `i` (lower chord note to upper) is within the practical span of g-f. */
function practical(t: SpanTables, i: number, g: Finger, f: Finger): boolean {
  return i <= span(t, 'maxPrac', g, f) && i >= span(t, 'minPrac', g, f);
}

/**
 * The held-note law for a held key played by g and a note `i` semitones from it played by f
 * (lint L03 and L05): two different fingers within their practical span.
 */
function holdable(t: SpanTables, i: number, g: Finger, f: Finger): boolean {
  return g !== f && practical(t, i, g, f);
}

/** Strictly increasing finger lists of length k: the C(5, k) chord configurations. */
function increasing(k: number, from = 1): Finger[][] {
  if (k === 0) return [[]];
  const out: Finger[][] = [];
  for (let f = from; f <= 5; f++)
    for (const rest of increasing(k - 1, f + 1)) out.push([f as Finger, ...rest]);
  return out;
}
/** CONFIGS[k]: every configuration of a k-note slice (k <= 5). */
const CONFIGS: Finger[][][] = [0, 1, 2, 3, 4, 5].map((k) => increasing(k));

interface SliceShape {
  /** Sequence index of the slice's first note (a slice's notes are contiguous). */
  start: number;
  size: number;
  /**
   * The fewest pairs of notes beyond their practical span that a configuration keeping the slice's
   * pins can have (`breaks`); +Infinity for a slice of more than five notes or one whose pins no
   * configuration keeps. 0 when a legal configuration exists.
   */
  minBreaks: number;
  /** minBreaks is 0: the chord law holds for every pair of the slice. */
  feasible: boolean;
}

/** How many pairs of the slice's notes, at any distance, are beyond the practical span. */
function breaks(t: SpanTables, v: SeqNote[], start: number, fingers: Finger[]): number {
  let n = 0;
  for (let a = 0; a < fingers.length; a++)
    for (let b = a + 1; b < fingers.length; b++)
      if (!practical(t, v[start + b]!.pitch - v[start + a]!.pitch, fingers[a]!, fingers[b]!)) n++;
  return n;
}

/** Each slice's position, size and fewest breaks, indexed by slice. */
function sliceShapes(v: SeqNote[], t: SpanTables, pinned: Map<number, Finger>): SliceShape[] {
  const shapes: SliceShape[] = [];
  for (let start = 0; start < v.length;) {
    let end = start;
    while (end + 1 < v.length && v[end + 1]!.slice === v[start]!.slice) end++;
    const size = end - start + 1;
    const keepsPins = (c: Finger[]): boolean =>
      c.every((f, k) => {
        const pin = pinned.get(start + k);
        return pin === undefined || pin === f;
      });
    let minBreaks = INF;
    if (size <= 5)
      for (const c of CONFIGS[size]!)
        if (keepsPins(c)) minBreaks = Math.min(minBreaks, breaks(t, v, start, c));
    shapes[v[start]!.slice] = { start, size, minBreaks, feasible: minBreaks === 0 };
    start = end + 1;
  }
  return shapes;
}

const sameFingers = (x: Finger[], y: Finger[]): boolean =>
  x.length === y.length && x.every((f, k) => f === y[k]);
/** A window's fingers as one number (base-5 digits of finger - 1). */
const windowCode = (fingers: Finger[]): number => fingers.reduce((s, f) => s * 5 + f - 1, 0);

/**
 * Window codes to charge by sequence index, kept apart by width: the decoder's pair term reads
 * `pair` (two-note windows) and its triple term `triple` (three-note windows), so a three-note
 * code never matches a pair of fingers that happens to share its digits.
 */
interface ForbiddenWindows {
  pair: Map<number, Set<number>>;
  triple: Map<number, Set<number>>;
}

/**
 * Where the decoder charges each forbidden configuration. A window is min(size, 3) consecutive
 * notes of the slice, scored by the decoder at its last note (pair for two notes, triple for
 * three). A configuration is charged at its first window where every configuration with the same
 * fingers there is forbidden too, so no allowed configuration pays. Every configuration of up to
 * four notes has such a window (four notes: the first three fingers name it unless they are
 * 1 2 3, and then the last three do); five notes have one configuration only.
 */
function forbiddenWindows(
  shapes: SliceShape[],
  forbidden: Map<number, Finger[][]> | undefined,
): ForbiddenWindows {
  const out: ForbiddenWindows = { pair: new Map(), triple: new Map() };
  for (const [slice, list] of forbidden ?? []) {
    const { start, size } = shapes[slice]!;
    const w = Math.min(size, 3);
    if (w < 2 || size > 5) continue;
    const byIndex = w === 2 ? out.pair : out.triple;
    for (const c of list) {
      for (let j = 0; j + w <= size; j++) {
        const window = c.slice(j, j + w);
        const same = CONFIGS[size]!.filter((d) => window.every((f, k) => d[j + k] === f));
        if (!same.every((d) => list.some((x) => sameFingers(x, d)))) continue;
        const at = start + j + w - 1;
        const set = byIndex.get(at) ?? new Set<number>();
        set.add(windowCode(window));
        byIndex.set(at, set);
        break;
      }
    }
  }
  return out;
}

/**
 * The template term of each note of the sequence: the textbook finger of the match that covers
 * it and the term's points (the unary cost is `-points * weights.template` when the note takes
 * that finger). Points are 1 on a scale or arpeggio run and `ctx.chromaticTemplatePoints` on a
 * chromatic run (every step of the match a semitone). Undefined outside every match. The solver
 * and its explanations use it; a path-feature count must use it too.
 */
export function templateBonus(
  seq: HandSequence,
  ctx: RuleContext,
  templates: TemplateMatch[],
): Array<{ finger: Finger; points: number } | undefined> {
  const v = seq.notes;
  const out: Array<{ finger: Finger; points: number } | undefined> = v.map(() => undefined);
  for (const m of templates) {
    let chromatic = true;
    for (let k = m.start; k < m.end; k++)
      if (Math.abs(v[k + 1]!.midi - v[k]!.midi) !== 1) chromatic = false;
    const points = chromatic ? ctx.chromaticTemplatePoints : 1;
    // The first match that covers a note wins, as in templateFingerAt (matches do not overlap).
    for (let k = m.start; k <= m.end; k++) out[k] ??= { finger: m.fingers[k - m.start]!, points };
  }
  return out;
}

/**
 * Decodes one hand. Pins are hard in every mode: a pinned note can only take its pinned finger.
 * Fingers in a slice of at most five notes strictly increase with (mirrored) pitch: a violation
 * costs +Infinity, or SOFT_PENALTY when `soft`, so a soft decode always has a finite path that
 * keeps every pin. In a slice with a legal configuration, two notes at most two apart whose
 * interval is beyond the practical span of their fingers (the chord law) and a configuration in
 * `forbiddenConfigs` cost the same penalty; a slice without one pays chordBeyondPractical, and the
 * penalty only for a forbidden configuration. A slice of more than five notes pays doubledFinger
 * for each finger it doubles. A note at most two steps after a key that is still down
 * (`forEachHold`) pays HELD_PENALTY when its finger breaks the held-note law with that key (the
 * same finger, or a span beyond practical; `holdable`), as does a finger in `forbidden` or another
 * finger than the one `kept` keeps, in both modes. A note inside a template match earns the
 * template term for the template's finger (`templateBonus`).
 */
export function solveHand(
  seq: HandSequence,
  ctx: RuleContext,
  constraints: HandConstraints = { pinned: new Map(), forbidden: new Map(), soft: false },
  templates: TemplateMatch[] = [],
): { fingers: Finger[]; cost: number; marginals: number[][] } {
  const v = seq.notes;
  const t = ctx.tables;
  const penalty = constraints.soft ? SOFT_PENALTY : INF;
  const shapes = sliceShapes(v, t, constraints.pinned);
  const windows = forbiddenWindows(shapes, constraints.forbiddenConfigs);
  const bonus = templateBonus(seq, ctx, templates);
  // heldBack[k][i]: note i - k - 1 still holds its key at note i's onset (k = 0, 1).
  const holds = heldPairs(v, t);
  const heldBack = [1, 2].map((k) => holds.map((ms, i) => ms.includes(i - k)));
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
      const tb = bonus[i];
      if (tb?.finger === f) cost -= ctx.weights.template * tb.points;
      return cost;
    },
    pair: (i, g0, f0) => {
      const g = (g0 + 1) as Finger;
      const f = (f0 + 1) as Finger;
      const a = v[i - 1]!;
      const b = v[i]!;
      const terms = weightedSum(ctx, pairTerms(ctx, a, g, b, f));
      if (a.slice === b.slice) {
        const shape = shapes[b.slice]!;
        // A slice of more than five notes must double fingers; doubledFinger (in terms) prices it.
        if (f === g && shape.size > 5) return terms;
        if (f <= g) return penalty + terms;
        if (shape.feasible && !practical(t, b.pitch - a.pitch, g, f)) return penalty + terms;
        if (windows.pair.get(i)?.has(g0 * 5 + f0)) return penalty + terms;
        return terms;
      }
      return heldBack[0]![i] && !holdable(t, b.pitch - a.pitch, g, f)
        ? HELD_PENALTY + terms
        : terms;
    },
    triple: (i, h0, g0, f0) => {
      const h = (h0 + 1) as Finger;
      const g = (g0 + 1) as Finger;
      const f = (f0 + 1) as Finger;
      const a = v[i - 2]!;
      const c = v[i]!;
      if (a.slice === c.slice) {
        const shape = shapes[c.slice]!;
        // Same finger on notes two apart in a slice: impossible in a hard decode (fingers
        // increase), and in a soft decode it keeps a relaxed chord from doubling a finger.
        if (h === f && shape.size <= 5) return penalty;
        // The chord span terms of the outer pair a-c (tripleTerms) and the chord law on it.
        const terms = weightedSum(ctx, tripleTerms(ctx, a, h, v[i - 1]!, g, c, f));
        if (shape.feasible && !practical(t, c.pitch - a.pitch, h, f)) return penalty + terms;
        if (windows.triple.get(i)?.has((h0 * 5 + g0) * 5 + f0)) return penalty + terms;
        return terms;
      }
      const terms = weightedSum(ctx, tripleTerms(ctx, a, h, v[i - 1]!, g, c, f));
      return heldBack[1]![i] && !holdable(t, c.pitch - a.pitch, h, f)
        ? HELD_PENALTY + terms
        : terms;
    },
  });
  return {
    fingers: result.fingers.map((f) => (f + 1) as Finger),
    cost: result.cost,
    marginals: result.marginals,
  };
}

/**
 * The chord loop's step. A slice whose decoded configuration breaks more practical spans than the
 * slice must (`minBreaks`, counted over every pair at any distance) gets that configuration
 * forbidden. In a slice with a legal configuration the decoder already forbids the pairs at most
 * two apart, so these are pairs three or four apart, or a soft decode's choice; in a slice with
 * none it keeps the configurations that break the fewest pairs. A slice of more than five notes,
 * or whose pins no configuration keeps, is left as decoded, and a crossed configuration (a soft
 * decode) is already charged. Says whether any is new.
 */
function forbidChordViolations(
  v: SeqNote[],
  t: SpanTables,
  shapes: SliceShape[],
  fingers: Finger[],
  c: HandConstraints,
): boolean {
  const forbidden = c.forbiddenConfigs ?? new Map<number, Finger[][]>();
  c.forbiddenConfigs = forbidden;
  let added = false;
  shapes.forEach(({ start, size, minBreaks }, slice) => {
    if (size < 2 || minBreaks === INF) return;
    const decoded = fingers.slice(start, start + size);
    if (decoded.some((f, k) => k > 0 && f <= decoded[k - 1]!)) return;
    if (breaks(t, v, start, decoded) <= minBreaks) return;
    const list = forbidden.get(slice) ?? [];
    if (list.some((x) => sameFingers(x, decoded))) return;
    list.push(decoded);
    forbidden.set(slice, list);
    added = true;
  });
  return added;
}

/** Bit of finger f in a finger set (bit f - 1); ALL_FINGERS is the set of all five. */
const bit = (f: Finger): number => 1 << (f - 1);
const ALL_FINGERS = 0b11111;
/** Restarts of the consistency pass per component before it gives up pruning that component. */
const MAX_LAW_RESTARTS = 64;

/** A binary law between notes a < b: `ok[g - 1]` is the set of fingers b may take when a takes g. */
interface LawEdge {
  a: number;
  b: number;
  held: boolean;
  ok: number[];
  /** `back[f - 1]`: the set of fingers a may take when b takes f. */
  back: number[];
}

function lawEdge(a: number, b: number, held: boolean, test: (g: Finger, f: Finger) => boolean) {
  const ok = FINGERS.map((g) => FINGERS.reduce((m, f) => (test(g, f) ? m | bit(f) : m), 0));
  const back = FINGERS.map((f) =>
    FINGERS.reduce((m, g) => (ok[g - 1]! & bit(f) ? m | bit(g) : m), 0),
  );
  return { a, b, held, ok, back };
}

/**
 * Fingers each note can take in a fingering that keeps every law between two notes: the
 * held-note law for every held pair (`holds`, at any distance, which the second-order decoder
 * cannot see beyond two steps), and inside a slice the chord order (strictly rising fingers, or
 * non-decreasing beyond five notes) with the chord law where the slice has a legal configuration.
 * Pins fix their note's finger. Computed by arc consistency (AC-3, finger sets as bit masks), so a
 * finger is removed only when no fingering that keeps the laws (and the pins) can use it: a fully
 * legal fingering, when one exists, keeps every finger it uses. Where the laws cannot all hold
 * (more keys held than fingers, a hold no free finger can span), a set empties; the pass then lets
 * go of the oldest key held over the note whose set emptied (it drops the held-pair law of that
 * note with the earliest held note, as a player releases the oldest key when the fingers run out)
 * and starts that component of the law graph again, so the sets stay consistent with the laws that
 * can hold together (the drop rule was chosen on PIG train, docs/experiments.md). After
 * MAX_LAW_RESTARTS drops a component is left unpruned. Returns a finger set (bit mask) per note.
 */
function lawDomains(
  v: SeqNote[],
  t: SpanTables,
  shapes: SliceShape[],
  holds: number[][],
  pinned: Map<number, Finger>,
): number[] {
  const edges: LawEdge[] = [];
  for (const { start, size, feasible } of shapes) {
    for (let a = start; a < start + size; a++)
      for (let b = a + 1; b < start + size; b++) {
        const i = v[b]!.pitch - v[a]!.pitch;
        const test =
          size > 5
            ? (g: Finger, f: Finger) => g <= f
            : feasible
              ? (g: Finger, f: Finger) => g < f && practical(t, i, g, f)
              : (g: Finger, f: Finger) => g < f;
        edges.push(lawEdge(a, b, false, test));
      }
  }
  holds.forEach((ms, b) => {
    for (const a of ms)
      edges.push(lawEdge(a, b, true, (g, f) => holdable(t, v[b]!.pitch - v[a]!.pitch, g, f)));
  });
  const init = v.map((_, k) => {
    const pin = pinned.get(k);
    return pin === undefined ? ALL_FINGERS : bit(pin);
  });
  // Components of the law graph (union-find), each checked on its own.
  const parent = v.map((_, k) => k);
  const root = (k: number): number => {
    while (parent[k] !== k) k = parent[k] = parent[parent[k]!]!;
    return k;
  };
  for (const e of edges) parent[root(e.a)] = root(e.b);
  const byRoot = new Map<number, number[]>();
  edges.forEach((e, k) => {
    const r = root(e.a);
    const list = byRoot.get(r) ?? [];
    list.push(k);
    byRoot.set(r, list);
  });
  const dom = [...init];
  const incident: number[][] = v.map(() => []);
  edges.forEach((e, k) => {
    incident[e.a]!.push(k);
    incident[e.b]!.push(k);
  });
  for (const list of byRoot.values()) {
    const notes = [...new Set(list.flatMap((k) => [edges[k]!.a, edges[k]!.b]))];
    const dropped = new Set<number>();
    let done = false;
    for (let restart = 0; !done && restart <= MAX_LAW_RESTARTS; restart++) {
      for (const k of notes) dom[k] = init[k]!;
      // Arc 2k revises edge k's note a against b, arc 2k + 1 its note b against a.
      const queue: number[] = [];
      const queued = new Set<number>();
      const push = (arc: number): void => {
        if (dropped.has(arc >> 1) || queued.has(arc)) return;
        queued.add(arc);
        queue.push(arc);
      };
      for (const k of list) {
        push(2 * k);
        push(2 * k + 1);
      }
      let wiped: number | undefined;
      for (let q = 0; q < queue.length; q++) {
        const arc = queue[q]!;
        queued.delete(arc);
        const e = edges[arc >> 1]!;
        const toB = (arc & 1) === 1;
        const x = toB ? e.b : e.a;
        const other = dom[toB ? e.a : e.b]!;
        const rel = toB ? e.back : e.ok;
        let kept = 0;
        for (let f = 0; f < 5; f++) if (dom[x]! & (1 << f) && rel[f]! & other) kept |= 1 << f;
        if (kept === dom[x]) continue;
        if (kept === 0) {
          // Let go of the oldest key held over this note: drop its held-pair law.
          let pick = arc >> 1;
          for (const k of incident[x]!) {
            const c = edges[k]!;
            if (!c.held || dropped.has(k)) continue;
            const p = edges[pick]!;
            if (!p.held || c.a < p.a || (c.a === p.a && c.b > p.b)) pick = k;
          }
          wiped = pick;
          break;
        }
        dom[x] = kept;
        for (const k of incident[x]!) {
          if (k === arc >> 1) continue;
          push(edges[k]!.a === x ? 2 * k + 1 : 2 * k);
        }
      }
      if (wiped === undefined) done = true;
      else dropped.add(wiped);
    }
    if (!done) for (const k of notes) dom[k] = init[k]!;
  }
  return dom;
}

interface HeldConflict {
  held: number;
  later: number;
}

/**
 * Held-note conflicts farther than two steps back (the decoder's pair and triple terms cover the
 * nearer ones): note `held` still holds its key at note `later`'s onset (`holds`, from
 * `forEachHold`) and their fingers break the held-note law (the same finger, or a span beyond
 * practical). Sorted by the later note.
 */
function heldConflicts(
  v: SeqNote[],
  t: SpanTables,
  holds: number[][],
  fingers: Finger[],
): HeldConflict[] {
  const out: HeldConflict[] = [];
  holds.forEach((ms, i) => {
    for (const m of ms)
      if (m <= i - 3 && !holdable(t, v[i]!.pitch - v[m]!.pitch, fingers[m]!, fingers[i]!))
        out.push({ held: m, later: i });
  });
  return out;
}

/**
 * Turns the conflicts of the last decode into constraints for the next one and says whether any is
 * new. One note of each conflict moves (it gets `forbidden` fingers) and the other keeps its
 * finger (it joins `kept`). Keeping the other side stops the constraints from piling up, as they
 * do when only the later note is constrained: the decoder then moves the held note to another
 * finger, which is constrained next, until no finger is left.
 *
 * The moving note may take the fingers that keep the held-note law with the kept finger, first
 * those on the side of it that matches its pitch (a finger above it for a higher note), so the two
 * notes that sound together do not cross, then any that span the interval. When neither note has
 * such a finger, a conflict on one finger (L03) at least moves off it (non-crossing first), and a
 * span beyond practical with no finger to mend it is left to lint. A pinned or already kept note
 * stays; otherwise the note whose cheapest allowed finger costs less moves (min-sum marginals of
 * the last decode; a tie moves the later note). A conflict with a note that already moves in this
 * round waits for the next decode, and one between two notes that both stay (two pins) is left to
 * lint.
 */
function resolveHeldConflicts(
  v: SeqNote[],
  t: SpanTables,
  conflicts: HeldConflict[],
  fingers: Finger[],
  marginals: number[][],
  c: HandConstraints,
): boolean {
  const kept = c.kept ?? new Map<number, Finger>();
  c.kept = kept;
  let added = false;
  const moving = new Set<number>();
  const stays = (k: number): boolean => c.pinned.has(k) || kept.has(k);
  const fingerOf = (k: number): Finger => c.pinned.get(k) ?? kept.get(k) ?? fingers[k]!;
  const cost = (k: number, ok: (g: Finger) => boolean): number =>
    stays(k) ? INF : Math.min(INF, ...FINGERS.filter(ok).map((g) => marginals[k]![g - 1]!));
  type Ok = (g: Finger) => boolean;
  for (const x of conflicts) {
    if (moving.has(x.held) || moving.has(x.later)) continue;
    if (stays(x.held) && stays(x.later)) continue;
    const gh = fingerOf(x.held);
    const fl = fingerOf(x.later);
    const iv = v[x.later]!.pitch - v[x.held]!.pitch;
    if (holdable(t, iv, gh, fl)) continue; // a kept or pinned finger already mends it
    // Never 0: a pair on one pitch is not a hold (forEachHold).
    const d = Math.sign(iv);
    const laterSide: Ok = (g) => (g - gh) * d > 0;
    const heldSide: Ok = (g) => (fl - g) * d > 0;
    const laterLaw: Ok = (g) => holdable(t, iv, gh, g);
    const heldLaw: Ok = (g) => holdable(t, iv, g, fl);
    const tiers: Array<[Ok, Ok]> = [
      [(g) => laterLaw(g) && laterSide(g), (g) => heldLaw(g) && heldSide(g)],
      [laterLaw, heldLaw],
    ];
    if (gh === fl) tiers.push([laterSide, heldSide], [(g) => g !== gh, (g) => g !== fl]);
    let choice: { laterOk: Ok; heldOk: Ok; later: number; held: number } | undefined;
    for (const [laterOk, heldOk] of tiers) {
      const later = cost(x.later, laterOk);
      const held = cost(x.held, heldOk);
      if (later < INF || held < INF) {
        choice = { laterOk, heldOk, later, held };
        break;
      }
    }
    if (choice === undefined) continue;
    const moveHeld = stays(x.later) || (!stays(x.held) && choice.held < choice.later);
    const move = moveHeld ? x.held : x.later;
    const keep = moveHeld ? x.later : x.held;
    const ok = moveHeld ? choice.heldOk : choice.laterOk;
    moving.add(move);
    const set = c.forbidden.get(move) ?? new Set<Finger>();
    for (const g of FINGERS) {
      if (ok(g) || set.has(g)) continue;
      set.add(g);
      added = true;
    }
    c.forbidden.set(move, set);
    if (!stays(keep)) {
      kept.set(keep, moveHeld ? fl : gh);
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
  const maxHeld = opts.maxHeldIterations ?? 8;
  const maxChord = opts.maxChordIterations ?? 8;
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
      forbiddenConfigs: new Map(),
      soft: false,
    };
    const shapes = sliceShapes(v, ctx.tables, pinned);
    const holds = heldPairs(v, ctx.tables);
    // A finger no law-keeping fingering can give a note is forbidden from the start, so the
    // decoder sees the held-note laws of holds more than two steps back before the loop has to.
    if (opts.lawDomains !== false)
      lawDomains(v, ctx.tables, shapes, holds, pinned).forEach((d, k) => {
        if (pinned.has(k) || d === ALL_FINGERS) return;
        constraints.forbidden.set(k, new Set(FINGERS.filter((f) => (d & bit(f)) === 0)));
      });
    let solved = solveHand(seq, ctx, constraints, templates);
    // Held-note rules are finite and the chord law is a penalty only where a configuration
    // keeps the pins, so only pins against the chord order make the hard decode infinite; the soft
    // decode then keeps the pins and breaks the fewest chord rules.
    let relaxed = false;
    const relax = (): void => {
      constraints.soft = true;
      relaxed = true;
      solved = solveHand(seq, ctx, constraints, templates);
    };
    if (!Number.isFinite(solved.cost)) relax();
    // Chord loop first (a forbidden configuration is never one that breaks the fewest pairs, so
    // the decode stays finite), then the held-note loop on a decode without chord violations; each
    // has its own budget of decodes.
    let iterations = 1;
    let chordRounds = 1;
    let heldRounds = 1;
    for (;;) {
      if (
        chordRounds < maxChord &&
        forbidChordViolations(v, ctx.tables, shapes, solved.fingers, constraints)
      )
        chordRounds++;
      else if (
        heldRounds < maxHeld &&
        resolveHeldConflicts(
          v,
          ctx.tables,
          heldConflicts(v, ctx.tables, holds, solved.fingers),
          solved.fingers,
          solved.marginals,
          constraints,
        )
      )
        heldRounds++;
      else break;
      solved = solveHand(seq, ctx, constraints, templates);
      iterations++;
    }
    if (!Number.isFinite(solved.cost) && !relaxed) {
      relax();
      iterations++;
    }
    const infeasibleSlices = shapes.flatMap(({ start, size, feasible }, slice) =>
      size > 1 && !feasible
        ? [{ slice, noteIds: v.slice(start, start + size).map((n) => n.noteId) }]
        : [],
    );
    const fingers = solved.fingers;
    const bonus = templateBonus(seq, ctx, templates);
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
      const tb = bonus[i];
      if (tb?.finger === f) terms.push({ rule: 'template', points: -tb.points });
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
      if (holds[i]!.length > 0)
        explanation.heldBy = holds[i]!.map((k) => ({ finger: fingers[k]!, noteId: v[k]!.noteId }));
      explanations[n.noteId] = explanation;
    }
    solutions.push({
      hand,
      cost: solved.cost,
      iterations,
      relaxed,
      notes: v.length,
      infeasibleSlices,
    });
  }
  return { assignment, explanations, hands: solutions };
}
