import type { Hand, Score } from '@digitus2/engine';
import type { Beat } from './beats.js';
import { buildBeats, countInBar, measureStartSec } from './beats.js';
import type { AudioClock } from './clock.js';
import { audibleTime } from './clock.js';
import { playEvents, type PlayEvent } from './events.js';
import type { Instrument } from './instrument.js';
import {
  performanceLoop,
  performanceOf,
  scoreEndSec,
  toPerformanceSec,
  toWrittenSec,
  type Performance,
} from './performance.js';

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

/** A scheduled note as a lead-in waits for it: its hand, and the context time its onset is heard. */
interface HeardNote {
  ctx: number;
  hand: Hand;
}

const MAX_TEMPO_DEFERRAL_SEC = 0.25;
/** Segments stay this long after they end: the audible time lags `currentTime` by the output latency. */
const SEGMENT_KEEP_SEC = 2;

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
 * It plays the score in the order it is heard (repeats and jumps expanded, `performanceOf`), and
 * every time inside it is a time in that performance. Its public positions and `seek` speak of
 * the written score, so the cursor, a click on a bar and the arrow keys go back with the music.
 * Every `tickMs` it schedules what falls in the next `lookAheadSec`, in half-open score windows
 * `[previous horizon, horizon)` that never overlap and never leave a gap. `step()` reads no
 * timer or wall clock, so tests drive it with a fake context.
 */
export class Transport {
  onEnd: (() => void) | null = null;
  /**
   * The count-in has reached click `beatIndex` (0-based) of `beats`, which falls on beat
   * `beatInBar` of its bar (from 1: before a 3/4 pickup the clicks are beats 1 and 2, and before
   * a three-beat pickup in 4/4, beats 1 2 3 4 1). Click 0 is reported by play() itself as the
   * count-in starts (its sound follows within the start delay); each later one when the listener
   * hears it (the audible time, `audibleTime`, reaches it), checked on every scheduler tick. The
   * status line counts `beatInBar`.
   */
  onCountInBeat: ((beatIndex: number, beats: number, beatInBar: number) => void) | null = null;
  /**
   * The count-in is over, reported once: the start position is being heard (checked on every
   * scheduler tick; what sounds there may be a rest, or a note of a muted hand), or a seek or a
   * pause cut the count-in short. The status line stops counting.
   */
  onCountInEnd: (() => void) | null = null;
  /**
   * The lead-in started (true) or ended (false). A lead-in runs from play(), or a seek while
   * playing, until the first note of a hand that is not muted is heard: the start delay, the
   * count-in, and whatever comes before that note (a rest, the muted hand's pickup). A loop wrap
   * to a start where the hands played have no note starts one too, when the wrap is heard, until
   * their first note of the new pass is heard. The playback cursor marks nothing meanwhile, so no
   * note is marked before it sounds. play() and a seek report the start themselves (a seek
   * during a lead-in starts no second one); a wrap's start is reported on the scheduler tick that
   * hears the wrap (`leadingIn()` knows it at once). The end is reported when a note scheduled
   * since the start, in a hand still not muted, is heard (checked on every scheduler tick), or
   * when a pause or the end of the piece stops playback. With no such note to come (the hands
   * played rest for the whole loop) the lead-in lasts until playback stops.
   */
  onLeadInChange: ((leadingIn: boolean) => void) | null = null;

  private readonly ctx: AudioClock;
  private readonly instrument: Instrument;
  private readonly perf: Performance;
  private readonly click: ((time: number, accent: boolean) => void) | undefined;
  private readonly startTimer: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  private readonly stopTimer: (id: ReturnType<typeof setInterval>) => void;
  private readonly lookAheadSec: number;
  private readonly tickMs: number;
  private readonly startDelaySec: number;
  private readonly events: PlayEvent[];
  private readonly beats: Beat[];
  private readonly endSec: number;
  /** The end of the written score: a seek may go to any bar, including one the order never ends on. */
  private readonly writtenEndSec: number;

  private playing = false;
  /** Score position while stopped. */
  private position = 0;
  private tempoFactor = 1;
  private muted = new Set<Hand>();
  private metronome = false;
  private countIn = false;
  private loop: { from: number; to: number } | null = null;
  /** The stretch of the performance the loop plays, fixed when the loop is set (`setLoop`). */
  private loopPerf: { from: number; to: number } | null = null;
  private segments: Segment[] = [];
  /** Everything before this score time has been scheduled (the previous horizon). */
  private scheduledTo = 0;
  /** The count-in clicks still to schedule. */
  private countInClicks: { time: number; accent: boolean }[] = [];
  /**
   * The running count-in's clicks (context times and beats in the bar; empty when none runs) and
   * the last reported.
   */
  private countInBeats: { time: number; beatInBar: number }[] = [];
  private countInBeat = -1;
  /**
   * The running lead-in (null when none runs): the notes scheduled since it started, each with its
   * hand and the context time its onset is heard at. It ends when one in a hand still not muted is
   * heard (a note scheduled before its hand was muted sounds, but the cursor does not mark it).
   */
  private leadIn: HeardNote[] | null = null;
  /**
   * The loop wraps scheduled but not yet heard, in order: the context time each new pass starts
   * at, and the notes scheduled in that pass so far (`followWraps`).
   */
  private wraps: { ctx: number; notes: HeardNote[] }[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    deps: TransportDeps,
    opts: { lookAheadSec?: number; tickMs?: number; startDelaySec?: number } = {},
  ) {
    this.ctx = deps.ctx;
    this.instrument = deps.instrument;
    this.perf = performanceOf(deps.score);
    this.click = deps.click;
    // Called without a receiver: a browser timer called as a method of `deps` would throw.
    const set = deps.setInterval ?? setInterval;
    const clear = deps.clearInterval ?? clearInterval;
    this.startTimer = (fn, ms) => set(fn, ms);
    this.stopTimer = (id) => clear(id);
    this.lookAheadSec = opts.lookAheadSec ?? 0.15;
    this.tickMs = opts.tickMs ?? 25;
    this.startDelaySec = opts.startDelaySec ?? 0.05;
    this.events = playEvents(this.perf.score);
    this.beats = buildBeats(this.perf.score);
    this.endSec = scoreEndSec(this.perf.score);
    this.writtenEndSec = scoreEndSec(deps.score);
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

  /**
   * Where play() starts, in written score seconds, read while stopped: the position (the top once
   * it has reached the end), or the loop's start when the position lies outside the loop. The
   * paused cursor compares it with the position: only a position Play resumes from is marked.
   */
  startSec(): number {
    return toWrittenSec(this.perf, this.performanceStartSec());
  }

  /**
   * Where play() starts, in performance seconds: `startSec` in the order heard. The play-along
   * keeps its place in these (issue 182): a written second cannot tell the hearings of a repeated
   * bar apart.
   */
  performanceStartSec(): number {
    const start = this.position >= this.endSec ? 0 : this.position;
    const range = this.performanceLoop();
    return range && (start < range.from || start >= range.to) ? range.from : start;
  }

  /**
   * Plays from `startSec()`. `leadSec` holds the start back for that long when it is longer than
   * the start delay: the score view's red travels from Play to the first note meanwhile, and the
   * note sounds as it lands (useRedFlight.ts). A count-in starts after it too. `countIn: false`
   * plays without one whatever the setting: a play carried across "Add notes between" (issue
   * #67) goes on as the music did.
   */
  play(opts: { leadSec?: number; countIn?: boolean } = {}): void {
    if (this.playing) return;
    const start = this.performanceStartSec();
    const factor = this.tempoFactor;
    let t0 = this.ctx.currentTime + Math.max(this.startDelaySec, opts.leadSec ?? 0);
    this.countInClicks = [];
    this.countInBeats = [];
    if (opts.countIn ?? this.countIn) {
      // The count-in, on the bar grid: a whole bar, or before a pickup the beats before it.
      const m = this.measureStartingAt(start);
      if (m >= 0) {
        const bar = countInBar(this.perf.score, this.beats, m);
        for (const c of bar.clicks) {
          const time = t0 + c.offsetSec / factor;
          this.countInClicks.push({ time, accent: c.accent });
          this.countInBeats.push({ time, beatInBar: c.beatInBar });
        }
        t0 += bar.lengthSec / factor;
      }
    }
    this.segments = [{ ctx: t0, score: start, factor }];
    this.scheduledTo = start;
    this.wraps = [];
    this.playing = true;
    this.timer = this.startTimer(() => this.step(), this.tickMs);
    const first = this.countInBeats[0];
    if (first) {
      this.countInBeat = 0;
      this.onCountInBeat?.(0, this.countInBeats.length, first.beatInBar);
    }
    this.startLeadIn();
    this.step();
  }

  pause(): void {
    if (!this.playing) return;
    this.position = this.perfPositionSec();
    this.halt();
    this.instrument.stopAll();
  }

  /**
   * Moves the position to `sec`, in written score seconds. A bar heard twice is entered at its
   * next hearing going forward in the written score, at its last hearing going back
   * (`toPerformanceSec`). Stopped, that is where play() starts. Playing, the music goes on from
   * there after a lead-in; `leadSec` holds it back for that long when it is longer than the start
   * delay: the score view's red hops to the new place meanwhile, and the music comes in as it
   * lands (RedFlight.tsx).
   */
  seek(sec: number, opts: { leadSec?: number } = {}): void {
    const written = Math.min(Math.max(0, sec), this.writtenEndSec);
    const near = this.playing ? this.perfPositionSec() : this.performanceStartSec();
    this.seekPerformance(toPerformanceSec(this.perf, written, near), opts);
  }

  /**
   * `seek` to a performance second, the order heard: each hearing of a repeated bar has its own.
   * Stopped, that is where play() starts. Playing, as `seek`.
   */
  seekPerformance(perfSec: number, opts: { leadSec?: number } = {}): void {
    let target = Math.min(Math.max(0, perfSec), this.endSec);
    if (!this.playing) {
      this.position = target;
      return;
    }
    const range = this.performanceLoop();
    if (range && (target < range.from || target >= range.to)) target = range.from;
    this.instrument.stopAll();
    this.countInClicks = [];
    this.endCountIn(); // a seek cuts the count-in short: the music starts at the target now
    const delay = Math.max(this.startDelaySec, opts.leadSec ?? 0);
    this.segments = [
      { ctx: this.ctx.currentTime + delay, score: target, factor: this.tempoFactor },
    ];
    this.scheduledTo = target;
    this.wraps = []; // the wraps scheduled before the seek will not sound
    this.startLeadIn(); // nothing scheduled sounds any more: wait for the target's first note
    this.step();
  }

  rewind(): void {
    this.seekPerformance(0);
  }

  setTempoFactor(f: number): void {
    if (!(f > 0) || !Number.isFinite(f) || f === this.tempoFactor) return;
    this.tempoFactor = f;
    if (!this.playing) return;
    // Never split an already scheduled ornament attack. The next attack must meet its release
    // at the same clock time as the keyboard's phase change. Interleaved grids may have no
    // shared edge soon: cap responsiveness at 250 ms, then use a seek and rearticulate holds.
    const seg = this.current();
    const loopEnd = this.performanceLoop()?.to ?? Infinity;
    const limit =
      seg.score + (this.ctx.currentTime + MAX_TEMPO_DEFERRAL_SEC - seg.ctx) * seg.factor;
    let boundary = this.scheduledTo;
    for (let i = lowerBound(this.events, seg.score); i < this.events.length; i++) {
      const event = this.events[i]!;
      if (event.sec >= boundary) break;
      if (this.muted.has(event.hand)) continue;
      if (event.ornamentEnd !== undefined && event.ornamentEnd > boundary) {
        boundary = Math.min(event.ornamentEnd, loopEnd);
        if (boundary > limit) {
          this.resyncTempo();
          return;
        }
      }
    }
    this.schedule(seg, this.scheduledTo, boundary);
    this.scheduledTo = boundary;
    this.segments.push({ ctx: toCtx(seg, this.scheduledTo), score: this.scheduledTo, factor: f });
  }

  /** Rare off-grid fallback: a brief rearticulation is preferable to a long stale tempo. */
  private resyncTempo(): void {
    const position = this.perfPositionSec();
    this.seekPerformance(position);
    const seg = this.current();
    const end = this.performanceLoop()?.to ?? Infinity;
    for (const event of this.events) {
      if (event.sec >= position) break;
      const offset = Math.min(event.sec + event.duration, end);
      if (offset <= position || this.muted.has(event.hand)) continue;
      this.instrument.start({
        midi: event.midi,
        hand: event.hand,
        velocity: event.velocity,
        time: seg.ctx,
        duration: (offset - position) / seg.factor,
      });
      this.leadIn?.push({ ctx: seg.ctx, hand: event.hand });
    }
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
    // A bar heard twice makes several stretches: the one the music is in, else the first.
    const near = this.playing
      ? this.perfPositionSec()
      : this.position >= this.endSec
        ? 0
        : this.position;
    this.loopPerf = performanceLoop(this.perf, this.loop, near);
    if (!this.playing) return;
    const r = this.performanceLoop();
    if (r && (this.scheduledTo < r.from || this.scheduledTo > r.to)) this.seekPerformance(r.from);
  }

  /** The written second the music is at (`now` as in `audibleTime`). */
  positionSec(now?: number): number {
    return toWrittenSec(this.perf, this.perfPositionSec(now));
  }

  /** `positionSec` in performance seconds. */
  private perfPositionSec(now?: number): number {
    if (!this.playing || this.segments.length === 0) return this.position;
    const t = audibleTime(this.ctx, now);
    let seg = this.segments[0]!;
    if (t < seg.ctx) return seg.score; // the start delay or the count-in: hold at the start
    for (const s of this.segments) {
      if (s.ctx <= t) seg = s;
      else break;
    }
    const pos = seg.score + (t - seg.ctx) * seg.factor;
    const range = this.performanceLoop();
    if (range && seg.score >= range.from && pos >= range.to) {
      return range.from + ((pos - range.from) % (range.to - range.from));
    }
    return Math.min(pos, this.endSec);
  }

  /**
   * Whether a lead-in runs at the audible time now (`now` as in `audibleTime`): the playback
   * cursor asks on every frame. It is the lead-in `onLeadInChange` reports, and also, from the
   * moment it is heard, a loop wrap's lead-in that the next scheduler tick will report: until
   * that tick the cursor keeps what it marks rather than mark a note of the new pass early.
   */
  leadingIn(now?: number): boolean {
    if (!this.playing) return false;
    return this.leadIn !== null || this.wrapLeadIn(audibleTime(this.ctx, now)) !== null;
  }

  /**
   * How long until the running lead-in ends, in seconds from the audible time now (`now` as in
   * `audibleTime`): until the first note of a hand not muted, at or after where this pass started,
   * is heard. Null when no lead-in runs (stopped, or the music is under way) or no such note is
   * left. The score view starts the red's flight from Play this long before that note sounds
   * (useRedFlight.ts).
   */
  leadInRemainingSec(now?: number): number | null {
    if (!this.playing || this.leadIn === null || this.segments.length === 0) return null;
    const first = this.segments[0]!;
    for (let i = lowerBound(this.events, first.score); i < this.events.length; i++) {
      const e = this.events[i]!;
      if (this.muted.has(e.hand)) continue;
      // The segment in force at the note: the last one that starts at or before it.
      let seg = first;
      for (const s of this.segments) if (s.ctx >= seg.ctx && s.score <= e.onset) seg = s;
      return Math.max(0, toCtx(seg, e.onset) - audibleTime(this.ctx, now));
    }
    return null;
  }

  step(): void {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    const until = now + this.lookAheadSec;
    while (this.countInClicks.length > 0 && this.countInClicks[0]!.time < until) {
      const c = this.countInClicks.shift()!;
      this.click?.(c.time, c.accent);
    }
    const range = this.performanceLoop();
    let seg = this.current();
    let horizon = seg.score + (until - seg.ctx) * seg.factor;
    if (range) {
      while (horizon >= range.to) {
        this.schedule(seg, this.scheduledTo, range.to);
        seg = { ctx: toCtx(seg, range.to), score: range.from, factor: seg.factor };
        this.segments.push(seg);
        this.wraps.push({ ctx: seg.ctx, notes: [] }); // the new pass collects its notes
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
    this.followCountIn();
    // The lead-in first: a note heard before a wrap ends it, then the wrap may start a new one.
    this.followLeadIn();
    this.followWraps();
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
    this.onCountInBeat = null;
    this.onCountInEnd = null;
    this.onLeadInChange = null;
    if (this.playing) {
      this.halt();
      this.instrument.stopAll();
    }
  }

  /** Schedules the notes and metronome beats whose score time lies in `[from, to)`. */
  private schedule(seg: Segment, from: number, to: number): void {
    if (!(to > from)) return;
    const loopEnd = this.performanceLoop()?.to ?? Infinity;
    for (let i = lowerBound(this.events, from); i < this.events.length; i++) {
      const e = this.events[i]!;
      if (e.sec >= to) break;
      if (this.muted.has(e.hand)) continue;
      this.instrument.start({
        midi: e.midi,
        time: toCtx(seg, e.sec),
        duration: Math.min(e.duration, loopEnd - e.sec) / seg.factor,
        velocity: e.velocity,
        hand: e.hand,
      });
      const note = { ctx: toCtx(seg, e.onset), hand: e.hand };
      this.leadIn?.push(note);
      this.wraps[this.wraps.length - 1]?.notes.push(note);
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
    this.wraps = [];
    this.endCountIn();
    this.endLeadIn();
  }

  /**
   * Reports the count-in beat the listener hears now when it is a new one, and the count-in's end
   * once the start position (the start of the first segment) is heard. Several beats passed in one
   * tick (a stalled timer) report only the latest.
   */
  private followCountIn(): void {
    const beats = this.countInBeats.length;
    if (beats === 0) return;
    const heard = audibleTime(this.ctx);
    if (heard >= this.segments[0]!.ctx) {
      this.endCountIn();
      return;
    }
    let beat = this.countInBeat;
    while (beat + 1 < beats && this.countInBeats[beat + 1]!.time <= heard) beat++;
    if (beat === this.countInBeat) return;
    this.countInBeat = beat;
    this.onCountInBeat?.(beat, beats, this.countInBeats[beat]!.beatInBar);
  }

  /** Ends a running count-in and reports it; does nothing when none runs. */
  private endCountIn(): void {
    if (this.countInBeats.length === 0) return;
    this.countInBeats = [];
    this.countInBeat = -1;
    this.onCountInEnd?.();
  }

  /** Starts a lead-in with nothing scheduled yet; reports it unless one already runs. */
  private startLeadIn(): void {
    const running = this.leadIn !== null;
    this.leadIn = [];
    if (!running) this.onLeadInChange?.(true);
  }

  /**
   * Ends the lead-in once a note it waits for, in a hand that is still not muted, is heard. The
   * notes heard in a hand muted since they were scheduled are dropped.
   */
  private followLeadIn(): void {
    const waiting = this.leadIn;
    if (!waiting || waiting.length === 0) return;
    const heard = audibleTime(this.ctx);
    if (waiting.some((n) => n.ctx <= heard && !this.muted.has(n.hand))) {
      this.endLeadIn();
      return;
    }
    this.leadIn = waiting.filter((n) => n.ctx > heard);
  }

  /** Ends a running lead-in and reports it; does nothing when none runs. */
  private endLeadIn(): void {
    if (this.leadIn === null) return;
    this.leadIn = null;
    this.onLeadInChange?.(false);
  }

  /**
   * The lead-in a loop wrap heard by `heard` starts, as the notes it waits for, or null when there
   * is none: no wrap heard yet, a lead-in already runs (it collects the notes itself), or a note
   * of a hand still not muted has been heard since the latest heard wrap (the pass starts with
   * one, or it came before this check), which the cursor can mark. Notes scheduled for later
   * passes are waited for too, for when the hands played rest for the rest of this one.
   */
  private wrapLeadIn(heard: number): HeardNote[] | null {
    const k = this.lastWrapHeard(heard);
    if (k < 0 || this.leadIn !== null) return null;
    const notes = this.wraps.slice(k).flatMap((w) => w.notes);
    if (notes.some((n) => n.ctx <= heard && !this.muted.has(n.hand))) return null;
    return notes.filter((n) => n.ctx > heard);
  }

  /** The index in `wraps` of the latest wrap heard by `heard`, or -1. */
  private lastWrapHeard(heard: number): number {
    let k = -1;
    while (k + 1 < this.wraps.length && this.wraps[k + 1]!.ctx <= heard) k++;
    return k;
  }

  /**
   * Starts a lead-in when a loop wrap is heard and the hands played have no note at the new
   * pass's start (`wrapLeadIn`), and forgets the wraps that have been heard.
   */
  private followWraps(): void {
    const heard = audibleTime(this.ctx);
    const waitFor = this.wrapLeadIn(heard);
    this.wraps = this.wraps.slice(this.lastWrapHeard(heard) + 1);
    if (waitFor === null) return;
    this.leadIn = waitFor;
    this.onLeadInChange?.(true);
  }

  /**
   * The loop's stretch of the performance, in performance seconds, fixed when the loop is set
   * (`setLoop`); null when there is no loop or it is empty. Read-only.
   */
  performanceLoop(): { from: number; to: number } | null {
    return this.loopPerf;
  }

  /** The index of the measure that starts at `sec`, or -1. */
  private measureStartingAt(sec: number): number {
    return this.perf.score.measures.findIndex(
      (_, i) => Math.abs(measureStartSec(this.perf.score, i) - sec) < 1e-6,
    );
  }
}
