import { notesOf, type Note } from './notes.js';
import { pitchTrack } from './pitch.js';
import { quantise, type Rhythm } from './rhythm.js';
import { toMusicXml } from './musicxml.js';
import { downsample, encodeWav, KEPT_RATE } from './wav.js';

/** What a recording becomes (issue 237): the notes found, their rhythm, the score and the file kept. */
export interface Transcription {
  notes: Note[];
  rhythm: Rhythm;
  xml: string;
  /** The recording as a mono 16-bit WAV at 16 kHz. */
  wav: Uint8Array;
}

/** The whole path from the microphone's samples to a score; null when no note was heard. */
export function transcribe(samples: Float32Array, sampleRate: number): Transcription | null {
  const kept = downsample(samples, sampleRate, KEPT_RATE);
  const notes = notesOf(pitchTrack(kept, KEPT_RATE));
  if (!notes.length) return null;
  const rhythm = quantise(notes);
  return { notes, rhythm, xml: toMusicXml(rhythm), wav: encodeWav(kept, KEPT_RATE) };
}
