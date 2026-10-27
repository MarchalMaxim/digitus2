import type { Finger, Hand, Score } from '@digitus2/engine';
import { ornamentAttacks } from '@digitus2/engine/ornaments';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';
import { durationMs, restrike } from '../design/motion.js';
import { useT } from '../i18n/i18n.js';
import { handLetter, hiddenHand } from './handLetters.js';
import { levelRect, NO_LEVELS, type KeyLevels } from './keyLevels.js';
import { useKeyLevels, type KeyGeometry } from './useKeyLevels.js';
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
   * Called when the keyboard scrolls and one hand's keys at the cursor lie wholly out of view while
   * the other's show (spec 15, rule 5): the score view then keeps the letters on to the end of the bar.
   * Called from a layout effect, so the letters come in the same paint. Default none.
   */
  onHandOutOfView?: () => void;
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
  /**
   * The keys the played hands strike in the cursor's bar, one per attack (issue 104): a
   * keyboard that scrolls chooses its view from these once a bar (`barView`). A new array only
   * when the bar changes. Undefined: the view follows `pressed`, at every change of it.
   */
  barKeys?: readonly number[];
  /**
   * The keys held on the reader's own piano (issue 182): a gray bar along each key's front edge,
   * never red; a held key travels (issue 200) but takes no gray. It is added to whatever the key shows (a cued key held on the piano
   * keeps its fill and finger), moves with the key's travel, and takes no part in the view or in
   * what the pointer presses. A pitch outside the drawn range is not shown. Default none.
   */
  held?: readonly number[];
  /**
   * How long the reader has held each key of their own piano that a step asked for, against its
   * note's written length: a fill of the bar's gray that rises inside the key, with the finger
   * number and the hand letter drawn again over it in the light gray. A key with no entry (a
   * wrong note) shows its bar alone, and a dimmed key never shows a level. The entries are times,
   * not heights: the keyboard moves the fills itself, frame by frame, without rendering
   * (score/useKeyLevels.ts). Default none (issue 185).
   */
  levels?: KeyLevels;
}

/** How long a key pressed with the pointer stays down at most (ms): usePlayback's KEY_HOLD_SEC. */
export const KEY_HOLD_MS = 2000;

/**
 * How far a pressed key shortens from its back edge: the `scaleY` of base.css
 * (`.keyboard-svg .key.is-pressed`), which a test keeps equal. A key held on the reader's own
 * piano goes further down (`held`, `.key.is-down`, issue 200). The hand letters are not in a key's
 * group and do not travel, so the clip of a level's letter takes the level's rectangle through the
 * travel the key has.
 */
export const KEY_TRAVEL = {
  white: 0.976,
  black: 0.96,
  held: { white: 0.94, black: 0.92 },
} as const;

/**
 * How long a key let go keeps `is-lifting` past the damper time, so the class is never taken off
 * while its rise is still running (ms).
 */
const LIFT_SLACK_MS = 20;

/** A horizontal stretch of the drawn keyboard, in CSS pixels from its left edge. */
export interface Span {
  left: number;
  right: number;
}

/**
 * How much of the best stretch's count a scrolling keyboard's view must hold to stay where it is
 * at a new bar (`barView`): two stretches nearly as good never trade places at every bar line.
 */
const VIEW_STICKS = 0.6;

/**
 * Where a scrolling keyboard `view` pixels wide puts its left edge for a bar (issue 104), from
 * the spans of the keys the bar strikes, one per attack, and its left edge now (`current`). Keys
 * that all fit stay in view: where they are when they already are, else centred. Keys that do
 * not fit (a stride bass under chords two octaves up) show the stretch that holds the most
 * attacks, centred, unless the view now holds `VIEW_STICKS` of that many already.
 */
export function barView(spans: readonly Span[], view: number, current: number): number {
  if (spans.length === 0) return current;
  const holds = (left: number) =>
    spans.filter((s) => s.left >= left && s.right <= left + view).length;
  const left = Math.min(...spans.map((s) => s.left));
  const right = Math.max(...spans.map((s) => s.right));
  if (right - left <= view) {
    return holds(current) === spans.length ? current : (left + right) / 2 - view / 2;
  }
  // Some best stretch starts at a key's left edge: try each one; the earlier wins a tie.
  let best = { left, right, count: 0 };
  for (const start of new Set(spans.map((s) => s.left))) {
    const inside = spans.filter((s) => s.left >= start && s.right <= start + view);
    if (inside.length > best.count) {
      best = { left: start, right: Math.max(...inside.map((s) => s.right)), count: inside.length };
    }
  }
  if (holds(current) >= best.count * VIEW_STICKS) return current;
  return (best.left + best.right) / 2 - view / 2;
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
const NO_HELD: readonly number[] = [];
const NO_LIFTING: ReadonlyMap<number, boolean> = new Map();

/**
 * The keys rising after a release (issue 200), each with whether the cue held it down when it came
 * up. A key held again leaves; so does a key the cue pressed after it came up uncued, which goes
 * down in the quick press time, not the damper's. The same map when nothing changed.
 */
function liftingAfter(
  lifting: ReadonlyMap<number, boolean>,
  before: ReadonlySet<number>,
  held: ReadonlySet<number>,
  cued: ReadonlyMap<number, unknown>,
): ReadonlyMap<number, boolean> {
  const next = new Map<number, boolean>();
  for (const [midi, wasCued] of lifting) {
    if (held.has(midi) || (!wasCued && cued.has(midi))) continue;
    next.set(midi, cued.has(midi));
  }
  for (const midi of before) if (!held.has(midi)) next.set(midi, cued.has(midi));
  const same =
    next.size === lifting.size && [...next].every(([midi, cue]) => lifting.get(midi) === cue);
  return same ? lifting : next;
}

/** The bar along the front edge of a held key (issue 182): 5 px high on a white key, 4 on a black. */
function heldBar(k: KeyShape, w: number, h: number) {
  const inset = k.black ? 2 : 3;
  return {
    x: k.x + inset,
    y: h - (k.black ? 6 : 8),
    width: w - 2 * inset,
    height: k.black ? 4 : 5,
    rx: 1,
  };
}

/** Where a key's hand letter stands (and its copy over a level, issue 185): over its number. */
function handSpot(k: KeyShape): { x: number; y: number } {
  const w = k.black ? BLACK_W : WHITE_W;
  const h = k.black ? BLACK_H : WHITE_H;
  return { x: k.x + w / 2, y: h - (k.black ? 23 : 30) };
}

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
 * scrolling keyboard chooses its view once a bar, from the keys the bar strikes (`barView`), and
 * is a tab stop so it can also be scrolled from the keyboard.
 *
 * The reader's own keys (`held`, issue 182): a gray bar along the front edge of each key held on
 * their piano, 5 px high on a white key and 4 px on a black one, inside the key's group so it goes
 * down and up with the key. It is drawn over the key and its number and under the hand letters,
 * ignores the pointer and is hidden from assistive technology. On a black key that is neither
 * pressed nor dimmed it takes its own gray (`is-on-black`): the key is black there. A dimmed key
 * (`.is-muted`) is drawn at 40 % opacity as a whole, which would take its bar down with it: there
 * the bar is drawn beside the key's group, at full strength, in a gray of its own (`is-dimmed`).
 * A dimmed key is never pressed, so it has no travel for the bar to follow.
 *
 * The keys' levels (`levels`, issue 185): a key with an entry draws a fill, `rect.key-level`, in
 * its group right after its rectangle, which grows from the bar's bottom edge to 3 px under the
 * key's top (2 on a black key) as the note's length passes; the bar lies over it, so a level's
 * foot is the bar. It takes the bar's gray, and the black key's own (`is-on-black`) while the key
 * shows no state. Where it covers the finger number, the number is drawn again after the
 * original (`text.key-on-level`, aria-hidden, the original stays the key's first text), clipped to
 * the level and in the light gray that reads on it; the hand letter gets the same copy in the
 * letters' layer. The clip paths are inside the key's group, so they share its travel; the
 * letters' are not, so theirs is the level's rectangle through `KEY_TRAVEL`. All of these exist
 * only while the key has a level and is not dimmed, and the rectangles are drawn empty here:
 * `useKeyLevels` gives them their size from the clock, before the paint and then once a frame
 * while some level moves, so a level rising renders nothing.
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
  onHandOutOfView,
  hovered = null,
  onStrike,
  barKeys,
  held = NO_HELD,
  levels = NO_LEVELS,
}: KeyboardProps): JSX.Element {
  const t = useT();
  // The ids of the clip paths (issue 185): one per keyboard, so two keyboards on a page never
  // share a clip. useId's characters are not all legal in a `url(#…)`, so they are stripped.
  const clipBase = `clip-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
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
  const heldSet = useMemo(() => new Set(held), [held]);
  // The keys that came up a moment ago (issue 200): a key held on the piano is drawn further down
  // than the cue, and one let go rises back to the cue's depth in the damper time, which the cue's
  // own quick press would otherwise cut short (`is-lifting`, base.css). Worked out during the render
  // that sees the key let go, so no frame draws it rising at the press time.
  const [heldSeen, setHeldSeen] = useState<ReadonlySet<number>>(heldSet);
  const [lifting, setLifting] = useState<ReadonlyMap<number, boolean>>(NO_LIFTING);
  const nextLifting = liftingAfter(lifting, heldSeen, heldSet, byMidi);
  if (heldSeen !== heldSet) setHeldSeen(heldSet);
  if (nextLifting !== lifting) setLifting(nextLifting);
  // One timeout per key, started when the key begins to rise: a later release of another key never
  // extends this one's.
  const liftTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = liftTimers.current;
    for (const [midi, timer] of timers) {
      if (lifting.has(midi)) continue;
      clearTimeout(timer);
      timers.delete(midi);
    }
    for (const midi of lifting.keys()) {
      if (timers.has(midi)) continue;
      timers.set(
        midi,
        setTimeout(
          () => {
            timers.delete(midi);
            setLifting((now) => {
              if (!now.has(midi)) return now;
              const rest = new Map(now);
              rest.delete(midi);
              return rest.size === 0 ? NO_LIFTING : rest;
            });
          },
          durationMs('--dur-slow') + LIFT_SLACK_MS,
        ),
      );
    }
  }, [lifting]);
  useEffect(() => {
    const timers = liftTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);
  // The dimmed keys, as a value the geometry can depend on: a dimmed key does not move.
  const dimmedKey = [...mutedByMidi.keys()].join(',');
  const width = Math.max(1, whiteCount) * WHITE_W;
  // What a key's level grows from (issue 185): the held bar, and the scale the key takes: the
  // cue's, or the deeper one of a key held on the piano (issue 200).
  const geometry = useMemo(
    () =>
      new Map<number, KeyGeometry>(
        keys.map((k) => {
          // A key rising keeps the held travel for the rise, so the letter's clip does not jump.
          const deep =
            (heldSet.has(k.midi) || lifting.has(k.midi)) &&
            !dimmedKey.split(',').includes(`${k.midi}`);
          const travel = deep ? KEY_TRAVEL.held : KEY_TRAVEL;
          return [
            k.midi,
            {
              black: k.black,
              bar: heldBar(k, k.black ? BLACK_W : WHITE_W, k.black ? BLACK_H : WHITE_H),
              travel: k.black ? travel.black : travel.white,
            },
          ];
        }),
      ),
    [keys, heldSet, lifting, dimmedKey],
  );
  // The keys that draw a level: one in `levels`, on the keyboard, not dimmed (`mutedByMidi` holds
  // the dimmed keys only), with an `h` for those that also draw a letter's copy. The rectangles
  // the loop moves come and go with this, and may do so while `levels` is the same map (the cursor
  // arrives on a key, the hands come close), so the loop looks them up again when it changes.
  const levelShape = [...levels.keys()]
    .filter((midi) => shapeOf.has(midi) && !mutedByMidi.has(midi))
    .sort((a, b) => a - b)
    .map((midi) => (handLetters && cursorByMidi.has(midi) ? `${midi}h` : `${midi}`))
    .join(' ');

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

  // Runs when the cursor enters another bar (`barKeys`; without it, at every change of `pressed`).
  // The view is chosen once a bar, so a texture wider than the view (a stride bass) does not swing
  // the keyboard from end to end at every note (issue 104). The jump is instant: the keys on
  // screen are the ones being heard, and a smooth scroll would lag them. A layout effect, so the
  // scroll lands in the same frame as the newly pressed keys: a passive effect runs after the
  // paint, and for one frame the pressed keys could sit out of view.
  const followed = useMemo(() => barKeys ?? pressed.map((p) => p.midi), [barKeys, pressed]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const svg = svgRef.current;
    if (!el || !svg || followed.length === 0 || el.scrollWidth <= el.clientWidth + 1) return;
    // The viewBox as laid out: scaled to fit the SVG box and centered in it.
    const box = svg.getBoundingClientRect();
    const scale = Math.min(box.width / (width + 1), box.height / (WHITE_H + 1));
    if (!(scale > 0)) return;
    const offset = (box.width - (width + 1) * scale) / 2;
    const spans: Span[] = [];
    for (const midi of followed) {
      const k = shapeOf.get(midi);
      if (!k) continue;
      const w = k.black ? BLACK_W : WHITE_W;
      spans.push({ left: offset + (k.x + 0.5) * scale, right: offset + (k.x + w + 0.5) * scale });
    }
    const left = barView(spans, el.clientWidth, el.scrollLeft);
    if (left !== el.scrollLeft) el.scrollLeft = left;
  }, [followed, shapeOf, width]);

  // A hand out of view (spec 15, rule 5): on a keyboard that scrolls, the view chosen above can
  // leave one hand's keys at the cursor wholly outside it, and a number alone does not say whose it
  // is. Only the cursor's keys count (never a dimmed hand's, never a hovered key). After the scroll
  // above, in the same layout phase, so the score view's letters render before the paint.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const svg = svgRef.current;
    if (!onHandOutOfView || !el || !svg || el.scrollWidth <= el.clientWidth + 1) return;
    const view = el.getBoundingClientRect();
    const keys = [...cursorByMidi.values()].flatMap((p) => {
      const rect = svg.querySelector(`g.key[data-midi="${p.midi}"]`)?.getBoundingClientRect();
      if (!rect) return [];
      const centre = (rect.left + rect.right) / 2;
      return [{ hand: p.hand, visible: centre >= view.left && centre <= view.right }];
    });
    if (hiddenHand(keys) !== null) onHandOutOfView();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cursorByMidi is `pressed`, rebuilt
  }, [pressed, followed, onHandOutOfView]);

  // The levels move from the clock, not from React (issue 185): see useKeyLevels.
  useKeyLevels(svgRef, levels, geometry, levelShape);

  const key = (k: KeyShape) => {
    const p = byMidi.get(k.midi);
    const m = p ? undefined : mutedByMidi.get(k.midi);
    const shown = p ?? m;
    const w = k.black ? BLACK_W : WHITE_W;
    const h = k.black ? BLACK_H : WHITE_H;
    const state = p ? ' is-pressed' : m ? ' is-muted' : '';
    // A key held on the piano goes down further than the cue (issue 200); a dimmed key does not move.
    const down = m
      ? ''
      : heldSet.has(k.midi)
        ? ' is-down'
        : lifting.has(k.midi)
          ? ' is-lifting'
          : '';
    const cls = `key ${k.black ? 'is-black' : 'is-white'}${state}${down}`;
    // The key's level (issue 185): never on a dimmed key, and whether or not the key is still held
    // (a level let go before it is full drains after the key is up). Drawn empty: useKeyLevels
    // sets the size of this rectangle and of its clip from the clock, before the paint.
    const level = levels.has(k.midi) && !m;
    const levelBox = levelRect(k.black, heldBar(k, w, h), 0);
    const clipId = `${clipBase}-${k.midi}`;
    const digit = { x: k.x + w / 2, y: h - (k.black ? 9 : 12), textAnchor: 'middle' } as const;
    return (
      <Fragment key={k.midi}>
        {/* A dimmed black key is see-through: an opaque backing under it keeps the white keys'
            outlines from striking through it, so it reads as a pale key, not a hole. */}
        {m && k.black && <rect className="key-backing" x={k.x} y={0} width={w} height={h} />}
        <g className={cls} data-midi={k.midi} data-hand={shown?.hand}>
          <rect x={k.x} y={0} width={w} height={h} />
          {level && (
            <rect
              className={`key-level${k.black && !shown ? ' is-on-black' : ''}`}
              data-level-for={k.midi}
              {...levelBox}
              aria-hidden="true"
            />
          )}
          {shown && shown.finger !== null && <text {...digit}>{shown.finger}</text>}
          {/* The number again, after the original, in the light gray, clipped to the level. */}
          {level && shown && shown.finger !== null && (
            <text
              className="key-on-level"
              {...digit}
              clipPath={`url(#${clipId})`}
              aria-hidden="true"
            >
              {shown.finger}
            </text>
          )}
          {level && (
            <clipPath id={clipId}>
              <rect data-clip-for={k.midi} {...levelBox} />
            </clipPath>
          )}
          {heldSet.has(k.midi) && !m && (
            <rect
              className={`key-held${k.black && !shown ? ' is-on-black' : ''}`}
              {...heldBar(k, w, h)}
              aria-hidden="true"
            />
          )}
        </g>
        {heldSet.has(k.midi) && m && (
          <rect
            className={`key-held is-dimmed${k.black ? ' is-black' : ''}`}
            data-for-midi={k.midi}
            {...heldBar(k, w, h)}
            aria-hidden="true"
          />
        )}
      </Fragment>
    );
  };

  // The hand over each pressed or dimmed key, the played hand's first, drawn only while
  // `handLetters` (T11). A layer of its own above the keys, so a key's own text stays its finger
  // number alone. Whether they show is the score view's call (`handLetters`): the score's close bars,
  // and the bar where the scroll puts a hand out of view (`onHandOutOfView`, spec 15, rule 5).
  const handMark = (p: PressedKey, dimmed: boolean) => {
    const k = shapeOf.get(p.midi);
    if (!k) return null;
    const cls = `key-hand${k.black ? ' is-on-black' : ''}${dimmed ? ' is-muted' : ''}`;
    return (
      <text
        key={`hand-${p.midi}`}
        className={cls}
        data-for-midi={p.midi}
        {...handSpot(k)}
        textAnchor="middle"
      >
        {handLetter(p.hand, t)}
      </text>
    );
  };

  // The letter again over a key's level (issue 185), after every letter, in the light gray,
  // clipped to the level. The letters are not in the keys' groups and do not travel with them, so
  // the clip is the level's rectangle as the pressed key draws it: `useKeyLevels` scales it by the
  // key's travel. Only a cursor key has a letter, and a cursor key is never dimmed.
  const handCopy = (p: PressedKey) => {
    const k = shapeOf.get(p.midi);
    if (!k || !levels.has(p.midi)) return null;
    const clipId = `${clipBase}-hand-${p.midi}`;
    const levelBox = levelRect(k.black, geometry.get(p.midi)!.bar, 0);
    return (
      <Fragment key={`hand-on-level-${p.midi}`}>
        <text
          className={`key-hand-on-level${k.black ? ' is-on-black' : ''}`}
          {...handSpot(k)}
          textAnchor="middle"
          clipPath={`url(#${clipId})`}
          aria-hidden="true"
        >
          {handLetter(p.hand, t)}
        </text>
        <clipPath id={clipId}>
          <rect data-hand-clip-for={p.midi} {...levelBox} />
        </clipPath>
      </Fragment>
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
        {handLetters && [...cursorByMidi.values()].map(handCopy)}
      </svg>
    </div>
  );
}
