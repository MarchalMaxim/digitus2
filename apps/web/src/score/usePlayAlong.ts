/**
 * Playing along on the reader's own piano (issue 182): the glue between the piano store
 * (midi/piano.ts) and `Playback`. While a piano is connected and the score is stopped, the red
 * waits on the next step to play (playAlong.ts); when the reader has held every pitch of it for
 * its time (the gap to the next step at the Practice tempo, never longer than its shortest note;
 * a release after four fifths of it counts too; issue 185), the red moves on, and at the end of
 * the piece the transport's own finish runs. The walk moves the red only through
 * `Playback.cueAt` and `Playback.finish`, in performance seconds, so a repeat is walked as it is
 * heard and the cursor, the page turn, the keys with their fingers and the plain Play button are
 * all the existing cue (useCursor.ts, Transport.tsx). The app makes no sound for the reader's
 * notes: nothing here strikes a key.
 *
 * With one hand left out (the Practice panel's Hands), digitus plays that hand (issue 184): when
 * a step starts running (every pitch of it held and fresh) the walk hands `Playback.accompany`
 * the other hand's notes from that step to the next step the walk waits on (accompaniment.ts),
 * counted from the press that started the run, so the other hand keeps its rhythm whether the
 * reader holds the step or lets go early. It stops them (`Playback.stopAccompaniment`) on every
 * move it did not make itself, and when it goes inactive; its own cue and finish leave the tail
 * of the piece sounding.
 *
 * The walk is active only when it can own the red: the piano is on and connected, the score is
 * ready and playable, it has a step, and nothing plays or loads. It moves the red only while no
 * flight or hop is on screen (`flightShown`), so there are never two reds: its align step is a
 * passive effect, which runs after the layout effects of RedFlight, EndBurst and the carry of
 * "Add notes between" in the same commit (ScoreView declares this hook after them).
 *
 * Presses are bookkept in `keysRef` (each held key with whether its press is still fresh) and
 * `pressesRef` (when each went down, in performance.now milliseconds, taken as the message
 * arrives). A move the walk did not make (a seek, Rewind, a loop or hands change, a new score,
 * Play then Pause, the piano connecting) uses every held key up: the hook recognises its own
 * moves because it remembers the performance second it left the playback at (`atRef`).
 *
 * Nothing is counted in ticks of a timer: a step passes by comparing timestamps in `decide`, at a
 * note and when the one wake-up timer fires (`timerRef`, set for the moment the step the red
 * waits on is due), so a timer that fires late in a hidden tab still passes everything due. A
 * release that comes too early leaves the red where it is and sets `early`, which the status line
 * turns into a hint. The keys the step asks for, and the next step's, fill over their note's
 * length in `levels` (keyLevels.ts), a store that PianoKeyboard reads: a level rising re-renders
 * nothing here.
 */
import type { Hand, Score } from '@digitus2/engine';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tempoFactorOf, useAppStore } from '../app/store.js';
import { playEventsFor, type PlayEvent } from '../audio/events.js';
import { performanceFor, scoreEndSec } from '../audio/performance.js';
import { heldPitches, subscribeNotes, usePianoSnapshot } from '../midi/piano.js';
import type { NoteMessage } from '../midi/types.js';
import { accompanimentNotes, accompanimentStretches } from './accompaniment.js';
import { createLevelStore, type LevelStore } from './keyLevels.js';
import {
  ALONG_EPS,
  NO_KEYS,
  NO_PRESSES,
  alongPlan,
  anchorStep,
  holdSec,
  liftAt,
  pressAt,
  pressKey,
  releaseKey,
  settle,
  spendAll,
  stepAfter,
  type AlongStep,
  type Keys,
  type PerfRange,
  type Presses,
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
}

/**
 * What the status line says while the red waits (issue 185): `play` asks for the step, until the
 * first one is played; `hold` asks for a longer hold after a release that came too early, and is
 * the more specific, so it wins. `count` is the step's pitch count.
 */
export interface AlongHint {
  kind: 'play' | 'hold';
  count: number;
}

export interface PlayAlong {
  /** The piano is connected and the red is the walk's: stopped, ready, playable, with steps. */
  active: boolean;
  /** Active and the red waits on the piece's first step (Rewind has nowhere to go). */
  atFirst: boolean;
  /** The status line's hint, or null when it is not shown. */
  hint: AlongHint | null;
  /** The levels of the held keys (issue 185): the same store for the life of the hook. */
  levels: LevelStore;
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
  /** The hold in real milliseconds of the step `target()` names, 0 when none (issue 185). */
  hold(): number;
}

/** The latest render's view of the options, read by the note subscription and the align. */
interface Live {
  active: boolean;
  flightShown: boolean;
  playback: Playback;
  steps: readonly AlongStep[];
  times: readonly StepTime[];
  /** The open piece's Practice tempo: real seconds = performance seconds / factor. */
  factor: number;
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
const NO_TIMES: StepTime[] = [];
const NO_PLAN = { steps: NO_STEPS, times: NO_TIMES };

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
}: PlayAlongOptions): PlayAlong {
  const setting = useAppStore((s) => s.settings.playAlong);
  const factor = useAppStore(tempoFactorOf);
  const piano = usePianoSnapshot();
  const connected = setting && piano.status === 'connected';
  const { playing, loading, atStart, cue, loop } = playback;
  const marked = currentGroup >= 0;

  // What there is to play, made only for a reader who has a piano connected. The list of hands
  // is rebuilt from its key, as useCursor does, so a new array of the same hands changes nothing.
  const muteKey = [...new Set(mutedHands)].sort().join(',');
  const { steps, times } = useMemo(
    () =>
      connected && score
        ? alongPlan(performanceFor(score), muteKey ? (muteKey.split(',') as Hand[]) : [])
        : NO_PLAN,
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
  /** A release came too early (issue 185): the status line asks for a longer hold. */
  const [early, setEarly] = useState(false);
  /** The levels of the held keys: made once, written here and read by PianoKeyboard. */
  const [levels] = useState(() => createLevelStore());

  const liveRef = useRef<Live>({
    active,
    flightShown,
    playback,
    steps,
    times,
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
  const earlyRef = useRef(false);
  /** The one wake-up: calls `decide(null)` when the step the red waits on is due. */
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The step the red waits on and since when all its keys have been held; null while none runs. */
  const runRef = useRef<{ index: number; sinceMs: number } | null>(null);
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
  const markEarly = useCallback((value: boolean) => {
    if (earlyRef.current === value) return;
    earlyRef.current = value;
    setEarly(value);
  }, []);

  /**
   * One procedure for a note and for the align (`event` null): spends the held keys on an
   * external move, applies the event, and when the walk may move, settles the steps the keys
   * play, at the time it is now. Reads everything from refs and the synchronous getters of the
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
      // Every look at the walk sets the wake-up again at its end, when a step is left running.
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
      const letGo = event && !event.on ? event.midi : undefined;
      // A key the piano lost (unplugged, Turn off) was not let go by the reader: it leaves the
      // books and its level drains, and the settle never judges it (issue 185).
      const lost = event?.lost === true;
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
        atRef.current = null;
        homeRef.current = false;
        moveIndex(-1);
        levels.clear();
        markEarly(false);
        runRef.current = null;
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
        runRef.current = null;
        keys = spendAll(keys);
        atRef.current = start;
        stepsAtRef.current = o.steps;
        loopAtRef.current = stretchKey(stretch);
        // The keys are spent: nothing of what filled or was asked for counts any more.
        levels.clear();
        markEarly(false);
      }
      if (event?.on) ({ keys, presses } = applyNote({ keys, presses }, event, now));
      if (lost && letGo !== undefined) {
        keys = releaseKey(keys, letGo);
        presses = liftAt(presses, letGo);
      }
      keysRef.current = keys;
      pressesRef.current = presses;
      // A press during a flight or hop is kept and counts, from its own time, once it lands; a
      // release then is a plain one (the flight is the app's move, so it asks nothing of the reader).
      if (homeRef.current || o.flightShown || pb.playingNow()) {
        runRef.current = null;
        drop();
        return;
      }

      // Paused after a note was heard, the group the cursor marks is the step; otherwise the next
      // step at or after where Play starts (a bar may start with a rest in the hands played).
      const mode = pb.cue === null && !pb.atStart && o.currentGroup >= 0 ? 'marked' : 'next';
      const here = anchorStep(o.steps, start, stretch, mode);
      if (here < 0) {
        runRef.current = null;
        drop();
        moveIndex(-1);
        return;
      }
      // The key comes up now: its level drains, and the settle judges the release before it goes.
      if (letGo !== undefined) levels.release(letGo, now);
      const result = settle({
        steps: o.steps,
        times: o.times,
        index: here,
        keys,
        presses,
        loop: stretch,
        nowMs: now,
        factor: o.factor,
        ...(letGo === undefined || lost ? {} : { releasing: letGo }),
      });
      keysRef.current = result.keys;
      pressesRef.current = result.presses;
      // A pass clears the hint, and an early release after it (the chain's end) sets it again.
      if (result.passed > 0) {
        setPlayed((n) => n + result.passed);
        markEarly(false);
      }
      if (result.early) markEarly(true);
      // The run start: the step the red waits on has all its keys held and fresh since this
      // moment, or null while it does not run. The one place that moment is taken; issue 184's
      // accompaniment starts when it changes, not at the pass, which comes a note's length later.
      const ranBefore = runRef.current;
      runRef.current = result.run;
      const plan = o.accompaniment;
      if (plan) {
        // Digitus plays the other hand from the step that started running to the next one the walk
        // waits on, counted from now: the press, when the press made the step run (a step that
        // runs from an earlier press, because the red only reached it now, counts from the moment
        // the red reached it). What the stretch before left unstarted is dropped. A reader who
        // lets go early leaves it playing: the stretch is the piece's rhythm, not the reader's
        // hold, and the next press of the step starts it afresh. A step the chain passed without
        // ever being seen running (all due at once) is played from its pass. Before the cue or
        // the finish, which do not stop it.
        let started = -1;
        if (result.run) {
          const same =
            ranBefore?.index === result.run.index && ranBefore.sinceMs === result.run.sinceMs;
          if (!same) started = result.run.index;
        } else if (
          result.passed > 0 &&
          !(result.passed === 1 && ranBefore?.index === result.last)
        ) {
          started = result.last;
        }
        if (started >= 0) {
          const next = stepAfter(o.steps, started, stretch);
          const stretches = accompanimentStretches(
            o.steps,
            started,
            next < 0 ? { kind: 'finish' } : { kind: 'cue', index: next },
            stretch,
            plan.endSec,
          );
          accompaniedRef.current = true;
          pb.accompany(accompanimentNotes(plan.events, plan.hands, stretches, stretch));
        }
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
        runRef.current = null;
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
      // The wake-up for the moment the step is due, from its own run. A late firing is harmless:
      // the settle reads the clock. Only a finite delay is ever scheduled.
      if (result.wakeAtMs !== null && Number.isFinite(result.wakeAtMs)) {
        timerRef.current = setTimeout(
          () => {
            timerRef.current = undefined;
            decide(null);
          },
          Math.max(0, result.wakeAtMs - now),
        );
      }
    },
    [levels, moveIndex, markEarly],
  );

  // The keys held when the view opens are not presses for the step in front of it.
  useEffect(() => {
    keysRef.current = new Map(heldPitches().map((midi) => [midi, false] as const));
    pressesRef.current = NO_PRESSES;
    const unsubscribe = subscribeNotes((event) => decide(event));
    return () => {
      unsubscribe();
      runRef.current = null;
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
      levels.dispose();
    };
  }, [decide, levels]);

  // Align: puts the red on the step the position calls for. Idempotent: it calls `cueAt` only
  // when the playback is not cued there, so a second run makes no call (StrictMode's second look
  // at a mount finds the playback halted, and cues again). When Rewind, the finish or the end of the piece takes the
  // position home (`atStart` turns true), the red's flight home is planned in a layout effect of
  // this very commit and only shows in the next render, which this effect runs before: look
  // again a frame later (also the reduced-motion case: Play is red for one frame). A change of the
  // Practice tempo (`factor`) looks again too, so the wake-up of a step held meanwhile moves to its
  // new time; the walk has not moved, so no key is spent for it.
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
  }, [decide, active, flightShown, playing, loading, atStart, cue, loop, steps, marked, factor]);

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
      hold: () => {
        const at = named();
        if (at < 0) return 0;
        const o = liveRef.current;
        return (holdSec(o.steps, o.times, at, o.playback.performanceLoop()) * 1000) / o.factor;
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
  return useMemo(() => {
    let hint: AlongHint | null = null;
    if (cuedHere && step) {
      if (early) hint = { kind: 'hold', count: step.pitches.length };
      else if (played === 0) hint = { kind: 'play', count: step.pitches.length };
    }
    return { active, atFirst: cuedHere && index === 0, hint, levels, soundWaits };
  }, [active, cuedHere, index, step, played, early, levels, soundWaits]);
}
