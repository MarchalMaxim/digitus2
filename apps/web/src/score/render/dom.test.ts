import { describe, expect, it, vi } from 'vitest';
import { clearCurrent, dimNotes, noteIdAt, setCurrent, setDigits, sweepDimming } from './dom.js';

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

/**
 * Two bars of two staves as Verovio draws them (`g.measure > g.staff > g.layer`): the right hand
 * on top with a chord shared with the left hand (r2 and l9), the left hand's beamed pair below,
 * then a bar where the left hand rests.
 */
const bars = `
<svg xmlns="http://www.w3.org/2000/svg"><g class="system">
  <g class="measure" id="m1">
    <g class="staff" id="s1a"><path/><g class="clef" id="clef1"></g>
      <g class="layer" id="l1a"><g class="note" id="r1"></g>
        <g class="chord" id="cx"><g class="note" id="r2"></g><g class="note" id="l9"></g></g></g>
    </g>
    <g class="staff" id="s1b"><path/>
      <g class="layer" id="l1b"><g class="beam" id="b1"><polygon/>
        <g class="note" id="l1"></g><g class="note" id="l2"></g></g></g>
    </g>
    <g class="slur" id="slur1"></g>
    <g class="fing" data-startid="#r1"><text>1</text></g>
    <g class="fing" data-startid="#l1"><text>5</text></g>
    <g class="fing" data-startid="#l9"><text>1</text></g>
  </g>
  <g class="measure" id="m2">
    <g class="staff" id="s2a"><g class="layer" id="l2a"><g class="note" id="r3"></g></g></g>
    <g class="staff" id="s2b"><g class="layer" id="l2b"><g class="rest" id="rest1"></g></g></g>
  </g>
</g></svg>`;

// Polish plan Task 4 review (S10): one-hand practice dimmed only the keyboard, so the score did
// not show which hand is being played.
describe('dimming the hand left out', () => {
  function bars2() {
    const div = document.createElement('div');
    div.innerHTML = bars;
    return div;
  }
  const dimmed = (h: Element) =>
    [...h.querySelectorAll('.is-muted')]
      .map((el) => el.id || el.getAttribute('data-startid'))
      .sort();

  it("dims the left hand's staff whole, its rests included, and its digits; a shared chord keeps the right hand's note", () => {
    const h = bars2();
    expect(dimNotes(h, new Set(['l1', 'l2', 'l9']))).toBe(5);
    // The beamed layer and the rest-only layer below; l9 alone in the shared chord; its digits.
    expect(dimmed(h)).toEqual(['#l1', '#l9', 'l1b', 'l2b', 'l9']);
    expect(h.querySelector('#clef1')).not.toHaveClass('is-muted');
    expect(h.querySelector('#slur1')).not.toHaveClass('is-muted');
    // Nothing dimmed inside something dimmed.
    expect(h.querySelectorAll('.is-muted .is-muted')).toHaveLength(0);
  });

  it('dims the right hand note by note where the layer is shared, and a layer of its own whole', () => {
    const h = bars2();
    expect(dimNotes(h, new Set(['r1', 'r2', 'r3']))).toBe(4);
    expect(dimmed(h)).toEqual(['#r1', 'l2a', 'r1', 'r2']);
  });

  it('dims a chord whole when all its notes are dimmed, and clears the earlier dimming first', () => {
    const h = bars2();
    dimNotes(h, new Set(['l1', 'l2', 'l9']));
    expect(dimNotes(h, new Set(['r2', 'l9']))).toBe(2);
    expect(dimmed(h)).toEqual(['#l9', 'cx']);
    expect(dimNotes(h, new Set())).toBe(0);
    expect(h.querySelectorAll('.is-muted')).toHaveLength(0);
  });

  it('never touches the cursor marks', () => {
    const h = bars2();
    setCurrent(h, ['r1', 'r2'], 0);
    dimNotes(h, new Set(['l1', 'l2', 'l9']));
    expect(h.querySelectorAll('.is-red').length).toBe(2);
    dimNotes(h, new Set());
    expect(h.querySelectorAll('.is-red').length).toBe(2);
  });

  // Motion study 08: a hand switch fades bar by bar, from the first bar of a system to the last.
  it('sweeps a hand switch bar by bar, from the markup alone; a spread of 0 clears the delays', () => {
    const h = bars2();
    dimNotes(h, new Set(['l1', 'l2', 'l9']));
    const changed = [...h.querySelectorAll('.is-muted')];
    expect(sweepDimming(changed, 140)).toBe(changed.length);
    const sweep = (id: string) =>
      (h.querySelector(`#${id}`) as SVGElement).style.getPropertyValue('--sweep');
    expect(sweep('l1b')).toBe('0ms'); // bar 1 of 2
    expect(sweep('l2b')).toBe('140ms'); // bar 2 of 2, the last
    sweepDimming(changed, 0);
    expect(sweep('l2b')).toBe('0ms');
  });
});

describe('dimming edge cases', () => {
  it('leaves the rests of a note-less staff place alone when another staff is dimmed', () => {
    const div = document.createElement('div');
    div.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><g class="system"><g class="measure">
      <g class="staff"><g class="layer" id="top"><g class="note" id="a1"></g></g></g>
      <g class="staff"><g class="layer" id="bottom"><g class="rest" id="rest"></g></g></g>
    </g></g></svg>`;
    expect(dimNotes(div, new Set(['a1']))).toBe(1);
    expect(div.querySelector('#top')).toHaveClass('is-muted');
    expect(div.querySelector('#bottom')).not.toHaveClass('is-muted');
  });

  it('sweeps the middle bar of a three-bar system to half the spread', () => {
    const div = document.createElement('div');
    div.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><g class="system">
      <g class="measure" id="m1"><g class="note" id="x1"></g></g>
      <g class="measure" id="m2"><g class="note" id="x2"></g></g>
      <g class="measure" id="m3"><g class="note" id="x3"></g></g>
    </g></svg>`;
    sweepDimming([...div.querySelectorAll('g.note')], 140);
    const sweep = (id: string) =>
      (div.querySelector(`#${id}`) as SVGElement).style.getPropertyValue('--sweep');
    expect([sweep('x1'), sweep('x2'), sweep('x3')]).toEqual(['0ms', '70ms', '140ms']);
  });
});
