/**
 * The score as a timeline (T13): a click or tap anywhere in a bar goes there. The pages carry no
 * control for it; the bar under a mouse pointer takes a light tint (and the pointer cursor), and
 * the bar a seek lands on leaves a faint footprint that fades, so a tap on a phone, where nothing
 * hovers, is answered on the spot and a step with the arrow keys shows which bar it reached.
 * Both are drawn in ink at low opacity over the music, never in the accent.
 *
 * A click counts only when it is a plain one (`isEmptyClick`: the primary button, no modifier, no
 * drag, no text selection made or cleared) and lands in a bar `canSeek` allows (inside the loop
 * when one is set). It is then handled here, so the note burst (NoteBurst.tsx) stays for clicks on
 * nothing. Where the bars are drawn (`barBoxes`) is read once per layout, at the first pointer
 * that needs it, never per pointer move.
 */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
  type Ref,
} from 'react';
import { isEmptyClick, type Press } from '../app/NoteBurst.js';
import { barAt, barBoxes, type BarBox } from './bars.js';

/** How far a bar's box reaches above and below its staves, in staff heights (the digits). */
const BAR_PAD = 0.75;

export interface BarSeekHandle {
  /** Leaves the footprint on bar `bar` (a seek by key, which no pointer showed). */
  footprint(bar: number): void;
}

export interface BarSeekProps {
  /** The score sheet's host, where the bars are drawn. */
  host: Element | null;
  /** Changes whenever the bars move: new pages, a new width. */
  layoutKey: unknown;
  /** Whether a click on bar `bar` (0-based) seeks: false while nothing can play, outside a loop. */
  canSeek: (bar: number) => boolean;
  onSeek: (bar: number) => void;
  handle?: Ref<BarSeekHandle>;
  children: ReactNode;
}

function boxStyle(b: BarBox): CSSProperties {
  return { left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top };
}

export function BarSeek({
  host,
  layoutKey,
  canSeek,
  onSeek,
  handle,
  children,
}: BarSeekProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const boxesRef = useRef<BarBox[] | null>(null);
  const pressRef = useRef<Press | null>(null);
  const [hover, setHover] = useState<BarBox | null>(null);
  const [print, setPrint] = useState<{ box: BarBox; key: number } | null>(null);

  // New pages or a new width: the bars are measured again when next needed.
  useEffect(() => {
    boxesRef.current = null;
    setHover(null);
    setPrint(null);
  }, [host, layoutKey]);

  const boxes = useCallback((): BarBox[] => {
    if (!host) return [];
    boxesRef.current ??= barBoxes(host, BAR_PAD);
    return boxesRef.current;
  }, [host]);

  /** The bar under a pointer at viewport (x, y), when a seek may go there. */
  const seekableAt = useCallback(
    (x: number, y: number): BarBox | null => {
      const stage = stageRef.current;
      if (!stage) return null;
      const origin = stage.getBoundingClientRect();
      const b = barAt(boxes(), x - origin.left, y - origin.top);
      return b && canSeek(b.bar) ? b : null;
    },
    [boxes, canSeek],
  );

  const footprint = useCallback(
    (bar: number) => {
      const box = boxes().find((b) => b.bar === bar);
      if (box) setPrint((p) => ({ box, key: (p?.key ?? 0) + 1 }));
    },
    [boxes],
  );
  useImperativeHandle(handle, () => ({ footprint }), [footprint]);

  return (
    <div
      ref={stageRef}
      className={hover ? 'score-stage is-over-bar' : 'score-stage'}
      onPointerDown={(e) => {
        const selection = window.getSelection();
        pressRef.current = {
          x: e.clientX,
          y: e.clientY,
          selected: selection !== null && !selection.isCollapsed,
        };
      }}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return;
        const b = seekableAt(e.clientX, e.clientY);
        setHover((h) => (h?.bar === b?.bar ? h : b));
      }}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        const press = pressRef.current;
        pressRef.current = null;
        if (!isEmptyClick(e.nativeEvent, window.getSelection(), press)) return;
        const b = seekableAt(e.clientX, e.clientY);
        if (!b) return;
        e.preventDefault(); // handled: no note burst
        onSeek(b.bar);
        setPrint((p) => ({ box: b, key: (p?.key ?? 0) + 1 }));
      }}
    >
      {children}
      {hover && <div className="bar-tint no-print" aria-hidden="true" style={boxStyle(hover)} />}
      {print && (
        <div
          key={print.key}
          className="bar-footprint no-print"
          aria-hidden="true"
          style={boxStyle(print.box)}
          onAnimationEnd={() => setPrint((p) => (p?.key === print.key ? null : p))}
        />
      )}
    </div>
  );
}
