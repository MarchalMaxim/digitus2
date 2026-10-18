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

export interface Instrument {
  /** Fetch what the given pitches at the given velocities need; resolves when they can be played. */
  load(midis: number[], velocities: number[]): Promise<void>;
  start(e: NoteEvent): void;
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
      await next.ready;
      if (id !== loads) {
        next.dispose(); // superseded while its samples were loading
        return;
      }
      piano?.dispose();
      piano = next;
    },
    start(e) {
      piano?.start({
        note: e.midi,
        velocity: floor(e.velocity),
        time: e.time,
        duration: e.duration,
      });
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
  stopAllCalls: number;
} {
  const silent = {
    events: [] as NoteEvent[],
    stopAllCalls: 0,
    load: () => Promise.resolve(),
    start(e: NoteEvent) {
      silent.events.push(e);
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
