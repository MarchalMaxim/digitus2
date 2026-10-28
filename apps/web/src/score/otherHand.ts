import type { Hand, Score } from '@digitus2/engine';
import { Accompanist } from '../audio/accompanist.js';
import type { AccNote, Instrument } from '../audio/instrument.js';
import type { Samples } from './usePlayback.js';

/**
 * The code that plays the hand the reader leaves out (issues 184 and 231): the `Accompanist`, the
 * just-in-time queue over the instrument, the pure choice of its stretches and notes, the
 * transport's own note list (`playEventsFor`) that they choose from, and the loading of the
 * samples before the first press (`prepare`). It is one lazy chunk: the switch is off until the
 * reader turns it on, so the library page never loads it. Only otherHandLoad.ts reaches it,
 * through `import()`; nothing else imports these modules statically (otherHand.test.ts holds that).
 */
export { Accompanist };
export { accompanimentNotes, accompanimentStretches } from './accompaniment.js';

/** What the accompaniment handed to the instrument (a test hook). */
export interface AccompaniedNote {
  midi: number;
  hand: Hand;
  time: number;
  duration: number;
  velocity: number;
}

/** A note of the accompaniment dropped from the queue, cancelled or released (a test hook). */
export interface DroppedNote {
  midi: number;
  time: number;
}

/**
 * The instrument as the Accompanist sees it under the test hooks: what the accompaniment hands
 * over and what it cancels or releases are logged, and nothing of Play's or a struck key's. The
 * silent instrument's own events also hold Play's notes, so the specs never read those.
 */
function recorded(
  inner: Instrument,
  handed: AccompaniedNote[],
  cancelled: DroppedNote[],
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

/**
 * The other hand's scheduler over the context and the instrument Play uses. Under the test hooks
 * (`logs`) the instrument is the recording one and a note dropped from the queue is logged beside
 * the stops of the notes that did sound.
 */
export function createAccompanist(
  ctx: AudioContext,
  instrument: Instrument,
  logs: { handed: AccompaniedNote[]; cancelled: DroppedNote[] } | null,
): Accompanist {
  return new Accompanist({
    ctx,
    instrument: logs ? recorded(instrument, logs.handed, logs.cancelled) : instrument,
    onDrop: logs ? (e) => logs.cancelled.push({ midi: e.midi, time: e.time }) : undefined,
  });
}

/** The scores whose `prepare` failed: it is not tried again for them. */
const prepareFailed = new WeakSet<Score>();

/** What the other hand reads and writes of the playback (usePlayback.ts): its refs, its audio, its state. */
export interface OtherHandHost {
  scoreRef: { readonly current: Score | null };
  ctxRef: { readonly current: AudioContext | null };
  loadedRef: { current: Samples | null };
  /** Counts the instrument's loads: only the newest one replaces its samples. */
  loadSeqRef: { current: number };
  /** How many loads Play or a struck key have running: `prepare` leaves the samples to them. */
  loadsRunningRef: { readonly current: number };
  /** Counts `prepare` loads: only the newest clears `preparing`. */
  prepSeqRef: { current: number };
  /** The score the running `prepare` loads for. */
  preparingScoreRef: { current: Score | null };
  openAudio(): { audio: AudioContext; instrument: Instrument };
  setPreparing(on: boolean): void;
  samplesFor(score: Score): Samples;
  covers(loaded: Samples | null, needed: Samples): boolean;
  /** The samples of `score` could not be loaded: no click is asked for, and the notice is told once. */
  failed(score: Score): void;
  instrumentRef: { readonly current: Instrument | null };
  /** The other hand's scheduler, made on the first `accompanyNotes` over the opened audio. */
  accompanistRef: { current: Accompanist | null };
  /** The test hooks' logs of what the accompaniment handed to the instrument and cancelled. */
  accompaniedRef: { readonly current: AccompaniedNote[] };
  accompCancelledRef: { readonly current: DroppedNote[] };
  /** The test hooks are on (`?audio=silent` or `?hooks=1`). */
  hooks(): boolean;
  /** The open piece's Practice tempo factor now. */
  tempoFactor(): number;
}

/**
 * Issue 184. The samples for the other hand, before any press and with no gesture. The newest
 * load of the instrument is the one that counts (`loadSeqRef`), so this leaves the samples to a
 * Play or a struck key that is loading them: a second load would make the instrument drop
 * theirs. A Play or a key that comes after wins the load; this one is then ignored and only
 * clears `preparing`. A failure is told once and is not tried again for the score.
 */
export function prepareSamples(h: OtherHandHost): void {
  const s = h.scoreRef.current;
  if (!s || prepareFailed.has(s) || h.preparingScoreRef.current === s) return;
  if (h.loadsRunningRef.current > 0) return;
  const needed = h.samplesFor(s);
  if (h.covers(h.loadedRef.current, needed)) return;
  let opened: { audio: AudioContext; instrument: Instrument };
  try {
    opened = h.openAudio();
  } catch {
    prepareFailed.add(s); // no Web Audio here: the walk goes on without sound, as a failed load
    return;
  }
  const { audio, instrument } = opened;
  const seq = ++h.prepSeqRef.current;
  const load = ++h.loadSeqRef.current;
  h.preparingScoreRef.current = s;
  h.setPreparing(true);
  const settle = () => {
    if (seq !== h.prepSeqRef.current) return;
    h.preparingScoreRef.current = null;
    h.setPreparing(false);
  };
  instrument.load(needed.midis, needed.velocities).then(
    () => {
      if (h.ctxRef.current === audio && load === h.loadSeqRef.current) h.loadedRef.current = needed;
      settle();
    },
    () => {
      if (h.ctxRef.current === audio && load === h.loadSeqRef.current) {
        prepareFailed.add(s);
        h.failed(s);
      }
      settle();
    },
  );
}

/**
 * Plays the other hand's notes from now (Accompanist.play at the Practice tempo factor). It never
 * makes the context: with no samples that cover the score, or a context the browser still holds,
 * there is nothing to sound and nothing is queued (notes kept would all sound together on the
 * first click). A context held stops what an earlier press left queued, which would otherwise
 * sound out of step when the audio returns.
 */
export function accompanyNotes(h: OtherHandHost, notes: readonly AccNote[]): void {
  const s = h.scoreRef.current;
  const ctx = h.ctxRef.current;
  const instrument = h.instrumentRef.current;
  if (!s || !ctx || !instrument) return;
  if (ctx.state !== 'running') {
    h.accompanistRef.current?.stop(); // never creates the Accompanist; what is queued must not wait
    return;
  }
  if (!h.covers(h.loadedRef.current, h.samplesFor(s))) return;
  // Under the hooks a note dropped from the queue never reaches the instrument: it is logged as cancelled.
  h.accompanistRef.current ??= createAccompanist(
    ctx,
    instrument,
    h.hooks()
      ? { handed: h.accompaniedRef.current, cancelled: h.accompCancelledRef.current }
      : null,
  );
  h.accompanistRef.current.play(notes, h.tempoFactor());
}

/** The events that are a user activation for the browser's autoplay policy: a click, a key. */
const ACTIVATION_EVENTS = ['pointerdown', 'pointerup', 'keydown'] as const;

/**
 * Calls `resume` on the first pointer or key press anywhere on the page (a capture listener, so a
 * click that something below handles still counts) until the returned function removes it: the
 * browser may hold the context suspended until the page has had one.
 */
export function onActivation(resume: () => void): () => void {
  for (const type of ACTIVATION_EVENTS) document.addEventListener(type, resume, true);
  return () => {
    for (const type of ACTIVATION_EVENTS) document.removeEventListener(type, resume, true);
  };
}
