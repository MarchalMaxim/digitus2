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
  'button' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'defaultPrevented' | 'target'
>;

/**
 * Whether a click is on nothing in particular: the primary button, no modifier, not handled
 * already, not on or inside anything interactive (INTERACTIVE_SELECTOR), and not the end of a
 * text selection.
 */
export function isEmptyClick(e: BurstClick, selection: Selection | null): boolean {
  if (e.button !== 0 || e.defaultPrevented) return false;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  if (!(e.target instanceof Element) || e.target.closest(INTERACTIVE_SELECTOR) !== null)
    return false;
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
}

/**
 * One burst, drawn fresh so no two look alike: 2 to 4 notes in a fan of random direction and
 * width, each 18 to 42 px out, tilted outward, its own size, length and sideways drift. They rise
 * like a quick run, up or down, or now and then together like a chord. `random` is Math.random but
 * for tests.
 */
export function drawBurst(random: () => number = Math.random): BurstNote[] {
  const between = (a: number, b: number) => a + random() * (b - a);
  const pick = <T,>(xs: readonly T[]): T =>
    xs[Math.min(xs.length - 1, Math.floor(random() * xs.length))]!;
  const count = pick([2, 3, 3, 3, 4]);
  const chord = random() < 0.15;
  const fanCenter = between(-25, 25);
  const fanWidth = between(50, 110);
  const upward = random() < 0.5;
  /** Between two notes of the run, as a fraction of --dur-flourish (28 to 55 ms of 520). */
  const step = chord ? between(0, 0.02) : between(0.054, 0.106);
  const notes: BurstNote[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const angle = ((fanCenter + (t - 0.5) * fanWidth + between(-8, 8)) * Math.PI) / 180;
    const dist = between(18, 42) * (chord ? 0.85 : 1);
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

/** A small note in ink, drawn like the score's: a tilted head, a stem, flags or a beam. */
function Glyph({ kind }: { kind: NoteKind }): JSX.Element {
  return (
    <svg viewBox="0 -2 18 20" width="18" height="20" aria-hidden="true" focusable="false">
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
 * Nothing where a click already does something (`isEmptyClick`), and nothing under
 * prefers-reduced-motion. Never the accent: the screen's one red element stays the one. Transform
 * and opacity only, on a fixed layer the pointer passes through, hidden from assistive technology
 * and from print, at most SLOTS bursts at once.
 */
export function NoteBurst(): JSX.Element {
  const [bursts, setBursts] = useState<(Burst | null)[]>([]);

  useEffect(() => {
    let next = 0;
    let last = -Infinity;
    const onClick = (e: MouseEvent) => {
      if (!isEmptyClick(e, window.getSelection()) || prefersReducedMotion()) return;
      if (e.timeStamp - last < MIN_GAP_MS) return;
      last = e.timeStamp;
      const slot = next;
      next = (next + 1) % SLOTS;
      const notes = drawBurst();
      setBursts((prev) => {
        const out = prev.slice();
        out[slot] = { x: e.clientX, y: e.clientY, gen: (prev[slot]?.gen ?? 0) + 1, notes };
        return out;
      });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return (
    <div className="note-burst-layer no-print" aria-hidden="true">
      {bursts.map(
        (b, i) =>
          b && (
            <span key={`${i}-${b.gen}`} className="note-burst" style={{ left: b.x, top: b.y }}>
              {b.notes.map((n, j) => (
                <span key={j} className="note-burst-note" style={noteStyle(n)}>
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
