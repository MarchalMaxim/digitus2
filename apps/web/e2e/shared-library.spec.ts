import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { expect, test, type Page, type Route } from '@playwright/test';
import { LIBRARY_STORE } from '../src/library/shared/store.js';
import { libraryScore } from './helpers/files.js';
import { horizontalOverflow } from './helpers/overflow.js';
import { expectOneRed, redRoots } from './helpers/red.js';

// These flows run as a PC window; the phone's width is a viewport of its own below.
test.use({ hasTouch: false, isMobile: false });

// The score takes a while to draw when the machine is busy (other suites, other windows).
const SCORE = { timeout: 30_000 };
const TWINKLE = libraryScore('twinkle-twinkle-little-star');
const TWINKLE_MIDI = fileURLToPath(new URL('../fixtures/twinkle.mid', import.meta.url));
const REMOVAL_URL =
  'https://github.com/MarchalMaxim/digitus2/issues/new?template=remove-a-score.yml';
const idOf = (n: number) => n.toString(16).padStart(32, '0');

interface Doc {
  fields: Record<string, { stringValue?: string; timestampValue?: string }>;
}

/** The shared library's store, faked: documents in memory and every call recorded. */
class FakeStore {
  docs = new Map<string, Doc>();
  reports: Doc[] = [];
  calls: string[] = [];
  /** Statuses to answer with instead of working (a store that is down or refuses). */
  failing: { shared?: number; reports?: number; all?: boolean } = {};
  private clock = 0;

  seed(id: string, title: string, composer: string, status = 'shared') {
    const packed = deflateRawSync(TWINKLE).toString('base64');
    this.docs.set(id, {
      fields: {
        title: { stringValue: title },
        composer: { stringValue: composer },
        score: { stringValue: packed },
        kind: { stringValue: 'file' },
        app: { stringValue: 'test' },
        status: { stringValue: status },
        created: {
          timestampValue: new Date(Date.UTC(2026, 9, 1, 0, 0, ++this.clock)).toISOString(),
        },
      },
    });
  }
  count(kind: string) {
    return this.calls.filter((call) => call === kind).length;
  }
  nonShelf() {
    return this.calls.filter((call) => call !== 'runQuery');
  }

  async handle(route: Route) {
    const request = route.request();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    const answer = (status: number, json: unknown = {}) => route.fulfill({ status, json, headers });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (this.failing.all) return route.abort();
    const path = request.url().slice(LIBRARY_STORE.length);
    const body = request.postDataJSON?.() as Record<string, any> | null; // eslint-disable-line
    if (path === ':commit') {
      const write = body!.writes[0];
      const name = write.update.name as string;
      const [, collection = '', id = ''] = /\/documents\/(\w+)\/([0-9a-f]{32})$/.exec(name)!;
      this.calls.push('commit');
      expect(write.currentDocument).toEqual({ exists: false });
      expect(write.updateTransforms).toEqual([
        { fieldPath: 'created', setToServerValue: 'REQUEST_TIME' },
      ]);
      const failure = collection === 'shared' ? this.failing.shared : this.failing.reports;
      if (failure) return answer(failure, { error: { status: 'PERMISSION_DENIED' } });
      const doc: Doc = {
        fields: {
          ...write.update.fields,
          created: {
            timestampValue: new Date(Date.UTC(2026, 9, 2, 0, 0, ++this.clock)).toISOString(),
          },
        },
      };
      if (collection === 'shared') this.docs.set(id, doc);
      else this.reports.push(doc);
      return answer(200, { writeResults: [{}] });
    }
    if (path === ':runQuery') {
      this.calls.push('runQuery');
      const q = body!.structuredQuery;
      let rows = [...this.docs.entries()]
        .filter(([, doc]) => doc.fields.status!.stringValue === 'shared')
        .sort((a, b) =>
          b[1].fields.created!.timestampValue!.localeCompare(a[1].fields.created!.timestampValue!),
        );
      const after = q.startAt?.values?.[0]?.timestampValue as string | undefined;
      if (after) rows = rows.filter(([, doc]) => doc.fields.created!.timestampValue! < after);
      return answer(
        200,
        rows.slice(0, q.limit).map(([id, doc]) => ({
          document: {
            name: `projects/digitus2-library/databases/(default)/documents/shared/${id}`,
            fields: {
              title: doc.fields.title,
              composer: doc.fields.composer,
              created: doc.fields.created,
            },
          },
        })),
      );
    }
    const id = path.replace('/shared/', '');
    if (request.method() === 'GET') {
      this.calls.push('get');
      const doc = this.docs.get(id);
      return doc ? answer(200, doc) : answer(404, { error: { status: 'NOT_FOUND' } });
    }
    if (request.method() === 'DELETE') {
      this.calls.push('delete');
      this.docs.delete(id);
      return answer(200);
    }
    return answer(400);
  }
}

async function fakeStore(page: Page): Promise<FakeStore> {
  const store = new FakeStore();
  await page.route(
    (url) => url.href.startsWith(LIBRARY_STORE),
    (route) => store.handle(route),
  );
  return store;
}

const upload = (page: Page, name: string, buffer: Buffer, mimeType = 'text/xml') =>
  page.getByLabel('Open your own score').setInputFiles({ name, mimeType, buffer });

/** Opens a MusicXML file, leaves for the library and opens My scores. */
async function ownScoreRow(page: Page, name = 'my-twinkle.musicxml') {
  await page.goto('/');
  await upload(page, name, TWINKLE);
  await expect(page.locator('.score-sheet svg').first()).toBeVisible(SCORE);
  await page.getByRole('button', { name: /^Back to (the )?library$/ }).click();
  await page.getByText('My scores', { exact: true }).click();
}
const shareButton = (page: Page, name = 'my-twinkle.musicxml') =>
  page.getByRole('button', { name: `Share ${name}` });
const dialog = (page: Page) => page.getByRole('dialog');

test('Share appears only on rows whose MusicXML the importer reads, not on MIDI', async ({
  page,
}) => {
  await fakeStore(page);
  await ownScoreRow(page);
  await expect(shareButton(page)).toBeVisible();
  await page.getByLabel('Open your own score').setInputFiles(TWINKLE_MIDI);
  await expect(page.locator('.score-sheet svg').first()).toBeVisible(SCORE);
  await page.getByRole('button', { name: /^Back to (the )?library$/ }).click();
  await page.getByText('My scores', { exact: true }).click();
  await expect(page.locator('.local-score-row')).toHaveCount(2);
  await expect(shareButton(page)).toBeVisible();
  // The MIDI row has been read by now too: the importer finishes both within a moment.
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', { name: /^Share / })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Share twinkle\.mid/ })).toHaveCount(0);
});

test('the sheet starts from the MusicXML, asks for the tick, and has the sheet as the only red', async ({
  page,
}) => {
  const store = await fakeStore(page);
  await ownScoreRow(page, 'a-file-name-that-is-not-the-title.musicxml');
  await shareButton(page, 'a-file-name-that-is-not-the-title.musicxml').click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Share with other readers' }),
  ).toBeVisible();
  await expect(dialog(page).getByLabel('Title')).toHaveValue('Twinkle, Twinkle, Little Star');
  await expect(dialog(page).getByLabel('Composer')).toHaveValue('Traditional');
  await expect(dialog(page)).toContainText(
    'Share only music that is out of copyright or that you wrote. The owner reads each score before anyone else can find it.',
  );
  // One red: the sheet's Share; the page behind (the Start button) shows none.
  const roots = await expectOneRed(page, 'share sheet');
  expect(roots[0]!.tag).toBe('button');
  await expect(dialog(page).getByRole('button', { name: 'Share', exact: true })).toHaveClass(
    /is-red/,
  );
  expect((await redRoots(page)).length).toBe(1);

  const before = store.nonShelf().length;
  await dialog(page).getByRole('button', { name: 'Share', exact: true }).click();
  await expect(dialog(page)).toContainText('Tick the box to share this score.');
  await expect(dialog(page).getByLabel('This music is free to share')).toBeFocused();
  expect(store.nonShelf()).toHaveLength(before);

  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  // The Start button is the page's red again.
  await expectOneRed(page, 'library after the sheet');
  expect(store.nonShelf()).toHaveLength(before);
});

test('Share sends one commit; the row waits, Withdraw deletes; later visits ask the store', async ({
  page,
}) => {
  const store = await fakeStore(page);
  await ownScoreRow(page);
  expect(store.nonShelf()).toEqual([]);
  await shareButton(page).click();
  await dialog(page).getByLabel('This music is free to share').check();
  await dialog(page).getByRole('button', { name: 'Share', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);

  expect(store.count('commit')).toBe(1);
  expect(store.nonShelf()).toEqual(['commit']);
  expect(store.docs.size).toBe(1);
  const [id, doc] = [...store.docs.entries()][0]!;
  expect(id).toMatch(/^[0-9a-f]{32}$/);
  expect(doc!.fields.status).toEqual({ stringValue: 'waiting' });
  expect(doc!.fields.link!.stringValue).toBe(
    `https://marchalmaxim.github.io/digitus2/#/shared/${id}`,
  );
  expect(doc!.fields.title).toEqual({ stringValue: 'Twinkle, Twinkle, Little Star' });
  expect(JSON.stringify(doc)).not.toContain('my-twinkle');

  await expect(page.getByText('Waiting for review', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'Sent for review. It appears under Shared by readers once the owner has read it.',
    ),
  ).toBeVisible();
  await expect(shareButton(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Withdraw my-twinkle.musicxml from review' }),
  ).toBeVisible();

  // A later visit: the first opening of My scores asks once; the upload is still waiting.
  await page.reload();
  await page.getByText('My scores', { exact: true }).click();
  await expect(page.getByText('Waiting for review', { exact: true })).toBeVisible();
  expect(store.count('get')).toBe(1);

  // The owner reads it and sets it to shared: no button but Remove, and the shelf lists it.
  doc!.fields.status = { stringValue: 'shared' };
  await page.reload();
  await page.getByText('My scores', { exact: true }).click();
  await expect(page.getByText('Shared', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Share|Withdraw) my-twinkle/ })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Remove saved my-twinkle.musicxml' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Shared by readers' })).toBeVisible();

  // The owner removed it: Not shared, and Share again.
  store.docs.delete(id);
  await page.reload();
  await page.getByText('My scores', { exact: true }).click();
  await expect(page.getByText('Not shared', { exact: true })).toBeVisible();
  await expect(shareButton(page)).toBeVisible();

  // Share again, then Withdraw: one delete, and the row is plain again.
  await shareButton(page).click();
  await dialog(page).getByLabel('This music is free to share').check();
  await dialog(page).getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByText('Waiting for review', { exact: true })).toBeVisible();
  const deletes = store.count('delete');
  await page.getByRole('button', { name: 'Withdraw my-twinkle.musicxml from review' }).click();
  await expect(shareButton(page)).toBeVisible();
  expect(store.count('delete')).toBe(deletes + 1);
  expect(store.docs.size).toBe(0);
  await expect(page.getByText('Score file', { exact: true })).toBeVisible();
});

test('a store that is down shows the notice and sends nothing', async ({ page }) => {
  const store = await fakeStore(page);
  await ownScoreRow(page);
  store.failing = { all: true };
  await shareButton(page).click();
  await dialog(page).getByLabel('This music is free to share').check();
  await dialog(page).getByRole('button', { name: 'Share', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.notice')).toContainText(
    'Sharing is not available right now. Try again later.',
  );
  await expect(page.getByText('Waiting for review', { exact: true })).toHaveCount(0);
  await expect(shareButton(page)).toBeVisible();
  // The shelf draws nothing for a store that cannot be reached.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Shared by readers' })).toHaveCount(0);
});

test.describe('the shelf and a shared score', () => {
  test('the shelf lists the five newest; More adds the rest; a row opens the score at its address, not into My scores', async ({
    page,
  }) => {
    const store = await fakeStore(page);
    for (let n = 1; n <= 6; n++) store.seed(idOf(n), `Shared piece ${n}`, n % 2 ? 'Someone' : '');
    await page.goto('/');
    const rows = page.locator('.shared-shelf .piece-row');
    await expect(page.getByRole('heading', { name: 'Shared by readers' })).toBeVisible();
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText('Shared piece 6');
    await page.getByRole('button', { name: 'More shared scores' }).click();
    await expect(rows).toHaveCount(6);
    await expect(page.getByRole('button', { name: 'More shared scores' })).toHaveCount(0);
    await expectOneRed(page, 'library with the shared shelf');

    await page.getByRole('button', { name: 'Open shared Shared piece 3' }).click();
    await expect(page).toHaveURL(new RegExp(`#/shared/${idOf(3)}$`));
    await expect(page.locator('.score-sheet svg').first()).toBeVisible(SCORE);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shared piece 3');
    await expect(page.getByText('Shared by a reader', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Report', exact: true })).toBeVisible();

    // After a reload the score is fetched again by its id.
    await page.reload();
    await expect(page.locator('.score-sheet svg').first()).toBeVisible(SCORE);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shared piece 3');

    // It was not added to My scores.
    await page.getByRole('button', { name: /^Back to (the )?library$/ }).click();
    await expect(page.getByText('My scores', { exact: true })).toHaveCount(0);
  });

  test('a shared address that cannot be loaded falls back to the library with a notice', async ({
    page,
  }) => {
    await fakeStore(page);
    await page.goto(`/#/shared/${idOf(99)}`);
    await expect(page.locator('.notice')).toContainText('This shared score could not be loaded.');
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole('button', { name: /^(Start|Continue) with/ })).toBeVisible();
  });

  test('Report sends one create; the sheet is the one red; Back returns to the score', async ({
    page,
  }) => {
    const store = await fakeStore(page);
    store.seed(idOf(1), 'Shared piece 1', 'Someone');
    await page.goto(`/#/shared/${idOf(1)}`);
    await expect(page.locator('.score-sheet svg').first()).toBeVisible(SCORE);
    await page.getByRole('button', { name: 'Report', exact: true }).click();
    await expect(dialog(page).getByRole('heading', { name: 'Report this score' })).toBeVisible();
    await expectOneRed(page, 'report sheet');
    await dialog(page).getByRole('button', { name: 'Send report' }).click();
    await expect(dialog(page)).toContainText('Choose a reason.');
    await dialog(page).getByLabel('It is under copyright').check();
    await dialog(page).getByRole('button', { name: 'Send report' }).click();
    await expect(dialog(page)).toContainText('Say how the owner can reply to you.');
    expect(store.count('commit')).toBe(0);
    await dialog(page).getByLabel('How can the owner reply to you?').fill('me@example.org');
    await dialog(page).getByRole('button', { name: 'Send report' }).click();
    await expect(dialog(page).getByRole('heading', { name: 'Report sent' })).toBeVisible();
    await expect(dialog(page)).toContainText(
      'The owner reads every report and removes a score that should not be here.',
    );
    expect(store.count('commit')).toBe(1);
    expect(store.reports).toHaveLength(1);
    expect(store.reports[0]!.fields).toMatchObject({
      score: { stringValue: idOf(1) },
      reason: { stringValue: 'copyright' },
      reply: { stringValue: 'me@example.org' },
    });
    await expectOneRed(page, 'report sent');
    await dialog(page).getByRole('button', { name: 'Back to the score' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.score-sheet svg').first()).toBeVisible(SCORE);
  });

  test('a report that fails offers the removal request on GitHub', async ({ page }) => {
    const store = await fakeStore(page);
    store.seed(idOf(1), 'Shared piece 1', 'Someone');
    store.failing = { reports: 403 };
    await page.goto(`/#/shared/${idOf(1)}`);
    await expect(page.locator('.score-sheet svg').first()).toBeVisible(SCORE);
    await page.getByRole('button', { name: 'Report', exact: true }).click();
    await dialog(page).getByLabel('It is offensive or spam').check();
    await dialog(page).getByRole('button', { name: 'Send report' }).click();
    await expect(dialog(page)).toContainText('The report could not be sent.');
    await expect(
      dialog(page).getByRole('link', { name: 'Ask for removal on GitHub' }),
    ).toHaveAttribute('href', REMOVAL_URL);
    expect(store.reports).toHaveLength(0);
  });
});

test.describe('at the width of a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the share sheet rises from the bottom edge and the page does not scroll sideways', async ({
    page,
  }) => {
    await fakeStore(page);
    await ownScoreRow(page);
    await shareButton(page).click();
    const box = (await dialog(page).boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(360);
    expect(Math.round(box.y + box.height)).toBe(740);
    await expectOneRed(page, 'share sheet on a phone');
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('the shelf and the report sheet fit', async ({ page }) => {
    const store = await fakeStore(page);
    for (let n = 1; n <= 3; n++) store.seed(idOf(n), `Shared piece ${n}`, 'Someone');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Shared by readers' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: 'Open shared Shared piece 1' }).click();
    await expect(page.locator('.score-sheet svg').first()).toBeVisible(SCORE);
    await page.getByRole('button', { name: 'Report', exact: true }).click();
    const box = (await dialog(page).boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(740);
    await expectOneRed(page, 'report sheet on a phone');
  });
});

// Keeps the reading of the fixture honest: the e2e title expectations come from this file.
test('the fixture names its title and composer', () => {
  const xml = readFileSync(
    fileURLToPath(
      new URL('../../../content/scores/twinkle-twinkle-little-star.musicxml', import.meta.url),
    ),
    'utf8',
  );
  expect(xml).toContain('<work-title>Twinkle, Twinkle, Little Star</work-title>');
  expect(xml).toContain('<creator type="composer">Traditional</creator>');
});
