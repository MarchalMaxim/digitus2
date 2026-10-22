// The orientation benchmark (issue 165). Run with `pnpm --filter @digitus2/web bench:orientation`.
// It is not a unit test: the name does not match vite.config.ts's `*.test.ts` include, because it
// needs Chromium (to render the acceptance pages and to decode the phone photos).
import { chromium, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readOrientation, rotateFrame } from './orientation';
import type { Frame } from './vision';

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const PHOTOS = `${ROOT}research/omr/photos`;
const OUT = `${ROOT}research/omr/results/orientation`;

interface Image {
  cls: 'rendered' | 'photo';
  id: string;
  upright: Frame;
}
interface Row {
  cls: Image['cls'];
  id: string;
  /** Clockwise quarter turns applied to the upright page. */
  k: number;
  expected: number;
  got: number | null;
  outcome: 'correct' | 'abstained' | 'wrong';
  side: number | null;
  confidence: number | null;
  hi: number;
  lo: number;
}

const rows: Row[] = [];
let browser: Browser;
let page: Page;
const images: Image[] = [];

async function decode(bytes: Buffer, mime: string): Promise<Frame> {
  const result = await page.evaluate(
    async ({ b64, mime }) => {
      const blob = await (await fetch(`data:${mime};base64,${b64}`)).blob();
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let text = '';
      for (let i = 0; i < data.length; i += 0x8000)
        text += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return { width: bitmap.width, height: bitmap.height, rgba: btoa(text) };
    },
    { b64: bytes.toString('base64'), mime },
  );
  const data = new Uint8ClampedArray(Buffer.from(result.rgba, 'base64'));
  return { width: result.width, height: result.height, data };
}

beforeAll(async () => {
  const corpus = JSON.parse(readFileSync(`${ROOT}research/omr/acceptance/corpus.json`, 'utf8')) as {
    version: string;
    slugs: string[];
  };
  // acceptance.mjs fills the same directory (named by the corpus version), so the two share the
  // rendered pages.
  const FIXTURES = `${ROOT}research/omr/results/acceptance/fixtures-${corpus.version}`;
  if (!existsSync(`${FIXTURES}/manifest.json`)) {
    if (existsSync(FIXTURES))
      throw new Error(`${FIXTURES} has no manifest.json; remove it and rerun`);
    execFileSync(
      process.execPath,
      ['research/omr/prepare.mjs', '--out', FIXTURES, '--slugs', corpus.slugs.join(',')],
      { cwd: ROOT, stdio: 'inherit' },
    );
  }
  const fixtures = JSON.parse(readFileSync(`${FIXTURES}/manifest.json`, 'utf8')) as {
    pieces: { id: string; pages: { images: { clean: string } }[] }[];
  };
  if (fixtures.pieces.map((p) => p.id).join(',') !== corpus.slugs.join(','))
    throw new Error(`${FIXTURES} holds another corpus; remove it and rerun`);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  for (const piece of fixtures.pieces)
    images.push({
      cls: 'rendered',
      id: piece.id,
      upright: await decode(
        readFileSync(`${FIXTURES}/${piece.pages[0]!.images.clean}`),
        'image/png',
      ),
    });
  const photos = JSON.parse(readFileSync(`${PHOTOS}/manifest.json`, 'utf8')) as {
    photos: { id: string; file: string; rotate?: number }[];
  };
  for (const photo of photos.photos) {
    const decoded = await decode(readFileSync(`${PHOTOS}/${photo.file}`), 'image/jpeg');
    const quarter = (((photo.rotate ?? 0) / 90) % 4) as 0 | 1 | 2 | 3;
    images.push({ cls: 'photo', id: photo.id, upright: rotateFrame(decoded, quarter) });
  }
}, 600_000);

describe('orientation benchmark', () => {
  it('has the 16 rendered pages and the 14 photos', () => {
    expect(images.filter((i) => i.cls === 'rendered')).toHaveLength(16);
    expect(images.filter((i) => i.cls === 'photo')).toHaveLength(14);
  });

  it('turns every image four ways', () => {
    for (const image of images)
      for (const k of [0, 1, 2, 3] as const) {
        const { orientation, evidence } = readOrientation(rotateFrame(image.upright, k));
        const expected = ((4 - k) % 4) * 90;
        rows.push({
          cls: image.cls,
          id: image.id,
          k,
          expected,
          got: orientation?.turn ?? null,
          outcome: !orientation ? 'abstained' : orientation.turn === expected ? 'correct' : 'wrong',
          side: evidence.side,
          confidence: orientation?.confidence ?? null,
          hi: evidence.hi,
          lo: evidence.lo,
        });
      }
    expect(rows).toHaveLength(images.length * 4);
  }, 900_000);

  it('gives no wrong turn on a rendered page', () => {
    expect(rows.filter((r) => r.cls === 'rendered' && r.outcome === 'wrong').map(label)).toEqual(
      [],
    );
  });

  it('gives no wrong turn on a phone photo', () => {
    expect(rows.filter((r) => r.cls === 'photo' && r.outcome === 'wrong').map(label)).toEqual([]);
  });

  it('abstains on at most 2 of the 14 photos turned 180 degrees', () => {
    const abstained = rows.filter(
      (r) => r.cls === 'photo' && r.k === 2 && r.outcome === 'abstained',
    );
    expect(abstained.map(label).length).toBeLessThanOrEqual(2);
  });
});

const label = (r: Row): string => `${r.id} @${r.k * 90}: expected ${r.expected}, got ${r.got}`;

afterAll(async () => {
  if (rows.length) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/benchmark.json`, `${JSON.stringify(rows, null, 2)}\n`);
    const lines = [
      '| class | applied turn | correct | abstained | wrong | side range |',
      '|---|---|---|---|---|---|',
    ];
    for (const cls of ['rendered', 'photo'] as const)
      for (const k of [0, 1, 2, 3]) {
        const set = rows.filter((r) => r.cls === cls && r.k === k);
        const count = (o: Row['outcome']): number => set.filter((r) => r.outcome === o).length;
        const sides = set.filter((r) => r.side !== null).map((r) => Math.abs(r.side!));
        const range = sides.length
          ? `${Math.min(...sides).toFixed(2)} to ${Math.max(...sides).toFixed(2)}`
          : 'none';
        lines.push(
          `| ${cls} | ${k * 90} | ${count('correct')} | ${count('abstained')} | ${count('wrong')} | ${range} |`,
        );
      }
    console.log(`\n${lines.join('\n')}\n`);
    for (const r of rows.filter((r) => r.outcome !== 'correct'))
      console.log(
        `${r.outcome} ${label(r)} side=${r.side?.toFixed(2) ?? 'none'} cov=${r.hi.toFixed(2)}/${r.lo.toFixed(2)}`,
      );
  }
  await browser?.close();
});
