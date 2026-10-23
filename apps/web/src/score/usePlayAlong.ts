/**
 * Playing along on the reader's own piano (issue 182): the glue between the piano store
 * (midi/piano.ts) and `Playback`. While a piano is connected and the score is stopped, the red
 * waits on the next step to play (playAlong.ts); when the reader holds every pitch of it, the
 * red moves on, and at the end of the piece the transport's own finish runs. The walk moves the
 * red only through `Playback.cueAt` and `Playback.finish`, in performance seconds, so a repeat is
 * walked as it is heard and the cursor, the page turn, the keys with their fingers and the plain
 * Play button are all the existing cue (useCursor.ts, Transport.tsx). The app makes no sound for
 * the reader's notes: nothing here strikes a key.
 *
 * With one hand left out (the Practice panel's Hands), digitus plays that hand (issue 184): after
 * each pass the walk hands `Playback.accompany` the other hand's notes from the step the reader
 * played to the next step the walk waits on (accompaniment.ts), counted from the press. It stops
 * them (`Playback.stopAccompaniment`) on every move it did not make itself, and when it goes
 * inactive; its own cue and finish leave the tail of the piece sounding.
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
import { playEventsFor, type PlayEvent } from '../audio/events.js';
import { performanceFor, scoreEndSec } from '../audio/performance.js';
import { heldPitches, subscribeNotes, usePianoSnapshot } from '../midi/piano.js';
import type { NoteMessage } from '../midi/types.js';
import { accompanimentNotes, accompanimentStretches } from './accompaniment.js';
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
  /** Active, digitus plays a hand, and the browser waits for a click to sound it (issue 184). */
  soundWaits: boolean;
}

/** What the Playwright check reads (installed with `?audio=silent` or `?hooks=1`). */
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
  /** What digitus plays: null when the reader plays both hands (or no piano is connected). */
  accompaniment: Accompaniment | null;
}

/** The other hand's notes and the performance's end, made once per score and hands (issue 184). */
interface Accompaniment {
  /** The hands digitus plays: the hands left out of the walk. */
  hands: readonly Hand[];
  events: readonly PlayEvent[];
  endSec: number;
}

const NO_STEPS: AlongStep[] = [];

function applyNote(keys: Keys, e: NoteMessage): Keys {
  return e.on ? pressKey(keys, e.midi) : releaseKey(keys, e.midi);
}

/** A loop stretch as a comparable string: the playback hands out a new object on each call. */
function stretchKey(loop: PerfRange | null): string {
  return loop ? `${loop.from}:${loop.to}` : '';
}

/** The Playwright hooks are on: `?audio=silent` (the silent instrument) or `?hooks=1` (the real one). */
function hooksOn(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('audio') === 'silent' || params.get('hooks') === '1';
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
  // The other hand's notes (issue 184): only for a reader whose piano is connected and who left a
  // hand out. The events are the transport's own, so the hand sounds as it does in Play.
  const accompaniment = useMemo<Accompaniment | null>(() => {
    if (!connected || !score || muteKey === '') return null;
    const perf = performanceFor(score);
    return {
      hands: muteKey.split(',') as Hand[],
      events: playEventsFor(perf.score),
      endSec: scoreEndSec(perf.score),
    };
  }, [connected, score, muteKey]);

  /** The index of the step the red waits on, -1 when none: state, so the render can read it. */
  const [index, setIndex] = useState(-1);
  /** Steps played in this view: the hint goes after the first pass and does not come back. */
  const [played, setPlayed] = useState(0);

  const liveRef = useRef<Live>({
    active,
    flightShown,
    playback,
    steps,
    currentGroup,
    accompaniment,
  });
  useLayoutEffect(() => {
    liveRef.current = { active, flightShown, playback, steps, currentGroup, accompaniment };
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
   * The walk handed the playback notes since it last stopped them: it only stops what it started,
   * so an idle walk calls nothing.
   */
  const accompaniedRef = useRef(false);

  /**
   * One procedure for a note and for the align (`event` null): spends the held keys on an
   * external move, applies the event, and when the walk may move, passes the steps the keys
   * play. Reads everything from refs and the synchronous getters of the playback.
   */
  const decide = useCallback((event: NoteMessage | null) => {
    const o = liveRef.current;
    const pb = o.playback;
    /** Stops what the walk had digitus play: the queue, the notes not started, the ones that ring. */
    const stopAccompaniment = () => {
      accompaniedRef.current = false;
      pb.stopAccompaniment();
    };
    if (!o.active) {
      // Not walking (playing, loading, no piano): the presses are kept, the walk starts afresh.
      // The other hand stops too (Play stops it in its own click; the rest end here).
      if (accompaniedRef.current) stopAccompaniment();
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
      // A move the walk did not make (a seek, Rewind, a loop or hands change, Play then Pause):
      // the stretch that was sounding no longer leads to where the red is. The walk's own moves
      // (its cue, its finish) leave `atRef` where they put the playback, so they land here never.
      if (atRef.current !== null) stopAccompaniment();
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
    if (result.passed > 0) {
      setPlayed((n) => n + result.passed);
      // Digitus plays the other hand from the last step the reader played to the next one the
      // walk waits on, counted from this press; what the stretch before left unstarted is dropped
      // (an empty stretch drops it too). Before the cue or the finish, which do not stop it.
      const plan = o.accompaniment;
      if (plan) {
        const stretches = accompanimentStretches(
          o.steps,
          result.last,
          result.move,
          stretch,
          plan.endSec,
        );
        accompaniedRef.current = true;
        pb.accompany(accompanimentNotes(plan.events, plan.hands, stretches, stretch));
      }
    }
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

  // Digitus plays the hand the reader left out (issue 184): its samples load before any press,
  // with no gesture, while the walk is active (`prepare` is once per score and never turns the
  // walk off). The view being left stops what still sounds; the playback stops it too.
  const accompanying = active && accompaniment !== null;
  const { prepare } = playback;
  useEffect(() => {
    if (accompanying) prepare();
  }, [accompanying, prepare, score]);
  useEffect(
    () => () => {
      accompaniedRef.current = false;
      liveRef.current.playback.stopAccompaniment();
    },
    [],
  );

  // Playwright's check: the pitches of the step the red waits on.
  useEffect(() => {
    if (!hooksOn()) return;
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
  const soundWaits = accompanying && playback.soundWaits;
  return useMemo(
    () => ({
      active,
      atFirst: cuedHere && index === 0,
      hint: cuedHere && step && played === 0 ? step.pitches.length : null,
      soundWaits,
    }),
    [active, cuedHere, index, step, played, soundWaits],
  );
}
