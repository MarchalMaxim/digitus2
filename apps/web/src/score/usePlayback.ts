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
 * cursor marks its first note there until a note is heard.
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
import { instrumentFromLocation, noteVelocity, type Instrument } from '../audio/instrument.js';
import { keyVelocity } from './noteKey.js';
import { scheduleClick } from '../audio/metronome.js';
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
  /** The score time being heard now, in seconds (0 before the first play). */
  positionSec(): number;
  /**
   * While stopped, the score time Play starts from, in seconds: the position, or the loop's
   * first bar when the position lies outside the loop (0 before the first play). The paused
   * cursor marks the last group heard only when Play resumes at the position (T10).
   */
  startSec(): number;
  /**
   * Whether the transport is in a lead-in at the time being heard now, read on every frame:
   * `waiting` follows it on the transport's next scheduler tick, so after a loop wrap to a start
   * where the hands played rest, the cursor keeps its marks until then rather than mark a note
   * of the new pass before it sounds. False when stopped.
   */
  leadingIn(): boolean;
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
  const hands = useAppStore((s) => s.settings.hands);
  const metronome = useAppStore((s) => s.settings.metronome);
  const countInOn = useAppStore((s) => s.settings.countIn);

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [countIn, setCountIn] = useState<CountIn | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [ended, setEnded] = useState(0);
  const [loop, setLoopState] = useState<LoopRange | null>(null);
  const [cue, setCue] = useState<number | null>(null);
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
  /** A seek before the first Play, while there is no transport yet: where it will start. */
  const pendingSecRef = useRef<number | null>(null);
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

  /** Stops for good: cancels a pending start, drops the transport and forgets the loop. */
  const halt = useCallback(() => {
    playSeqRef.current++;
    cancelLoopPush();
    transportRef.current?.dispose();
    transportRef.current = null;
    loopRef.current = null;
    pendingSecRef.current = null;
    setPlaying(false);
    setLoading(false);
    setCountIn(null);
    setWaiting(false);
    setAtStart(true);
    setCue(null);
    setLoopState(null);
  }, [cancelLoopPush]);

  /** Silences the instrument and releases the audio device. */
  const release = useCallback(() => {
    instrumentRef.current?.stopAll();
    instrumentRef.current = null;
    loadedRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
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

  // Playwright's check of a key pressed on the keyboard (`?audio=silent` only): the pitches the
  // silent instrument was asked to strike, in order.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('audio') !== 'silent') return;
    const w = window as unknown as { __digitus2Keys?: { strikes(): number[] } };
    const hook = {
      strikes: () =>
        (instrumentRef.current as { strikes?: { midi: number }[] } | null)?.strikes?.map(
          (k) => k.midi,
        ) ?? [],
    };
    w.__digitus2Keys = hook;
    return () => {
      if (w.__digitus2Keys === hook) delete w.__digitus2Keys;
    };
  }, []);

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
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    return { audio: ctx, instrument: instrumentRef.current! };
  }, []);

  const play = useCallback(
    (opts: { resume?: boolean } = {}) => {
      const resume = opts.resume === true;
      const s = scoreRef.current;
      if (!s || transportRef.current?.state.playing) return;
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
            click: (time, accent) => scheduleClick(audio, time, accent),
          });
          const state = useAppStore.getState();
          const settings = state.settings;
          transport.setTempoFactor(tempoFactorOf(state));
          transport.setMuted(mutedHandsFor(settings.hands));
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
          if (pendingSecRef.current !== null) transport.seek(pendingSecRef.current);
          pendingSecRef.current = null;
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
        : instrument.load(needed.midis, needed.velocities).then(
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
    [openAudio, pushLoop],
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
        instrument.load(needed.midis, needed.velocities).then(
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
    [openAudio],
  );

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
    setCue(null);
    if (!t?.state.playing) setAtStart(true);
  }, []);

  // T13. Playing, the transport goes on from `sec` after the lead; stopped, it only moves where
  // Play starts (kept here until the first Play makes a transport).
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
      if (t) t.seek(sec);
      else if (scoreRef.current) pendingSecRef.current = sec;
      else return;
      setCue(sec);
      setAtStart(false);
    },
    [rewind],
  );

  const positionSec = useCallback(
    () => transportRef.current?.positionSec() ?? pendingSecRef.current ?? 0,
    [],
  );

  // Before the first Play, a cue (the score view keeps its seeks inside a loop) or the top.
  const startSec = useCallback(() => {
    const t = transportRef.current;
    if (t) return t.startSec();
    return pendingSecRef.current ?? 0;
  }, []);

  const leadingIn = useCallback(() => transportRef.current?.leadingIn() ?? false, []);

  const leadInRemainingSec = useCallback(
    () => transportRef.current?.leadInRemainingSec() ?? null,
    [],
  );

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
      positionSec,
      startSec,
      leadingIn,
      leadInRemainingSec,
      setLoop,
      strike,
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
      positionSec,
      startSec,
      leadingIn,
      leadInRemainingSec,
      setLoop,
      strike,
    ],
  );
}
