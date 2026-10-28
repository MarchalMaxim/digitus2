/**
 * The bars that show every digit (issue 94). At rest the score prints the edition's digits and
 * hides the spare ones (base.css, `.is-spare`); a bar that is open (`.is-open` on its `g.measure`)
 * shows them all, fading in over `--dur` and out again when it closes. Three things open a bar:
 * the cursor's, whenever a note is marked (playing, paused, a cue after a click, tap or arrow
 * key, the play-along walk's waiting step) and the red is not still hopping there; while playing,
 * the next bar too once the cursor is on the last onset group of its own, so the downbeat's digit
 * is in full ink when it sounds; and the bar under a mouse pointer (BarSeek's `onHover`). Bars are
 * the drawn `g.measure`, numbered as BarSeek numbers them, never `measureIndex`.
 *
 * Only the bars that change are touched. A new layout drops the classes with the pages, so it is
 * keyed on `pages`; a windowed page built later is given the open bars on it by `decorate`.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';
import type { Hand } from '@digitus2/engine';
import { durationMs, prefersReducedMotion } from '../design/motion.js';
import type { OnsetGroup } from './onsetGroups.js';
import type { LoopRange } from './usePlayback.js';
import { barOfNote, barOrdinal, setOpenBars, settleClosing } from './render/dom.js';

const NONE: ReadonlySet<number> = new Set();

export interface OpenBarsInput {
  host: Element | null;
  /** Changes when the pages are laid out again (ScoreView passes doc.pages). */
  pages: unknown;
  groups: readonly OnsetGroup[];
  /** The onset group marked, -1 when none. */
  currentGroup: number;
  /** The red is hopping to the cue the cursor marks: it has not landed in that bar yet. */
  hopping: boolean;
  playing: boolean;
  /** The bar under a mouse pointer (BarSeek), or null. */
  hovered: number | null;
  /** The hands left out of one-hand practice: the cursor skips onsets only they play. */
  mutedHands?: readonly Hand[];
  /** The loop being practised: its last group is followed by its first. */
  loop?: LoopRange | null;
}

/** Whether a group has a note an unmuted hand plays: the cursor only stops on those. */
function played(g: OnsetGroup, muted: readonly Hand[]): boolean {
  return g.notes.some((n) => !muted.includes(n.hand));
}

/** The group the cursor moves to after `current`, wrapping to the loop's first inside a loop. */
function groupAfter(i: OpenBarsInput): OnsetGroup | undefined {
  const muted = i.mutedHands ?? [];
  let next: OnsetGroup | undefined;
  for (let k = i.currentGroup + 1; k < i.groups.length; k++) {
    if (played(i.groups[k]!, muted)) {
      next = i.groups[k];
      break;
    }
  }
  const loop = i.loop;
  if (loop && (!next || next.notes[0]!.measureIndex > loop.to)) {
    return i.groups.find((g) => g.notes[0]!.measureIndex >= loop.from && played(g, muted));
  }
  return next;
}

let durCache: { reduced: boolean; ms: number } | null = null;
/** `--dur` in ms, read from the stylesheet once per reduced-motion setting, not per cursor step. */
function fadeMs(): number {
  const reduced = prefersReducedMotion();
  if (durCache?.reduced !== reduced) durCache = { reduced, ms: durationMs('--dur', 160) };
  return durCache.ms;
}

/** The ordinals of the bars carrying `.is-open` in the DOM now. */
function openInDom(host: Element): Set<number> {
  const out = new Set<number>();
  for (const m of host.querySelectorAll('g.measure.is-open')) {
    const bar = barOrdinal(host, m);
    if (bar !== null) out.add(bar);
  }
  return out;
}

/** The bars to open: the ordinals of the drawn bars. */
export function wantedBars(i: OpenBarsInput & { host: Element }): Set<number> {
  const want = new Set<number>();
  if (i.currentGroup >= 0 && !i.hopping) {
    const red = i.host.querySelector('.is-red');
    const bar = red ? barOrdinal(i.host, red) : null;
    if (bar !== null) {
      want.add(bar);
      const next = i.playing ? groupAfter(i)?.noteIds[0] : undefined;
      if (next !== undefined) {
        const ahead = barOfNote(i.host, next);
        if (ahead !== null && ahead !== bar) want.add(ahead);
      }
    }
  }
  if (i.hovered !== null) want.add(i.hovered);
  return want;
}

/** Returns `decorate`, which opens the bars of a page built after the layout. */
export function useOpenBars(input: OpenBarsInput): (page: SVGSVGElement) => void {
  const { host, pages, groups, currentGroup, hopping, playing, hovered, mutedHands, loop } = input;
  const appliedRef = useRef<{ host: Element | null; pages: unknown; open: ReadonlySet<number> }>({
    host: null,
    pages: null,
    open: NONE,
  });
  const timers = useRef(new Map<Element, ReturnType<typeof setTimeout>>());

  useLayoutEffect(() => {
    if (!host) return;
    const was = appliedRef.current;
    const now = wantedBars({
      host,
      pages,
      groups,
      currentGroup,
      hopping,
      playing,
      hovered,
      ...(mutedHands ? { mutedHands } : {}),
      loop: loop ?? null,
    });
    const same = was.host === host && was.pages === pages;
    const dur = fadeMs();
    // After a new layout the record is of the old pages. A page the cursor built before this
    // effect ran was decorated from it, so what is open is read from the markup instead.
    const closing = setOpenBars(host, same ? was.open : openInDom(host), now, dur > 0);
    for (const el of closing) {
      clearTimeout(timers.current.get(el));
      timers.current.set(
        el,
        setTimeout(() => {
          timers.current.delete(el);
          settleClosing([el]);
        }, dur + 40),
      );
    }
    // A bar opened again stops closing.
    for (const [el, timer] of timers.current) {
      if (el.classList.contains('is-open')) {
        clearTimeout(timer);
        timers.current.delete(el);
      }
    }
    appliedRef.current = { host, pages, open: now };
  }, [host, pages, groups, currentGroup, hopping, playing, hovered, mutedHands, loop]);

  useLayoutEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  return useCallback((page: SVGSVGElement) => {
    const { open } = appliedRef.current;
    if (open.size === 0) return;
    const first = Number(page.getAttribute('data-first-bar'));
    const count = Number(page.getAttribute('data-bars'));
    if (!Number.isFinite(first) || !Number.isFinite(count)) return;
    const measures = page.querySelectorAll('g.measure');
    for (const bar of open) {
      if (bar >= first && bar < first + count) measures[bar - first]?.classList.add('is-open');
    }
  }, []);
}
