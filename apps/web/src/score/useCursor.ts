/**
 * The playback cursor. While playing, a requestAnimationFrame loop reads the audible score time
 * from the transport, finds the onset group being heard, and when it changes swaps the `.is-red`
 * class onto that group's notes (the cursor never animates: a class swap per group is what keeps
 * it within one frame of the sound, rendering spike section 7). It also reports the keys held at
 * the cursor, with their fingers, for the on-screen keyboard: the notes struck at this onset and
 * the earlier ones still sounding (a held bass note stays pressed under a running melody). React
 * state changes only when the group changes, never on every frame. On each group change it also
 * scrolls the page when the cursor's system or its red notes are not wholly above the dock
 * (`cursorScrollDelta`), so the red note is never left playing under it.
 *
 * Groups with no note in an unmuted hand are skipped, so with one hand muted the cursor follows
 * the other hand and never lights a silent note. The muted hands' keys are followed apart, at
 * every onset of either hand (`mutedGroups`): at the time being heard, the notes they strike
 * there and the ones they still hold. They are reported as `muted`, for the keyboard to draw
 * dimmed: the reader sees what the other hand plays as it plays it (it can move while the hand
 * played holds a note), and the pressed keys stay the played hand's. Like the pressed keys they
 * change only when the onset heard changes, never on every frame.
 *
 * In the lead-in (`playback.waiting`: from Play, a seek, or a loop wrap to a start where the
 * hands played rest, until the transport reports the first note of the hands played heard,
 * through the start delay, the count-in, and a rest or the other hand's pickup before that note)
 * it marks nothing and presses or dims no key: a note never turns red before it sounds, and
 * Pause is the screen's one red element meanwhile (Transport.tsx), so the screen keeps exactly
 * one while playing. With no note in an unmuted hand at all there is nothing to mark: the score
 * view does not let such a selection play (`hasNotesFor`).
 */
import type { Assignment, Hand, Note } from '@digitus2/engine';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

/** The muted hands' notes at one onset of either hand (`mutedGroups`). */
interface MutedGroup {
  sec: number;
  /** Struck at this onset, then struck earlier and still held. */
  notes: Note[];
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
    if (notes.length > 0) {
      out.push({
        index,
        tick: g.tick,
        sec: g.sec,
        noteIds: notes.map((n) => n.id),
        sounding: [...notes, ...held],
      });
    }
    held = held.concat(notes);
  });
  return out;
}

const NO_NOTES: Note[] = [];

/**
 * The muted hands' notes at every onset group of the full list (none when no hand is muted):
 * the notes they strike there, then the ones struck earlier that still sound. Their keys follow
 * their own onsets, not only the played hand's: the played hand can hold a note while the other
 * moves (Twinkle's left hand holds a whole note under C C G G). Consecutive groups holding the
 * same notes share one array, so the cursor reports a change only when there is one.
 */
function mutedGroups(groups: readonly OnsetGroup[], muted: ReadonlySet<string>): MutedGroup[] {
  if (muted.size === 0) return [];
  const out: MutedGroup[] = [];
  let sounding = NO_NOTES;
  for (const g of groups) {
    const struck = g.notes.filter((n) => muted.has(n.hand));
    const held = sounding.filter((n) => n.offsetTick > g.tick);
    if (struck.length > 0 || held.length < sounding.length) sounding = [...struck, ...held];
    out.push({ sec: g.sec, notes: sounding });
  }
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
  /** The muted hands' keys at the cursor (one-hand practice), for the keyboard to dim. */
  muted: PressedKey[];
  currentGroup: number;
} {
  const [pressed, setPressed] = useState<PressedKey[]>([]);
  const [muted, setMuted] = useState<PressedKey[]>([]);
  const [currentGroup, setCurrentGroup] = useState(-1);

  const muteKey = [...new Set(mutedHands)].sort().join(',');
  const { active, mutedAt } = useMemo(() => {
    const muteSet = new Set(muteKey ? muteKey.split(',') : []);
    return { active: activeGroups(groups, muteSet), mutedAt: mutedGroups(groups, muteSet) };
  }, [groups, muteKey]);

  const playing = playback.playing;
  const waiting = playback.waiting;
  const playbackRef = useRef(playback);
  const activeRef = useRef(active);
  /** The cursor's page scroll (followCursor). */
  const followRef = useRef<Follow>({ system: null, target: null, until: 0 });
  /** The `sec` of the group currently marked, NaN when nothing is. */
  const markedSecRef = useRef(Number.NaN);
  useLayoutEffect(() => {
    playbackRef.current = playback;
    activeRef.current = active;
  });

  // A layout effect: when the lead-in ends, the render that turns Pause plain and the first marks
  // (with their keys, set here) reach the screen in one paint, never a frame with no red element
  // or with red notes over unpressed keys between them.
  useLayoutEffect(() => {
    if (!host) return;
    // Stopped, in the lead-in (nothing to mark sounds yet), or nothing in the unmuted hands to
    // mark (a hand switch while playing): no marks left behind, no keys held.
    if (!playing || waiting || active.length === 0) {
      clearCurrent(host);
      markedSecRef.current = Number.NaN;
      followRef.current = { system: null, target: null, until: 0 };
      setPressed((prev) => (prev.length > 0 ? [] : prev));
      setMuted((prev) => (prev.length > 0 ? [] : prev));
      setCurrentGroup(-1);
      return;
    }
    let last = -2; // forces the first frame to mark
    let shownMuted: Note[] | null = null; // forces the first frame to report the muted keys
    let marked: Element[] = [];
    let page: Element | null = null; // the first page the marks were made on
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const pb = playbackRef.current;
      // A loop wrap to a start where the hands played rest begins a lead-in the moment it is
      // heard, but `waiting` only follows on the transport's next tick (up to 25 ms later): keep
      // the marks of the pass that just ended until then, never mark a note of the new pass early.
      if (pb.leadingIn()) return;
      const sec = pb.positionSec();
      // The muted hands' keys at the time heard, at their own onsets as well as the played
      // hands' (`mutedGroups`): a new array only when they change.
      const mutedNotes = mutedAt[groupIndexAt(mutedAt, sec)]?.notes ?? NO_NOTES;
      if (mutedNotes !== shownMuted) {
        shownMuted = mutedNotes;
        setMuted((prev) =>
          prev.length === 0 && mutedNotes.length === 0 ? prev : pressedKeys(mutedNotes, assignment),
        );
      }
      // Out of a lead-in (from Play, a seek or a loop wrap) a note of the hands played has been
      // heard since the start of the pass, so the clock is at the onset of a group of that pass
      // or later. Only a hand switch while playing, to a hand whose next note is still to come,
      // can put it before that hand's first group (`groupIndexAt` gives -1) or on a group before
      // the pass; the floor then marks the hand's first group early (docs/app.md, known
      // limitations).
      const i = Math.max(0, groupIndexAt(active, sec));
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
      followCursor(marked, followRef.current);
      setPressed(pressedKeys(g.sounding, assignment));
      setCurrentGroup(g.index);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [host, playing, waiting, active, mutedAt, assignment]);

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

  return { pressed, muted, currentGroup };
}

/** A vertical extent in viewport pixels. */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * How far the page scrolls (pixels, down is positive) to keep the cursor readable, or null to
 * stay put. `band` is the part of the window that no sticky bar covers (the page's scroll
 * padding: the dock at the bottom). `system` is the system the cursor is in and `cursor` its red
 * notes; `systemChanged` says the cursor has just entered that system.
 *
 * The page scrolls when the cursor enters a system that is not wholly in the band (even when its
 * first notes are: the rest of the system, the left hand's staff, would play under the dock), or
 * when the red notes leave the band. It then centres the system in the band. A system taller
 * than the band gets its top at the band's top instead, or, when the red notes would still be
 * outside the band there (or are later in that system), the red notes are centred.
 */
export function cursorScrollDelta(
  system: Span,
  cursor: Span,
  systemChanged: boolean,
  band: Span,
): number | null {
  const inBand = (s: Span, shift = 0) =>
    s.top - shift >= band.top && s.bottom - shift <= band.bottom;
  if (inBand(cursor) && (!systemChanged || inBand(system))) return null;
  const room = band.bottom - band.top;
  const centre = (s: Span) => s.top - (band.top + (room - (s.bottom - s.top)) / 2);
  if (system.bottom - system.top <= room) return centre(system);
  const start = system.top - band.top;
  return systemChanged && inBand(cursor, start) ? start : centre(cursor);
}

/** The cursor's page scroll between frames: the system it is in, and its last scroll. */
interface Follow {
  system: Element | null;
  /** The `scrollY` the cursor's last scroll heads for, trusted until it lands or `until` passes. */
  target: number | null;
  until: number;
}

/** How long a smooth scroll may take before its target is no longer trusted (ms). */
const SMOOTH_SCROLL_MS = 1500;

/**
 * Keeps the marked notes and their system readable above the dock (`cursorScrollDelta`), called
 * once per onset group: one style read and a few `getBoundingClientRect` calls, never per frame.
 * The band is the window less the page's scroll padding (the dock's measured height at the
 * bottom, base.css). While a smooth scroll is under way the layout is judged where that scroll
 * will leave it, so the notes that follow do not cut it short. Smooth unless the reader asked for
 * reduced motion.
 */
function followCursor(marked: Element[], follow: Follow): void {
  const first = marked[0];
  if (!first) return;
  const system = first.closest('g.system') ?? first;
  const systemChanged = system !== follow.system;
  follow.system = system;

  const root = document.documentElement;
  const style = getComputedStyle(root);
  const viewport = window.innerHeight || root.clientHeight;
  const band = {
    top: parseFloat(style.scrollPaddingTop) || 0,
    bottom: viewport - (parseFloat(style.scrollPaddingBottom) || 0),
  };
  const now = performance.now();
  const y = window.scrollY;
  const target = follow.target;
  const from = target !== null && now < follow.until && Math.abs(target - y) > 1 ? target : y;
  const at = (r: Span): Span => ({ top: r.top + y - from, bottom: r.bottom + y - from });
  const rects = marked.map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0);
  const cursor =
    rects.length > 0
      ? {
          top: Math.min(...rects.map((r) => r.top)),
          bottom: Math.max(...rects.map((r) => r.bottom)),
        }
      : system.getBoundingClientRect();
  const delta = cursorScrollDelta(
    at(system.getBoundingClientRect()),
    at(cursor),
    systemChanged,
    band,
  );
  if (delta === null) return;
  const max = Math.max(0, root.scrollHeight - root.clientHeight);
  const top = Math.min(max, Math.max(0, from + delta));
  if (Math.abs(top - from) < 1) return; // already as far as the page goes
  const smooth = !prefersReducedMotion();
  window.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  follow.target = top;
  follow.until = now + (smooth ? SMOOTH_SCROLL_MS : 0);
}
