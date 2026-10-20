/**
 * A key pressed on the on-screen keyboard with the pointer (issue #96): the key goes down while
 * the pointer is on it, and sounds (`strike`) until the pointer lifts or `holdMs` passes, the
 * longer a note is worth holding with a mouse. One key at a time: a second pointer, or a drag
 * onto another key, does not strike. The pointer is captured on the key's SVG, so the release
 * is seen wherever the pointer went; a touch that turns into a scroll of the keyboard cancels
 * the press. A click on a key is handled here (`preventDefault`), so no notes rise from it
 * (NoteBurst.tsx).
 *
 * The keys are a pointer affordance only, not focusable buttons: at 22 px a key is below the
 * 44 px target size, and the piece's own notes sound through Play (docs/app.md, Cursor and
 * keyboard).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type MouseEvent,
} from 'react';

export interface KeyPressOptions {
  /**
   * Sounds the key `midi`, drawn by `el`; returns the release, called when the key lifts.
   * Nothing when undefined (no instrument: a keyboard drawn without a score).
   */
  strike?: (midi: number, el: Element) => (() => void) | void;
  /** How long a key stays down at most, in milliseconds. */
  holdMs: number;
}

export interface KeyPressHandlers {
  onPointerDown: (e: PointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: PointerEvent<SVGSVGElement>) => void;
  onPointerCancel: (e: PointerEvent<SVGSVGElement>) => void;
  onLostPointerCapture: (e: PointerEvent<SVGSVGElement>) => void;
  onClick: (e: MouseEvent<SVGSVGElement>) => void;
}

/** The key under an event target, with its pitch, or null off the keys. */
function keyAt(target: EventTarget | null): { midi: number; el: Element } | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('g.key');
  const midi = Number(el?.getAttribute('data-midi'));
  return el && Number.isInteger(midi) ? { midi, el } : null;
}

/** The key the pointer holds down (its pitch), and the handlers for the keyboard's SVG. */
export function useKeyPress({ strike, holdMs }: KeyPressOptions): {
  down: number | null;
  handlers: KeyPressHandlers;
} {
  const [down, setDown] = useState<number | null>(null);
  /** The press under way: its pointer, its release, and the timer that ends a long hold. */
  const pressRef = useRef<{
    pointerId: number;
    release: (() => void) | void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  /** A press was made: the click that follows it is this key's, wherever it lands. */
  const clickRef = useRef(false);
  const strikeRef = useRef(strike);
  useEffect(() => {
    strikeRef.current = strike;
  }, [strike]);

  const lift = useCallback(() => {
    const press = pressRef.current;
    if (!press) return;
    pressRef.current = null;
    clearTimeout(press.timer);
    press.release?.();
    setDown(null);
  }, []);

  // Unmount with a key down: the note stops.
  useEffect(() => lift, [lift]);

  const onPointerDown = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      if (pressRef.current || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const key = keyAt(e.target);
      if (!key) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // A pointer already gone (a test's synthetic event): the lift still comes through the
        // pointerup on the SVG.
      }
      clickRef.current = true;
      pressRef.current = {
        pointerId: e.pointerId,
        release: strikeRef.current?.(key.midi, key.el),
        timer: setTimeout(lift, holdMs),
      };
      setDown(key.midi);
    },
    [holdMs, lift],
  );

  const onPointerEnd = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      if (pressRef.current?.pointerId === e.pointerId) lift();
    },
    [lift],
  );

  // Handled: no notes rise from a click on a key (NoteBurst.tsx, `isEmptyClick`). With the
  // pointer captured, the click lands on the SVG itself (the common ancestor of the press and
  // the release), so the press is remembered rather than the target read.
  const onClick = useCallback((e: MouseEvent<SVGSVGElement>) => {
    if (clickRef.current || keyAt(e.target)) e.preventDefault();
    clickRef.current = false;
  }, []);

  return {
    down,
    handlers: {
      onPointerDown,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onLostPointerCapture: onPointerEnd,
      onClick,
    },
  };
}
