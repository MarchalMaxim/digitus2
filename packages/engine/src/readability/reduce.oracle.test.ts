import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Assignment, Finger } from '../score/types.js';
import { readManifest, readPlainScore } from '../../cli/libraryPieces.js';
import { greedyReduction } from './reduce.js';

/*
 * The engine's unbudgeted pass against the study's reduction (research/readability/reduce.py,
 * `minimal_sufficient`) on the right hand of the editorial core30 pieces that have no grace notes,
 * note for note. The fixture holds the engine's fingers of those hands and the note ids the study
 * prints; research/readability/oracle_rh.py writes it from a PIG export of the engine's fingering.
 * Both readers are the same rules over the same slices here: R0 to R4, the thumb side first in a
 * chord (the lowest pitch, which is what the study adds first, in the right hand), no pinned
 * notes, no low-confidence digits and no repeat memory (R5 is the engine's deliberate addition).
 * The left hand is not compared: the study adds the lowest wrong note of a chord, which is the
 * thumb side only in the right hand.
 */

interface OracleFile {
  [slug: string]: { fingers: Array<[string, number]>; printed: string[] };
}
const oracle = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../../../research/readability/fixtures/reduction_oracle_rh.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as OracleFile;

describe('the unbudgeted pass against the study’s reduction', () => {
  const entries = new Map(readManifest().map((e) => [e.slug, e]));
  it('covers the editorial core30 pieces without grace notes', () => {
    expect(Object.keys(oracle).sort()).toEqual([
      'beethoven-moonlight-sonata-mvt1',
      'burgmuller-op100-no1-la-candeur',
      'burgmuller-op100-no2-arabesque',
      'burgmuller-op100-no5-innocence',
      'chopin-waltz-op69-no2',
      'schumann-op68-no1-melody',
    ]);
  });

  for (const [slug, expected] of Object.entries(oracle)) {
    it(`${slug}: the right hand prints the same notes`, () => {
      const score = readPlainScore(entries.get(slug)!);
      const full: Assignment = Object.fromEntries(
        expected.fingers.map(([id, f]) => [id, { finger: f as Finger, source: 'engine' as const }]),
      );
      const rightHand = new Set(score.notes.filter((n) => n.hand === 'R').map((n) => n.id));
      expect(new Set(expected.fingers.map(([id]) => id))).toEqual(rightHand);
      const { printed } = greedyReduction(score, full, { lowConfidence: false, memory: false });
      const ours = [...printed].sort();
      const theirs = [...expected.printed].sort();
      expect({ count: ours.length, only: ours.filter((x) => !theirs.includes(x)) }).toEqual({
        count: theirs.length,
        only: [],
      });
      expect(ours).toEqual(theirs);
    });
  }
});
