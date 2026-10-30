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
  /** Milliseconds since the first click recorded, or null on the frames before it. */
  sinceClick: number | null;
  /** Red roots, by the definition of `redRoots` (or of `reddish`, when recording that). */
  roots: number;
  /** The red roots, by tag and class. */
  found: { tag: string; className: string }[];
  /** Every root is a cursor note (`g.note` / `g.chord` in the sheet) with one `data-onset-tick`. */
  cursor: boolean;
  /** `.along-halo` elements in the page. */
  halos: number;
  /** Halos visible outside every `.is-red` element. */
  halosOutside: number;
}

export interface RecordOptions {
  /**
   * Count every reddish colour (a red channel leading the others by more than 40, alpha above 0)
   * instead of the exact accent. The exact check misses a red that is fading in or out, which is
   * what two reds on screen for a moment look like.
   */
  reddish?: boolean;
}

interface FrameRecorder {
  __redFrames?: RedFrame[];
  __redFramesStop?: boolean;
}

/** Starts recording every animation frame in the page (issue 204), until `redFrames` stops it. */
export async function recordRedFrames(page: Page, options: RecordOptions = {}): Promise<void> {
  await page.evaluate(
    ({ accent, reddishColours }) => {
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
      const isRed = (value: string): boolean => {
        if (!reddishColours) return value === accent;
        const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(value);
        if (!m) return false;
        const alpha = m[4] === undefined ? 1 : Number(m[4]);
        return alpha > 0 && Number(m[1]) - Math.max(Number(m[2]), Number(m[3])) > 40;
      };
      const roots = () => {
        const out: {
          tag: string;
          className: string;
          onsetTick: string | null;
          inSheet: boolean;
        }[] = [];
        const walk = (el: Element) => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
          if (props.some((p) => isRed(cs.getPropertyValue(p)))) {
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
      let click: number | null = null;
      document.addEventListener(
        'click',
        () => {
          click = performance.now();
        },
        { capture: true, once: true },
      );
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
        const t = performance.now();
        w.__redFrames!.push({
          t,
          sinceClick: click === null ? null : t - click,
          roots: found.length,
          found: found.map(({ tag, className }) => ({ tag, className })),
          cursor,
          halos: halos.length,
          halosOutside: halos.filter(
            (h) => h.closest('.is-red') === null && getComputedStyle(h).visibility !== 'hidden',
          ).length,
        });
        if (!w.__redFramesStop) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
    { accent: ACCENT_RGB, reddishColours: options.reddish === true },
  );
}

/**
 * Waits until the recorder has seen `frames` frames since the first click and `late` of them at
 * least `afterMs` after it. It counts frames, not wall time, so a loaded machine that draws few
 * frames a second is waited for rather than failed.
 */
export async function waitForRedFrames(
  page: Page,
  { frames, late = 1, afterMs = 0 }: { frames: number; late?: number; afterMs?: number },
): Promise<void> {
  await page.waitForFunction(
    ({ frames, late, afterMs }) => {
      const seen = ((window as unknown as FrameRecorder).__redFrames ?? []).filter(
        (f) => f.sinceClick !== null,
      );
      return seen.length >= frames && seen.filter((f) => f.sinceClick! >= afterMs).length >= late;
    },
    { frames, late, afterMs },
  );
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
