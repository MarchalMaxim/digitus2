import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EndBurst } from './EndBurst.js';

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

/** A sheet with the cursor on a two-note chord, its noteheads at known places on screen. */
function sheet(): Element {
  const host = document.createElement('div');
  host.innerHTML = `
    <svg>
      <g id="n1" class="note is-red"><ellipse class="notehead" /></g>
      <g id="n2" class="note is-red"><ellipse class="notehead" /></g>
      <g id="n3" class="note"><ellipse class="notehead" /></g>
    </svg>`;
  const at = (id: string, x: number, y: number) => {
    const head = host.querySelector(`#${id} .notehead`)!;
    head.getBoundingClientRect = () =>
      ({ left: x - 5, top: y - 4, width: 10, height: 8, right: x + 5, bottom: y + 4 }) as DOMRect;
  };
  at('n1', 300, 220); // the lower note of the chord
  at('n2', 300, 180); // the upper one: the burst rises from here
  at('n3', 500, 180);
  document.body.append(host);
  return host;
}

function motion(reduced: boolean): void {
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reduced } as MediaQueryList);
}

// Issue 97 and issue 193: ink notes rise from the final chord as the red flies home, at the end only.
describe('the finish', () => {
  it('lets 6 to 8 ink notes rise from the topmost notehead of the last group heard, once', () => {
    motion(false);
    const host = sheet();
    const view = render(<EndBurst host={host} ended={0} currentGroup={4} />);
    expect(document.querySelectorAll('.end-burst .note-burst')).toHaveLength(0);

    // The end: the cursor's marks clear in the same commit, so the heads were read before.
    host.querySelectorAll('.is-red').forEach((g) => g.classList.remove('is-red'));
    view.rerender(<EndBurst host={host} ended={1} currentGroup={-1} />);
    const bursts = document.querySelectorAll<HTMLElement>('.end-burst .note-burst');
    expect(bursts).toHaveLength(1);
    expect(bursts[0]!.style.left).toBe('300px');
    expect(bursts[0]!.style.top).toBe('180px');
    const notes = bursts[0]!.querySelectorAll('.note-burst-note');
    expect(notes.length).toBeGreaterThanOrEqual(6);
    expect(notes.length).toBeLessThanOrEqual(8);
    expect(document.querySelectorAll('.end-burst .is-red')).toHaveLength(0);
    expect(document.querySelector('.end-burst')!.getAttribute('aria-hidden')).toBe('true');

    // The same end again (a re-render) adds nothing; the next end lets a fresh burst rise.
    view.rerender(<EndBurst host={host} ended={1} currentGroup={-1} />);
    expect(document.querySelector('.end-burst .note-burst')).toBe(bursts[0]);
    host.querySelector('#n3')!.classList.add('is-red');
    view.rerender(<EndBurst host={host} ended={1} currentGroup={9} />);
    view.rerender(<EndBurst host={host} ended={2} currentGroup={-1} />);
    const again = document.querySelectorAll<HTMLElement>('.end-burst .note-burst');
    expect(again).toHaveLength(1);
    expect(again[0]).not.toBe(bursts[0]);
    expect(again[0]!.style.left).toBe('500px');
    host.remove();
  });

  it('rises from nothing when no group was heard, and never under reduced motion', () => {
    motion(false);
    const host = sheet();
    host.querySelectorAll('.is-red').forEach((g) => g.classList.remove('is-red'));
    const view = render(<EndBurst host={host} ended={0} currentGroup={-1} />);
    view.rerender(<EndBurst host={host} ended={1} currentGroup={-1} />);
    expect(document.querySelectorAll('.end-burst .note-burst')).toHaveLength(0);
    view.unmount();

    motion(true);
    const marked = sheet();
    const still = render(<EndBurst host={marked} ended={0} currentGroup={0} />);
    still.rerender(<EndBurst host={marked} ended={1} currentGroup={-1} />);
    expect(document.querySelectorAll('.end-burst .note-burst')).toHaveLength(0);
    host.remove();
    marked.remove();
  });
});
