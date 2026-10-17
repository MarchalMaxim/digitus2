/**
 * The playback cursor. While playing, a requestAnimationFrame loop reads the audible score time
 * from the transport, finds the onset group being heard, and when it changes swaps the `.is-red`
 * class onto that group's notes (the cursor never animates: a class swap per group is what keeps
 * it within one frame of the sound, rendering spike section 4.3). It also reports the keys held at
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
 *
 * Stopped at the start (a fresh score, Rewind while stopped, the end: `playback.atStart`) it
 * marks nothing and Play is the red element. Paused away from the start after a note was heard
 * (T10, spec 14) it marks the last group of the hands played at or before the pause position,
 * with its keys pressed and the muted hand's keys dimmed, so the reader sees where Play resumes
 * and the cursor stays the one red element. A hand switch, a re-solve or a re-layout
 * (`layoutKey`) while paused marks that moment again, or clears the marks when the hands now
 * played had no note yet (switching back marks it again). A loop set while paused that leaves
 * the pause position outside it moves where Play starts (`playback.startSec()`): nothing to
 * resume, so the marks clear and Play is red, until a loop round the position or none brings
 * them back. A pause in the lead-in of a resume
 * (Play after a pause, before the next note) still has the group heard before it to show; a
 * pause in any other lead-in (the count-in from the start, after Rewind while playing, a loop
 * wrap, a Play from a loop's start elsewhere) heard nothing of its pass, so nothing is marked.
 */
import type { Assignment, Hand, Note } from '@digitus2/engine';
import { ornamentAttacks, type OrnamentAttack } from '@digitus2/engine/ornaments';
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
  /**
   * Changes when the score's pages are laid out again (ScoreView passes doc.pages): a paused
   * cursor re-marks its group.
   */
  layoutKey?: unknown;
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

type Performances = ReadonlyMap<Note, OrnamentAttack[]>;

function phaseAt(n: Note, sec: number, performances: Performances): number {
  const attacks = performances.get(n);
  if (!attacks) return -2;
  let lo = 0;
  let hi = attacks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (attacks[mid]!.onsetSec <= sec) lo = mid + 1;
    else hi = mid;
  }
  const i = lo - 1;
  return i >= 0 && sec < attacks[i]!.offsetSec ? i : -1;
}

function keyboardPhase(notes: Note[], sec: number, performances: Performances): string {
  if (performances.size === 0) return '';
  return notes.map((n) => phaseAt(n, sec, performances)).join(',');
}

function pressedKeys(
  notes: Note[],
  assignment: Assignment | null,
  sec: number,
  performances: Performances,
): PressedKey[] {
  return notes.flatMap((n) => {
    const phase = phaseAt(n, sec, performances);
    if (phase === -1) return [];
    const midi = phase >= 0 ? performances.get(n)![phase]!.midi : n.midi;
    return [
      { midi, finger: midi === n.midi ? (assignment?.[n.id]?.finger ?? null) : null, hand: n.hand },
    ];
  });
}

function isSilentRun(): boolean {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('audio') === 'silent'
  );
}

export function useCursor({
  host,
  groups,
  playback,
  assignment,
  mutedHands,
  layoutKey,
}: CursorOptions): {
  pressed: PressedKey[];
  /** The muted hands' keys at the cursor (one-hand practice), for the keyboard to dim. */
  muted: PressedKey[];
  currentGroup: number;
  /**
   * How many of `pressed`, from the first, were struck at the group marked while playing (the
   * rest are held from earlier); 0 when paused or stopped. The keyboard strikes a key again when
   * it is struck while already down (a repeated note).
   */
  struckCount: number;
} {
  const [pressed, setPressed] = useState<PressedKey[]>([]);
  const [struckCount, setStruckCount] = useState(0);
  const [muted, setMuted] = useState<PressedKey[]>([]);
  const [currentGroup, setCurrentGroup] = useState(-1);

  const muteKey = [...new Set(mutedHands)].sort().join(',');
  const performances = useMemo(
    () =>
      new Map(
        groups.flatMap((g) =>
          g.notes.filter((n) => n.ornament).map((n) => [n, ornamentAttacks(n)] as const),
        ),
      ),
    [groups],
  );
  const { active, mutedAt } = useMemo(() => {
    const muteSet = new Set(muteKey ? muteKey.split(',') : []);
    return { active: activeGroups(groups, muteSet), mutedAt: mutedGroups(groups, muteSet) };
  }, [groups, muteKey]);

  const playing = playback.playing;
  const waiting = playback.waiting;
  const atStart = playback.atStart;
  // A loop set while paused can move where Play starts (T10): the paused marks follow it.
  const loop = playback.loop;
  const playbackRef = useRef(playback);
  const activeRef = useRef(active);
  /** The cursor's page scroll (followCursor). */
  const followRef = useRef<Follow>({ system: null, target: null, until: 0 });
  /** The `sec` of the group currently marked, NaN when nothing is. */
  const markedSecRef = useRef(Number.NaN);
  /**
   * The `sec` of the last group the cursor marked while playing: a note heard, kept through a
   * pause, a hand switch and a resume's lead-in. NaN when nothing has been heard since the start
   * or since a jump (Rewind while playing, a loop wrap, a Play that starts elsewhere).
   */
  const heardSecRef = useRef(Number.NaN);
  /**
   * Where the transport last stopped, until a group is marked again: a lead-in that starts there
   * is a resume (Play after a pause), not a jump.
   */
  const stopSecRef = useRef(Number.NaN);
  useLayoutEffect(() => {
    playbackRef.current = playback;
    activeRef.current = active;
  });

  // A layout effect: when the lead-in ends, the render that turns Pause plain and the first marks
  // (with their keys, set here) reach the screen in one paint, never a frame with no red element
  // or with red notes over unpressed keys between them.
  useLayoutEffect(() => {
    if (!host) return;
    // T10: paused after a note was heard. The last group of the hands played at or before the
    // pause position keeps the red and its keys stay pressed. A hand switch, a re-solve or a
    // re-layout while paused marks it again, or clears the marks when the hands now played had
    // no note yet; switching back marks it again, since the position to resume is unchanged. A
    // group heard after the position (a jump back in a lead-in, such as Rewind) was not heard in
    // this pass: nothing to resume. A loop set while paused that leaves the position outside it
    // makes Play start at the loop's first bar instead (`startSec`): nothing to resume there
    // either, so the marks clear and Play takes the red; a loop round the position, or none,
    // marks it again, since the position is unchanged.
    const pos = playbackRef.current.positionSec();
    if (!playing && !atStart && heardSecRef.current < pos) {
      stopSecRef.current = pos;
      clearCurrent(host);
      const resumes = Math.abs(playbackRef.current.startSec() - pos) < 1e-9;
      const i = resumes ? groupIndexAt(active, pos) : -1;
      if (i < 0) {
        markedSecRef.current = Number.NaN;
        setPressed((prev) => (prev.length > 0 ? [] : prev));
        setStruckCount(0);
        setMuted((prev) => (prev.length > 0 ? [] : prev));
        setCurrentGroup(-1);
        return;
      }
      const g = active[i]!;
      setCurrent(host, g.noteIds, g.tick);
      markedSecRef.current = g.sec;
      setPressed(pressedKeys(g.sounding, assignment, pos, performances));
      setStruckCount(0);
      const mutedNotes = mutedAt[groupIndexAt(mutedAt, pos)]?.notes ?? NO_NOTES;
      setMuted((prev) =>
        prev.length === 0 && mutedNotes.length === 0
          ? prev
          : pressedKeys(mutedNotes, assignment, pos, performances),
      );
      setCurrentGroup(g.index);
      return;
    }
    // Stopped at the start, in the lead-in (nothing to mark sounds yet), or nothing in the
    // unmuted hands to mark (a hand switch while playing): no marks left behind, no keys held.
    if (!playing || waiting || active.length === 0) {
      if (!playing) {
        // At the start, or paused before any note of this pass was heard: nothing to resume.
        heardSecRef.current = Number.NaN;
        stopSecRef.current = pos;
      } else if (waiting) {
        // A lead-in from where the transport stopped resumes there (Play after a pause): what
        // was heard stays the resume point if it pauses again before the next note. A lead-in
        // anywhere else is a jump (Rewind while playing, a loop wrap, a Play from a loop's start
        // elsewhere): nothing of the new pass has been heard yet.
        const stop = stopSecRef.current;
        const resumes = pos >= stop && groupIndexAt(active, pos) === groupIndexAt(active, stop);
        if (!resumes) heardSecRef.current = Number.NaN;
      }
      clearCurrent(host);
      markedSecRef.current = Number.NaN;
      followRef.current = { system: null, target: null, until: 0 };
      setPressed((prev) => (prev.length > 0 ? [] : prev));
      setStruckCount(0);
      setMuted((prev) => (prev.length > 0 ? [] : prev));
      setCurrentGroup(-1);
      return;
    }
    let last = -2; // forces the first frame to mark
    let shownMuted: Note[] | null = null; // forces the first frame to report the muted keys
    let shownMutedPhase = '';
    let shownPhase = '';
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
      const mutedPhase = keyboardPhase(mutedNotes, sec, performances);
      if (mutedNotes !== shownMuted || mutedPhase !== shownMutedPhase) {
        shownMuted = mutedNotes;
        shownMutedPhase = mutedPhase;
        setMuted((prev) =>
          prev.length === 0 && mutedNotes.length === 0
            ? prev
            : pressedKeys(mutedNotes, assignment, sec, performances),
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
      const g = active[i]!;
      const phase = keyboardPhase(g.sounding, sec, performances);
      if (phase !== shownPhase && i === last && !stale) {
        const previousPhases = shownPhase.split(',');
        const phases = phase.split(',');
        const struck = g.sounding.filter(
          (_n, k) => phases[k] !== previousPhases[k] && Number(phases[k]) >= 0,
        );
        const held = g.sounding.filter((n) => !struck.includes(n));
        shownPhase = phase;
        setPressed(pressedKeys([...struck, ...held], assignment, sec, performances));
        setStruckCount(struck.length);
      }
      if (i === last && !stale) return;
      clearCurrent(host);
      marked = setCurrent(host, g.noteIds, g.tick);
      page = host.firstElementChild;
      markedSecRef.current = g.sec;
      heardSecRef.current = g.sec;
      stopSecRef.current = Number.NaN; // the music has moved on: a later lead-in is a jump
      if (i === last) return;
      last = i;
      shownPhase = phase;
      followCursor(marked, followRef.current);
      setPressed(pressedKeys(g.sounding, assignment, sec, performances));
      setStruckCount(g.noteIds.length);
      setCurrentGroup(g.index);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [host, playing, waiting, atStart, loop, active, mutedAt, assignment, layoutKey, performances]);

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

  return { pressed, muted, currentGroup, struckCount };
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
