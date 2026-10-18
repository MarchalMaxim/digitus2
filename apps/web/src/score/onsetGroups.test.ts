// @vitest-environment node
import { readFileSync } from 'node:fs';
import { parseMusicXml, type Note } from '@digitus2/engine';
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
  it('orders groups by tick whatever order the notes arrive in', () => {
    const note = (id: string, tick: number, sec: number, offsetSec: number) =>
      ({ id, onsetTick: tick, onsetSec: sec, offsetSec, hand: 'R' }) as unknown as Note;
    const groups = buildOnsetGroups({
      ...score,
      notes: [note('late', 960, 2, 2.5), note('early', 0, 0, 1), note('middle', 480, 1, 1.5)],
    });
    expect(groups.map((g) => g.tick)).toEqual([0, 480, 960]);
    expect(groups.map((g) => g.noteIds)).toEqual([['early'], ['middle'], ['late']]);
    expect(groups.map((g) => g.endSec)).toEqual([1, 2, 2.5]);
  });
  it('ends the last group when its longest note ends', () => {
    const note = (id: string, offsetSec: number) =>
      ({ id, onsetTick: 0, onsetSec: 1, offsetSec, hand: 'R' }) as unknown as Note;
    const [group] = buildOnsetGroups({
      ...score,
      notes: [note('short', 1.5), note('long', 3), note('middle', 2)],
    });
    expect(group!.endSec).toBe(3);
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
