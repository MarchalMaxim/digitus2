/**
 * The scan bar is timed, not reported: the service answers a page only once it is recognised
 * (docs/scan-service.md), so the bar guesses from the time the pages still to scan usually take
 * and fills only when the last answer arrives. One bar serves the whole batch.
 */

/** Where the bar stands when the expected time is up. */
export const EASED = 0.9;
/** What it creeps toward after that, and never reaches before the answer. */
export const CEILING = 0.97;

/**
 * How long one request usually takes on the deployed service, warm, as measured in
 * `docs/scan-service.md` (Timings); new measurements change both.
 */
export const EXPECTED_PHOTO_SECONDS = 35;
export const EXPECTED_PDF_SECONDS = 16;
/** Added while the warm-up request on arrival has not answered: the scanner may be starting. */
export const WARMUP_SECONDS = 5;

/** A file still to scan; a PDF counts its pages, because one request reads them all. */
export interface ToScan {
  file: Blob;
  /** The pages of a PDF; one when unknown. */
  pdfPages?: number;
}

/** The time one request is expected to take, in milliseconds: a photo, or 16 s per PDF page. */
export function expectedMs({ file, pdfPages = 1 }: ToScan): number {
  return file.type === 'application/pdf'
    ? EXPECTED_PDF_SECONDS * 1000 * Math.max(1, pdfPages)
    : EXPECTED_PHOTO_SECONDS * 1000;
}

/** The time the `pages` still to scan are expected to take; the warm-up adds its own seconds. */
export function expectedBatchMs(pages: readonly ToScan[], warmingUp: boolean): number {
  return (
    pages.reduce((total, page) => total + expectedMs(page), 0) +
    (warmingUp ? WARMUP_SECONDS * 1000 : 0)
  );
}

/**
 * The pages of a PDF, counted from its page objects; one when they cannot be seen (a PDF that
 * packs them into compressed object streams), which only makes the bar's guess shorter.
 */
export async function pdfPageCount(file: Blob): Promise<number> {
  try {
    const text = new TextDecoder('latin1').decode(await file.arrayBuffer());
    return Math.max(1, text.match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 1);
  } catch {
    return 1;
  }
}

/** The bar's fraction after `elapsed` ms of a stretch expected to take `expected` ms. */
export function progressAt(elapsed: number, expected: number): number {
  const x = Math.max(0, elapsed) / expected;
  // Ease-out to EASED at the expected time, then an ever slower creep toward CEILING.
  if (x <= 1) return EASED * (1 - (1 - x) ** 2);
  return EASED + (CEILING - EASED) * (1 - Math.exp(-(x - 1)));
}

/**
 * One stretch of the bar: from `since` (Date.now) it runs `expected` ms for the pages still to
 * scan, starting from the fraction `base` it had reached when the stretch began. A new stretch
 * starts at each page, so the bar never moves back and never fills before the last answer.
 * `own` is the part of `expected` that belongs to the page now on the scanner (all of it for the
 * last page): a page that runs past it creeps on only within half of what is left, so the pages
 * after it still have room to move.
 */
export interface Stretch {
  since: number;
  expected: number;
  own: number;
  base: number;
}

/** What a page overdue past its own time may still cover of what is left of its stretch. */
const OVERDUE_ROOM = 0.5;

/** The fraction of the stretch covered `elapsed` ms in. */
function stretchAt({ expected, own }: Stretch, elapsed: number): number {
  if (own >= expected || elapsed <= own) return progressAt(elapsed, expected);
  const reached = progressAt(own, expected);
  return reached + (1 - reached) * OVERDUE_ROOM * (1 - Math.exp(-(elapsed - own) / own));
}

/** The bar's fraction at `now`. */
export function barAt(stretch: Stretch, now: number): number {
  return stretch.base + (1 - stretch.base) * stretchAt(stretch, now - stretch.since);
}

/** The seconds left, rounded up to a step of five; null once the expected time is past. */
export function secondsLeft(elapsed: number, expected: number): number | null {
  const left = expected - Math.max(0, elapsed);
  if (left <= 0) return null;
  return Math.max(5, Math.ceil(left / 5000) * 5);
}
