import { readFileSync } from 'node:fs';
import { parseMusicXml, type Hand } from '@digitus2/engine';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOnsetGroups, type OnsetGroup } from './onsetGroups.js';
import { cursorScrollDelta, useCursor } from './useCursor.js';
import type { CountIn, Playback } from './usePlayback.js';

afterEach(cleanup);

// Under happy-dom, Vite's asset plugin rewrites a literal `new URL('…', import.meta.url)` into
// an http URL; a path held in a variable is left alone and stays a file URL.
const SHORT_PIANO = '../../fixtures/short-piano.musicxml';
const PICKUP_PIANO = '../../fixtures/pickup-piano.musicxml';

function groupsOf(path: string): OnsetGroup[] {
  const xml = readFileSync(new URL(path, import.meta.url), 'utf8');
  return buildOnsetGroups(parseMusicXml(xml).score);
}

/** 4/4 at 96 qpm, both hands from the first beat (n0, n5, n6 and n7 at 0 s; the next onset at 0.625 s). */
const BOTH_AT_ONCE = groupsOf(SHORT_PIANO);
/** 3/4 at 100 qpm: the right hand's pickup D4 alone at 0 s, then both hands at 0.6 s (G2 in the left). */
const PICKUP = groupsOf(PICKUP_PIANO);

/** A host holding one `g.note` per note of `groups`, as the rendered score has them. */
function hostFor(groups: OnsetGroup[]): HTMLDivElement {
  const host = document.createElement('div');
  const notes = groups.flatMap((g) => g.noteIds.map((id) => `<g class="note" id="${id}"></g>`));
  host.innerHTML = `<svg><g class="system">${notes.join('')}</g></svg>`;
  document.body.append(host);
  return host;
}

/**
 * A playing transport as usePlayback reports it, the clock held at `sec` (or read from `clock`
 * on every frame, with the transport's own lead-in, when given).
 */
function playing({
  countIn = null,
  waiting = countIn !== null,
  sec = 0,
  clock,
}: {
  countIn?: CountIn | null;
  waiting?: boolean;
  sec?: number;
  clock?: { sec: number; leadingIn: boolean };
}): Playback {
  return {
    playing: true,
    loading: false,
    countIn,
    waiting,
    play: vi.fn(),
    pause: vi.fn(),
    rewind: vi.fn(),
    positionSec: () => clock?.sec ?? sec,
    leadingIn: () => clock?.leadingIn ?? waiting,
    loop: null,
    setLoop: vi.fn(),
  };
}

const marked = (host: Element) => [...host.querySelectorAll('.is-red')].map((el) => el.id);

// Polish plan Task 3 (review S3): the count-in lit the first notes and their keys 2.4 s before
// they sounded. During the count-in the cursor now marks nothing; Pause is the red element.
describe('the cursor during the count-in', () => {
  it('marks no note and presses no key until the count-in is over, then marks the first notes', () => {
    const groups = BOTH_AT_ONCE.slice(0, 2);
    const host = hostFor(groups);
    const { result, rerender } = renderHook(
      (playback: Playback) =>
        useCursor({ host, groups, playback, assignment: null, mutedHands: [] }),
      { initialProps: playing({ countIn: { beat: 2, beats: 4, beatInBar: 3 } }) },
    );
    expect(host.querySelectorAll('.is-red')).toHaveLength(0);
    expect(result.current.pressed).toEqual([]);
    expect(result.current.currentGroup).toBe(-1);

    rerender(playing({ sec: 0.01 })); // the first notes are heard
    expect([...marked(host)].sort()).toEqual(['n0', 'n5', 'n6', 'n7']);
    expect(marked(host)).toEqual(groups[0]!.noteIds);
    expect(result.current.pressed.map((k) => k.midi)).toEqual(groups[0]!.notes.map((n) => n.midi));
    expect(result.current.currentGroup).toBe(0);
    host.remove();
  });
});

// Polish plan Task 3 review (the blocker): with the left hand alone after the right hand's
// pickup, the first left-hand note turned red about 580 ms before it sounded, once the count-in
// (or, without one, Play) had passed the start. The cursor now waits for the lead-in to end: the
// first note of the hands played is heard.
describe('the cursor in the lead-in', () => {
  it('marks nothing while the first note of the hands played is still to come, then marks that note', () => {
    const groups = PICKUP.slice(0, 2);
    expect(groups[0]!.notes.map((n) => n.hand)).toEqual(['R']); // the pickup
    const left = groups[1]!.notes.filter((n) => n.hand === 'L');
    expect(left.map((n) => n.midi)).toEqual([43]); // G2 at 0.6 s
    const host = hostFor(groups);
    const mutedHands: Hand[] = ['R'];
    const { result, rerender } = renderHook(
      (playback: Playback) => useCursor({ host, groups, playback, assignment: null, mutedHands }),
      { initialProps: playing({ waiting: true, sec: 0.019 }) }, // the count-in is over
    );
    expect(host.querySelectorAll('.is-red')).toHaveLength(0);
    expect(result.current.pressed).toEqual([]);
    expect(result.current.currentGroup).toBe(-1);

    rerender(playing({ waiting: true, sec: 0.59 }));
    expect(host.querySelectorAll('.is-red')).toHaveLength(0);
    expect(result.current.pressed).toEqual([]);

    rerender(playing({ waiting: false, sec: 0.61 })); // G2 is heard
    expect(marked(host)).toEqual(left.map((n) => n.id));
    expect(result.current.pressed).toEqual([{ midi: 43, finger: null, hand: 'L' }]);
    expect(result.current.currentGroup).toBe(1);
    host.remove();
  });
});

// Polish plan Task 3 review: Happy Birthday's left hand alone, looping from the pickup bar. After
// every wrap the left hand's first chord was red, with its keys, through the muted pickup, 0.6 s
// before it sounded. The transport now leads in from the moment the wrap is heard; until its next
// tick reports it (`waiting`), the cursor keeps the marks of the pass that just ended.
describe('the cursor at a loop wrap', () => {
  it('keeps the last marks until the lead-in is reported, then marks nothing until the first note of the new pass is heard', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const nextFrame = () => act(() => frames.splice(0).forEach((cb) => cb(0)));
    try {
      const groups = PICKUP;
      const left = groups
        .map((g) => ({ sec: g.sec, ids: g.notes.filter((n) => n.hand === 'L').map((n) => n.id) }))
        .filter((g) => g.ids.length > 0);
      // Looping the pickup bar to bar 2 (0 to 4.2 s): the left hand plays G2 at 0.6 s and D3 at
      // 2.4 s, and rests under the pickup at the loop's start.
      const first = left[0]!;
      const last = left.filter((g) => g.sec < 4.2).at(-1)!;
      expect(first.sec).toBeCloseTo(0.6, 9);
      expect(last.sec).toBeCloseTo(2.4, 9);
      const host = hostFor(groups);
      const mutedHands: Hand[] = ['R'];
      const clock = { sec: first.sec + 0.01, leadingIn: false };
      const { result, rerender } = renderHook(
        (playback: Playback) => useCursor({ host, groups, playback, assignment: null, mutedHands }),
        { initialProps: playing({ clock }) },
      );
      expect(marked(host)).toEqual(first.ids);
      clock.sec = last.sec + 0.01;
      nextFrame();
      expect(marked(host)).toEqual(last.ids);
      const lastKeys = result.current.pressed;
      expect(lastKeys.length).toBeGreaterThan(0);

      // The wrap is heard: the clock is back at the loop's start, where the left hand rests. The
      // transport knows the lead-in at once; the cursor keeps the marks and keys it has (D3),
      // where it used to mark G2, 0.6 s before it sounds.
      clock.sec = 0.01;
      clock.leadingIn = true;
      nextFrame();
      nextFrame();
      expect(marked(host)).toEqual(last.ids);
      expect(result.current.pressed).toEqual(lastKeys);

      // The transport's tick reports it: nothing is marked, no key pressed (Pause takes the red).
      rerender(playing({ clock, waiting: true }));
      expect(host.querySelectorAll('.is-red')).toHaveLength(0);
      expect(result.current.pressed).toEqual([]);
      expect(result.current.currentGroup).toBe(-1);
      clock.sec = 0.59;
      nextFrame();
      expect(host.querySelectorAll('.is-red')).toHaveLength(0);

      // G2 is heard and the lead-in ends: the first chord of the new pass is marked.
      clock.sec = 0.61;
      clock.leadingIn = false;
      rerender(playing({ clock, waiting: false }));
      expect(marked(host)).toEqual(first.ids);
      expect(result.current.pressed.map((k) => k.hand)).toEqual(['L']);
      host.remove();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// Polish plan Task 4 (review S10): with one hand muted the keyboard showed nothing of it. The
// cursor also reports the muted hand's keys at the time heard (struck at an onset of either hand
// or still held), for the keyboard to draw dimmed; the pressed keys stay the played hand's alone.
describe('the muted hand at the cursor', () => {
  it("reports the muted hand's sounding keys apart from the pressed ones, and none when stopped", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const nextFrame = () => act(() => frames.splice(0).forEach((cb) => cb(0)));
    try {
      const groups = BOTH_AT_ONCE;
      const notes = groups.flatMap((g) => g.notes);
      /** The left hand's keys sounding at `tick`, by pitch. */
      const leftAt = (tick: number) =>
        notes
          .filter((n) => n.hand === 'L' && n.onsetTick <= tick && n.offsetTick > tick)
          .map((n) => ({ midi: n.midi, finger: null, hand: 'L' }))
          .sort((a, b) => a.midi - b.midi);
      const byMidi = (keys: { midi: number }[]) => [...keys].sort((a, b) => a.midi - b.midi);
      // A later onset where the right hand strikes alone while the left hand holds a note.
      const held = groups.findIndex(
        (g, i) => i > 0 && g.notes.every((n) => n.hand === 'R') && leftAt(g.tick).length > 0,
      );
      expect(held).toBeGreaterThan(0);
      const host = hostFor(groups);
      const mutedHands: Hand[] = ['L'];
      const clock = { sec: 0.01, leadingIn: false };
      const { result, rerender } = renderHook(
        (playback: Playback) => useCursor({ host, groups, playback, assignment: null, mutedHands }),
        { initialProps: playing({ clock }) },
      );
      // The first onset, both hands struck: the right hand's keys pressed, the left hand's muted.
      const first = groups[0]!;
      const right = first.notes.filter((n) => n.hand === 'R');
      expect(right.length).toBeGreaterThan(0);
      expect(result.current.pressed.map((k) => k.hand)).toEqual(right.map(() => 'R'));
      expect(result.current.muted.length).toBeGreaterThan(0);
      expect(byMidi(result.current.muted)).toEqual(leftAt(first.tick));
      expect(marked(host)).toEqual(right.map((n) => n.id));

      // The right hand alone while the left hand holds: the held left keys are still reported.
      clock.sec = groups[held]!.sec + 0.01;
      nextFrame();
      expect(result.current.currentGroup).toBe(held);
      expect(byMidi(result.current.muted)).toEqual(leftAt(groups[held]!.tick));
      expect(result.current.pressed.every((k) => k.hand === 'R')).toBe(true);

      // Stopped: nothing pressed, nothing muted.
      rerender({ ...playing({ clock }), playing: false });
      expect(result.current.pressed).toEqual([]);
      expect(result.current.muted).toEqual([]);
      host.remove();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Task 4 review (the blocker): the muted hand's keys changed only at the onsets of the hand
  // played, so while that hand held a note the keyboard kept a key the other hand had left
  // (Twinkle's left hand alone: C4 dimmed through all of bar 1 under C C G G). They now follow
  // the muted hand's own onsets.
  it("follows the muted hand's own onsets while the hand played holds a note", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const nextFrame = () => act(() => frames.splice(0).forEach((cb) => cb(0)));
    try {
      const groups = BOTH_AT_ONCE;
      const notes = groups.flatMap((g) => g.notes);
      /** The right hand's keys sounding at `tick`, by pitch. */
      const rightAt = (tick: number) =>
        notes
          .filter((n) => n.hand === 'R' && n.onsetTick <= tick && n.offsetTick > tick)
          .map((n) => ({ midi: n.midi, finger: null, hand: 'R' }))
          .sort((a, b) => a.midi - b.midi);
      const byMidi = (keys: { midi: number }[]) => [...keys].sort((a, b) => a.midi - b.midi);
      // The first onset after the start where the right hand strikes alone: the left hand, the
      // one played, holds its first chord through it.
      const alone = groups.findIndex((g, i) => i > 0 && g.notes.every((n) => n.hand === 'R'));
      expect(alone).toBeGreaterThan(0);
      const played = groups
        .slice(0, alone)
        .map((g, i) => (g.notes.some((n) => n.hand === 'L') ? i : -1))
        .reduce((a, b) => Math.max(a, b), -1);
      expect(played).toBeGreaterThanOrEqual(0);
      // The right hand has moved since: the keys the old cursor kept are not the ones sounding.
      expect(rightAt(groups[alone]!.tick)).not.toEqual(rightAt(groups[played]!.tick));
      const host = hostFor(groups);
      const mutedHands: Hand[] = ['R'];
      const clock = { sec: groups[played]!.sec + 0.01, leadingIn: false };
      const { result } = renderHook(
        (playback: Playback) => useCursor({ host, groups, playback, assignment: null, mutedHands }),
        { initialProps: playing({ clock }) },
      );
      expect(result.current.currentGroup).toBe(played);
      expect(byMidi(result.current.muted)).toEqual(rightAt(groups[played]!.tick));
      const pressed = result.current.pressed;
      expect(pressed.length).toBeGreaterThan(0);
      expect(pressed.every((k) => k.hand === 'L')).toBe(true);

      // The right hand strikes alone: its keys follow; the cursor and the pressed keys stay.
      clock.sec = groups[alone]!.sec + 0.01;
      nextFrame();
      expect(byMidi(result.current.muted)).toEqual(rightAt(groups[alone]!.tick));
      expect(result.current.currentGroup).toBe(played);
      expect(result.current.pressed).toBe(pressed);
      expect(marked(host)).toEqual(
        groups[played]!.notes.filter((n) => n.hand === 'L').map((n) => n.id),
      );

      // A frame at the same onset changes nothing (no new state, no render).
      const muted = result.current.muted;
      nextFrame();
      expect(result.current.muted).toBe(muted);
      host.remove();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports no muted keys when both hands play', () => {
    const groups = BOTH_AT_ONCE.slice(0, 2);
    const host = hostFor(groups);
    const { result } = renderHook(() =>
      useCursor({
        host,
        groups,
        playback: playing({ sec: 0.01 }),
        assignment: null,
        mutedHands: [],
      }),
    );
    expect(result.current.pressed).toHaveLength(groups[0]!.notes.length);
    expect(result.current.muted).toEqual([]);
    host.remove();
  });
});

// The band is the part of the window no sticky bar covers: here a 750 px window less a 150 px dock.
const band = { top: 0, bottom: 600 };

describe('the cursor scroll', () => {
  it('stays put while the new system is wholly above the dock', () => {
    expect(
      cursorScrollDelta({ top: 100, bottom: 300 }, { top: 120, bottom: 140 }, true, band),
    ).toBe(null);
  });

  it('centres a new system that reaches under the dock, even when its first notes are above it', () => {
    // 250 px tall in a 600 px band: its top goes to 175.
    expect(
      cursorScrollDelta({ top: 450, bottom: 700 }, { top: 460, bottom: 480 }, true, band),
    ).toBe(275);
  });

  it('within a system, scrolls only when the red notes leave the band, and then centres the system', () => {
    const system = { top: 450, bottom: 700 };
    expect(cursorScrollDelta(system, { top: 460, bottom: 480 }, false, band)).toBe(null);
    // The left hand's notes, lower in the same system, under the dock.
    expect(cursorScrollDelta(system, { top: 620, bottom: 640 }, false, band)).toBe(275);
    // Partly under it is under it.
    expect(cursorScrollDelta(system, { top: 590, bottom: 601 }, false, band)).toBe(275);
  });

  it('scrolls back up to a system above the window (a loop starting again)', () => {
    expect(
      cursorScrollDelta({ top: -500, bottom: -250 }, { top: -480, bottom: -460 }, true, band),
    ).toBe(-675);
  });

  it('keeps clear of a bar at the top of the window too', () => {
    const below = { top: 50, bottom: 600 };
    // 180 px tall in a 550 px band starting at 50: its top goes to 235.
    expect(cursorScrollDelta({ top: 20, bottom: 200 }, { top: 30, bottom: 60 }, true, below)).toBe(
      -215,
    );
  });

  it('puts a system taller than the band at its top, or centres the red notes when they would still be under the dock', () => {
    const tall = { top: 500, bottom: 1300 };
    expect(cursorScrollDelta(tall, { top: 550, bottom: 570 }, true, band)).toBe(500);
    // At the band's top the notes would sit at 650 to 670, under the dock: centre them instead.
    expect(cursorScrollDelta(tall, { top: 1150, bottom: 1170 }, true, band)).toBe(860);
    // Later in the same tall system: the notes are centred whenever they leave the band.
    expect(
      cursorScrollDelta({ top: -100, bottom: 700 }, { top: 650, bottom: 670 }, false, band),
    ).toBe(360);
    expect(
      cursorScrollDelta({ top: -100, bottom: 700 }, { top: 300, bottom: 320 }, false, band),
    ).toBe(null);
  });
});
