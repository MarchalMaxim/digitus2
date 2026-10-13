import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { metricsForScores } from './align.js';

const root = new URL('../../../../', import.meta.url);
const ref = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('fixtures/metrics-reference.json', new URL('../../', import.meta.url))),
    'utf8',
  ),
) as {
  piece: string;
  predAnnotation: string;
  goldAnnotations: string[];
  python: { gen: number; high: number; soft: number; rec: number };
};
const dir = fileURLToPath(new URL('research/data/pig/FingeringFiles/', root));
const load = (a: string) => parsePig(readFileSync(`${dir}${ref.piece}-${a}_fingering.txt`, 'utf8'));

describe('metrics agree with the Python reference (official evaluator conventions)', () => {
  it.skipIf(!existsSyncSafe(dir))(
    'matches gen, high, soft and rec to 1e-6 on a real PIG piece',
    () => {
      const pred = load(ref.predAnnotation);
      const golds = ref.goldAnnotations.map(load);
      const m = metricsForScores(pred, golds);
      expect(m.gen).toBeCloseTo(ref.python.gen, 6);
      expect(m.high).toBeCloseTo(ref.python.high, 6);
      expect(m.soft).toBeCloseTo(ref.python.soft, 6);
      expect(m.rec).toBeCloseTo(ref.python.rec, 6);
    },
  );
});

function existsSyncSafe(p: string): boolean {
  try {
    return readFileSync(`${p}001-1_fingering.txt`).length > 0;
  } catch {
    return false;
  }
}
