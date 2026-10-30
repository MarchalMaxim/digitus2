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
import { dropFrameShown, holdReadTimeout, pieceRows } from './helpers/states.js';
import { FINGER_LEGEND } from '../src/score/FingerLegend.js';
import { TIERS } from '../src/library/levels.js';
import { horizontalOverflow } from './helpers/overflow.js';
import { expectDigits } from './helpers/sheet.js';

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
    overflow:
      document.documentElement.scrollWidth -
      Math.ceil(document.documentElement.getBoundingClientRect().width),
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

// Issue 228: the control after the level pills deals the library again. The five samples of every
// shelf change, the red stays single, and the four pills still share one row (from 360 px) beside
// the control or above it.
test('library: the deal control draws other samples and keeps the pills on one row', async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  const deal = page.getByRole('button', { name: 'Show other pieces' });
  await expect(deal).toBeVisible();
  const names = () => pieceRows(page).evaluateAll((rows) => rows.map((r) => r.ariaLabel));
  const before = await names();
  await deal.click();
  await expect.poll(names).not.toEqual(before);
  await expect(pieceRows(page)).toHaveCount(arrivalRows('easy'));
  await expect(deal).toBeFocused();
  await expectOneRed(page, 'library dealt again');
  await expectNoSeriousA11y(page, 'library dealt again');
  const g = await page.evaluate(() => ({
    width: window.innerWidth,
    pills: [...document.querySelectorAll('.pill')].map((p) => p.getBoundingClientRect().top),
    control: document.querySelector('.tune-button')!.getBoundingClientRect().toJSON(),
    overflow:
      document.documentElement.scrollWidth -
      Math.ceil(document.documentElement.getBoundingClientRect().width),
  }));
  expect(g.pills).toHaveLength(4);
  for (const top of g.pills) expect(top, JSON.stringify(g)).toBe(g.pills[0]);
  expect(g.control.right, JSON.stringify(g)).toBeLessThanOrEqual(g.width);
  expect(g.control.width).toBe(44);
  expect(g.control.height).toBe(44);
  expect(g.overflow, JSON.stringify(g)).toBeLessThanOrEqual(0);
});

// UI batch review and design section 17: the words a first visit reads before the first piece.
// With shelves they are 41: the name 1, the sentence 14, the red button 6, the own-score line 4
// (issue 239: a visitor with a file in hand finds it on the first screen), the four pills 4, the
// first shelf's name 1, count 2 and line 9. On a touch-only device the photo line adds 4 more.
// Nothing else may grow.
test('library: at most 41 visible words before the first piece (design section 17)', async ({
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
  const photoLine =
    (await page.getByText('Photograph a printed score', { exact: true }).count()) > 0;
  expect(words.length, words.join(' ')).toBeLessThanOrEqual(photoLine ? 45 : 41);
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
  // The rows just shown fade in: axe reads their text through the opacity, so it waits for the
  // fade to end (gray-3, 4.5:1 on white, reads 4.47:1 just before it does).
  await page.evaluate(() =>
    Promise.all(
      [...document.querySelectorAll('.piece-list > .is-new')]
        .flatMap((el) => el.getAnimations())
        .map((a) => a.finished),
    ),
  );
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
  await page
    .getByLabel('Open your own score')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  // The notice, not the piano line's own status (issue 182), which stays empty here.
  await expect(page.locator('.notice[role="status"]')).toBeInViewport();
  await expect(
    page.getByText(
      'That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).',
    ),
  ).toBeVisible();
  await expectOneRed(page, 'library with notice');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByText(/does not look like/)).toHaveCount(0);
});

test('library: the address of a piece not in the library shows a notice', async ({ page }) => {
  await page.goto('/#/piece/does-not-exist');
  await expect(page.getByText('That piece is not in the library.')).toBeInViewport();
  await expect(page).toHaveURL(/#\/$/);
  await expectOneRed(page, 'library with unknown-piece notice');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByText('That piece is not in the library.')).toHaveCount(0);
});

test('library: the layout has no horizontal overflow', async ({ page }) => {
  await page.goto('/');
  const overflow = await horizontalOverflow(page);
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
    await expectDigits(page, 1288);
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
    overflow:
      document.documentElement.scrollWidth -
      Math.ceil(document.documentElement.getBoundingClientRect().width),
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

test('library: a hovered Clear stays a plain word inside the field (#76)', async ({ page }) => {
  await page.goto('/');
  await libraryReady(page);
  await page.getByRole('searchbox', { name: 'Search the library' }).fill('fur elize');
  const clear = page.getByRole('button', { name: 'Clear the search' });
  await clear.hover();
  // Read after the hover transition ends, or a fill still fading in reads as transparent.
  const background = await clear.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished));
    return getComputedStyle(el).backgroundColor;
  });
  expect(background).toBe('rgba(0, 0, 0, 0)');
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

test('library: the heart on a score puts the piece on the Favourites shelf, across a reload, and takes it off', async ({
  page,
}) => {
  await page.goto('/#/piece/bach-minuet-g-major-bwv-anh-114');
  const heart = page.getByRole('button', { name: 'Favourite' });
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Back to the library' }).click();
  const shelf = page.getByRole('region', { name: 'Favourites' });
  await expect(shelf.getByText('1 piece')).toBeVisible();
  await page.reload();
  await libraryReady(page);
  const row = shelf.getByRole('button', { name: /^Open Minuet in G major/ });
  await expect(row).toBeVisible();
  // The shelf stands above the levels.
  const [shelfTop, pillsTop] = await Promise.all([
    shelf.evaluate((e) => e.getBoundingClientRect().top),
    page.getByRole('group', { name: 'Level' }).evaluate((e) => e.getBoundingClientRect().top),
  ]);
  expect(shelfTop).toBeLessThan(pillsTop);
  await expectOneRed(page, 'favourites');
  await expectNoSeriousA11y(page);
  await row.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await libraryReady(page);
  await expect(page.getByRole('heading', { name: 'Favourites' })).toHaveCount(0);
});

// The UI review of issue #78: the Favourites shelf above the list grows or shrinks while the reader
// is on the score, and Back must still land on the same rows, not on the same pixel offset.
test('library: Back after the heart lands on the same rows, the Favourites shelf above them new or gone', async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  // A sample of the second shelf, brought near the top of the window.
  const row = page.locator('.library-list .shelf').nth(1).locator('.piece-row').first();
  const name = (await row.getAttribute('aria-label'))!;
  const inList = page.locator('.library-list').getByRole('button', { name, exact: true });
  await inList.evaluate((el) =>
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80),
  );
  const rowTop = () => inList.evaluate((el) => el.getBoundingClientRect().top);
  const before = await rowTop();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const heart = page.getByRole('button', { name: 'Favourite' });
  for (const pressed of ['true', 'false']) {
    await inList.click();
    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', pressed);
    await page.getByRole('button', { name: 'Back to the library' }).click();
    await libraryReady(page);
    await expect(page.getByRole('region', { name: 'Favourites' })).toHaveCount(
      pressed === 'true' ? 1 : 0,
    );
    expect(Math.abs((await rowTop()) - before), `the row with the heart ${pressed}`).toBeLessThan(
      3,
    );
  }
});

test('library: the filled heart on a Favourites row takes the piece off, the focus staying on the list, across a reload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(
      'digitus2.settings.v1',
      JSON.stringify({
        state: { settings: { favourites: ['ode-to-joy', 'bach-minuet-g-major-bwv-anh-114'] } },
        version: 2,
      }),
    );
  });
  await page.goto('/');
  await libraryReady(page);
  const shelf = page.getByRole('region', { name: 'Favourites' });
  await expect(
    shelf.getByText('The pieces you marked with the heart, newest first.'),
  ).toBeVisible();
  const hearts = shelf.getByRole('button', { name: /^Remove .* from Favourites$/ });
  await expect(hearts).toHaveCount(2);
  await shelf.getByRole('button', { name: /^Remove Ode to Joy \(simplified\) by / }).click();
  await expect(shelf.getByText('1 piece')).toBeVisible();
  await expect(hearts).toHaveCount(1);
  await expect(hearts.first()).toBeFocused();
  await expectOneRed(page, 'a favourite removed');
  await hearts.first().click();
  await expect(shelf).toHaveCount(0);
  await expect(tierPill(page, 'easy')).toBeFocused();
  await page.reload();
  await libraryReady(page);
  await expect(page.getByRole('heading', { name: 'Favourites' })).toHaveCount(0);
});

// Issue 239: a visitor with a file in hand finds the way in without scrolling, at 1280 and 360.
test('library: opening your own score is on the first screen, and the page keeps one red', async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  await expect(page.getByText('Open your own score', { exact: true })).toBeInViewport();
  const roots = await expectOneRed(page, 'library with the own-score line');
  expect(roots[0]!.tag).toBe('button');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

// Issue 240: the browser's read of a chosen file is held, as a file from a phone's provider or a
// cloud folder is while it downloads. The library shows the loader at once, never an unchanged page.
test('library: a chosen file shows the loader at once, as the one red, while it is read', async ({
  page,
}) => {
  await holdReadTimeout(page);
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    File.prototype.arrayBuffer = async function () {
      if (this.name.endsWith('.musicxml')) await held;
      return read.call(this);
    };
    Object.assign(window, { releaseRead: release });
  });
  await page.goto('/');
  await libraryReady(page);
  await page.getByLabel('Open your own score').setInputFiles({
    name: 'held.musicxml',
    mimeType: 'application/xml',
    buffer: libraryScore('twinkle-twinkle-little-star'),
  });
  const opening = page.locator('.opening');
  await expect(opening).toBeVisible();
  await expect(opening).toBeInViewport();
  await expect(page.getByTestId('opening-announcement')).toHaveText('Loading the score…');
  await expect(page.getByRole('button', { name: /^(Start|Continue) with / })).toBeHidden();
  const roots = await expectOneRed(page, 'a chosen file being read');
  expect(roots[0]!.className).toContain('loader-red');
  await page.evaluate(() => (window as unknown as { releaseRead(): void }).releaseRead());
  await expect(page.locator('.score-sheet svg').first()).toBeVisible();
  await expect(page.locator('.opening')).toHaveCount(0);
});

// The score view's chunk held on the network: the gap between the library leaving and the score
// arriving shows the same loader, not a blank page.
test('library: while the score view is still on its way the page shows the loader', async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/assets/ScoreView-*.js', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/');
  await libraryReady(page);
  await page.getByLabel('Open your own score').setInputFiles({
    name: 'chunk.musicxml',
    mimeType: 'application/xml',
    buffer: libraryScore('twinkle-twinkle-little-star'),
  });
  const opening = page.locator('.opening');
  await expect(opening).toBeVisible();
  await expect(page.locator('.library')).toHaveCount(0);
  const roots = await expectOneRed(page, 'the score view on its way');
  expect(roots[0]!.className).toContain('loader-red');
  release();
  await expect(page.locator('.score-sheet svg').first()).toBeVisible();
  await expect(page.locator('.opening')).toHaveCount(0);
});

// A file dropped anywhere on the page is read like a chosen one: the loader is in the window
// however far the page is scrolled, not in the welcome far above it.
test('library: a file dropped on a scrolled page shows the loader in the window', async ({
  page,
}) => {
  await holdReadTimeout(page);
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    File.prototype.arrayBuffer = async function () {
      if (this.name.endsWith('.musicxml')) await held;
      return read.call(this);
    };
    Object.assign(window, { releaseRead: release });
  });
  await page.goto('/');
  await libraryReady(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  const xml = libraryScore('twinkle-twinkle-little-star').toString('utf8');
  await page.evaluate((text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'dropped.musicxml', { type: 'application/xml' }));
    for (const type of ['dragenter', 'dragover', 'drop'])
      window.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, cancelable: true }));
  }, xml);
  const opening = page.locator('.opening');
  await expect(opening).toBeVisible();
  await expect(opening).toBeInViewport({ ratio: 1 });
  await expectOneRed(page, 'a dropped file being read, the page scrolled');
  await page.evaluate(() => (window as unknown as { releaseRead(): void }).releaseRead());
  await expect(page.locator('.score-sheet svg').first()).toBeVisible();
});

// A read that never finishes (a file whose provider does not answer) must not leave the reader
// with no way out: after 8 s the library is back with the notice. The page's clock is faked, so
// the 8 s are not waited for.
test('library: a read that never finishes gives the library back with the notice', async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    File.prototype.arrayBuffer = () => new Promise<ArrayBuffer>(() => undefined);
  });
  await page.goto('/');
  await libraryReady(page);
  await page.getByLabel('Open your own score').setInputFiles({
    name: 'never.musicxml',
    mimeType: 'application/xml',
    buffer: libraryScore('twinkle-twinkle-little-star'),
  });
  await expect(page.locator('.opening')).toBeVisible();
  await page.clock.runFor(7_900);
  await expect(page.locator('.opening')).toBeVisible();
  await page.clock.runFor(200);
  await expect(page.locator('.opening')).toHaveCount(0);
  await expect(page.locator('.notice')).toContainText('Could not read this file.');
  await expect(page.getByRole('button', { name: /^(Start|Continue) with / })).toBeVisible();
  await expectOneRed(page, 'the library after a read that never finished');
});
