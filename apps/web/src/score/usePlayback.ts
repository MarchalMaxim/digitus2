/**
 * Playback for the score view: owns the AudioContext, the instrument and the look-ahead
 * Transport (audio/transport.ts), and mirrors the transport settings from the store into it.
 *
 * The AudioContext is created on the first play(), inside the click that asked for it, so the
 * browser lets it start. The instrument loads the piece's pitches once per score; Play is
 * unavailable and busy while it does. A new score stops playback and drops the transport and the
 * loop; unmounting also closes the context. A loop changed while playing reaches the transport
 * once the typing settles (LOOP_SETTLE_MS). The transport's count-in reports become `countIn`,
 * which the status line counts, and its lead-in reports become `waiting`, which the cursor waits
 * for (no note is marked before it sounds) while Pause keeps the red. `atStart` says whether a
 * stop left the position at the start (Rewind while stopped, the end) or away from it (a pause),
 * where the cursor keeps the last group heard marked (T10).
 *
 * The transport module is a lazy chunk, fetched as soon as a score is open: it reads the beat
 * grid through the engine's public API, and any runtime import of the engine brings
 * @xmldom/xmldom (CommonJS, which the bundler cannot drop) into the chunk that holds it. Imported
 * statically it would push the library page's initial JavaScript past its 150 KB gzip budget.
 */
import type { Hand, Score } from '@digitus2/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tempoFactorOf, useAppStore, type HandsMode } from '../app/store.js';
import { instrumentFromLocation, type Instrument } from '../audio/instrument.js';
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
  play(): void;
  pause(): void;
  rewind(): void;
  /** The score time being heard now, in seconds (0 before the first play). */
  positionSec(): number;
  /**
   * Whether the transport is in a lead-in at the time being heard now, read on every frame:
   * `waiting` follows it on the transport's next scheduler tick, so after a loop wrap to a start
   * where the hands played rest, the cursor keeps its marks until then rather than mark a note
   * of the new pass before it sounds. False when stopped.
   */
  leadingIn(): boolean;
  loop: LoopRange | null;
  setLoop(r: LoopRange | null): void;
}

/** Sample-load failures, told apart from a failed fetch of the player chunk. */
class SamplesError extends Error {}

/**
 * A loop changed while playing reaches the transport this long after the last change. A playing
 * transport jumps to the loop's start when the position lies outside it, so a range typed one
 * keystroke at a time ("1", then "12") would otherwise jump at the "1".
 */
export const LOOP_SETTLE_MS = 400;

export const SAMPLES_FAILED_NOTICE =
  'The piano sounds could not be loaded. Check the connection and press Play again.';
export const PLAYER_FAILED_NOTICE =
  'The player could not be loaded. Check the connection and press Play again.';

/** The hands the transport silences for a hands setting. */
export function mutedHandsFor(hands: HandsMode): Hand[] {
  if (hands === 'R') return ['L'];
  if (hands === 'L') return ['R'];
  return [];
}

function uniqueMidis(score: Score): number[] {
  return [...new Set(score.notes.map((n) => n.midi))];
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
  const [loop, setLoopState] = useState<LoopRange | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const instrumentRef = useRef<Instrument | null>(null);
  const transportRef = useRef<TransportExports.Transport | null>(null);
  /** The score whose pitches the instrument has loaded. */
  const loadedRef = useRef<Score | null>(null);
  const scoreRef = useRef<Score | null>(score);
  const loopRef = useRef<LoopRange | null>(null);
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
    setPlaying(false);
    setLoading(false);
    setCountIn(null);
    setWaiting(false);
    setAtStart(true);
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

  // The store's transport settings, mirrored into a transport that exists (new ones copy them).
  useEffect(() => {
    const t = transportRef.current;
    if (!t) return;
    t.setTempoFactor(tempoFactor);
    t.setMuted(mutedHandsFor(hands));
    t.setMetronome(metronome);
    t.setCountIn(countInOn);
  }, [tempoFactor, hands, metronome, countInOn]);

  const play = useCallback(() => {
    const s = scoreRef.current;
    if (!s || transportRef.current?.state.playing) return;
    const seq = ++playSeqRef.current;
    let ctx = ctxRef.current;
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: 'interactive' });
      ctxRef.current = ctx;
      instrumentRef.current = instrumentFromLocation(ctx, window.location.search);
      loadedRef.current = null;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    const audio = ctx;
    const instrument = instrumentRef.current!;

    const start = (mod: TransportModule) => {
      if (seq !== playSeqRef.current || scoreRef.current !== s || ctxRef.current !== audio) return;
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
        // The end: back to the start, stopped; the cursor clears and Play is red again.
        transport.onEnd = () => {
          transport.rewind();
          setPlaying(false);
          setAtStart(true);
        };
        // The count-in, for the status line, and the lead-in, which the cursor waits for (it
        // marks nothing until the first note of the hands played is heard). A tick that ends
        // both reports both, so they reach the screen in one render.
        transport.onCountInBeat = (beat, beats, beatInBar) =>
          setCountIn({ beat, beats, beatInBar });
        transport.onCountInEnd = () => setCountIn(null);
        transport.onLeadInChange = setWaiting;
        transportRef.current = transport;
        t = transport;
      }
      pushLoop(); // stopped: the loop only sets where play() starts
      // play() reports a count-in's first beat and the lead-in at once, so they reach the screen
      // in the same render as playing: Pause takes the red from Play, and no note is marked.
      t.play();
      setPlaying(true);
      setAtStart(false);
      // Every Play marks the legend as seen and, for a library piece, makes it the one the
      // library offers to continue (spec 12 and 16).
      useAppStore.getState().markPlayed();
    };

    // Everything at hand (every Play after the first): start in the click itself.
    if (loadedRef.current === s && transportLoaded) {
      start(transportLoaded);
      return;
    }
    setLoading(true);
    const samples =
      loadedRef.current === s
        ? Promise.resolve()
        : instrument.load(uniqueMidis(s)).then(
            () => {
              if (ctxRef.current === audio) loadedRef.current = s;
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
  }, [pushLoop]);

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
    if (!t?.state.playing) setAtStart(true);
  }, []);

  const positionSec = useCallback(() => transportRef.current?.positionSec() ?? 0, []);

  const leadingIn = useCallback(() => transportRef.current?.leadingIn() ?? false, []);

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
      loop,
      play,
      pause,
      rewind,
      positionSec,
      leadingIn,
      setLoop,
    }),
    [
      playing,
      loading,
      countIn,
      waiting,
      atStart,
      loop,
      play,
      pause,
      rewind,
      positionSec,
      leadingIn,
      setLoop,
    ],
  );
}
