/** The part of an AudioContext the clock needs (a plain object in tests). */
export interface AudioClock {
  currentTime: number;
  getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number };
}

/**
 * The context time that is leaving the speakers right now, in context seconds.
 *
 * `ctx.currentTime` runs ahead of what the listener hears by the device output latency (40 ms on
 * the spike machine, 150 to 250 ms over Bluetooth), so the cursor is clocked from
 * `getOutputTimestamp()`: the context time that was audible at `performanceTime`, advanced to
 * `now`. Without a usable timestamp (older browsers, or Chromium's `{ 0, 0 }` before output
 * starts) it falls back to `currentTime`. The result never exceeds `currentTime`: nothing can be
 * heard before it is rendered, and extrapolating a stale timestamp (a suspended context) would
 * otherwise run ahead.
 */
export function audibleTime(ctx: AudioClock, now = performance.now()): number {
  const ts = ctx.getOutputTimestamp?.();
  if (
    ts &&
    typeof ts.contextTime === 'number' &&
    typeof ts.performanceTime === 'number' &&
    ts.performanceTime > 0
  ) {
    return Math.min(ctx.currentTime, ts.contextTime + (now - ts.performanceTime) / 1000);
  }
  return ctx.currentTime;
}
