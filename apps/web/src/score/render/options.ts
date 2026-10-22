/**
 * Verovio draws at a percentage of its internal units; `pageWidth` is in those units. 40 is the
 * scale of a phone's column and of print.
 */
export const VEROVIO_SCALE = 40;

/** Wider score columns draw larger (issue 59, review S13); steps sit on the 160 px layout buckets' edges (WIDTH_BUCKET_PX in useScoreDocument.ts). */
const SCALE_STEPS: readonly (readonly [minWidthPx: number, scale: number])[] = [
  [1200, 56],
  [1040, 54],
  [880, 50],
  [720, 46],
];

/** The scale for a score column `widthPx` wide: 40 below 720 px, rising to 56 from 1200 px. */
export function scaleForWidth(widthPx: number): number {
  for (const [min, scale] of SCALE_STEPS) if (widthPx >= min) return scale;
  return VEROVIO_SCALE;
}

/**
 * The toolkit options shared by the render worker and the Node render contract test.
 * `svgAdditionalAttribute: ['fing@startid']` writes `data-startid="#<noteId>"` on every
 * `g.fing`, so a digit can be patched in place; `xmlIdSeed` keeps generated ids stable.
 * `svgFormatRaw` leaves out the indentation, which drew the same (pixel for pixel) but put a
 * whitespace text node between every two elements of the page: 230,000 nodes on Beethoven's Ninth
 * (docs/research/ram-usage.md).
 */
export function verovioOptions(
  widthPx: number,
  layout: 'screen' | 'print' = 'screen',
): Record<string, unknown> {
  const scale = layout === 'print' ? VEROVIO_SCALE : scaleForWidth(widthPx);
  return {
    scale,
    pageWidth: layout === 'print' ? 1900 : Math.round((widthPx * 100) / scale),
    ...(layout === 'print' ? { pageHeight: 2420, pageMarginTop: 50 } : {}),
    adjustPageHeight: layout !== 'print',
    breaks: 'auto',
    header: 'none',
    footer: 'none',
    svgViewBox: true,
    svgRemoveXlink: true,
    svgAdditionalAttribute: ['fing@startid'],
    xmlIdSeed: 1,
    mnumInterval: 0,
    svgFormatRaw: true,
  };
}
