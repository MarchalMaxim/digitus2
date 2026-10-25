/**
 * Where the transport is, as the listener hears it (issue 192): the pass of the run and the
 * performance second, never clamped or folded, so a press in the count-in reads before the pass
 * start and a press just before a loop wrap reads past the loop's end of the pass in force.
 */
export interface HeardAt {
  pass: number;
  perfSec: number;
  /** The tempo factor of the segment in force. */
  factor: number;
}

/**
 * One pass of a run of Play, in performance seconds: from Play, a seek, a resync or a loop wrap,
 * to the next of those, the stop or the end. `toSec` is null while the pass is still being heard.
 */
export interface PassSpan {
  pass: number;
  fromSec: number;
  toSec: number | null;
  /** True when it ended by a loop wrap (the next pass follows on without a gap). */
  wrapped: boolean;
  /**
   * True when play() scheduled count-in clicks before it; a wrap carries it on to the next pass,
   * and a seek or a resync starts a pass with it false. Without a count-in the reader reacts to
   * the first sound, so the first beat of such a pass judges no lateness.
   */
  countedIn: boolean;
}
