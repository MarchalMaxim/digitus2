// @vitest-environment node
import { readFileSync } from 'node:fs';
import { parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { buildOnsetGroups, groupIndexAt, hasNotesFor } from './onsetGroups.js';

const { score } = parseMusicXml(
  readFileSync(new URL('../../fixtures/short-piano.musicxml', import.meta.url), 'utf8'),
);

describe('onset groups', () => {
  it('merges both hands by onset and covers every note once', () => {
    const groups = buildOnsetGroups(score);
    expect(groups[0]!.tick).toBe(0);
    expect(groups[0]!.noteIds.sort()).toEqual(['n0', 'n5', 'n6', 'n7']);
    expect(groups.flatMap((g) => g.noteIds)).toHaveLength(67);
    for (let i = 1; i < groups.length; i++)
      expect(groups[i]!.tick).toBeGreaterThan(groups[i - 1]!.tick);
    expect(groups[0]!.endSec).toBe(groups[1]!.sec);
  });
  it('finds the current group by time', () => {
    const groups = buildOnsetGroups(score);
    expect(groupIndexAt(groups, -0.1)).toBe(-1);
    expect(groupIndexAt(groups, 0)).toBe(0);
    expect(groupIndexAt(groups, 0.624)).toBe(0);
    expect(groupIndexAt(groups, 0.625)).toBe(1);
    expect(groupIndexAt(groups, 1e9)).toBe(groups.length - 1);
  });
  it('tells whether the unmuted hands have anything to play', () => {
    const groups = buildOnsetGroups(score);
    expect(hasNotesFor(groups, [])).toBe(true);
    expect(hasNotesFor(groups, ['L'])).toBe(true);
    expect(hasNotesFor(groups, ['R'])).toBe(true);
    expect(hasNotesFor(groups, ['L', 'R'])).toBe(false);
    const rightOnly = buildOnsetGroups({
      ...score,
      notes: score.notes.filter((n) => n.hand === 'R'),
    });
    expect(rightOnly.length).toBeGreaterThan(0);
    expect(hasNotesFor(rightOnly, ['L'])).toBe(true);
    expect(hasNotesFor(rightOnly, ['R'])).toBe(false);
    expect(hasNotesFor([], [])).toBe(false);
  });
});
