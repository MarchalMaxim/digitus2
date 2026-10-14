import { ENGINE_VERSION } from '../../version.js';
import { PARNCUTT_WEIGHTS, RULE_IDS } from '../rules.js';
import type { RuleWeights } from '../rules.js';
import learnedOpenJson from './weights-learned-open.json' with { type: 'json' };

/**
 * Named weight sets for the solver (M3 Task 4). Every set gives one weight to every rule id
 * (`RULE_IDS`) and carries its provenance: where the numbers come from, what they were fitted on,
 * and under which licence they may be used.
 *
 * - `parncutt`: the literature defaults of `weights-parncutt.json` (M2), the solver's default.
 * - `learned-open`: fitted by `digitus2 learn --config open` on the textbook oracle, the Beringer
 *   corpus and the Mutopia train half only (no PIG data: PIG is licensed for non-profit academic
 *   use, so PIG-fitted sets stay under `research/weights/` and never ship).
 */

export type WeightSetId = 'parncutt' | 'learned-open';

export const WEIGHT_SET_SCHEMA = 'digitus2.weights/1';

export interface WeightSetCorpus {
  corpus: string;
  /** `train` for a split corpus (the Mutopia train half, PIG train minus validation). */
  subset?: string;
  files: number;
  /** sha256 over the sorted `path:size` lines of the files read (`cli/corpora.ts`). */
  sha256: string;
}

export interface WeightSetValidation {
  /** Official M_gen (a fraction) of the shipped weights on the validation examples. */
  noteAccuracy: number;
  /** Share of validation notes matching at least one annotation. */
  soft?: number;
  notes: number;
  /** Validation M_gen of every seed's best epoch, their mean and sample standard deviation. */
  seeds?: { values: Record<string, number>; mean: number; sd: number };
}

export interface WeightSetProvenance {
  /** When the set was written (ISO 8601; `learn --date`), the file's only non-reproducible field. */
  date: string;
  engineVersion: string;
  /** `parncutt`, or the `learn --config` the set was fitted with (`pig`, `open`). */
  config: string;
  /** Training corpora; validation data is named under `split` and `validation`, not here. */
  corpora: WeightSetCorpus[];
  split: Record<string, unknown>;
  /** Seed of the shipped run (the median of `--seeds` runs on validation). */
  seed: number;
  epochs: number;
  /** 1-based epoch whose averaged weights were kept; 0 for a set that was not trained. */
  bestEpoch: number;
  validation: WeightSetValidation | null;
  options: Record<string, unknown>;
  license: string;
}

export interface WeightSetFile {
  schema: typeof WEIGHT_SET_SCHEMA;
  id: WeightSetId | string;
  weights: RuleWeights;
  /** Softmax temperature of the solver's per-note confidences (Task 6 fits it; 2 until then). */
  confidenceTemperature: number;
  provenance: WeightSetProvenance;
}

const RULE_ID_SET: ReadonlySet<string> = new Set(RULE_IDS);
const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A list of ids for an error message, the first few of them. */
const few = (ids: string[]): string =>
  ids.slice(0, 6).join(', ') + (ids.length > 6 ? ` and ${ids.length - 6} more` : '');

/**
 * Checks that `x` is a weight-set file and returns it typed. Every rule id needs a finite weight
 * and no other key is allowed: a weight under a misspelt id would otherwise be silently ignored
 * (M3 Review Focus 3). Throws with `label` and the offending ids.
 */
export function validateWeightSet(x: unknown, label = 'weight set'): WeightSetFile {
  if (!isRecord(x)) throw new Error(`${label}: not a JSON object`);
  if (x.schema !== WEIGHT_SET_SCHEMA)
    throw new Error(`${label}: schema must be ${WEIGHT_SET_SCHEMA}, got ${String(x.schema)}`);
  if (typeof x.id !== 'string' || x.id === '') throw new Error(`${label}: no id`);
  const w = x.weights;
  if (!isRecord(w)) throw new Error(`${label}: no weights object`);
  const bad = RULE_IDS.filter((id) => !isFiniteNumber(w[id]));
  if (bad.length > 0) throw new Error(`${label}: no finite weight for ${few(bad)}`);
  const unknown = Object.keys(w).filter((k) => !RULE_ID_SET.has(k));
  if (unknown.length > 0) throw new Error(`${label}: unknown rule ids ${few(unknown)}`);
  const t = x.confidenceTemperature;
  if (!isFiniteNumber(t) || t <= 0)
    throw new Error(`${label}: confidenceTemperature must be a positive number`);
  const p = x.provenance;
  if (!isRecord(p)) throw new Error(`${label}: no provenance`);
  if (typeof p.license !== 'string' || p.license === '')
    throw new Error(`${label}: provenance.license is missing`);
  if (typeof p.config !== 'string' || typeof p.date !== 'string')
    throw new Error(`${label}: provenance needs config and date`);
  if (!Array.isArray(p.corpora)) throw new Error(`${label}: provenance.corpora is not a list`);
  return x as unknown as WeightSetFile;
}

/** The weights with keys in `RULE_IDS` order (sorted), frozen. */
function sortedWeights(w: RuleWeights): RuleWeights {
  const out = {} as RuleWeights;
  for (const id of RULE_IDS) out[id] = w[id];
  return Object.freeze(out) as RuleWeights;
}

const PARNCUTT_SET: WeightSetFile = Object.freeze({
  schema: WEIGHT_SET_SCHEMA,
  id: 'parncutt',
  weights: sortedWeights(PARNCUTT_WEIGHTS),
  confidenceTemperature: 2,
  provenance: Object.freeze({
    date: '2026-10-13',
    engineVersion: ENGINE_VERSION,
    config: 'parncutt',
    corpora: [],
    split: {},
    seed: 0,
    epochs: 0,
    bestEpoch: 0,
    validation: null,
    options: { source: 'packages/engine/src/fingering/params/weights-parncutt.json' },
    license: 'literature defaults',
  }),
});

const LEARNED_OPEN_SET: WeightSetFile = (() => {
  const s = validateWeightSet(learnedOpenJson, 'weights-learned-open.json');
  return Object.freeze({ ...s, weights: sortedWeights(s.weights) });
})();

export const WEIGHT_SETS: Readonly<Record<WeightSetId, WeightSetFile>> = Object.freeze({
  parncutt: PARNCUTT_SET,
  'learned-open': LEARNED_OPEN_SET,
});

/**
 * The set the CLI and the app pass to `solveFingering` (`weightSet: RECOMMENDED_WEIGHT_SET`); the
 * solver's own default stays `parncutt`, so M2's behaviour is unchanged for callers that pass
 * nothing.
 */
export const RECOMMENDED_WEIGHT_SET: WeightSetId = 'learned-open';

/**
 * A weight set by id, or a weight-set file (read from disk by the caller) checked by
 * `validateWeightSet`. Throws on an unknown id.
 */
export function loadWeightSet(id: WeightSetId | WeightSetFile): WeightSetFile {
  if (typeof id !== 'string') return validateWeightSet(id);
  const set = (WEIGHT_SETS as Record<string, WeightSetFile | undefined>)[id];
  if (!set)
    throw new Error(`unknown weight set ${id} (known: ${Object.keys(WEIGHT_SETS).join(', ')})`);
  return set;
}
