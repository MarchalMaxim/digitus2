// Dump the engine's per-note explanation terms along its own path (parity debugging).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePig } from '../../../packages/engine/src/io/pig/read.js';
import { solveFingering } from '../../../packages/engine/src/fingering/solve.js';
import { buildHandSequence } from '../../../packages/engine/src/fingering/sequence.js';

const [out, file] = process.argv.slice(2);
const { score } = parsePig(readFileSync(resolve(file!), 'utf8'));
const solved = solveFingering(score, { profile: 'large' });
const result: Record<string, unknown> = {};
for (const hand of ['R', 'L'] as const) {
  const seq = buildHandSequence(score, hand);
  result[hand] = seq.notes.map((n) => ({
    id: n.noteId,
    finger: solved.assignment[n.noteId]!.finger,
    terms: solved.explanations[n.noteId]!.terms.map((t) => [t.rule, t.points]),
  }));
}
writeFileSync(out!, JSON.stringify(result));
