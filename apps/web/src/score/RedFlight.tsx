/**
 * The red travels (motion study 05). The screen has exactly one red element at a time, and when
 * the red passes between Play and the playback cursor it travels instead of jumping: Play gives up
 * its red and, in the same frame, a red shape with Play's exact box takes it; the shape shrinks into
 * the first notehead along a slight curve (X and Y on different easings) and lands as that note
 * sounds, in the paint where the cursor marks it. Rewind, or the end of the piece, sends it back:
 * the cursor's marks clear and the shape grows from the last notehead heard into Play, which takes
 * the red when it arrives. On every frame one element is red: Play, the shape, or the cursor.
 *
 * The flight out starts RED_FLIGHT_MS before the lead-in's first note is heard
 * (`playback.leadInRemainingSec()`), so with a count-in it leaves on the last beat; a Play from the
 * start without a count-in holds that note back as long (usePlayback.ts). It flies only for a
 * lead-in that Play began with the red on Play (not a resume, nor a seek or a loop wrap while
 * playing), and not when the note is too close for a visible flight. Nothing travels under
 * prefers-reduced-motion.
 *
 * A seek (T13: a click on a bar, the arrow keys) makes the red hop: from where it is (the cursor's
 * notehead, or Play) to the first notehead of the bar sought, along an arc whose height grows with
 * the distance, stretching a little in the air and squashing as it lands. Playing, the music holds
 * back as long (usePlayback.ts `seek`) and comes in as it lands; stopped, the cue the cursor marks
 * there is drawn in ink until the hop arrives (`hopping`, base.css), so one element is red
 * throughout. It hops only between places that are on screen and stay put (`cursorWouldScroll`):
 * a seek to a bar out of view jumps there, and the page scrolls.
 */
import type { Hand } from '@digitus2/engine';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react';
import {
  EASE,
  HOP_MAX_MS,
  HOP_MIN_MS,
  prefersReducedMotion,
  RED_FLIGHT_MS,
} from '../design/motion.js';
import type { OnsetGroup } from './onsetGroups.js';
import { cursorWouldScroll } from './useCursor.js';
import type { Playback } from './usePlayback.js';

/** A flight shorter than this is not worth seeing: the red jumps, as it always did. */
export const MIN_FLIGHT_MS = 100;

/** The second easing of the curved path: slow off the mark, then quick. */
const LATE = 'cubic-bezier(0.55, 0, 0.25, 1)';

/** A box in viewport pixels, by its center. */
export interface FlightBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Between Play and the cursor: 'out' from Play to the first notehead, 'home' back to Play. */
export interface TravelPlan {
  dir: 'out' | 'home';
  /** Play's box. */
  button: FlightBox;
  /** The notehead's box. */
  note: FlightBox;
  durationMs: number;
}

/** A seek's hop (T13): from where the red is to the first notehead of the bar sought. */
export interface HopPlan {
  dir: 'hop';
  /** Where the red leaves from: a notehead (`fromNote`), or Play (Pause) with its exact box. */
  from: FlightBox;
  fromNote: boolean;
  /** The notehead it lands on. */
  note: FlightBox;
  durationMs: number;
  /** Hopping while playing: it holds on the notehead until the cursor takes the red. */
  playing: boolean;
}

export type FlightPlan = TravelPlan | HopPlan;

/** How long a hop over `distance` pixels takes: quick for a neighbour, a little longer across. */
export function hopMs(distance: number): number {
  return Math.round(Math.min(HOP_MAX_MS, HOP_MIN_MS + distance * 0.12));
}

/** How high a hop over `distance` pixels rises above the higher of its two ends. */
export function hopLift(distance: number): number {
  return Math.min(40, Math.max(12, distance * 0.15));
}

function boxOf(el: Element): FlightBox {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

/** Of several noteheads (a chord, both hands), the highest on the page. */
export function topmost(heads: readonly Element[]): FlightBox | null {
  let best: FlightBox | null = null;
  for (const h of heads) {
    const b = boxOf(h);
    if (b.w > 0 && (best === null || b.y < best.y)) best = b;
  }
  return best;
}

/** The noteheads of the first group of the hands played at or after `sec`. */
function firstHeads(
  host: Element,
  groups: readonly OnsetGroup[],
  mutedHands: readonly Hand[],
  sec: number,
): Element[] {
  for (const g of groups) {
    if (g.sec < sec - 1e-6) continue;
    const notes = g.notes.filter((n) => !mutedHands.includes(n.hand));
    if (notes.length === 0) continue;
    const doc = host.ownerDocument;
    return notes
      .map((n) => doc.getElementById(n.id)?.querySelector('.notehead'))
      .filter((h): h is Element => h != null);
  }
  return [];
}

/**
 * The keyframes of a flight, one list per element: the outer box moves along X, the inner along
 * Y, the shape changes size, corners and tilt. Exported for the unit test.
 */
export function flightFrames(plan: FlightPlan): {
  x: Keyframe[];
  y: Keyframe[];
  shape: Keyframe[];
  xEasing: string;
  yEasing: string;
} {
  /** The shape over box `b`, round (a notehead, tilted) or square, stretched by `sx` and `sy`. */
  const shape = (b: FlightBox, round: boolean, sx = 1, sy = 1, offset?: number): Keyframe => {
    const w = b.w * sx;
    const h = (round ? b.h * 0.8 : b.h) * sy;
    return {
      ...(offset === undefined ? {} : { offset }),
      width: `${w}px`,
      height: `${h}px`,
      marginLeft: `${-w / 2}px`,
      marginTop: `${-h / 2}px`,
      borderRadius: round ? '50%' : '0%',
      transform: `rotate(${round ? -20 : 0}deg)`,
    };
  };
  if (plan.dir === 'hop') {
    // An arc: across at an even pace, up quickly and down faster, like a ball tossed; in the air
    // the shape is already the notehead, a little long, and it squashes as it lands.
    const { from, note: to } = plan;
    const peak = Math.min(from.y, to.y) - hopLift(Math.hypot(to.x - from.x, to.y - from.y));
    return {
      x: [{ transform: `translateX(${from.x}px)` }, { transform: `translateX(${to.x}px)` }],
      y: [
        { transform: `translateY(${from.y}px)`, easing: 'cubic-bezier(0.25, 0.6, 0.45, 1)' },
        {
          transform: `translateY(${peak}px)`,
          offset: 0.45,
          easing: 'cubic-bezier(0.55, 0, 0.75, 0.4)',
        },
        { transform: `translateY(${to.y}px)` },
      ],
      shape: [
        shape(from, plan.fromNote),
        shape(to, true, 0.85, 1.2, 0.45),
        shape(to, true, 1.3, 0.7, 0.88),
        shape(to, true),
      ],
      xEasing: 'cubic-bezier(0.3, 0, 0.7, 1)',
      yEasing: 'linear',
    };
  }
  const from = plan.dir === 'out' ? plan.button : plan.note;
  const to = plan.dir === 'out' ? plan.note : plan.button;
  return {
    x: [{ transform: `translateX(${from.x}px)` }, { transform: `translateX(${to.x}px)` }],
    y: [{ transform: `translateY(${from.y}px)` }, { transform: `translateY(${to.y}px)` }],
    shape: [shape(from, plan.dir !== 'out'), shape(to, plan.dir === 'out')],
    // Two easings, one per axis: the path bows instead of running straight.
    xEasing: plan.dir === 'out' ? LATE : EASE,
    yEasing: plan.dir === 'out' ? EASE : LATE,
  };
}

/**
 * The noteheads the cursor marked last (`.is-red .notehead` under `host`), read in a layout
 * effect whenever the cursor moves to a group, and kept once it clears: they stay in the page, so
 * a flight home or the finish (EndBurst.tsx) can still leave from where the music ended. Held
 * weakly: once the cursor has cleared, their page may be torn down (render/pageWindow.ts), and a
 * strong reference would keep its whole detached SVG alive until the next mark.
 */
export function useLastHeads(
  host: Element | null,
  currentGroup: number,
): RefObject<WeakRef<Element>[]> {
  const ref = useRef<WeakRef<Element>[]>([]);
  useLayoutEffect(() => {
    if (host && currentGroup >= 0) {
      ref.current = [...host.querySelectorAll('.is-red .notehead')].map((h) => new WeakRef(h));
    }
  }, [host, currentGroup]);
  return ref;
}

/** Of the noteheads `useLastHeads` kept, those still in the page: none when their page was torn. */
export function liveHeads(heads: readonly WeakRef<Element>[]): Element[] {
  return heads.map((h) => h.deref()).filter((h): h is Element => h?.isConnected === true);
}

export interface RedFlightOptions {
  /** The score sheet's host (the cursor marks its notes). */
  host: Element | null;
  /** The Play (and Pause) button, read when a flight starts. */
  playButton: () => HTMLElement | null;
  playback: Playback;
  groups: readonly OnsetGroup[];
  mutedHands: readonly Hand[];
  /** The group the cursor marks (useCursor), -1 when none. */
  currentGroup: number;
}

/**
 * Plans the red's flights. `flight` is the flight on screen (render a RedGhost for it) and
 * `redAway` says Play must not be red meanwhile; `landed` ends a flight home.
 */
export function useRedFlight({
  host,
  playButton,
  playback,
  groups,
  mutedHands,
  currentGroup,
}: RedFlightOptions): {
  flight: FlightPlan | null;
  redAway: boolean;
  /** A hop is under way: the cue it lands on is drawn in ink until it arrives. */
  hopping: boolean;
  landed: () => void;
  hop: (sec: number) => number;
} {
  const [plan, setPlan] = useState<FlightPlan | null>(null);
  const { playing, waiting, atStart } = playback;
  const playbackRef = useRef(playback);
  const optsRef = useRef({ host, playButton, groups, mutedHands });
  useLayoutEffect(() => {
    playbackRef.current = playback;
    optsRef.current = { host, playButton, groups, mutedHands };
  });

  // A flight is on screen only in the state it belongs to: out, while the lead-in runs; home,
  // while stopped. Anything else (Pause in the lead-in, Play during a flight home) ends it.
  // A hop while playing lasts the lead-in, as a flight out does; a hop while stopped, until it lands.
  const shown =
    plan !== null &&
    (plan.dir === 'out' || (plan.dir === 'hop' && plan.playing) ? playing && waiting : !playing)
      ? plan
      : null;
  const shownRef = useRef(shown);
  useLayoutEffect(() => {
    shownRef.current = shown;
  });

  // The cursor's noteheads, kept for a flight home: they stay in the page after the marks clear.
  const lastHeadsRef = useLastHeads(host, currentGroup);

  // Home: Rewind while stopped, or the end of the piece, takes the position back to the start.
  // A layout effect, so the shape replaces the cleared marks in the same paint.
  const atStartRef = useRef(atStart);
  useLayoutEffect(() => {
    const was = atStartRef.current;
    atStartRef.current = atStart;
    if (!atStart || was) return;
    const heads = liveHeads(lastHeadsRef.current);
    lastHeadsRef.current = [];
    if (playing || heads.length === 0 || prefersReducedMotion()) return;
    const button = optsRef.current.playButton();
    const note = topmost(heads);
    if (!button || !note) return;
    setPlan({ dir: 'home', button: boxOf(button), note, durationMs: RED_FLIGHT_MS });
  }, [atStart, playing, lastHeadsRef]);

  // Out: only a lead-in that Play began with the red on Play (nothing marked: not a resume, whose
  // red is on the paused cursor), never a seek or a loop wrap while playing.
  const fromPlayRef = useRef(false);
  const wasPlayingRef = useRef(playing);
  useLayoutEffect(() => {
    if (playing && !wasPlayingRef.current) fromPlayRef.current = currentGroup < 0;
    if (!playing || !waiting) fromPlayRef.current = false;
    wasPlayingRef.current = playing;
  }, [playing, waiting, currentGroup]);

  useEffect(() => {
    if (!playing || !waiting || !host || !fromPlayRef.current || prefersReducedMotion()) return;
    let raf = 0;
    const frame = () => {
      const left = playbackRef.current.leadInRemainingSec();
      if (left === null || !fromPlayRef.current) return;
      const ms = left * 1000;
      if (ms > RED_FLIGHT_MS) {
        raf = requestAnimationFrame(frame);
        return;
      }
      fromPlayRef.current = false; // one flight per lead-in
      if (ms < MIN_FLIGHT_MS) return;
      const o = optsRef.current;
      const button = o.playButton();
      const sec = playbackRef.current.positionSec();
      const note = topmost(firstHeads(host, o.groups, o.mutedHands, sec));
      if (!button || !note) return;
      setPlan({ dir: 'out', button: boxOf(button), note, durationMs: ms });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, waiting, host]);

  // A flight that is no longer shown is over.
  useLayoutEffect(() => {
    if (plan !== null && shown === null) setPlan(null);
  }, [plan, shown]);

  // A seek (T13): the red hops from where it is to the first notehead at `sec`, when both ends are
  // on screen and the cursor will not scroll the page (`cursorWouldScroll`). Called before the
  // seek, from the click or the key; returns how long the music should hold back for it (seconds,
  // 0 when nothing hops). A seek during a flight ends that flight: the red jumps.
  const hop = useCallback((sec: number): number => {
    const o = optsRef.current;
    const h = o.host;
    fromPlayRef.current = false; // a seek in Play's lead-in: the hop replaces the flight out
    if (shownRef.current !== null) {
      setPlan(null);
      return 0;
    }
    if (!h || prefersReducedMotion()) return 0;
    const heads = [...h.querySelectorAll('.is-red .notehead')];
    const button = heads.length === 0 ? o.playButton() : null;
    const from = button ? boxOf(button) : topmost(heads);
    const targets = firstHeads(h, o.groups, o.mutedHands, sec);
    const to = topmost(targets);
    if (!from || !to || !onScreen(from) || cursorWouldScroll(targets)) return 0;
    const durationMs = hopMs(Math.hypot(to.x - from.x, to.y - from.y));
    setPlan({
      dir: 'hop',
      from,
      fromNote: button === null,
      note: to,
      durationMs,
      playing: playbackRef.current.playing,
    });
    return durationMs / 1000;
  }, []);

  return {
    flight: shown,
    redAway: shown !== null,
    hopping: shown?.dir === 'hop',
    landed: () => setPlan(null),
    hop,
  };
}

/** Whether a box's centre is inside the window. */
function onScreen(b: FlightBox): boolean {
  const height = window.innerHeight || document.documentElement.clientHeight;
  const width = window.innerWidth || document.documentElement.clientWidth;
  return b.x >= 0 && b.x <= width && b.y >= 0 && b.y <= height;
}

/**
 * The red on its way: three nested boxes on a fixed layer (X, Y, then the shape itself, the one
 * red element while it flies). Started before the paint; a flight home and a hop while stopped
 * call `onLanded` when they arrive, a flight out and a hop while playing hold on the notehead
 * until the cursor takes the red.
 */
export function RedGhost({
  plan,
  onLanded,
}: {
  plan: FlightPlan;
  onLanded: () => void;
}): JSX.Element {
  const xRef = useRef<HTMLDivElement>(null);
  const yRef = useRef<HTMLDivElement>(null);
  const shapeRef = useRef<HTMLDivElement>(null);
  const landedRef = useRef(onLanded);
  useLayoutEffect(() => {
    landedRef.current = onLanded;
  });

  useLayoutEffect(() => {
    const x = xRef.current;
    const y = yRef.current;
    const shape = shapeRef.current;
    if (!x || !y || !shape) return;
    const f = flightFrames(plan);
    if (typeof shape.animate !== 'function') {
      if (plan.dir !== 'out' && !(plan.dir === 'hop' && plan.playing)) landedRef.current();
      return;
    }
    const timing = { duration: plan.durationMs, fill: 'both' as const };
    const anims = [
      x.animate(f.x, { ...timing, easing: f.xEasing }),
      y.animate(f.y, { ...timing, easing: f.yEasing }),
      shape.animate(f.shape, { ...timing, easing: EASE }),
    ];
    if (plan.dir === 'home' || (plan.dir === 'hop' && !plan.playing))
      anims[2]!.onfinish = () => landedRef.current();
    return () => anims.forEach((a) => a.cancel());
  }, [plan]);

  return (
    <div className="red-ghost no-print" aria-hidden="true" ref={xRef}>
      <div className="red-ghost-y" ref={yRef}>
        <div className="red-ghost-shape is-red" ref={shapeRef} />
      </div>
    </div>
  );
}
