// Reference decode with the TypeScript engine for the Python-port parity check.
// Usage (from the project root; tsx is a devDependency of the engine package):
//   packages/engine/node_modules/.bin/tsx research/learn/experiments/engine_solve.ts research/data/learn/engine_reference.json <pig file>...
// (the dump is large; keep it under the gitignored research/data/learn, never under results)
// Prints, per file, the engine's finger per note id (Parncutt weights, large profile) and the
// per-hand cost, so `compare_engine.py` can compare them with the Python decoder.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePig } from '../../../packages/engine/src/io/pig/read.js';
import { solveFingering } from '../../../packages/engine/src/fingering/solve.js';
import { buildHandSequence } from '../../../packages/engine/src/fingering/sequence.js';

const [out, ...files] = process.argv.slice(2);
if (!out || files.length === 0) {
  console.error('usage: engine_solve.ts <out.json> <pig file>...');
  process.exit(2);
}
const result: Record<string, unknown> = {};
for (const file of files) {
  const { score } = parsePig(readFileSync(resolve(file), 'utf8'));
  const t0 = performance.now();
  const solved = solveFingering(score, { profile: 'large' });
  const ms = performance.now() - t0;
  const fingers: Record<string, number> = {};
  for (const [id, a] of Object.entries(solved.assignment)) fingers[id] = a.finger;
  const seqs: Record<string, unknown> = {};
  for (const hand of ['R', 'L'] as const) {
    const seq = buildHandSequence(score, hand);
    seqs[hand] = seq.notes.map((n) => [n.noteId, n.pitch, n.slice, n.restBefore ? 1 : 0, n.ioi]);
  }
  result[file] = { fingers, hands: solved.hands, ms, notes: score.notes.length, seqs };
}
writeFileSync(out, JSON.stringify(result));
console.log(`wrote ${out} for ${files.length} files`);
