import { expect, type Page } from '@playwright/test';

/** A 1×1 PNG: the source image of a mocked scan (its pixels are never recognised). */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
  'base64',
);
export const HEALTH = {
  protocol: 'digitus2-scan-v1',
  recognizer: 'test recognizer',
  capabilities: { textModelConfigured: true },
};

/** Answers the PC worker's protocol with `xml` as every page's recognition. */
export async function mockWorker(page: Page, xml: string | (() => string)): Promise<void> {
  const id = 'd'.repeat(32);
  await page.route('http://127.0.0.1:8996/**', async (route) => {
    const request = route.request();
    if (request.url().endsWith('/health')) await route.fulfill({ json: HEALTH });
    else if (request.method() === 'POST') await route.fulfill({ status: 202, json: { id } });
    else if (request.method() === 'DELETE') await route.fulfill({ json: { state: 'cancelled' } });
    else if (request.url().endsWith('/result'))
      await route.fulfill({ body: typeof xml === 'string' ? xml : xml() });
    else await route.fulfill({ json: { state: 'ready', ...HEALTH } });
  });
}

/** Opens one page image from the library, connects to the (mocked) PC and scans it. */
export async function scanOnePage(page: Page, name = 'printed-score.png'): Promise<void> {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Connect to this PC' }).click();
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
