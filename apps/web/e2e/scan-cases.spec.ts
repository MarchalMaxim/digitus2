import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page, type Request } from '@playwright/test';
import {
  caseFacts,
  caseFolders,
  decide,
  readCase,
  reportMarkdown,
  retakeAsked,
  type CaseResult,
  type CaseScreen,
  type CasesReport,
  type ScanCase,
} from './helpers/cases.js';
import { HEALTH, mockService } from './helpers/scan.js';

// The scan validation gate (issue 233): every scan the owner keeps is a case (docs/scanning.md,
// Validation cases), replayed here through the built app with the scanner's own answers. A clean
// photo whose notes are read right must reach Use for fingerings; a refusal must name the page or
// the bar and offer a fix to press. A page the scanner refused is answered with its refusal again,
// and the case is judged by what the app shows for it. Each row also keeps what every page read
// (bars, staves, key, time) against `expect.json`, and whether a page is to be photographed again;
// an `expect.json` that cannot be read fails its case, which would otherwise go unmeasured.
// The cases are private and live outside the repository, in the folder DIGITUS2_SCAN_CASES names;
// `pnpm verify` runs this spec as its `scan:cases` step.
const ROOT = process.env.DIGITUS2_SCAN_CASES;
const CASES = caseFolders(ROOT);
/** How long a review may take to settle after Scan this score. */
const SETTLE = 90_000;
/** How long the screen must stay the same to count as settled. */
const STEADY = 2_000;

/** Which page a recognition request carries: a slice from the middle of its photo, else none. */
function pageOf(request: Request, scan: ScanCase): number | undefined {
  const body = request.postDataBuffer();
  if (!body) return undefined;
  const index = scan.pages.findIndex((page) => {
    const middle = Math.floor(page.buffer.length / 2);
    return body.includes(page.buffer.subarray(middle, middle + 1024));
  });
  return index < 0 ? undefined : index;
}

/** What the review shows, read from the page in one go. */
async function readScreen(page: Page): Promise<Omit<CaseScreen, 'settled'> & { busy: boolean }> {
  return page.evaluate(() => {
    const text = (el: Element | null | undefined) =>
      (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const shown = (el: Element) => el.getClientRects().length > 0;
    const verdictEl = document.querySelector('.scan-verdict');
    const alerts = [...document.querySelectorAll('[role=alert]')]
      .filter((el) => el !== verdictEl && shown(el))
      .map(text)
      .filter(Boolean);
    // The technical lines sit under Recognition details, closed: read their text, not their look.
    const technical = [...document.querySelectorAll('p')]
      .map(text)
      .filter((line) => line.startsWith('Technical reason'));
    // A page the scanner did not read keeps the scan on its start screen, with its reason under it.
    const pageErrors = [...document.querySelectorAll('[role=status]')]
      .filter(shown)
      .map(text)
      .filter((line) => /^Page \d+: /.test(line));
    // A place's first button selects its note; the ones after it are the corrections offered.
    const places = [...document.querySelectorAll('details.scan-problems li')].map((li) => {
      const buttons = [...li.querySelectorAll<HTMLButtonElement>('.scan-problem-body button')];
      return {
        text: text(buttons[0] ?? li),
        select: !!buttons[0] && !buttons[0].disabled,
        offer: buttons.slice(1).some((b) => !b.disabled),
      };
    });
    let retake = false;
    let fixAll = false;
    for (const button of document.querySelectorAll('button')) {
      if (button.disabled || !shown(button)) continue;
      const label = text(button);
      if (
        /^(Replace page \d+ with a new photo|Photograph page \d+ again|Replace it with a new photo|Photograph it again)$/.test(
          label,
        )
      )
        retake = true;
      else if (/^Fix all\b/.test(label)) fixAll = true;
    }
    const showBar = [...document.querySelectorAll<HTMLButtonElement>('button.scan-show-bar')].some(
      (button) => !button.disabled && shown(button),
    );
    const use = document.querySelector<HTMLButtonElement>('button.scan-use');
    const usable = !!use && !use.disabled;
    // Use for fingerings carries the red, disabled, while the recognition is still being checked.
    const checking = !!use && use.disabled && use.classList.contains('is-red');
    const drawn = !!document.querySelector('.scan-sheet svg');
    const loading = !!document.querySelector('.scan-loader');
    const blocking = verdictEl?.getAttribute('role') === 'alert';
    return {
      verdict: text(verdictEl),
      blocking,
      alerts,
      pageErrors,
      technical,
      places,
      usable,
      retake,
      fixAll,
      showBar,
      busy: loading || checking || !(usable || drawn || blocking || alerts.length > 0),
    };
  });
}

/** Waits until the review stops changing and has something to say, at most `SETTLE`. */
async function settle(page: Page, started: number): Promise<CaseScreen> {
  let last = '';
  let since = Date.now();
  let screen = await readScreen(page);
  for (;;) {
    const key = JSON.stringify(screen);
    if (key !== last) {
      last = key;
      since = Date.now();
    } else if (!screen.busy && Date.now() - since >= STEADY) {
      return { ...screen, settled: true };
    }
    if (Date.now() - started > SETTLE) return { ...screen, settled: false };
    await page.waitForTimeout(250);
    screen = await readScreen(page);
  }
}

/** Replays one case in a fresh browser context: My scores of one case never reaches the next. */
async function replay(browser: Browser, baseURL: string, scan: ScanCase): Promise<CaseResult> {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  try {
    let calls = 0;
    await mockService(page, '', {
      onRecognize: async (request) => {
        const index = pageOf(request, scan) ?? Math.min(calls, scan.pages.length - 1);
        calls++;
        const { answer, xml, refused } = scan.pages[index]!;
        // A page the scanner refused gets its refusal again: the 422 or 504 and the body it sent.
        if (refused) return { status: refused.status, json: refused.answer };
        // As the service answers: the recognizer's record (recognizer, warnings) beside the notation.
        return { json: { state: 'ready', ...HEALTH, ...answer, xml } };
      },
    });
    await page.goto('/');
    await page
      .locator('input[type=file]')
      .first()
      .setInputFiles(scan.pages.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer })));
    if (scan.pages.length > 1)
      await expect(page.locator('.scan-page-list li')).toHaveCount(scan.pages.length);
    await page.getByRole('button', { name: 'Scan this score' }).click();
    const started = Date.now();
    const screen = await settle(page, started);
    const seconds = (Date.now() - started) / 1000;
    await page.screenshot({ path: join(scan.dir, 'review.png'), fullPage: true });
    let fingerings = 0;
    if (screen.settled && screen.usable) {
      await page.getByRole('button', { name: 'Use for fingerings' }).click();
      const fing = page.locator('.score-sheet g.fing');
      try {
        await fing.first().waitFor({ state: 'visible', timeout: 60_000 });
        fingerings = await fing.count();
      } catch {
        // No fingering in a minute: the case fails with the score view as it is.
      }
      await page.screenshot({ path: join(scan.dir, 'score.png'), fullPage: true });
    }
    const facts = caseFacts(scan);
    const { outcome, why, fixes } = decide(
      screen,
      fingerings,
      scan.pages.length,
      facts.pages,
      scan.expectProblem,
    );
    return {
      case: scan.name,
      outcome,
      why,
      verdict: screen.verdict,
      alerts: screen.alerts,
      technical: screen.technical,
      places: screen.places.length,
      fixes,
      fingerings,
      seconds,
      ...facts,
      retake: retakeAsked(screen),
    };
  } finally {
    await context.close();
  }
}

test('scan cases: every kept scan is usable, or its refusal names the place and offers a fix', async ({
  browser,
}, testInfo) => {
  test.skip(
    CASES.length === 0,
    ROOT ? `no scan cases in ${ROOT}` : 'DIGITUS2_SCAN_CASES names no folder of scan cases',
  );
  test.setTimeout(CASES.length * 180_000);
  const baseURL = testInfo.project.use.baseURL!;
  const results: CaseResult[] = [];
  for (const name of CASES) {
    const scan = readCase(ROOT!, name);
    await test.step(name, async () => {
      const started = Date.now();
      try {
        results.push(await replay(browser, baseURL, scan));
      } catch (error) {
        results.push({
          case: name,
          outcome: 'failed',
          why: `the replay broke: ${String(error).split('\n')[0]}`,
          verdict: '',
          alerts: [],
          technical: [],
          places: 0,
          fixes: [],
          fingerings: 0,
          seconds: (Date.now() - started) / 1000,
          ...caseFacts(scan),
          retake: false,
        });
      }
      const result = results[results.length - 1]!;
      console.log(`${result.outcome.padEnd(9)} ${name}: ${result.why}`);
    });
  }
  const report: CasesReport = { ranAt: new Date().toISOString(), cases: results };
  // The run before stays beside it, for `report.mjs --diff` (research/omr/diagnostics).
  const last = join(ROOT!, 'report.json');
  if (existsSync(last)) renameSync(last, join(ROOT!, 'report-previous.json'));
  writeFileSync(last, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(ROOT!, 'report.md'), reportMarkdown(report));
  const failed = results.filter((r) => r.outcome === 'failed').map((r) => `${r.case}: ${r.why}`);
  expect(failed, `failed cases (report: ${join(ROOT!, 'report.md')})`).toEqual([]);
});
