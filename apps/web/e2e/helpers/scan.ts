import { expect, type Page, type Request } from '@playwright/test';
import { SCAN_SERVICE } from '../../src/scan/service.js';

/** A 1×1 PNG: the source image of a mocked scan (its pixels are never recognised). */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
  'base64',
);
export const HEALTH = {
  protocol: 'digitus2-scan-v2',
  recognizer: 'test recognizer',
  capabilities: { textModelConfigured: true },
};

/** What a hook answers a recognition with: a status and a JSON body (or none). */
export interface MockAnswer {
  status?: number;
  json?: unknown;
  body?: string;
}

/** The method and path of a request to the scan service, e.g. `GET /v1/health`. */
export function serviceCall(request: Request): string | null {
  if (!request.url().startsWith(SCAN_SERVICE + '/') || request.method() === 'OPTIONS') return null;
  return `${request.method()} ${new URL(request.url()).pathname}`;
}
/** Records every call to the scan service, in order, as `serviceCall` names it. */
export function recordService(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    const call = serviceCall(request);
    if (call) calls.push(call);
  });
  return calls;
}

/**
 * Answers the scan service at `SCAN_SERVICE`: the health with `HEALTH`, every recognition with
 * `xml` (or what `onRecognize` answers instead) and every cancel as accepted.
 */
export async function mockService(
  page: Page,
  xml: string | ((request: Request) => string),
  hooks: { onRecognize?: (request: Request) => Promise<MockAnswer | void> } = {},
): Promise<void> {
  await page.route(`${SCAN_SERVICE}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    try {
      if (path === '/v1/health') await route.fulfill({ json: HEALTH });
      else if (request.method() === 'POST' && path === '/v1/recognize') {
        const answer = await hooks.onRecognize?.(request);
        if (answer) await route.fulfill(answer);
        else
          await route.fulfill({
            json: {
              state: 'ready',
              ...HEALTH,
              warnings: [],
              xml: typeof xml === 'string' ? xml : xml(request),
            },
          });
      } else if (request.method() === 'DELETE')
        await route.fulfill({ json: { state: 'cancelling' } });
      else await route.fulfill({ status: 404, json: { error: 'not-found' } });
    } catch {
      // The page aborted the request (a cancelled scan): there is no one left to answer.
    }
  });
}

/**
 * Fails every request to the scan service, for a spec that opens the scan page but never scans:
 * its warm-up must not reach the deployed service. The route outlives a reload.
 */
export async function blockService(page: Page): Promise<void> {
  await page.route(`${SCAN_SERVICE}/**`, (route) => route.abort());
}

/** Opens one page image from the library and scans it with the (mocked) scan service. */
export async function scanOnePage(page: Page, name = 'printed-score.png'): Promise<void> {
  await page.goto('/');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name, mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  await expect(page.locator('.scan-sheet svg').first()).toBeVisible();
}

/** One MusicXML note: `p` is a pitch like C5, B-4 (flat) or F#4, or 'r' for a rest. */
function note(
  p: string,
  duration: number,
  type: string,
  opts: { staff?: number; tie?: 'start' | 'stop'; dots?: boolean } = {},
): string {
  const staff = opts.staff ?? 1;
  let pitch = '<rest/>';
  if (p !== 'r') {
    const [, step, accidental, octave] = /^([A-G])(#|-)?(\d)$/.exec(p)!;
    const alter = accidental === '#' ? 1 : accidental === '-' ? -1 : 0;
    pitch = `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`;
  }
  const tie = opts.tie ? `<tie type="${opts.tie}"/>` : '';
  const tied = opts.tie ? `<notations><tied type="${opts.tie}"/></notations>` : '';
  return `<note>${pitch}<duration>${duration}</duration>${tie}<voice>${staff === 1 ? 1 : 5}</voice><type>${type}</type>${opts.dots ? '<dot/>' : ''}<staff>${staff}</staff>${tied}</note>`;
}
const backup = (d: number) => `<backup><duration>${d}</duration></backup>`;
const bass = backup(6) + note('C3', 6, 'half', { staff: 2, dots: true });

/**
 * A three-bar recognition in 3/4 with the errors of the test page in miniature: in bar 2 a
 * genuine A4 tie whose continuation arrives a quarter late (a stray quarter rest), which the
 * strict import refuses, and in bar 3 a misread D5 where the page has E5.
 */
export const RECOGNITION_WITH_ERRORS = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><identification><encoding><software>test recognizer</software></encoding></identification><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>${note('C5', 2, 'quarter')}${note('D5', 2, 'quarter')}${note('A4', 2, 'quarter', { tie: 'start' })}${bass}</measure><measure number="2">${note('r', 2, 'quarter')}${note('A4', 2, 'quarter', { tie: 'stop' })}${note('B4', 2, 'quarter')}${bass}</measure><measure number="3">${note('C5', 2, 'quarter')}${note('D5', 2, 'quarter')}${note('C5', 2, 'quarter')}${bass}</measure></part></score-partwise>`;

// Nine eighths in both hands: a bar of 9/8.
const nine =
  note('C5', 3, 'quarter', { dots: true }) +
  note('D5', 3, 'quarter', { dots: true }) +
  note('E5', 3, 'quarter', { dots: true }) +
  backup(9) +
  note('C3', 6, 'half', { staff: 2, dots: true }) +
  note('G3', 3, 'quarter', { staff: 2, dots: true });
/**
 * A page in 9/8 that the recognition read as 4/4, as homr did on the owner's photos of
 * Boëllmann Op. 28 No. II: both hands agree on every bar, and every bar runs past 4/4.
 */
export const RECOGNITION_MISREAD_METER = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><identification><encoding><software>test recognizer</software></encoding></identification><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>${nine}</measure><measure number="2">${nine}</measure><measure number="3">${nine}</measure></part></score-partwise>`;

/** Opens the review's "Files for a notation editor" disclosure, where the downloads are. */
export async function openFiles(page: Page): Promise<void> {
  const files = page.locator('details.scan-files');
  if (!(await files.evaluate((el) => (el as HTMLDetailsElement).open)))
    await files.locator('summary').click();
}
