/**
 * Playback for the score view: owns the AudioContext, the instrument and the look-ahead
 * Transport (audio/transport.ts), and mirrors the transport settings from the store into it.
 *
 * The AudioContext is created on the first play(), inside the click that asked for it, so the
 * browser lets it start. The instrument loads the piece's pitches and velocity layers once per score; Play is
 * unavailable and busy while it does. A new score stops playback and drops the transport and the
 * loop; unmounting also closes the context. A loop changed while playing reaches the transport
 * once the typing settles (LOOP_SETTLE_MS). The transport's count-in reports become `countIn`,
 * which the status line counts, and its lead-in reports become `waiting`, which the cursor waits
 * for (no note is marked before it sounds) while Pause keeps the red. `atStart` says whether a
 * stop left the position at the start (Rewind while stopped, the end) or away from it (a pause),
 * where the cursor keeps the last group heard marked (T10). `seek` moves the position to a bar's
 * start (T13), before the first Play too: `cue` then says where Play starts is that bar, and the
 * cursor marks its first note there until a note is heard. `cueAt` does the same in performance
 * seconds, the order heard, for the play-along (issue 182): it can name the second hearing of a
 * repeated bar, which a written second cannot.
 *
 * The other hand of the play-along (issue 184) sounds through an `Accompanist` (audio/accompanist.ts)
 * over the same context and instrument. `prepare` loads the samples before any press, with no
 * gesture, under `preparing` (never `loading`, which would turn the walk off). The browser may hold
 * the context suspended until a click: `accompany` waits for it to run, `soundWaits` says so, and a
 * capture listener resumes it on the first pointer or key press.
 *
 * The transport module is a lazy chunk, fetched as soon as a score is open: it reads the beat
 * grid through the engine's public API, and any runtime import of the engine brings
 * @xmldom/xmldom (CommonJS, which the bundler cannot drop) into the chunk that holds it. Imported
 * statically it would push the library page's initial JavaScript past its 150 KB gzip budget.
 */
import type { Hand, Score } from '@digitus2/engine';
import { ornamentAttacks } from '@digitus2/engine/ornaments';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tempoFactorOf, useAppStore, type HandsMode } from '../app/store.js';
import type { Phrase } from '../i18n/messages.js';
import { prefersReducedMotion, RED_FLIGHT_MS } from '../design/motion.js';
import { Accompanist } from '../audio/accompanist.js';
import {
  instrumentFromLocation,
  noteVelocity,
  type AccNote,
  type Instrument,
} from '../audio/instrument.js';
import { keyVelocity } from './noteKey.js';
import { scheduleClick } from '../audio/metronome.js';
import {
  loopStartSec,
  performanceFor,
  performanceLoop as loopStretch,
  toPerformanceSec,
  toWrittenSec,
} from '../audio/performance.js';
import type { HeardAt, PassSpan } from '../audio/timeline.js';
import type * as TransportExports from '../audio/transport.js';

type TransportModule = typeof TransportExports;

let transportModule: Promise<TransportModule> | null = null;
let transportLoaded: TransportModule | null = null;

/** The transport chunk, fetched once; a failed fetch is tried again on the next call. */
function loadTransport(): Promise<TransportModule> {
  transportModule ??= import('../audio/transport.js').then(
    (m) => (transportLoaded = m),
    (e: unknown) => {
      transportModule = null;
      throw e;
    },
  );
  return transportModule;
}

/** A loop over whole bars, as 0-based measure indices (both ends included). */
export interface LoopRange {
  from: number;
  to: number;
}

/**
 * The count-in being heard: click `beat` (0-based) of `beats`, on beat `beatInBar` of its bar
 * (from 1), the number the status line shows: "1 2" before Happy Birthday's 3/4 pickup, "1 2 3
 * 4 1" before a three-beat pickup in 4/4.
 */
export interface CountIn {
  beat: number;
  beats: number;
  beatInBar: number;
}

export interface Playback {
  playing: boolean;
  /** True while the instrument fetches the piece's samples after Play (Play is unavailable, busy). */
  loading: boolean;
  /**
   * While playing, the count-in before the music, from Play until the start position is heard;
   * null otherwise. The status line counts it.
   */
  countIn: CountIn | null;
  /**
   * While playing, true from Play (or a seek, such as Rewind) until the first note of the hands
   * played is heard: the start delay, the count-in, and whatever comes before that note (a rest,
   * the other hand's pickup). Nothing in the score is marked and no key pressed meanwhile, so
   * Pause stays the red element. `countIn` is never set while this is false.
   */
  waiting: boolean;
  /**
   * True while the position is at the start: a fresh score, after Rewind while stopped, and at
   * the end of the piece. False from Play on. The cursor keeps the last group heard marked
   * while paused away from the start (T10) and clears it here.
   */
  atStart: boolean;
  /**
   * How many times the piece has been played to its end: the transport's end, heard, is the one
   * thing that counts it, never Pause, Rewind, a seek, a loop wrap (a loop never ends) or a new
   * score. The finish (EndBurst.tsx) answers each count.
   */
  ended: number;
  /**
   * The score time a seek (T13) put the position at, a bar's start, until a note is heard there
   * (or Rewind, or a new score); null otherwise. Stopped, the cursor marks the first group of the
   * hands played at or after it, the note Play starts with, rather than the last one heard.
   */
  cue: number | null;
  /**
   * Plays from where Play starts. `resume` is a play carried across "Add notes between" (issue
   * #67, carry.ts): the music goes on as it was, with no count-in and no flight of the red.
   */
  play(opts?: { resume?: boolean }): void;
  pause(): void;
  rewind(): void;
  /**
   * Moves the position to `sec` (a bar's start, T13), playing or not, before the first Play too.
   * Playing, the music goes on from there after `leadSec` (at least the transport's start delay):
   * the red hops there meanwhile (RedFlight.tsx). Stopped, Play starts there; a seek to 0 while
   * stopped is Rewind.
   */
  seek(sec: number, opts?: { leadSec?: number }): void;
  /**
   * Stopped only (a no-op while the transport plays): moves the position to `perfSec`, a
   * performance second, and cues it: `cue` becomes `toWrittenSec(perf, perfSec)` and `atStart`
   * false, at 0 too. Play starts there, on that hearing. Before the first Play the position waits
   * in `pendingPerfRef`. Calling it again with the same second changes nothing (React bails out).
   * The play-along's walk (issue 182) moves the red only through this and `finish`.
   */
  cueAt(perfSec: number): void;
  /**
   * Stopped only: the reader played the last step (issue 182). What the transport's end does:
   * position to the top, `cue` null, `atStart` true, `ended` + 1.
   */
  finish(): void;
  /** The score time heard, paused or requested by seek before Play, in seconds. */
  positionSec(): number;
  /**
   * While stopped, the score time Play starts from, in seconds: the position, or the loop's
   * first bar when the position lies outside the loop (0 before the first play). The paused
   * cursor marks the last group heard only when Play resumes at the position (T10).
   */
  startSec(): number;
  /** Where Play starts, in performance seconds (loop-aware), stopped or before the first Play. */
  startPerformanceSec(): number;
  /**
   * The loop's stretch in performance seconds, the one the transport plays (before the first Play,
   * the one that holds the position), or null. A new object on each call before the first Play.
   */
  performanceLoop(): { from: number; to: number } | null;
  /**
   * Whether the transport is in a lead-in at the time being heard now, read on every frame:
   * `waiting` follows it on the transport's next scheduler tick, so after a loop wrap to a start
   * where the hands played rest, the cursor keeps its marks until then rather than mark a note
   * of the new pass before it sounds. False when stopped.
   */
  leadingIn(): boolean;
  /**
   * Whether the transport is playing now, read on every frame: `playing` follows the end of the
   * piece in a later render, after the transport has already rewound to the start. False before
   * the first Play.
   */
  playingNow(): boolean;
  /**
   * While a lead-in runs, how long until its first note is heard, in seconds; null otherwise.
   * Read on every frame by the red's flight from Play to that note (RedFlight.tsx).
   */
  leadInRemainingSec(): number | null;
  loop: LoopRange | null;
  setLoop(r: LoopRange | null): void;
  /**
   * Sounds a key clicked on the on-screen keyboard (issue #96) at `hand`'s unmarked velocity,
   * until the function returned is called (the release) or `KEY_HOLD_SEC` passes. Before the
   * first Play the samples are not loaded: the press loads them (`loading`, the status line's
   * `Loading the piano…`) and the key sounds when they arrive. Nothing to the transport: playing
   * goes on, stopped stays stopped.
   */
  strike(midi: number, hand: Hand): () => void;
  /**
   * Issue 184: the samples for the other hand, loaded while the walk is active and before any
   * press, with no gesture: the AudioContext is made (suspended where the browser waits for a
   * click) and the piece's samples load under `preparing`, never `loading`. Once per score; a
   * failure shows SAMPLES_FAILED_NOTICE and is not tried again for that score.
   */
  prepare(): void;
  /** `prepare` is loading the samples: the status line says Loading the piano…; the walk goes on. */
  preparing: boolean;
  /**
   * The AudioContext exists and the browser holds it suspended until a click or key on the page
   * (autoplay, no user activation yet). Meanwhile a capture listener resumes it on the first
   * pointerdown, pointerup or keydown. False once the samples for the open score failed to load:
   * a click would sound nothing.
   */
  soundWaits: boolean;
  /**
   * Plays the other hand's notes from now (Accompanist.play at the Practice tempo factor). A no-op
   * while the samples do not cover the score or the context is not running; a context that is not
   * running (or that stops running) also stops what an earlier call left queued.
   */
  accompany(notes: readonly AccNote[]): void;
  /** Stops the accompaniment (Accompanist.stop). Idempotent; never touches Play's notes or a struck key. */
  stopAccompaniment(): void;
  /**
   * Issue 192: the transport's `heardAt`, where the listener was at `atMs` (a performance.now()
   * millisecond, now when omitted); null while stopped. Always set by usePlayback: optional only so
   * hand-made fakes need not have it, and a reader treats it missing as nothing to time against.
   */
  heardAt?: (atMs?: number) => HeardAt | null;
  /** Issue 192: the current or last run's passes; empty before the first Play. Always set by usePlayback. */
  runPasses?: () => readonly PassSpan[];
  /**
   * Issue 192: how many times the transport has started playing, one more at every start. A play
   * carried across "Add notes between" halts the old transport and starts the new one in the same
   * commit, so `playing` stays true while a new run begins; this tells the runs apart. Always set
   * by usePlayback; a fake without it counts as one run per stretch of `playing`.
   */
  playId?: number;
}

/** How long a key clicked on the keyboard sounds at most, in seconds (a pointer held down). */
export const KEY_HOLD_SEC = 2;

/** Sample-load failures, told apart from a failed fetch of the player chunk. */
class SamplesError extends Error {}

/**
 * A loop changed while playing reaches the transport this long after the last change. A playing
 * transport jumps to the loop's start when the position lies outside it, so a range typed one
 * keystroke at a time ("1", then "12") would otherwise jump at the "1".
 */
export const LOOP_SETTLE_MS = 400;

export const SAMPLES_FAILED_NOTICE: Phrase = (t) => t.transport.samplesFailed;
export const PLAYER_FAILED_NOTICE: Phrase = (t) => t.transport.playerFailed;

/** The hands the transport silences for a hands setting. */
export function mutedHandsFor(hands: HandsMode): Hand[] {
  if (hands === 'R') return ['L'];
  if (hands === 'L') return ['R'];
  return [];
}

/** Whether every note of the piece is in one hand (a melody alone, a MIDI file split to one side). */
export function oneHanded(score: Score | null): boolean {
  const first = score?.notes[0]?.hand;
  return first !== undefined && score!.notes.every((n) => n.hand === first);
}

/**
 * The hands a piece plays: the setting, except on a one-hand piece, which plays with both
 * (issue 112). There the setting could pick the empty hand, Play red with nothing to play; the
 * setting itself is kept, so the next piece with two hands opens with the reader's choice.
 */
export function handsFor(score: Score | null, hands: HandsMode): HandsMode {
  return oneHanded(score) ? 'both' : hands;
}

/** The events the resume listener waits for: any of them is a user activation (a click, a key). */
const ACTIVATION_EVENTS = ['pointerdown', 'pointerup', 'keydown'] as const;

/** Whether the page has had a click or a key press; a browser without the API counts as not. */
function userHasBeenActive(): boolean {
  const activation = (navigator as { userActivation?: { hasBeenActive?: boolean } }).userActivation;
  return activation?.hasBeenActive === true;
}

/**
 * Whether the test hooks are on (`?audio=silent` or `?hooks=1`): the Playwright checks of what
 * the app handed to the instrument. `?hooks=1` changes nothing else: the real instrument loads.
 */
function hooksOn(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('audio') === 'silent' || params.get('hooks') === '1';
}

/** What the accompaniment handed to the instrument (a test hook). */
interface AccompaniedNote {
  midi: number;
  hand: Hand;
  time: number;
  duration: number;
  velocity: number;
}

/** The scores whose `prepare` failed: it is not tried again for them. */
const prepareFailed = new WeakSet<Score>();

/**
 * The instrument as the Accompanist sees it under the test hooks: what the accompaniment hands
 * over and what it cancels or releases are logged, and nothing of Play's or a struck key's. The
 * silent instrument's own events also hold Play's notes, so the specs never read those.
 */
function recorded(
  inner: Instrument,
  handed: AccompaniedNote[],
  cancelled: { midi: number; time: number }[],
): Instrument {
  return {
    load: (midis, velocities) => inner.load(midis, velocities),
    start(e) {
      handed.push({
        midi: e.midi,
        hand: e.hand,
        time: e.time,
        duration: e.duration,
        velocity: e.velocity,
      });
      const stop = inner.start(e);
      let stopped = false;
      return () => {
        if (!stopped) cancelled.push({ midi: e.midi, time: e.time });
        stopped = true;
        stop();
      };
    },
    strike: (midi, velocity, maxSec) => inner.strike(midi, velocity, maxSec),
    stopAll: () => inner.stopAll(),
  };
}

function uniqueMidis(score: Score): number[] {
  return [...new Set(score.notes.flatMap((n) => ornamentAttacks(n).map((attack) => attack.midi)))];
}

function uniqueVelocities(score: Score): number[] {
  return [...new Set(score.notes.map(noteVelocity))];
}

/** What the instrument needs to play a score: its pitches, and its velocities' span. */
interface Samples {
  midis: number[];
  velocities: number[];
  low: number;
  high: number;
}

const samplesOf = new WeakMap<Score, Samples>();

function samplesFor(score: Score): Samples {
  let samples = samplesOf.get(score);
  if (!samples) {
    const velocities = uniqueVelocities(score);
    samples = {
      midis: uniqueMidis(score),
      velocities,
      low: Math.min(...velocities),
      high: Math.max(...velocities),
    };
    samplesOf.set(score, samples);
  }
  return samples;
}

/**
 * Whether the loaded samples play `needed`: its pitches among the loaded ones, its velocities
 * within the loaded span (the piano loads every layer between the softest and the loudest).
 */
function covers(loaded: Samples | null, needed: Samples): boolean {
  if (!loaded) return false;
  const have = new Set(loaded.midis);
  return (
    needed.midis.every((m) => have.has(m)) &&
    (needed.velocities.length === 0 || (needed.low >= loaded.low && needed.high <= loaded.high))
  );
}

export function usePlayback(score: Score | null): Playback {
  // The open piece's own tempo factor (polish plan Task 6): a different piece opens at 100 %.
  const tempoFactor = useAppStore(tempoFactorOf);
  const hands = handsFor(
    score,
    useAppStore((s) => s.settings.hands),
  );
  const metronome = useAppStore((s) => s.settings.metronome);
  const countInOn = useAppStore((s) => s.settings.countIn);

  const [playing, setPlaying] = useState(false);
  /** One more at every start of the transport (issue 192): `Playback.playId`. */
  const [playId, setPlayId] = useState(0);
  const [loading, setLoading] = useState(false);
  const [countIn, setCountIn] = useState<CountIn | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [ended, setEnded] = useState(0);
  const [loop, setLoopState] = useState<LoopRange | null>(null);
  const [cue, setCue] = useState<number | null>(null);
  const [preparing, setPreparing] = useState(false);
  /** The AudioContext's state ('none' before it exists); the resume listener follows it. */
  const [audioState, setAudioState] = useState<AudioContextState | 'none'>('none');
  /** The page has had a click or a key press (`navigator.userActivation`), as of the last look. */
  const [activated, setActivated] = useState(false);
  /**
   * The score whose `prepare` could not load the samples. A click would sound nothing for it, so
   * the status line does not ask for one (`soundWaits`).
   */
  const [failedScore, setFailedScore] = useState<Score | null>(null);
  /** `atStart` for play(), which runs in a click: a Play from the start lets the red travel. */
  const atStartRef = useRef(atStart);
  useLayoutEffect(() => {
    atStartRef.current = atStart;
  }, [atStart]);

  const ctxRef = useRef<AudioContext | null>(null);
  const instrumentRef = useRef<Instrument | null>(null);
  const transportRef = useRef<TransportExports.Transport | null>(null);
  /**
   * What the instrument has loaded. It stays across a new score, so a score it already plays (the
   * other version of "Add notes between", issue #67, back again) starts at once.
   */
  const loadedRef = useRef<Samples | null>(null);
  /** Counts the instrument's loads: only the newest one replaces its samples (instrument.ts). */
  const loadSeqRef = useRef(0);
  const scoreRef = useRef<Score | null>(score);
  const loopRef = useRef<LoopRange | null>(null);
  /** The other hand's scheduler, made on the first `accompany` over the opened audio. */
  const accompanistRef = useRef<Accompanist | null>(null);
  /** How many loads Play or a struck key have running: `prepare` leaves the samples to them. */
  const loadsRunningRef = useRef(0);
  /** Counts `prepare` loads: only the newest clears `preparing`. */
  const prepSeqRef = useRef(0);
  /** The score the running `prepare` loads for. */
  const preparingScoreRef = useRef<Score | null>(null);
  /** The test hooks' logs of what the accompaniment handed to the instrument and cancelled. */
  const accompaniedRef = useRef<AccompaniedNote[]>([]);
  const accompCancelledRef = useRef<{ midi: number; time: number }[]>([]);
  /** A seek before the first Play, while there is no transport yet: where it will start. */
  const pendingSecRef = useRef<number | null>(null);
  /**
   * A cue before the first Play (`cueAt`), in performance seconds: it keeps the hearing a written
   * second cannot. Never set together with `pendingSecRef`; the newest of the two wins.
   */
  const pendingPerfRef = useRef<number | null>(null);
  /** Bumped by every play, pause and score change: a pending start checks it is still wanted. */
  const playSeqRef = useRef(0);
  /** The delayed hand-over of a loop changed while playing (see LOOP_SETTLE_MS). */
  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelLoopPush = useCallback(() => {
    if (loopTimerRef.current === null) return;
    clearTimeout(loopTimerRef.current);
    loopTimerRef.current = null;
  }, []);

  /** Hands the current loop to the transport now, in place of a pending delayed hand-over. */
  const pushLoop = useCallback(() => {
    cancelLoopPush();
    transportRef.current?.setLoop(loopRef.current);
  }, [cancelLoopPush]);

  /** Stops the accompaniment: its queue, the notes not started, and the ones that ring. */
  const stopAccompaniment = useCallback(() => {
    accompanistRef.current?.stop();
  }, []);

  /** Stops for good: cancels a pending start, drops the transport and forgets the loop. */
  const halt = useCallback(() => {
    playSeqRef.current++;
    stopAccompaniment();
    prepSeqRef.current++; // a prepare running for the old score no longer counts
    preparingScoreRef.current = null;
    setPreparing(false);
    cancelLoopPush();
    transportRef.current?.dispose();
    transportRef.current = null;
    loopRef.current = null;
    pendingSecRef.current = null;
    pendingPerfRef.current = null;
    setPlaying(false);
    setLoading(false);
    setCountIn(null);
    setWaiting(false);
    setAtStart(true);
    setCue(null);
    setLoopState(null);
  }, [cancelLoopPush, stopAccompaniment]);

  /** Silences the instrument and releases the audio device. */
  const release = useCallback(() => {
    accompanistRef.current?.dispose();
    accompanistRef.current = null;
    prepSeqRef.current++;
    preparingScoreRef.current = null;
    setPreparing(false);
    instrumentRef.current?.stopAll();
    instrumentRef.current = null;
    loadedRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    setAudioState('none');
    if (ctx) ctx.onstatechange = null;
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => undefined);
  }, []);

  // A new score (or none): the old transport and its loop go. An open score fetches the transport
  // chunk ahead of the first Play.
  useEffect(() => {
    scoreRef.current = score;
    if (score) loadTransport().catch(() => undefined);
    return halt;
  }, [score, halt]);

  // Unmount (after the cleanup above): the context closes.
  useEffect(() => release, [release]);

  // Playwright's checks (`?audio=silent` or `?hooks=1`): the pitches the silent instrument was
  // asked to strike, in order; what the accompaniment handed to the instrument and cancelled
  // (never Play's notes); the AudioContext's state; and its output latency in seconds, which the
  // play-along timing's latency notes read (issue 192).
  useEffect(() => {
    if (!hooksOn()) return;
    const w = window as unknown as {
      __digitus2Keys?: {
        strikes(): number[];
        accompanied(): AccompaniedNote[];
        accompCancelled(): { midi: number; time: number }[];
        audioState(): AudioContextState | 'none';
        outputLatency(): number | null;
      };
    };
    const hook = {
      strikes: () =>
        (instrumentRef.current as { strikes?: { midi: number }[] } | null)?.strikes?.map(
          (k) => k.midi,
        ) ?? [],
      accompanied: () => accompaniedRef.current.map((n) => ({ ...n })),
      accompCancelled: () => accompCancelledRef.current.map((n) => ({ ...n })),
      audioState: () => ctxRef.current?.state ?? 'none',
      outputLatency: () => ctxRef.current?.outputLatency ?? null,
    };
    w.__digitus2Keys = hook;
    return () => {
      if (w.__digitus2Keys === hook) delete w.__digitus2Keys;
    };
  }, []);

  // The browser may hold the context suspended until a click or a key (autoplay): whenever it is,
  // the first pointer or key press anywhere on the page resumes it. A capture listener, so a
  // click that something below handles still counts.
  useEffect(() => {
    if (audioState !== 'suspended') return;
    const resume = () => {
      ctxRef.current?.resume().catch(() => undefined);
      setActivated(userHasBeenActive());
    };
    for (const type of ACTIVATION_EVENTS) document.addEventListener(type, resume, true);
    return () => {
      for (const type of ACTIVATION_EVENTS) document.removeEventListener(type, resume, true);
    };
  }, [audioState]);

  // The store's transport settings, mirrored into a transport that exists (new ones copy them).
  useEffect(() => {
    const t = transportRef.current;
    if (!t) return;
    t.setTempoFactor(tempoFactor);
    t.setMuted(mutedHandsFor(hands));
    t.setMetronome(metronome);
    t.setCountIn(countInOn);
  }, [tempoFactor, hands, metronome, countInOn]);

  /**
   * The audio context and the instrument, made on first use inside the click or press that asked
   * for them, so the browser lets the context start.
   */
  const openAudio = useCallback((): { audio: AudioContext; instrument: Instrument } => {
    let ctx = ctxRef.current;
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: 'interactive' });
      ctxRef.current = ctx;
      instrumentRef.current = instrumentFromLocation(ctx, window.location.search);
      loadedRef.current = null;
      const made = ctx;
      made.onstatechange = () => {
        if (ctxRef.current !== made) return;
        // Held (suspended, interrupted): the clock stands still, so what the other hand has queued
        // would sound out of step once the audio comes back. It goes now.
        if (made.state !== 'running') accompanistRef.current?.stop();
        setAudioState(made.state);
        setActivated(userHasBeenActive());
      };
      setAudioState(made.state);
      setActivated(userHasBeenActive());
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    return { audio: ctx, instrument: instrumentRef.current! };
  }, []);

  /** Counts a Play's or a key's load while it runs, so `prepare` does not start a second one. */
  const trackLoad = useCallback(<T>(load: Promise<T>): Promise<T> => {
    loadsRunningRef.current++;
    const done = () => {
      loadsRunningRef.current--;
    };
    load.then(done, done);
    return load;
  }, []);

  const play = useCallback(
    (opts: { resume?: boolean } = {}) => {
      const resume = opts.resume === true;
      const s = scoreRef.current;
      if (!s || transportRef.current?.state.playing) return;
      stopAccompaniment(); // in the click, before the transport schedules anything
      const seq = ++playSeqRef.current;
      const { audio, instrument } = openAudio();

      const start = (mod: TransportModule) => {
        if (seq !== playSeqRef.current || scoreRef.current !== s || ctxRef.current !== audio)
          return;
        let t = transportRef.current;
        if (!t) {
          const transport = new mod.Transport({
            ctx: audio,
            instrument,
            score: s,
            click: (time, level) => scheduleClick(audio, time, level),
          });
          const state = useAppStore.getState();
          const settings = state.settings;
          transport.setTempoFactor(tempoFactorOf(state));
          transport.setMuted(mutedHandsFor(handsFor(s, settings.hands)));
          transport.setMetronome(settings.metronome);
          transport.setCountIn(settings.countIn);
          // The end: back to the start, stopped; the cursor clears and Play is red again, and the
          // finish rises from the last group heard (EndBurst.tsx), in the same render.
          transport.onEnd = () => {
            transport.rewind();
            setPlaying(false);
            setAtStart(true);
            setCue(null);
            setEnded((n) => n + 1);
          };
          // The count-in, for the status line, and the lead-in, which the cursor waits for (it
          // marks nothing until the first note of the hands played is heard). A tick that ends
          // both reports both, so they reach the screen in one render.
          transport.onCountInBeat = (beat, beats, beatInBar) =>
            setCountIn({ beat, beats, beatInBar });
          transport.onCountInEnd = () => setCountIn(null);
          // A note heard after a seek: the cue is over, the cursor follows what is heard. A lead-in
          // that a pause ends heard nothing, so the cue stays.
          transport.onLeadInChange = (leadingIn) => {
            setWaiting(leadingIn);
            if (!leadingIn && transport.state.playing) setCue(null);
          };
          if (pendingPerfRef.current !== null) transport.seekPerformance(pendingPerfRef.current);
          else if (pendingSecRef.current !== null) transport.seek(pendingSecRef.current);
          pendingSecRef.current = null;
          pendingPerfRef.current = null;
          transportRef.current = transport;
          t = transport;
        }
        pushLoop(); // stopped: the loop only sets where play() starts
        // From the start without a count-in, the first note waits for the red to travel to it from
        // Play (RedFlight.tsx), so it sounds as the red lands; never under prefers-reduced-motion.
        // A resume (a play carried across a switch) goes on as the music did: no count-in, and the
        // red stays where it is.
        const travels =
          !resume &&
          atStartRef.current &&
          !useAppStore.getState().settings.countIn &&
          !prefersReducedMotion();
        // play() reports a count-in's first beat and the lead-in at once, so they reach the screen
        // in the same render as playing: Pause takes the red from Play, and no note is marked.
        t.play(resume ? { countIn: false } : travels ? { leadSec: RED_FLIGHT_MS / 1000 } : {});
        setPlaying(true);
        setPlayId((n) => n + 1);
        setAtStart(false);
        // Every Play marks the legend as seen and, for a library piece, makes it the one the
        // library offers to continue (spec 12 and 16).
        useAppStore.getState().markPlayed();
      };

      // Everything at hand (every Play after the first): start in the click itself.
      const needed = samplesFor(s);
      const loaded = covers(loadedRef.current, needed);
      if (loaded && transportLoaded) {
        start(transportLoaded);
        return;
      }
      setLoading(true);
      const load = loaded ? loadSeqRef.current : ++loadSeqRef.current;
      const samples = loaded
        ? Promise.resolve()
        : trackLoad(instrument.load(needed.midis, needed.velocities)).then(
            () => {
              if (ctxRef.current === audio && load === loadSeqRef.current) {
                loadedRef.current = needed;
              }
            },
            (e: unknown) => {
              throw new SamplesError('samples', { cause: e });
            },
          );
      Promise.all([loadTransport(), samples]).then(
        ([mod]) => {
          if (seq !== playSeqRef.current) return;
          setLoading(false);
          start(mod);
        },
        (e: unknown) => {
          if (seq !== playSeqRef.current) return;
          setLoading(false);
          useAppStore
            .getState()
            .setNotice(e instanceof SamplesError ? SAMPLES_FAILED_NOTICE : PLAYER_FAILED_NOTICE);
        },
      );
    },
    [openAudio, pushLoop, stopAccompaniment, trackLoad],
  );

  // A key clicked on the keyboard (issue #96). The samples it needs are the score's (the keyboard
  // spans the piece's range; a key outside the piece's pitches plays the nearest loaded sample).
  // A load started here is the newest (`loadSeqRef`), so a Play meanwhile loads again and this
  // press leaves `loading` to it.
  const strike = useCallback(
    (midi: number, hand: Hand): (() => void) => {
      const s = scoreRef.current;
      if (!s) return () => undefined;
      const { audio, instrument } = openAudio();
      let released = false;
      let stop: (() => void) | null = null;
      const sound = () => {
        stop = instrument.strike(midi, keyVelocity(hand), KEY_HOLD_SEC);
        if (released) stop(); // released while the samples were loading: nothing lingers
      };
      const needed = samplesFor(s);
      if (covers(loadedRef.current, needed)) {
        sound();
      } else {
        setLoading(true);
        const load = ++loadSeqRef.current;
        trackLoad(instrument.load(needed.midis, needed.velocities)).then(
          () => {
            if (ctxRef.current !== audio || load !== loadSeqRef.current) return;
            loadedRef.current = needed;
            setLoading(false);
            sound();
          },
          () => {
            if (ctxRef.current !== audio || load !== loadSeqRef.current) return;
            setLoading(false);
            useAppStore.getState().setNotice(SAMPLES_FAILED_NOTICE);
          },
        );
      }
      return () => {
        released = true;
        stop?.();
      };
    },
    [openAudio, trackLoad],
  );

  // Issue 184. The samples for the other hand, before any press and with no gesture. The newest
  // load of the instrument is the one that counts (`loadSeqRef`), so this leaves the samples to a
  // Play or a struck key that is loading them: a second load would make the instrument drop
  // theirs. A Play or a key that comes after wins the load; this one is then ignored and only
  // clears `preparing`. A failure is told once and is not tried again for the score.
  const prepare = useCallback(() => {
    const s = scoreRef.current;
    if (!s || prepareFailed.has(s) || preparingScoreRef.current === s) return;
    if (loadsRunningRef.current > 0) return;
    const needed = samplesFor(s);
    if (covers(loadedRef.current, needed)) return;
    let opened: { audio: AudioContext; instrument: Instrument };
    try {
      opened = openAudio();
    } catch {
      prepareFailed.add(s); // no Web Audio here: the walk goes on without sound, as a failed load
      return;
    }
    const { audio, instrument } = opened;
    const seq = ++prepSeqRef.current;
    const load = ++loadSeqRef.current;
    preparingScoreRef.current = s;
    setPreparing(true);
    const settle = () => {
      if (seq !== prepSeqRef.current) return;
      preparingScoreRef.current = null;
      setPreparing(false);
    };
    instrument.load(needed.midis, needed.velocities).then(
      () => {
        if (ctxRef.current === audio && load === loadSeqRef.current) loadedRef.current = needed;
        settle();
      },
      () => {
        if (ctxRef.current === audio && load === loadSeqRef.current) {
          prepareFailed.add(s);
          setFailedScore(s);
          if (scoreRef.current === s) useAppStore.getState().setNotice(SAMPLES_FAILED_NOTICE);
        }
        settle();
      },
    );
  }, [openAudio]);

  // Plays the other hand from now. It never makes the context: with no samples that cover the
  // score, or a context the browser still holds, there is nothing to sound and nothing is queued
  // (notes kept would all sound together on the first click). A context held stops what an
  // earlier press left queued, which would otherwise sound out of step when the audio returns.
  const accompany = useCallback((notes: readonly AccNote[]) => {
    const s = scoreRef.current;
    const ctx = ctxRef.current;
    const instrument = instrumentRef.current;
    if (!s || !ctx || !instrument) return;
    if (ctx.state !== 'running') {
      accompanistRef.current?.stop(); // never creates the Accompanist; what is queued must not wait
      return;
    }
    if (!covers(loadedRef.current, samplesFor(s))) return;
    let accompanist = accompanistRef.current;
    if (!accompanist) {
      const hooks = hooksOn();
      accompanist = new Accompanist({
        ctx,
        instrument: hooks
          ? recorded(instrument, accompaniedRef.current, accompCancelledRef.current)
          : instrument,
        // A note dropped from the queue never reaches the instrument: the hooks log it as cancelled.
        onDrop: hooks
          ? (e) => accompCancelledRef.current.push({ midi: e.midi, time: e.time })
          : undefined,
      });
      accompanistRef.current = accompanist;
    }
    accompanist.play(notes, tempoFactorOf(useAppStore.getState()));
  }, []);

  const pause = useCallback(() => {
    playSeqRef.current++;
    transportRef.current?.pause();
    pushLoop(); // after the pause: a stopped transport takes a loop without seeking
    setPlaying(false);
    setLoading(false);
    setCountIn(null);
    setWaiting(false);
  }, [pushLoop]);

  // Rewind while stopped puts the position back at the start: nothing to resume, so the paused
  // cursor clears (T10). While playing, the transport seeks and plays on from the start.
  const rewind = useCallback(() => {
    const t = transportRef.current;
    t?.rewind();
    pendingSecRef.current = null;
    pendingPerfRef.current = null;
    setCue(null);
    if (!t?.state.playing) setAtStart(true);
  }, []);

  // The play-along's cue (issue 182): `seek` in performance seconds. A written second enters a
  // bar going back at its last hearing, so a walk through a repeat made of `seek`s would loop the
  // first pass forever. Never `seek(0)`: that is a Rewind. A playing transport is left alone.
  const cueAt = useCallback((perfSec: number) => {
    const s = scoreRef.current;
    const t = transportRef.current;
    if (!s || !Number.isFinite(perfSec) || t?.state.playing) return;
    if (t) t.seekPerformance(perfSec);
    else {
      pendingPerfRef.current = perfSec;
      pendingSecRef.current = null;
    }
    setCue(toWrittenSec(performanceFor(s), perfSec));
    setAtStart(false);
  }, []);

  // The reader played the last step: what the transport's end does while stopped (onEnd above).
  const finish = useCallback(() => {
    if (!scoreRef.current || transportRef.current?.state.playing) return;
    rewind();
    setEnded((n) => n + 1);
  }, [rewind]);

  /** Where a position kept before the first Play stands, in performance seconds. */
  const pendingPerformanceSec = useCallback((s: Score): number => {
    if (pendingPerfRef.current !== null) return pendingPerfRef.current;
    const written = pendingSecRef.current;
    return written === null ? 0 : toPerformanceSec(performanceFor(s), written, 0);
  }, []);

  const positionSec = useCallback(() => {
    const t = transportRef.current;
    if (t) return t.positionSec();
    const s = scoreRef.current;
    if (s && pendingPerfRef.current !== null) {
      return toWrittenSec(performanceFor(s), pendingPerfRef.current);
    }
    return pendingSecRef.current ?? 0;
  }, []);

  // Before the first Play, apply the transport's loop bounds to the cue without replacing it:
  // removing a loop restores the original cue. The cursor compares this start with the position.
  const startPerformanceSec = useCallback(() => {
    const t = transportRef.current;
    if (t) return t.performanceStartSec();
    const s = scoreRef.current;
    if (!s) return 0;
    const base = pendingPerformanceSec(s);
    const range = loopStretch(performanceFor(s), loopRef.current, base);
    return range && (base < range.from || base >= range.to) ? range.from : base;
  }, [pendingPerformanceSec]);

  const startSec = useCallback(() => {
    const t = transportRef.current;
    if (t) return t.startSec();
    const s = scoreRef.current;
    if (s && pendingPerfRef.current !== null) {
      return toWrittenSec(performanceFor(s), startPerformanceSec());
    }
    const start = pendingSecRef.current ?? 0;
    return s ? loopStartSec(performanceFor(s), loopRef.current, start) : start;
  }, [startPerformanceSec]);

  // T13. Playing, the transport goes on from `sec` after the lead; stopped, it only moves where
  // Play starts (kept here until the first Play makes a transport). Before the first Play, a seek
  // after a cue of the play-along (issue 182) enters the bar going on from the hearing that cue is
  // in, as `Transport.seek` does with a transport; without a cue it takes the first hearing, as it
  // always has.
  const seek = useCallback(
    (sec: number, opts: { leadSec?: number } = {}) => {
      const t = transportRef.current;
      if (t?.state.playing) {
        t.seek(sec, opts);
        setCue(sec);
        return;
      }
      if (!(sec > 0)) {
        rewind();
        return;
      }
      const s = scoreRef.current;
      if (t) t.seek(sec);
      else if (s && pendingPerfRef.current !== null) {
        pendingPerfRef.current = toPerformanceSec(performanceFor(s), sec, startPerformanceSec());
        pendingSecRef.current = null;
      } else if (s) {
        pendingSecRef.current = sec;
        pendingPerfRef.current = null;
      } else return;
      setCue(sec);
      setAtStart(false);
    },
    [rewind, startPerformanceSec],
  );

  const performanceLoop = useCallback(() => {
    const t = transportRef.current;
    if (t) return t.performanceLoop();
    const s = scoreRef.current;
    return s ? loopStretch(performanceFor(s), loopRef.current, pendingPerformanceSec(s)) : null;
  }, [pendingPerformanceSec]);

  const leadingIn = useCallback(() => transportRef.current?.leadingIn() ?? false, []);

  const playingNow = useCallback(() => transportRef.current?.state.playing ?? false, []);

  const leadInRemainingSec = useCallback(
    () => transportRef.current?.leadInRemainingSec() ?? null,
    [],
  );

  // Issue 192: the timeline the play-along's timing maps each key to, and the passes of a run. A
  // new score drops the transport, and its run with it.
  const heardAt = useCallback((atMs?: number) => transportRef.current?.heardAt(atMs) ?? null, []);

  const runPasses = useCallback(() => transportRef.current?.runPasses() ?? [], []);

  // The loop state changes at once; a playing transport gets a new range once the typing settles
  // (clearing the loop never seeks, so it applies at once).
  const setLoop = useCallback(
    (r: LoopRange | null) => {
      const next = r ? { from: r.from, to: r.to } : null;
      loopRef.current = next;
      setLoopState(next);
      if (next && transportRef.current?.state.playing) {
        cancelLoopPush();
        loopTimerRef.current = setTimeout(pushLoop, LOOP_SETTLE_MS);
      } else {
        pushLoop();
      }
    },
    [cancelLoopPush, pushLoop],
  );

  // The sentence that asks for a click: the browser holds the context, the page has had no click
  // or key yet, and the samples did not fail (after a failure the click would sound nothing).
  const soundWaits =
    audioState === 'suspended' && !activated && (failedScore === null || failedScore !== score);

  return useMemo(
    () => ({
      playing,
      loading,
      countIn,
      waiting,
      atStart,
      ended,
      cue,
      loop,
      play,
      pause,
      rewind,
      seek,
      cueAt,
      finish,
      positionSec,
      startSec,
      startPerformanceSec,
      performanceLoop,
      leadingIn,
      playingNow,
      leadInRemainingSec,
      setLoop,
      strike,
      prepare,
      preparing,
      soundWaits,
      accompany,
      stopAccompaniment,
      heardAt,
      runPasses,
      playId,
    }),
    [
      playing,
      loading,
      countIn,
      waiting,
      atStart,
      ended,
      cue,
      loop,
      play,
      pause,
      rewind,
      seek,
      cueAt,
      finish,
      positionSec,
      startSec,
      startPerformanceSec,
      performanceLoop,
      leadingIn,
      playingNow,
      leadInRemainingSec,
      setLoop,
      strike,
      prepare,
      preparing,
      soundWaits,
      accompany,
      stopAccompaniment,
      heardAt,
      runPasses,
      playId,
    ],
  );
}
