// The light rules: candidates, selection and the divisions factor. A port of
// research/embellish/core.py (scale, key_alters, spell, pitch_name, step_above, between, the split
// tables, _select) with the three light changes of research/embellish/light_reference.py
// (_candidates_light, _divisions_factor_light). Python's `%` and `//` are `mod` and `Math.floor`.
import { compound, end, isStrong, single, soundsThroughStrong, top } from './analyse.js';
import type { EmbMeasure, EmbNote, Piece } from './analyse.js';
import { frac, mod } from './frac.js';
import type { Frac } from './frac.js';

export type EmbellishRule = 'passing' | 'neighbour-repeated';
export type EmbellishRole = 'passing' | 'neighbour';

const STEPS: readonly (readonly [step: string, semis: number])[] = [
  ['C', 0],
  ['D', 2],
  ['E', 4],
  ['F', 5],
  ['G', 7],
  ['A', 9],
  ['B', 11],
];
const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
const H = frac(1, 2);

/** A's length (by `Frac.toString()`) -> the lengths of A and the new note: `core.SPLIT_END`. */
type SplitTable = ReadonlyMap<string, readonly Frac[]>;
const SPLIT_END_SIMPLE: SplitTable = new Map([
  ['1', [H, H]],
  ['3/2', [frac(1), H]],
  ['2', [frac(1), frac(1)]],
  ['3', [frac(2), frac(1)]],
  ['4', [frac(3), frac(1)]],
]);
const SPLIT_END_COMPOUND: SplitTable = new Map([
  ['1', [H, H]],
  ['3/2', [frac(1), H]],
]);

export function splitEnd(m: EmbMeasure): SplitTable {
  return compound(m) ? SPLIT_END_COMPOUND : SPLIT_END_SIMPLE;
}

/** A length in quarters (by `Frac.toString()`) -> its note type and dots: `core.TYPE_OF`. */
export const TYPE_OF: ReadonlyMap<string, readonly [type: string, dots: number]> = new Map([
  ['4', ['whole', 0]],
  ['3', ['half', 1]],
  ['2', ['half', 0]],
  ['3/2', ['quarter', 1]],
  ['1', ['quarter', 0]],
  ['3/4', ['eighth', 1]],
  ['1/2', ['eighth', 0]],
]);

// ---- pitch helpers ------------------------------------------------------------------------------

/** The pitch classes of the key signature's major scale. */
export function scale(fifths: number): Set<number> {
  const tonic = mod(7 * fifths, 12);
  return new Set(MAJOR.map((d) => mod(tonic + d, 12)));
}

export function keyAlters(fifths: number): Record<string, number> {
  const alters: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) for (const s of 'FCGDAEB'.slice(0, fifths)) alters[s] = 1;
  else if (fifths < 0) for (const s of 'BEADGCF'.slice(0, -fifths)) alters[s] = -1;
  return alters;
}

/** (step, alter, octave) of a pitch of the key's scale, spelled as the key signature spells it. */
export function spell(midi: number, fifths: number): [step: string, alter: number, octave: number] {
  const alters = keyAlters(fifths);
  for (const [step, semis] of STEPS) {
    const alter = alters[step]!;
    if (mod(semis + alter, 12) === mod(midi, 12))
      return [step, alter, Math.floor((midi - alter) / 12) - 1];
  }
  throw new Error(`${midi} is not in the scale of ${fifths} fifths`);
}

export function pitchName(midi: number, fifths: number): string {
  const [step, alter, octave] = spell(midi, fifths);
  return step + (alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter)) + String(octave);
}

export function stepAbove(p: number, sc: Set<number>): number | null {
  if (!sc.has(mod(p, 12))) return null;
  for (const k of [1, 2]) if (sc.has(mod(p + k, 12))) return p + k;
  return null;
}

export function between(a: number, b: number, sc: Set<number>): number | null {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const inside: number[] = [];
  for (let p = lo + 1; p < hi; p++) if (sc.has(mod(p, 12))) inside.push(p);
  return inside.length === 1 ? inside[0]! : null;
}

// ---- candidates ---------------------------------------------------------------------------------

export interface Part {
  length: Frac;
  /** The new note's pitch, or null for A itself. */
  pitch: number | null;
  role: 'melody' | EmbellishRole;
}

export interface Candidate {
  rule: EmbellishRule;
  a: EmbNote;
  parts: Part[];
}

const PRIORITY: Readonly<Record<EmbellishRule, number>> = { passing: 0, 'neighbour-repeated': 1 };
const ROLE: Readonly<Record<EmbellishRule, EmbellishRole>> = {
  passing: 'passing',
  'neighbour-repeated': 'neighbour',
};

function count(skipped: Record<string, number>, reason: string): void {
  skipped[reason] = (skipped[reason] ?? 0) + 1;
}

/** `_candidates_light` of light_reference.py: the light candidates, and why the others got none. */
export function findCandidates(piece: Piece, skipped: Record<string, number>): Candidate[] {
  const out: Candidate[] = [];
  const melody = piece.melody;
  const lastMeasure = piece.measures[piece.measures.length - 1]!.idx;
  const others = piece.notes.filter((n) => n.pitch !== null && !n.grace && n.dur.n > 0);
  const graces = new Set(
    piece.notes.filter((n) => n.grace && n.staff === '1').map((n) => n.onset.toString()),
  );
  // `[n for n in others if n.measure is m]`, per measure, in document order
  const barNotesOf = new Map<EmbMeasure, EmbNote[]>();
  for (const n of others) {
    const list = barNotesOf.get(n.measure);
    if (list) list.push(n);
    else barNotesOf.set(n.measure, [n]);
  }
  melody.forEach((g, i) => {
    if (!single(g)) {
      count(skipped, 'chord');
      return;
    }
    const a = g.notes[0]!;
    const m = a.measure;
    let reason: string | null = null;
    if (i === melody.length - 1 || m.idx === lastMeasure) reason = 'last bar';
    else if (a.tie) reason = 'tied';
    else if (a.tuplet) reason = 'tuplet';
    else if (a.fermata) reason = 'fermata';
    else if (m.time === null) reason = 'no time signature';
    else if (m.innerTimeChange) reason = 'time change inside the bar';
    if (reason) {
      count(skipped, reason);
      return;
    }
    const nxt = melody[i + 1]!;
    const b = top(nxt);
    const ap = a.pitch!;
    const bp = b.pitch!;
    const nxtOnset = nxt.notes[0]!.onset;
    const contiguous = nxtOnset.eq(end(a)) && !graces.has(nxtOnset.toString());
    const sc = scale(a.fifths);
    const sameKey = b.fifths === a.fifths;
    const found: [EmbellishRule, number[]][] = [];
    if (
      contiguous &&
      sameKey &&
      [3, 4].includes(Math.abs(bp - ap)) &&
      sc.has(mod(ap, 12)) &&
      sc.has(mod(bp, 12))
    ) {
      const mid = between(ap, bp, sc);
      if (mid !== null) found.push(['passing', [mid]]);
    }
    if (contiguous && bp === ap) {
      const up = stepAbove(ap, sc);
      if (up !== null && up - ap === 2) found.push(['neighbour-repeated', [up]]);
    }
    const table = splitEnd(m);
    const reasons: string[] = [];
    let made = 0;
    for (const [rule, pitches] of found) {
      const lengths = table.get(a.dur.toString());
      if (lengths === undefined) {
        reasons.push('too short or odd length');
        continue;
      }
      if (lengths.some((x) => !x.mul(frac(a.divisions)).isInteger())) {
        reasons.push('divisions');
        continue;
      }
      let t = a.onset.add(lengths[0]!);
      let why: string | null = null;
      for (let k = 0; k < Math.min(lengths.length - 1, pitches.length); k++) {
        const length = lengths[k + 1]!;
        const p = pitches[k]!;
        const metric = t.sub(m.start).add(m.offset);
        if (isStrong(m, metric) || soundsThroughStrong(m, metric, metric.add(length))) {
          why = 'strong beat';
          break;
        }
        const tEnd = t.add(length);
        if (others.some((n) => n !== a && n.onset.lt(tEnd) && t.lt(end(n)) && n.pitch! >= p)) {
          why = 'not the top line';
          break;
        }
        const barNotes = barNotesOf.get(m) ?? [];
        if (
          barNotes.some(
            (n) => !sc.has(mod(n.pitch!, 12)) && [1, 11].includes(mod(n.pitch! - p, 12)),
          )
        ) {
          why = 'accidental nearby';
          break;
        }
        t = t.add(length);
      }
      if (why) {
        reasons.push(why);
        continue;
      }
      const parts: Part[] = [{ length: lengths[0]!, pitch: null, role: 'melody' }];
      for (let k = 0; k < Math.min(lengths.length - 1, pitches.length); k++)
        parts.push({ length: lengths[k + 1]!, pitch: pitches[k]!, role: ROLE[rule] });
      out.push({ rule, a, parts });
      made += 1;
    }
    if (!made) count(skipped, reasons[0] ?? 'no rule fits');
  });
  return out;
}

/**
 * `_select` at light: in rule order, then by onset, a note carries at most one figure, a bar at
 * most one, and no figure goes in a bar next to a bar that has one. The chosen figures in
 * `dropBars` (measure indices) are then removed, without a new selection. In onset order.
 */
export function selectLight(cands: Candidate[], dropBars: Iterable<number> = []): Candidate[] {
  const chosen: Candidate[] = [];
  const used = new Set<EmbNote>();
  const perBar = new Map<number, number>();
  const sorted = [...cands].sort(
    (x, y) => PRIORITY[x.rule] - PRIORITY[y.rule] || x.a.onset.cmp(y.a.onset),
  );
  for (const c of sorted) {
    const bar = c.a.measure.idx;
    if (used.has(c.a) || (perBar.get(bar) ?? 0) >= 1) continue;
    if (perBar.get(bar - 1) || perBar.get(bar + 1)) continue;
    chosen.push(c);
    used.add(c.a);
    perBar.set(bar, (perBar.get(bar) ?? 0) + 1);
  }
  const drop = new Set(dropBars);
  return chosen.filter((c) => !drop.has(c.a.measure.idx)).sort((x, y) => x.a.onset.cmp(y.a.onset));
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * `_divisions_factor_light`: the factor that lets every light split of a melody note be written in
 * the piece's divisions (1 if none is needed); 0 when a factor up to 12 does not suffice.
 */
export function divisionsFactorLight(piece: Piece): number {
  let need = 1;
  for (const g of piece.melody) {
    if (!single(g)) continue;
    const a = g.notes[0]!;
    for (const x of splitEnd(a.measure).get(a.dur.toString()) ?? []) {
      const d = x.mul(frac(a.divisions)).d;
      need = Math.floor((need * d) / gcd(need, d));
    }
  }
  return need <= 12 ? need : 0;
}
