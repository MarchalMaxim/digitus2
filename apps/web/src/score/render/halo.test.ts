import { describe, expect, it } from 'vitest';
import { clearHalos, drawHalo, haloAnchor, setHaloRadius } from './halo.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const page = `
<svg xmlns="${SVG_NS}">
  <g class="note" id="a"><g class="notehead" id="a-h"><use/></g></g>
  <g class="chord is-red" id="chord">
    <g class="note" id="b"><g class="notehead" id="b-h"><use/></g></g>
    <g class="note" id="c"><g class="notehead" id="c-h"><use/></g></g>
  </g>
</svg>`;

const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
  'a-h': { x: 0, y: 10, width: 10, height: 8 },
  'b-h': { x: 0, y: 30, width: 10, height: 8 },
  'c-h': { x: 0, y: 20, width: 10, height: 8 },
};

const boxOf = (el: SVGGraphicsElement) => {
  const box = boxes[el.id];
  if (!box) throw new Error(`no box for ${el.id}`);
  return box;
};

function sheet(markup = page): Element {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host;
}

describe('haloAnchor', () => {
  it('finds the topmost marked notehead', () => {
    const anchor = haloAnchor(sheet(), boxOf);
    expect(anchor?.note.id).toBe('c');
    expect(anchor).toMatchObject({ cx: 5, cy: 24, w: 10 });
  });

  it('ignores notes that are not marked', () => {
    // #a has the smallest y and is never chosen.
    expect(haloAnchor(sheet(), boxOf)?.note.id).not.toBe('a');
  });

  it('gives null when none is marked', () => {
    expect(haloAnchor(sheet(page.replace(' is-red', '')), boxOf)).toBeNull();
  });

  it('gives null when none is laid out', () => {
    expect(haloAnchor(sheet(), () => ({ x: 0, y: 0, width: 0, height: 0 }))).toBeNull();
    expect(
      haloAnchor(sheet(), () => {
        throw new Error('not laid out');
      }),
    ).toBeNull();
  });

  it('finds a lone marked note', () => {
    const host = sheet(
      `<svg xmlns="${SVG_NS}"><g class="note is-red" id="c"><g class="notehead" id="c-h"></g></g></svg>`,
    );
    expect(haloAnchor(host, boxOf)?.note.id).toBe('c');
  });
});

describe('the halo circle', () => {
  it('is drawn in the note, last', () => {
    const host = sheet();
    const anchor = haloAnchor(host, boxOf)!;
    const circle = drawHalo(anchor, 21);
    expect(circle.namespaceURI).toBe(SVG_NS);
    expect(circle.getAttribute('class')).toBe('along-halo');
    expect(circle.getAttribute('aria-hidden')).toBe('true');
    expect(anchor.note.lastElementChild).toBe(circle);
    expect(circle.getAttribute('r')).toBe('21');
    expect(circle.getAttribute('cx')).toBe('5');
    expect(circle.getAttribute('cy')).toBe('24');
  });

  it('rounds to a hundredth', () => {
    const circle = drawHalo(haloAnchor(sheet(), boxOf)!, 21.456);
    expect(circle.getAttribute('r')).toBe('21.46');
  });

  it('sets the radius', () => {
    const circle = drawHalo(haloAnchor(sheet(), boxOf)!, 21);
    setHaloRadius(circle, 9);
    expect(circle.getAttribute('r')).toBe('9');
  });

  it('is cleared from every note', () => {
    const host = sheet();
    const anchor = haloAnchor(host, boxOf)!;
    drawHalo(anchor, 21);
    drawHalo({ ...anchor, note: host.querySelector('#b')! }, 21);
    expect(host.querySelectorAll('.along-halo')).toHaveLength(2);
    clearHalos(host);
    expect(host.querySelectorAll('.along-halo')).toHaveLength(0);
  });
});
