import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { libraryScore, utf16leOf } from './helpers/files.js';

/**
 * Note ids split into the engine's (`n` and a number, written into the MusicXML) and how many
 * others there are: Verovio draws a few notes the engine has no id for under ids of its own, new
 * for each engraving, and paper is engraved from its own text (the printed digits only, issue 94).
 */
function noteIdSplit(ids: string[]): { engine: string[]; others: number } {
  const engine = ids.filter((id) => /^n\d+$/.test(id)).sort();
  return { engine, others: ids.length - engine.length };
}

// Simulate a nonblocking native dialog that retains active print media until afterprint.
async function holdPrintDialog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const original = window.matchMedia.bind(window);
    const printMedia = new EventTarget() as MediaQueryList;
    Object.defineProperty(printMedia, 'matches', { value: true });
    window.matchMedia = (query) => (query === 'print' ? printMedia : original(query));
    window.print = () => {
      document.body.dataset.printCalled = 'true';
    };
  });
}

test('export downloads the fingered MusicXML with one fingering per note', async ({ page }) => {
  await page.goto('/#/piece/twinkle-twinkle-little-star');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export MusicXML' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('twinkle-twinkle-little-star.fingered.musicxml');
  const path = await download.path();
  const text = (await import('node:fs/promises')).readFile(path!, 'utf8');
  expect((await text).match(/<fingering/g)).toHaveLength(64);
});

test('a dropped UTF-16 file exports as UTF-8 text that says so', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Open your own score').setInputFiles({
    name: 'twinkle-utf16.musicxml',
    mimeType: 'application/xml',
    buffer: utf16leOf(libraryScore('twinkle-twinkle-little-star')),
  });
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export MusicXML' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('twinkle-utf16.fingered.musicxml');
  const bytes = await readFile((await download.path())!);
  // UTF-8 bytes (no UTF-16 byte-order mark, no NUL bytes), declared as UTF-8.
  expect([bytes[0], bytes[1]]).toEqual([0x3c, 0x3f]);
  const text = bytes.toString('utf8');
  expect(text).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"/);
  expect(text).not.toMatch(/UTF-16/i);
  expect(text.match(/<fingering/g)).toHaveLength(64);
});

test('the print stylesheet hides the controls and keeps the score', async ({ page }) => {
  await page.goto('/#/piece/twinkle-twinkle-little-star');
  await expect(page.locator('.score-sheet svg').first()).toBeVisible({ timeout: 20_000 });
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('toolbar', { name: 'Playback' })).toBeHidden();
  await expect(page.locator('.keyboard')).toBeHidden();
  await expect(page.locator('.score-sheet svg').first()).toBeVisible();
  const red = await page
    .locator('.is-red')
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(red.every((c) => c !== 'rgb(227, 0, 15)')).toBe(true);
});

for (const width of [390, 1280]) {
  for (const slug of [
    'twinkle-twinkle-little-star',
    'bach-invention-no1-bwv-772',
    'schumann-op68-no1-melody',
  ]) {
    if (width === 390 && slug.startsWith('schumann')) continue;
    test(`paper engraving is complete at ${width}px: ${slug}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/?audio=silent#/piece/${slug}`);
      await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled({
        timeout: 30_000,
      });
      if (slug.startsWith('schumann')) {
        await page.getByRole('checkbox', { name: "Show the editor's fingering" }).check();
        await expect(page.locator('.editorial-shown')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
      }
      if (!slug.startsWith('twinkle')) {
        await page.getByRole('button', { name: 'Practice', exact: true }).click();
        await page.getByRole('radio', { name: 'Right hand', exact: true }).check();
        await expect(page.locator('.score-sheet .is-muted').first()).toBeAttached();
        await expect(page.locator('.score-sheet .is-sweeping')).toHaveCount(0);
      }
      const notes = await page
        .locator('.score-sheet g.note')
        .evaluateAll((els) => els.map((e) => e.id).sort());
      // The paper shows the edition (issue 94): the notes the engine printed (the hook's set), and
      // every note is engraved. The editor's own fingering, when shown, prints whole.
      const digits = await page.evaluate(() => {
        const hook = (
          window as unknown as {
            __digitus2Edition: { printed(): string[] | null; buildAll(): void };
          }
        ).__digitus2Edition;
        hook.buildAll();
        const ids =
          hook.printed() ??
          [...document.querySelectorAll('.score-sheet g.fing')].map((f) =>
            f.getAttribute('data-startid')!.replace(/^#/, ''),
          );
        return [...ids].sort();
      });
      expect(digits.length).toBeGreaterThan(0);
      // The screen still holds every digit's text, spare or not, once all pages are built.
      const screenText = await page.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll('.score-sheet g.fing')].map((f) => [
            f.getAttribute('data-startid')!.replace(/^#/, ''),
            f.textContent,
          ]),
        ),
      );
      const original = await page.locator('.score-sheet').innerHTML();
      await holdPrintDialog(page);
      if (width === 1280 && slug.startsWith('twinkle')) await page.keyboard.press('Control+p');
      else await page.getByRole('button', { name: 'Print', exact: true }).click();
      await expect(page.locator('body')).toHaveAttribute('data-print-called', 'true', {
        timeout: 30_000,
      });
      await page.emulateMedia({ media: 'print' });
      expect(
        noteIdSplit(
          await page.locator('.print-score g.note').evaluateAll((els) => els.map((e) => e.id)),
        ),
      ).toEqual(noteIdSplit(notes));
      expect(
        await page
          .locator('.print-score g.fing')
          .evaluateAll((els) =>
            els.map((e) => e.getAttribute('data-startid')!.replace(/^#/, '')).sort(),
          ),
      ).toEqual(digits);
      expect(
        await page
          .locator('.print-score g.fing')
          .evaluateAll((els) =>
            els.map((e) => [e.getAttribute('data-startid')!.replace(/^#/, ''), e.textContent]),
          ),
      ).toEqual(expect.arrayContaining(digits.map((id) => [id, screenText[id]])));
      await expect(page.locator('.print-score .is-muted')).toHaveCount(0);
      if (!slug.startsWith('schumann'))
        await expect(page.locator('.print-heading').first()).toContainText(
          slug.startsWith('bach') ? 'CC BY-SA 3.0' : 'public domain',
        );
      // Every system, including the systems at every page boundary, fits within its paper SVG.
      const outside = await page.locator('.print-system').evaluateAll((pages) =>
        pages.flatMap((p, i) => {
          const box = p.getBoundingClientRect();
          return [...p.querySelectorAll('g.system')]
            .filter((s) => {
              const b = s.getBoundingClientRect();
              return (
                b.left < box.left - 1 ||
                b.right > box.right + 1 ||
                b.top < box.top - 1 ||
                b.bottom > box.bottom + 1
              );
            })
            .map((s) => ({
              page: i + 1,
              system: s.getBoundingClientRect().toJSON(),
              music: box.toJSON(),
              svg: p.querySelector('svg')?.getAttribute('viewBox'),
            }));
        }),
      );
      expect(outside).toEqual([]);
      const systems = await page.locator('.print-system').count();
      expect(systems).toBeGreaterThan(0);
      await expect(page.locator('.print-heading')).toHaveCount(1);
      // Return to automatic media before the native PDF lifecycle. Keeping forced print media
      // here would leave the screen in print layout after page.pdf dispatches afterprint.
      await page.emulateMedia({ media: null });
      for (const format of ['A4', 'Letter'] as const) {
        const pdf = await page.pdf({
          path: testInfo.outputPath(`${slug}-${width}-${format}.pdf`),
          format,
          preferCSSPageSize: false,
          displayHeaderFooter: false,
        });
        const sheets = pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
        if (slug.startsWith('twinkle')) expect(sheets).toBe(1);
        else expect(sheets).toBeGreaterThan(1);
        expect(sheets).toBeLessThanOrEqual(systems);
      }
      await expect(page.locator('.print-score')).toHaveCount(0);
      expect(await page.locator('.score-sheet').innerHTML()).toBe(original);
      await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
    });
  }
}

test('native phone printing gives instructions before preparation and uses the cache afterwards', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  await page.evaluate(() =>
    window.addEventListener('beforeprint', () => {
      document.body.dataset.nativePrintNotes = String(
        document.querySelectorAll('.print-score g.note').length,
      );
      document.body.dataset.nativePrintText =
        document.querySelector('.print-score')?.textContent ?? '';
    }),
  );
  const instructions = await page.pdf({
    path: testInfo.outputPath('native-phone-instructions.pdf'),
    format: 'Letter',
  });
  expect(instructions.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
  await expect(page.locator('body')).toHaveAttribute('data-native-print-notes', '0');
  await expect(page.locator('body')).toHaveAttribute(
    'data-native-print-text',
    /Cancel this dialog and use the Print button/,
  );
  await expect(page.locator('.print-score')).toHaveCount(0);
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
  const pdf = await page.pdf({
    path: testInfo.outputPath('native-phone-twinkle.pdf'),
    format: 'Letter',
  });
  expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
  await expect(page.locator('body')).toHaveAttribute('data-native-print-notes', '64');
  await expect(page.locator('.print-score')).toHaveCount(0);
});

test('long imported headings fit above music and pathological metadata refuses safely', async ({
  page,
}) => {
  const title = 'A beginner practice piece with a long descriptive title '.repeat(10);
  const composer = 'A composer with a descriptive credit '.repeat(5);
  const xml = libraryScore('twinkle-twinkle-little-star')
    .toString('utf8')
    .replace(/<work-title>[^<]+<\/work-title>/, `<work-title>${title}</work-title>`)
    .replace(
      '<creator type="composer">Traditional</creator>',
      `<creator type="composer">${composer}</creator>`,
    );
  await page.goto('/?audio=silent');
  await page.getByLabel('Open your own score').setInputFiles({
    name: 'long-title.musicxml',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  });
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  await holdPrintDialog(page);
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-print-called', 'true');
  await page.emulateMedia({ media: 'print' });
  const fit = await page
    .locator('.print-heading')
    .first()
    .evaluate((heading) => {
      const children = [...heading.children].map((el) => el.getBoundingClientRect());
      const music = heading.nextElementSibling!.getBoundingClientRect();
      return children.every((b) => b.bottom <= music.top && b.right <= music.right + 1);
    });
  expect(fit).toBe(true);
  await expect(page.locator('.print-heading').first()).toContainText(title.trim());
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await page.getByLabel('Open your own score').setInputFiles({
    name: 'huge-title.musicxml',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml.replace(title, title.repeat(30))),
  });
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  await page.evaluate(() => {
    delete document.body.dataset.printCalled;
  });
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.locator('.notice[role="status"]')).toContainText(
    'title and credits are too long',
  );
  await expect(page.locator('.print-score')).toHaveCount(0);
  expect(await page.locator('body').getAttribute('data-print-called')).toBeNull();
});

test('native printing oversized metadata produces one refusal sheet and restores the screen', async ({
  page,
}, testInfo) => {
  const title = 'A long imported title '.repeat(200);
  const xml = libraryScore('twinkle-twinkle-little-star')
    .toString('utf8')
    .replace(/<work-title>[^<]+<\/work-title>/, `<work-title>${title}</work-title>`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?audio=silent');
  await page.getByLabel('Open your own score').setInputFiles({
    name: 'huge-native-title.musicxml',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  });
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.locator('.notice[role="status"]')).toContainText(
    'title and credits are too long',
  );
  await page.evaluate(() =>
    window.addEventListener('beforeprint', () => {
      document.body.dataset.refusalPrintNotes = String(
        document.querySelectorAll('.print-score g.note').length,
      );
      document.body.dataset.refusalPrintText =
        document.querySelector('.print-score')?.textContent ?? '';
    }),
  );
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(page.locator('.print-score')).toContainText('Could not print the score:');
  await expect(page.locator('.print-score g.note')).toHaveCount(0);
  const pdf = await page.pdf({
    path: testInfo.outputPath('native-refusal.pdf'),
    preferCSSPageSize: true,
    displayHeaderFooter: false,
  });
  expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
  await expect(page.locator('body')).toHaveAttribute('data-refusal-print-notes', '0');
  await expect(page.locator('body')).toHaveAttribute(
    'data-refusal-print-text',
    /Could not print the score:.*title and credits are too long/,
  );
  await expect(page.locator('.print-score')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/printing-score/);
  await expect(page.locator('.score-sheet g.note')).toHaveCount(64);
});

test('a native snapshot cancels delayed app paper preparation and owns the only print document', async ({
  page,
}) => {
  await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  let release!: () => void;
  let intercepted!: () => void;
  const pendingWorker = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  const scriptGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/*verovio.worker*.js', async (route) => {
    intercepted();
    await scriptGate;
    await route.continue();
  });
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.unexpectedPrint = 'true';
    };
  });
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  await pendingWorker;
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(page.locator('.print-score')).toHaveCount(1);
  await expect(page.locator('.print-score')).toContainText('Cancel this dialog');
  release();
  await expect(
    page.getByRole('button', { name: 'Print', exact: true, includeHidden: true }),
  ).toBeEnabled();
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, cancelable: true }),
    ),
  );
  await expect(page.locator('.print-score')).toHaveCount(1);
  expect(await page.locator('.print-score').innerHTML()).not.toContain('NaN');
  expect(await page.locator('body').getAttribute('data-unexpected-print')).toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: null });
  await expect(page.locator('.print-score')).toHaveCount(0);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64);
});
