/**
 * Synthetic whistles for the tests of the transcription and for the fake microphone of the e2e
 * (issue 237): a tone of a given pitch with a little second harmonic, optional vibrato, a glide
 * into each note and noise. Pure, deterministic and free of browser code, so the Playwright helper
 * imports it too. Not imported by the app.
 */

/** A sounded note: `midi` is the pitch heard, in seconds from the start of the signal. */
export interface ToneNote {
  midi: number;
  start: number;
  end: number;
}

export interface SynthOptions {
  sampleRate?: number;
  /** Length of the signal in seconds; by default the end of the last note plus half a second. */
  length?: number;
  /** Amplitude of the second harmonic relative to the fundamental. */
  harmonic?: number;
  vibratoCents?: number;
  vibratoHz?: number;
  /** Each note starts this long before its pitch is reached, sliding up or down from the last. */
  glideMs?: number;
  /** White noise at this level in dB relative to the tone, present in the silences too. */
  noiseDb?: number;
  seed?: number;
}

const AMPLITUDE = 0.4;
const RAMP_S = 0.008;

export const hzOfMidi = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A small seeded generator (mulberry32), so a signal is the same on every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthesize(notes: readonly ToneNote[], options: SynthOptions = {}): Float32Array {
  const {
    sampleRate = 16000,
    harmonic = 0.1,
    vibratoCents = 0,
    vibratoHz = 5,
    glideMs = 0,
    noiseDb = -Infinity,
    seed = 1,
  } = options;
  const last = notes.reduce((end, n) => Math.max(end, n.end), 0);
  const out = new Float32Array(Math.round((options.length ?? last + 0.5) * sampleRate));
  const random = seeded(seed);
  const noise = AMPLITUDE * 10 ** (noiseDb / 20);
  let phase = 0;
  let index = 0;
  let previous = notes[0]?.midi ?? 69;
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    while (index < notes.length && notes[index]!.end <= t) previous = notes[index++]!.midi;
    const note = notes[index];
    let sample = 0;
    if (note && t >= note.start) {
      const into = (t - note.start) * 1000;
      const midi =
        glideMs > 0 && into < glideMs
          ? previous + (note.midi - previous) * (into / glideMs)
          : note.midi;
      const vibrato = vibratoCents
        ? (vibratoCents * Math.sin(2 * Math.PI * vibratoHz * t)) / 100
        : 0;
      phase += (2 * Math.PI * hzOfMidi(midi + vibrato)) / sampleRate;
      const ramp = Math.min(1, (t - note.start) / RAMP_S, (note.end - t) / RAMP_S);
      sample = AMPLITUDE * ramp * (Math.sin(phase) + harmonic * Math.sin(2 * phase));
    }
    if (noise > 0) {
      // Box-Muller, from two draws of the seeded generator.
      const gauss = Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
      sample += noise * gauss;
    }
    out[i] = sample;
  }
  return out;
}

/** A melody in beats: `midi` is the written pitch, or null for a rest. */
export interface Melody {
  name: string;
  bpm: number;
  notes: readonly { midi: number | null; beats: number }[];
}

export const ODE_TO_JOY: Melody = {
  name: 'Ode to Joy',
  bpm: 100,
  notes: [
    ...[64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64].map((midi) => ({ midi, beats: 1 })),
    { midi: 64, beats: 1.5 },
    { midi: 62, beats: 0.5 },
    { midi: 62, beats: 2 },
  ],
};

export const TWINKLE: Melody = {
  name: 'Twinkle',
  bpm: 96,
  notes: [
    ...[60, 60, 67, 67, 69, 69].map((midi) => ({ midi, beats: 1 })),
    { midi: 67, beats: 2 },
    ...[65, 65, 64, 64, 62, 62].map((midi) => ({ midi, beats: 1 })),
    { midi: 60, beats: 2 },
  ],
};

export const C_MAJOR_SCALE: Melody = {
  name: 'C major scale',
  bpm: 120,
  notes: [60, 62, 64, 65, 67, 69, 71, 72].map((midi) => ({ midi, beats: 1 })),
};

/** Runs of four sixteenths, then a rest of a beat, so the grid has to be finer than eighths. */
export const SIXTEENTHS: Melody = {
  name: 'Sixteenths',
  bpm: 80,
  notes: [
    ...[60, 62, 64, 65].map((midi) => ({ midi, beats: 0.25 })),
    { midi: 67, beats: 1 },
    { midi: null, beats: 1 },
    ...[69, 67, 65, 64].map((midi) => ({ midi, beats: 0.25 })),
    { midi: 62, beats: 1 },
    { midi: 60, beats: 2 },
  ],
};

/** A tune with a rest of a beat in the middle of the second bar. */
export const WITH_REST: Melody = {
  name: 'With a rest',
  bpm: 90,
  notes: [
    ...[64, 64, 67, 67].map((midi) => ({ midi, beats: 1 })),
    { midi: 65, beats: 1 },
    { midi: null, beats: 1 },
    { midi: 64, beats: 1 },
    { midi: 62, beats: 1 },
    { midi: 60, beats: 4 },
  ],
};

/** The first two bars of Ode to Joy, E E F G G F E D, for the e2e. */
export const ODE_TO_JOY_BARS: Melody = {
  ...ODE_TO_JOY,
  name: 'Ode to Joy, two bars',
  notes: ODE_TO_JOY.notes.slice(0, 8),
};

export interface Performance {
  /** The pitches heard, each separated from the next by a breath. */
  tones: ToneNote[];
  /** What a perfect transcription gives: the written pitches and where each starts, in beats. */
  written: { midi: number; beat: number; beats: number }[];
}

export interface PerformOptions {
  /** Whole octaves above the written pitch the melody is whistled at. */
  octaves?: number;
  bpm?: number;
  /** Silence before the first note, in seconds. */
  lead?: number;
  /** The breath between two notes, in seconds. */
  breath?: number;
  /** How far an onset strays from the pulse, in beats: a slow swell of the tempo and some jitter. */
  rubato?: number;
  seed?: number;
}

/** A melody played as a person would: a breath between notes and, optionally, an uneven pulse. */
export function perform(melody: Melody, options: PerformOptions = {}): Performance {
  const { octaves = 2, lead = 0.5, breath = 0.06, rubato = 0, seed = 7 } = options;
  const beat = 60 / (options.bpm ?? melody.bpm);
  const random = seeded(seed);
  const tones: ToneNote[] = [];
  const written: Performance['written'] = [];
  let at = 0;
  for (const note of melody.notes) {
    if (note.midi !== null) {
      const start = lead + at * beat;
      const stray =
        rubato * beat * (0.6 * Math.sin((2 * Math.PI * start) / 5) + 0.4 * (2 * random() - 1));
      tones.push({
        midi: note.midi + 12 * octaves,
        start: start + stray,
        end: start + stray + Math.max(0.05, note.beats * beat - breath),
      });
      written.push({ midi: note.midi, beat: at, beats: note.beats });
    }
    at += note.beats;
  }
  // A note never runs into the next one, whatever the pulse did.
  tones.forEach((tone, i) => {
    const next = tones[i + 1];
    if (next) tone.end = Math.min(tone.end, next.start - breath);
  });
  return { tones, written };
}
