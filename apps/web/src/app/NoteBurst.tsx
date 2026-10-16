import { useEffect, useState, type CSSProperties, type JSX } from 'react';
import { prefersReducedMotion } from '../design/motion.js';

/**
 * Anything a click already means something on. A click there never adds notes: they would only
 * distract from what the click does.
 */
export const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="slider"]',
  '[role="tab"]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');

/** The parts of a click that decide whether it lets the notes rise. */
export type BurstClick = Pick<
  MouseEvent,
  | 'button'
  | 'detail'
  | 'altKey'
  | 'ctrlKey'
  | 'metaKey'
  | 'shiftKey'
  | 'defaultPrevented'
  | 'target'
  | 'clientX'
  | 'clientY'
>;

/** Where the pointer went down for this click, and whether text was selected at that moment. */
export interface Press {
  x: number;
  y: number;
  selected: boolean;
}

/** A pointer that travels farther than this between going down and coming up is dragging. */
export const DRAG_PX = 4;

/**
 * Whether a click is on nothing in particular: the primary button, no modifier, not handled
 * already, not on or inside anything interactive (INTERACTIVE_SELECTOR), and nothing to do with
 * selecting text: not the end of a drag (`press` farther than DRAG_PX from the click), not the end
 * of a selection, not a click that clears one (text was selected when the pointer went down), and
 * not the third click of a triple-click, which selects a paragraph.
 */
export function isEmptyClick(
  e: BurstClick,
  selection: Selection | null,
  press: Press | null = null,
): boolean {
  if (e.button !== 0 || e.defaultPrevented || e.detail >= 3) return false;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  if (!(e.target instanceof Element) || e.target.closest(INTERACTIVE_SELECTOR) !== null)
    return false;
  if (press !== null) {
    if (press.selected) return false;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX) return false;
  }
  return selection === null || selection.isCollapsed;
}

export type NoteKind = 'quarter' | 'eighth' | 'sixteenth' | 'pair';
/** Quarters and eighths most often, a sixteenth or a beamed pair now and then. */
const KINDS: readonly NoteKind[] = [
  'quarter',
  'quarter',
  'quarter',
  'eighth',
  'eighth',
  'eighth',
  'sixteenth',
  'pair',
  'pair',
];

/** One note of a burst: where it comes to rest from the click, and when. */
export interface BurstNote {
  kind: NoteKind;
  /** Its resting place from the click, in px (dy is negative: the notes rise). */
  dx: number;
  dy: number;
  /** Its tilt at rest, in degrees, outward; its size at rest. */
  rotate: number;
  scale: number;
  /** A sideways drift on a second easing, in px, so the path curves. */
  drift: number;
  /** Its length and its wait, as fractions of --dur-flourish. */
  time: number;
  wait: number;
  /** The one note of a double-click's burst drawn in the accent. */
  accent: boolean;
}

/**
 * One burst, drawn fresh so no two look alike: 2 to 4 notes in a fan of random direction and
 * width, each 22 to 50 px out, tilted outward, its own size, length and sideways drift. They rise
 * like a quick run, up or down, or now and then together like a chord. A double-click's burst
 * (`double`) has half as many notes again, 3 to 6, a little wider and farther out, and one of them,
 * picked at random, in the accent. `random` is Math.random but for tests.
 */
export function drawBurst(random: () => number = Math.random, double = false): BurstNote[] {
  const between = (a: number, b: number) => a + random() * (b - a);
  const pick = <T,>(xs: readonly T[]): T =>
    xs[Math.min(xs.length - 1, Math.floor(random() * xs.length))]!;
  const count = pick(double ? [3, 5, 5, 5, 6] : [2, 3, 3, 3, 4]);
  const chord = random() < 0.15;
  const fanCenter = between(-25, 25);
  const fanWidth = between(50, 110) * (double ? 1.2 : 1);
  const upward = random() < 0.5;
  /** Between two notes of the run, as a fraction of --dur-flourish (28 to 55 ms of 520). */
  const step = chord ? between(0, 0.02) : between(0.054, 0.106);
  const accent = double ? Math.min(count - 1, Math.floor(random() * count)) : -1;
  const notes: BurstNote[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    // Never past 85 degrees from straight up: every note rises.
    const degrees = Math.max(-85, Math.min(85, fanCenter + (t - 0.5) * fanWidth + between(-8, 8)));
    const angle = (degrees * Math.PI) / 180;
    const dist = between(22, 50) * (chord ? 0.85 : 1) * (double ? 1.15 : 1);
    const dx = Math.round(Math.sin(angle) * dist);
    const order = upward ? i : count - 1 - i;
    notes.push({
      kind: pick(KINDS),
      dx,
      dy: Math.round(-Math.cos(angle) * dist - between(0, 6)),
      rotate: Math.round((dx < 0 ? -1 : 1) * between(3, 18)),
      scale: Math.round(between(0.78, 1.12) * 100) / 100,
      drift: Math.round(between(-9, 9)),
      time: Math.round(between(0.81, 1.25) * 100) / 100,
      wait: Math.round((order * step + between(0, 0.023)) * 1000) / 1000,
      accent: i === accent,
    });
  }
  return notes;
}

interface Burst {
  x: number;
  y: number;
  /** Counts the slot's bursts: a new count mounts new notes, so their animation starts over. */
  gen: number;
  notes: BurstNote[];
}

/** Bursts on screen at once at most; one more reuses the oldest slot. */
const SLOTS = 6;
/** Clicks closer together than this add no burst. */
const MIN_GAP_MS = 90;

/** A note in ink, 25 by 28 px, drawn like the score's: a tilted head, a stem, flags or a beam. */
function Glyph({ kind }: { kind: NoteKind }): JSX.Element {
  return (
    <svg viewBox="0 -2 18 20" width="25" height="28" aria-hidden="true" focusable="false">
      <ellipse cx="4" cy="14" rx="3.6" ry="2.5" transform="rotate(-20 4 14)" />
      <rect x="6.6" y="1" width="1.2" height="13" />
      {(kind === 'eighth' || kind === 'sixteenth') && (
        <path d="M7.8 1c0 3 4.2 4 3.4 8.6c-.3-3-2-4.3-3.4-4.7z" />
      )}
      {kind === 'sixteenth' && <path d="M7.8 5c0 3 4.2 4 3.4 8.6c-.3-3-2-4.3-3.4-4.7z" />}
      {kind === 'pair' && (
        <>
          <ellipse cx="13" cy="12" rx="3.6" ry="2.5" transform="rotate(-20 13 12)" />
          <rect x="15.6" y="-1" width="1.2" height="13" />
          <polygon points="6.6,1 16.8,-1 16.8,1.4 6.6,3.4" />
        </>
      )}
    </svg>
  );
}

/** A note's resting values, inline: the keyframes animate from the click to them. */
function noteStyle(n: BurstNote): CSSProperties {
  return {
    translate: `${n.dx}px ${n.dy}px`,
    rotate: `${n.rotate}deg`,
    scale: String(n.scale),
    '--note-time': String(n.time),
    '--note-wait': String(n.wait),
  } as CSSProperties;
}

/**
 * An easter egg (motion study 10): a click on nothing in particular lets a few small notes rise
 * from the pointer, in ink, gone in about half a second, and no two bursts alike (`drawBurst`).
 * A double-click lets half as many notes again rise, one of them in the accent: the one deliberate
 * exception to the rule of one red element, for half a second (docs/app.md). Nothing where a click
 * already does something or where text is being selected or deselected (`isEmptyClick`), and
 * nothing under prefers-reduced-motion. Transform
 * and opacity only, on a fixed layer the pointer passes through, hidden from assistive technology
 * and from print, at most SLOTS bursts at once.
 */
export function NoteBurst(): JSX.Element {
  const [bursts, setBursts] = useState<(Burst | null)[]>([]);

  useEffect(() => {
    let next = 0;
    let last = -Infinity;
    let press: Press | null = null;
    // Before the browser acts on the press (and clears any selection), remember where it was and
    // whether text was selected: a click that only clears a selection lets no notes rise.
    const onDown = (e: MouseEvent) => {
      const selection = window.getSelection();
      press = {
        x: e.clientX,
        y: e.clientY,
        selected: selection !== null && !selection.isCollapsed,
      };
    };
    const onClick = (e: MouseEvent) => {
      if (!isEmptyClick(e, window.getSelection(), press) || prefersReducedMotion()) return;
      // The second click of a double-click lets the bigger burst rise; it needs no gap.
      const double = e.detail === 2;
      if (!double && e.timeStamp - last < MIN_GAP_MS) return;
      last = e.timeStamp;
      const slot = next;
      next = (next + 1) % SLOTS;
      const notes = drawBurst(Math.random, double);
      setBursts((prev) => {
        const out = prev.slice();
        out[slot] = { x: e.clientX, y: e.clientY, gen: (prev[slot]?.gen ?? 0) + 1, notes };
        return out;
      });
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('click', onClick);
    };
  }, []);

  return (
    <div className="note-burst-layer no-print" aria-hidden="true">
      {bursts.map(
        (b, i) =>
          b && (
            <span key={`${i}-${b.gen}`} className="note-burst" style={{ left: b.x, top: b.y }}>
              {b.notes.map((n, j) => (
                <span
                  key={j}
                  className={n.accent ? 'note-burst-note is-red' : 'note-burst-note'}
                  style={noteStyle(n)}
                >
                  <span className="note-burst-drift" style={{ translate: `${n.drift}px 0px` }}>
                    <Glyph kind={n.kind} />
                  </span>
                </span>
              ))}
            </span>
          ),
      )}
    </div>
  );
}
