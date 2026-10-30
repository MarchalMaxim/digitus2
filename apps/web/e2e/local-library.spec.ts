import { expect, test, type Page } from '@playwright/test';
import { blockService, mockService, openFiles, recordService } from './helpers/scan.js';
import { libraryScore } from './helpers/files.js';

// These flows run as a PC window (mouse, no camera), also at 360 px in the mobile project.
test.use({ hasTouch: false, isMobile: false });

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
  'base64',
);
async function myScores(page: Page) {
  await page.getByRole('button', { name: /^Back to (the )?library$/ }).click();
  await page.getByText('My scores', { exact: true }).click();
}

/** Waits until the saved-scores store itself holds `count` records, so a reload cannot beat a commit. */
async function storedScores(page: Page, count: number) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const known = await indexedDB.databases();
        if (!known.some((entry) => entry.name === 'digitus2.my-scores')) return 0;
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('digitus2.my-scores');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<number>((resolve, reject) => {
            const counting = db.transaction('scores', 'readonly').objectStore('scores').count();
            counting.onsuccess = () => resolve(counting.result);
            counting.onerror = () => reject(counting.error);
          });
        } finally {
          db.close();
        }
      }),
    )
    .toBe(count);
}

for (const count of [1, 2]) {
  test(`local library: keyboard removal preserves focus for ${count} saved scores`, async ({
    page,
  }) => {
    await mockService(page, '');
    await page.goto('/');
    for (let index = 0; index < count; index++) {
      await page.getByLabel('Open your own score').setInputFiles({
        name: `score-${index}.png`,
        mimeType: 'image/png',
        buffer: Buffer.concat([png, Buffer.from(String(index))]),
      });
      await myScores(page);
    }
    const rows = page.locator('.local-score-row');
    const firstName = await rows.first().locator('.title').innerText();
    const nextName = count > 1 ? await rows.nth(1).locator('.title').innerText() : null;
    const remove = rows.first().getByRole('button', { name: /^Remove saved/ });
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(rows).toHaveCount(count - 1);
    const announcement = page.getByTestId('local-score-announcement');
    await expect(announcement).toHaveText(`Removed ${firstName}.`);
    await expect(announcement).toHaveAttribute('aria-live', 'polite');
    if (nextName) {
      await expect(page.getByRole('button', { name: `Open saved ${nextName}` })).toBeFocused();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await expect(announcement).toHaveText(`Removed ${nextName}.`);
    }
    await expect(page.getByRole('heading', { name: 'digitus2', exact: true })).toBeFocused();
    await expect(page.getByText('My scores', { exact: true })).toHaveCount(0);
    await storedScores(page, 0);
    await page.reload();
    await expect(page.getByText('My scores', { exact: true })).toHaveCount(0);
  });
}

test('local library: draft bytes, reading order, explicit resume and deletion survive reload', async ({
  page,
}) => {
  // Arriving on the scan page warms the scanner up; nothing is recognized without Scan.
  const calls = recordService(page);
  await mockService(page, '');
  await page.goto('/');
  await expect(page.getByText('My scores', { exact: true })).toHaveCount(0);
  await page.getByLabel('Open your own score').setInputFiles([
    { name: 'second.png', mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.from('two')]) },
    { name: 'first.png', mimeType: 'image/png', buffer: png },
  ]);
  await page.getByRole('button', { name: 'Select page 2: first.png' }).click();
  await page.getByRole('button', { name: 'Move page 2 earlier' }).click();
  await myScores(page);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open saved first.png' })).toBeVisible();
  await page.reload();
  await page.getByText('My scores', { exact: true }).click();
  await page.getByRole('button', { name: 'Open saved first.png' }).click();
  await expect(page.getByRole('heading', { name: 'From paper to piano' })).toBeVisible();
  await expect(page.locator('.scan-page-list li').first()).toContainText('first.png');
  const source = await page
    .getByRole('img', { name: 'Original printed score, page 1' })
    .getAttribute('src');
  expect(
    await page.evaluate(
      async (src) => Array.from(new Uint8Array(await (await fetch(src!)).arrayBuffer())),
      source,
    ),
  ).toEqual([...png]);
  expect(calls.filter((call) => call.startsWith('POST'))).toEqual([]);
  await myScores(page);
  await page.getByRole('button', { name: 'Remove saved first.png' }).click();
  await expect(page.getByText('My scores', { exact: true })).toHaveCount(0);
  await storedScores(page, 0);
  await page.reload();
  await expect(page.getByText('My scores', { exact: true })).toHaveCount(0);
});

test("local library: Remove sits inside its row's lines and stays a plain word on hover (#74)", async ({
  page,
}) => {
  await mockService(page, '');
  await page.goto('/');
  await page
    .getByLabel('Open your own score')
    .setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: png });
  await myScores(page);
  const remove = page.getByRole('button', { name: 'Remove saved first.png' });
  await expect(remove).toBeVisible();
  // Some element in the row draws its bottom line across the whole of Remove, as the list's top
  // line does.
  const spanned = await remove.evaluate((button) => {
    const row = button.closest('li')!;
    const b = button.getBoundingClientRect();
    return [row, ...row.querySelectorAll('*')].some((el) => {
      const r = el.getBoundingClientRect();
      return (
        getComputedStyle(el).borderBottomWidth !== '0px' && r.left <= b.left && r.right >= b.right
      );
    });
  });
  expect(spanned).toBe(true);
  await remove.hover();
  const background = await remove.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished));
    return getComputedStyle(el).backgroundColor;
  });
  expect(background).toBe('rgba(0, 0, 0, 0)');
});

test('local library: recognized notation reopens without rescanning', async ({ page }) => {
  const calls = recordService(page);
  const xml = libraryScore('twinkle-twinkle-little-star');
  await mockService(page, xml.toString('utf8'));
  await page.goto('/');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'remember.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.locator('.scan-review svg').first()).toBeVisible();
  await myScores(page);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByText('My scores', { exact: true }).click();
  const before = calls.length;
  await page.getByRole('button', { name: 'Open saved remember.png' }).click();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  expect(calls).toHaveLength(before);
  const download = page.waitForEvent('download');
  await openFiles(page);
  await page.getByRole('button', { name: 'Download raw MusicXML' }).click();
  const { readFileSync } = await import('node:fs');
  expect(readFileSync((await (await download).path())!)).toEqual(xml);
});

test('local library: own MusicXML reopens and blocked storage keeps the visit usable', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'indexedDB', {
      get: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    }),
  );
  await page.goto('/');
  await page.getByLabel('Open your own score').setInputFiles({
    name: 'my-score.musicxml',
    mimeType: 'text/xml',
    buffer: libraryScore('twinkle-twinkle-little-star'),
  });
  await expect(page.locator('.score-sheet svg').first()).toBeVisible();
  await expect(page.locator('.notice')).toContainText('could not be saved');
  await myScores(page);
  await expect(page.getByText('Available for this visit only', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open saved my-score.musicxml' }).click();
  await expect(page.locator('.score-sheet svg').first()).toBeVisible();
});

test('local library: uploaded MusicXML survives refresh and duplicate uploads stay separate', async ({
  page,
}) => {
  await page.goto('/');
  const file = {
    name: 'my-score.musicxml',
    mimeType: 'text/xml',
    buffer: libraryScore('twinkle-twinkle-little-star'),
  };
  await page.getByLabel('Open your own score').setInputFiles(file);
  await expect(page.locator('.score-sheet svg').first()).toBeVisible();
  await myScores(page);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByText('My scores', { exact: true }).click();
  await page.getByRole('button', { name: 'Open saved my-score.musicxml' }).click();
  await expect(page.locator('.score-sheet svg').first()).toBeVisible();
  await page.getByRole('button', { name: /^Back to (the )?library$/ }).click();
  await page.getByLabel('Open your own score').setInputFiles(file);
  await expect(page.locator('.score-sheet svg').first()).toBeVisible();
  await myScores(page);
  await expect(page.getByRole('button', { name: 'Open saved my-score.musicxml' })).toHaveCount(2);
});

test('local library: orientation and unchanged original bytes survive refresh', async ({
  page,
}) => {
  await blockService(page);
  await page.goto('/');
  const original = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 6;
      canvas.height = 4;
      const context = canvas.getContext('2d')!;
      context.fillStyle = 'black';
      context.fillRect(0, 0, 3, 4);
      return Array.from(
        Uint8Array.from(atob(canvas.toDataURL().split(',')[1]!), (c) => c.charCodeAt(0)),
      );
    }),
  );
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'turn.png', mimeType: 'image/png', buffer: original });
  await page.getByRole('button', { name: 'Rotate 90° clockwise' }).click();
  await expect(page.getByRole('button', { name: 'Rotate 90° clockwise' })).toBeEnabled();
  await expect(page.locator('.scan-original-image')).toHaveJSProperty('naturalWidth', 4);
  await myScores(page);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByText('My scores', { exact: true }).click();
  await page.getByRole('button', { name: 'Open saved turn.png' }).click();
  const readSource = async () => {
    return page
      .locator('.scan-original-image')
      .evaluate(async (image) => [
        ...new Uint8Array(await (await fetch((image as HTMLImageElement).src)).arrayBuffer()),
      ]);
  };
  await expect(page.locator('.scan-original-image')).toHaveJSProperty('naturalWidth', 4);
  expect(await readSource()).not.toEqual([...original]);
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Rotate 90° clockwise' }).click();
    await expect(page.getByRole('button', { name: 'Rotate 90° clockwise' })).toBeEnabled();
    await expect(page.locator('.scan-original-image')).toHaveJSProperty(
      'naturalWidth',
      i % 2 ? 4 : 6,
    );
  }
  await expect.poll(readSource).toEqual([...original]);
});
