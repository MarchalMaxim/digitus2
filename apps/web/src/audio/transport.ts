import type { Hand, Score } from '@digitus2/engine';
import type { Beat } from './beats.js';
import { buildBeats, measureEndSec, measureStartSec } from './beats.js';
import type { AudioClock } from './clock.js';
import { audibleTime } from './clock.js';
import type { Instrument } from './instrument.js';

export interface TransportDeps {
  ctx: AudioClock;
  instrument: Instrument;
  score: Score;
  click?: (time: number, accent: boolean) => void;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

export interface TransportState {
  playing: boolean;
  positionSec: number;
  tempoFactor: number;
  muted: Set<Hand>;
  metronome: boolean;
  countIn: boolean;
  loop: { from: number; to: number } | null;
}

/** A note ready to schedule: `sec` is the score time it sounds at (graces already moved earlier). */
interface PlayEvent {
  sec: number;
  duration: number;
  midi: number;
  hand: Hand;
  velocity: number;
}

/**
 * One piece of the context-time to score-time line: from context time `ctx` on, score time is
 * `score + (t - ctx) * factor`. Play and seek start a new line; a tempo change or a loop wrap
 * appends a segment where the already scheduled audio ends, so nothing scheduled moves.
 */
interface Segment {
  ctx: number;
  score: number;
  factor: number;
}

const GRACE_LEAD_SEC = 0.05;
const GRACE_DURATION_SEC = 0.1;
const MIN_DURATION_SEC = 0.05;
/**
 * The accompaniment is slightly softer than the melody. Both lie inside the piano's loaded
 * velocity layer (`PIANO_LAYER`, 85 to 100): smplr plays nothing for a velocity outside it.
 */
const VELOCITY: Record<Hand, number> = { R: 96, L: 88 };
/** Segments stay this long after they end: the audible time lags `currentTime` by the output latency. */
const SEGMENT_KEEP_SEC = 2;

function buildEvents(score: Score): PlayEvent[] {
  // Graces sharing a principal are spread before it in document order, 50 ms apart.
  const graceGroups = new Map<string, typeof score.notes>();
  for (const n of score.notes) {
    if (!n.isGrace) continue;
    const key = `${n.hand}:${n.onsetTick}`;
    const group = graceGroups.get(key);
    if (group) group.push(n);
    else graceGroups.set(key, [n]);
  }
  const graceSec = new Map<string, number>();
  for (const group of graceGroups.values()) {
    group.sort((a, b) => (a.sourceIndices[0] ?? 0) - (b.sourceIndices[0] ?? 0));
    group.forEach((n, k) => {
      graceSec.set(n.id, Math.max(0, n.onsetSec - GRACE_LEAD_SEC * (group.length - k)));
    });
  }
  const events = score.notes.map((n) => ({
    sec: graceSec.get(n.id) ?? n.onsetSec,
    duration: n.isGrace ? GRACE_DURATION_SEC : Math.max(MIN_DURATION_SEC, n.offsetSec - n.onsetSec),
    midi: n.midi,
    hand: n.hand,
    velocity: VELOCITY[n.hand],
  }));
  return events.sort((a, b) => a.sec - b.sec); // stable: simultaneous notes keep score order
}

/** Index of the first item whose `sec` is >= `sec` (items sorted by `sec`). */
function lowerBound(items: readonly { sec: number }[], sec: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid]!.sec < sec) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function toCtx(seg: Segment, sec: number): number {
  return seg.ctx + (sec - seg.score) / seg.factor;
}

/**
 * Our own look-ahead scheduler over the engine's timeline (rendering spike sections 4.2 and 8.4).
 * Every `tickMs` it schedules what falls in the next `lookAheadSec`, in half-open score windows
 * `[previous horizon, horizon)` that never overlap and never leave a gap. `step()` reads no
 * timer or wall clock, so tests drive it with a fake context.
 */
export class Transport {
  onEnd: (() => void) | null = null;

  private readonly ctx: AudioClock;
  private readonly instrument: Instrument;
  private readonly score: Score;
  private readonly click: ((time: number, accent: boolean) => void) | undefined;
  private readonly startTimer: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  private readonly stopTimer: (id: ReturnType<typeof setInterval>) => void;
  private readonly lookAheadSec: number;
  private readonly tickMs: number;
  private readonly startDelaySec: number;
  private readonly events: PlayEvent[];
  private readonly beats: Beat[];
  private readonly endSec: number;

  private playing = false;
  /** Score position while stopped. */
  private position = 0;
  private tempoFactor = 1;
  private muted = new Set<Hand>();
  private metronome = false;
  private countIn = false;
  private loop: { from: number; to: number } | null = null;
  private segments: Segment[] = [];
  /** Everything before this score time has been scheduled (the previous horizon). */
  private scheduledTo = 0;
  private countInClicks: { time: number; accent: boolean }[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    deps: TransportDeps,
    opts: { lookAheadSec?: number; tickMs?: number; startDelaySec?: number } = {},
  ) {
    this.ctx = deps.ctx;
    this.instrument = deps.instrument;
    this.score = deps.score;
    this.click = deps.click;
    // Called without a receiver: a browser timer called as a method of `deps` would throw.
    const set = deps.setInterval ?? setInterval;
    const clear = deps.clearInterval ?? clearInterval;
    this.startTimer = (fn, ms) => set(fn, ms);
    this.stopTimer = (id) => clear(id);
    this.lookAheadSec = opts.lookAheadSec ?? 0.15;
    this.tickMs = opts.tickMs ?? 25;
    this.startDelaySec = opts.startDelaySec ?? 0.05;
    this.events = buildEvents(this.score);
    this.beats = buildBeats(this.score);
    const lastMeasure = this.score.measures.length - 1;
    // A loop, not Math.max(...notes): spreading a very large score would overflow the stack.
    let endSec = lastMeasure >= 0 ? measureEndSec(this.score, lastMeasure) : 0;
    for (const n of this.score.notes) if (n.offsetSec > endSec) endSec = n.offsetSec;
    this.endSec = endSec;
  }

  get state(): TransportState {
    return {
      playing: this.playing,
      positionSec: this.positionSec(),
      tempoFactor: this.tempoFactor,
      muted: new Set(this.muted),
      metronome: this.metronome,
      countIn: this.countIn,
      loop: this.loop ? { ...this.loop } : null,
    };
  }

  play(): void {
    if (this.playing) return;
    let start = this.position >= this.endSec ? 0 : this.position;
    const range = this.loopRange();
    if (range && (start < range.from || start >= range.to)) start = range.from;
    const factor = this.tempoFactor;
    let t0 = this.ctx.currentTime + this.startDelaySec;
    this.countInClicks = [];
    if (this.countIn) {
      const m = this.measureStartingAt(start);
      if (m >= 0) {
        const from = measureStartSec(this.score, m);
        const index = this.score.measures[m]!.index;
        for (const b of this.beats) {
          if (b.measureIndex === index) {
            this.countInClicks.push({ time: t0 + (b.sec - from) / factor, accent: b.accent });
          }
        }
        t0 += (measureEndSec(this.score, m) - from) / factor;
      }
    }
    this.segments = [{ ctx: t0, score: start, factor }];
    this.scheduledTo = start;
    this.playing = true;
    this.timer = this.startTimer(() => this.step(), this.tickMs);
    this.step();
  }

  pause(): void {
    if (!this.playing) return;
    this.position = this.positionSec();
    this.halt();
    this.instrument.stopAll();
  }

  seek(sec: number): void {
    let target = Math.min(Math.max(0, sec), this.endSec);
    if (!this.playing) {
      this.position = target;
      return;
    }
    const range = this.loopRange();
    if (range && (target < range.from || target >= range.to)) target = range.from;
    this.instrument.stopAll();
    this.countInClicks = [];
    this.segments = [
      { ctx: this.ctx.currentTime + this.startDelaySec, score: target, factor: this.tempoFactor },
    ];
    this.scheduledTo = target;
    this.step();
  }

  rewind(): void {
    this.seek(0);
  }

  setTempoFactor(f: number): void {
    if (!(f > 0) || !Number.isFinite(f) || f === this.tempoFactor) return;
    this.tempoFactor = f;
    if (!this.playing) return;
    // Re-anchor where the scheduled audio ends: what is scheduled keeps its time, the next note
    // follows at the new speed, and the position runs on without a jump.
    const seg = this.current();
    this.segments.push({ ctx: toCtx(seg, this.scheduledTo), score: this.scheduledTo, factor: f });
  }

  setMuted(hands: Hand[]): void {
    this.muted = new Set(hands);
  }

  setMetronome(on: boolean): void {
    this.metronome = on;
  }

  setCountIn(on: boolean): void {
    this.countIn = on;
  }

  setLoop(range: { from: number; to: number } | null): void {
    this.loop = range ? { from: range.from, to: range.to } : null;
    if (!this.playing) return;
    const r = this.loopRange();
    if (r && (this.scheduledTo < r.from || this.scheduledTo > r.to)) this.seek(r.from);
  }

  positionSec(now?: number): number {
    if (!this.playing || this.segments.length === 0) return this.position;
    const t = audibleTime(this.ctx, now);
    let seg = this.segments[0]!;
    if (t < seg.ctx) return seg.score; // the start delay or the count-in: hold at the start
    for (const s of this.segments) {
      if (s.ctx <= t) seg = s;
      else break;
    }
    const pos = seg.score + (t - seg.ctx) * seg.factor;
    const range = this.loopRange();
    if (range && seg.score >= range.from && pos >= range.to) {
      return range.from + ((pos - range.from) % (range.to - range.from));
    }
    return Math.min(pos, this.endSec);
  }

  step(): void {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    const until = now + this.lookAheadSec;
    while (this.countInClicks.length > 0 && this.countInClicks[0]!.time < until) {
      const c = this.countInClicks.shift()!;
      this.click?.(c.time, c.accent);
    }
    const range = this.loopRange();
    let seg = this.current();
    let horizon = seg.score + (until - seg.ctx) * seg.factor;
    if (range) {
      while (horizon >= range.to) {
        this.schedule(seg, this.scheduledTo, range.to);
        seg = { ctx: toCtx(seg, range.to), score: range.from, factor: seg.factor };
        this.segments.push(seg);
        this.scheduledTo = range.from;
        horizon = seg.score + (until - seg.ctx) * seg.factor;
      }
    }
    if (horizon > this.scheduledTo) {
      this.schedule(seg, this.scheduledTo, horizon);
      this.scheduledTo = horizon;
    }
    while (this.segments.length > 1 && this.segments[1]!.ctx < now - SEGMENT_KEEP_SEC) {
      this.segments.shift();
    }
    // The end is reported when it is heard, not when it is rendered (the output latency later),
    // so a rewind on `onEnd` does not cut off the final chord.
    if (
      !range &&
      this.scheduledTo >= this.endSec &&
      audibleTime(this.ctx) >= toCtx(seg, this.endSec)
    ) {
      this.position = this.endSec;
      this.halt();
      this.onEnd?.();
    }
  }

  dispose(): void {
    this.onEnd = null;
    if (this.playing) {
      this.halt();
      this.instrument.stopAll();
    }
  }

  /** Schedules the notes and metronome beats whose score time lies in `[from, to)`. */
  private schedule(seg: Segment, from: number, to: number): void {
    if (!(to > from)) return;
    for (let i = lowerBound(this.events, from); i < this.events.length; i++) {
      const e = this.events[i]!;
      if (e.sec >= to) break;
      if (this.muted.has(e.hand)) continue;
      this.instrument.start({
        midi: e.midi,
        time: toCtx(seg, e.sec),
        duration: e.duration / seg.factor,
        velocity: e.velocity,
        hand: e.hand,
      });
    }
    if (!this.metronome || !this.click) return;
    for (let i = lowerBound(this.beats, from); i < this.beats.length; i++) {
      const b = this.beats[i]!;
      if (b.sec >= to) break;
      this.click(toCtx(seg, b.sec), b.accent);
    }
  }

  private current(): Segment {
    return this.segments[this.segments.length - 1]!;
  }

  private halt(): void {
    if (this.timer !== undefined) this.stopTimer(this.timer);
    this.timer = undefined;
    this.playing = false;
    this.segments = [];
    this.countInClicks = [];
  }

  /** The loop in score seconds, or null when there is none or it is empty. */
  private loopRange(): { from: number; to: number } | null {
    if (!this.loop || this.score.measures.length === 0) return null;
    const last = this.score.measures.length - 1;
    const a = Math.min(Math.max(0, Math.trunc(this.loop.from)), last);
    const b = Math.min(Math.max(0, Math.trunc(this.loop.to)), last);
    if (a > b) return null;
    const from = measureStartSec(this.score, a);
    const to = measureEndSec(this.score, b);
    return to > from ? { from, to } : null;
  }

  /** The index of the measure that starts at `sec`, or -1. */
  private measureStartingAt(sec: number): number {
    return this.score.measures.findIndex(
      (_, i) => Math.abs(measureStartSec(this.score, i) - sec) < 1e-6,
    );
  }
}
