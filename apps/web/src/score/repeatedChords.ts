import type { Assignment, Note, Score } from '@digitus2/engine';

/**
 * The notes the score draws without a digit (issue 253): a chord (two or more notes of one hand
 * struck together, grace notes aside) that repeats an earlier chord of the same hand in the same
 * bar, the same pitches with the same fingers, as an edition leaves it bare. The first chord of
 * every bar keeps its digits. Notes without a finger in `assignment` take no part.
 */
export function repeatedChordIds(score: Score, assignment: Assignment): Set<string> {
  const chords = new Map<string, Note[]>();
  for (const n of score.notes) {
    if (n.isGrace || !assignment[n.id]) continue;
    const key = `${n.hand}|${n.measureIndex}|${n.onsetTick}`;
    const chord = chords.get(key);
    if (chord) chord.push(n);
    else chords.set(key, [n]);
  }
  const seen = new Set<string>();
  const bare = new Set<string>();
  const inTime = [...chords.values()].sort((a, b) => a[0]!.onsetTick - b[0]!.onsetTick);
  for (const chord of inTime) {
    if (chord.length < 2) continue;
    const digits = chord
      .map((n) => {
        const a = assignment[n.id]!;
        return `${n.midi}:${a.finger}:${a.substitution ?? ''}`;
      })
      .sort()
      .join(',');
    const key = `${chord[0]!.hand}|${chord[0]!.measureIndex}|${digits}`;
    if (seen.has(key)) for (const n of chord) bare.add(n.id);
    else seen.add(key);
  }
  return bare;
}
