import type { Messages } from '../i18n/messages.js';
import { GRAND_STAFF_WARNING, PARTLY_READ_WARNING } from './client.js';
import type { ScanScore } from './notes.js';

/**
 * What the review says in one line (issue 158), from facts the session already has: the pages,
 * the bars and staves of the joined score, the places to check, the join's refusal and the
 * scanner's warnings. It states what was read; it never judges how well.
 */
export interface VerdictFacts {
  /**
   * The pages in reading order, each with its own warnings. Absent for a PDF, whose page count the
   * scan does not know and whose warnings name no page.
   */
  pages?: readonly { warnings?: readonly string[] | undefined }[] | undefined;
  /** Every warning of the scan. */
  warnings: readonly string[];
  /** False when the pages did not join into one score. */
  joined: boolean;
  /** The joined score as corrected; absent when it cannot be read. */
  score?: ScanScore | undefined;
  /** The places to check in that score. */
  problems: number;
}

export type Verdict =
  /** The pages did not join: each is shown on its own. */
  | { kind: 'notJoined' }
  /** Pages the scanner read as one staff, so the hands are mixed; none named when it did not say. */
  | { kind: 'oneStaff'; pages: number[] }
  /** Pages with a line read only in part, so bars are missing or added. */
  | { kind: 'partlyRead'; pages: number[] }
  | {
      kind: 'read';
      pages: number | undefined;
      bars: number | undefined;
      /** Both hands only when a part has two staves; absent when the score does not say. */
      hands: 'both' | 'single' | undefined;
      places: number;
    };

/** True for a verdict that points back at the scan: the next step is to scan again. */
export const blocks = (verdict: Verdict) => verdict.kind !== 'read';

const flagged = (facts: VerdictFacts, warning: string): number[] =>
  (facts.pages ?? []).flatMap((page, index) =>
    page.warnings?.includes(warning) ? [index + 1] : [],
  );

/** Bars are counted once: a page read as two parts has the same bars in each. */
const barsOf = (score: ScanScore) =>
  score.bars.length ? Math.max(...score.bars.map((bar) => bar.index)) + 1 : undefined;

function handsOf(score: ScanScore): 'both' | 'single' | undefined {
  const staves = new Map<number, number>();
  for (const note of score.notes)
    staves.set(note.part, Math.max(staves.get(note.part) ?? 1, note.staves));
  if ([...staves.values()].some((n) => n >= 2)) return 'both';
  // One part of one staff is a single line of music; several one-staff parts are not claimed.
  return staves.size === 1 ? 'single' : undefined;
}

export function verdict(facts: VerdictFacts): Verdict {
  if (!facts.joined) return { kind: 'notJoined' };
  if (facts.warnings.includes(GRAND_STAFF_WARNING))
    return { kind: 'oneStaff', pages: flagged(facts, GRAND_STAFF_WARNING) };
  if (facts.warnings.includes(PARTLY_READ_WARNING))
    return { kind: 'partlyRead', pages: flagged(facts, PARTLY_READ_WARNING) };
  return {
    kind: 'read',
    pages: facts.pages?.length,
    bars: facts.score && barsOf(facts.score),
    hands: facts.score && handsOf(facts.score),
    places: facts.problems,
  };
}

/** The verdict in the language on screen: the facts joined by dots, or one sentence and its action. */
export function verdictText(t: Messages, v: Verdict): string {
  const say = t.scan.verdict;
  switch (v.kind) {
    case 'notJoined':
      return say.notJoined;
    case 'oneStaff':
      return say.readAsOneStaff(v.pages);
    case 'partlyRead':
      return say.readInPart(v.pages);
    case 'read':
      return say.facts(
        [
          v.pages === undefined ? '' : say.pages(v.pages),
          v.bars === undefined ? '' : say.bars(v.bars),
          v.hands === 'both' ? say.bothHands : v.hands === 'single' ? say.oneStaff : '',
          v.places > 0 ? t.scan.edit.problemsSummary(v.places) : '',
        ].filter(Boolean),
      );
  }
}
