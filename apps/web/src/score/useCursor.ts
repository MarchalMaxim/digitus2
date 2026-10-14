/**
 * The playback cursor. While playing, a requestAnimationFrame loop reads the audible score time
 * from the transport, finds the onset group being heard, and when it changes swaps the `.is-red`
 * class onto that group's notes (the cursor never animates: a class swap per group is what keeps
 * it within one frame of the sound, rendering spike section 7). It also reports the keys held at
 * the cursor, with their fingers, for the on-screen keyboard: the notes struck at this onset and
 * the earlier ones still sounding (a held bass note stays pressed under a running melody). React
 * state changes only when the group changes, never on every frame.
 *
 * Groups with no note in an unmuted hand are skipped, so with one hand muted the cursor follows
 * the other hand and never lights a silent note. Before the first group (the count-in, a pickup
 * in the other hand) the cursor waits on the first notes to be played, so the screen always
 * keeps exactly one red element while playing. With no note in an unmuted hand at all there is
 * nothing to mark: the score view does not let such a selection play (`hasNotesFor`).
 */
import type { Assignment, Hand, Note } from '@digitus2/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { prefersReducedMotion } from '../design/motion.js';
import type { PressedKey } from './Keyboard.js';
import { groupIndexAt, type OnsetGroup } from './onsetGroups.js';
import { clearCurrent, setCurrent } from './render/dom.js';
import type { Playback } from './usePlayback.js';

export type { PressedKey } from './Keyboard.js';

export interface CursorOptions {
  host: Element | null;
  groups: OnsetGroup[];
  playback: Playback;
  assignment: Assignment | null;
  mutedHands: Hand[];
}

/** An onset group restricted to the unmuted hands; `index` is its place in the full list. */
interface ActiveGroup {
  index: number;
  tick: number;
  sec: number;
  noteIds: string[];
  /** The group's notes, then the unmuted notes struck earlier that still sound at its onset. */
  sounding: Note[];
}

/** What the Playwright sync check reads (installed only with `?audio=silent`). */
interface TestHook {
  positionSec(): number;
  /** The `sec` of the group the cursor marks, NaN when nothing is marked. */
  cursorSec(): number;
  /** The `sec` of every group the cursor can mark (the unmuted hands), in order. */
  groupSecs(): number[];
}

function activeGroups(groups: OnsetGroup[], muted: ReadonlySet<string>): ActiveGroup[] {
  const out: ActiveGroup[] = [];
  let held: Note[] = [];
  groups.forEach((g, index) => {
    held = held.filter((n) => n.offsetTick > g.tick);
    const notes = muted.size === 0 ? g.notes : g.notes.filter((n) => !muted.has(n.hand));
    if (notes.length === 0) return;
    out.push({
      index,
      tick: g.tick,
      sec: g.sec,
      noteIds: notes.map((n) => n.id),
      sounding: [...notes, ...held],
    });
    held = held.concat(notes);
  });
  return out;
}

function pressedKeys(notes: Note[], assignment: Assignment | null): PressedKey[] {
  return notes.map((n) => ({
    midi: n.midi,
    finger: assignment?.[n.id]?.finger ?? null,
    hand: n.hand,
  }));
}

function isSilentRun(): boolean {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('audio') === 'silent'
  );
}

export function useCursor({ host, groups, playback, assignment, mutedHands }: CursorOptions): {
  pressed: PressedKey[];
  currentGroup: number;
} {
  const [pressed, setPressed] = useState<PressedKey[]>([]);
  const [currentGroup, setCurrentGroup] = useState(-1);

  const muteKey = [...new Set(mutedHands)].sort().join(',');
  const active = useMemo(
    () => activeGroups(groups, new Set(muteKey ? muteKey.split(',') : [])),
    [groups, muteKey],
  );

  const playing = playback.playing;
  const playbackRef = useRef(playback);
  const activeRef = useRef(active);
  /** The system the view last scrolled to: the cursor scrolls at most once per system. */
  const systemRef = useRef<Element | null>(null);
  /** The `sec` of the group currently marked, NaN when nothing is. */
  const markedSecRef = useRef(Number.NaN);
  useEffect(() => {
    playbackRef.current = playback;
    activeRef.current = active;
  });

  useEffect(() => {
    if (!host) return;
    // Stopped, or nothing in the unmuted hands to mark (a hand switch while playing): no marks
    // left behind, no keys held.
    if (!playing || active.length === 0) {
      clearCurrent(host);
      markedSecRef.current = Number.NaN;
      systemRef.current = null;
      setPressed((prev) => (prev.length > 0 ? [] : prev));
      setCurrentGroup(-1);
      return;
    }
    let last = -2; // forces the first frame to mark
    let marked: Element[] = [];
    let page: Element | null = null; // the first page the marks were made on
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const i = Math.max(0, groupIndexAt(active, playbackRef.current.positionSec()));
      // New pages (a re-layout while playing) drop the marks: put them back on the same group.
      const stale =
        page !== host.firstElementChild || (marked.length > 0 && !marked[0]!.isConnected);
      if (i === last && !stale) return;
      const g = active[i]!;
      clearCurrent(host);
      marked = setCurrent(host, g.noteIds, g.tick);
      page = host.firstElementChild;
      markedSecRef.current = g.sec;
      if (i === last) return;
      last = i;
      scrollToCursor(marked[0], systemRef);
      setPressed(pressedKeys(g.sounding, assignment));
      setCurrentGroup(g.index);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [host, playing, active, assignment]);

  // Playwright's sync check: the transport clock and the group the cursor shows.
  useEffect(() => {
    if (!isSilentRun()) return;
    const w = window as unknown as { __digitus2?: TestHook };
    const hook: TestHook = {
      positionSec: () => playbackRef.current.positionSec(),
      cursorSec: () => markedSecRef.current,
      groupSecs: () => activeRef.current.map((g) => g.sec),
    };
    w.__digitus2 = hook;
    return () => {
      if (w.__digitus2 === hook) delete w.__digitus2;
    };
  }, []);

  return { pressed, currentGroup };
}

/**
 * Brings the cursor into view when it moves to another system and is outside the viewport, less
 * the page's bottom scroll padding (the sticky keyboard covers that strip). Smooth unless the
 * reader asked for reduced motion.
 */
function scrollToCursor(el: Element | undefined, systemRef: { current: Element | null }): void {
  if (!el) return;
  const system = el.closest('g.system') ?? el;
  if (system === systemRef.current) return;
  systemRef.current = system;
  const rect = el.getBoundingClientRect();
  const root = document.documentElement;
  const covered = parseFloat(getComputedStyle(root).scrollPaddingBottom) || 0;
  const bottom = (window.innerHeight || root.clientHeight) - covered;
  if (rect.top >= 0 && rect.bottom <= bottom) return;
  el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}
