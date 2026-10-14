import { describe, expect, it } from 'vitest';
import { PARNCUTT_WEIGHTS, RULE_IDS } from '../rules.js';
import {
  loadWeightSet,
  RECOMMENDED_WEIGHT_SET,
  validateWeightSet,
  WEIGHT_SETS,
} from './weightSets.js';
import type { WeightSetFile } from './weightSets.js';

describe('weight sets', () => {
  it('ships parncutt and learned-open with every rule id and a provenance block', () => {
    for (const id of ['parncutt', 'learned-open'] as const) {
      const s = loadWeightSet(id);
      expect(s.schema).toBe('digitus2.weights/1');
      expect(Object.keys(s.weights).sort()).toEqual([...RULE_IDS]);
      expect(s.confidenceTemperature).toBeGreaterThan(0);
      expect(s.provenance.license.length).toBeGreaterThan(0);
    }
    expect(WEIGHT_SETS['learned-open'].provenance.config).toBe('open');
    expect(RECOMMENDED_WEIGHT_SET).toBe('learned-open');
  });
  it('the shipped learned set never mentions PIG as a training corpus', () => {
    const s = loadWeightSet('learned-open');
    expect(s.provenance.corpora.map((c) => c.corpus)).not.toContain('pig');
    expect(JSON.stringify(s.provenance.split)).not.toMatch(/pig_official.*train/);
  });
  it('parncutt is the literature set, and the learned set keeps the template weight frozen', () => {
    const p = loadWeightSet('parncutt');
    for (const id of RULE_IDS) expect(p.weights[id]).toBe(PARNCUTT_WEIGHTS[id]);
    expect(p.provenance.license).toBe('literature defaults');
    // Plan correction 8: `template` is not learned; it stays at the Parncutt value.
    expect(loadWeightSet('learned-open').weights.template).toBe(PARNCUTT_WEIGHTS.template);
    // Keys are written sorted, so a diff of two weight files lines up rule by rule.
    expect(Object.keys(WEIGHT_SETS['learned-open'].weights)).toEqual([...RULE_IDS]);
  });
  it('loadWeightSet takes a weight-set file and rejects unknown ids or missing weights', () => {
    const p = loadWeightSet('parncutt');
    const custom: WeightSetFile = { ...p, id: 'custom', weights: { ...p.weights, hop: 3 } };
    expect(loadWeightSet(custom).weights.hop).toBe(3);
    expect(() => loadWeightSet('nope' as 'parncutt')).toThrow(/unknown weight set/);
    const missing: Record<string, number> = { ...p.weights };
    delete missing.hop;
    expect(() => validateWeightSet({ ...p, weights: missing })).toThrow(/hop/);
    expect(() => validateWeightSet({ ...p, weights: { ...p.weights, 'tr:66:up': 1 } })).toThrow(
      /tr:66:up/,
    );
    expect(() => validateWeightSet({ ...p, weights: { ...p.weights, hop: Number.NaN } })).toThrow(
      /hop/,
    );
    expect(() => validateWeightSet({ ...p, confidenceTemperature: 0 })).toThrow(
      /confidenceTemperature/,
    );
    expect(() => validateWeightSet({ ...p, schema: 'digitus2.weights/0' })).toThrow(/schema/);
  });
});
