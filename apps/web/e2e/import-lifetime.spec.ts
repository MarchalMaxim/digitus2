import { expect, test, type Page } from '@playwright/test';
import { libraryScore } from './helpers/files.js';

// Hold the actual browser read rather than mocking application callbacks or navigation.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    const pending = new Map<string, () => Promise<void>>();
    File.prototype.arrayBuffer = function () {
      if (!this.name.endsWith('.musicxml')) return read.call(this);
      return new Promise<ArrayBuffer>((resolve, reject) => {
        pending.set(this.name, async () => {
          try {
            resolve(await read.call(this));
          } catch (error) {
            reject(error);
          }
          // Let the application's read completion run before assertions in the test.
          await new Promise((done) => setTimeout(done, 0));
        });
      });
    };
    Object.assign(window, { releaseImport: (name: string) => pending.get(name)!() });
  });
  await page.goto('/');
});

async function choose(page: Page, name: string) {
  await page.getByLabel('Open your own score').setInputFiles({
    name,
    mimeType: 'application/xml',
    buffer: libraryScore('twinkle-twinkle-little-star'),
  });
}
async function release(page: Page, name: string) {
  await page.evaluate(
    (file) =>
      (
        window as unknown as {
          releaseImport(name: string): Promise<void>;
        }
      ).releaseImport(file),
    name,
  );
}

test('a delayed import cannot replace About', async ({ page }) => {
  await choose(page, 'delayed.musicxml');
  await page.getByRole('button', { name: 'About and licences' }).click();
  await expect(page).toHaveURL(/#\/about$/);
  await expect(page.locator('.about')).toBeVisible();
  await release(page, 'delayed.musicxml');
  await expect(page).toHaveURL(/#\/about$/);
  await expect(page.locator('.score-view')).toHaveCount(0);
});

test('leaving and returning invalidates the old import', async ({ page }) => {
  await choose(page, 'delayed.musicxml');
  await page.getByRole('button', { name: 'About and licences' }).click();
  await page.getByRole('button', { name: /^Back to (the )?library$/ }).click();
  await expect(page.getByLabel('Open your own score')).toBeAttached();
  await release(page, 'delayed.musicxml');
  await expect(page.locator('.library')).toBeVisible();
  await expect(page.getByText('My scores', { exact: true })).toHaveCount(0);
});

test('a newer dropped file wins when reads finish in reverse order', async ({ page }) => {
  await choose(page, 'old.musicxml');
  const xml = libraryScore('twinkle-twinkle-little-star').toString('utf8');
  await page.evaluate((text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'latest.musicxml', { type: 'application/xml' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, cancelable: true }));
  }, xml);
  await release(page, 'latest.musicxml');
  await expect(page.locator('.score-view svg').first()).toBeVisible();
  await release(page, 'old.musicxml');
  await page.getByRole('button', { name: /^Back to (the )?library$/ }).click();
  await page.getByText('My scores', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open saved latest.musicxml' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open saved old.musicxml' })).toHaveCount(0);
});
