import { durationMs, prefersReducedMotion } from '../design/motion.js';
import { HOLD_TOLERANCE } from './playAlong.js';

/**
 * The level of a key held on the reader's own piano (issue 185): how much of its note's written
 * length has passed since the press, 0 to 1, drawn as a fill that rises inside the key. The
 * arithmetic is pure; the store at the end holds the levels on show and is static and small: its
 * only side effect is one timer per key that is draining. `usePlayAlong` writes it, the keyboard
 * reads it (score/useKeyLevels.ts moves the rectangles frame by frame without React).
 */

/** One key's level. Times are performance.now ms; lengths are real ms at the tempo. */
export interface KeyLevel {
  /** The key's own press. */
  atMs: number;
  /** The note's written length at the tempo. */
  lengthMs: number;
  /** The note's length in beats of the time signature (the metronome's beat); see `levelAt`. */
  beats: number;
  /** Set when the key was let go before full: the drain starts here, from `fromLevel`. */
  upMs: number | null;
  fromLevel: number;
  drainMs: number;
}
export type KeyLevels = ReadonlyMap<number, KeyLevel>;
export const NO_LEVELS: KeyLevels = new Map();

/** Float noise in `f * beats` (a dotted quarter at one beat) must not cost a step. */
const STEP_SLACK = 1e-9;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * The level at `nowMs`, 0 to 1. Rising, it is the fraction of the note's length passed. Under
 * reduced motion it steps a beat at a time instead, `floor(f * beats) / beats`, and a note of one
 * beat or less shows nothing until its end. Being a fraction of the real length, the stepping
 * needs no tempo. A level let go before full drains linearly from where it was; reduced motion
 * gives that no branch of its own, as its `drainMs` is then 0.
 */
export function levelAt(l: KeyLevel, nowMs: number, reduced: boolean): number {
  if (l.upMs !== null) {
    if (!(l.drainMs > 0)) return 0;
    return l.fromLevel * clamp01(1 - (nowMs - l.upMs) / l.drainMs);
  }
  if (!(l.lengthMs > 0)) return 1;
  const f = clamp01((nowMs - l.atMs) / l.lengthMs);
  if (!reduced || f >= 1) return f;
  if (l.beats <= 1) return 0;
  return Math.floor(f * l.beats + STEP_SLACK) / l.beats;
}

/** Whether the level still changes after `nowMs`: rising below 1, or draining. */
export function moving(l: KeyLevel, nowMs: number, reduced: boolean): boolean {
  if (l.upMs !== null) return l.drainMs > 0 && l.fromLevel > 0 && nowMs < l.upMs + l.drainMs;
  return levelAt(l, nowMs, reduced) < 1;
}

/**
 * The level's rectangle on a key, in the keyboard's units: the held bar's x, width and radius,
 * and a bottom on the bar's bottom edge. At any level above 0 it is at least the bar high, and it
 * grows to the key's top inset (3 on a white key, 2 on a black one) at level 1. At level 0 it has
 * no height, so nothing is drawn.
 */
export function levelRect(
  black: boolean,
  bar: { x: number; y: number; width: number; height: number },
  level: number,
): { x: number; y: number; width: number; height: number; rx: number } {
  const inset = black ? 2 : 3;
  const bottom = bar.y + bar.height;
  const l = clamp01(level);
  const height = l > 0 ? bar.height + (bottom - inset - bar.height) * l : 0;
  return { x: bar.x, y: bottom - height, width: bar.width, height, rx: 1 };
}

export interface LevelStore {
  subscribe(listener: () => void): () => void;
  /** The same map until a level is added, released or removed. */
  get(): KeyLevels;
  /** A key's level starts (or starts again, replacing a drain). */
  start(midi: number, level: Omit<KeyLevel, 'upMs' | 'fromLevel' | 'drainMs'>): void;
  /**
   * The key is let go at `nowMs`: a release at `HOLD_TOLERANCE` of the note's real length or later
   * goes now, with no drain (issue 195); an earlier one drains from where it is, or goes now when
   * drainMs is 0.
   */
  release(midi: number, nowMs: number): void;
  /** Every level goes at once (an external move, the walk inactive). */
  clear(): void;
  /** Cancels the drain timers (unmount). */
  dispose(): void;
}

/**
 * The store of the levels on show. Its methods use no `this`, so they can be handed to
 * `useSyncExternalStore` as they are. `drainMs` defaults to the `--dur-slow` token (0 under
 * reduced motion, like the CSS) and `reduced` to the media query; a test passes both.
 */
export function createLevelStore(
  o: { drainMs?: () => number; reduced?: () => boolean } = {},
): LevelStore {
  const drainOf = o.drainMs ?? (() => durationMs('--dur-slow'));
  const isReduced = o.reduced ?? prefersReducedMotion;
  let levels: KeyLevels = NO_LEVELS;
  const listeners = new Set<() => void>();
  /** The deletion of each draining level. */
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  const publish = (next: KeyLevels): void => {
    levels = next;
    for (const listener of [...listeners]) listener();
  };
  const without = (midi: number): KeyLevels => {
    const next = new Map(levels);
    next.delete(midi);
    return next;
  };
  const stopTimer = (midi: number): void => {
    clearTimeout(timers.get(midi));
    timers.delete(midi);
  };
  const stopTimers = (): void => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get: () => levels,
    start(midi, level) {
      stopTimer(midi);
      publish(new Map(levels).set(midi, { ...level, upMs: null, fromLevel: 0, drainMs: 0 }));
    },
    release(midi, nowMs) {
      const l = levels.get(midi);
      // No level, or already draining (a key comes up once): nothing changes.
      if (!l || l.upMs !== null) return;
      // The release the levels forgive: judged on the real fraction of the note, not the stepped
      // level of reduced motion.
      const held = l.lengthMs > 0 ? (nowMs - l.atMs) / l.lengthMs : 1;
      if (held >= HOLD_TOLERANCE) {
        stopTimer(midi);
        publish(without(midi));
        return;
      }
      const fromLevel = levelAt(l, nowMs, isReduced());
      const drainMs = drainOf();
      if (fromLevel >= 1 || fromLevel <= 0 || !(drainMs > 0)) {
        publish(without(midi));
        return;
      }
      const draining: KeyLevel = { ...l, upMs: nowMs, fromLevel, drainMs };
      publish(new Map(levels).set(midi, draining));
      timers.set(
        midi,
        setTimeout(() => {
          timers.delete(midi);
          if (levels.get(midi) === draining) publish(without(midi));
        }, drainMs),
      );
    },
    clear() {
      stopTimers();
      if (levels.size > 0) publish(NO_LEVELS);
    },
    dispose: stopTimers,
  };
}
