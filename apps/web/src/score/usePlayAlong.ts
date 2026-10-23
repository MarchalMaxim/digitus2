/**
 * Playing along on the reader's own piano (issue 182): the glue between the piano store
 * (midi/piano.ts) and `Playback`. While a piano is connected and the score is stopped, the red
 * waits on the next step to play (playAlong.ts); when the reader holds every pitch of it, the
 * red moves on, and at the end of the piece the transport's own finish runs. The walk moves the
 * red only through `Playback.cueAt` and `Playback.finish`, in performance seconds, so a repeat is
 * walked as it is heard and the cursor, the page turn, the keys with their fingers and the plain
 * Play button are all the existing cue (useCursor.ts, Transport.tsx). The app makes no sound.
 *
 * The walk is active only when it can own the red: the piano is on and connected, the score is
 * ready and playable, it has a step, and nothing plays or loads. It moves the red only while no
 * flight or hop is on screen (`flightShown`), so there are never two reds: its align step is a
 * passive effect, which runs after the layout effects of RedFlight, EndBurst and the carry of
 * "Add notes between" in the same commit (ScoreView declares this hook after them).
 *
 * Presses are bookkept in `keysRef` (each held key with whether its press is still fresh). A move
 * the walk did not make (a seek, Rewind, a loop or hands change, a new score, Play then Pause,
 * the piano connecting) uses every held key up: the hook recognises its own moves because it
 * remembers the performance second it left the playback at (`atRef`).
 */
import type { Hand, Score } from '@digitus2/engine';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../app/store.js';
import { performanceFor } from '../audio/performance.js';
import { heldPitches, subscribeNotes, usePianoSnapshot } from '../midi/piano.js';
import type { NoteMessage } from '../midi/types.js';
import {
  ALONG_EPS,
  NO_KEYS,
  advance,
  alongSteps,
  anchorStep,
  pressKey,
  releaseKey,
  spendAll,
  type AlongStep,
  type Keys,
  type PerfRange,
} from './playAlong.js';
import type { Playback } from './usePlayback.js';

export interface PlayAlongOptions {
  score: Score | null;
  /** `doc.status === 'ready'`. */
  ready: boolean;
  playable: boolean;
  playback: Playback;
  mutedHands: readonly Hand[];
  /** useCursor's `currentGroup`: >= 0 when a group is marked. */
  currentGroup: number;
  /** `red.redAway`: a flight or hop is on screen; the walk does not move meanwhile. */
  flightShown: boolean;
}

export interface PlayAlong {
  /** The piano is connected and the red is the walk's: stopped, ready, playable, with steps. */
  active: boolean;
  /** Active and the red waits on the piece's first step (Rewind has nowhere to go). */
  atFirst: boolean;
  /** The status line's hint: the current step's pitch count, or null when it is not shown. */
  hint: number | null;
}

/** What the Playwright check reads (installed only with `?audio=silent`). */
interface AlongHook {
  /**
   * The pitches of the step the red waits on; none when the walk is not active, and none while
   * the playback is cued anywhere else (a seek or the finish, until the walk cues the next step).
   */
  target(): number[];
  /** The index of that step among the steps of the hands played, -1 when none. */
  index(): number;
}

/** The latest render's view of the options, read by the note subscription and the align. */
interface Live {
  active: boolean;
  flightShown: boolean;
  playback: Playback;
  steps: readonly AlongStep[];
  currentGroup: number;
}

const NO_STEPS: AlongStep[] = [];

function applyNote(keys: Keys, e: NoteMessage): Keys {
  return e.on ? pressKey(keys, e.midi) : releaseKey(keys, e.midi);
}

/** A loop stretch as a comparable string: the playback hands out a new object on each call. */
function stretchKey(loop: PerfRange | null): string {
  return loop ? `${loop.from}:${loop.to}` : '';
}

function isSilentRun(): boolean {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('audio') === 'silent'
  );
}

export function usePlayAlong({
  score,
  ready,
  playable,
  playback,
  mutedHands,
  currentGroup,
  flightShown,
}: PlayAlongOptions): PlayAlong {
  const setting = useAppStore((s) => s.settings.playAlong);
  const piano = usePianoSnapshot();
  const connected = setting && piano.status === 'connected';
  const { playing, loading, atStart, cue, loop } = playback;
  const marked = currentGroup >= 0;

  // What there is to play, made only for a reader who has a piano connected. The list of hands
  // is rebuilt from its key, as useCursor does, so a new array of the same hands changes nothing.
  const muteKey = [...new Set(mutedHands)].sort().join(',');
  const steps = useMemo(
    () =>
      connected && score
        ? alongSteps(performanceFor(score), muteKey ? (muteKey.split(',') as Hand[]) : [])
        : NO_STEPS,
    [connected, score, muteKey],
  );
  const active = connected && ready && playable && steps.length > 0 && !playing && !loading;

  /** The index of the step the red waits on, -1 when none: state, so the render can read it. */
  const [index, setIndex] = useState(-1);
  /** Steps played in this view: the hint goes after the first pass and does not come back. */
  const [played, setPlayed] = useState(0);

  const liveRef = useRef<Live>({ active, flightShown, playback, steps, currentGroup });
  useLayoutEffect(() => {
    liveRef.current = { active, flightShown, playback, steps, currentGroup };
  });
  const keysRef = useRef<Keys>(NO_KEYS);
  /** The performance second the walk left the playback at; null while it is not walking. */
  const atRef = useRef<number | null>(null);
  /** The steps and the loop stretch that `atRef` was set against. */
  const stepsAtRef = useRef<readonly AlongStep[] | null>(null);
  const loopAtRef = useRef('');
  const indexRef = useRef(-1);
  /**
   * The walk finished the piece and the red is not home yet: the position went to the top at once,
   * but the render that shows it (`atStart`, no cue) and the red's flight home come later, and
   * until the align looks again a frame after, the playback this hook last saw is the one of
   * before the finish. A key pressed in that gap is kept for the first step and moves nothing.
   */
  const homeRef = useRef(false);

  /**
   * One procedure for a note and for the align (`event` null): spends the held keys on an
   * external move, applies the event, and when the walk may move, passes the steps the keys
   * play. Reads everything from refs and the synchronous getters of the playback.
   */
  const decide = useCallback((event: NoteMessage | null) => {
    const o = liveRef.current;
    const pb = o.playback;
    if (!o.active) {
      // Not walking (playing, loading, no piano): the presses are kept, the walk starts afresh.
      atRef.current = null;
      homeRef.current = false;
      indexRef.current = -1;
      setIndex(-1);
      if (event) keysRef.current = applyNote(keysRef.current, event);
      return;
    }
    const start = pb.startPerformanceSec();
    const stretch = pb.performanceLoop();
    let keys = keysRef.current;
    const moved =
      atRef.current === null ||
      Math.abs(start - atRef.current) > ALONG_EPS ||
      stepsAtRef.current !== o.steps ||
      loopAtRef.current !== stretchKey(stretch);
    if (moved) {
      keys = spendAll(keys);
      atRef.current = start;
      stepsAtRef.current = o.steps;
      loopAtRef.current = stretchKey(stretch);
    }
    if (event) keys = applyNote(keys, event);
    keysRef.current = keys;
    // A release passes no step; a press during a flight or hop is kept and counts once it lands.
    if (event && !event.on) return;
    if (homeRef.current || o.flightShown || pb.playingNow()) return;

    // Paused after a note was heard, the group the cursor marks is the step; otherwise the next
    // step at or after where Play starts (a bar may start with a rest in the hands played).
    const mode = pb.cue === null && !pb.atStart && o.currentGroup >= 0 ? 'marked' : 'next';
    const here = anchorStep(o.steps, start, stretch, mode);
    if (here < 0) {
      indexRef.current = -1;
      setIndex(-1);
      return;
    }
    const result = advance(o.steps, here, keys, stretch);
    keysRef.current = result.keys;
    if (result.passed > 0) setPlayed((n) => n + result.passed);
    if (result.move.kind === 'finish') {
      pb.finish();
      homeRef.current = true;
      atRef.current = 0;
      loopAtRef.current = stretchKey(pb.performanceLoop());
      indexRef.current = -1;
      setIndex(-1);
      return;
    }
    const to = result.move.kind === 'cue' ? result.move.index : here;
    const perfSec = o.steps[to]!.perfSec;
    // Cued there already: the playback says so (a cue, at that second, and the position is where
    // Play starts: a loop that moves the start away from the position leaves the cursor marking
    // nothing). A cue the playback lost since (the halt of StrictMode's second look at a mount)
    // is made again; the same cue made twice changes nothing.
    const placed =
      pb.cue !== null &&
      Math.abs(start - perfSec) <= ALONG_EPS &&
      Math.abs(pb.positionSec() - pb.startSec()) <= ALONG_EPS;
    if (!placed) pb.cueAt(perfSec);
    atRef.current = perfSec;
    loopAtRef.current = stretchKey(pb.performanceLoop());
    indexRef.current = to;
    setIndex(to);
  }, []);

  // The keys held when the view opens are not presses for the step in front of it.
  useEffect(() => {
    keysRef.current = new Map(heldPitches().map((midi) => [midi, false] as const));
    return subscribeNotes((event) => decide(event));
  }, [decide]);

  // Align: puts the red on the step the position calls for. Idempotent: it calls `cueAt` only
  // when the playback is not cued there, so a second run makes no call (StrictMode's second look
  // at a mount finds the playback halted, and cues again). When Rewind, the finish or the end of the piece takes the
  // position home (`atStart` turns true), the red's flight home is planned in a layout effect of
  // this very commit and only shows in the next render, which this effect runs before: look
  // again a frame later (also the reduced-motion case: Play is red for one frame).
  const atStartWasRef = useRef(atStart);
  useEffect(() => {
    const home = atStart && !atStartWasRef.current;
    atStartWasRef.current = atStart;
    if (!home || !active) {
      // A position that is home already (no flight to wait for, or the flight is on screen and
      // the walk waits for it by `flightShown`) is not the gap of a finish.
      if (atStart) homeRef.current = false;
      decide(null);
      return;
    }
    const frame = requestAnimationFrame(() => {
      homeRef.current = false;
      decide(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [decide, active, flightShown, playing, loading, atStart, cue, loop, steps, marked]);

  // Playwright's check: the pitches of the step the red waits on.
  useEffect(() => {
    if (!isSilentRun()) return;
    const w = window as unknown as { __digitus2Along?: AlongHook };
    const hook: AlongHook = {
      target: () => {
        // Only a step the playback is cued at: right after a seek, a hands or loop change or the
        // finish, the index still names the step of before until the align puts the red on the
        // next one, and a check that played those pitches would play nothing.
        const o = liveRef.current;
        const step = o.active ? o.steps[indexRef.current] : undefined;
        if (!step || o.playback.cue === null) return [];
        const here = Math.abs(o.playback.startPerformanceSec() - step.perfSec) <= ALONG_EPS;
        return here ? [...step.pitches] : [];
      },
      index: () => indexRef.current,
    };
    w.__digitus2Along = hook;
    return () => {
      if (w.__digitus2Along === hook) delete w.__digitus2Along;
    };
  }, []);

  // The step the red is on is the one the walk last left the playback at, and only while the
  // playback is still cued there: a seek that hops (the walk waits for the flight) moves the cue
  // at once, and until the hop lands the red is not on the step the walk last named.
  const step = active && index >= 0 ? steps[index] : undefined;
  const cuedHere =
    step !== undefined &&
    cue !== null &&
    !atStart &&
    Math.abs(playback.startPerformanceSec() - step.perfSec) <= ALONG_EPS;
  return useMemo(
    () => ({
      active,
      atFirst: cuedHere && index === 0,
      hint: cuedHere && step && played === 0 ? step.pitches.length : null,
    }),
    [active, cuedHere, index, step, played],
  );
}
