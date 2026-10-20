import type { Finger, Hand, Score } from '@digitus2/engine';
import { ornamentAttacks } from '@digitus2/engine/ornaments';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';
import { restrike } from '../design/motion.js';
import { useT } from '../i18n/i18n.js';
import { handLetter } from './handLetters.js';
import { useKeyPress } from './useKeyPress.js';

/**
 * A key held down at the cursor, with the finger that plays it. `finger` is null when the
 * fingering on screen has no digit for that note (the editor's fingering is often sparse): the
 * key still shows as pressed, without a number.
 */
export interface PressedKey {
  midi: number;
  finger: Finger | null;
  hand: Hand;
}

export interface KeyboardProps {
  lowMidi: number;
  highMidi: number;
  /** The keys struck at the cursor first, then the ones still held from earlier. */
  pressed: PressedKey[];
  /**
   * How many of `pressed`, from the first, were struck at the cursor's onset (the rest are held
   * from earlier). A struck key that was already down strikes again: it lifts and goes down
   * (a repeated note). Default 0: no key strikes again.
   */
  struckCount?: number;
  /**
   * The muted hand's keys at the cursor (one-hand practice), drawn dimmed and never pressed: what
   * the other hand would play. A key also in `pressed` (a unison of both hands) is pressed.
   */
  muted?: PressedKey[];
  /**
   * Letter each pressed and dimmed key with its hand (T11: the cursor is in a bar where the hands
   * come close). Default false.
   */
  handLetters?: boolean;
  /**
   * The key of the note under the mouse pointer in the score (issue #96), pressed with its finger
   * like a cue while the pointer rests there; a key the cursor already holds keeps the cursor's
   * finger. Never lettered. Default none.
   */
  hovered?: PressedKey | null;
  /**
   * Sounds a key pressed with the pointer (issue #96); returns the release, called when the key
   * lifts. The key goes down while the pointer is on it, `KEY_HOLD_MS` at most, without a
   * number. Undefined: the keys only move.
   */
  onStrike?: (midi: number) => (() => void) | void;
}

/** How long a key pressed with the pointer stays down at most (ms): usePlayback's KEY_HOLD_SEC. */
export const KEY_HOLD_MS = 2000;

/** A horizontal stretch of the drawn keyboard, in CSS pixels from its left edge. */
export interface Span {
  left: number;
  right: number;
}

/**
 * What a scrolling keyboard `view` pixels wide shows of the pressed keys (their spans, in the
 * order of `pressed`): all of them when they fit; otherwise the stretch that holds the most of
 * them, preferring one that holds the first key (struck at the cursor). Null for no keys.
 */
export function keysToShow(spans: readonly Span[], view: number): Span | null {
  const first = spans[0];
  if (!first) return null;
  const left = Math.min(...spans.map((s) => s.left));
  const right = Math.max(...spans.map((s) => s.right));
  if (right - left <= view) return { left, right };
  // Some best stretch starts at a key's left edge: try each one.
  let best: Span = first;
  let bestScore = -1;
  for (const start of spans) {
    const inside = spans.filter((s) => s.left >= start.left && s.right <= start.left + view);
    if (inside.length === 0) continue;
    const score = inside.length + (inside.includes(first) ? 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { left: start.left, right: Math.max(...inside.map((s) => s.right)) };
    }
  }
  return best;
}

const WHITE_W = 24;
const WHITE_H = 100;
const BLACK_W = 14;
const BLACK_H = 62;
const PIANO_LOW = 21; // A0
const PIANO_HIGH = 108; // C8
const MIN_KEYS = 24; // two octaves
/**
 * The narrowest a white key is drawn, in CSS pixels, so the finger digits stay readable on a
 * phone (about 13 px on a white key, 10 px on a black one). A wider range scrolls sideways.
 */
const MIN_WHITE_PX = 22;

function isBlack(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

/**
 * The keys a piece needs: from the C at or below its lowest note to the B above its highest,
 * widened an octave at a time (below first, then above) to at least two octaves, and kept on the
 * 88 keys of a piano.
 */
export function keyboardRange(score: Score): { lowMidi: number; highMidi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of score.notes) {
    for (const attack of ornamentAttacks(n)) {
      if (attack.midi < lo) lo = attack.midi;
      if (attack.midi > hi) hi = attack.midi;
    }
  }
  if (!Number.isFinite(lo)) return { lowMidi: 48, highMidi: 71 };
  let lowMidi = lo - (((lo % 12) + 12) % 12);
  let highMidi = hi - (((hi % 12) + 12) % 12) + 11;
  const keyCount = () => Math.min(PIANO_HIGH, highMidi) - Math.max(PIANO_LOW, lowMidi) + 1;
  for (let below = true; keyCount() < MIN_KEYS; below = !below) {
    if (below && lowMidi > PIANO_LOW) lowMidi -= 12;
    else highMidi += 12;
  }
  return { lowMidi: Math.max(PIANO_LOW, lowMidi), highMidi: Math.min(PIANO_HIGH, highMidi) };
}

interface KeyShape {
  midi: number;
  black: boolean;
  x: number;
}

function layout(lowMidi: number, highMidi: number): { keys: KeyShape[]; whiteCount: number } {
  const keys: KeyShape[] = [];
  let whites = 0;
  for (let midi = lowMidi; midi <= highMidi; midi++) {
    if (isBlack(midi)) {
      keys.push({ midi, black: true, x: Math.max(0, whites * WHITE_W - BLACK_W / 2) });
    } else {
      keys.push({ midi, black: false, x: whites * WHITE_W });
      whites++;
    }
  }
  return { keys, whiteCount: whites };
}

/** One note per key: of several (a unison), the first one that has a finger. */
function oneByKey(keys: readonly PressedKey[]): Map<number, PressedKey> {
  const byMidi = new Map<number, PressedKey>();
  for (const p of keys) {
    const seen = byMidi.get(p.midi);
    if (!seen || (seen.finger === null && p.finger !== null)) byMidi.set(p.midi, p);
  }
  return byMidi;
}

const NO_KEYS: PressedKey[] = [];
const NO_HOVER: PressedKey[] = [];

/**
 * The on-screen keyboard: white keys white with an ink outline, black keys ink. A pressed key
 * turns gray (`--gray-2`, white or black) and shows the finger number that plays it. An L or R
 * above it (the hand's letter in the language on screen) says the hand only while the hands come close (`handLetters`, T11); elsewhere the
 * numbers stand alone. With one hand muted, that hand's keys at the cursor show the same
 * way, dimmed (`.is-muted`), never pressed. Class names only; the colors come from base.css, and
 * nothing here is ever red. A pressed key goes down fast and comes up slowly (key travel, base.css);
 * a key struck again while held lifts and goes down again (`struckCount`).
 *
 * The SVG sits in its own sideways scroller: it never draws a white key narrower than
 * MIN_WHITE_PX, so a wide piece on a phone scrolls instead of shrinking the digits away. A
 * scrolling keyboard follows the pressed keys when they leave its visible part, and is a tab
 * stop so it can also be scrolled from the keyboard.
 *
 * The keyboard answers (issue #96): the key of a note hovered in the score goes down with its
 * finger (`hovered`), and a key pressed with the pointer goes down and sounds (`onStrike`,
 * useKeyPress.ts), striking again if it was already down. The keys are a pointer affordance,
 * not buttons: they take no focus and are not named to assistive technology (docs/app.md).
 */
export function Keyboard({
  lowMidi,
  highMidi,
  pressed,
  struckCount = 0,
  muted = NO_KEYS,
  handLetters = false,
  hovered = null,
  onStrike,
}: KeyboardProps): JSX.Element {
  const t = useT();
  const { keys, whiteCount } = useMemo(() => layout(lowMidi, highMidi), [lowMidi, highMidi]);
  const shapeOf = useMemo(() => new Map(keys.map((k) => [k.midi, k])), [keys]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [scrollable, setScrollable] = useState(false);
  /** The keys down before the latest change of `pressed`. */
  const downRef = useRef<ReadonlySet<number>>(new Set());
  /** The cursor's keys alone: these follow the cursor (scroll, letters) and strike again. */
  const cursorByMidi = oneByKey(pressed);
  // A key the pointer holds down (useKeyPress): pressed, without a number.
  const strikeKey = useCallback(
    (midi: number, el: Element) => {
      // Already down (the cursor's, or hovered): it lifts and goes down again, as a struck key.
      if (downRef.current.has(midi)) restrike(el);
      return onStrike?.(midi);
    },
    [onStrike],
  );
  const { down, handlers } = useKeyPress({ strike: strikeKey, holdMs: KEY_HOLD_MS });
  const hoverKeys = hovered ? [hovered] : NO_HOVER;
  const downKeys: PressedKey[] =
    down === null ? NO_HOVER : [{ midi: down, finger: null, hand: 'R' }];
  const byMidi = oneByKey([...pressed, ...hoverKeys, ...downKeys]);
  const mutedByMidi = oneByKey(muted.filter((m) => !byMidi.has(m.midi)));
  const width = Math.max(1, whiteCount) * WHITE_W;

  useEffect(() => {
    const el = scrollRef.current;
    const svg = svgRef.current;
    if (!el || !svg) return;
    const measure = () => setScrollable(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [whiteCount]);

  // A repeated note: a key struck at this onset that was already down lifts and goes down again,
  // so the reader sees the second strike (a held key alone would not move). A layout effect, so
  // the strike starts with the paint that shows the new group.
  useLayoutEffect(() => {
    const before = downRef.current;
    downRef.current = new Set(pressed.map((p) => p.midi));
    const svg = svgRef.current;
    if (!svg) return;
    for (const p of pressed.slice(0, struckCount)) {
      if (before.has(p.midi)) restrike(svg.querySelector(`g.key[data-midi="${p.midi}"]`));
    }
  }, [pressed, struckCount]);
  // Every key shown down, for a pointer press to know whether to strike again (above): the
  // cursor's, the hovered one, and the one the pointer holds. The repeated-note check above reads
  // the cursor's keys before this runs in the same commit.
  useLayoutEffect(() => {
    downRef.current = new Set([...byMidi.keys()]);
  });

  // Runs when the cursor moves to another group (the only time `pressed` changes). The jump is
  // instant: the keys on screen are the ones being heard, and a smooth scroll would lag them. A
  // layout effect, so the scroll lands in the same frame as the newly pressed keys: a passive
  // effect runs after the paint, and for one frame the pressed keys could sit out of view.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const svg = svgRef.current;
    if (!el || !svg || pressed.length === 0 || el.scrollWidth <= el.clientWidth + 1) return;
    // The viewBox as laid out: scaled to fit the SVG box and centered in it.
    const box = svg.getBoundingClientRect();
    const scale = Math.min(box.width / (width + 1), box.height / (WHITE_H + 1));
    if (!(scale > 0)) return;
    const offset = (box.width - (width + 1) * scale) / 2;
    const spans: Span[] = [];
    for (const p of pressed) {
      const k = shapeOf.get(p.midi);
      if (!k) continue;
      const w = k.black ? BLACK_W : WHITE_W;
      spans.push({ left: offset + (k.x + 0.5) * scale, right: offset + (k.x + w + 0.5) * scale });
    }
    const show = keysToShow(spans, el.clientWidth);
    if (!show || (show.left >= el.scrollLeft && show.right <= el.scrollLeft + el.clientWidth)) {
      return;
    }
    el.scrollLeft = (show.left + show.right) / 2 - el.clientWidth / 2;
  }, [pressed, shapeOf, width]);

  const key = (k: KeyShape) => {
    const p = byMidi.get(k.midi);
    const m = p ? undefined : mutedByMidi.get(k.midi);
    const shown = p ?? m;
    const w = k.black ? BLACK_W : WHITE_W;
    const h = k.black ? BLACK_H : WHITE_H;
    const state = p ? ' is-pressed' : m ? ' is-muted' : '';
    const cls = `key ${k.black ? 'is-black' : 'is-white'}${state}`;
    return (
      <Fragment key={k.midi}>
        {/* A dimmed black key is see-through: an opaque backing under it keeps the white keys'
            outlines from striking through it, so it reads as a pale key, not a hole. */}
        {m && k.black && <rect className="key-backing" x={k.x} y={0} width={w} height={h} />}
        <g className={cls} data-midi={k.midi} data-hand={shown?.hand}>
          <rect x={k.x} y={0} width={w} height={h} />
          {shown && shown.finger !== null && (
            <text x={k.x + w / 2} y={h - (k.black ? 9 : 12)} textAnchor="middle">
              {shown.finger}
            </text>
          )}
        </g>
      </Fragment>
    );
  };

  // The hand over each pressed or dimmed key, the played hand's first, drawn only while
  // `handLetters` (T11). A layer of its own above the keys, so a key's own text stays its finger
  // number alone. The keyboard's scroll position decides nothing here (spec 15, rule 5).
  const handMark = (p: PressedKey, dimmed: boolean) => {
    const k = shapeOf.get(p.midi);
    if (!k) return null;
    const w = k.black ? BLACK_W : WHITE_W;
    const h = k.black ? BLACK_H : WHITE_H;
    const cls = `key-hand${k.black ? ' is-on-black' : ''}${dimmed ? ' is-muted' : ''}`;
    return (
      <text
        key={`hand-${p.midi}`}
        className={cls}
        data-for-midi={p.midi}
        x={k.x + w / 2}
        y={h - (k.black ? 23 : 30)}
        textAnchor="middle"
      >
        {handLetter(p.hand, t)}
      </text>
    );
  };

  return (
    <div className="keyboard-scroll" ref={scrollRef} tabIndex={scrollable ? 0 : undefined}>
      <svg
        ref={svgRef}
        className="keyboard-svg"
        viewBox={`-0.5 -0.5 ${width + 1} ${WHITE_H + 1}`}
        role="img"
        aria-label={t.score.keyboard.label}
        style={{ minWidth: Math.max(1, whiteCount) * MIN_WHITE_PX }}
        {...handlers}
      >
        {keys.filter((k) => !k.black).map(key)}
        {keys.filter((k) => k.black).map(key)}
        {handLetters && [...cursorByMidi.values()].map((p) => handMark(p, false))}
        {handLetters && [...mutedByMidi.values()].map((p) => handMark(p, true))}
      </svg>
    </div>
  );
}
