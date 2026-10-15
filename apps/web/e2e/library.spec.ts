import { expect, test } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { LEVEL_COUNTS, libraryReady, showLevelOf } from './helpers/library.js';
import { libraryScore } from './helpers/files.js';
import { expectOneRed } from './helpers/red.js';
import { dropFrameShown, pieceRows } from './helpers/states.js';
import { FINGER_LEGEND } from '../src/score/FingerLegend.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __lcp: number }).__lcp = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        (window as unknown as { __lcp: number }).__lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
});

test('library: one level at a time, one red element, no serious a11y issues, LCP under 2 s', async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  await expect(pieceRows(page)).toHaveCount(LEVEL_COUNTS[1]!);
  await expect(page.getByRole('radio', { name: 'First steps', exact: true })).toBeChecked();
  await expect(page.getByText(FINGER_LEGEND)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Start here' })).toHaveCount(0);
  const roots = await expectOneRed(page, 'library');
  expect(roots[0]!.tag).toBe('button');
  await expectNoSeriousA11y(page, 'library');
  const lcp = await page.evaluate(() => (window as unknown as { __lcp: number }).__lcp);
  expect(lcp, `LCP ${lcp} ms`).toBeLessThan(2000);
});

// Spec section 17: the red button and the first row on the first screen, every pill inside the
// viewport (they wrap at 360 px), no horizontal scroll. Runs at 1280 (desktop) and 360 (mobile).
test('library: the first screen at this width (spec 17)', async ({ page }) => {
  await page.goto('/');
  await libraryReady(page);
  const g = await page.evaluate(() => ({
    width: window.innerWidth,
    red: document.querySelector('.library .is-red')!.getBoundingClientRect().top,
    row: document.querySelector('.piece-row')!.getBoundingClientRect().top,
    pills: [...document.querySelectorAll('.pill')].map((p) => {
      const r = p.getBoundingClientRect();
      return { left: r.left, right: r.right };
    }),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  const phone = g.width < 480;
  const at = JSON.stringify(g);
  expect(g.red, at).toBeLessThanOrEqual(phone ? 160 : 130);
  expect(g.row, at).toBeLessThanOrEqual(phone ? 470 : 330);
  expect(g.pills).toHaveLength(5);
  for (const p of g.pills) {
    expect(p.left, at).toBeGreaterThanOrEqual(0);
    expect(p.right, at).toBeLessThanOrEqual(g.width);
  }
  expect(g.overflow, at).toBeLessThanOrEqual(0);
});

// UI batch review and design section 17: the words a first visit reads before the first piece.
// At 149 pieces, at 1280 and 360, they are 36: the name 1, the sentence 15, the red button 5, the
// five pills 6, the level line 6 and the first collection heading 2 (the search field's
// 4-word placeholder is not text in the page and is not counted). The budget may not grow.
test('library: at most 36 visible words before the first piece (design section 17)', async ({
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
  expect(words.length, words.join(' ')).toBeLessThanOrEqual(36);
});

test('library: the arrow keys choose a level; the list follows and the pill keeps the focus', async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  await page.getByRole('radio', { name: 'First steps', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  const easy = page.getByRole('radio', { name: 'Easy', exact: true });
  await expect(easy).toBeChecked();
  await expect(easy).toBeFocused();
  await expect(pieceRows(page)).toHaveCount(LEVEL_COUNTS[2]!);
  await expect(page.getByText('The hands begin to move.')).toBeVisible();
  await expectOneRed(page, 'Easy chosen');
});

test('library: an unsupported file shows a notice and keeps one red element', async ({ page }) => {
  await page.goto('/');
  // The end line sits at the bottom of a long page; the notice (sticky at the top) must still
  // land on screen there.
  await page.getByText('Open your own MusicXML or MIDI file').scrollIntoViewIfNeeded();
  await page
    .getByLabel('Open your own MusicXML or MIDI file')
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
// landed at the top of the library. Runs at 1280 (desktop) and 360 px (mobile).
test('library: a piece opened from far down opens at the top; going back restores the level and the list position', async ({
  page,
}) => {
  const scrollY = () => page.evaluate(() => window.scrollY);
  await page.goto('/');
  await libraryReady(page);
  await showLevelOf(page, 'mozart-sonata-k545-mvt1');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const row = page.getByRole('button', {
    name: /^Open Piano Sonata in C major \('Sonata facile'\), 1st movement/,
  });
  await row.scrollIntoViewIfNeeded();
  const listY = await scrollY();
  expect(listY, 'the list is scrolled far down').toBeGreaterThan(300);

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
    await expect(page.getByRole('radio', { name: 'Intermediate', exact: true })).toBeChecked();
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

// The list grows with the library (L1: about 150 pieces, 45 rows at level 2); the last row must
// stay reachable and the long page must not scroll sideways. The mobile project runs it at 360 px.
test('library: the last piece of the last level is reachable and nothing overflows', async ({
  page,
}) => {
  await page.goto('/');
  await libraryReady(page);
  await page.getByRole('radio', { name: 'Challenging', exact: true }).check();
  const open = pieceRows(page);
  await expect(open).toHaveCount(LEVEL_COUNTS[5]!);
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
  await page.getByRole('radio', { name: 'Easy', exact: true }).check();
  const field = page.getByRole('searchbox', { name: 'Search the library' });
  await field.fill('fur elise');
  await expect(pieceRows(page)).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 2, name: 'Intermediate' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expectOneRed(page, 'search');
  await field.press('Escape');
  await expect(field).toHaveValue('');
  await expect(page.getByRole('radio', { name: 'Easy', exact: true })).toBeChecked();
});

test('library: no match says so; Clear brings the list back', async ({ page }) => {
  await page.goto('/');
  await libraryReady(page);
  await page.getByRole('searchbox', { name: 'Search the library' }).fill('fur elize');
  await expect(page.getByText('No piece matches “fur elize”.')).toBeVisible();
  await expect(page.getByText('Search looks in titles, composers and collections.')).toBeVisible();
  await expectOneRed(page, 'empty result');
  await page.getByRole('button', { name: 'Clear the search' }).click();
  await expect(pieceRows(page)).toHaveCount(LEVEL_COUNTS[1]!);
});

test('library: back from a piece found by search shows the same search', async ({ page }) => {
  await page.goto('/');
  await libraryReady(page);
  await page.getByRole('searchbox', { name: 'Search the library' }).fill('minuet');
  await page.getByRole('button', { name: /^Open Minuet in G minor/ }).click();
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search the library' })).toHaveValue('minuet');
  await expect(pieceRows(page)).toHaveCount(14);
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
