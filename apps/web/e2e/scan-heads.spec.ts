import { readFileSync } from 'node:fs';
import { expect, test, type Locator } from '@playwright/test';
import { mockService, scanOnePage } from './helpers/scan.js';

// The frame sits on the notehead (issue 226). homr's position is the transformer's attention, not
// the head: on this photo the point lies 5 to 10 px (about a staff space) from the head it names.
// The review finds the head at the note's pitch on the traced staff, near homr's point, and frames
// that. The truth is the head centres read off the photo by eye, good to a pixel or two.
test.use({ hasTouch: false, isMobile: false });

const PHOTO = readFileSync(
  new URL('../../../research/omr/photos/bach-invention13-page1-photoscan.jpeg', import.meta.url),
);
const XML = readFileSync(
  new URL('../fixtures/scan/bach-invention13-page1-photoscan.musicxml', import.meta.url),
  'utf8',
);

/** Notes by their ordinal in the recognition, with homr's point and the head's true centre in the photo's pixels. */
const NOTES = [
  { ordinal: 3, what: 'bar 1, left hand, A3', homr: [194, 309], head: [188, 314] },
  { ordinal: 6, what: 'bar 1, right hand, B4', homr: [218, 238], head: [223, 230] },
  { ordinal: 30, what: 'bar 2, right hand, B4', homr: [520, 240], head: [518, 234] },
] as const;
/** Pixels of the photo. */
const TOLERANCE = 4;

/** The centre of a note in the notation, scrolled into view. */
async function centreOf(note: Locator) {
  await note.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  return note.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
}

test('scan heads: the frame on the photo and the crop are centred on the notehead, not on homr’s point', async ({
  page,
}) => {
  await mockService(page, XML);
  await scanOnePage(page, 'bach.jpeg', PHOTO);
  await expect(page.locator('.scan-sheet')).toHaveAttribute('aria-busy', 'false');
  for (const { ordinal, what, homr, head } of NOTES) {
    // The fixture really names the offset point the test is about.
    expect(Math.hypot(homr[0] - head[0], homr[1] - head[1]), what).toBeGreaterThan(5);
    const at = await centreOf(page.locator(`.scan-sheet [id="s${ordinal}"]`));
    await page.mouse.click(at.x, at.y);
    await expect(page.locator(`.scan-sheet [id="s${ordinal}"]`)).toHaveClass(/is-red/);

    // The ink frame on the whole photo: the rectangle in the photo's own pixels.
    const frame = page.locator('.scan-photo-focus');
    await expect(frame).toHaveCount(1);
    const centre = async () =>
      frame.evaluate((el) => {
        const n = (name: string) => Number(el.getAttribute(name));
        return { x: n('x') + n('width') / 2, y: n('y') + n('height') / 2 };
      });
    await expect
      .poll(async () => Math.hypot((await centre()).x - head[0], (await centre()).y - head[1]), {
        message: `${what}: the frame on the photo`,
      })
      .toBeLessThanOrEqual(TOLERANCE);

    // The zoomed crop is centred on the same point, which its frame marks.
    const crop = page.locator('.note-editor .note-crop');
    await expect
      .poll(
        async () => {
          const [x, y] = ((await crop.getAttribute('data-at')) ?? '0,0').split(',').map(Number);
          return Math.hypot(x! - head[0], y! - head[1]);
        },
        { message: `${what}: the crop` },
      )
      .toBeLessThanOrEqual(TOLERANCE);
  }
});
