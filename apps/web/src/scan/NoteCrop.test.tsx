import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CROP_HALF_HEIGHT_SPACES, CROP_HALF_WIDTH_SPACES, fallbackSpace } from './crop.js';
import { NoteCrop, pageImage } from './NoteCrop.js';

type Draw = unknown[];
let draws: Draw[];
let bitmaps: number;

/** A page of `staves` five-line staves `spacing` pixels apart, as the analysis canvas would read it. */
function stavesPage(width: number, height: number, spacing: number, staves = 4) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let staff = 0; staff < staves; staff++) {
    const centre = Math.round(((staff + 1) * height) / (staves + 1));
    for (let line = -2; line <= 2; line++)
      for (let x = Math.round(width * 0.05); x < width * 0.95; x++) {
        const i = ((centre + line * spacing) * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 20;
      }
  }
  return data;
}

/** What the analysis canvas reads; a blank page unless a test draws staves on it. */
let analysisPage: ((width: number, height: number) => Uint8ClampedArray) | null;

/** A 2D context that records its drawImage calls. */
function stubCanvas(context: 'normal' | 'none' = 'normal') {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    if (context === 'none') return null;
    return {
      fillRect: () => {},
      drawImage: (...args: unknown[]) => draws.push([this, ...args]),
      getImageData: () => ({
        width: this.width,
        height: this.height,
        data:
          analysisPage?.(this.width, this.height) ??
          new Uint8ClampedArray(this.width * this.height * 4).fill(255),
      }),
      set fillStyle(_: string) {},
    } as unknown as CanvasRenderingContext2D;
  });
}

beforeEach(() => {
  draws = [];
  bitmaps = 0;
  analysisPage = null;
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      bitmaps++;
      return { width: 100, height: 100, close: () => {} };
    }),
  );
  vi.stubGlobal('devicePixelRatio', 2);
  stubCanvas();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const photo = () => new Blob(['x'], { type: 'image/png' });

it('draws the photo around the note and names the bar', async () => {
  const file = photo();
  const image = await pageImage(file);
  expect(image).not.toBeNull();
  render(<NoteCrop image={file} at={{ x: 40, y: 50 }} label="Bar 3 in the photo" size="large" />);
  const crop = await screen.findByRole('img', { name: 'Bar 3 in the photo' });
  const canvas = crop.querySelector('canvas')!;
  // 192 x 96 CSS pixels at a device pixel ratio of 2.
  expect([canvas.width, canvas.height]).toEqual([384, 192]);
  await waitFor(() => expect(draws.some((d) => d[0] === canvas)).toBe(true));
  const space = fallbackSpace(100);
  const call = draws.find((d) => d[0] === canvas)!;
  // drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh): the source rectangle is centred on the note.
  expect(call.slice(2)).toEqual([
    40 - CROP_HALF_WIDTH_SPACES * space,
    50 - CROP_HALF_HEIGHT_SPACES * space,
    2 * CROP_HALF_WIDTH_SPACES * space,
    2 * CROP_HALF_HEIGHT_SPACES * space,
    0,
    0,
    384,
    192,
  ]);
  expect(crop.querySelector('.note-crop-frame')).not.toBeNull();
});

it('reads a photo once for every crop of it', async () => {
  const file = photo();
  render(
    <>
      <NoteCrop image={file} at={{ x: 10, y: 10 }} label="Bar 1 in the photo" size="small" />
      <NoteCrop image={file} at={{ x: 60, y: 60 }} label="Bar 2 in the photo" size="small" />
    </>,
  );
  expect(await screen.findAllByRole('img')).toHaveLength(2);
  expect(bitmaps).toBe(1);
});

it('shows nothing when the browser cannot draw', async () => {
  vi.restoreAllMocks();
  stubCanvas('none');
  const file = photo();
  expect(await pageImage(file)).toBeNull();
  render(<NoteCrop image={file} at={{ x: 10, y: 10 }} label="Bar 1 in the photo" size="large" />);
  await Promise.resolve();
  expect(screen.queryByRole('img')).toBeNull();
});

it('shows a blank page as the guessed staff space', async () => {
  const file = photo();
  expect((await pageImage(file))?.space).toBe(fallbackSpace(100));
});

it('measures the staff space in the pixels of the photo, not of the smaller copy it analyses', async () => {
  // A 1500 x 2000 photo is analysed as a 1000 x 1333 copy, whose staves are 7 px apart.
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 1500, height: 2000, close: () => {} })),
  );
  analysisPage = (width, height) => stavesPage(width, height, 7);
  const image = (await pageImage(photo()))!;
  expect(image.scale).toBeCloseTo(1);
  expect(image.space).toBeCloseTo(7 / (1000 / 1500), 0);
  expect(image.space).not.toBe(fallbackSpace(1500));
});

it('draws nothing from the previous page while the next one is decoded', async () => {
  const first = photo();
  const second = photo();
  let release!: () => void;
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (blob: Blob) => {
      if (blob === second) await new Promise<void>((done) => (release = done));
      return { width: 100, height: 100, close: () => {} };
    }),
  );
  const crop = (file: Blob, x: number) => (
    <NoteCrop image={file} at={{ x, y: 50 }} label={`Bar at ${x}`} size="large" />
  );
  const { rerender } = render(crop(first, 40));
  await screen.findByRole('img', { name: 'Bar at 40' });
  await waitFor(() => expect(draws.length).toBeGreaterThan(0));
  const before = draws.length;
  rerender(crop(second, 70));
  // The second page is still decoding: the crop is gone, and nothing was drawn at the new spot.
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByRole('img')).toBeNull();
  expect(draws.length).toBe(before);
  await act(async () => release());
  const shown = await screen.findByRole('img', { name: 'Bar at 70' });
  await waitFor(() => expect(draws.length).toBeGreaterThan(before));
  expect(draws.at(-1)![0]).toBe(shown.querySelector('canvas'));
});

it('decodes one page at a time and keeps only the last three', async () => {
  let open = 0;
  let most = 0;
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      bitmaps++;
      most = Math.max(most, ++open);
      await new Promise((done) => setTimeout(done, 1));
      open--;
      return { width: 100, height: 100, close: () => {} };
    }),
  );
  const files = [photo(), photo(), photo(), photo()];
  const images = await Promise.all(files.map((file) => pageImage(file)));
  expect(most).toBe(1);
  // The oldest page gave its canvas back; the three newest keep theirs.
  expect(images.map((image) => image!.canvas.width > 0)).toEqual([false, true, true, true]);
  // Asking for it again decodes it again, and a kept page is not decoded twice.
  const before = bitmaps;
  await pageImage(files[3]!);
  expect(bitmaps).toBe(before);
  expect((await pageImage(files[0]!))!.canvas.width).toBeGreaterThan(0);
  expect(bitmaps).toBe(before + 1);
});
