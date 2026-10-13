import { expect, type Page } from '@playwright/test';

export const ACCENT_RGB = 'rgb(227, 0, 15)';

export interface RedRoot {
  tag: string;
  id: string;
  className: string;
  onsetTick: string | null;
  inSheet: boolean;
}

/** Visible elements whose own computed colors are the accent and whose ancestors are not. */
export function redRoots(page: Page): Promise<RedRoot[]> {
  return page.evaluate((accent) => {
    const out: RedRoot[] = [];
    const props = [
      'color',
      'background-color',
      'border-top-color',
      'border-right-color',
      'border-bottom-color',
      'border-left-color',
      'outline-color',
      'fill',
      'stroke',
    ];
    const walk = (el: Element) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
      if (props.some((p) => cs.getPropertyValue(p) === accent)) {
        out.push({
          tag: el.tagName.toLowerCase(),
          id: el.id,
          className:
            typeof el.className === 'string' ? el.className : (el.getAttribute('class') ?? ''),
          onsetTick: el.getAttribute('data-onset-tick'),
          inSheet: el.closest('.score-sheet') !== null,
        });
        return;
      }
      for (const child of Array.from(el.children)) walk(child);
    };
    walk(document.documentElement);
    return out;
  }, ACCENT_RGB);
}

/** The design brief as a test: one red root, or one playback cursor (note groups sharing an onset). */
export async function expectOneRed(page: Page, label = ''): Promise<RedRoot[]> {
  const roots = await redRoots(page);
  const isCursor =
    roots.length > 0 &&
    roots.every(
      (r) =>
        r.inSheet && r.tag === 'g' && /\b(note|chord)\b/.test(r.className) && r.onsetTick !== null,
    ) &&
    new Set(roots.map((r) => r.onsetTick)).size === 1;
  expect(
    roots.length === 1 || isCursor,
    `${label} expected exactly one red element, got ${JSON.stringify(roots)}`,
  ).toBe(true);
  return roots;
}
