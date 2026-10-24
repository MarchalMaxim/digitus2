import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearTimingMarks,
  drawTimingMarks,
  markShape,
  MARK_CLASS,
  MISSED_RING_SCALE,
  RED_HEAD_SCALE,
  RING_CLEARANCE,
  RING_MIN_SHIFT,
  RING_SCALE,
  ringFor,
  type RingInput,
  type TimingMark,
} from './timingMarks.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('ringFor', () => {
  const at = (over: Partial<RingInput>): RingInput => ({
    cx0: 100,
    cy: 50,
    w: 10,
    verdict: 'late',
    offsetSec: 0.2,
    prev: null,
    next: null,
    ...over,
  });

  it('puts a late ring right of the note by the local time scale, a notehead across', () => {
    // 60 px for 0.6 s to the next onset: 100 px per second, so 0.2 s late is 20 px right.
    const ring = ringFor(at({ next: { x: 160, dSec: 0.6 } }));
    expect(ring.cx).toBeCloseTo(120);
    expect(ring.cy).toBe(50);
    expect(ring.r).toBeCloseTo(RING_SCALE * 10);
    expect(ring.r).toBeCloseTo(6);
    expect(ring.dashed).toBe(false);
  });

  it('keeps the ring clear of its own red notehead and at most half the gap to the neighbour', () => {
    // The least shift is half the red head, the ring's radius and the clear gap: 15.5 px here.
    expect(RING_MIN_SHIFT).toBeCloseTo(RED_HEAD_SCALE / 2 + RING_SCALE + RING_CLEARANCE);
    expect(RING_MIN_SHIFT * 10).toBeCloseTo(15.5);
    expect(ringFor(at({ offsetSec: 0.05, next: { x: 160, dSec: 0.6 } })).cx).toBeCloseTo(115.5);
    expect(ringFor(at({ offsetSec: 0.4, next: { x: 160, dSec: 0.6 } })).cx).toBeCloseTo(130);
  });

  it('never lets an early or late ring touch its notehead, even scaled red', () => {
    const cases: Partial<RingInput>[] = [
      { offsetSec: 0.01 },
      { offsetSec: 0.01, next: { x: 112, dSec: 0.6 } },
      { verdict: 'early', offsetSec: -0.01, prev: { x: 95, dSec: 0.6 } },
      { verdict: 'early', offsetSec: -0.3, prev: { x: 40, dSec: 0.6 } },
    ];
    for (const over of cases) {
      const ring = ringFor(at(over));
      const inner = Math.abs(ring.cx - 100) - ring.r;
      expect(inner).toBeGreaterThanOrEqual((RED_HEAD_SCALE / 2) * 10 + RING_CLEARANCE * 10 - 1e-9);
    }
  });

  it('puts an early ring left of the note, scaled from the previous onset', () => {
    const ring = ringFor(at({ verdict: 'early', offsetSec: -0.2, prev: { x: 40, dSec: 0.6 } }));
    expect(ring.cx).toBeCloseTo(80);
    expect(ring.dashed).toBe(false);
  });

  it('lets the least shift win when half the gap is narrower', () => {
    // Half of the 12 px gap is 6, below the least shift: the ring must clear its own note.
    expect(ringFor(at({ next: { x: 112, dSec: 0.6 } })).cx).toBeCloseTo(115.5);
  });

  it('scales from the other neighbour when the near one is missing, with no ceiling', () => {
    expect(ringFor(at({ prev: { x: 40, dSec: 0.6 } })).cx).toBeCloseTo(120);
  });

  it('sits the least shift away with no neighbour', () => {
    expect(ringFor(at({})).cx).toBeCloseTo(115.5);
    expect(ringFor(at({ verdict: 'early', offsetSec: -0.2 })).cx).toBeCloseTo(84.5);
  });

  it('draws a missed note as a dashed ring around the notehead, clear of it red', () => {
    const ring = ringFor(
      at({ verdict: 'missed', offsetSec: null, prev: { x: 40, dSec: 0.6 }, next: null }),
    );
    expect(ring.cx).toBe(100);
    expect(ring.cy).toBe(50);
    expect(ring.r).toBeCloseTo(MISSED_RING_SCALE * 10);
    expect(ring.r).toBeCloseTo(8.5);
    expect(ring.r).toBeGreaterThan((RED_HEAD_SCALE / 2) * 10);
    expect(ring.dashed).toBe(true);
  });
});

describe('markShape', () => {
  it('is one svg circle in a group the stylesheet finds', () => {
    const el = markShape(document, { cx: 12.5, cy: 30, r: 6, dashed: false });
    expect(el.namespaceURI).toBe(SVG_NS);
    expect(el.getAttribute('class')).toBe(MARK_CLASS);
    expect(el.getAttribute('aria-hidden')).toBe('true');
    const circles = el.querySelectorAll('circle');
    expect(circles).toHaveLength(1);
    const circle = circles[0]!;
    expect(circle.namespaceURI).toBe(SVG_NS);
    expect(Number(circle.getAttribute('cx'))).toBeCloseTo(12.5);
    expect(Number(circle.getAttribute('cy'))).toBeCloseTo(30);
    expect(Number(circle.getAttribute('r'))).toBeCloseTo(6);
    expect(el.matches(`.${MARK_CLASS}[data-timing='missed']`)).toBe(false);
  });

  it("marks a dashed ring with the attribute base.css dashes (data-timing='missed')", () => {
    const el = markShape(document, { cx: 1, cy: 2, r: 3, dashed: true });
    expect(el.matches(`.${MARK_CLASS}[data-timing='missed']`)).toBe(true);
    expect(css).toContain(".score-sheet svg .timing-mark[data-timing='missed'] circle");
  });
});

/**
 * Two systems as Verovio draws them (`g.system > g.measure > g.staff > g.layer > g.chord? >
 * g.note > g.notehead | g.accid | g.dots`). Each notehead's box is in `boxes` (x, y, width,
 * height), every head 10 wide and 8 high. System 1, bar 1, upper staff: a (middle 100, 50), the
 * chord b + c (middle 140, the heads at 40 and 60), d (180, 50); lower staff: l1 (100, 150).
 * Bar 2, upper staff: e (260, 50). System 2: f (middle 400, 50), right of everything, so only its
 * system keeps it from being used.
 */
const page = `
<svg xmlns="${SVG_NS}">
  <g class="system" id="sys1">
    <g class="measure" id="m1">
      <g class="staff" id="s1a"><path/>
        <g class="layer" id="l1a">
          <g class="note" id="a"><g class="accid" id="a-acc"></g><g class="notehead" id="a-h"><use/></g></g>
          <g class="chord" id="cb">
            <g class="note" id="b"><g class="notehead" id="b-h"><use/></g></g>
            <g class="note" id="c"><g class="notehead" id="c-h"><use/></g></g>
          </g>
          <g class="note" id="d"><g class="notehead" id="d-h"><use/></g><g class="dots" id="d-dots"></g></g>
        </g>
      </g>
      <g class="staff" id="s1b"><path/>
        <g class="layer" id="l1b"><g class="note" id="l1"><g class="notehead" id="l1-h"><use/></g></g></g>
      </g>
    </g>
    <g class="measure" id="m2">
      <g class="staff" id="s2a"><path/>
        <g class="layer" id="l2a"><g class="note" id="e"><g class="notehead" id="e-h"><use/></g></g></g>
      </g>
      <g class="staff" id="s2b"><path/><g class="layer" id="l2b"></g></g>
    </g>
  </g>
  <g class="system" id="sys2">
    <g class="measure" id="m3">
      <g class="staff" id="s3a"><path/>
        <g class="layer" id="l3a"><g class="note" id="f"><g class="notehead" id="f-h"><use/></g></g></g>
      </g>
    </g>
  </g>
</svg>`;

const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
  'a-h': { x: 95, y: 46, width: 10, height: 8 },
  'b-h': { x: 135, y: 36, width: 10, height: 8 },
  'c-h': { x: 135, y: 56, width: 10, height: 8 },
  'd-h': { x: 175, y: 46, width: 10, height: 8 },
  'l1-h': { x: 95, y: 146, width: 10, height: 8 },
  'e-h': { x: 255, y: 46, width: 10, height: 8 },
  'f-h': { x: 395, y: 46, width: 10, height: 8 },
};

function sheet() {
  const host = document.createElement('div');
  host.innerHTML = page;
  const measured: Element[] = [];
  const boxOf = (el: SVGGraphicsElement) => {
    measured.push(el);
    const box = boxes[el.id];
    if (!box) throw new Error(`no box for ${el.id || el.tagName}`);
    return box;
  };
  return { host, boxOf, measured };
}

function mark(over: Partial<TimingMark> & Pick<TimingMark, 'ids' | 'verdict'>): TimingMark {
  return { offsetSec: null, prev: null, next: null, ...over };
}

const rings = (root: Element) => Array.from(root.querySelectorAll(`.${MARK_CLASS}`));

function centre(ring: Element) {
  const circle = ring.querySelector('circle')!;
  return {
    cx: Number(circle.getAttribute('cx')),
    cy: Number(circle.getAttribute('cy')),
    r: Number(circle.getAttribute('r')),
  };
}

describe('drawTimingMarks', () => {
  it('draws a late ring at the end of its staff, scaled from the next onset in the next bar', () => {
    const { host, boxOf, measured } = sheet();
    // e is in the next bar's staff of the same system: 80 px for 0.8 s, 100 px per second.
    const drawn = drawTimingMarks(
      host,
      [mark({ ids: ['d'], verdict: 'late', offsetSec: 0.2, next: { ids: ['e'], dSec: 0.8 } })],
      boxOf,
    );
    expect(drawn).toBe(1);
    const [ring] = rings(host);
    const staff = host.querySelector('#s1a')!;
    expect(ring!.parentElement).toBe(staff);
    expect(staff.lastElementChild).toBe(ring);
    expect(ring!.getAttribute('class')).toBe(MARK_CLASS);
    expect(ring!.getAttribute('data-timing')).toBe('late');
    expect(ring!.getAttribute('aria-hidden')).toBe('true');
    expect(ring!.closest('g.layer, g.note, g.chord')).toBeNull();
    const c = centre(ring!);
    expect(c.cx).toBeCloseTo(200);
    expect(c.cy).toBeCloseTo(50);
    expect(c.r).toBeCloseTo(6);
    // Only noteheads are measured, never a note or a chord (a red head is scaled by CSS).
    expect(measured.length).toBeGreaterThan(0);
    for (const el of measured) expect(el.getAttribute('class')).toBe('notehead');
  });

  it('centres a chord on the middle of its noteheads, one notehead across', () => {
    const { host, boxOf } = sheet();
    drawTimingMarks(
      host,
      [
        mark({
          ids: ['b', 'c'],
          verdict: 'early',
          offsetSec: -0.18,
          prev: { ids: ['a'], dSec: 0.4 },
        }),
      ],
      boxOf,
    );
    const all = rings(host);
    expect(all).toHaveLength(1);
    expect(all[0]!.getAttribute('data-timing')).toBe('early');
    expect(all[0]!.parentElement!.id).toBe('s1a');
    const c = centre(all[0]!);
    // 40 px for 0.4 s: 0.18 s early is 18 px left of 140, past the least shift (15.5) and under
    // half the 40 px gap.
    expect(c.cx).toBeCloseTo(122);
    expect(c.cy).toBeCloseTo(50);
    expect(c.r).toBeCloseTo(6);
  });

  it('draws a missed note as a dashed ring around it', () => {
    const { host, boxOf } = sheet();
    drawTimingMarks(host, [mark({ ids: ['l1'], verdict: 'missed' })], boxOf);
    const [ring] = rings(host);
    expect(ring!.parentElement!.id).toBe('s1b');
    expect(ring!.matches(`.${MARK_CLASS}[data-timing='missed']`)).toBe(true);
    const c = centre(ring!);
    expect(c.cx).toBeCloseTo(100);
    expect(c.cy).toBeCloseTo(150);
    expect(c.r).toBeCloseTo(8.5);
  });

  it('draws one ring per staff for a part across two staves', () => {
    const { host, boxOf } = sheet();
    const drawn = drawTimingMarks(host, [mark({ ids: ['a', 'l1'], verdict: 'missed' })], boxOf);
    expect(drawn).toBe(2);
    const all = rings(host);
    expect(all.map((r) => r.parentElement!.id).sort()).toEqual(['s1a', 's1b']);
    const upper = all.find((r) => r.parentElement!.id === 's1a')!;
    const lower = all.find((r) => r.parentElement!.id === 's1b')!;
    expect(centre(upper).cy).toBeCloseTo(50);
    expect(centre(lower).cy).toBeCloseTo(150);
  });

  it('does not use a neighbour drawn in another system', () => {
    const { host, boxOf } = sheet();
    // Were f used (140 px for 0.5 s), the ring would sit 56 px right; unused, the least shift.
    drawTimingMarks(
      host,
      [mark({ ids: ['e'], verdict: 'late', offsetSec: 0.2, next: { ids: ['f'], dSec: 0.5 } })],
      boxOf,
    );
    expect(centre(rings(host)[0]!).cx).toBeCloseTo(275.5);
  });

  it('does not use a neighbour on the wrong side', () => {
    const { host, boxOf } = sheet();
    // d is right of a, so it cannot be the onset before it: the ring sits the least shift left.
    drawTimingMarks(
      host,
      [mark({ ids: ['a'], verdict: 'early', offsetSec: -0.1, prev: { ids: ['d'], dSec: 0.4 } })],
      boxOf,
    );
    expect(centre(rings(host)[0]!).cx).toBeCloseTo(84.5);
  });

  it('skips ids not on the page and counts the rings drawn', () => {
    const { host, boxOf } = sheet();
    const drawn = drawTimingMarks(
      host,
      [
        mark({ ids: ['nowhere'], verdict: 'missed' }),
        mark({ ids: ['d'], verdict: 'late', offsetSec: 0.1, next: { ids: ['gone'], dSec: 0.5 } }),
      ],
      boxOf,
    );
    expect(drawn).toBe(1);
    expect(rings(host)).toHaveLength(1);
    expect(centre(rings(host)[0]!).cx).toBeCloseTo(195.5);
  });

  it('clears every ring, and draws one set again after a clear', () => {
    const { host, boxOf } = sheet();
    const marks = [
      mark({ ids: ['a'], verdict: 'missed' }),
      mark({ ids: ['e'], verdict: 'late', offsetSec: 0.2 }),
    ];
    drawTimingMarks(host, marks, boxOf);
    expect(rings(host)).toHaveLength(2);
    clearTimingMarks(host);
    expect(rings(host)).toHaveLength(0);
    drawTimingMarks(host, marks, boxOf);
    clearTimingMarks(host);
    drawTimingMarks(host, marks, boxOf);
    expect(rings(host)).toHaveLength(2);
  });
});

const css = readFileSync(resolve(process.cwd(), 'src/design/base.css'), 'utf8');

/** The rules of base.css (innermost blocks) whose selector names the timing mark. */
function markRules(text: string): { selector: string; body: string }[] {
  return Array.from(text.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .map((m) => ({ selector: m[1]!.trim(), body: m[2]! }))
    .filter((r) => r.selector.includes(`.${MARK_CLASS}`));
}

/** The text of the `@media print` block, braces matched. */
function printBlock(text: string): string {
  const start = text.indexOf('@media print {');
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('unclosed @media print');
}

describe('the timing marks in base.css', () => {
  it('strokes the ring in --gray-3, 1.5 px at every width, with no fill', () => {
    const rules = markRules(css);
    const ring = rules.find((r) => /stroke:\s*var\(--gray-3\)/.test(r.body));
    expect(ring, 'a .timing-mark rule strokes in --gray-3').toBeDefined();
    expect(ring!.body).toMatch(/vector-effect:\s*non-scaling-stroke/);
    expect(ring!.body).toMatch(/stroke-width:\s*1\.5px/);
    expect(ring!.body).toMatch(/fill:\s*none/);
    expect(ring!.body).toMatch(/pointer-events:\s*none/);
  });

  it('dashes the missed ring', () => {
    const missed = markRules(css).find((r) => r.selector.includes("[data-timing='missed']"));
    expect(missed?.body).toMatch(/stroke-dasharray:\s*\S/);
  });

  it('hides the rings in print', () => {
    const print = markRules(printBlock(css));
    expect(print.some((r) => /display:\s*none/.test(r.body))).toBe(true);
  });

  it('never makes a ring translucent or filtered (issue 79)', () => {
    const rules = markRules(css);
    expect(rules.length).toBeGreaterThanOrEqual(3);
    for (const r of rules) {
      expect(r.body, r.selector).not.toMatch(/opacity/);
      expect(r.body, r.selector).not.toMatch(/filter/);
    }
  });
});
