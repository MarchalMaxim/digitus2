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

/** One animation frame as the in-page recorder saw it. */
export interface RedFrame {
  t: number;
  /** Red roots, by the definition of `redRoots`. */
  roots: number;
  /** Every root is a cursor note (`g.note` / `g.chord` in the sheet) with one `data-onset-tick`. */
  cursor: boolean;
  /** `.along-halo` elements in the page. */
  halos: number;
  /** Halos visible outside every `.is-red` element. */
  halosOutside: number;
}

interface FrameRecorder {
  __redFrames?: RedFrame[];
  __redFramesStop?: boolean;
}

/** Starts recording every animation frame in the page (issue 204), until `redFrames` stops it. */
export async function recordRedFrames(page: Page): Promise<void> {
  await page.evaluate((accent) => {
    const w = window as unknown as FrameRecorder;
    w.__redFrames = [];
    w.__redFramesStop = false;
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
    const roots = () => {
      const out: { tag: string; className: string; onsetTick: string | null; inSheet: boolean }[] =
        [];
      const walk = (el: Element) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
        if (props.some((p) => cs.getPropertyValue(p) === accent)) {
          out.push({
            tag: el.tagName.toLowerCase(),
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
    };
    const frame = () => {
      const found = roots();
      const cursor =
        found.length > 0 &&
        found.every(
          (r) =>
            r.inSheet &&
            r.tag === 'g' &&
            /\b(note|chord)\b/.test(r.className) &&
            r.onsetTick !== null,
        ) &&
        new Set(found.map((r) => r.onsetTick)).size === 1;
      const halos = Array.from(document.querySelectorAll('.along-halo'));
      w.__redFrames!.push({
        t: performance.now(),
        roots: found.length,
        cursor,
        halos: halos.length,
        halosOutside: halos.filter(
          (h) => h.closest('.is-red') === null && getComputedStyle(h).visibility !== 'hidden',
        ).length,
      });
      if (!w.__redFramesStop) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, ACCENT_RGB);
}

/** Stops the recorder and returns its frames. */
export async function redFrames(page: Page): Promise<RedFrame[]> {
  return page.evaluate(async () => {
    const w = window as unknown as FrameRecorder;
    w.__redFramesStop = true;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return w.__redFrames ?? [];
  });
}

/** Exactly one red root (or one cursor) on every frame, at most one halo, none outside the red. */
export function expectOneRedEveryFrame(frames: readonly RedFrame[], label: string): void {
  expect(frames.length, `${label} recorded no frames`).toBeGreaterThan(0);
  for (const f of frames) {
    const at = `${label} frame ${JSON.stringify(f)}`;
    expect(f.roots === 1 || f.cursor, `${at}: expected one red root or one cursor`).toBe(true);
    expect(f.halos, `${at}: at most one halo`).toBeLessThanOrEqual(1);
    expect(f.halosOutside, `${at}: a halo outside the red`).toBe(0);
  }
}
