import { describe, expect, it } from 'vitest';
import { buildPageIndex, pageOfBar, quietPlaces } from './pageIndex.js';

const NS = 'xmlns="http://www.w3.org/2000/svg"';

/** A page the way Verovio writes one: the outer svg, a nested one for the scale, the bars inside. */
function page(inner: string, viewBox = '0 0 2100 2970'): string {
  return `<svg ${NS} viewBox="${viewBox}" width="2100px"><desc>x</desc><defs><g id="E0A4"/></defs><svg class="definition-scale" viewBox="0 0 21000 29700"><g class="page-margin">${inner}</g></svg></svg>`;
}

const bar = (id: string, staves: string[]) =>
  `<g id="${id}" class="measure">${staves.map((s) => `<g class="staff"><path d="M0 0"/>${s}</g>`).join('')}<g class="barLineAttr"/></g>`;
const note = (id: string) => `<g id="${id}" class="note"><use href="#E0A4"/></g>`;

describe('buildPageIndex', () => {
  it('splits a page into its start tag and its content', () => {
    const p = page(bar('m1', [note('n1')]));
    const index = buildPageIndex([p]);
    expect(index.open[0]).toBe(`<svg ${NS} viewBox="0 0 2100 2970" width="2100px">`);
    expect(index.open[0]! + index.inner[0]! + '</svg>').toBe(p);
  });

  it('counts the bars of each page and numbers them across the pages', () => {
    const index = buildPageIndex([
      page(bar('m1', [note('a')]) + bar('m2', [note('b')])),
      page(bar('m3', [note('c')])),
      page(''),
      page(bar('m4', [note('d')])),
    ]);
    expect(index.bars).toEqual([2, 1, 0, 1]);
    expect(index.firstBar).toEqual([0, 2, 3, 3]);
    expect(pageOfBar(index, 0)).toBe(0);
    expect(pageOfBar(index, 1)).toBe(0);
    expect(pageOfBar(index, index.firstBar[1]!)).toBe(1);
    expect(pageOfBar(index, 3)).toBe(3);
    expect(pageOfBar(index, 4)).toBe(-1);
    expect(pageOfBar(index, 9999)).toBe(-1);
    expect(pageOfBar(index, -1)).toBe(-1);
  });

  it('finds the page of each note, whatever order the attributes are written in', () => {
    const index = buildPageIndex([
      page(bar('m1', ['<g class="note" id="n1"/>' + note('n2')])),
      page(bar('m2', [note('n3')])),
    ]);
    expect([...index.pageOfNote]).toEqual([
      ['n1', 0],
      ['n2', 0],
      ['n3', 1],
    ]);
  });

  it('does not mistake data-startid or other ids for a note id', () => {
    const fing = '<g class="fing" data-startid="#n1"><text><tspan>1</tspan></text></g>';
    const index = buildPageIndex([
      page(bar('m1', [note('n1') + fing + '<g data-id="zz" class="note" id="n2"/>'])),
    ]);
    expect([...index.pageOfNote.keys()]).toEqual(['n1', 'n2']);
  });

  it('reads past self-closing tags and the nested svg', () => {
    const index = buildPageIndex([
      page(
        bar('m1', ['<path d="M1 1"/><rect x="0"/>' + note('n1') + '<path d="M2 2"/>' + note('n2')]),
      ),
    ]);
    expect(index.bars).toEqual([1]);
    expect(index.staffNotes).toEqual([['n1', 'n2']]);
  });

  it('keeps the notes of a chord, in order', () => {
    const chord = `<g id="c1" class="chord">${note('a')}${note('b')}</g>`;
    const index = buildPageIndex([page(bar('m1', [chord + note('c')]))]);
    expect(index.staffNotes).toEqual([['a', 'b', 'c']]);
    expect(index.pageOfNote.get('b')).toBe(0);
  });

  it('lists the notes of each staff place across the pages', () => {
    const index = buildPageIndex([
      page(bar('m1', [note('r1'), note('l1')]) + bar('m2', [note('r2'), ''])),
      page(bar('m3', [note('r3'), note('l2') + note('l3')])),
    ]);
    expect(index.staffNotes).toEqual([
      ['r1', 'r2', 'r3'],
      ['l1', 'l2', 'l3'],
    ]);
  });

  it('counts only the staves directly inside a bar', () => {
    const stray = '<g class="staff">' + note('x') + '</g>';
    const index = buildPageIndex([page(stray + bar('m1', [note('a')]))]);
    expect(index.staffNotes).toEqual([['a']]);
    expect(index.pageOfNote.get('x')).toBe(0);
  });

  it('gives an empty index for no pages', () => {
    const index = buildPageIndex([]);
    expect(index.bars).toEqual([]);
    expect(index.staffNotes).toEqual([]);
    expect(pageOfBar(index, 0)).toBe(-1);
  });
});

describe('quietPlaces', () => {
  const index = buildPageIndex([
    page(bar('m1', [note('r1'), note('l1')])),
    page(bar('m2', [note('r2'), note('l2') + note('l3')])),
  ]);

  it('is a staff place whose notes are all muted, across the pages', () => {
    expect(quietPlaces(index, new Set(['l1', 'l2', 'l3']))).toEqual(new Set([1]));
    expect(quietPlaces(index, new Set(['l1', 'l2']))).toEqual(new Set());
    expect(quietPlaces(index, new Set(['r1', 'r2', 'l1', 'l2', 'l3']))).toEqual(new Set([0, 1]));
  });

  it('is empty when nothing is muted', () => {
    expect(quietPlaces(index, new Set())).toEqual(new Set());
  });

  it('never counts a place with no notes', () => {
    const rests = buildPageIndex([page(bar('m1', ['<g class="layer"/>', note('l1')]))]);
    expect(quietPlaces(rests, new Set(['l1']))).toEqual(new Set([1]));
  });
});
