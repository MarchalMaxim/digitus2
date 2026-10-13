import { readFileSync } from 'node:fs';
import { alignScores } from '../src/eval/align.js';
import { lintFingering } from '../src/lint/index.js';
import type { LintReport } from '../src/lint/index.js';
import { parseMusicXml } from '../src/io/musicxml/read.js';
import { parsePig } from '../src/io/pig/read.js';
import type { Assignment, Score } from '../src/score/types.js';

/**
 * Lints the file's own fingering (PIG fingers or MusicXML editorial fingerings), or, with
 * `fingering`, a PIG prediction file of the same notes. The prediction is aligned to the score by
 * note id (as `finger --format pig` writes them), falling back to (onset, hand, pitch) order; a
 * prediction with a different note count or pitches is an error, never a silently partial lint.
 */
export function lintFile(file: string, fingering?: string, beginner = false): LintReport {
  let score: Score;
  let assignment: Assignment;
  if (/\.txt$/i.test(file)) ({ score, assignment } = parsePig(readFileSync(file, 'utf8')));
  else {
    const r = parseMusicXml(readFileSync(file));
    score = r.score;
    assignment = r.editorial;
  }
  if (fingering) {
    const pred = parsePig(readFileSync(fingering, 'utf8'));
    assignment = {};
    for (const [predId, scoreId] of alignScores(pred.score, score)) {
      const a = pred.assignment[predId];
      if (a) assignment[scoreId] = a;
    }
  }
  return lintFingering(score, assignment, { beginner });
}

export function formatLint(r: LintReport): string {
  const lines = [`${r.notes} notes: ${r.errors} errors, ${r.warnings} warnings, ${r.infos} infos`];
  for (const [rule, n] of Object.entries(r.counts).sort(([a], [b]) => a.localeCompare(b)))
    lines.push(`${rule}: ${n}`);
  for (const i of r.issues)
    lines.push(`${i.severity.padEnd(7)} ${i.rule} ${i.hand} [${i.noteIds.join(',')}] ${i.message}`);
  return lines.join('\n');
}
