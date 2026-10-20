import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEY_HOLD_MS, Keyboard, keyboardRange, keysToShow } from './Keyboard.js';

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

describe('Keyboard', () => {
  // Key travel (motion study 06): a repeated note on a held key strikes it again, so the reader
  // sees the second strike; a key that is only held, or newly pressed, does not.
  it('strikes a held key again when its note repeats, never a key only held', () => {
    const struck: string[] = [];
    const proto = Element.prototype as unknown as { animate?: unknown };
    const original = proto.animate;
    proto.animate = function (this: Element) {
      struck.push(this.getAttribute('data-midi') ?? '');
      return {} as Animation;
    };
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    try {
      const { rerender } = render(
        <Keyboard
          lowMidi={48}
          highMidi={71}
          pressed={[
            { midi: 60, finger: 1, hand: 'R' },
            { midi: 48, finger: 5, hand: 'L' },
          ]}
          struckCount={2}
        />,
      );
      expect(struck).toEqual([]);
      // C4 struck again and D4 struck for the first time; C3 still held from before.
      rerender(
        <Keyboard
          lowMidi={48}
          highMidi={71}
          pressed={[
            { midi: 60, finger: 1, hand: 'R' },
            { midi: 62, finger: 2, hand: 'R' },
            { midi: 48, finger: 5, hand: 'L' },
          ]}
          struckCount={2}
        />,
      );
      expect(struck).toEqual(['60']);
    } finally {
      proto.animate = original;
    }
  });
  it('draws the range and shows finger numbers on pressed keys', () => {
    const { container } = render(
      <Keyboard
        lowMidi={48}
        highMidi={71}
        pressed={[
          { midi: 60, finger: 1, hand: 'R' },
          { midi: 61, finger: 2, hand: 'R' },
        ]}
      />,
    );
    expect(container.querySelectorAll('[data-midi]')).toHaveLength(24);
    const c4 = container.querySelector('[data-midi="60"]')!;
    expect(c4).toHaveClass('is-pressed');
    expect(c4.querySelector('text')).toHaveTextContent('1');
    const cs4 = container.querySelector('[data-midi="61"]')!;
    expect(cs4).toHaveClass('is-black');
    expect(cs4.querySelector('text')).toHaveTextContent('2');
    expect(container.querySelector('[data-midi="62"]')).not.toHaveClass('is-pressed');
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
  });
  // Polish plan Task 4 (review S4): the keyboard showed digits with no L or R.
  it('marks every pressed key with the hand that plays it, L or R, with or without a finger', () => {
    const { container } = render(
      <Keyboard
        lowMidi={48}
        highMidi={71}
        pressed={[
          { midi: 64, finger: 3, hand: 'R' },
          { midi: 61, finger: 2, hand: 'L' },
          { midi: 50, finger: null, hand: 'L' },
        ]}
        handLetters
      />,
    );
    const marks = [...container.querySelectorAll('.key-hand')];
    expect(marks.map((m) => [m.getAttribute('data-for-midi'), m.textContent])).toEqual([
      ['64', 'R'],
      ['61', 'L'],
      ['50', 'L'],
    ]);
    // The mark stands over its own key, above the finger number.
    const e4 = container.querySelector('[data-midi="64"]')!;
    const rect = e4.querySelector('rect')!;
    const mark = marks[0]!;
    const x = Number(mark.getAttribute('x'));
    expect(x).toBeGreaterThan(Number(rect.getAttribute('x')));
    expect(x).toBeLessThan(Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')));
    expect(Number(mark.getAttribute('y'))).toBeLessThan(
      Number(e4.querySelector('text')!.getAttribute('y')),
    );
    // The finger number stays the key's own text, alone.
    expect(e4.querySelectorAll('text')).toHaveLength(1);
    expect(e4.querySelector('text')).toHaveTextContent(/^3$/);
    expect(container.querySelector('[data-midi="50"] text')).toBeNull();
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
  });
  it('shows no letters unless told to (T11)', () => {
    const { container } = render(
      <Keyboard
        lowMidi={48}
        highMidi={71}
        pressed={[
          { midi: 64, finger: 3, hand: 'R' },
          { midi: 52, finger: 1, hand: 'L' },
        ]}
      />,
    );
    expect(container.querySelectorAll('.key-hand')).toHaveLength(0);
    expect(container.querySelector('[data-midi="64"] text')).toHaveTextContent('3');
  });
  // Polish plan Task 4 (review S10): one-hand practice showed nothing of the muted hand.
  it("draws the muted hand's keys dimmed, not pressed, with their finger and hand", () => {
    const { container } = render(
      <Keyboard
        lowMidi={48}
        highMidi={71}
        pressed={[{ midi: 64, finger: 3, hand: 'R' }]}
        muted={[
          { midi: 48, finger: 5, hand: 'L' },
          { midi: 55, finger: 1, hand: 'L' },
          // A unison with the hand played: that key is pressed, not dimmed.
          { midi: 64, finger: 1, hand: 'L' },
        ]}
        handLetters
      />,
    );
    const c3 = container.querySelector('[data-midi="48"]')!;
    expect(c3).toHaveClass('is-muted');
    expect(c3).not.toHaveClass('is-pressed');
    expect(c3).toHaveAttribute('data-hand', 'L');
    expect(c3.querySelector('text')).toHaveTextContent(/^5$/);
    expect(container.querySelector('[data-midi="55"]')).toHaveClass('is-muted');
    const e4 = container.querySelector('[data-midi="64"]')!;
    expect(e4).toHaveClass('is-pressed');
    expect(e4).not.toHaveClass('is-muted');
    expect(e4).toHaveAttribute('data-hand', 'R');
    expect(e4.querySelector('text')).toHaveTextContent(/^3$/);
    expect(container.querySelectorAll('.is-pressed')).toHaveLength(1);
    expect(container.querySelectorAll('.key.is-muted')).toHaveLength(2);
    // Each dimmed key carries its hand mark, dimmed with it.
    const marks = [...container.querySelectorAll('.key-hand')].map((m) => [
      m.getAttribute('data-for-midi'),
      m.textContent,
      m.classList.contains('is-muted'),
    ]);
    expect(marks).toEqual([
      ['64', 'R', false],
      ['48', 'L', true],
      ['55', 'L', true],
    ]);
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
  });
  // Task 4 review: a dimmed black key let the white keys' outlines show through it.
  it('puts an opaque backing under a dimmed black key only', () => {
    const { container } = render(
      <Keyboard
        lowMidi={48}
        highMidi={71}
        pressed={[{ midi: 61, finger: 2, hand: 'R' }]}
        muted={[
          { midi: 54, finger: 3, hand: 'L' },
          { midi: 48, finger: 5, hand: 'L' },
        ]}
      />,
    );
    const backings = [...container.querySelectorAll('rect.key-backing')];
    expect(backings).toHaveLength(1);
    const fSharp = container.querySelector('[data-midi="54"]')!;
    expect(fSharp).toHaveClass('is-black', 'is-muted');
    // Drawn just before the key, over the white keys, with the key's own box.
    expect(backings[0]!.nextElementSibling).toBe(fSharp);
    const rect = fSharp.querySelector('rect')!;
    for (const a of ['x', 'y', 'width', 'height'])
      expect(backings[0]!.getAttribute(a), a).toBe(rect.getAttribute(a));
    expect(backings[0]!.closest('.key')).toBeNull();
  });
  it('never draws a white key narrower than 22 px: a wide range scrolls inside the keyboard', () => {
    const { container } = render(<Keyboard lowMidi={48} highMidi={71} pressed={[]} />);
    const scroller = container.querySelector('.keyboard-scroll')!;
    const svg = scroller.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-label', 'Keyboard');
    expect(svg.style.minWidth).toBe(`${14 * 22}px`);
    // Not a tab stop until it actually scrolls (nothing is laid out here).
    expect(scroller).not.toHaveAttribute('tabindex');
  });
  it('shows every pressed key when they fit, else the most of them, preferring the struck one', () => {
    expect(keysToShow([], 300)).toBeNull();
    const lh = { left: 0, right: 22 };
    const rh1 = { left: 300, right: 322 };
    const rh2 = { left: 344, right: 366 };
    expect(keysToShow([lh, rh1], 400)).toEqual({ left: 0, right: 322 });
    expect(keysToShow([lh, rh1, rh2], 150)).toEqual({ left: 300, right: 366 });
    expect(keysToShow([rh1, lh], 150)).toEqual({ left: 300, right: 322 });
    expect(keysToShow([lh, rh1], 150)).toEqual({ left: 0, right: 22 });
  });
  it('breaks a tie between stretches holding equally many keys in favour of the earlier one', () => {
    const struck = { left: 0, right: 22 };
    const earlier = [
      { left: 300, right: 322 },
      { left: 344, right: 366 },
    ];
    const later = [
      { left: 600, right: 622 },
      { left: 644, right: 666 },
    ];
    expect(keysToShow([struck, ...earlier, ...later], 150)).toEqual({ left: 300, right: 366 });
  });
  it('centres a black key on the line between its two white neighbours', () => {
    const { container } = render(<Keyboard lowMidi={48} highMidi={71} pressed={[]} />);
    const x = (midi: number) =>
      Number(container.querySelector(`[data-midi="${midi}"] rect`)!.getAttribute('x'));
    const width = Number(container.querySelector('[data-midi="61"] rect')!.getAttribute('width'));
    // C#4 sits between C4 and D4: its centre is where D4 begins.
    expect(x(61) + width / 2).toBe(x(62));
    expect(x(70) + width / 2).toBe(x(71));
  });
  it('keeps the range on the 88 keys of a piano when the lowest note is the lowest key', () => {
    expect(keyboardRange({ notes: [{ midi: 21 }] } as never)).toEqual({
      lowMidi: 21,
      highMidi: 47,
    });
    expect(keyboardRange({ notes: [{ midi: 108 }] } as never)).toEqual({
      lowMidi: 84,
      highMidi: 108,
    });
  });
  it('scrolls a pressed black key out of view to the middle of the key, by its own width', () => {
    // Nothing is laid out here: stub a 337 px wide keyboard (scale 1) seen through 100 px.
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(337);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 337,
      height: 101,
    } as DOMRect);
    const { container } = render(
      <Keyboard lowMidi={48} highMidi={71} pressed={[{ midi: 70, finger: 2, hand: 'R' }]} />,
    );
    const key = container.querySelector('[data-midi="70"] rect')!;
    const left = Number(key.getAttribute('x')) + 0.5;
    const middle = left + Number(key.getAttribute('width')) / 2;
    const scroller = container.querySelector('.keyboard-scroll') as HTMLElement;
    expect(scroller.scrollLeft).toBe(middle - 50);
  });
  it('computes a range from C below the lowest note to B above the highest, at least two octaves', () => {
    expect(keyboardRange({ notes: [{ midi: 62 }, { midi: 65 }] } as never)).toEqual({
      lowMidi: 48,
      highMidi: 71,
    });
    expect(keyboardRange({ notes: [{ midi: 43 }, { midi: 84 }] } as never)).toEqual({
      lowMidi: 36,
      highMidi: 95,
    });
  });
  it('includes an ornament auxiliary that crosses the highest written octave boundary', () => {
    const note = {
      midi: 71,
      onsetSec: 0,
      offsetSec: 1,
      ornament: {
        kind: 'inverted-mordent',
        long: false,
        upperMidi: 72,
        lowerMidi: 69,
        startNote: 'main',
        endSec: 1,
      },
    };
    expect(keyboardRange({ notes: [note] } as never)).toEqual({ lowMidi: 60, highMidi: 83 });
  });

  // The keyboard answers (issue #96): the key of a hovered note goes down with its finger, like a
  // cue, and a key pressed with the pointer goes down and sounds until it lifts.
  describe('hovered and pressed keys', () => {
    const mouse = { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 };
    it('presses the hovered key with its finger; the cursor keeps its own finger and letters', () => {
      const { container, rerender } = render(
        <Keyboard
          lowMidi={48}
          highMidi={71}
          pressed={[{ midi: 60, finger: 1, hand: 'R' }]}
          hovered={{ midi: 64, finger: 3, hand: 'R' }}
          handLetters
        />,
      );
      const e4 = container.querySelector('[data-midi="64"]')!;
      expect(e4).toHaveClass('is-pressed');
      expect(e4.querySelector('text')).toHaveTextContent('3');
      expect(container.querySelectorAll('.key-hand')).toHaveLength(1); // the cursor's key alone
      rerender(
        <Keyboard
          lowMidi={48}
          highMidi={71}
          pressed={[{ midi: 60, finger: 1, hand: 'R' }]}
          hovered={{ midi: 60, finger: 2, hand: 'L' }}
        />,
      );
      expect(container.querySelector('[data-midi="60"] text')).toHaveTextContent('1');
      expect(container.querySelector('[data-midi="64"]')).not.toHaveClass('is-pressed');
      rerender(<Keyboard lowMidi={48} highMidi={71} pressed={[]} hovered={null} />);
      expect(container.querySelectorAll('.is-pressed')).toHaveLength(0);
      expect(container.querySelectorAll('.is-red')).toHaveLength(0);
    });
    it('a hovered key that the muted hand holds is pressed, not dimmed', () => {
      const { container } = render(
        <Keyboard
          lowMidi={48}
          highMidi={71}
          pressed={[]}
          muted={[{ midi: 48, finger: 5, hand: 'L' }]}
          hovered={{ midi: 48, finger: 5, hand: 'L' }}
        />,
      );
      const c3 = container.querySelector('[data-midi="48"]')!;
      expect(c3).toHaveClass('is-pressed');
      expect(c3).not.toHaveClass('is-muted');
    });
    it('a key pressed with the pointer goes down, sounds, and lifts on release', () => {
      vi.useFakeTimers();
      try {
        const release = vi.fn();
        const onStrike = vi.fn(() => release);
        const { container } = render(
          <Keyboard lowMidi={48} highMidi={71} pressed={[]} onStrike={onStrike} />,
        );
        const svg = container.querySelector('svg')!;
        const d4 = container.querySelector('[data-midi="62"]')!;
        fireEvent.pointerDown(d4.querySelector('rect')!, mouse);
        expect(d4).toHaveClass('is-pressed');
        expect(d4.querySelector('text')).toBeNull(); // no finger for a key the reader pressed
        expect(onStrike).toHaveBeenCalledWith(62);
        // A second pointer, or a drag onto another key, strikes nothing.
        fireEvent.pointerDown(container.querySelector('[data-midi="64"] rect')!, {
          ...mouse,
          pointerId: 2,
        });
        expect(onStrike).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();
        fireEvent.pointerUp(svg, mouse);
        expect(release).toHaveBeenCalledTimes(1);
        expect(d4).not.toHaveClass('is-pressed');
        // A click on a key is handled: no note burst.
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        act(() => {
          d4.dispatchEvent(click);
        });
        expect(click.defaultPrevented).toBe(true);
        // Held: the key lifts by itself after the hold.
        fireEvent.pointerDown(d4, mouse);
        expect(d4).toHaveClass('is-pressed');
        act(() => {
          vi.advanceTimersByTime(KEY_HOLD_MS + 1);
        });
        expect(d4).not.toHaveClass('is-pressed');
        expect(release).toHaveBeenCalledTimes(2);
        // Off the keys, nothing.
        fireEvent.pointerDown(svg, mouse);
        expect(onStrike).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
    it('a press on a key already down strikes it again', () => {
      const struck: string[] = [];
      const proto = Element.prototype as unknown as { animate?: unknown };
      const original = proto.animate;
      proto.animate = function (this: Element) {
        struck.push(this.getAttribute('data-midi') ?? '');
        return {} as Animation;
      };
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
      try {
        const { container } = render(
          <Keyboard
            lowMidi={48}
            highMidi={71}
            pressed={[{ midi: 60, finger: 1, hand: 'R' }]}
            hovered={{ midi: 64, finger: 3, hand: 'R' }}
            onStrike={() => undefined}
          />,
        );
        fireEvent.pointerDown(container.querySelector('[data-midi="60"]')!, mouse);
        fireEvent.pointerUp(container.querySelector('svg')!, mouse);
        fireEvent.pointerDown(container.querySelector('[data-midi="64"]')!, mouse);
        fireEvent.pointerUp(container.querySelector('svg')!, mouse);
        fireEvent.pointerDown(container.querySelector('[data-midi="65"]')!, mouse);
        expect(struck).toEqual(['60', '64']);
      } finally {
        proto.animate = original;
      }
    });
  });
});
