/**
 * Playing along on the reader's own piano (issues 182 and 204): the glue between the piano store
 * (midi/piano.ts) and `Playback`. While a piano is connected, Practice mode is on and the score is
 * stopped, the red waits on the next step to play (playAlong.ts). When the reader presses every
 * pitch of it, the red moves on at that press (issue 204); at the end of the piece the
 * transport's own finish runs. The walk moves the red only through `Playback.cueAt` and
 * `Playback.finish`, in performance seconds, so a repeat is walked as it is heard and the cursor,
 * the page turn, the keys with their fingers and the plain Play button are all the existing cue
 * (useCursor.ts, Transport.tsx). The app makes no sound for the reader's notes: nothing here
 * strikes a key. Nothing in the walk waits on time: there is no timer.
 *
 * With one hand left out (the Practice panel's Hands) and the reader's `Hear the left hand` or
 * `Hear the right hand` switch on (issue 231; it is off until they turn it on), digitus plays that
 * hand (issue 184): every look that passes a step hands `Playback.accompany` the other hand's notes
 * from the last step passed to the next step of the walk (accompaniment.ts, a lazy chunk with the
 * Accompanist, fetched when the switch is on), from that moment. It stops them
 * (`Playback.stopAccompaniment`) on every move it did not make itself, when the switch goes off,
 * and when it goes inactive; its own cue and finish leave the tail of the piece sounding.
 *
 * A pass whose gap to the next step is longer than a felt beat makes a halo (halo.ts), a ring that
 * closes in on the cued note over that time. The render hands it to useAlongHalo.ts only while the
 * playback is cued at its step, in the steps and loop it was made for, with no flight on screen.
 *
 * The walk is active only when it can own the red: the piano is on and connected and Practice
 * mode is on (issue 191; off, the score page is as with no piano and the piano stays connected),
 * the score is ready and playable, it has a step, and nothing plays or loads. It moves the red
 * only while no flight or hop is on screen (`flightShown`), so there are never two reds: its
 * align step is a passive effect, which runs after the layout effects of RedFlight, EndBurst and
 * the carry of "Add notes between" in the same commit (ScoreView declares this hook after them).
 * A press made under a flight or hop is kept and passes when it lands, counted from then; a
 * flight ends the halo.
 *
 * Presses are bookkept in `keysRef` (each held key with whether its press is still fresh) and
 * `pressesRef` (when each went down, in performance.now milliseconds, taken as the message
 * arrives). A move the walk did not make (a seek, Rewind, a loop or hands change, a new score,
 * Play then Pause, the piano connecting) uses every held key up: the hook recognises its own
 * moves because it remembers the performance second it left the playback at (`atRef`).
 *
 * The keys the step asks for, and the next step's, fill over their note's length in `levels`
 * (keyLevels.ts), a store that PianoKeyboard reads: a level rising re-renders nothing here.
 */
import type { Hand, Score } from '@digitus2/engine';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tempoFactorOf, useAppStore } from '../app/store.js';
import type { PlayEvent } from '../audio/events.js';
import { performanceFor, scoreEndSec } from '../audio/performance.js';
import {
  heldPitches,
  restartBrowser,
  subscribeNotes,
  usePianoHeard,
  usePianoSnapshot,
} from '../midi/piano.js';
import type { NoteMessage } from '../midi/types.js';
import { haloFor, type Halo } from './halo.js';
import { createLevelStore, type LevelStore } from './keyLevels.js';
import { loadOtherHand, otherHandLoaded, type OtherHand } from './otherHandLoad.js';
import {
  ALONG_EPS,
  NO_KEYS,
  NO_PRESSES,
  advance,
  alongPlanNotes,
  anchorStep,
  liftAt,
  loopSpan,
  pressAt,
  pressKey,
  releaseKey,
  spendAll,
  stepAfter,
  type AlongStep,
  type Keys,
  type PassedRun,
  type PerfRange,
  type Presses,
  type StepNotes,
  type StepTime,
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
  /**
   * Issue 192: told of each look that passed steps, and of each break in the walk's own sequence
   * (a move it did not make, going inactive, unmount). Read only: the walk never waits on it, and
   * the listener catches its own errors.
   */
  onTiming?: (e: WalkTimingEvent) => void;
}

/**
 * The status line's hint while the red waits (issue 182): shown until the first step is played.
 * `count` is the step's pitch count. `unheard`: no note has come from the piano yet, so the line
 * says it is not heard (issue 252); `restart`, then, the browser whose restart cures a Bluetooth
 * piano on Windows (`restartBrowser`).
 */
export interface AlongHint {
  count: number;
  unheard?: true;
  restart?: 'Chrome' | 'Edge';
}

/**
 * What the walk tells its timing (issue 192, useWalkTiming.ts). `settled`: the steps passed in one
 * look, each from the start of its run; `at`, the step the red is on after it (-1 on the finish);
 * `finished`, the piece's last step passed. `break`: the walk's sequence broke (a move it did not
 * make, inactive, unmount).
 */
export type WalkTimingEvent =
  | { kind: 'settled'; runs: readonly PassedRun[]; at: number; finished: boolean }
  | { kind: 'break' };

export interface PlayAlong {
  /** The piano is connected, Practice mode is on and the red is the walk's: stopped, ready, playable, with steps. */
  active: boolean;
  /**
   * The setting is on and the piano is connected, whatever Practice mode says: the Practice panel
   * shows its switch while this holds (issue 191).
   */
  pianoConnected: boolean;
  /**
   * Active and the red waits on the walk's first step (Rewind has nowhere to go): the piece's
   * first, or the loop's first when a loop is set (issue 196).
   */
  atFirst: boolean;
  /** The status line's hint, or null when it is not shown. */
  hint: AlongHint | null;
  /** The levels of the held keys (issue 185): the same store for the life of the hook. */
  levels: LevelStore;
  /** Active, digitus plays a hand, and the browser waits for a click to sound it (issue 184). */
  soundWaits: boolean;
  /**
   * The halo to draw around the cued step's note (issue 204), or null: only while the playback is
   * cued at its step, in the steps and loop it was made for, with no flight on screen. Drawn by
   * useAlongHalo.ts; it may already be over (`haloProgress` says so).
   */
  halo: Halo | null;
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
  /**
   * The whole length in real ms of the halo of the step `target()` names (issue 204), while the
   * clock is inside it; 0 when there is none or it is over.
   */
  halo(): number;
}

/** The latest render's view of the options, read by the note subscription and the align. */
interface Live {
  active: boolean;
  flightShown: boolean;
  playback: Playback;
  steps: readonly AlongStep[];
  times: readonly StepTime[];
  /** Each step's note ids and felt beat, aligned with `steps` (the halo reads the beat). */
  notes: readonly StepNotes[];
  /** The open piece's Practice tempo: real seconds = performance seconds / factor. */
  factor: number;
  currentGroup: number;
  /** What digitus plays: null when the reader plays both hands (or no piano is connected). */
  accompaniment: Accompaniment | null;
}

/** The other hand's notes and the performance's end, made once per score and hands (issue 184). */
interface Accompaniment {
  /** The lazy chunk that chooses the stretches and the notes (otherHand.ts), already in. */
  code: OtherHand;
  /** The hands digitus plays: the hands left out of the walk. */
  hands: readonly Hand[];
  events: readonly PlayEvent[];
  endSec: number;
}

/** The halo the last pass made, with the steps and loop it was made against (issue 204). */
interface HaloShown {
  halo: Halo;
  steps: readonly AlongStep[];
  /** `stretchKey` of the loop at the pass. */
  loop: string;
}

const NO_STEPS: AlongStep[] = [];
const NO_TIMES: StepTime[] = [];
const NO_NOTES: StepNotes[] = [];
const NO_PLAN = { steps: NO_STEPS, times: NO_TIMES, notes: NO_NOTES };

/** A key goes down or comes up, at `nowMs`: in the keys, and in the times they went down. */
function applyNote(
  held: { keys: Keys; presses: Presses },
  e: NoteMessage,
  nowMs: number,
): { keys: Keys; presses: Presses } {
  return e.on
    ? { keys: pressKey(held.keys, e.midi), presses: pressAt(held.presses, e.midi, nowMs) }
    : { keys: releaseKey(held.keys, e.midi), presses: liftAt(held.presses, e.midi) };
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
  onTiming,
}: PlayAlongOptions): PlayAlong {
  const setting = useAppStore((s) => s.settings.playAlong);
  const practiceMode = useAppStore((s) => s.settings.practiceMode);
  const hearOtherHand = useAppStore((s) => s.settings.hearOtherHand);
  const factor = useAppStore(tempoFactorOf);
  const piano = usePianoSnapshot();
  // Listed is not heard (issue 252): the walk waits as ever, and the hint says so until a note.
  const heard = usePianoHeard();
  const pianoNames = piano.names;
  const connected = setting && piano.status === 'connected';
  // The one gate (issue 191): with Practice mode off the walk is as with no piano, and nothing
  // else changes; the piano stays connected and its keys are still drawn.
  const walking = connected && practiceMode;
  const { playing, loading, atStart, cue, loop } = playback;
  const marked = currentGroup >= 0;

  // What there is to play, made only for a reader who has a piano connected. The list of hands
  // is rebuilt from its key, as useCursor does, so a new array of the same hands changes nothing.
  const muteKey = [...new Set(mutedHands)].sort().join(',');
  const { steps, times, notes } = useMemo(
    () =>
      walking && score
        ? alongPlanNotes(performanceFor(score), muteKey ? (muteKey.split(',') as Hand[]) : [])
        : NO_PLAN,
    [walking, score, muteKey],
  );
  const active = walking && ready && playable && steps.length > 0 && !playing && !loading;
  // The other hand's notes (issue 184): only for a reader whose piano is connected, who left a
  // hand out and turned the switch on (issue 231). Its code is a lazy chunk (otherHand.ts), asked
  // for here as soon as it is wanted; until it is in, there is no plan and nothing is handed over
  // or prepared, and a chunk that does not come leaves the walk working without the other hand
  // (turning the switch off and on asks again). The events are the transport's own, so the hand
  // sounds as it does in Play.
  const wantsOtherHand = walking && hearOtherHand && score !== null && muteKey !== '';
  const [code, setCode] = useState<OtherHand | null>(otherHandLoaded);
  useEffect(() => {
    if (!wantsOtherHand || code) return;
    let live = true;
    loadOtherHand().then(
      (loaded) => {
        if (live) setCode(loaded);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [wantsOtherHand, code]);
  const accompaniment = useMemo<Accompaniment | null>(() => {
    if (!wantsOtherHand || !code) return null;
    const perf = performanceFor(score);
    return {
      code,
      hands: muteKey.split(',') as Hand[],
      events: code.playEventsFor(perf.score),
      endSec: scoreEndSec(perf.score),
    };
  }, [wantsOtherHand, code, score, muteKey]);

  /** The index of the step the red waits on, -1 when none: state, so the render can read it. */
  const [index, setIndex] = useState(-1);
  /** Steps played in this view: the hint goes after the first pass and does not come back. */
  const [played, setPlayed] = useState(0);
  /** The levels of the held keys: made once, written here and read by PianoKeyboard. */
  const [levels] = useState(() => createLevelStore());
  /** The halo of the last pass (issue 204): state, so the render hands it to the drawing. */
  const [haloShown, setHaloShown] = useState<HaloShown | null>(null);
  const haloRef = useRef<HaloShown | null>(null);

  const liveRef = useRef<Live>({
    active,
    flightShown,
    playback,
    steps,
    times,
    notes,
    factor,
    currentGroup,
    accompaniment,
  });
  useLayoutEffect(() => {
    liveRef.current = {
      active,
      flightShown,
      playback,
      steps,
      times,
      notes,
      factor,
      currentGroup,
      accompaniment,
    };
  });
  const keysRef = useRef<Keys>(NO_KEYS);
  /** When each held key went down (performance.now ms). */
  const pressesRef = useRef<Presses>(NO_PRESSES);
  /** The performance second the walk left the playback at; null while it is not walking. */
  const atRef = useRef<number | null>(null);
  /** The steps and the loop stretch that `atRef` was set against. */
  const stepsAtRef = useRef<readonly AlongStep[] | null>(null);
  const loopAtRef = useRef('');
  const indexRef = useRef(-1);
  /** The timing's listener (issue 192): the latest `onTiming`, called where the walk passes or breaks. */
  const onTimingRef = useRef(onTiming);
  useLayoutEffect(() => {
    onTimingRef.current = onTiming;
  });
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

  /** Each state is set only on a change, so a note that changes nothing renders nothing. */
  const moveIndex = useCallback((to: number) => {
    if (indexRef.current === to) return;
    indexRef.current = to;
    setIndex(to);
  }, []);
  const showHalo = useCallback((next: HaloShown | null) => {
    if (haloRef.current === next) return;
    haloRef.current = next;
    setHaloShown(next);
  }, []);

  /**
   * One procedure for a note and for the align (`event` null): spends the held keys on an
   * external move, applies the event, and when the walk may move, passes the steps the keys play,
   * at the press (issue 204). Reads everything from refs and the synchronous getters of the
   * playback. A key let go never stays held: it leaves the books at every exit.
   */
  const decide = useCallback(
    function decide(event: NoteMessage | null) {
      const o = liveRef.current;
      const pb = o.playback;
      const now = performance.now();
      /** Stops what the walk had digitus play: the queue, the notes not started, the ones that ring. */
      const stopAccompaniment = () => {
        accompaniedRef.current = false;
        pb.stopAccompaniment();
      };
      const letGo = event && !event.on ? event.midi : undefined;
      /** A key let go that the settle does not judge: out of the books, its level draining. */
      const drop = () => {
        if (letGo === undefined) return;
        keysRef.current = releaseKey(keysRef.current, letGo);
        pressesRef.current = liftAt(pressesRef.current, letGo);
        levels.release(letGo, now);
      };
      if (!o.active) {
        // Not walking (playing, loading, no piano): the presses are kept, the walk starts afresh.
        // The other hand stops too (Play stops it in its own click; the rest end here).
        if (accompaniedRef.current) stopAccompaniment();
        onTimingRef.current?.({ kind: 'break' });
        atRef.current = null;
        homeRef.current = false;
        moveIndex(-1);
        levels.clear();
        showHalo(null);
        if (event?.on) {
          ({ keys: keysRef.current, presses: pressesRef.current } = applyNote(
            { keys: keysRef.current, presses: pressesRef.current },
            event,
            now,
          ));
        }
        drop();
        return;
      }
      const start = pb.startPerformanceSec();
      const stretch = pb.performanceLoop();
      let keys = keysRef.current;
      let presses = pressesRef.current;
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
        onTimingRef.current?.({ kind: 'break' });
        keys = spendAll(keys);
        atRef.current = start;
        stepsAtRef.current = o.steps;
        loopAtRef.current = stretchKey(stretch);
        // The keys are spent: nothing of what filled or was asked for counts any more.
        levels.clear();
        showHalo(null);
      }
      if (event?.on) ({ keys, presses } = applyNote({ keys, presses }, event, now));
      // A key that comes up leaves the books here: a release never passes a step (issue 204).
      if (letGo !== undefined) {
        keys = releaseKey(keys, letGo);
        presses = liftAt(presses, letGo);
      }
      keysRef.current = keys;
      pressesRef.current = presses;
      // A press during a flight or hop is kept and passes when it lands (the align), counted from
      // then; a release then is a plain one. A flight ends the halo (issue 204).
      if (homeRef.current || o.flightShown || pb.playingNow()) {
        showHalo(null);
        drop();
        return;
      }

      // Paused after a note was heard, the group the cursor marks is the step; otherwise the next
      // step at or after where Play starts (a bar may start with a rest in the hands played).
      const mode = pb.cue === null && !pb.atStart && o.currentGroup >= 0 ? 'marked' : 'next';
      const here = anchorStep(o.steps, start, stretch, mode);
      if (here < 0) {
        drop();
        showHalo(null);
        moveIndex(-1);
        return;
      }
      // The key comes up now: its level drains.
      if (letGo !== undefined) levels.release(letGo, now);
      const result = advance(o.steps, here, keys, presses, stretch);
      keysRef.current = result.keys;
      pressesRef.current = result.presses;
      if (result.passed > 0) {
        setPlayed((n) => n + result.passed);
        // The halo of the step cued now (issue 204), from this moment, or none; a look that passes
        // nothing leaves the halo as it is.
        const halo =
          result.move.kind === 'cue'
            ? haloFor({
                steps: o.steps,
                notes: o.notes,
                last: result.last,
                loop: stretch,
                factor: o.factor,
                nowMs: now,
              })
            : null;
        showHalo(halo ? { halo, steps: o.steps, loop: stretchKey(stretch) } : null);
      }
      // Digitus plays the other hand (issue 184) from the step passed last to the next step of the
      // walk, from now: the press that passed it, or the landing of a hop for a press made under
      // it (issue 204). A new stretch drops what the one before left unstarted. Before the cue or
      // the finish, which do not stop it.
      const plan = o.accompaniment;
      if (plan && result.passed > 0) {
        const next = stepAfter(o.steps, result.last, stretch);
        accompaniedRef.current = true;
        pb.accompany(
          plan.code.accompanimentNotes(
            plan.events,
            plan.hands,
            plan.code.accompanimentStretches(
              o.steps,
              result.last,
              next < 0 ? { kind: 'finish' } : { kind: 'cue', index: next },
              stretch,
              plan.endSec,
            ),
            stretch,
          ),
        );
      }
      // Issue 192: the steps passed just now, each from the press that started its run.
      if (result.passed > 0) {
        onTimingRef.current?.({
          kind: 'settled',
          runs: result.passedRuns,
          at: result.at,
          finished: result.move.kind === 'finish',
        });
      }

      // A level to each pitch held that has none (a draining one counts as none), from its own
      // press: for each step passed just now (a key pressed under a flight, or early, that the
      // chain passed over still fills over its note's length), then for the step the red waits on
      // and the one after it (an early press), where the key must also be fresh.
      const wanted = result.passedSteps.map((at) => ({ at, fresh: false }));
      if (result.at >= 0) {
        wanted.push({ at: result.at, fresh: true });
        wanted.push({ at: stepAfter(o.steps, result.at, stretch), fresh: true });
      }
      for (const { at, fresh } of wanted) {
        const step = o.steps[at];
        const time = o.times[at];
        if (!step || !time) continue;
        step.pitches.forEach((midi, i) => {
          const state = result.keys.get(midi);
          if (fresh ? state !== true : state === undefined) return;
          const shown = levels.get().get(midi);
          if (shown && shown.upMs === null) return;
          levels.start(midi, {
            atMs: result.presses.get(midi) ?? now,
            lengthMs: (time.lengthSec[i]! * 1000) / o.factor,
            beats: time.beats[i]!,
          });
        });
      }

      if (result.move.kind === 'finish') {
        pb.finish();
        homeRef.current = true;
        atRef.current = 0;
        loopAtRef.current = stretchKey(pb.performanceLoop());
        moveIndex(-1);
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
      moveIndex(to);
    },
    [levels, moveIndex, showHalo],
  );

  // The keys held when the view opens are not presses for the step in front of it.
  useEffect(() => {
    keysRef.current = new Map(heldPitches().map((midi) => [midi, false] as const));
    pressesRef.current = NO_PRESSES;
    const unsubscribe = subscribeNotes((event) => decide(event));
    return () => {
      unsubscribe();
      onTimingRef.current?.({ kind: 'break' });
      levels.dispose();
    };
  }, [decide, levels]);

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
  // The switch turned off while the other hand sounds: it stops at once, mid-stretch. No look
  // passes a step then, so nothing else would stop it.
  useEffect(() => {
    if (accompaniment !== null || !accompaniedRef.current) return;
    accompaniedRef.current = false;
    liveRef.current.playback.stopAccompaniment();
  }, [accompaniment]);

  // Playwright's check: the pitches of the step the red waits on.
  useEffect(() => {
    if (!hooksOn()) return;
    const w = window as unknown as { __digitus2Along?: AlongHook };
    /** The index of the step the playback is cued at, else -1. */
    const named = (): number => {
      // Only a step the playback is cued at: right after a seek, a hands or loop change or the
      // finish, the index still names the step of before until the align puts the red on the
      // next one, and a check that played those pitches would play nothing.
      const o = liveRef.current;
      const step = o.active ? o.steps[indexRef.current] : undefined;
      if (!step || o.playback.cue === null) return -1;
      const here = Math.abs(o.playback.startPerformanceSec() - step.perfSec) <= ALONG_EPS;
      return here ? indexRef.current : -1;
    };
    const hook: AlongHook = {
      target: () => {
        const at = named();
        return at < 0 ? [] : [...liveRef.current.steps[at]!.pitches];
      },
      index: () => indexRef.current,
      halo: () => {
        const at = named();
        const shown = haloRef.current;
        if (at < 0 || !shown || shown.halo.index !== at || shown.steps !== liveRef.current.steps)
          return 0;
        const { startMs, ms } = shown.halo;
        return performance.now() < startMs + ms ? ms : 0;
      },
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
  const pianoConnected = connected;
  // The walk's first step (issue 196): the loop's first when a loop is set, else the piece's. A
  // loop that holds no step gives -1, which no index equals.
  const stretch = playback.performanceLoop();
  const stretchNow = stretchKey(stretch);
  const first = stretch ? (loopSpan(steps, stretch)?.first ?? -1) : 0;
  return useMemo(() => {
    const restart = heard ? null : restartBrowser(pianoNames);
    const hint: AlongHint | null =
      cuedHere && step && played === 0
        ? {
            count: step.pitches.length,
            ...(heard ? {} : { unheard: true as const }),
            ...(restart ? { restart } : {}),
          }
        : null;
    const halo =
      cuedHere &&
      !flightShown &&
      haloShown !== null &&
      haloShown.steps === steps &&
      haloShown.loop === stretchNow &&
      haloShown.halo.index === index
        ? haloShown.halo
        : null;
    return {
      active,
      pianoConnected,
      atFirst: cuedHere && index === first,
      hint,
      levels,
      soundWaits,
      halo,
    };
  }, [
    active,
    pianoConnected,
    cuedHere,
    index,
    first,
    step,
    played,
    levels,
    soundWaits,
    flightShown,
    haloShown,
    steps,
    stretchNow,
    heard,
    pianoNames,
  ]);
}
