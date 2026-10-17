import type { Hand } from '@digitus2/engine';
import type { SplendidGrandPiano } from 'smplr';

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
 * A note without a velocity of its own (no dynamics mark before it, no MIDI source) plays at its
 * hand's: the accompaniment slightly softer than the melody, both in the mezzo-forte layer.
 */
const HAND_VELOCITY: Record<Hand, number> = { R: 96, L: 88 };

/** The velocity a note plays at: its own (a dynamics mark, MIDI), else its hand's. */
export function noteVelocity(note: { velocity?: number; hand: Hand }): number {
  return note.velocity ?? HAND_VELOCITY[note.hand];
}

/**
 * The sampled piano: smplr's Splendid Grand Piano (public domain samples), loading only the
 * piece's pitches and the velocity layers its velocities fall in (rendering spike section 4.1:
 * about 2.5 MB per layer for an 8-bar piece instead of 19.5 MB for everything). smplr matches
 * samples by velocity, so a note outside the loaded layers would stay silent; its
 * `velocityRange` is one span, so the layers between the softest and the loudest load too.
 * `notesToLoad` is fixed at construction, so the sampler is created inside `load()`; smplr itself
 * is imported there too, which keeps it out of the entry chunk.
 */
export function createPiano(ctx: AudioContext): Instrument {
  let piano: SplendidGrandPiano | null = null;
  /** Counts `load()` calls: only the newest one may replace the piano. */
  let loads = 0;
  return {
    async load(midis, velocities) {
      const id = ++loads;
      const used = velocities.length > 0 ? new Set(velocities) : new Set([HAND_VELOCITY.R]);
      const velocityRange: [number, number] = [Math.min(...used), Math.max(...used)];
      const smplr = await import('smplr');
      if (id !== loads) return; // a newer load started while smplr was being imported
      const next = smplr.SplendidGrandPiano(ctx, {
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
      piano?.start({ note: e.midi, velocity: e.velocity, time: e.time, duration: e.duration });
    },
    stopAll() {
      piano?.stop();
    },
  };
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
