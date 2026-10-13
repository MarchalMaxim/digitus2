/**
 * Exact second-order Viterbi decoder for one hand's note sequence (literature 6.4) with min-sum
 * forward-backward marginals. Fingers are 0..4 here (finger - 1). The state at note i is the pair
 * (f_{i-1}, f_i), stored at index g * 5 + f: 25 states and 125 triple evaluations per note.
 */
export interface DecodeProblem {
  /** Number of notes. */
  n: number;
  /** Cost of finger f (0..4) on note i; +Infinity forbids it. */
  unary(i: number, f: number): number;
  /** i >= 1: cost of finger g on note i-1 followed by f on note i. */
  pair(i: number, g: number, f: number): number;
  /** i >= 2: cost of fingers h, g, f on notes i-2, i-1, i. */
  triple(i: number, h: number, g: number, f: number): number;
}

export interface DecodeResult {
  /** 0..4 per note; empty when n = 0. */
  fingers: number[];
  /** Total cost of the returned path; +Infinity when no finite path exists. */
  cost: number;
  /** marginals[i][f] = minimum total cost over complete paths with finger f on note i. */
  marginals: number[][];
}

const F = 5;
const S = F * F;
const INF = Number.POSITIVE_INFINITY;

/**
 * Minimises the sum of unary(i, f_i) over all notes, pair(i, f_{i-1}, f_i) for i >= 1 and
 * triple(i, f_{i-2}, f_{i-1}, f_i) for i >= 2. The callbacks must be pure.
 *
 * Ties go to the lowest finger on the earliest note: the returned path is the lexicographically
 * smallest optimal path, the one a brute-force enumeration in lexicographic order keeps. A
 * back-trace from the final state cannot give that order (it settles the last notes first), so the
 * path is read forward along the backward pass instead: the lowest optimal state at note 1, then at
 * every later note the lowest finger whose cheapest completion keeps the optimum.
 *
 * When no finite path exists every state ties at +Infinity, so the path starts in state (0, 0) at
 * note 1 and follows the cheapest completion from there; cost is +Infinity and callers relax
 * constraints and retry.
 */
export function decode(p: DecodeProblem): DecodeResult {
  const n = p.n;
  if (n === 0) return { fingers: [], cost: 0, marginals: [] };
  if (n === 1) {
    const u = Array.from({ length: F }, (_, f) => p.unary(0, f));
    let best = 0;
    for (let f = 1; f < F; f++) if (u[f]! < u[best]!) best = f;
    return { fingers: [best], cost: u[best]!, marginals: [u] };
  }

  // L[i][g * F + f] = unary(i, f) + pair(i, g, f) for i >= 1, evaluated once and shared by the
  // forward pass, the backward pass and the path read-out.
  const L = new Array<Float64Array>(n);
  for (let i = 1; i < n; i++) {
    const row = new Float64Array(S);
    for (let f = 0; f < F; f++) {
      const u = p.unary(i, f);
      for (let g = 0; g < F; g++) row[g * F + f] = u + p.pair(i, g, f);
    }
    L[i] = row;
  }

  // Forward pass. D[i][g * F + f] = cost of the cheapest path over notes 0..i that ends with g on
  // note i-1 and f on note i (i >= 1).
  const D = new Array<Float64Array>(n);
  const d1 = new Float64Array(S);
  const l1 = L[1]!;
  for (let g = 0; g < F; g++) {
    const u0 = p.unary(0, g);
    for (let f = 0; f < F; f++) d1[g * F + f] = u0 + l1[g * F + f]!;
  }
  D[1] = d1;
  for (let i = 2; i < n; i++) {
    const prev = D[i - 1]!;
    const li = L[i]!;
    const cur = new Float64Array(S).fill(INF);
    for (let g = 0; g < F; g++) {
      for (let f = 0; f < F; f++) {
        const local = li[g * F + f]!;
        if (local === INF) continue;
        let best = INF;
        for (let h = 0; h < F; h++) {
          const base = prev[h * F + g]!;
          if (base === INF) continue;
          const v = base + p.triple(i, h, g, f);
          if (v < best) best = v;
        }
        cur[g * F + f] = best + local;
      }
    }
    D[i] = cur;
  }

  // Backward pass. B[i][g * F + f] = cost of the cheapest completion over notes i+1..n-1 after
  // state (g, f) at note i; B[n-1] = 0.
  const B = new Array<Float64Array>(n);
  B[n - 1] = new Float64Array(S);
  for (let i = n - 2; i >= 1; i--) {
    const next = B[i + 1]!;
    const ln = L[i + 1]!;
    const cur = new Float64Array(S).fill(INF);
    for (let g = 0; g < F; g++) {
      for (let f = 0; f < F; f++) {
        let best = INF;
        for (let e = 0; e < F; e++) {
          const local = ln[f * F + e]!;
          const rest = next[f * F + e]!;
          if (local === INF || rest === INF) continue;
          const v = local + p.triple(i + 1, g, f, e) + rest;
          if (v < best) best = v;
        }
        cur[g * F + f] = best;
      }
    }
    B[i] = cur;
  }

  // Marginals: min over g of D[i][g, f] + B[i][g, f] for i >= 1; note 0 is indexed by g at note 1.
  const marginals: number[][] = Array.from({ length: n }, () => new Array<number>(F).fill(INF));
  for (let i = 1; i < n; i++) {
    const d = D[i]!;
    const b = B[i]!;
    const m = marginals[i]!;
    for (let g = 0; g < F; g++) {
      for (let f = 0; f < F; f++) {
        const v = d[g * F + f]! + b[g * F + f]!;
        if (v < m[f]!) m[f] = v;
        if (i === 1 && v < marginals[0]![g]!) marginals[0]![g] = v;
      }
    }
  }

  // Path read-out. The candidate sums below are the same expressions the backward pass minimised,
  // so the chosen finger reproduces B exactly and the path stays optimal.
  const fingers = new Array<number>(n).fill(0);
  const b1 = B[1]!;
  let k1 = 0;
  let best1 = INF;
  for (let k = 0; k < S; k++) {
    const v = d1[k]! + b1[k]!;
    if (v < best1) {
      best1 = v;
      k1 = k;
    }
  }
  fingers[0] = Math.floor(k1 / F);
  fingers[1] = k1 % F;
  for (let i = 2; i < n; i++) {
    const g = fingers[i - 2]!;
    const f = fingers[i - 1]!;
    const li = L[i]!;
    const bi = B[i]!;
    let best = INF;
    let arg = 0;
    for (let e = 0; e < F; e++) {
      const local = li[f * F + e]!;
      const rest = bi[f * F + e]!;
      if (local === INF || rest === INF) continue;
      const v = local + p.triple(i, g, f, e) + rest;
      if (v < best) {
        best = v;
        arg = e;
      }
    }
    fingers[i] = arg;
  }

  // Cost of the returned path, summed note by note.
  let cost = p.unary(0, fingers[0]!);
  for (let i = 1; i < n; i++) {
    let c = L[i]![fingers[i - 1]! * F + fingers[i]!]!;
    if (i >= 2) c += p.triple(i, fingers[i - 2]!, fingers[i - 1]!, fingers[i]!);
    cost += c;
  }
  return { fingers, cost, marginals };
}
