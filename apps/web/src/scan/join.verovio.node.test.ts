// @vitest-environment node
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { verovioOptions } from '../score/render/options.js';
import { joinScanPages } from './join.js';

// The join reads and writes XML through the browser's parser; in Node happy-dom supplies it.
const dom = new Window();
Object.assign(globalThis, { DOMParser: dom.DOMParser, XMLSerializer: dom.XMLSerializer });

/** The owner's three pages as homr wrote them; happy-dom parses a double-quoted XML declaration. */
const fixture = (n: number) =>
  readFileSync(new URL(`../../fixtures/scan/owner-page-${n}.musicxml`, import.meta.url), 'utf8')
    .replace(/^<\?xml[^>]*\?>/, '<?xml version="1.0" encoding="utf-8"?>')
    .trim();

const count = (svg: string, name: string) =>
  svg.match(new RegExp(`<g\\b[^>]*\\bclass="${name}"`, 'g'))?.length ?? 0;

/**
 * Issue 156: Verovio takes the staff count from the first measure's first <attributes> only, so a
 * page read as a treble part and a bass part (issue 152) has to declare its two staves there, or a
 * batch that opens with it is drawn as a single staff without a brace.
 */
describe('issue 156: the joined owner pages as Verovio draws them', () => {
  it.each([
    ['the split page first', [3, 1, 2]],
    ['the split page last', [1, 2, 3]],
  ])('draws two staves per measure under a brace, %s', async (_name, order) => {
    const xml = joinScanPages(order.map(fixture));
    const { default: createVerovioModule } = await import('verovio/wasm');
    const { VerovioToolkit } = await import('verovio/esm');
    const tk = new VerovioToolkit(await createVerovioModule());
    tk.setOptions(verovioOptions(900));
    expect(tk.loadData(xml)).toBeTruthy();
    const svg = tk.renderToSVG(1);
    const measures = count(svg, 'measure');
    expect(measures).toBeGreaterThan(0);
    expect(count(svg, 'staff')).toBe(2 * measures);
    expect(count(svg, 'grpSym')).toBeGreaterThan(0);
    tk.destroy();
  });
});
