import type { Hand } from '@digitus2/engine';
import { UNMARKED_VELOCITY } from '@digitus2/engine/score-build';
import type { SplendidGrandPiano } from 'smplr';
import { pianoSampleBaseUrl, pianoStorage } from './pianoSamples.js';

/** One note to sound, in context seconds. */
export interface NoteEvent {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
  hand: Hand;
}

/**
 * One note of the accompaniment (issue 184): when it sounds after the press that starts its
 * stretch, and for how long, both in performance seconds (the scheduler divides by the tempo).
 */
export interface AccNote {
  offsetSec: number;
  durationSec: number;
  midi: number;
  velocity: number;
  hand: Hand;
}

export interface Instrument {
  /** Fetch what the given pitches at the given velocities need; resolves when they can be played. */
  load(midis: number[], velocities: number[]): Promise<void>;
  /**
   * Schedules a note; returns its own stop (issue 184): called before `e.time` the note never
   * sounds, called later it is released. Other notes of the same pitch are untouched.
   */
  start(e: NoteEvent): () => void;
  /**
   * Sounds `midi` now at `velocity`, for `maxSec` at most (a key clicked on the on-screen
   * keyboard, issue #96); the function returned stops it sooner (the release). Silent, and the
   * release harmless, before `load()` has resolved.
   */
  strike(midi: number, velocity: number, maxSec: number): () => void;
  /** Silence everything that is sounding or scheduled. */
  stopAll(): void;
}

/**
 * The velocity a note plays at: its own (a dynamics mark or hairpin, MIDI), else its hand's
 * (`UNMARKED_VELOCITY`, the accompaniment slightly softer than the melody).
 */
export function noteVelocity(note: { velocity?: number; hand: Hand }): number {
  return note.velocity ?? UNMARKED_VELOCITY[note.hand];
}

/**
 * The softest velocity the piano plays. smplr's softest layer (1 to 40) is its pp samples through
 * a 1 kHz low-pass filter, which sounds as if played through a towel; a softer note (a long
 * diminuendo, a MIDI file) plays at this floor instead, on the pp layer.
 */
export const PIANO_SOFTEST = 41;

/**
 * The sampled piano: smplr's Splendid Grand Piano (public domain samples), loading only the
 * piece's pitches and the velocity layers its velocities fall in (rendering spike section 4.1:
 * about 2.5 MB per layer for an 8-bar piece instead of 19.5 MB for everything). smplr matches
 * samples by velocity, so a note outside the loaded layers would stay silent; its
 * `velocityRange` is one span, so the layers between the softest and the loudest load too.
 * `notesToLoad` is fixed at construction, so the sampler is created inside `load()`; smplr itself
 * is imported there too, which keeps it out of the entry chunk. The samples come from the app's own
 * site (`<base>piano/`, see pianoSamples.ts); Safari fetches the `.m4a` files, other browsers the
 * `.ogg` ones.
 */
export function createPiano(ctx: AudioContext): Instrument {
  let piano: SplendidGrandPiano | null = null;
  /** Counts `start()` calls: each note gets its own smplr `stopId` (it defaults to the pitch). */
  let seq = 0;
  /** Counts `load()` calls: only the newest one may replace the piano. */
  let loads = 0;
  return {
    async load(midis, velocities) {
      const id = ++loads;
      const used = new Set((velocities.length > 0 ? velocities : [UNMARKED_VELOCITY.R]).map(floor));
      const velocityRange: [number, number] = [Math.min(...used), Math.max(...used)];
      const smplr = await import('smplr');
      if (id !== loads) return; // a newer load started while smplr was being imported
      const next = smplr.SplendidGrandPiano(ctx, {
        baseUrl: pianoSampleBaseUrl(import.meta.env.BASE_URL),
        formats: ['ogg', 'm4a'],
        storage: pianoStorage(),
        notesToLoad: {
          notes: [...new Set(midis)],
          velocityRange,
          fallback: 'nearest',
        },
      });
      try {
        await next.ready;
      } catch (e) {
        next.dispose(); // the samples failed to load; do not leave the sampler on the destination
        throw e;
      }
      if (id !== loads) {
        next.dispose(); // superseded while its samples were loading
        return;
      }
      piano?.dispose();
      piano = next;
    },
    start(e) {
      const stop = piano?.start({
        note: e.midi,
        velocity: floor(e.velocity),
        time: e.time,
        duration: e.duration,
        stopId: `n${++seq}`,
      });
      return () => stop?.();
    },
    strike(midi, velocity, maxSec) {
      const stop = piano?.start({ note: midi, velocity: floor(velocity), duration: maxSec });
      return () => stop?.();
    },
    stopAll() {
      piano?.stop();
    },
  };
}

function floor(velocity: number): number {
  return Math.max(PIANO_SOFTEST, velocity);
}

/** Records what it is asked to play and makes no sound (tests and `?audio=silent`). */
export function createSilentInstrument(): Instrument & {
  events: NoteEvent[];
  /** The keys struck from the keyboard, and the pitches released since. */
  strikes: { midi: number; velocity: number; maxSec: number }[];
  released: number[];
  /** The events whose own stop was called (issue 184), once each, in the order stopped. */
  cancelled: NoteEvent[];
  stopAllCalls: number;
} {
  const silent = {
    events: [] as NoteEvent[],
    strikes: [] as { midi: number; velocity: number; maxSec: number }[],
    released: [] as number[],
    cancelled: [] as NoteEvent[],
    stopAllCalls: 0,
    load: () => Promise.resolve(),
    start(e: NoteEvent) {
      silent.events.push(e);
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        silent.cancelled.push(e);
      };
    },
    strike(midi: number, velocity: number, maxSec: number) {
      silent.strikes.push({ midi, velocity, maxSec });
      return () => {
        silent.released.push(midi);
      };
    },
    stopAll() {
      silent.stopAllCalls++;
    },
  };
  return silent;
}

/** `?audio=silent` selects the silent instrument (Playwright runs need no network or sound). */
export function instrumentFromLocation(ctx: AudioContext, search: string): Instrument {
  return new URLSearchParams(search).get('audio') === 'silent'
    ? createSilentInstrument()
    : createPiano(ctx);
}
