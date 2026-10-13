export type Step = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type Alter = -2 | -1 | 0 | 1 | 2;
export interface Spelling {
  step: Step;
  alter: Alter;
  octave: number;
}

export const PIANO_MIN = 21;
export const PIANO_MAX = 108;

const STEP_SEMITONE: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES: ReadonlyArray<[Step, Alter]> = [
  ['C', 0],
  ['C', 1],
  ['D', 0],
  ['D', 1],
  ['E', 0],
  ['F', 0],
  ['F', 1],
  ['G', 0],
  ['G', 1],
  ['A', 0],
  ['A', 1],
  ['B', 0],
];
const FLAT_NAMES: ReadonlyArray<[Step, Alter]> = [
  ['C', 0],
  ['D', -1],
  ['D', 0],
  ['E', -1],
  ['E', 0],
  ['F', 0],
  ['G', -1],
  ['G', 0],
  ['A', -1],
  ['A', 0],
  ['B', -1],
  ['B', 0],
];
const BLACK = new Set([1, 3, 6, 8, 10]);

export function spellingToMidi(s: Spelling): number {
  return (s.octave + 1) * 12 + STEP_SEMITONE[s.step] + s.alter;
}

export function midiToSpelling(midi: number, prefer: 'sharp' | 'flat' = 'sharp'): Spelling {
  if (!Number.isInteger(midi)) throw new Error(`midi must be an integer, got ${midi}`);
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const [step, alter] = (prefer === 'flat' ? FLAT_NAMES : SHARP_NAMES)[pc]!;
  return { step, alter, octave };
}

export function isBlackKey(midi: number): boolean {
  return BLACK.has(((midi % 12) + 12) % 12);
}

const PIG_PITCH = /^([A-G])(#{1,2}|b{1,2})?(-?\d+)$/;

export function parsePigPitch(text: string): Spelling {
  const m = PIG_PITCH.exec(text.trim());
  if (!m) throw new Error(`invalid pitch string: ${JSON.stringify(text)}`);
  const step = m[1] as Step;
  const acc = m[2] ?? '';
  // `acc === ''` must give +0, not -0 (deep equality distinguishes them).
  const alter = (acc === '' ? 0 : acc.startsWith('#') ? acc.length : -acc.length) as Alter;
  return { step, alter, octave: Number(m[3]) };
}

export function formatPigPitch(s: Spelling): string {
  const acc = s.alter > 0 ? '#'.repeat(s.alter) : 'b'.repeat(-s.alter);
  return `${s.step}${acc}${s.octave}`;
}
