/**
 * A crop of the page photo around a note: where homr saw it (issue 161). The review draws it
 * beside the corrected notation so a reader can compare the note with the printed one without
 * hunting for it on the page. Black and white: the photo is shown in grey and the thin frame is
 * black, so it never takes the screen's one red.
 */
import { useEffect, useRef, useState } from 'react';
import { analyzeStaffGeometry } from './camera/staffGeometry.js';
import {
  CROP_HALF_HEIGHT_SPACES,
  CROP_HALF_WIDTH_SPACES,
  cropRect,
  fallbackSpace,
  FRAME_SPACES,
  staffSpaceFrom,
} from './crop.js';

/** The page photo, decoded once: a canvas of at most 2048 px a side that every crop of it draws from. */
export interface PageImage {
  canvas: HTMLCanvasElement;
  /** The canvas's pixels per pixel of the photo as uploaded, which is what imgpos is in. */
  scale: number;
  width: number;
  height: number;
  /** The page's staff space in uploaded pixels. */
  space: number;
}

const DRAW_SIDE = 2048;
const ANALYSIS_WIDTH = 1000;
const ANALYSIS_HEIGHT = 1800;

async function decode(file: Blob): Promise<PageImage | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const { width, height } = bitmap;
      const scale = Math.min(1, DRAW_SIDE / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      // The staff space, from the staves in a smaller copy; a photo without findable staves gets a guess.
      const analysis = Math.min(1, ANALYSIS_WIDTH / width, ANALYSIS_HEIGHT / height);
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(width * analysis));
      small.height = Math.max(1, Math.round(height * analysis));
      const smallContext = small.getContext('2d', { willReadFrequently: true });
      let space: number | undefined;
      if (smallContext) {
        smallContext.drawImage(bitmap, 0, 0, small.width, small.height);
        const data = smallContext.getImageData(0, 0, small.width, small.height);
        space = staffSpaceFrom(analyzeStaffGeometry(data), small.width / width);
      }
      return { canvas, scale, width, height, space: space ?? fallbackSpace(width) };
    } finally {
      bitmap.close?.();
    }
  } catch {
    return null;
  }
}

/**
 * The decoded page photos: the last few pages that showed a crop, kept so that stepping through
 * the notes of a page decodes it once. Map order is use order, oldest first. A page past the limit
 * gives its canvas back at once (a phone browser caps the memory of all canvases together).
 */
const MAX_PAGES = 3;
interface Entry {
  promise: Promise<PageImage | null>;
  /** The result, once the decode has finished. */
  done?: { image: PageImage | null };
}
const pages = new Map<Blob, Entry>();
/** Pages are decoded one at a time: each decode analyses a large canvas on the main thread. */
let decoding: Promise<unknown> = Promise.resolve();

function release(image: PageImage | null) {
  if (!image) return;
  image.canvas.width = 0;
  image.canvas.height = 0;
}

/** Drops the oldest finished pages beyond the limit; a page still being decoded is never dropped. */
function trim() {
  const finished = [...pages].filter(([, entry]) => entry.done);
  for (const [file, entry] of finished.slice(0, Math.max(0, finished.length - MAX_PAGES))) {
    pages.delete(file);
    release(entry.done!.image);
  }
}

/** The decoded page photo; the same promise for every crop of one file while it is kept. */
export function pageImage(file: Blob): Promise<PageImage | null> {
  const known = pages.get(file);
  if (known) {
    pages.delete(file);
    pages.set(file, known);
    return known.promise;
  }
  const entry: Entry = {
    promise: decoding
      .then(() => decode(file))
      .then((image) => {
        entry.done = { image };
        trim();
        return image;
      }),
  };
  decoding = entry.promise;
  pages.set(file, entry);
  return entry.promise;
}

const SIZES = { large: { width: 192, height: 96 }, small: { width: 128, height: 64 } } as const;
const percent = (fraction: number) => `${fraction * 100}%`;
const FRAME_WIDTH = FRAME_SPACES / (2 * CROP_HALF_WIDTH_SPACES);
const FRAME_HEIGHT = FRAME_SPACES / (2 * CROP_HALF_HEIGHT_SPACES);

export function NoteCrop({
  image: file,
  at,
  label,
  size,
}: {
  image: Blob;
  at: { x: number; y: number };
  label: string;
  size: 'large' | 'small';
}) {
  // The photo belongs to the file it was decoded from: while the next page decodes, the crop shows nothing.
  const [loaded, setLoaded] = useState<{ file: Blob; image: PageImage | null } | null>(null);
  const image = loaded?.file === file ? loaded.image : null;
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let current = true;
    void pageImage(file).then((decoded) => {
      if (current) setLoaded({ file, image: decoded });
    });
    return () => {
      current = false;
    };
  }, [file]);
  const { width, height } = SIZES[size];
  const { x, y } = at;
  useEffect(() => {
    const target = canvas.current;
    const context = target?.getContext('2d');
    if (!image || !target || !context) return;
    if (image.canvas.width === 0) {
      // The page was given back for a newer one: decode it again.
      let current = true;
      void pageImage(file).then((decoded) => {
        if (current) setLoaded({ file, image: decoded });
      });
      return () => {
        current = false;
      };
    }
    const ratio = window.devicePixelRatio || 1;
    target.width = Math.round(width * ratio);
    target.height = Math.round(height * ratio);
    context.fillStyle = 'white';
    context.fillRect(0, 0, target.width, target.height);
    // The rectangle may reach past the page edge: the centre stays on the note, the rest stays white.
    const rect = cropRect({ x, y }, image.space);
    context.drawImage(
      image.canvas,
      rect.x * image.scale,
      rect.y * image.scale,
      rect.width * image.scale,
      rect.height * image.scale,
      0,
      0,
      target.width,
      target.height,
    );
  }, [file, image, x, y, width, height]);
  if (!image) return null;
  return (
    <span className={`note-crop note-crop-${size}`} role="img" aria-label={label}>
      <canvas ref={canvas} aria-hidden="true" />
      <span
        className="note-crop-frame"
        aria-hidden="true"
        style={{
          left: percent(0.5 - FRAME_WIDTH / 2),
          top: percent(0.5 - FRAME_HEIGHT / 2),
          width: percent(FRAME_WIDTH),
          height: percent(FRAME_HEIGHT),
        }}
      />
    </span>
  );
}
