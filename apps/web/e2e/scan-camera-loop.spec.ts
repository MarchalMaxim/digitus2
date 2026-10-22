import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectCameraStopped, PAGE_PHOTO } from './helpers/camera.js';
import { expectReviewGrandStaff, expectScoreGrandStaff } from './helpers/grandStaff.js';
import { mockService } from './helpers/scan.js';
import { dialog, openPhotoCamera, photographPage, t } from './helpers/sweep.js';

// The whole scanning chain on this PC, without a phone (issue 156): a real photo of a printed page
// is filmed through the camera with tremor, perspective and noise; five photos are swept and fused
// into one page; local homr reads that page and, for comparison, the flat photo the camera filmed;
// the fused page's recognition must have the layout and the bars the page has; and the app joins,
// reviews and fingers it as a grand staff. The scan service is the only part that is mocked: it
// answers with the recognition this PC just made.
test.use({ isMobile: true, hasTouch: true });

const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const HOMR = resolve(
  ROOT,
  process.env.DIGITUS2_OMR_HOMR || 'research/omr/results/photo-options/toolchain',
);
const PYTHON = process.env.DIGITUS2_OMR_PYTHON || 'python';
const ENGINE = join(ROOT, 'packages/engine/dist/src/index.js');

/** Why the loop cannot run here, or null when it can (the scanning gate's own two conditions). */
function missing(): string | null {
  if (!existsSync(join(HOMR, 'venv')))
    return `homr is not prepared at ${HOMR}; set DIGITUS2_OMR_HOMR to a prepared homr folder`;
  const version = spawnSync(PYTHON, ['-c', 'import sys;print(sys.version_info[:2]>=(3,11))'], {
    encoding: 'utf8',
  });
  if (version.stdout?.trim() !== 'True')
    return `Python 3.11 or later is not on the PATH as "${PYTHON}" (set DIGITUS2_OMR_PYTHON to a Python 3.11 command, needed to run the homr in DIGITUS2_OMR_HOMR)`;
  return null;
}
const unavailable = missing();
test.skip(
  unavailable !== null,
  `The scanning loop needs a prepared homr (DIGITUS2_OMR_HOMR) and Python 3.11: ${unavailable}`,
);

const slash = (path: string) => path.replace(/\\/g, '/');

/** The facts a photo page is checked on by the scanning gate (research/omr/diagnose.mjs). */
interface GateFacts {
  imports: boolean;
  error: string | null;
  /** The bars of the first part. */
  bars: number;
  /** The most staves any part declares. */
  staves: number;
  fifths: number | null;
  time: string | null;
  /** The notes parseMusicXml keeps (ties joined); 0 when the strict import refuses the file. */
  notes: number;
}
interface Engine {
  parseMusicXml(
    xml: string,
    options: { preserveNotation: boolean },
  ): { score: { notes: { hand: 'L' | 'R' }[] } };
}
/** What a recognition holds, part by part, and for the gate. */
interface Recognition extends GateFacts {
  parts: number;
  /** The `<staves>` of each part (1 when it declares none). */
  stavesPerPart: number[];
  /** The measures of each part. */
  barsPerPart: number[];
  /** Every measure of every part: a page read as two one-staff parts counts each bar twice. */
  measures: number;
  /** Notes that are not rests, tied notes counted separately. */
  pitched: number;
  /** Notes the strict import keeps, by the hand the engine gives them; null when it refuses. */
  hands: { R: number; L: number } | null;
}

async function recognitionOf(xmlPath: string): Promise<Recognition> {
  if (!existsSync(ENGINE))
    throw new Error(`The engine is not built (${ENGINE}): pnpm --filter @digitus2/engine build`);
  const xml = readFileSync(xmlPath, 'utf8');
  const engine = (await import(pathToFileURL(ENGINE).href)) as Engine;
  const { photoFacts } = (await import(
    pathToFileURL(join(ROOT, 'research/omr/diagnose.mjs')).href
  )) as { photoFacts(engine: Engine, xml: string): GateFacts };
  const { DOMParser } = createRequire(join(ROOT, 'packages/engine/package.json'))(
    '@xmldom/xmldom',
  ) as { DOMParser: typeof globalThis.DOMParser };
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const elements = (parent: Element, tag: string) =>
    Array.from(parent.childNodes).filter((node): node is Element => node.nodeName === tag);
  const parts = elements(doc.documentElement, 'part');
  let hands: Recognition['hands'] = null;
  try {
    const notes = engine.parseMusicXml(xml, { preserveNotation: true }).score.notes;
    hands = {
      R: notes.filter((note) => note.hand === 'R').length,
      L: notes.filter((note) => note.hand === 'L').length,
    };
  } catch {
    // The strict import refused it: photoFacts reports why.
  }
  return {
    ...photoFacts(engine, xml),
    parts: parts.length,
    stavesPerPart: parts.map((part) =>
      Math.max(
        1,
        ...Array.from(part.getElementsByTagName('staves')).map((el) => Number(el.textContent) || 1),
      ),
    ),
    barsPerPart: parts.map((part) => elements(part, 'measure').length),
    measures: doc.getElementsByTagName('measure').length,
    pitched: Array.from(doc.getElementsByTagName('note')).filter(
      (note) => !note.getElementsByTagName('rest').length,
    ).length,
    hands,
  };
}

/**
 * How long recognize.py lets homr work on one page. It is shorter than the kill below, so that
 * recognize.py gives up first: it stops homr's whole process tree and removes its workspace, which
 * a kill of the Python process alone does not.
 */
const HOMR_SECONDS = 100;

/** Local homr on page images: the worker's own adapter, as the scanning gate runs it. */
function recognize(jobsPath: string, jobs: { id: string; input: string; output: string }[]) {
  writeFileSync(
    jobsPath,
    JSON.stringify(
      jobs.map((job) => ({
        id: job.id,
        recognizer: 'homr',
        input: slash(job.input),
        output: slash(job.output),
      })),
    ),
  );
  const run = spawnSync(
    PYTHON,
    [
      '-I',
      'research/omr/acceptance/recognize.py',
      slash(jobsPath),
      '--bundle',
      'unused',
      '--text-models',
      'unused',
      '--homr-toolchain',
      slash(HOMR),
      '--timeout',
      String(HOMR_SECONDS),
    ],
    // The jobs run one after the other; the margin is for starting Python and the toolchain.
    { cwd: ROOT, encoding: 'utf8', timeout: (jobs.length * HOMR_SECONDS + 40) * 1000 },
  );
  for (const job of jobs) {
    const failed = `${job.output}.failed.json`;
    if (existsSync(failed))
      throw new Error(`homr failed on ${job.id}: ${readFileSync(failed, 'utf8')}`);
    if (!existsSync(job.output))
      throw new Error(
        `homr wrote no recognition for ${job.id} (status ${run.status}, ${run.error?.message ?? 'no error'}): ${(run.stderr ?? '').slice(-2000)}`,
      );
  }
}

test('camera loop: five swept photos of a real page, recognised by local homr, draw a grand staff', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  // The scan page asks the scan service for its health on arrival: nothing here may reach the
  // deployed one. The recognition it answers is the one made below.
  let recognition = '';
  await mockService(page, () => recognition);

  await openPhotoCamera(page);
  const { stops, combining } = await photographPage(page);
  console.log(`sweep: stops per photo ${stops.join(' ')}, combined in ${combining} ms`);
  await dialog(page).getByRole('button', { name: t.keep, exact: true }).click();
  await dialog(page)
    .getByRole('button', { name: t.finish(1), exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expectCameraStopped(page);

  // The kept page is on the scan page as a file; its thumbnail is that file, the bytes the app uploads.
  const original = page.locator('img.scan-original-image');
  await expect(original).toBeVisible();
  const encoded = await original.evaluate(async (image: HTMLImageElement) => {
    const blob = await (await fetch(image.src)).blob();
    return await new Promise<string>((done, fail) => {
      const reader = new FileReader();
      reader.onload = () => done(String(reader.result).split(',')[1]!);
      reader.onerror = () => fail(reader.error);
      reader.readAsDataURL(blob);
    });
  });
  const fused = Buffer.from(encoded, 'base64');
  expect([...fused.subarray(0, 3)], 'the kept page is a JPEG').toEqual([0xff, 0xd8, 0xff]);
  const fusedPath = testInfo.outputPath('fused.jpg');
  writeFileSync(fusedPath, fused);
  console.log(`fused page: ${fused.length} bytes`);

  // The fused page and the flat photo it was filmed from, through the same homr.
  const fusedXml = testInfo.outputPath('fused.musicxml');
  const flatXml = testInfo.outputPath('flat.musicxml');
  const started = Date.now();
  recognize(testInfo.outputPath('homr-jobs.json'), [
    { id: 'fused', input: fusedPath, output: fusedXml },
    { id: 'flat', input: PAGE_PHOTO, output: flatXml },
  ]);
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const [fusedPage, flatPage] = [await recognitionOf(fusedXml), await recognitionOf(flatXml)];

  // The facts read off the page by eye, which the scanning gate checks every photo against
  // (research/omr/acceptance.mjs). Its floors count the photos with exactly the page's bars and
  // staves, so a page has no tolerance of its own: the bars are the page's, exactly.
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'research/omr/photos/manifest.json'), 'utf8'),
  ) as {
    photos: { file: string; bars: number; staves: number; fifths: number; time: string }[];
  };
  // The entry of the page the camera films, found by its file, so a change of PAGE_PHOTO compares
  // the right page's facts or stops here.
  const facts = manifest.photos.find((photo) => photo.file === basename(PAGE_PHOTO));
  if (!facts)
    throw new Error(`research/omr/photos/manifest.json has no entry for ${basename(PAGE_PHOTO)}`);
  const summary = { stops, combining, seconds, facts, fused: fusedPage, flat: flatPage };
  writeFileSync(testInfo.outputPath('loop.json'), JSON.stringify(summary, null, 2));
  await testInfo.attach('loop', { path: testInfo.outputPath('loop.json') });
  console.log(`loop: ${JSON.stringify(summary)}`);

  // The notes the strict import keeps (parseMusicXml), as the gate counts them; the XML's own
  // count of pitched notes is in the summary beside it.
  const notes = (found: Recognition) => found.notes;
  expect
    .soft(fusedPage.imports, `the fused page's recognition imports: ${fusedPage.error}`)
    .toBe(true);
  expect.soft(fusedPage.parts, 'parts, as in the flat photo').toBe(flatPage.parts);
  expect
    .soft(fusedPage.stavesPerPart, 'staves per part, as in the flat photo')
    .toEqual(flatPage.stavesPerPart);
  expect
    .soft(fusedPage.bars, `bars of the page (the flat photo reads ${flatPage.bars})`)
    .toBe(facts.bars);
  expect.soft(fusedPage.staves, 'staves of the page').toBe(facts.staves);
  expect.soft(fusedPage.fifths, 'key of the page (fifths)').toBe(facts.fifths);
  expect.soft(fusedPage.time, 'time signature of the page').toBe(facts.time);
  // The gate has no notes fact to borrow a floor from, so this bound is the loop's own: the fused
  // page is a reconstruction read apart from the flat photo, and the logged runs read the same
  // count for both (203 and 203). 10% (about 20 notes, a bar or two) is wider than any run has
  // shown and narrow enough to catch a reading that has lost or doubled music.
  expect
    .soft(
      Math.abs(notes(fusedPage) - notes(flatPage)) / notes(flatPage),
      `notes the import keeps: fused ${notes(fusedPage)}, flat ${notes(flatPage)}`,
    )
    .toBeLessThanOrEqual(0.1);

  // The service answers with that recognition; the fused page goes in as a file, as a reader's own.
  recognition = readFileSync(fusedXml, 'utf8');
  await page.goto('/');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'fused.jpg', mimeType: 'image/jpeg', buffer: fused });
  await expect(page.getByRole('heading', { name: 'From paper to piano' })).toBeVisible();
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible({
    timeout: 30_000,
  });
  const review = await expectReviewGrandStaff(page);
  console.log(`review: ${JSON.stringify(review)}`);
  await page.screenshot({ path: testInfo.outputPath('review.png'), fullPage: true });
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  await page.getByRole('button', { name: 'Use for fingerings' }).click();
  const score = await expectScoreGrandStaff(page);
  console.log(`score view: ${JSON.stringify(score)}`);
  // Both hands throughout, not only in one bar: a digit on every note the import keeps, and the
  // digits split as the recognition split the notes by hand, the right hand's above the upper
  // staff and the left hand's below the lower (the logged runs read 88 and 115). The split is
  // soft because Verovio keeps a cross-staff note in the staff of its voice.
  expect(score.fingerings, 'a digit on every note the import keeps').toBe(fusedPage.notes);
  expect
    .soft(
      score.digits.above,
      "digits above the upper staff: the right hand's notes (a cross-staff note is drawn in its voice's staff)",
    )
    .toBe(fusedPage.hands?.R);
  expect
    .soft(
      score.digits.below,
      "digits below the lower staff: the left hand's notes (a cross-staff note is drawn in its voice's staff)",
    )
    .toBe(fusedPage.hands?.L);
  await page.screenshot({ path: testInfo.outputPath('score.png'), fullPage: true });
});
