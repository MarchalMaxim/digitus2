import type { Messages } from '../i18n/messages.js';
import { GRAND_STAFF_WARNING, PARTLY_READ_WARNING, UNKNOWN_WARNING } from './client.js';
import { GRAPHIC_SPAN_WARNING, PAIRED_STAVES_WARNING } from './join.js';

/**
 * The scanner's own sentences (research/omr/prototypes/local-worker: homr.py and
 * normalize_export.py), kept in a saved scan as they came. The review writes what they say in the
 * language on screen (issue 230): the scanner's disclaimers are not shown, its export notes add up
 * over the pages to one line each, and a sentence the app does not know is shown as it is.
 */
const DISCLAIMERS = [
  'Photo recognition is experimental. Compare the recognized notes with the source before using fingerings.',
  'Missing key or time signatures may be inferred. Confirm them against the complete score.',
];
const NORMALIZED = /^The worker adjusted the export without changing any note: (.*)\.$/;
const STAFF_REGIONS =
  /^Recognition excluded (\d+) possible auxiliary staff regions and masked (\d+) nearby staff regions\./;

export function reviewWarnings(t: Messages, warnings: readonly string[]): string[] {
  const lines: string[] = [];
  let tied = 0;
  let merged = 0;
  let omitted = 0;
  for (const warning of warnings) {
    if (DISCLAIMERS.includes(warning)) continue;
    const normalized = NORMALIZED.exec(warning);
    if (normalized) {
      for (const done of normalized[1]!.split('; ')) {
        const n = Number(/^(\d+) /.exec(done)?.[1] ?? 0);
        if (/\bslurs?\b/.test(done)) tied += n;
        else if (/\bempty measures?\b/.test(done)) merged += n;
      }
      continue;
    }
    const regions = STAFF_REGIONS.exec(warning);
    if (regions) {
      omitted += Number(regions[1]) + Number(regions[2]);
      continue;
    }
    lines.push(
      warning === GRAPHIC_SPAN_WARNING
        ? t.scan.review.graphicSpanWarning
        : warning === UNKNOWN_WARNING
          ? t.scan.review.unknownWarning
          : warning === GRAND_STAFF_WARNING
            ? t.scan.review.grandStaffWarning
            : warning === PAIRED_STAVES_WARNING
              ? t.scan.review.pairedStavesNote
              : warning === PARTLY_READ_WARNING
                ? t.scan.review.partlyReadWarning
                : warning,
    );
  }
  if (tied) lines.push(t.scan.review.tiesFromSlurs(tied));
  if (merged) lines.push(t.scan.review.emptyBarsJoined(merged));
  if (omitted) lines.push(t.scan.review.staffRegionsOmitted(omitted));
  return lines;
}
