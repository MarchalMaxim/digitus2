/**
 * Playback for the score view: owns the AudioContext, the instrument and the look-ahead
 * Transport (audio/transport.ts), and mirrors the transport settings from the store into it.
 *
 * The AudioContext is created on the first play(), inside the click that asked for it, so the
 * browser lets it start. The instrument loads the piece's pitches once per score; Play is
 * unavailable and busy while it does. A new score stops playback and drops the transport and the
 * loop; unmounting also closes the context. A loop changed while playing reaches the transport
 * once the typing settles (LOOP_SETTLE_MS).
 *
 * The transport module is a lazy chunk, fetched as soon as a score is open: it reads the beat
 * grid through the engine's public API, and any runtime import of the engine brings
 * @xmldom/xmldom (CommonJS, which the bundler cannot drop) into the chunk that holds it. Imported
 * statically it would push the library page's initial JavaScript past its 150 KB gzip budget.
 */
import type { Hand, Score } from '@digitus2/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, type HandsMode } from '../app/store.js';
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

export interface Playback {
  playing: boolean;
  /** True while the instrument fetches the piece's samples after Play (Play is unavailable, busy). */
  loading: boolean;
  play(): void;
  pause(): void;
  rewind(): void;
  /** The score time being heard now, in seconds (0 before the first play). */
  positionSec(): number;
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
  const tempoFactor = useAppStore((s) => s.settings.tempoFactor);
  const hands = useAppStore((s) => s.settings.hands);
  const metronome = useAppStore((s) => s.settings.metronome);
  const countIn = useAppStore((s) => s.settings.countIn);

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
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
    t.setCountIn(countIn);
  }, [tempoFactor, hands, metronome, countIn]);

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
        const settings = useAppStore.getState().settings;
        transport.setTempoFactor(settings.tempoFactor);
        transport.setMuted(mutedHandsFor(settings.hands));
        transport.setMetronome(settings.metronome);
        transport.setCountIn(settings.countIn);
        // The end: back to the start, stopped; the cursor clears and Play is red again.
        transport.onEnd = () => {
          transport.rewind();
          setPlaying(false);
        };
        transportRef.current = transport;
        t = transport;
      }
      pushLoop(); // stopped: the loop only sets where play() starts
      t.play();
      setPlaying(true);
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
  }, [pushLoop]);

  const rewind = useCallback(() => {
    transportRef.current?.rewind();
  }, []);

  const positionSec = useCallback(() => transportRef.current?.positionSec() ?? 0, []);

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
    () => ({ playing, loading, loop, play, pause, rewind, positionSec, setLoop }),
    [playing, loading, loop, play, pause, rewind, positionSec, setLoop],
  );
}
