import { describe, expect, it, vi } from 'vitest';
import { buildPageIndex } from './pageIndex.js';
import { PageWindow, pageWindowOf } from './pageWindow.js';
import {
  clearCurrent,
  dimNotes,
  mutedElements,
  noteIdAt,
  redim,
  setCurrent,
  setDigits,
  settleCancelled,
  settleStill,
  settleSweep,
  sweepDimming,
  systemsOnScreen,
} from './dom.js';

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

  // Issue #79: a long piece has some 100,000 elements to walk; what a selection dims is found once
  // per layout (`mutedElements`), and a switch only moves the class between two such lists.
  it('finds what to dim without dimming it, and moves the dimming from one selection to another', () => {
    const h = bars2();
    const left = mutedElements(h, new Set(['l1', 'l2', 'l9']));
    const right = mutedElements(h, new Set(['r1', 'r2', 'r3']));
    expect(h.querySelectorAll('.is-muted')).toHaveLength(0);
    redim([], left);
    expect(dimmed(h)).toEqual(['#l1', '#l9', 'l1b', 'l2b', 'l9']);
    redim(left, right);
    expect(dimmed(h)).toEqual(['#r1', 'l2a', 'r1', 'r2']);
    redim(right, []);
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
  it('sweeps a hand switch bar by bar, from the markup alone; a spread of 0 sweeps nothing', () => {
    const h = bars2();
    dimNotes(h, new Set(['l1', 'l2', 'l9']));
    const changed = [...h.querySelectorAll('.is-muted')];
    const systems = new Set(h.querySelectorAll('g.system'));
    expect(sweepDimming(h, changed, 140, systems)).toBe(changed.length);
    const sweep = (id: string) =>
      (h.querySelector(`#${id}`) as SVGElement).style.getPropertyValue('--sweep');
    expect(sweep('l1b')).toBe('0ms'); // bar 1 of 2
    expect(sweep('l2b')).toBe('140ms'); // bar 2 of 2, the last
    expect(h.querySelectorAll('.is-sweeping')).toHaveLength(changed.length);
    // Reduced motion: the switch is instant, and the earlier sweep's marks are gone.
    expect(sweepDimming(h, changed, 0, systems)).toBe(0);
    expect(h.querySelectorAll('.is-sweeping')).toHaveLength(0);
    expect(sweep('l2b')).toBe('');
  });
});

// Issue #79: a sweep over the whole piece animated every dimmed element of every page at once
// (8,818 transitions on a 780-bar piece). Only the systems on screen sweep; the rest change at once.
describe('sweeping only what is on screen', () => {
  const twoSystems = `
<svg xmlns="http://www.w3.org/2000/svg">
  <g class="system" id="sys1">
    <g class="measure"><g class="staff"><g class="layer" id="a1"><g class="note" id="n1"></g></g></g></g>
    <g class="measure"><g class="staff"><g class="layer" id="a2"><g class="note" id="n2"></g></g></g></g>
  </g>
  <g class="system" id="sys2">
    <g class="measure"><g class="staff"><g class="layer" id="b1"><g class="note" id="n3"></g></g></g></g>
  </g>
</svg>`;
  function sheet() {
    const div = document.createElement('div');
    div.innerHTML = twoSystems;
    return div;
  }

  it('marks the changed elements of the systems on screen, and leaves the others to change at once', () => {
    const h = sheet();
    const changed = [...h.querySelectorAll('g.layer')];
    expect(sweepDimming(h, changed, 140, new Set([h.querySelector('#sys1')!]))).toBe(2);
    expect([...h.querySelectorAll('.is-sweeping')].map((e) => e.id)).toEqual(['a1', 'a2']);
    expect((h.querySelector('#b1') as SVGElement).style.getPropertyValue('--sweep')).toBe('');
  });

  it("clears the previous switch's marks first, so an element scrolled off screen since changes at once", () => {
    const h = sheet();
    const changed = [...h.querySelectorAll('g.layer')];
    sweepDimming(h, changed, 140, new Set([h.querySelector('#sys1')!]));
    expect(sweepDimming(h, changed, 140, new Set([h.querySelector('#sys2')!]))).toBe(1);
    expect([...h.querySelectorAll('.is-sweeping')].map((e) => e.id)).toEqual(['b1']);
    expect((h.querySelector('#a2') as SVGElement).style.getPropertyValue('--sweep')).toBe('');
  });

  it('settles an element once its own fade ends, and leaves everything else alone', () => {
    const h = sheet();
    sweepDimming(h, [...h.querySelectorAll('g.layer')], 140, new Set([h.querySelector('#sys1')!]));
    settleSweep(h.querySelector('#a1'));
    settleSweep(h.querySelector('#n2')); // inside a swept element: not swept itself
    settleSweep(null);
    expect([...h.querySelectorAll('.is-sweeping')].map((e) => e.id)).toEqual(['a2']);
    expect((h.querySelector('#a1') as SVGElement).style.getPropertyValue('--sweep')).toBe('');
  });

  // UI review 2026-10-20, H1: a digit brought back fades in from its resting gray only when it was
  // at rest; one still fading (a quick toggle) turns back from where its fade is.
  it('marks a digit brought back as returning only when it was dimmed at rest', () => {
    const div = document.createElement('div');
    div.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><g class="system" id="sys">
      <g class="measure"><g class="fing" id="rest"></g><g class="fing" id="fading"></g>
        <g class="fing" id="going"></g><g class="layer" id="layer"></g></g>
    </g></svg>`;
    const el = (id: string) => div.querySelector(`#${id}`)!;
    el('fading').classList.add('is-sweeping'); // still fading from the switch before
    el('going').classList.add('is-muted'); // dimmed by this switch
    const changed = ['rest', 'fading', 'going', 'layer'].map(el);
    sweepDimming(div, changed, 140, new Set([el('sys')]));
    expect([...div.querySelectorAll('.is-returning')].map((e) => e.id)).toEqual(['rest']);
    expect(div.querySelectorAll('.is-sweeping')).toHaveLength(4);
    settleSweep(el('rest'));
    expect(el('rest')).not.toHaveClass('is-returning');
  });

  // UI review 2026-10-20, H3: a fade cancelled by the next switch fires no end event.
  it('settles an element whose fade was cancelled once nothing of it still runs', () => {
    const h = sheet();
    sweepDimming(h, [...h.querySelectorAll('g.layer')], 140, new Set([h.querySelector('#sys1')!]));
    const a1 = h.querySelector('#a1')!;
    const a2 = h.querySelector('#a2')!;
    a1.getAnimations = () => [];
    a2.getAnimations = () => [{} as Animation];
    settleCancelled(a1);
    settleCancelled(a2); // another of its fades still runs
    expect([...h.querySelectorAll('.is-sweeping')].map((e) => e.id)).toEqual(['a2']);
  });

  // A switch undone within a frame changes nothing: no fade starts, so no end event will come.
  it('settles at once every element marked that has no fade to run', () => {
    const h = sheet();
    sweepDimming(h, [...h.querySelectorAll('g.layer')], 140, new Set([h.querySelector('#sys1')!]));
    const a2 = h.querySelector('#a2')!;
    const doc = { getAnimations: () => [{ effect: { target: a2 } } as unknown as Animation] };
    settleStill(h, doc as unknown as Document);
    expect([...h.querySelectorAll('.is-sweeping')].map((e) => e.id)).toEqual(['a2']);
  });

  it('finds the systems on screen from one box per page, then one per system of the pages on screen', () => {
    const div = document.createElement('div');
    div.innerHTML = `
      <svg id="p1"><g class="system" id="s1"></g><g class="system" id="s2"></g></svg>
      <svg id="p2"><g class="system" id="s3"></g><g class="system" id="s4"></g></svg>
      <svg id="p3"><g class="system" id="s5"></g></svg>`;
    // The window is 900 px tall; page 1 ends above it, page 3 starts below it.
    const boxes: Record<string, [number, number]> = {
      p1: [-1400, -200],
      p2: [-200, 1000],
      p3: [1000, 2200],
      s1: [-1300, -1000],
      s2: [-700, -400],
      s3: [-150, 150],
      s4: [700, 950],
      s5: [1100, 1400],
    };
    const measured: string[] = [];
    for (const el of div.querySelectorAll('[id]')) {
      const [top, bottom] = boxes[el.id]!;
      el.getBoundingClientRect = () => {
        measured.push(el.id);
        return { top, bottom } as DOMRect;
      };
    }
    expect([...systemsOnScreen(div, 900)].map((e) => e.id)).toEqual(['s3', 's4']);
    // The systems of the pages off screen are never measured.
    expect(measured.filter((id) => id.startsWith('s'))).toEqual(['s3', 's4']);
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
    sweepDimming(
      div,
      [...div.querySelectorAll('g.note')],
      140,
      new Set(div.querySelectorAll('g.system')),
    );
    const sweep = (id: string) =>
      (div.querySelector(`#${id}`) as SVGElement).style.getPropertyValue('--sweep');
    expect([sweep('x1'), sweep('x2'), sweep('x3')]).toEqual(['0ms', '70ms', '140ms']);
  });

  // Issue 99: with only some pages in the DOM, whether a whole staff is dimmed is decided across
  // every page's markup (`quietPlaces`), and handed in.
  it('dims a whole staff when the places it knows of say so, not by the pages in the DOM', () => {
    const div = document.createElement('div');
    div.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><g class="system"><g class="measure">
      <g class="staff"><g class="layer"><g class="note" id="r1"></g></g></g>
      <g class="staff"><g class="layer" id="withNote"><g class="note" id="l1"></g></g>
        <g class="layer" id="restOnly"><g class="rest"></g></g></g>
    </g></g></svg>`;
    const ids = new Set(['l1']);
    const names = (els: Element[]) => els.map((el) => el.id).sort();
    // Every note of this page at place 1 is dimmed, yet another page's note there is not.
    expect(names(mutedElements(div, ids, new Set()))).toEqual(['withNote']);
    expect(names(mutedElements(div, ids, new Set([1])))).toEqual(['restOnly', 'withNote']);
    expect(names(mutedElements(div, ids))).toEqual(['restOnly', 'withNote']);
  });

  it('builds the pages of the notes it marks first, on a windowed sheet', () => {
    const page = (p: number) =>
      `<svg viewBox="0 0 10 10"><g class="measure"><g class="staff"><g class="note" id="n${p}"><use/></g></g></g></svg>`;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const p = this.getAttribute('data-page');
      return new DOMRect(0, p === null ? 0 : 1000 * Number(p), 1000, p === null ? 0 : 1000);
    });
    const host = document.createElement('div');
    document.body.append(host);
    const win = new PageWindow(
      host,
      buildPageIndex(Array.from({ length: 8 }, (_, p) => page(p))),
      () => undefined,
    );
    win.start();
    expect(host.querySelector('#n5')).toBeNull();
    expect(pageWindowOf(host)).toBe(win);
    const marked = setCurrent(host, ['n5', 'nobody'], 480);
    expect(marked.map((el) => el.id)).toEqual(['n5']);
    expect(host.querySelector('#n5')).toHaveClass('is-red');
    win.dispose();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
