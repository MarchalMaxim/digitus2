// @vitest-environment node
import { readFileSync } from 'node:fs';
import { parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { handsFor, oneHanded } from './usePlayback.js';

const { score } = parseMusicXml(
  readFileSync(new URL('../../fixtures/short-piano.musicxml', import.meta.url), 'utf8'),
);
const rightOnly = { ...score, notes: score.notes.filter((n) => n.hand === 'R') };
const leftOnly = { ...score, notes: score.notes.filter((n) => n.hand === 'L') };

// Issue #112: on a piece with notes in one hand, the saved Hands choice could pick the empty hand
// and leave Play red with nothing to play. Such a piece plays with both hands, whatever is saved.
describe('the hands a piece plays', () => {
  it('follows the setting when both hands have notes', () => {
    for (const hands of ['both', 'R', 'L'] as const) expect(handsFor(score, hands)).toBe(hands);
    expect(oneHanded(score)).toBe(false);
  });
  it('plays a one-hand piece with both hands, whichever hand is saved', () => {
    for (const piece of [rightOnly, leftOnly]) {
      expect(oneHanded(piece)).toBe(true);
      for (const hands of ['both', 'R', 'L'] as const) expect(handsFor(piece, hands)).toBe('both');
    }
  });
  it('leaves a piece with no notes, or no piece, to the setting', () => {
    const empty = { ...score, notes: [] };
    expect(oneHanded(empty)).toBe(false);
    expect(handsFor(empty, 'L')).toBe('L');
    expect(oneHanded(null)).toBe(false);
    expect(handsFor(null, 'R')).toBe('R');
  });
});
