import { formatPigPitch } from '../../score/pitch.js';
import type { Assignment, Score } from '../../score/types.js';
import { PIG_HEADER } from './read.js';

/**
 * Real PIG files write seconds with a variable number of decimals (0 to 8, trailing zeros
 * dropped, `0` for zero), so use the shortest exact decimal form instead of a fixed width,
 * which would round 7- and 8-decimal values. Fall back to fixed notation if JavaScript
 * would otherwise produce an exponent.
 */
function seconds(x: number): string {
  const s = String(x);
  if (!/e/i.test(s)) return s;
  return x.toFixed(9).replace(/\.?0+$/, '');
}

export function writePig(score: Score, assignment: Assignment = {}): string {
  const ordered = [...score.notes].sort(
    (a, b) => (a.sourceIndices[0] ?? 0) - (b.sourceIndices[0] ?? 0) || a.onsetTick - b.onsetTick || a.midi - b.midi,
  );
  const lines = [PIG_HEADER];
  for (const n of ordered) {
    const a = assignment[n.id];
    const sign = n.hand === 'L' ? -1 : 1;
    const finger = a
      ? a.substitution !== undefined
        ? `${sign * a.finger}_${sign * a.substitution}`
        : `${sign * a.finger}`
      : '0';
    const vel = n.velocity ?? 80;
    lines.push(
      [n.id, seconds(n.onsetSec), seconds(n.offsetSec), formatPigPitch(n.spelling), vel, vel, n.hand === 'L' ? 1 : 0, finger].join(
        '\t',
      ),
    );
  }
  return lines.join('\n') + '\n';
}
