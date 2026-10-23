import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { barView, KEY_HOLD_MS, Keyboard, keyboardRange } from './Keyboard.js';

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
  describe('barView (issue #104)', () => {
    const key = (left: number) => ({ left, right: left + 22 });
    /** A stride bar: a low bass and a higher one, alternating under a held chord. */
    const stride = [
      ...[0, 300, 0, 300].map(key),
      ...[440, 462, 506].flatMap((x) => [key(x), key(x), key(x), key(x)]),
    ];
    it('stays put with no keys, or when the keys all fit in the view already', () => {
      expect(barView([], 150, 40)).toBe(40);
      expect(barView([key(100), key(200)], 200, 90)).toBe(90);
    });
    it('centres keys that all fit but are not all in view', () => {
      expect(barView([key(400), key(500)], 200, 0)).toBe(461 - 100);
    });
    it('shows the stretch holding the most of the bar, counting each attack', () => {
      // The chord's twelve attacks beat the bass's four: the view centres the chord.
      expect(barView(stride, 150, 0)).toBe((440 + 528) / 2 - 75);
    });
    it('keeps the view while it holds nearly as many of the bar as the best stretch', () => {
      const lowAndHigh = [...[0, 22, 44].map(key), ...[400, 422, 444, 466].map(key)];
      // Three of seven where the best holds four: close enough, the view stays.
      expect(barView(lowAndHigh, 100, 0)).toBe(0);
      // A view holding none of them moves.
      expect(barView(lowAndHigh, 100, 200)).toBe((400 + 488) / 2 - 50);
    });
    it('does not move from bar to bar under a repeated stride', () => {
      let left = barView(stride, 150, 0);
      for (let bar = 0; bar < 8; bar++) {
        const next = barView(bar % 2 ? stride : [...stride].reverse(), 150, left);
        expect(next).toBe(left);
        left = next;
      }
    });
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

describe('Keyboard: the reader’s own keys (issue 182)', () => {
  // In the key's group; on a dimmed key, beside it (outside the dimming, see below).
  const bar = (container: Element, midi: number) =>
    container.querySelector(
      `[data-midi="${midi}"] rect.key-held, rect.key-held[data-for-midi="${midi}"]`,
    );

  it('draws nothing by default', () => {
    const { container } = render(<Keyboard lowMidi={48} highMidi={71} pressed={[]} />);
    expect(container.querySelectorAll('.key-held')).toHaveLength(0);
  });

  it('draws one bar along the front edge of each held key in range, in the key’s own group', () => {
    const { container } = render(
      <Keyboard lowMidi={48} highMidi={71} pressed={[]} held={[60, 61, 64]} />,
    );
    const bars = [...container.querySelectorAll('rect.key-held')];
    expect(bars.map((b) => b.closest('g.key')?.getAttribute('data-midi'))).toEqual([
      '60',
      '64',
      '61',
    ]); // white keys first, then black: the order the keys are drawn in
    for (const b of bars) expect(b).toHaveAttribute('aria-hidden', 'true');
    // Sizes: a white key's bar sits 8 px above its foot, a black key's 6 px.
    const geometry = (midi: number) => {
      const key = container.querySelector(`[data-midi="${midi}"]`)!;
      const rect = key.querySelector('rect')!;
      const b = bar(container, midi)!;
      const [x, w, h] = ['x', 'width', 'height'].map((a) => Number(rect.getAttribute(a)));
      return {
        dx: Number(b.getAttribute('x')) - x!,
        y: Number(b.getAttribute('y')),
        dw: w! - Number(b.getAttribute('width')),
        h: Number(b.getAttribute('height')),
        rx: Number(b.getAttribute('rx')),
        keyHeight: h!,
      };
    };
    expect(geometry(60)).toEqual({ dx: 3, y: 92, dw: 6, h: 5, rx: 1, keyHeight: 100 });
    expect(geometry(61)).toEqual({ dx: 2, y: 56, dw: 4, h: 4, rx: 1, keyHeight: 62 });
  });

  it('marks a bar on a black key as such only while the key is neither pressed nor dimmed', () => {
    const { container } = render(
      <Keyboard
        lowMidi={48}
        highMidi={71}
        pressed={[{ midi: 63, finger: 2, hand: 'R' }]}
        muted={[{ midi: 66, finger: 3, hand: 'L' }]}
        held={[60, 61, 63, 66]}
      />,
    );
    expect(bar(container, 61)).toHaveClass('is-on-black'); // plain black key
    expect(bar(container, 63)).not.toHaveClass('is-on-black'); // pressed: the key is gray
    expect(bar(container, 66)).not.toHaveClass('is-on-black'); // dimmed: gray too
    expect(bar(container, 60)).not.toHaveClass('is-on-black'); // a white key
  });

  it('draws the bar of a dimmed key beside its group, outside the dimming, so it keeps its contrast', () => {
    const { container } = render(
      <Keyboard
        lowMidi={48}
        highMidi={71}
        pressed={[]}
        muted={[
          { midi: 60, finger: 1, hand: 'L' },
          { midi: 61, finger: 2, hand: 'L' },
        ]}
        held={[60, 61, 62]}
      />,
    );
    for (const midi of [60, 61]) {
      const key = container.querySelector(`g.key[data-midi="${midi}"]`)!;
      expect(key).toHaveClass('is-muted');
      expect(key.querySelector('.key-held')).toBeNull(); // a bar in the group would be dimmed too
      const b = bar(container, midi)!;
      expect(b).toHaveClass('is-dimmed');
      expect(b.closest('.is-muted')).toBeNull();
      expect(b).toHaveAttribute('aria-hidden', 'true');
      // The same place on the key as an undimmed key's bar.
      const rect = key.querySelector('rect')!;
      const h = Number(rect.getAttribute('height'));
      expect(Number(b.getAttribute('y'))).toBe(h - (midi === 61 ? 6 : 8));
      expect(Number(b.getAttribute('x'))).toBe(
        Number(rect.getAttribute('x')) + (midi === 61 ? 2 : 3),
      );
    }
    expect(bar(container, 60)).not.toHaveClass('is-black');
    expect(bar(container, 61)).toHaveClass('is-black'); // a dimmed black key is pale, not black
    expect(bar(container, 61)).not.toHaveClass('is-on-black');
    // A key that is not dimmed keeps its bar in its group.
    expect(container.querySelector('g.key[data-midi="62"] rect.key-held')).not.toBeNull();
    expect(container.querySelectorAll('.key-held')).toHaveLength(3);
  });

  it('draws the dimmed key’s bar above the key and its number, below the hand letters', () => {
    const { container } = render(
      <Keyboard
        lowMidi={48}
        highMidi={71}
        pressed={[]}
        muted={[{ midi: 60, finger: 1, hand: 'L' }]}
        handLetters
        held={[60]}
      />,
    );
    const key = container.querySelector('g.key[data-midi="60"]')!;
    const b = bar(container, 60)!;
    const after = (a: Node, z: Node) =>
      !!(a.compareDocumentPosition(z) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(key, b)).toBe(true);
    expect(after(b, container.querySelector('.key-hand')!)).toBe(true);
  });

  it('is additive: a held key that is also pressed keeps its digit and its pressed class', () => {
    const pressed = [
      { midi: 60, finger: 1 as const, hand: 'R' as const },
      { midi: 64, finger: 3 as const, hand: 'R' as const },
    ];
    const without = render(<Keyboard lowMidi={48} highMidi={71} pressed={pressed} />);
    const pressedWithout = [...without.container.querySelectorAll('.key.is-pressed')].map((k) =>
      k.getAttribute('data-midi'),
    );
    without.unmount();
    const { container } = render(
      <Keyboard lowMidi={48} highMidi={71} pressed={pressed} held={[60, 62]} />,
    );
    const c4 = container.querySelector('[data-midi="60"]')!;
    expect(c4).toHaveClass('is-pressed');
    expect(c4.querySelector('text')).toHaveTextContent(/^1$/);
    expect(bar(container, 60)).not.toBeNull();
    // A held key that nothing presses is not pressed, and the pressed keys are the same ones.
    expect(container.querySelector('[data-midi="62"]')).not.toHaveClass('is-pressed');
    expect(bar(container, 62)).not.toBeNull();
    expect(
      [...container.querySelectorAll('.key.is-pressed')].map((k) => k.getAttribute('data-midi')),
    ).toEqual(pressedWithout);
    // The key's own text is still its finger number alone.
    expect(c4.querySelectorAll('text')).toHaveLength(1);
  });

  it('lies above the key’s fill and digit and below the hand letters', () => {
    const { container } = render(
      <Keyboard
        lowMidi={48}
        highMidi={71}
        pressed={[{ midi: 60, finger: 1, hand: 'R' }]}
        handLetters
        held={[60]}
      />,
    );
    const key = container.querySelector('[data-midi="60"]')!;
    const b = bar(container, 60)!;
    const after = (a: Node, z: Node) =>
      !!(a.compareDocumentPosition(z) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(key.querySelector('rect')!, b)).toBe(true);
    expect(after(key.querySelector('text')!, b)).toBe(true);
    expect(after(b, container.querySelector('.key-hand')!)).toBe(true);
  });

  it('ignores a pitch outside the drawn range', () => {
    const { container } = render(
      <Keyboard lowMidi={48} highMidi={71} pressed={[]} held={[30, 47, 72, 100]} />,
    );
    expect(container.querySelectorAll('.key-held')).toHaveLength(0);
    expect(container.querySelectorAll('[data-midi]')).toHaveLength(24);
  });

  it('is never red', () => {
    const { container } = render(
      <Keyboard
        lowMidi={48}
        highMidi={71}
        pressed={[{ midi: 60, finger: 1, hand: 'R' }]}
        held={[48, 60, 61, 71]}
      />,
    );
    expect(container.querySelectorAll('.key-held')).toHaveLength(4);
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
  });
});
