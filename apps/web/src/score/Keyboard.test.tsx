import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  barView,
  KEY_HOLD_MS,
  KEY_TRAVEL,
  Keyboard,
  keyboardRange,
  type KeyboardProps,
} from './Keyboard.js';
import { createLevelStore, type KeyLevel, type KeyLevels } from './keyLevels.js';
import { PianoKeyboard } from './PianoKeyboard.js';

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

describe('Keyboard: how long a held key has been held (issue 185)', () => {
  // The levels are moved from the clock, frame by frame, without React. The clock is faked, and
  // its frames fall every 16 ms from the moment it starts, so the note lengths below are
  // multiples of 16 ms and every checkpoint lands on a frame.
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'performance',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'setTimeout',
        'clearTimeout',
      ],
    });
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const C4 = { midi: 60, finger: 1, hand: 'R' } as const;
  const CS4 = { midi: 61, finger: 2, hand: 'R' } as const;
  const E4 = { midi: 64, finger: 3, hand: 'R' } as const;

  /** A level that starts now, a whole note of 4 beats rising over 1600 ms unless told otherwise. */
  const rising = (over: Partial<KeyLevel> = {}): KeyLevel => ({
    atMs: performance.now(),
    lengthMs: 1600,
    beats: 4,
    upMs: null,
    fromLevel: 0,
    drainMs: 0,
    ...over,
  });
  const keyboard = (levels: KeyLevels, rest: Partial<KeyboardProps> = {}) => (
    <Keyboard lowMidi={48} highMidi={71} pressed={[]} levels={levels} {...rest} />
  );
  const frames = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  const levelOf = (c: Element, midi: number) =>
    c.querySelector(`g.key[data-midi="${midi}"] rect.key-level`)!;
  const box = (el: Element) => ['x', 'y', 'width', 'height'].map((a) => Number(el.getAttribute(a)));
  const expectBox = (el: Element, want: number[]) => {
    box(el).forEach((v, i) => expect(v, ['x', 'y', 'width', 'height'][i]).toBeCloseTo(want[i]!, 6));
  };
  /** The rect of the clip path a copy is clipped by. */
  const clipOf = (c: Element, copy: Element) => {
    const id = /^url\(#(.+)\)$/.exec(copy.getAttribute('clip-path') ?? '')?.[1];
    expect(id, 'the copy names its clip path').toBeTruthy();
    const clip = c.querySelector(`[id="${id}"]`)!;
    expect(clip.localName).toBe('clipPath');
    return clip.querySelector('rect')!;
  };
  const after = (a: Node, z: Node) =>
    !!(a.compareDocumentPosition(z) & Node.DOCUMENT_POSITION_FOLLOWING);
  /** A white key's level at a quarter: the bar's 5, and a quarter of the 89 more it grows by. */
  const quarter = 5 + 89 * 0.25;

  it('draws a level in each key that has one, rising with its note, on the bar’s own x and width', () => {
    const { container } = render(
      keyboard(
        new Map([
          [60, rising()],
          [61, rising()],
        ]),
        { pressed: [C4, CS4] },
      ),
    );
    // The first paint is before any time has passed: no height yet.
    expect(Number(levelOf(container, 60).getAttribute('height'))).toBe(0);
    frames(800); // halfway
    // C4 is white: the bar is x 171 (the key's 168 and 3), y 92, 18 wide, 5 high; the level grows
    // from the bar's bottom (97) to 3 below the key's top. C#4 is black: x 187, y 56, 10 by 4,
    // up to 2 below the top.
    const c4 = levelOf(container, 60);
    const cs4 = levelOf(container, 61);
    expectBox(c4, [171, 47.5, 18, 49.5]);
    expectBox(cs4, [187, 29, 10, 31]);
    expect(c4.getAttribute('rx')).toBe('1');
    expect(cs4.getAttribute('rx')).toBe('1');
    expect(c4).toHaveAttribute('aria-hidden', 'true');
    expect(c4).not.toHaveClass('is-on-black');
    expect(cs4).not.toHaveClass('is-on-black'); // pressed: the key is gray, not black
    // In the key's group: after the key's rectangle, before its number, ignoring the pointer.
    const group = c4.closest('g.key')!;
    expect([...group.children].map((c) => c.localName + (c.getAttribute('class') ?? ''))).toEqual([
      'rect',
      'rectkey-level',
      'text',
      'textkey-on-level',
      'clipPath',
    ]);
  });

  it('draws the finger number again over the level, after the original and clipped to the level', () => {
    const { container } = render(
      keyboard(
        new Map([
          [60, rising()],
          [61, rising()],
        ]),
        { pressed: [C4, CS4] },
      ),
    );
    frames(800);
    for (const [midi, finger, level] of [
      [60, '1', [171, 47.5, 18, 49.5]],
      [61, '2', [187, 29, 10, 31]],
    ] as const) {
      const group = container.querySelector(`g.key[data-midi="${midi}"]`)!;
      const texts = group.querySelectorAll('text');
      expect(texts).toHaveLength(2);
      const [digit, copy] = [texts[0]!, texts[1]!];
      expect(group.querySelector('text')).toBe(digit); // the original stays the first
      expect(digit).toHaveTextContent(finger);
      expect(digit).not.toHaveClass('key-on-level');
      expect(copy).toHaveClass('key-on-level');
      expect(copy).toHaveTextContent(finger);
      for (const a of ['x', 'y']) expect(copy.getAttribute(a), a).toBe(digit.getAttribute(a));
      expect(copy.getAttribute('text-anchor')).toBe('middle');
      expect(copy).toHaveAttribute('aria-hidden', 'true');
      expectBox(clipOf(container, copy), [...level]);
    }
  });

  it('draws the hand letter again over the level, in the letters’ layer, clipped as the pressed key shows it', () => {
    const { container } = render(
      keyboard(
        new Map([
          [60, rising()],
          [61, rising()],
        ]),
        { pressed: [C4, CS4, E4], handLetters: true },
      ),
    );
    frames(800);
    const marks = [...container.querySelectorAll('.key-hand')];
    expect(marks).toHaveLength(3); // the copies do not count as letters
    const copies = [...container.querySelectorAll('text.key-hand-on-level')];
    expect(copies).toHaveLength(2); // E4 has no level
    for (const copy of copies) {
      expect(after(marks[marks.length - 1]!, copy)).toBe(true);
      expect(copy).toHaveAttribute('aria-hidden', 'true');
      expect(copy.closest('g.key')).toBeNull(); // not in a key's group: the letters are not scaled
      expect(copy).not.toHaveClass('key-hand');
    }
    const [c4, cs4] = copies;
    const mark = (midi: number) => container.querySelector(`.key-hand[data-for-midi="${midi}"]`)!;
    for (const [copy, midi] of [
      [c4!, 60],
      [cs4!, 61],
    ] as const) {
      expect(copy).toHaveTextContent('R');
      for (const a of ['x', 'y']) {
        expect(copy.getAttribute(a), a).toBe(mark(midi).getAttribute(a));
      }
    }
    expect(c4).not.toHaveClass('is-on-black');
    expect(cs4).toHaveClass('is-on-black');
    // The letters are not scaled with the key's travel, so the clip is the level's rectangle as the
    // pressed key shows it: y and height times the travel (white 0.976, black 0.96).
    expectBox(clipOf(container, c4!), [171, 47.5 * 0.976, 18, 49.5 * 0.976]);
    expectBox(clipOf(container, cs4!), [187, 29 * 0.96, 10, 31 * 0.96]);
  });

  it('exports a key travel that matches the scale base.css gives a pressed key', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/design/base.css'), 'utf8');
    const scaleOf = (selector: string) => {
      const at = css.indexOf(`${selector} {`);
      expect(at, selector).toBeGreaterThanOrEqual(0);
      const body = css.slice(at, css.indexOf('}', at));
      return Number(/scaleY\(([\d.]+)\)/.exec(body)![1]);
    };
    expect(scaleOf('.keyboard-svg .key.is-pressed')).toBe(KEY_TRAVEL.white);
    expect(scaleOf('.keyboard-svg .key.is-black.is-pressed')).toBe(KEY_TRAVEL.black);
  });

  it('draws no level for a held key with no entry (a wrong note): the bar alone, and no loop', () => {
    const { container } = render(keyboard(new Map(), { pressed: [C4], held: [60, 62] }));
    expect(container.querySelectorAll('rect.key-level, .key-on-level, clipPath')).toHaveLength(0);
    expect(container.querySelectorAll('rect.key-held')).toHaveLength(2);
    expect(container.querySelectorAll('g.key[data-midi="60"] text')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('draws no level on a dimmed key, even with an entry; its bar is as before', () => {
    const { container } = render(
      keyboard(new Map([[60, rising()]]), {
        muted: [{ midi: 60, finger: 1, hand: 'L' }],
        held: [60],
        handLetters: true,
      }),
    );
    frames(800);
    expect(container.querySelector('g.key[data-midi="60"]')).toHaveClass('is-muted');
    expect(
      container.querySelectorAll('rect.key-level, .key-on-level, .key-hand-on-level, clipPath'),
    ).toHaveLength(0);
    expect(container.querySelectorAll('rect.key-held.is-dimmed[data-for-midi="60"]')).toHaveLength(
      1,
    );
    expect(vi.getTimerCount()).toBe(0); // nothing drawn, nothing to move
  });

  it('marks the level of a key that shows no state like its bar, and draws no number over it', () => {
    const { container } = render(
      keyboard(
        new Map([
          [60, rising()],
          [61, rising()],
          [63, rising()],
        ]),
        { pressed: [{ midi: 63, finger: 2, hand: 'R' }], held: [60, 61] },
      ),
    );
    frames(800);
    // An unpressed black key is black: the level takes the bar's own gray, and it has no number.
    expect(levelOf(container, 61)).toHaveClass('is-on-black');
    expect(container.querySelector('g.key[data-midi="61"] text')).toBeNull();
    expect(container.querySelector('g.key[data-midi="61"] .key-on-level')).toBeNull();
    // An unpressed white key is white: the level has no mark, and no number either.
    expect(levelOf(container, 60)).not.toHaveClass('is-on-black');
    expect(container.querySelector('g.key[data-midi="60"] text')).toBeNull();
    // A pressed black key is gray: no mark, and its number is drawn again.
    expect(levelOf(container, 63)).not.toHaveClass('is-on-black');
    expect(container.querySelectorAll('g.key[data-midi="63"] text')).toHaveLength(2);
    // The bar lies over the level, as it lies over the key.
    const bar = container.querySelector('g.key[data-midi="60"] rect.key-held')!;
    expect(after(levelOf(container, 60), bar)).toBe(true);
  });

  it('draws a pressed key’s level without a number copy when the key has no finger', () => {
    const { container } = render(
      keyboard(new Map([[60, rising()]]), { pressed: [{ midi: 60, finger: null, hand: 'R' }] }),
    );
    expect(levelOf(container, 60)).not.toBeNull();
    expect(container.querySelector('g.key[data-midi="60"] text')).toBeNull();
  });

  it('rises over the note, is full at its end and stays full while held, and then the loop stops', () => {
    const { container } = render(keyboard(new Map([[60, rising()]]), { pressed: [C4] }));
    const c4 = levelOf(container, 60);
    frames(400);
    expectBox(c4, [171, 97 - quarter, 18, quarter]);
    frames(400);
    expectBox(c4, [171, 47.5, 18, 49.5]);
    frames(800); // the note's length
    expectBox(c4, [171, 3, 18, 94]);
    expect(vi.getTimerCount()).toBe(0); // no frame is waiting
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    frames(5000);
    expect(raf).not.toHaveBeenCalled();
    expectBox(c4, [171, 3, 18, 94]);
  });

  it('draws a full black key’s level 2 below its top', () => {
    const { container } = render(keyboard(new Map([[61, rising({ lengthMs: 160, beats: 1 })]])));
    frames(160);
    expectBox(levelOf(container, 61), [187, 2, 10, 58]);
  });

  it('drains from the level reached to nothing over drainMs, then the loop stops', () => {
    const t0 = performance.now();
    const { container } = render(
      keyboard(
        new Map([[60, rising({ atMs: t0 - 800, upMs: t0, fromLevel: 0.5, drainMs: 192 })]]),
        { pressed: [C4] },
      ),
    );
    const c4 = levelOf(container, 60);
    expectBox(c4, [171, 47.5, 18, 49.5]);
    frames(96); // half the drain
    expectBox(c4, [171, 97 - quarter, 18, quarter]);
    frames(96);
    expect(Number(c4.getAttribute('height'))).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('under reduced motion rises a beat at a time: nothing in the first beat, then quarters', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    // A whole note of 4 beats of 800 ms.
    const { container } = render(
      keyboard(new Map([[60, rising({ lengthMs: 3200 })]]), { pressed: [C4] }),
    );
    const height = () => Number(levelOf(container, 60).getAttribute('height'));
    const at = (level: number) => (level === 0 ? 0 : 5 + 89 * level);
    frames(784);
    expect(height()).toBe(0);
    frames(16); // 800: the first beat is over
    expect(height()).toBeCloseTo(at(0.25), 6);
    frames(784); // 1584
    expect(height()).toBeCloseTo(at(0.25), 6);
    frames(16);
    expect(height()).toBeCloseTo(at(0.5), 6);
    frames(800);
    expect(height()).toBeCloseTo(at(0.75), 6);
    frames(800);
    expect(height()).toBeCloseTo(94, 6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('under reduced motion shows a one-beat note as nothing, then full at its end', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const { container } = render(
      keyboard(new Map([[60, rising({ lengthMs: 800, beats: 1 })]]), { pressed: [C4] }),
    );
    frames(784);
    expect(Number(levelOf(container, 60).getAttribute('height'))).toBe(0);
    frames(16);
    expect(Number(levelOf(container, 60).getAttribute('height'))).toBeCloseTo(94, 6);
  });

  it('runs one loop, renders nothing per frame, and looks the elements up once per change of levels', () => {
    const renders = vi.fn();
    const levels = new Map([[60, rising()]]);
    const tree = (map: KeyLevels) => (
      <Profiler id="keyboard" onRender={renders}>
        {keyboard(map, { pressed: [C4] })}
      </Profiler>
    );
    const { container, rerender } = render(tree(levels));
    expect(vi.getTimerCount()).toBe(1); // the loop's next frame
    const lookup = vi.spyOn(container.querySelector('svg')!, 'querySelectorAll');
    renders.mockClear();
    frames(480);
    expect(renders).not.toHaveBeenCalled(); // no React state moves per frame
    expect(lookup).not.toHaveBeenCalled(); // and no element is looked up per frame
    // The store hands out a new map: one lookup, and still one loop, not two.
    rerender(tree(new Map(levels)));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    frames(480);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('looks the elements up again when one appears without the levels changing', () => {
    // A full level: the loop has stopped. Then the key is struck at the cursor and the hands come
    // close, so its number, its letter and their clips appear while the map stays the same one.
    const full = new Map([[61, rising({ lengthMs: 160, beats: 1 })]]);
    const { container, rerender } = render(keyboard(full));
    frames(400);
    expect(vi.getTimerCount()).toBe(0);
    rerender(keyboard(full, { pressed: [CS4], handLetters: true }));
    const copy = container.querySelector('g.key[data-midi="61"] text.key-on-level')!;
    expectBox(clipOf(container, copy), [187, 2, 10, 58]);
    const letter = container.querySelector('text.key-hand-on-level')!;
    expectBox(clipOf(container, letter), [187, 2 * 0.96, 10, 58 * 0.96]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives every keyboard its own clip path ids', () => {
    const levels = new Map([[60, rising()]]);
    const { container } = render(
      <>
        {keyboard(levels, { pressed: [C4], handLetters: true })}
        {keyboard(levels, { pressed: [C4], handLetters: true })}
      </>,
    );
    const ids = [...container.querySelectorAll('clipPath')].map((c) => c.id);
    expect(ids).toHaveLength(4); // a number's and a letter's, twice
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('takes the level and its copies away with the entry, and moves nothing when no key is drawn', () => {
    const levels = new Map([[60, rising()]]);
    const { container, rerender } = render(keyboard(levels, { pressed: [C4], handLetters: true }));
    expect(container.querySelectorAll('rect.key-level')).toHaveLength(1);
    rerender(keyboard(new Map(), { pressed: [C4], handLetters: true }));
    expect(
      container.querySelectorAll('rect.key-level, .key-on-level, .key-hand-on-level, clipPath'),
    ).toHaveLength(0);
    expect(container.querySelectorAll('.key-hand')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    // A pitch outside the drawn range is not drawn, and keeps no loop running.
    rerender(keyboard(new Map([[30, rising()]]), { pressed: [C4] }));
    expect(container.querySelectorAll('rect.key-level')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is never red', () => {
    const { container } = render(
      keyboard(
        new Map([
          [60, rising()],
          [61, rising()],
          [62, rising()],
        ]),
        { pressed: [C4, CS4], held: [60, 61, 62], handLetters: true },
      ),
    );
    frames(800);
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
    expect(container.querySelectorAll('[fill], [stroke]')).toHaveLength(0);
  });

  describe('PianoKeyboard', () => {
    it('draws the levels of the store it is given as they start and drain, and none without one', () => {
      const store = createLevelStore({ drainMs: () => 192, reduced: () => false });
      const props = { lowMidi: 48, highMidi: 71, pressed: [C4] };
      const { container, rerender } = render(<PianoKeyboard {...props} levels={store} />);
      expect(container.querySelectorAll('rect.key-level')).toHaveLength(0);
      act(() => store.start(60, { atMs: performance.now(), lengthMs: 1600, beats: 4 }));
      expect(container.querySelectorAll('rect.key-level')).toHaveLength(1);
      frames(800);
      expectBox(levelOf(container, 60), [171, 47.5, 18, 49.5]);
      act(() => store.release(60, performance.now())); // half full: it drains
      expect(container.querySelectorAll('rect.key-level')).toHaveLength(1);
      frames(192);
      expect(container.querySelectorAll('rect.key-level')).toHaveLength(0);
      act(() => store.start(62, { atMs: performance.now(), lengthMs: 1600, beats: 4 }));
      expect(container.querySelectorAll('rect.key-level')).toHaveLength(1);
      rerender(<PianoKeyboard {...props} />); // no store: no level, and no error
      expect(container.querySelectorAll('rect.key-level')).toHaveLength(0);
      store.dispose();
    });

    it('still draws the keys held on the piano', () => {
      const { container } = render(<PianoKeyboard lowMidi={48} highMidi={71} pressed={[]} />);
      expect(container.querySelectorAll('[data-midi]')).toHaveLength(24);
      expect(container.querySelectorAll('rect.key-level')).toHaveLength(0);
    });
  });
});

describe('Keyboard: the key goes down (issue 200)', () => {
  const C4 = { midi: 60, finger: 1, hand: 'R' } as const;
  const keyboard = (rest: Partial<KeyboardProps> = {}) => (
    <Keyboard lowMidi={48} highMidi={71} pressed={[]} {...rest} />
  );

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'performance',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'setTimeout',
        'clearTimeout',
      ],
    });
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('goes down further for a key held on the piano than the cue alone does', () => {
    const { container } = render(keyboard({ pressed: [C4], held: [60, 62, 61] }));
    const key = (midi: number) => container.querySelector(`g.key[data-midi="${midi}"]`)!;
    expect(key(60)).toHaveClass('is-pressed', 'is-down'); // cued and held
    expect(key(62)).toHaveClass('is-down'); // a wrong key goes down too
    expect(key(62)).not.toHaveClass('is-pressed');
    expect(key(61)).toHaveClass('is-down', 'is-black');
    expect(key(64)).not.toHaveClass('is-down'); // not held
    cleanup();
    const cued = render(keyboard({ pressed: [C4] }));
    expect(cued.container.querySelector('g.key.is-down')).toBeNull(); // the cue alone
  });

  it('draws a dimmed key held on the piano as it was: its bar beside it, and no travel', () => {
    const { container } = render(
      keyboard({ muted: [{ midi: 62, finger: 2, hand: 'L' }], held: [62] }),
    );
    expect(container.querySelector('g.key[data-midi="62"]')).not.toHaveClass('is-down');
    expect(container.querySelector('rect.key-held.is-dimmed[data-for-midi="62"]')).not.toBeNull();
  });

  it('gives each key its own lift time: a later release does not extend an earlier key', () => {
    const { container, rerender } = render(keyboard({ pressed: [C4], held: [60, 62] }));
    const key = (m: number) => container.querySelector(`g.key[data-midi="${m}"]`)!;
    rerender(keyboard({ pressed: [C4], held: [62] })); // 60 up at t = 0
    act(() => {
      vi.advanceTimersByTime(150);
    });
    rerender(keyboard({ pressed: [C4], held: [] })); // 62 up at t = 150
    expect(key(60)).toHaveClass('is-lifting');
    act(() => {
      vi.advanceTimersByTime(100); // t = 250: 60's 220 ms are over, 62's are not
    });
    expect(key(60)).not.toHaveClass('is-lifting');
    expect(key(62)).toHaveClass('is-lifting');
    act(() => {
      vi.advanceTimersByTime(130); // t = 380
    });
    expect(key(62)).not.toHaveClass('is-lifting');
  });

  it('lets a key come up at the damper time for a moment, and not a key held again', () => {
    const { container, rerender } = render(keyboard({ pressed: [C4], held: [60] }));
    const c4 = () => container.querySelector('g.key[data-midi="60"]')!;
    expect(c4()).not.toHaveClass('is-lifting');
    rerender(keyboard({ pressed: [C4], held: [] })); // let go: back to the cue's depth, slowly
    expect(c4()).toHaveClass('is-pressed');
    expect(c4()).not.toHaveClass('is-down');
    expect(c4()).toHaveClass('is-lifting');
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(c4()).not.toHaveClass('is-lifting');
    // Let go and pressed again before the class is gone: held again, it is not lifting.
    rerender(keyboard({ pressed: [C4], held: [60] }));
    rerender(keyboard({ pressed: [C4], held: [] }));
    expect(c4()).toHaveClass('is-lifting');
    rerender(keyboard({ pressed: [C4], held: [60] }));
    expect(c4()).not.toHaveClass('is-lifting');
    expect(c4()).toHaveClass('is-down');
  });

  it('presses a key cued while it is still rising in the quick press time, not the damper time', () => {
    const { container, rerender } = render(keyboard({ held: [60] }));
    const c4 = () => container.querySelector('g.key[data-midi="60"]')!;
    rerender(keyboard({ held: [] })); // let go, nothing cued: rising to rest
    expect(c4()).toHaveClass('is-lifting');
    expect(c4()).not.toHaveClass('is-pressed');
    rerender(keyboard({ pressed: [C4], held: [] })); // the cue arrives meanwhile
    expect(c4()).toHaveClass('is-pressed');
    expect(c4()).not.toHaveClass('is-lifting');
    // A key cued when it came up keeps rising slowly to the cue's depth.
    rerender(keyboard({ pressed: [C4], held: [60] }));
    rerender(keyboard({ pressed: [C4], held: [] }));
    expect(c4()).toHaveClass('is-lifting');
    rerender(keyboard({ pressed: [C4], held: [] }));
    expect(c4()).toHaveClass('is-lifting');
  });

  it('does not mark a key that was never held as lifting', () => {
    const { container, rerender } = render(keyboard({ pressed: [C4] }));
    rerender(keyboard({ pressed: [C4], held: [62] }));
    rerender(keyboard({ pressed: [C4], held: [] }));
    expect(container.querySelector('g.key[data-midi="60"]')).not.toHaveClass('is-lifting');
  });

  it('exports the held travel that base.css gives a key held on the piano', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/design/base.css'), 'utf8');
    const scaleOf = (selector: string) => {
      const at = css.indexOf(`${selector} {`);
      expect(at, selector).toBeGreaterThanOrEqual(0);
      const body = css.slice(at, css.indexOf('}', at));
      return Number(/scaleY\(([\d.]+)\)/.exec(body)![1]);
    };
    expect(scaleOf('.keyboard-svg .key.is-down')).toBe(KEY_TRAVEL.held.white);
    expect(scaleOf('.keyboard-svg .key.is-black.is-down')).toBe(KEY_TRAVEL.held.black);
    // Deeper than the cue's, and a black key deeper than a white one.
    expect(KEY_TRAVEL.held.white).toBeLessThan(KEY_TRAVEL.white);
    expect(KEY_TRAVEL.held.black).toBeLessThan(KEY_TRAVEL.black);
    expect(KEY_TRAVEL.held.black).toBeLessThan(KEY_TRAVEL.held.white);
  });

  it('clips the letter over the level by the travel the held key has', () => {
    const level: KeyLevel = {
      atMs: performance.now(),
      lengthMs: 1600,
      beats: 4,
      upMs: null,
      fromLevel: 0,
      drainMs: 0,
    };
    const levels = new Map([[60, level]]);
    const { container, rerender } = render(
      keyboard({ pressed: [C4], handLetters: true, levels, held: [60] }),
    );
    act(() => {
      vi.advanceTimersByTime(800);
    });
    const clip = () => container.querySelector('clipPath rect[data-hand-clip-for="60"]')!;
    const num = (a: string) => Number(clip().getAttribute(a));
    // Half full: the level is 49.5 high, from 47.5; the held key shortens to 0.94.
    expect(num('y')).toBeCloseTo(47.5 * KEY_TRAVEL.held.white, 6);
    expect(num('height')).toBeCloseTo(49.5 * KEY_TRAVEL.held.white, 6);
    // Let go: the key rises, and the clip keeps the held travel for as long as it does, so it
    // does not jump at the release; then it is the cue's depth.
    rerender(keyboard({ pressed: [C4], handLetters: true, levels, held: [] }));
    expect(num('y')).toBeCloseTo(47.5 * KEY_TRAVEL.held.white, 6);
    expect(num('height')).toBeCloseTo(49.5 * KEY_TRAVEL.held.white, 6);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    const high = 5 + 89 * (1050 / 1600);
    expect(num('y')).toBeCloseTo((97 - high) * KEY_TRAVEL.white, 6);
    expect(num('height')).toBeCloseTo(high * KEY_TRAVEL.white, 6);
  });
});
