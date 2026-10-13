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
  /** Fetch what the given pitches need; resolves when they can be played. */
  load(midis: number[]): Promise<void>;
  start(e: NoteEvent): void;
  /** Silence everything that is sounding or scheduled. */
  stopAll(): void;
}

/**
 * The one velocity layer the piano loads (smplr's mezzo-forte layer). smplr matches samples by
 * velocity, so a note whose velocity lies outside this range finds no sample and stays silent;
 * `createPiano` clamps every velocity into it.
 */
export const PIANO_LAYER: readonly [number, number] = [85, 100];

/**
 * The sampled piano: smplr's Splendid Grand Piano (public domain samples), loading only the
 * piece's pitches and the mezzo-forte layer (about 2.5 MB instead of 19.5 MB, rendering spike
 * section 4.1). `notesToLoad` is fixed at construction, so the sampler is created inside
 * `load()`; smplr itself is imported there too, which keeps it out of the entry chunk.
 */
export function createPiano(ctx: AudioContext): Instrument {
  let piano: SplendidGrandPiano | null = null;
  /** Counts `load()` calls: only the newest one may replace the piano. */
  let loads = 0;
  return {
    async load(midis) {
      const id = ++loads;
      const smplr = await import('smplr');
      if (id !== loads) return; // a newer load started while smplr was being imported
      const next = smplr.SplendidGrandPiano(ctx, {
        notesToLoad: {
          notes: [...new Set(midis)],
          velocityRange: [PIANO_LAYER[0], PIANO_LAYER[1]],
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
      const velocity = Math.min(PIANO_LAYER[1], Math.max(PIANO_LAYER[0], e.velocity));
      piano?.start({ note: e.midi, velocity, time: e.time, duration: e.duration });
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
