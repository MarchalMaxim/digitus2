import { buildHandSequence } from '../fingering/sequence.js';
import { resolveProfile } from '../fingering/spans.js';
import type { HandProfile, HandProfileId } from '../fingering/spans.js';
import type { Assignment, Hand, Score } from '../score/types.js';
import { lintHand } from './rules.js';
import type { LintIssue, LintRuleId } from './rules.js';

export { LINT_RULES } from './rules.js';
export type { LintIssue, LintRuleId, LintSeverity } from './rules.js';

export interface LintOptions {
  profile?: HandProfileId | HandProfile;
  hopFastSec?: number;
  repeatFastSec?: number;
  beginner?: boolean;
}
export interface LintReport {
  issues: LintIssue[];
  counts: Partial<Record<LintRuleId, number>>;
  errors: number;
  warnings: number;
  infos: number;
  notes: number;
}

export function lintFingering(
  score: Score,
  assignment: Assignment,
  opts: LintOptions = {},
): LintReport {
  const profile = resolveProfile(opts.profile);
  const ctx = {
    tables: profile.tables,
    hopFastSec: opts.hopFastSec ?? 0.25,
    repeatFastSec: opts.repeatFastSec ?? 0.18,
    beginner: opts.beginner ?? false,
  };
  const issues: LintIssue[] = [];
  for (const hand of ['R', 'L'] as Hand[]) {
    const seq = buildHandSequence(score, hand);
    const fingered = seq.notes
      .filter((n) => assignment[n.noteId] !== undefined)
      .map((n) => ({
        note: n,
        finger: assignment[n.noteId]!.finger,
        substitution: assignment[n.noteId]!.substitution,
      }));
    issues.push(...lintHand(hand, fingered, ctx));
  }
  const counts: Partial<Record<LintRuleId, number>> = {};
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const i of issues) {
    counts[i.rule] = (counts[i.rule] ?? 0) + 1;
    if (i.severity === 'error') errors++;
    else if (i.severity === 'warning') warnings++;
    else infos++;
  }
  return { issues, counts, errors, warnings, infos, notes: score.notes.length };
}
