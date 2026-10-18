import { expect, test, type Page } from '@playwright/test';
import { openFiles } from './helpers/scan.js';
import { libraryScore } from './helpers/files.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
  'base64',
);
async function myScores(page: Page) {
  await page.getByRole('button', { name: /^Back to (the )?library$/ }).click();
  await page.getByText('My scores', { exact: true }).click();
}

test('local library: draft bytes, reading order, explicit resume and deletion survive reload', async ({
  page,
}) => {
  let connections = 0;
  await page.route('http://127.0.0.1:8996/**', (route) => {
    connections++;
    return route.abort();
  });
  await page.goto('/');
  await expect(page.getByText('My scores', { exact: true })).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles([
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
  expect(connections).toBe(0);
  await myScores(page);
  await page.getByRole('button', { name: 'Remove saved first.png' }).click();
  await expect(page.getByText('My scores', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('My scores', { exact: true })).toHaveCount(0);
});

test('local library: recognized notation reopens without reconnecting or rescanning', async ({
  page,
}) => {
  let requests = 0;
  const xml = libraryScore('twinkle-twinkle-little-star');
  await page.route('http://127.0.0.1:8996/**', async (route) => {
    requests++;
    const request = route.request();
    if (request.url().endsWith('/health'))
      await route.fulfill({ json: { protocol: 'digitus2-scan-v1', recognizer: 'test' } });
    else if (request.method() === 'POST')
      await route.fulfill({ status: 202, json: { id: 'a'.repeat(32) } });
    else if (request.url().endsWith('/result')) await route.fulfill({ body: xml });
    else await route.fulfill({ json: { state: 'ready' } });
  });
  await page.goto('/');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'remember.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Connect to this PC' }).click();
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.locator('.scan-review svg').first()).toBeVisible();
  await myScores(page);
  await page.reload();
  await page.getByText('My scores', { exact: true }).click();
  const before = requests;
  await page.getByRole('button', { name: 'Open saved remember.png' }).click();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  expect(requests).toBe(before);
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
  await page.locator('input[type=file]').setInputFiles({
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
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.locator('.score-sheet svg').first()).toBeVisible();
  await myScores(page);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByText('My scores', { exact: true }).click();
  await page.getByRole('button', { name: 'Open saved my-score.musicxml' }).click();
  await expect(page.locator('.score-sheet svg').first()).toBeVisible();
  await page.getByRole('button', { name: /^Back to (the )?library$/ }).click();
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.locator('.score-sheet svg').first()).toBeVisible();
  await myScores(page);
  await expect(page.getByRole('button', { name: 'Open saved my-score.musicxml' })).toHaveCount(2);
});

test('local library: orientation and unchanged original bytes survive refresh', async ({
  page,
}) => {
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
