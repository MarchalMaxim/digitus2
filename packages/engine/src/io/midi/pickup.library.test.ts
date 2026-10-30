/**
 * The pickup detector over the built-in library. The library's MusicXML gives the truth for each
 * piece: its first measure is short exactly when the piece starts on a pickup. The notes go to
 * the detector as a MIDI file would deliver them (on a 480-tick quarter, hands from the
 * automatic separation); only pieces whose first note starts at tick 0 are in play, since a file
 * that opens with silence is left alone. The gate is no false pickup, no wrong length, and a
 * floor of right ones so the rules cannot be tightened to nothing. A false pickup shifts every
 * bar number of a piece that was right, which costs a reader more than a missed one.
 *
 * The pieces above MAX_BYTES are left out to keep the run to about two minutes; set
 * DIGITUS2_PICKUP_FULL=1 to measure all of them. See docs/experiments.md, Pickup bar of MIDI input.
 */
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readLibraryScore } from '../../../cli/libraryScore.js';
import { parseMusicXml } from '../musicxml/read.js';
import { pickupTrial } from './pickup.truth.js';

const repo = new URL('../../../../../', import.meta.url);
const read = (path: string) => fileURLToPath(new URL(path, repo));
const MAX_BYTES = process.env.DIGITUS2_PICKUP_FULL ? Infinity : 15 * 1024;
/** A floor of right pickups, so a rule tightened to nothing fails (the library has 60, 34 of them under the size cap). */
const MIN_RIGHT = process.env.DIGITUS2_PICKUP_FULL ? 55 : 30;

interface Entry {
  slug: string;
  files: { score: string };
}

describe('pickup detection over the built-in library', () => {
  it('finds no false pickup and no wrong length, and finds the pickups it can', async () => {
    const manifest = JSON.parse(readFileSync(read('content/manifest.json'), 'utf8')) as Entry[];
    const falsePickups: string[] = [];
    const wrong: string[] = [];
    let right = 0;
    let fullBars = 0;
    for (const entry of manifest) {
      // Yield, so a minute of parsing does not starve the worker's link to the runner.
      await new Promise((resolve) => setImmediate(resolve));
      const path = read(`content/${entry.files.score}`);
      if (statSync(path).size > MAX_BYTES) continue;
      const trial = pickupTrial(parseMusicXml(readLibraryScore(path)).score);
      if (!trial) continue;
      const { truth, got } = trial;
      if (truth === 0) {
        fullBars++;
        if (got !== 0) falsePickups.push(`${entry.slug}: ${got}`);
      } else if (got === truth) right++;
      else if (got !== 0) wrong.push(`${entry.slug}: ${got}, not ${truth}`);
    }
    expect(fullBars).toBeGreaterThan(1000);
    expect(falsePickups).toEqual([]);
    expect(wrong).toEqual([]);
    expect(right).toBeGreaterThanOrEqual(MIN_RIGHT);
  });
});
