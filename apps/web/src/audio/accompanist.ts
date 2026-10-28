import type { AudioClock } from './clock.js';
import type { AccNote, Instrument, NoteEvent } from './instrument.js';

export interface AccompanistDeps {
  ctx: AudioClock;
  instrument: Instrument;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  /**
   * A note still in the queue was dropped by a new stretch or a stop: it never reached the
   * instrument. The test hooks log it beside the stops of the notes that did (usePlayback.ts).
   */
  onDrop?: ((e: NoteEvent) => void) | undefined;
}

/** A note handed to the instrument, with the stop that is its own. */
interface Handed {
  end: number;
  time: number;
  stop: () => void;
}

/**
 * The other hand (issue 184): a just-in-time queue over the instrument. Notes enter the
 * instrument only within `lookAheadSec` of their time (150 ms, under smplr's own 200 ms queue,
 * which `stopAll` does not clear), each keeping its own stop, so a note that has not started can
 * be cancelled without touching a note of the same pitch that sounds. The timer runs only while
 * the queue holds notes. `step()` reads no timer or wall clock, so tests drive it with a fake
 * context. It never calls `stopAll`: that would cut the transport's notes and a struck key too.
 */
export class Accompanist {
  private readonly ctx: AudioClock;
  private readonly instrument: Instrument;
  private readonly startTimer: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  private readonly stopTimer: (id: ReturnType<typeof setInterval>) => void;
  private readonly onDrop: ((e: NoteEvent) => void) | undefined;
  private readonly lookAheadSec: number;
  private readonly tickMs: number;
  /** Not handed over yet, ascending by `time`. */
  private queue: NoteEvent[] = [];
  /** Handed over and not known to be over, ascending by `time`. */
  private handed: Handed[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(deps: AccompanistDeps, opts: { lookAheadSec?: number; tickMs?: number } = {}) {
    this.ctx = deps.ctx;
    this.instrument = deps.instrument;
    // Called without a receiver: a browser timer called as a method of `deps` would throw.
    const set = deps.setInterval ?? setInterval;
    const clear = deps.clearInterval ?? clearInterval;
    this.startTimer = (fn, ms) => set(fn, ms);
    this.stopTimer = (id) => clear(id);
    this.onDrop = deps.onDrop;
    this.lookAheadSec = opts.lookAheadSec ?? 0.15;
    this.tickMs = opts.tickMs ?? 25;
  }

  /**
   * A new stretch from now: clears the queue, cancels each handed note whose time is after
   * `ctx.currentTime` (sounding ones ring), queues `notes` at `currentTime + offsetSec / factor`
   * for `durationSec / factor`, and hands over at once what falls within the look-ahead.
   */
  play(notes: readonly AccNote[], tempoFactor: number): void {
    const now = this.ctx.currentTime;
    this.dropQueue();
    this.forgetOver(now);
    const keep: Handed[] = [];
    for (const h of this.handed) {
      if (h.time > now) h.stop();
      else keep.push(h);
    }
    this.handed = keep;
    const factor = tempoFactor > 0 ? tempoFactor : 1;
    this.queue = notes
      .map((n) => ({
        midi: n.midi,
        time: now + Math.max(0, n.offsetSec) / factor,
        duration: n.durationSec / factor,
        velocity: n.velocity,
        hand: n.hand,
      }))
      .sort((a, b) => a.time - b.time); // stable: simultaneous notes keep their order
    this.step();
  }

  /** Clears the queue, cancels what has not started and releases what sounds. Idempotent. */
  stop(): void {
    this.dropQueue();
    this.forgetOver(this.ctx.currentTime);
    const handed = this.handed;
    this.handed = [];
    for (const h of handed) h.stop();
    this.clearTimer();
  }

  /** The tick: hands over the queued notes due within the look-ahead. */
  step(): void {
    const now = this.ctx.currentTime;
    this.forgetOver(now);
    const horizon = now + this.lookAheadSec;
    let due = 0;
    while (due < this.queue.length && this.queue[due]!.time < horizon) due++;
    for (const e of this.queue.splice(0, due)) {
      this.handed.push({ end: e.time + e.duration, time: e.time, stop: this.instrument.start(e) });
    }
    if (this.queue.length === 0) this.clearTimer();
    else if (this.timer === undefined) this.timer = this.startTimer(() => this.step(), this.tickMs);
  }

  /** How many notes wait in the queue (tests). */
  pending(): number {
    return this.queue.length;
  }

  /** stop() and the timer gone. */
  dispose(): void {
    this.stop();
  }

  /** Empties the queue: the notes in it never reach the instrument. */
  private dropQueue(): void {
    const dropped = this.queue;
    this.queue = [];
    if (this.onDrop) for (const e of dropped) this.onDrop(e);
  }

  /** A handed note is forgotten once its time and duration have passed. */
  private forgetOver(now: number): void {
    if (this.handed.some((h) => h.end <= now)) this.handed = this.handed.filter((h) => h.end > now);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.stopTimer(this.timer);
    this.timer = undefined;
  }
}
