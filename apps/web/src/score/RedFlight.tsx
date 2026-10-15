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
 */
import type { Hand } from '@digitus2/engine';
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { EASE, prefersReducedMotion, RED_FLIGHT_MS } from '../design/motion.js';
import type { OnsetGroup } from './onsetGroups.js';
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

export interface FlightPlan {
  /** 'out': from Play to the first notehead; 'home': from the last notehead heard to Play. */
  dir: 'out' | 'home';
  /** Play's box. */
  button: FlightBox;
  /** The notehead's box. */
  note: FlightBox;
  durationMs: number;
}

function boxOf(el: Element): FlightBox {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

/** Of several noteheads (a chord, both hands), the highest on the page. */
function topmost(heads: readonly Element[]): FlightBox | null {
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
  const shape = (b: FlightBox, round: boolean): Keyframe => ({
    width: `${b.w}px`,
    height: `${round ? b.h * 0.8 : b.h}px`,
    marginLeft: `${-b.w / 2}px`,
    marginTop: `${-(round ? b.h * 0.8 : b.h) / 2}px`,
    borderRadius: round ? '50%' : '0%',
    transform: `rotate(${round ? -20 : 0}deg)`,
  });
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
}: RedFlightOptions): { flight: FlightPlan | null; redAway: boolean; landed: () => void } {
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
  const shown = plan !== null && (plan.dir === 'out' ? playing && waiting : !playing) ? plan : null;

  // The cursor's noteheads, kept for a flight home: they stay in the page after the marks clear.
  const lastHeadsRef = useRef<Element[]>([]);
  useLayoutEffect(() => {
    if (host && currentGroup >= 0)
      lastHeadsRef.current = [...host.querySelectorAll('.is-red .notehead')];
  }, [host, currentGroup]);

  // Home: Rewind while stopped, or the end of the piece, takes the position back to the start.
  // A layout effect, so the shape replaces the cleared marks in the same paint.
  const atStartRef = useRef(atStart);
  useLayoutEffect(() => {
    const was = atStartRef.current;
    atStartRef.current = atStart;
    if (!atStart || was) return;
    const heads = lastHeadsRef.current.filter((h) => h.isConnected);
    lastHeadsRef.current = [];
    if (playing || heads.length === 0 || prefersReducedMotion()) return;
    const button = optsRef.current.playButton();
    const note = topmost(heads);
    if (!button || !note) return;
    setPlan({ dir: 'home', button: boxOf(button), note, durationMs: RED_FLIGHT_MS });
  }, [atStart, playing]);

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

  return { flight: shown, redAway: shown !== null, landed: () => setPlan(null) };
}

/**
 * The red on its way: three nested boxes on a fixed layer (X, Y, then the shape itself, the one
 * red element while it flies). Started before the paint; a flight home calls `onLanded` when it
 * arrives, a flight out holds on the notehead until the cursor takes the red.
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
      if (plan.dir === 'home') landedRef.current();
      return;
    }
    const timing = { duration: plan.durationMs, fill: 'both' as const };
    const anims = [
      x.animate(f.x, { ...timing, easing: f.xEasing }),
      y.animate(f.y, { ...timing, easing: f.yEasing }),
      shape.animate(f.shape, { ...timing, easing: EASE }),
    ];
    if (plan.dir === 'home') anims[2]!.onfinish = () => landedRef.current();
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
