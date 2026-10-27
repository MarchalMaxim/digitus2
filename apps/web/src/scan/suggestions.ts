/**
 * homr's other readings of a note's pitch (issue 130). homr's decoder keeps the three most
 * probable pitch and accidental tokens of every note (the confidence patch, notes.ts). The review
 * offers at most SUGGESTIONS of the pitches they spell, most probable first, other than the pitch
 * the note has now, and only those at or above SUGGESTION_FLOOR: a pitch homr all but ruled out is
 * no help. Accepting one is an ordinary pitch correction. The floor and the count come from the
 * confidence benchmark (research/omr/confidence.mjs, docs/research/omr.md).
 */
import type { ScanNote, Step } from './notes.js';
import { midiOf } from './notes.js';

export const SUGGESTIONS = 2;
export const SUGGESTION_FLOOR = 0.01;

/** homr's accidental head is the sounding alteration: '_' is natural, whatever the key. */
const LIFT: Record<string, number> = { _: 0, N: 0, '#': 1, '##': 2, b: -1, bb: -2 };

export interface PitchSuggestion {
  step: Step;
  alter: number;
  octave: number;
  probability: number;
}

export function pitchSuggestions(note: ScanNote): PitchSuggestion[] {
  const c = note.confidence;
  if (note.rest || !note.step || !c?.pitch) return [];
  const best = new Map<number, PitchSuggestion>();
  for (const [pitch, pp] of c.pitch) {
    const m = /^([A-G])(\d)$/.exec(pitch);
    if (!m) continue;
    for (const [lift, pl] of c.lift ?? [['_', 1]]) {
      const alter = LIFT[lift];
      if (alter === undefined) continue;
      const step = m[1] as Step;
      const octave = Number(m[2]);
      const midi = midiOf(step, alter, octave);
      if (midi === note.midi) continue;
      const probability = pp * pl;
      if ((best.get(midi)?.probability ?? -1) < probability)
        best.set(midi, { step, alter, octave, probability });
    }
  }
  return [...best.values()]
    .filter((s) => s.probability >= SUGGESTION_FLOOR)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, SUGGESTIONS);
}
