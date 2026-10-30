/**
 * The pickup detector over pieces it was never tuned on. The sample of docs/experiments.md, Pickup
 * bar of MIDI input, is the 2,500 PDMX pieces (https://zenodo.org/records/15571083, not committed)
 * listed in fixtures/pickup-heldout-list.txt, one path inside the dataset's mxl.tar.gz per line.
 * They were drawn with Python's random.Random(243).shuffle over the rows of PDMX.csv, in file
 * order, that are deduplicated, have one or two tracks, all on a piano program (0 to 7), and 150
 * to 3,000 notes. DIGITUS2_PICKUP_HELDOUT names a directory holding those files at those paths
 * (the test is skipped without it); `tar -xzf mxl.tar.gz -T pickup-heldout-list.txt` makes one.
 * Truth and measurement as in pickup.library.test.ts. A piece that is in the library (its file's
 * SHA-256 starts the library slug) is left out, since the library is what the ending conditions
 * were chosen on. The gate is the measured counts: at most 2 false pickups among the pieces that
 * open on a full bar, at most 1 wrong length, and a floor of right ones. A few PDMX files write the
 * pickup as part of a full first bar, and the detector then finds it, which counts as a false
 * pickup here. DIGITUS2_PICKUP_HELDOUT_MAX_BYTES limits the file size (default 60 KB, the
 * compressed size).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { unpackMusicXml } from '../musicxml/unpack.js';
import { parseMusicXml } from '../musicxml/read.js';
import { pickupTrial } from './pickup.truth.js';

const dir = process.env.DIGITUS2_PICKUP_HELDOUT;
const MAX_BYTES = Number(process.env.DIGITUS2_PICKUP_HELDOUT_MAX_BYTES ?? 60 * 1024);

/** The first eight hex digits of the SHA-256 of every PDMX piece in the library (its slug ends in them). */
function libraryHashes(): Set<string> {
  const manifest = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../../../content/manifest.json', import.meta.url)),
      'utf8',
    ),
  ) as Array<{ slug: string }>;
  return new Set(manifest.filter((p) => p.slug.startsWith('pdmx-')).map((p) => p.slug.slice(-8)));
}

/** The sample's paths, relative to the directory of the extracted dataset. */
function sample(): string[] {
  const list = readFileSync(new URL('./fixtures/pickup-heldout-list.txt', import.meta.url), 'utf8');
  return list.split(/\r?\n/).filter((line) => line !== '');
}

describe.skipIf(!dir)('pickup detection over held-out pieces', () => {
  it('finds at most 2 false pickups and 1 wrong length, and some right ones', async () => {
    const falsePickups: string[] = [];
    const wrong: string[] = [];
    let right = 0;
    let missed = 0;
    let fullBars = 0;
    const inLibrary = libraryHashes();
    for (const entry of sample()) {
      const path = join(dir!, entry);
      if (!existsSync(path)) continue;
      await new Promise((resolve) => setImmediate(resolve));
      if (statSync(path).size > MAX_BYTES) continue;
      const bytes = readFileSync(path);
      if (inLibrary.has(createHash('sha256').update(bytes).digest('hex').slice(0, 8))) continue;
      let trial;
      try {
        trial = pickupTrial(parseMusicXml(unpackMusicXml(bytes)).score);
      } catch {
        continue; // a file the reader cannot take is out of play
      }
      if (!trial) continue;
      const { truth, got } = trial;
      if (truth === 0) {
        fullBars++;
        if (got !== 0) falsePickups.push(`${entry}: ${got}`);
      } else if (got === truth) right++;
      else if (got !== 0) wrong.push(`${entry}: ${got}, not ${truth}`);
      else missed++;
    }
    console.log(JSON.stringify({ fullBars, right, missed, wrong, falsePickups }, null, 1));
    expect(fullBars).toBeGreaterThan(500);
    expect(falsePickups.length).toBeLessThanOrEqual(2);
    expect(wrong.length).toBeLessThanOrEqual(1);
    expect(right).toBeGreaterThanOrEqual(15);
  });
});
