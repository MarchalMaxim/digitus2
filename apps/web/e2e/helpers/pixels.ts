import type { Page } from '@playwright/test';

/** A rectangle in viewport pixels. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What a region of a screenshot holds of the accent. */
export interface AccentArea {
  /** Pixels that are the accent, rgb(227, 0, 15), at least about 91 % covered by it. */
  count: number;
  /** The smallest box holding those pixels (viewport pixels), or null when there are none. */
  box: Box | null;
}

/**
 * Counts the accent's pixels in each of `regions` of a screenshot taken with `clip`. A pixel
 * counts when no channel is more than 24 away from rgb(227, 0, 15): the accent drawn over at
 * least about 91 % of the pixel. Over paper the green channel is 255 times the part left
 * uncovered, so the cut-off is 1 - 24 / 255 = 90.6 % (an antialiased edge 90 % covered is
 * rgb(230, 26, 39), its green 25.5, and does not count). A hairline (a stroke under a pixel
 * wide) has no such pixel, so it adds nothing. Decoded by the
 * page itself, so the test needs no image library.
 */
export async function accentAreas(
  page: Page,
  png: Buffer,
  clip: { x: number; y: number; width: number; height: number },
  regions: Box[],
): Promise<AccentArea[]> {
  return page.evaluate(
    async ({ data, clip, regions }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data;
      const scale = img.width / clip.width;
      return regions.map((r) => {
        const x0 = Math.max(0, Math.floor((r.left - clip.x) * scale));
        const y0 = Math.max(0, Math.floor((r.top - clip.y) * scale));
        const x1 = Math.min(img.width, Math.ceil((r.right - clip.x) * scale));
        const y1 = Math.min(img.height, Math.ceil((r.bottom - clip.y) * scale));
        let count = 0;
        let box: { left: number; top: number; right: number; bottom: number } | null = null;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * img.width + x) * 4;
            const d = Math.max(Math.abs(px[i]! - 227), px[i + 1]!, Math.abs(px[i + 2]! - 15));
            if (d > 24) continue;
            count++;
            const left = clip.x + x / scale;
            const top = clip.y + y / scale;
            const right = clip.x + (x + 1) / scale;
            const bottom = clip.y + (y + 1) / scale;
            box = box
              ? {
                  left: Math.min(box.left, left),
                  top: Math.min(box.top, top),
                  right: Math.max(box.right, right),
                  bottom: Math.max(box.bottom, bottom),
                }
              : { left, top, right, bottom };
          }
        }
        return { count, box };
      });
    },
    { data: png.toString('base64'), clip, regions },
  );
}
