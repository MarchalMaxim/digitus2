import type { Page } from '@playwright/test';

/**
 * How far the page runs past its own width, in px: 0 or less when nothing overflows. Measured
 * against the root's box, not `clientWidth` or `innerWidth`: the root reserves the scrollbar
 * gutter (`scrollbar-gutter: stable`, issue #107), and headless Chromium hides its scrollbars
 * yet still reserves the gutter, so `clientWidth` there is 15 px wider than the page.
 */
export function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - Math.ceil(root.getBoundingClientRect().width);
  });
}
