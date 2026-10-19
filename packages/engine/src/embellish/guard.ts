// The guard (issue #67): what the app offers behind "Add notes between", and what the library gate
// verifies. The light embellisher, the independent check, then the app's solve and a beginner lint
// at every hand size; the figures of the bars that break the lint are dropped once and the result
// checked again. One function, so the app and the gate cannot drift apart.
import { RECOMMENDED_WEIGHT_SET } from '../fingering/params/weightSets.js';
import type { WeightSetFile, WeightSetId } from '../fingering/params/weightSets.js';
import { solveFingering } from '../fingering/solve.js';
import type { HandProfileId } from '../fingering/spans.js';
import { parseMusicXml } from '../io/musicxml/read.js';
import { LINT_RULES, lintFingering } from '../lint/index.js';
import type { LintIssue, LintReport } from '../lint/index.js';
import type { Assignment, Score } from '../score/types.js';
import { checkEmbellishment } from './check.js';
import { embellishMusicXml } from './embellish.js';
import type { EmbellishOptions, EmbellishResult, InsertedNote } from './embellish.js';

/** The fewest figures an offered embellishment carries, counted after the guard's drops. */
export const EMBELLISH_MIN_FIGURES = 3;

/** Every hand size the app offers; the guard passes only when the embellishment passes at each. */
export const GUARD_PROFILES: readonly HandProfileId[] = ['large', 'medium', 'small', 'child'];

export interface GuardOptions {
  profiles?: readonly HandProfileId[];
  /** Default `RECOMMENDED_WEIGHT_SET`, the app's. */
  weightSet?: WeightSetId | WeightSetFile;
  /** Default `EMBELLISH_MIN_FIGURES`. */
  minFigures?: number;
  /** @internal Tests only. */
  lint?: typeof lintFingering;
  /** @internal Tests only. */
  check?: typeof checkEmbellishment;
}

export interface Embellishment {
  xml: string;
  score: Score;
  /** The embellished file's own <fingering>s: on original notes only. */
  editorial: Assignment;
  inserted: InsertedNote[];
  figures: number;
  /** Measure indices whose figures the retry removed; [] when the first pass passed. */
  droppedBars: number[];
  /** The guarded fingering at each profile, as the app solves it. */
  assignments: Record<HandProfileId, Assignment>;
  melodyVoice: string;
}

export type GuardOutcome =
  { offered: Embellishment; reason: null } | { offered: null; reason: string };

/** Beginner errors: L06 and L10, which `beginner: true` raises to errors. */
const BEGINNER_RULES = new Set(['L06', 'L10']);

/** Law errors and beginner errors (L06, L10 at error severity) of one lint report. */
export function guardErrors(report: LintReport): { law: LintIssue[]; beginner: LintIssue[] } {
  const errors = report.issues.filter((i) => i.severity === 'error');
  return {
    law: errors.filter((i) => LINT_RULES[i.rule].law),
    beginner: errors.filter((i) => BEGINNER_RULES.has(i.rule)),
  };
}

const plural = (n: number) => `${n} figure${n === 1 ? '' : 's'}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Embellishes `plainXml` at light density and offers the result only when it carries at least
 * `minFigures` figures, passes the independent check, and, solved as the app solves it
 * (`solveFingering(score, { profile, weightSet })`, no level, no pins) and linted for a beginner at
 * every profile, has no law error and no more beginner errors than the plain score solved and linted
 * the same way. When it does not pass, the figures of the offending bars (the bars of the notes of
 * every law error, and of every beginner error at a profile whose beginner errors exceed the plain
 * score's) are dropped once from the figures already chosen, and the rest is checked again.
 *
 * Unreadable input (the embellisher or the engine reader throws) is refused as `unreadable input`,
 * never thrown. A throw from the solver or the lint is a bug and is not caught.
 */
export function guardEmbellishment(plainXml: string, opts: GuardOptions = {}): GuardOutcome {
  const profiles = opts.profiles ?? GUARD_PROFILES;
  const weightSet = opts.weightSet ?? RECOMMENDED_WEIGHT_SET;
  const min = opts.minFigures ?? EMBELLISH_MIN_FIGURES;
  const lint = opts.lint ?? lintFingering;
  const check = opts.check ?? checkEmbellishment;

  /** The embellishment with `dropBars` removed, or why it cannot be offered. */
  const embellish = (
    eo: EmbellishOptions,
  ): { r: EmbellishResult & { melodyVoice: string } } | { reason: string } => {
    let r: EmbellishResult;
    try {
      r = embellishMusicXml(plainXml, eo);
    } catch (e) {
      return { reason: `unreadable input: ${message(e)}` };
    }
    if (r.refusal !== null) return { reason: r.refusal };
    const voice = r.melodyVoice;
    if (voice === null) return { reason: 'no melody voice' };
    return { r: { ...r, melodyVoice: voice } };
  };
  /** The figure count and the independent check of one embellishment; null when both pass. */
  const accept = (r: EmbellishResult & { melodyVoice: string }, after: string): string | null => {
    const n = r.inserted.length;
    if (n < min) return `${plural(n)} (at least ${min})${after}`;
    let c: ReturnType<typeof checkEmbellishment>;
    try {
      c = check(plainXml, r.xml, r.inserted, r.melodyVoice);
    } catch (e) {
      // The check reads both scores with the engine reader, which can reject what the embellisher read.
      return `unreadable input: ${message(e)}`;
    }
    if (!c.ok) return `check: ${c.problems[0] ?? 'failed'}`;
    return null;
  };

  const first = embellish({});
  if ('reason' in first) return { offered: null, reason: first.reason };
  const why = accept(first.r, '');
  if (why !== null) return { offered: null, reason: why };

  let plain: Score;
  try {
    plain = parseMusicXml(plainXml).score;
  } catch (e) {
    return { offered: null, reason: `unreadable input: ${message(e)}` };
  }
  const plainBeginner = new Map<HandProfileId, number>();
  for (const profile of profiles) {
    const { assignment } = solveFingering(plain, { profile, weightSet });
    plainBeginner.set(
      profile,
      guardErrors(lint(plain, assignment, { profile, beginner: true })).beginner.length,
    );
  }

  const evaluate = (r: EmbellishResult) => {
    const parsed = parseMusicXml(r.xml);
    const { score } = parsed;
    const bar = new Map(score.notes.map((n) => [n.id, n.measureIndex]));
    const offending = new Set<number>();
    const mark = (issues: LintIssue[]) => {
      for (const i of issues) for (const id of i.noteIds) offending.add(bar.get(id)!);
    };
    const assignments = {} as Record<HandProfileId, Assignment>;
    for (const profile of profiles) {
      const { assignment } = solveFingering(score, { profile, weightSet });
      assignments[profile] = assignment;
      const { law, beginner } = guardErrors(lint(score, assignment, { profile, beginner: true }));
      mark(law);
      if (beginner.length > plainBeginner.get(profile)!) mark(beginner);
    }
    return { score, editorial: parsed.editorial, assignments, offending };
  };
  const offer = (
    r: EmbellishResult & { melodyVoice: string },
    e: ReturnType<typeof evaluate>,
    droppedBars: number[],
  ): GuardOutcome => ({
    offered: {
      xml: r.xml,
      score: e.score,
      editorial: e.editorial,
      inserted: r.inserted,
      figures: r.inserted.length,
      droppedBars,
      assignments: e.assignments,
      melodyVoice: r.melodyVoice,
    },
    reason: null,
  });

  const e1 = evaluate(first.r);
  if (e1.offending.size === 0) return offer(first.r, e1, []);

  const withFigure = new Set(first.r.inserted.map((i) => i.measureIndex));
  const drop = [...e1.offending].filter((b) => withFigure.has(b)).sort((a, b) => a - b);
  if (drop.length === 0) return { offered: null, reason: 'lint errors in bars with no figure' };
  const after = ` after dropping the figures of bars ${drop.join(', ')}`;
  const second = embellish({ dropBars: drop });
  if ('reason' in second) return { offered: null, reason: second.reason };
  const why2 = accept(second.r, after);
  if (why2 !== null) return { offered: null, reason: why2 };
  const e2 = evaluate(second.r);
  if (e2.offending.size > 0) return { offered: null, reason: `lint errors${after}` };
  return offer(second.r, e2, drop);
}
