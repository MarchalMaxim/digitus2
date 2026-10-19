// The level port against content/tools/level.py's records on the library: for every level 1 and 2
// piece, the proposal equals verification[slug].levelProposal.level, and the score equals the
// recorded score except on the five pieces where the engine reader drops duplicate notes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readLibraryScore } from '../../cli/libraryScore.js';
import { parseMusicXml } from '../io/musicxml/read.js';
import { levelFeatures, levelScore, proposeLevel, round3 } from './level.js';

const repo = new URL('../../../../', import.meta.url);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, repo)), 'utf8');

/** The engine reader keeps the first of two notes with the same hand, onset and pitch. */
const FEWER_NOTES = new Set([
  'schumann-op68-no1-melody',
  'schumann-op68-no3-humming-song',
  'pdmx-minuet-in-g-major-2c1f15aa',
  'pdmx-minuet-in-g-major-bmv-114-j-s-bach-da5cac7a',
  'pdmx-alan-walker-faded-253f3eb9',
]);

describe('the level heuristic on the library', () => {
  it('matches level.py on every level 1 and 2 piece', () => {
    const manifest = JSON.parse(read('content/manifest.json')) as Array<{
      slug: string;
      level: number;
      tempoBpm: number;
      files: { score: string };
    }>;
    const verification = JSON.parse(read('content/verification.json')) as Record<
      string,
      { levelProposal: { score: number; level: number } }
    >;
    const pieces = manifest.filter((p) => p.level === 1 || p.level === 2);
    const levelOff: string[] = [];
    const farOff: string[] = [];
    const scoreOff: string[] = [];
    for (const p of pieces) {
      const record = verification[p.slug]!.levelProposal;
      const path = fileURLToPath(new URL(`content/${p.files.score}`, repo));
      const { score } = parseMusicXml(readLibraryScore(path));
      const s = round3(levelScore(levelFeatures(score, p.tempoBpm)));
      if (proposeLevel(s) !== record.level)
        levelOff.push(`${p.slug}: ${proposeLevel(s)} != ${record.level}`);
      if (!(Math.abs(s - record.score) <= 0.1)) farOff.push(`${p.slug}: ${s} != ${record.score}`);
      if (s !== record.score) scoreOff.push(p.slug);
    }
    expect(pieces.length).toBeGreaterThan(0);
    expect(levelOff).toEqual([]);
    expect(farOff).toEqual([]);
    expect(scoreOff.sort()).toEqual([...FEWER_NOTES].sort());
  }, 60_000);
});
