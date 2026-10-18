/**
 * A phone or tablet cannot reach the PC worker: its 127.0.0.1 is the device itself. Such a device
 * photographs the pages and hands them to the reader, who opens them on the PC. The app uploads
 * nothing; sharing goes through the device's own share sheet, or the photos are saved.
 */
import { downloadBlob } from '../export/download.js';
import type { ScanPage } from './model.js';

/**
 * True on a device whose only pointer is a finger. A touch laptop also has a fine pointer, and a
 * browser that cannot tell (tests, old browsers) counts as a PC, which keeps the PC path.
 */
export function isTouchOnly(): boolean {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(any-pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}

let lastCapture = '';
let sameSecond = 0;
/**
 * A camera capture renamed after the time it was taken ("photo 14.05.31.jpg"): phones hand
 * every capture over as "image.jpg", which says nothing in a list of pages.
 */
export function namedCapture(file: File, at = new Date()): File {
  const time = [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join('.');
  sameSecond = time === lastCapture ? sameSecond + 1 : 1;
  lastCapture = time;
  const extension = file.type === 'image/png' ? 'png' : 'jpg';
  return new File([file], `photo ${time}${sameSecond > 1 ? ` (${sameSecond})` : ''}.${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

/** The files to hand over, named in reading order so the PC's file chooser lists them in order. */
export function handOffFiles(pages: readonly ScanPage[]): File[] {
  const width = String(pages.length).length;
  return pages.map((page, index) => {
    const name = (page.originalFile ?? page.file).name.replace(/\.[^.]+$/, '');
    const extension = page.file.type === 'image/png' ? 'png' : 'jpg';
    return new File(
      [page.file],
      `page-${String(index + 1).padStart(Math.max(2, width), '0')}-${name}.${extension}`,
      {
        type: page.file.type,
        lastModified: page.file.lastModified,
      },
    );
  });
}

/** Whether this browser can hand image files to the device's share sheet. */
export function canShareFiles(): boolean {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: [new File([''], 'page.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

/** 'shared' through the share sheet, 'saved' as downloads, or 'cancelled' when the reader backed out. */
export async function handOff(
  files: File[],
  title: string,
): Promise<'shared' | 'saved' | 'cancelled'> {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files })) {
    try {
      await nav.share({ files, title });
      return 'shared';
    } catch (cause) {
      if ((cause as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  for (const file of files) downloadBlob(file.name, file);
  return 'saved';
}
