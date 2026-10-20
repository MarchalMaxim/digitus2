import { expect, test } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import {
  arrivalRows,
  libraryReady,
  placeOf,
  searchRows,
  shelfButton,
  shelvesOf,
  showMoreButton,
  showPiece,
  tierPill,
} from './helpers/library.js';
import { libraryScore } from './helpers/files.js';
import { expectOneRed } from './helpers/red.js';
import { dropFrameShown, pieceRows } from './helpers/states.js';
import { FINGER_LEGEND } from '../src/score/FingerLegend.js';
import { TIERS } from '../src/library/levels.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __lcp: number }).__lcp = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        (window as unknown as { __lcp: number }).__lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
});

test('library: four levels, six shelves at most, one red element, no serious a11y issues, LCP under 2 s', async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  await expect(pieceRows(page)).toHaveCount(arrivalRows('easy'));
  await expect(tierPill(page, 'easy')).toBeChecked();
  await expect(page.getByRole('radio')).toHaveCount(4);
  await expect(page.getByText(FINGER_LEGEND)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Start here' })).toHaveCount(0);
  const roots = await expectOneRed(page, 'library');
  expect(roots[0]!.tag).toBe('button');
  await expectNoSeriousA11y(page, 'library');
  const lcp = await page.evaluate(() => (window as unknown as { __lcp: number }).__lcp);
  expect(lcp, `LCP ${lcp} ms`).toBeLessThan(2000);
});

// Shelves spec 2 and 4.1, the rule of 7: on arrival a level shows at most 6 shelves of at most
// 5 rows, 30 rows in all, and the library never lists more than a page of rows at once.
test('library: the arrival page of each level keeps to the rule of 7', async ({ page }) => {
  await page.goto('/');
  await libraryReady(page);
  for (const tier of TIERS) {
    await tierPill(page, tier).check();
    const shelves = shelvesOf(tier);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(shelves.map((s) => s.name));
    await expect(pieceRows(page)).toHaveCount(arrivalRows(tier));
    expect(arrivalRows(tier)).toBeLessThanOrEqual(30);
    for (const shelf of shelves) {
      const section = page
        .getByRole('heading', { level: 2, name: shelf.name })
        .locator('xpath=ancestor::section');
      await expect(section.getByRole('button', { name: /^Open / })).toHaveCount(
        Math.min(5, shelf.count),
      );
      await expect(
        section.getByText(
          `${shelf.count.toLocaleString('en-US')} ${shelf.count === 1 ? 'piece' : 'pieces'}`,
        ),
      ).toBeVisible();
      if (shelf.count > 5)
        await expect(
          section.getByRole('button', {
            name: `All ${shelf.count.toLocaleString('en-US')} ${shelf.noun}`,
          }),
        ).toBeVisible();
      else await expect(section.getByRole('button', { name: /^All / })).toHaveCount(0);
    }
    await expectOneRed(page, `${tier} arrival`);
  }
  await expect(page.getByRole('group', { name: 'Length' })).toHaveCount(0);
});

// The red button and the first shelf on the first screen, the four level pills inside the
// viewport and on one row (from 360 px), no horizontal scroll. Runs at 1280 (desktop) and 360 (mobile).
test('library: the first screen at this width (spec 17)', async ({ page }) => {
  await page.goto('/');
  await libraryReady(page);
  const g = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    red: document.querySelector('.library .is-red')!.getBoundingClientRect().top,
    row: document.querySelector('.piece-row')!.getBoundingClientRect().top,
    pills: [...document.querySelectorAll('.pill')].map((p) => {
      const r = p.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top };
    }),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  const phone = g.width < 480;
  const at = JSON.stringify(g);
  expect(g.red, at).toBeLessThanOrEqual(phone ? 160 : 130);
  expect(g.row, at).toBeLessThanOrEqual(phone ? 600 : 420);
  expect(g.row, `the first row is on the first screen: ${at}`).toBeLessThan(g.height);
  expect(g.pills).toHaveLength(4);
  for (const p of g.pills) {
    expect(p.top, `one row of pills: ${at}`).toBe(g.pills[0]!.top);
    expect(p.left, at).toBeGreaterThanOrEqual(0);
    expect(p.right, at).toBeLessThanOrEqual(g.width);
  }
  expect(g.overflow, at).toBeLessThanOrEqual(0);
});

// UI batch review and design section 17: the words a first visit reads before the first piece.
// With shelves they are 37: the name 1, the sentence 14, the red button 6, the four pills 4, the
// first shelf's name 1, count 2 and line 9. The budget may not grow.
test('library: at most 37 visible words before the first piece (design section 17)', async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  const words = await page.evaluate(() => {
    const first = document.querySelector('.piece-row')!;
    const seen: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (first.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) break;
      const el = n.parentElement!;
      const r = el.getBoundingClientRect();
      const shown =
        el.closest('.visually-hidden') === null &&
        el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
        r.width > 1 &&
        r.height > 1;
      if (shown) seen.push(...n.textContent!.split(/\s+/).filter(Boolean));
    }
    return seen;
  });
  test
    .info()
    .annotations.push({ type: 'words before the first piece', description: `${words.length}` });
  expect(words.length, words.join(' ')).toBeLessThanOrEqual(37);
});

test('library: the arrow keys choose a level; the shelves follow and the pill keeps the focus', async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  await tierPill(page, 'easy').focus();
  await page.keyboard.press('ArrowRight');
  const medium = tierPill(page, 'medium');
  await expect(medium).toBeChecked();
  await expect(medium).toBeFocused();
  await expect(pieceRows(page)).toHaveCount(arrivalRows('medium'));
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(
    shelvesOf('medium').map((s) => s.name),
  );
  await expectOneRed(page, 'Medium chosen');
  await page.keyboard.press('ArrowRight');
  await expect(tierPill(page, 'harder')).toBeChecked();
  await expect(tierPill(page, 'harder')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tierPill(page, 'challenging')).toBeChecked();
  await expect(tierPill(page, 'challenging')).toBeFocused();
});

// Shelves spec 4.2: a shelf opens in place with its first page of 40, Show more appends the next
// page and moves the focus to its first row, Escape goes back to the shelf's All button.
test('library: a shelf opens in place in pages of 40; Escape goes back to the shelves', async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  await tierPill(page, 'medium').check();
  const classical = shelvesOf('medium').find((s) => s.id === 'classical')!;
  expect(classical.count).toBeGreaterThan(80);
  await shelfButton(page, 'classical').click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Classical']);
  await expect(page.getByRole('heading', { level: 2, name: 'Classical' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'All styles' })).toBeVisible();
  await expect(page.getByText(`${classical.count.toLocaleString('en-US')} pieces`)).toBeVisible();
  await expect(tierPill(page, 'medium')).toBeChecked();
  await expect(pieceRows(page)).toHaveCount(40);
  await expectOneRed(page, 'shelf open');
  await showMoreButton(page).click();
  await expect(pieceRows(page)).toHaveCount(80);
  await expect(pieceRows(page).nth(40)).toBeFocused();
  await expectNoSeriousA11y(page, 'shelf open');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(
    shelvesOf('medium').map((s) => s.name),
  );
  await expect(shelfButton(page, 'classical')).toBeFocused();
  await expect(pieceRows(page)).toHaveCount(arrivalRows('medium'));
  // and with the back button, after the level changed with the shelf open
  await shelfButton(page, 'songs').click();
  await tierPill(page, 'easy').check();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Songs']);
  await page.getByRole('button', { name: 'All styles' }).click();
  await expect(shelfButton(page, 'songs')).toBeFocused();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(
    shelvesOf('easy').map((s) => s.name),
  );
});

// Shelves spec 4.3: the length pills show above a list of more than 40 pieces, filter it, and
// keep their choice from shelf to shelf; a shelf of 40 pieces or fewer shows none.
test('library: the length pills filter an opened shelf and wait for the next', async ({ page }) => {
  await page.goto('/');
  await libraryReady(page);
  await tierPill(page, 'medium').check();
  await shelfButton(page, 'songs').click();
  const group = page.getByRole('group', { name: 'Length' });
  await expect(group.getByRole('radio', { name: 'Any length' })).toBeChecked();
  const pills = await group.getByRole('radio').count();
  expect(pills).toBeGreaterThanOrEqual(2);
  await group.getByRole('radio').nth(1).check();
  await expect(group.getByRole('radio').nth(1)).toBeChecked();
  await expect(group.getByRole('radio').nth(1)).toBeFocused();
  const filtered = await page
    .getByText(/^[\d,]+ pieces?$/)
    .first()
    .textContent();
  expect(Number(filtered!.replace(/\D/g, ''))).toBeLessThan(
    shelvesOf('medium').find((s) => s.id === 'songs')!.count,
  );
  await expectOneRed(page, 'length chosen');
  await page.getByRole('button', { name: 'All styles' }).click();
  await shelfButton(page, 'classical').click();
  await expect(page.getByRole('group', { name: 'Length' }).getByRole('radio').nth(1)).toBeChecked();
  // a shelf of 40 pieces or fewer has no pills, and cannot filter silently
  await page.getByRole('button', { name: 'All styles' }).click();
  await shelfButton(page, 'jazz').click();
  await expect(page.getByRole('group', { name: 'Length' })).toHaveCount(0);
  await expect(pieceRows(page)).toHaveCount(
    shelvesOf('medium').find((s) => s.id === 'jazz')!.count,
  );
});

test("library: a level pick keeps an open shelf open and shows that level's pieces", async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  await tierPill(page, 'medium').check();
  await shelfButton(page, 'baroque').click();
  await tierPill(page, 'challenging').check();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Baroque']);
  const challenging = shelvesOf('challenging').find((s) => s.id === 'baroque')!;
  await expect(page.getByText(`${challenging.count} pieces`)).toBeVisible();
  await expect(pieceRows(page)).toHaveCount(Math.min(40, challenging.count));
  // Harder holds a baroque shelf too, with its own count
  await tierPill(page, 'harder').check();
  const harder = shelvesOf('harder').find((s) => s.id === 'baroque')!;
  await expect(page.getByText(`${harder.count} pieces`)).toBeVisible();
  await expect(pieceRows(page)).toHaveCount(Math.min(40, harder.count));
});

test('library: an unsupported file shows a notice and keeps one red element', async ({ page }) => {
  await page.goto('/');
  // The end line sits at the bottom of a long page; the notice (sticky at the top) must still
  // land on screen there.
  await page.getByText('Open your own score').scrollIntoViewIfNeeded();
  await page
    .getByLabel('Open your own score')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(page.getByRole('status')).toBeInViewport();
  await expect(
    page.getByText(
      'That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).',
    ),
  ).toBeVisible();
  await expectOneRed(page, 'library with notice');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByText(/does not look like/)).toHaveCount(0);
});

test('library: the layout has no horizontal overflow', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

// Review S2 and L2: a piece opened from far down the list kept a clamped scroll offset (scrollY
// 578 for K.545 on a phone, its title and Play above the viewport), and going back always
// landed at the top of the library. Shelves spec 4.2: going back also restores the opened shelf
// and the pages shown. Runs at 1280 (desktop) and 360 px (mobile).
test('library: a piece opened from far down a shelf opens at the top; going back restores the level, the shelf, the pages and the list position', async ({
  page,
}) => {
  const scrollY = () => page.evaluate(() => window.scrollY);
  await page.goto('/');
  await libraryReady(page);
  // The shelves view shows a daily sample of each shelf, so on the days K.545 is in the Classical
  // sample `showPiece` finds its row there and opens no shelf. The shelf is opened on purpose:
  // going back has to restore it.
  const { tier, shelf } = placeOf('mozart-sonata-k545-mvt1');
  const pill = tierPill(page, tier);
  if (!(await pill.isChecked())) await pill.check();
  await shelfButton(page, shelf).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Classical']);
  const row = await showPiece(page, 'mozart-sonata-k545-mvt1');
  // a second page, so the restored list has to hold more than the first
  const more = showMoreButton(page);
  if (await more.isVisible()) await more.click();
  const rowCount = await pieceRows(page).count();
  // The row near the top of the screen, well below the start of the page.
  await row.evaluate((el) =>
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80),
  );
  const listY = await scrollY();
  expect(listY, 'the list is scrolled down').toBeGreaterThan(100);

  const expectArrivalAtTop = async (label: string) => {
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(1288, { timeout: 20_000 });
    expect(await scrollY(), `${label}: the score opens at the top`).toBe(0);
    await expect(
      page.getByRole('heading', { level: 1, name: /^Piano Sonata in C major/ }),
    ).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Play' })).toBeInViewport({ ratio: 1 });
    // And music: the first system starts on the first screen, above the dock.
    const first = await page.evaluate(() => ({
      system: document.querySelector('.score-sheet svg g.system')!.getBoundingClientRect().top,
      dock: document.querySelector('.dock')!.getBoundingClientRect().top,
    }));
    expect(first.system, `${label}: music above the dock`).toBeLessThan(first.dock);
    const roots = await expectOneRed(page, label);
    expect(roots[0]!.tag).toBe('button');
  };
  const expectListAt = async (label: string, leftAt: number) => {
    await expect(tierPill(page, placeOf('mozart-sonata-k545-mvt1').tier)).toBeChecked();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Classical']);
    await expect(pieceRows(page), `${label}: the pages shown`).toHaveCount(rowCount);
    const y = await scrollY();
    expect(Math.abs(y - leftAt), `${label}: scrollY ${y}, left at ${leftAt}`).toBeLessThanOrEqual(
      50,
    );
    await expectOneRed(page, label);
  };
  const expectListRestored = async (label: string) => {
    await expectListAt(label, listY);
    await expect(row).toBeInViewport();
  };

  await row.click();
  await expectArrivalAtTop('opened from far down');
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await expectListRestored('back with the button');

  await row.click();
  await expectArrivalAtTop('opened again');
  await page.goBack();
  await expectListRestored('back with the browser');

  // Left through the history (the browser's Forward), which no library control sees: Back lands
  // where the list was left, not where the piece was opened from (the review of Task 2 measured
  // 2722 instead of 500). A scroll's event comes with the next frame: two frames before Forward.
  await page.evaluate(async () => {
    window.scrollTo(0, 500);
    for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
  });
  expect(await scrollY()).toBe(500);
  await page.goForward();
  await expectArrivalAtTop('forward to the score');
  await page.goBack();
  await expectListAt('back after forward', 500);
});

// The longest shelf (Medium classical holds about 650 pieces) is read to its
// end, page by page: the last row stays reachable and the long page must not scroll sideways.
// The mobile project runs it at 360 px.
test('library: the last piece of the longest shelf is reachable and nothing overflows', async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  await tierPill(page, 'medium').check();
  const shelf = shelvesOf('medium').find((s) => s.id === 'classical')!;
  await shelfButton(page, 'classical').click();
  const more = showMoreButton(page);
  for (let pages = 0; pages < 40 && (await more.count()); pages++) await more.click();
  await expect(more).toHaveCount(0);
  const open = pieceRows(page);
  await expect(open).toHaveCount(shelf.count);
  const last = open.last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  const { overflow, right, clientWidth } = await last.evaluate((el) => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    right: el.getBoundingClientRect().right,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow, 'horizontal page overflow').toBeLessThanOrEqual(0);
  expect(right, 'last row inside the viewport width').toBeLessThanOrEqual(clientWidth);
});

test('library: the red button, then the search field, in the tab order', async ({ page }) => {
  await page.goto('/');
  await libraryReady(page);
  await page.getByRole('heading', { level: 1 }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^Start with/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('searchbox', { name: 'Search the library' })).toBeFocused();
});

test('library: "fur elise" finds Für Elise; Escape brings back the level and its pills', async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  await tierPill(page, 'medium').check();
  const field = page.getByRole('searchbox', { name: 'Search the library' });
  await field.fill('fur elise');
  await expect(pieceRows(page)).toHaveCount(searchRows('fur elise'));
  await expect(
    page.getByRole('button', { name: /^Open Für Elise \(Bagatelle in A minor\)/ }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Harder' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expectOneRed(page, 'search');
  await field.press('Escape');
  await expect(field).toHaveValue('');
  await expect(tierPill(page, 'medium')).toBeChecked();
});

// Shelves spec 4.4: every level answers in a section of 7 rows; All {n} in {Level} opens it to
// pages of 40; the shelf names are words of the pieces on them; length pills above 40 results.
test('library: search sections show 7 rows, open to pages of 40, and find a style by its name', async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  const field = page.getByRole('searchbox', { name: 'Search the library' });
  await field.fill('baroque');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Easy',
    'Medium',
    'Harder',
    'Challenging',
  ]);
  await expect(pieceRows(page)).toHaveCount(searchRows('baroque'));
  await expect(page.getByRole('group', { name: 'Length' })).toBeVisible();
  const medium = page
    .getByRole('heading', { level: 2, name: 'Medium' })
    .locator('xpath=ancestor::section');
  await expect(medium.getByRole('button', { name: /^Open / })).toHaveCount(7);
  await medium.getByRole('button', { name: /^All [\d,]+ in Medium$/ }).click();
  await expect(medium.getByRole('button', { name: /^Open / })).toHaveCount(
    Math.min(40, shelvesOf('medium').find((s) => s.id === 'baroque')!.count),
  );
  await expect(medium.getByRole('button', { name: /^Open / }).nth(7)).toBeFocused();
  await expectOneRed(page, 'search section open');
  await expectNoSeriousA11y(page, 'search section open');
  await field.fill('jazz');
  await expect(pieceRows(page)).toHaveCount(searchRows('jazz'));
});

test('library: no match says so; Clear brings the list back', async ({ page }) => {
  await page.goto('/');
  await libraryReady(page);
  await page.getByRole('searchbox', { name: 'Search the library' }).fill('fur elize');
  await expect(page.getByText('No piece matches “fur elize”.')).toBeVisible();
  await expect(page.getByText('Search looks in titles, composers and collections.')).toBeVisible();
  await expectOneRed(page, 'empty result');
  await page.getByRole('button', { name: 'Clear the search' }).click();
  await expect(pieceRows(page)).toHaveCount(arrivalRows('easy'));
});

test('library: back from a piece found by search shows the same search', async ({ page }) => {
  await page.goto('/');
  await libraryReady(page);
  await page.getByRole('searchbox', { name: 'Search the library' }).fill('petzold minuet');
  await page.getByRole('button', { name: 'Open Minuet in G minor by Christian Petzold' }).click();
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search the library' })).toHaveValue(
    'petzold minuet',
  );
  await expect(pieceRows(page)).toHaveCount(searchRows('petzold minuet'));
});

test('library: a file dropped on the window opens it; a drag that leaves hides the frame', async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  const xml = libraryScore('twinkle-twinkle-little-star').toString('utf8');
  const dt = await page.evaluateHandle((text) => {
    const d = new DataTransfer();
    d.items.add(new File([text], 'twinkle.musicxml'));
    return d;
  }, xml);
  await page.dispatchEvent('main', 'dragenter', { dataTransfer: dt });
  await dropFrameShown(page);
  const roots = await expectOneRed(page, 'drag');
  expect(roots[0]!.className).toContain('drop-frame');
  await page.dispatchEvent('main', 'dragleave', { dataTransfer: dt });
  await expect(page.locator('.drop-frame')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Start with/ })).toBeVisible();
  await page.dispatchEvent('main', 'dragenter', { dataTransfer: dt });
  await page.dispatchEvent('main', 'drop', { dataTransfer: dt });
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
});

test('library: a drag without files shows no frame', async ({ page }) => {
  await page.goto('/');
  await libraryReady(page);
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.setData('text/plain', 'Twinkle');
    return d;
  });
  await page.dispatchEvent('main', 'dragenter', { dataTransfer: dt });
  await expect(page.locator('.drop-frame')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Start with/ })).toBeVisible();
});

test('library: a piece played becomes the one to continue, on its level, across a reload', async ({
  page,
}) => {
  await page.goto('/?audio=silent#/piece/bach-minuet-g-major-bwv-anh-114');
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled({ timeout: 20_000 });
  // A first score view: the legend under the header, shown once on a screen (UI batch review):
  // from 900 px the side panel's copy beside the score, below 900 px the header's.
  const legends = page.getByText(FINGER_LEGEND, { exact: true });
  await expect(legends).toHaveCount(2);
  const wide = page.viewportSize()!.width >= 900;
  await expect(page.locator('.score-header .finger-legend')).toBeVisible({ visible: !wide });
  await expect(page.locator('.side-panel .finger-legend')).toBeVisible({ visible: wide });
  await page.getByRole('button', { name: 'Play' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Minuet in G major' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Easy', exact: true })).toBeChecked();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue with Minuet in G major' })).toBeVisible();
  await expectOneRed(page, 'returning');
  await page.getByRole('button', { name: 'Continue with Minuet in G major' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled({ timeout: 20_000 });
  await expect(page.locator('.score-header .finger-legend')).toHaveCount(0); // seen: the side panel keeps it
  await expect(page.locator('.side-panel .finger-legend')).toBeVisible();
});
