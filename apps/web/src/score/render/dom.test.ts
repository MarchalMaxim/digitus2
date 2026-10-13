import { describe, expect, it, vi } from 'vitest';
import { clearCurrent, noteIdAt, setCurrent, setDigits } from './dom.js';

const svg = `
<svg xmlns="http://www.w3.org/2000/svg">
  <g class="note" id="n1"><use/></g>
  <g class="chord" id="c1"><g class="note" id="n2"><use/></g><g class="note" id="n3"><use/></g></g>
  <g class="fing" data-startid="#n1"><text><tspan><tspan>3</tspan></tspan></text></g>
  <g class="fing" data-startid="#n2"><text><tspan><tspan>1</tspan></tspan></text></g>
</svg>`;

function host() {
  const div = document.createElement('div');
  div.innerHTML = svg;
  return div;
}

describe('render dom helpers', () => {
  it('marks a single note and a whole chord once, with the onset tick', () => {
    const h = host();
    const marked = setCurrent(h, ['n1', 'n2', 'n3'], 480);
    expect(marked.map((e) => e.id)).toEqual(['n1', 'c1']);
    expect(h.querySelectorAll('.is-red')).toHaveLength(2);
    expect(h.querySelector('#c1')!.getAttribute('data-onset-tick')).toBe('480');
    clearCurrent(h);
    expect(h.querySelectorAll('.is-red')).toHaveLength(0);
    expect(h.querySelectorAll('[data-onset-tick]')).toHaveLength(0);
  });
  it('patches digits in place, flashes only the changed ones, ignores unknown ids', () => {
    const h = host();
    const flash = vi.fn();
    const changed = setDigits(
      h,
      new Map([
        ['n1', '2'],
        ['n2', '1'],
        ['nope', '5'],
      ]),
      flash,
    );
    expect(changed).toBe(1);
    expect(h.querySelector('g.fing[data-startid="#n1"] tspan tspan')!.textContent).toBe('2');
    expect(flash).toHaveBeenCalledTimes(1);
  });
  it('finds the note id under an event target', () => {
    const h = host();
    expect(noteIdAt(h.querySelector('#n3 use'))).toBe('n3');
    expect(noteIdAt(h.querySelector('g.fing'))).toBeNull();
    expect(noteIdAt(null)).toBeNull();
  });
});
