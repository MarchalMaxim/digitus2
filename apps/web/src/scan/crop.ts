/**
 * The photo crop shown beside a recognised note (issue 161): homr says where in the page photo it
 * saw the note, and the review draws the photo around that spot. Sizes are in staff spaces (the
 * distance between two staff lines), so a crop shows the same musical area on any photo.
 */
import type { StaffGeometry } from './camera/staffGeometry.js';

/**
 * Half of the crop's height: the crop is four staff spaces high and eight wide, the smallest whose
 * frame holds 90% of homr's notes on the acceptance corpus (research/omr/imgpos.mjs).
 */
export const CROP_HALF_HEIGHT_SPACES = 2;
/** Half of the crop's width. */
export const CROP_HALF_WIDTH_SPACES = 4;
/** The side of the thin frame around the spot homr names. */
export const FRAME_SPACES = 1.5;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The crop in page pixels: centred on `at`, which is never moved to fit the page. */
export function cropRect(at: { x: number; y: number }, space: number): Rect {
  return {
    x: at.x - CROP_HALF_WIDTH_SPACES * space,
    y: at.y - CROP_HALF_HEIGHT_SPACES * space,
    width: 2 * CROP_HALF_WIDTH_SPACES * space,
    height: 2 * CROP_HALF_HEIGHT_SPACES * space,
  };
}

/**
 * The staff space of a page: the median spacing over every staff and column the geometry traced,
 * measured on a copy scaled by `analysisScale`, in the pixels of the page itself.
 */
export function staffSpaceFrom(
  geometry: StaffGeometry | null,
  analysisScale: number,
): number | undefined {
  const spacings = (geometry?.staves ?? []).flatMap((staff) => [...staff.sourceSpacings]);
  if (!spacings.length) return undefined;
  spacings.sort((a, b) => a - b);
  return spacings[Math.floor(spacings.length / 2)]! / analysisScale;
}

/** A staff space guessed from the page width (a printed page is about 120 staff spaces wide), for a photo whose staves cannot be found. */
export const fallbackSpace = (width: number): number => width / 120;
