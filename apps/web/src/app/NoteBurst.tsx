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
 * A burst's shape: a click's, a double-click's, or the finish at the end of a piece (issue 97,
 * score/EndBurst.tsx).
 */
export type BurstShape = 'click' | 'double' | 'end';

type Range = readonly [low: number, high: number];

/** What one shape draws from: a weighted count and a range or limit for each of the rest. */
interface BurstRow {
  /** How many notes rise: a weighted draw. */
  counts: readonly number[];
  /** The fan's centre, within this many degrees of straight up; its width, in degrees. */
  fanCenter: number;
  fanWidth: Range;
  /** How far each note rises from the click, in px, and how much farther again (its rise). */
  distance: Range;
  rise: Range;
  /** The size at rest, and the sideways drift, within this many px. */
  scale: Range;
  drift: number;
  /** Its length, as a fraction of --dur-flourish. */
  time: Range;
  /** Between two notes of a run (28 to 55 ms of 520 for a click) and of a chord. */
  runGap: Range;
  chordGap: Range;
  /** The factors a double-click's wider, farther fan takes over the click's. */
  widen: number;
  farther: number;
  /** Whether one note, picked at random, is drawn in the accent. */
  accent: boolean;
}

const ROWS: Record<BurstShape, BurstRow> = {
  click: {
    counts: [2, 3, 3, 3, 4],
    fanCenter: 25,
    fanWidth: [50, 110],
    distance: [22, 50],
    rise: [0, 6],
    scale: [0.78, 1.12],
    drift: 9,
    time: [0.81, 1.25],
    runGap: [0.054, 0.106],
    chordGap: [0, 0.02],
    widen: 1,
    farther: 1,
    accent: false,
  },
  double: {
    counts: [3, 5, 5, 5, 6],
    fanCenter: 25,
    fanWidth: [50, 110],
    distance: [22, 50],
    rise: [0, 6],
    scale: [0.78, 1.12],
    drift: 9,
    time: [0.81, 1.25],
    runGap: [0.054, 0.106],
    chordGap: [0, 0.02],
    widen: 1.2,
    farther: 1.15,
    accent: true,
  },
  // Issue 193: a stronger cheer, 6 to 8 notes in a fan almost as wide as the page lets them,
  // 34 to 80 px out and up to 12 px more, larger and longer, ink only.
  end: {
    counts: [6, 7, 7, 8],
    fanCenter: 15,
    fanWidth: [120, 170],
    distance: [34, 80],
    rise: [0, 12],
    scale: [0.9, 1.3],
    drift: 14,
    time: [1.05, 1.5],
    runGap: [0.035, 0.06],
    chordGap: [0, 0.02],
    widen: 1,
    farther: 1,
    accent: false,
  },
};

/**
 * One burst, drawn fresh so no two look alike, from the row of its shape (`ROWS`): a fan of random
 * direction and width, each note out to its own distance, tilted outward, its own size, length and
 * sideways drift. They rise like a quick run, up or down, or now and then together like a chord.
 * A click's has 2 to 4 notes, 22 to 50 px out. A double-click's (`'double'`) has half as many
 * notes again, 3 to 6, a little wider and farther out, and one of them, picked at random, in the
 * accent. The finish (`'end'`) has 6 to 8, much wider and farther, larger and longer, none in the
 * accent: the red flying home is the screen's one red. `random` is Math.random but for tests.
 */
export function drawBurst(
  random: () => number = Math.random,
  shape: BurstShape = 'click',
): BurstNote[] {
  const row = ROWS[shape];
  const between = (a: number, b: number) => a + random() * (b - a);
  const within = ([a, b]: Range) => between(a, b);
  const pick = <T,>(xs: readonly T[]): T =>
    xs[Math.min(xs.length - 1, Math.floor(random() * xs.length))]!;
  const count = pick(row.counts);
  const chord = random() < 0.15;
  const fanCenter = between(-row.fanCenter, row.fanCenter);
  const fanWidth = within(row.fanWidth) * row.widen;
  const upward = random() < 0.5;
  /** Between two notes of the run, as a fraction of --dur-flourish. */
  const step = within(chord ? row.chordGap : row.runGap);
  const accent = row.accent ? Math.min(count - 1, Math.floor(random() * count)) : -1;
  const notes: BurstNote[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    // Never past 85 degrees from straight up: every note rises.
    const degrees = Math.max(-85, Math.min(85, fanCenter + (t - 0.5) * fanWidth + between(-8, 8)));
    const angle = (degrees * Math.PI) / 180;
    const dist = within(row.distance) * (chord ? 0.85 : 1) * row.farther;
    const dx = Math.round(Math.sin(angle) * dist);
    const order = upward ? i : count - 1 - i;
    notes.push({
      kind: pick(KINDS),
      dx,
      dy: Math.round(-Math.cos(angle) * dist - within(row.rise)),
      rotate: Math.round((dx < 0 ? -1 : 1) * between(3, 18)),
      scale: Math.round(within(row.scale) * 100) / 100,
      drift: Math.round(between(-row.drift, row.drift)),
      time: Math.round(within(row.time) * 100) / 100,
      wait: Math.round((order * step + between(0, 0.023)) * 1000) / 1000,
      accent: i === accent,
    });
  }
  return notes;
}

/** A burst on screen: where it rises from, in viewport px, and its notes. */
export interface Burst {
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
 * One burst's notes, rising from its point (base.css, `.note-burst`). Inside a
 * `.note-burst-layer`; the key of a new burst in the same place must change, so its notes mount
 * afresh and their animation starts over.
 */
export function BurstNotes({ burst }: { burst: Burst }): JSX.Element {
  return (
    <span className="note-burst" style={{ left: burst.x, top: burst.y }}>
      {burst.notes.map((n, j) => (
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
  );
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
      const notes = drawBurst(Math.random, double ? 'double' : 'click');
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
      {bursts.map((b, i) => b && <BurstNotes key={`${i}-${b.gen}`} burst={b} />)}
    </div>
  );
}
