import { expect, type Page } from '@playwright/test';

// What a phone showed as ONE staff per system (issue 156) is drawn here as a grand staff: two
// staves in every bar, a brace at the start of every system, and, in the score view, fingers over
// the right hand's notes and under the left hand's. The checks read the Verovio SVG itself.

/** What the Verovio pages under a selector draw. */
export interface GrandStaffLayout {
  /** The pages drawn: outer SVGs that hold a system (the icons beside them are not pages). */
  pages: number;
  systems: number;
  /** Systems with no brace (`g.grpSym`). */
  unbraced: number;
  braces: number;
  measures: number;
  /** Every `g.staff`, wherever it sits. */
  staffElements: number;
  /** The `g.staff` children of each `g.measure`, in drawing order. */
  staves: number[];
  fingerings: number;
  /** Fingerings whose `data-startid` names no note in a staff. */
  unplaced: number;
  /**
   * Measures with a fingered note in their first staff, in their second, and in both: by the
   * staff a note belongs to in the SVG. Verovio keeps a cross-staff note in the staff of its
   * voice, so a bar's left hand can count for the first staff here.
   */
  fingered: { first: number; second: number; both: number };
  /**
   * Where the digits are drawn: above the bar's first staff (the right hand), below its second
   * (the left hand), and the measures that have both.
   */
  digits: { above: number; below: number; both: number };
}

/** Reads the pages under `selector` (e.g. `main svg`) in the browser, where the ids resolve. */
export function readGrandStaff(page: Page, selector: string): Promise<GrandStaffLayout> {
  return page.evaluate((selector): GrandStaffLayout => {
    // Verovio's page is an SVG with its drawing in a nested one (`definition-scale`): only the
    // outer one counts, or every bar would be counted twice.
    const svgs = [...document.querySelectorAll<SVGSVGElement>(selector)].filter(
      (svg) => svg.querySelector('g.system') && !svg.parentElement?.closest('svg'),
    );
    const staffOf = (measure: Element) => [...measure.children].filter((c) => c.matches('g.staff'));
    const layout: GrandStaffLayout = {
      pages: svgs.length,
      systems: 0,
      unbraced: 0,
      braces: 0,
      measures: 0,
      staffElements: 0,
      staves: [],
      fingerings: 0,
      unplaced: 0,
      fingered: { first: 0, second: 0, both: 0 },
      digits: { above: 0, below: 0, both: 0 },
    };
    const fingeredStaves = new Map<Element, Set<number>>();
    /** The y of a staff's lines (each a path `M x y L x y`) in the page's own units. */
    const linesOf = (staff: Element) =>
      [...staff.querySelectorAll(':scope > path')]
        .map((line) => Number(/M\s*[-\d.]+[\s,]+([-\d.]+)/.exec(line.getAttribute('d') ?? '')?.[1]))
        .filter(Number.isFinite);
    for (const svg of svgs) {
      for (const system of svg.querySelectorAll('g.system')) {
        layout.systems++;
        const braces = system.querySelectorAll('g.grpSym').length;
        layout.braces += braces;
        if (!braces) layout.unbraced++;
      }
      layout.staffElements += svg.querySelectorAll('g.staff').length;
      for (const measure of svg.querySelectorAll('g.measure')) {
        layout.measures++;
        const staves = staffOf(measure);
        layout.staves.push(staves.length);
        if (staves.length !== 2) continue;
        const [upper, lower] = staves.map(linesOf) as [number[], number[]];
        if (!upper.length || !lower.length) continue;
        let above = 0;
        let below = 0;
        for (const fing of measure.querySelectorAll(':scope > g.fing')) {
          const y = Number(fing.querySelector('text')?.getAttribute('y'));
          if (y < Math.min(...upper)) above++;
          else if (y > Math.max(...lower)) below++;
        }
        layout.digits.above += above;
        layout.digits.below += below;
        if (above && below) layout.digits.both++;
      }
      for (const fing of svg.querySelectorAll('g.fing')) {
        layout.fingerings++;
        const target = fing.getAttribute('data-startid')?.replace(/^#/, '');
        const note = target ? document.getElementById(target) : null;
        const staff = note?.closest('g.staff') ?? null;
        const measure = staff?.closest('g.measure') ?? null;
        if (!staff || !measure) {
          layout.unplaced++;
          continue;
        }
        const set = fingeredStaves.get(measure) ?? new Set<number>();
        set.add(staffOf(measure).indexOf(staff));
        fingeredStaves.set(measure, set);
      }
    }
    for (const set of fingeredStaves.values()) {
      if (set.has(0)) layout.fingered.first++;
      if (set.has(1)) layout.fingered.second++;
      if (set.has(0) && set.has(1)) layout.fingered.both++;
    }
    return layout;
  }, selector);
}

/** Two staves in every bar and a brace on every system. */
export function expectGrandStaff(layout: GrandStaffLayout, where: string): void {
  expect(layout.pages, `${where}: pages drawn`).toBeGreaterThan(0);
  expect(layout.systems, `${where}: systems`).toBeGreaterThan(0);
  expect(layout.measures, `${where}: measures`).toBeGreaterThan(0);
  expect(
    layout.staves.filter((count) => count !== 2).length,
    `${where}: measures without exactly two staves (staves per measure ${layout.staves.join(' ')})`,
  ).toBe(0);
  expect(layout.staffElements, `${where}: staves = 2 * measures`).toBe(2 * layout.measures);
  expect(layout.unbraced, `${where}: systems without a brace (of ${layout.systems})`).toBe(0);
  expect(layout.braces, `${where}: braces`).toBeGreaterThanOrEqual(layout.systems);
}

/**
 * Fingers on both hands: notes of the first staff and of the second staff of one measure, and
 * digits drawn above the grand staff (the right hand) and below it (the left hand).
 */
export function expectBothHandsFingered(layout: GrandStaffLayout, where: string): void {
  expect(layout.fingerings, `${where}: fingerings`).toBeGreaterThan(0);
  expect(layout.unplaced, `${where}: fingerings not attached to a note in a staff`).toBe(0);
  expect(layout.fingered.first, `${where}: measures fingered in the first staff`).toBeGreaterThan(
    0,
  );
  expect(layout.fingered.second, `${where}: measures fingered in the second staff`).toBeGreaterThan(
    0,
  );
  expect(layout.fingered.both, `${where}: measures fingered in both staves`).toBeGreaterThan(0);
  expect(layout.digits.above, `${where}: digits above the first staff`).toBeGreaterThan(0);
  expect(layout.digits.below, `${where}: digits below the second staff`).toBeGreaterThan(0);
  expect(layout.digits.both, `${where}: measures with digits above and below`).toBeGreaterThan(0);
  expect(
    layout.digits.above + layout.digits.below,
    `${where}: every digit is drawn above the first staff or below the second`,
  ).toBe(layout.fingerings);
}

/** The review beside the scan: the recognition as a grand staff (it shows no fingers yet). */
export async function expectReviewGrandStaff(page: Page): Promise<GrandStaffLayout> {
  await expect(page.locator('.scan-review svg g.system').first()).toBeVisible();
  const layout = await readGrandStaff(page, '.scan-review svg');
  expectGrandStaff(layout, 'review');
  return layout;
}

/**
 * The score view once it is ready to play: a grand staff with the fingers of both hands. The
 * fingers arrive after the pages, so it waits for the first one.
 */
export async function expectScoreGrandStaff(page: Page): Promise<GrandStaffLayout> {
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('main svg g.fing').first()).toBeVisible({ timeout: 30_000 });
  const layout = await readGrandStaff(page, 'main svg');
  expectGrandStaff(layout, 'score view');
  expectBothHandsFingered(layout, 'score view');
  return layout;
}
