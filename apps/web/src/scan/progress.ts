/**
 * The scan bar is timed, not reported: the service answers a page only once it is recognised
 * (docs/scan-service.md), so the bar guesses from the page's expected time (client.ts) and fills
 * only when the answer arrives.
 */

/** Where the bar stands when the expected time is up. */
export const EASED = 0.9;
/** What it creeps toward after that, and never reaches before the answer. */
export const CEILING = 0.97;

/** The bar's fraction after `elapsed` ms of a page expected to take `expected` ms. */
export function progressAt(elapsed: number, expected: number): number {
  const x = Math.max(0, elapsed) / expected;
  // Ease-out to EASED at the expected time, then an ever slower creep toward CEILING.
  if (x <= 1) return EASED * (1 - (1 - x) ** 2);
  return EASED + (CEILING - EASED) * (1 - Math.exp(-(x - 1)));
}

/** The seconds left, rounded up to a step of five; null once the expected time is past. */
export function secondsLeft(elapsed: number, expected: number): number | null {
  const left = expected - Math.max(0, elapsed);
  if (left <= 0) return null;
  return Math.max(5, Math.ceil(left / 5000) * 5);
}
