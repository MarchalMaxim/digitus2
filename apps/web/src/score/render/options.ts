/** Verovio draws at 40 % of its internal units; `pageWidth` is in those units. */
export const VEROVIO_SCALE = 40;

/**
 * The toolkit options shared by the render worker and the Node render contract test.
 * `svgAdditionalAttribute: ['fing@startid']` writes `data-startid="#<noteId>"` on every
 * `g.fing`, so a digit can be patched in place; `xmlIdSeed` keeps generated ids stable.
 * `svgFormatRaw` leaves out the indentation, which drew the same (pixel for pixel) but put a
 * whitespace text node between every two elements of the page: 230,000 nodes on Beethoven's Ninth
 * (docs/research/ram-usage.md).
 */
export function verovioOptions(widthPx: number): Record<string, unknown> {
  return {
    scale: VEROVIO_SCALE,
    pageWidth: Math.round((widthPx * 100) / VEROVIO_SCALE),
    adjustPageHeight: true,
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
