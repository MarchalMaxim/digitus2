import { expect, test } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { LIBRARY_COUNT } from './helpers/library.js';
import { expectOneRed } from './helpers/red.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __lcp: number }).__lcp = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        (window as unknown as { __lcp: number }).__lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
});

test('library: every piece, one red element, no serious a11y issues, LCP under 2 s', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(LIBRARY_COUNT);
  await expectOneRed(page, 'library');
  await expectNoSeriousA11y(page, 'library');
  const lcp = await page.evaluate(() => (window as unknown as { __lcp: number }).__lcp);
  expect(lcp, `LCP ${lcp} ms`).toBeLessThan(2000);
});

test('library: an unsupported file shows a notice and keeps one red element', async ({ page }) => {
  await page.goto('/');
  // The drop zone sits at the bottom of a long page; the notice must still land on screen there.
  await page.getByTestId('drop-zone').scrollIntoViewIfNeeded();
  await page
    .getByLabel('choose a file')
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

// Polish plan Task 5, review S4: no screen said that 1 is the thumb and 5 the little finger, or
// which staff is which hand. The welcome says it, on the first screen with the red start button,
// at 1280 (desktop) and 360 px (mobile).
test('library: the welcome explains the finger numbers on the first screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(LIBRARY_COUNT);
  const legend = page
    .locator('.welcome')
    .getByText(
      'Finger numbers: 1 is the thumb and 5 the little finger, in both hands. The upper staff is the right hand, the lower staff the left.',
      { exact: true },
    );
  await expect(legend).toBeVisible();
  await expect(legend).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: /^Start with/ })).toBeInViewport({ ratio: 1 });
  const roots = await expectOneRed(page, 'library with the finger legend');
  expect(roots[0]!.tag).toBe('button');
  await expectNoSeriousA11y(page, 'library with the finger legend');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

// Review S2 and L2: a piece opened from far down the list kept a clamped scroll offset (scrollY
// 578 for K.545 on a phone, its title and Play above the viewport), and going back always
// landed at the top of the library. Runs at 1280 (desktop) and 360 px (mobile).
test('library: a piece opened from far down opens at the top; going back restores the list position', async ({
  page,
}) => {
  const scrollY = () => page.evaluate(() => window.scrollY);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(LIBRARY_COUNT);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const row = page.getByRole('button', {
    name: /^Open Piano Sonata in C major \('Sonata facile'\), 1st movement/,
  });
  await row.scrollIntoViewIfNeeded();
  const listY = await scrollY();
  expect(listY, 'the list is scrolled far down').toBeGreaterThan(1000);

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
    await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(LIBRARY_COUNT);
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

// Polish plan Task 6, review L1: the drop zone sat after all 30 rows (y = 2883 of 3065 px at
// 1280, 3884 of 4089 px at 360), and nothing near the top said a reader can open their own
// score. A link under the welcome brings the drop zone into view and puts the focus on its file
// chooser. Runs at 1280 (desktop) and 360 px (mobile).
test('library: "Open your own MusicXML file" under the welcome brings the drop zone into view and focuses its chooser', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(LIBRARY_COUNT);
  const link = page
    .locator('.welcome')
    .getByRole('link', { name: 'Open your own MusicXML file', exact: true });
  const zone = page.getByTestId('drop-zone');
  const chooser = page.getByLabel('choose a file');
  // On the first screen, with the red start button.
  await expect(link).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: /^Start with/ })).toBeInViewport({ ratio: 1 });
  await expect(zone).not.toBeInViewport();

  await link.click();
  await expect(zone).toBeInViewport({ ratio: 1 });
  await expect(chooser).toBeFocused();
  // The library stays: no piece opened, the address unchanged.
  await expect(page).toHaveURL(/\/#\/$/);
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(LIBRARY_COUNT);
  const roots = await expectOneRed(page, 'library at the drop zone');
  expect(roots[0]!.tag).toBe('button');
  await expectNoSeriousA11y(page, 'library at the drop zone');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // From the keyboard too, on a fresh page: the first Tab reaches the link, Enter follows it, and
  // the chooser shows its focus ring.
  await page.reload();
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(LIBRARY_COUNT);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(zone).not.toBeInViewport();
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(zone).toBeInViewport({ ratio: 1 });
  await expect(chooser).toBeFocused();
  await expect(page.locator('.file-choose')).toHaveCSS('outline-style', 'solid');

  // And the chooser opens a file from there.
  await chooser.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('x'),
  });
  await expect(
    page.getByText(
      'That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).',
    ),
  ).toBeInViewport();
});

// The list grows with the library (L1: about 150 pieces, 45 rows at level 2); the last row must
// stay reachable and the long page must not scroll sideways. The mobile project runs it at 360 px.
test('library: the last piece is reachable and nothing overflows', async ({ page }) => {
  await page.goto('/');
  const open = page.getByRole('button', { name: /^Open / });
  await expect(open).toHaveCount(LIBRARY_COUNT);
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
