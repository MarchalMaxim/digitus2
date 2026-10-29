import { readFileSync } from 'node:fs';
import { parseMusicXml, type Assignment, type Hand } from '@digitus2/engine';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOnsetGroups, type OnsetGroup } from './onsetGroups.js';
import { cursorScrollDelta, SYSTEM_TOP_MARGIN, useCursor } from './useCursor.js';
import type { CountIn, LoopRange, Playback } from './usePlayback.js';

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
  host.innerHTML = pagesFor(groups);
  document.body.append(host);
  return host;
}

/** Freshly laid-out pages for `groups`: one `g.note` per note, none of them marked. */
function pagesFor(groups: OnsetGroup[]): string {
  const notes = groups.flatMap((g) => g.noteIds.map((id) => `<g class="note" id="${id}"></g>`));
  return `<svg><g class="system">${notes.join('')}</g></svg>`;
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
  clock?: { sec: number; leadingIn: boolean; playing?: boolean };
}): Playback {
  return {
    playing: true,
    loading: false,
    countIn,
    waiting,
    atStart: false,
    ended: 0,
    cue: null,
    play: vi.fn(),
    pause: vi.fn(),
    rewind: vi.fn(),
    seek: vi.fn(),
    cueAt: () => {},
    finish: () => {},
    positionSec: () => clock?.sec ?? sec,
    startSec: () => clock?.sec ?? sec,
    startPerformanceSec: () => 0,
    performanceLoop: () => null,
    leadingIn: () => clock?.leadingIn ?? waiting,
    playingNow: () => clock?.playing ?? true,
    leadInRemainingSec: () => null,
    loop: null,
    setLoop: vi.fn(),
    strike: () => () => undefined,
    prepare: () => {},
    preparing: false,
    soundWaits: false,
    accompany: () => {},
    stopAccompaniment: () => {},
  };
}

/**
 * A stopped transport: paused away from the start, or at the start (`atStart`). With `loop`,
 * Play starts at `loopStart` when `sec` lies outside the loop (the transport's rule).
 */
function stopped({
  atStart = false,
  cued = false,
  sec = 0,
  loop = null,
  loopStart = sec,
}: {
  atStart?: boolean;
  cued?: boolean;
  sec?: number;
  loop?: LoopRange | null;
  loopStart?: number;
} = {}): Playback {
  return {
    ...playing({ sec }),
    playing: false,
    playingNow: () => false,
    waiting: false,
    atStart,
    cue: cued ? sec : null,
    loop,
    startSec: () => (loop ? loopStart : sec),
  };
}

const marked = (host: Element) => [...host.querySelectorAll('.is-red')].map((el) => el.id);

describe('ornament keyboard playback', () => {
  it('reports another strike for explicit unison ornaments', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    try {
      const groups = structuredClone(BOTH_AT_ONCE);
      const n = groups[0]!.notes.find((note) => note.hand === 'R')!;
      n.ornament = {
        kind: 'inverted-mordent',
        long: false,
        upperMidi: n.midi,
        lowerMidi: n.midi,
        startNote: 'main',
        endTick: n.offsetTick,
        endSec: n.offsetSec,
      };
      const host = hostFor(groups);
      const clock = { sec: 0, leadingIn: false };
      const { result } = renderHook(() =>
        useCursor({ host, groups, playback: playing({ clock }), assignment: null, mutedHands: [] }),
      );
      clock.sec = 0.09;
      act(() => frames.splice(0).forEach((cb) => cb(0)));
      expect(result.current.struckCount).toBe(1);
      expect(result.current.pressed[0]?.midi).toBe(n.midi);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('follows auxiliary attacks with no invented finger while keeping the written cursor', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    try {
      const groups = structuredClone(BOTH_AT_ONCE);
      const n = groups[0]!.notes.find((note) => note.hand === 'R')!;
      n.ornament = {
        kind: 'inverted-mordent',
        long: false,
        upperMidi: n.midi + 2,
        lowerMidi: n.midi - 1,
        startNote: 'main',
        endTick: n.offsetTick,
        endSec: n.offsetSec,
      };
      const host = hostFor(groups);
      const clock = { sec: 0, leadingIn: false };
      const assignment: Assignment = { [n.id]: { finger: 2, source: 'user' } };
      const { result } = renderHook(() =>
        useCursor({ host, groups, playback: playing({ clock }), assignment, mutedHands: [] }),
      );
      expect(result.current.pressed.find((k) => k.midi === n.midi)?.finger).toBe(2);
      const originalMarks = marked(host);
      clock.sec = 0.09;
      act(() => frames.splice(0).forEach((cb) => cb(0)));
      expect(result.current.pressed.find((k) => k.midi === n.midi + 2)).toEqual({
        midi: n.midi + 2,
        hand: 'R',
        finger: null,
      });
      expect(marked(host)).toEqual(originalMarks);
      clock.sec = 0.18;
      act(() => frames.splice(0).forEach((cb) => cb(0)));
      expect(result.current.pressed.find((k) => k.midi === n.midi)?.finger).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

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

// Issue 171: at the end of the piece the transport stops and rewinds to the start in one task,
// and `playback.playing` follows in a later render. A frame in between read position 0, marked
// bar 1, and the finish rose from there on a slow phone.
describe('the cursor at the end of the piece (issue 171)', () => {
  it('marks nothing new when a frame lands between the transport rewinding at the end and the render that stops it', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const nextFrame = () => act(() => frames.splice(0).forEach((cb) => cb(0)));
    try {
      const groups = BOTH_AT_ONCE.slice(0, 3);
      const host = hostFor(groups);
      const clock = { sec: groups[2]!.sec + 0.01, leadingIn: false, playing: true };
      const { result, rerender } = renderHook(
        (playback: Playback) =>
          useCursor({ host, groups, playback, assignment: null, mutedHands: [] }),
        { initialProps: playing({ clock }) },
      );
      expect(marked(host)).toEqual(groups[2]!.noteIds);
      const group = result.current.currentGroup;
      expect(group).toBe(2);

      // The transport ends and rewinds while React still says it plays.
      clock.sec = 0;
      clock.playing = false;
      nextFrame();
      nextFrame();
      expect(marked(host)).toEqual(groups[2]!.noteIds);
      expect(result.current.currentGroup).toBe(group);
      expect(marked(host)).not.toEqual(expect.arrayContaining(groups[0]!.noteIds));

      // The render that stops it arrives: nothing is marked and Play is the red element.
      rerender(stopped({ atStart: true }));
      expect(marked(host)).toEqual([]);
      expect(result.current.currentGroup).toBe(-1);
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

      // Stopped at the start (Rewind, or the end of the piece): nothing pressed, nothing muted.
      // Paused away from the start keeps them (T10, 'the cursor while paused').
      rerender({ ...playing({ clock }), playing: false, atStart: true });
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

// T10 (spec 14): a pause keeps the last group heard red and its keys pressed; Rewind clears them.
describe('the cursor while paused', () => {
  it('keeps the last group heard marked and its keys pressed, until a rewind', () => {
    const groups = BOTH_AT_ONCE.slice(0, 3);
    const host = hostFor(groups);
    const sec = groups[1]!.sec + 0.01;
    const { result, rerender } = renderHook(
      (playback: Playback) =>
        useCursor({ host, groups, playback, assignment: null, mutedHands: [] }),
      { initialProps: playing({ sec }) },
    );
    const heard = marked(host);
    expect(heard).toEqual(groups[1]!.noteIds);
    const keys = result.current.pressed;
    rerender(stopped({ sec }));
    expect(marked(host)).toEqual(heard);
    expect(result.current.pressed).toEqual(keys);
    expect(result.current.currentGroup).toBe(1);
    rerender(stopped({ atStart: true }));
    expect(marked(host)).toEqual([]);
    expect(result.current.pressed).toEqual([]);
    expect(result.current.currentGroup).toBe(-1);
    host.remove();
  });
  it("keeps the muted hand's keys dimmed while paused", () => {
    const groups = BOTH_AT_ONCE.slice(0, 2);
    const host = hostFor(groups);
    const mutedHands: Hand[] = ['L'];
    const { result, rerender } = renderHook(
      (playback: Playback) => useCursor({ host, groups, playback, assignment: null, mutedHands }),
      { initialProps: playing({ sec: 0.01 }) },
    );
    const dimmed = result.current.muted;
    expect(dimmed.length).toBeGreaterThan(0);
    rerender(stopped({ sec: 0.01 }));
    expect(result.current.muted).toEqual(dimmed);
    expect(result.current.pressed.every((k) => k.hand === 'R')).toBe(true);
    rerender(stopped({ atStart: true }));
    expect(result.current.muted).toEqual([]);
    host.remove();
  });
  it('pause in the lead-in marks nothing', () => {
    const groups = BOTH_AT_ONCE.slice(0, 2);
    const host = hostFor(groups);
    const { result, rerender } = renderHook(
      (playback: Playback) =>
        useCursor({ host, groups, playback, assignment: null, mutedHands: [] }),
      { initialProps: playing({ countIn: { beat: 1, beats: 4, beatInBar: 2 } }) },
    );
    rerender(stopped());
    expect(marked(host)).toEqual([]);
    expect(result.current.currentGroup).toBe(-1);
    host.remove();
  });
  it('a hand switch while paused re-marks the last group of the hands now played, or clears', () => {
    const groups = PICKUP; // the right hand's pickup alone at 0 s, then both hands at 0.6 s
    const host = hostFor(groups);
    const { result, rerender } = renderHook(
      ({ playback, muted }: { playback: Playback; muted: Hand[] }) =>
        useCursor({ host, groups, playback, assignment: null, mutedHands: muted }),
      { initialProps: { playback: playing({ sec: 0.05 }), muted: [] as Hand[] } },
    );
    rerender({ playback: stopped({ sec: 0.05 }), muted: [] });
    expect(result.current.currentGroup).toBe(0);
    rerender({ playback: stopped({ sec: 0.05 }), muted: ['R'] }); // the left hand has no note yet
    expect(marked(host)).toEqual([]);
    expect(result.current.pressed).toEqual([]);
    expect(result.current.currentGroup).toBe(-1);
    // Task 5 review (the blocker): switching back keeps the resume point; the pickup is marked again.
    rerender({ playback: stopped({ sec: 0.05 }), muted: [] });
    expect(marked(host)).toEqual(groups[0]!.noteIds);
    expect(result.current.pressed.map((k) => k.hand)).toEqual(['R']);
    expect(result.current.currentGroup).toBe(0);
    host.remove();
  });
  // Task 5 review: the switch moves the mark to the notes of the hands now played, and back.
  it("a hand switch while paused marks the same group's notes of the hands now played, and back", () => {
    const groups = BOTH_AT_ONCE.slice(0, 2);
    const g0 = groups[0]!; // both hands strike on the first beat
    const left = g0.notes.filter((n) => n.hand === 'L');
    expect(left.length).toBeGreaterThan(0);
    expect(left.length).toBeLessThan(g0.notes.length);
    const host = hostFor(groups);
    const sec = g0.sec + 0.01;
    const { result, rerender } = renderHook(
      ({ playback, muted }: { playback: Playback; muted: Hand[] }) =>
        useCursor({ host, groups, playback, assignment: null, mutedHands: muted }),
      { initialProps: { playback: playing({ sec }), muted: [] as Hand[] } },
    );
    rerender({ playback: stopped({ sec }), muted: [] });
    expect(marked(host)).toEqual(g0.noteIds);
    rerender({ playback: stopped({ sec }), muted: ['R'] });
    expect(marked(host)).toEqual(left.map((n) => n.id));
    expect(result.current.pressed.length).toBeGreaterThan(0);
    expect(result.current.pressed.every((k) => k.hand === 'L')).toBe(true);
    expect(result.current.muted.every((k) => k.hand === 'R')).toBe(true);
    expect(result.current.currentGroup).toBe(0);
    rerender({ playback: stopped({ sec }), muted: [] });
    expect(marked(host)).toEqual(g0.noteIds);
    expect(result.current.currentGroup).toBe(0);
    host.remove();
  });
  // Task 5 review (the blocker, c): the switch searches at or before the pause position, not at
  // or before the old hands' last group: the other hand may have struck since.
  it("a hand switch while paused marks the new hands' last group at or before the pause position", () => {
    const groups = BOTH_AT_ONCE;
    // The first onset after the start where the right hand strikes alone, while the left hand
    // (the one played) last struck earlier.
    const alone = groups.findIndex((g, i) => i > 0 && g.notes.every((n) => n.hand === 'R'));
    expect(alone).toBeGreaterThan(0);
    const played = groups
      .slice(0, alone)
      .map((g, i) => (g.notes.some((n) => n.hand === 'L') ? i : -1))
      .reduce((a, b) => Math.max(a, b), -1);
    expect(played).toBeGreaterThanOrEqual(0);
    const host = hostFor(groups);
    const sec = groups[alone]!.sec + 0.01;
    const { result, rerender } = renderHook(
      ({ playback, muted }: { playback: Playback; muted: Hand[] }) =>
        useCursor({ host, groups, playback, assignment: null, mutedHands: muted }),
      { initialProps: { playback: playing({ sec }), muted: ['R'] as Hand[] } },
    );
    rerender({ playback: stopped({ sec }), muted: ['R'] });
    expect(result.current.currentGroup).toBe(played);
    rerender({ playback: stopped({ sec }), muted: ['L'] });
    expect(marked(host)).toEqual(groups[alone]!.noteIds);
    expect(result.current.currentGroup).toBe(alone);
    rerender({ playback: stopped({ sec }), muted: [] });
    expect(result.current.currentGroup).toBe(alone);
    host.remove();
  });
  // Task 5 review: a re-solve while paused presses the same keys with the new fingers.
  it('a re-solve while paused keeps the marks and presses the keys with the new fingers', () => {
    const groups = BOTH_AT_ONCE.slice(0, 2);
    const host = hostFor(groups);
    const g0 = groups[0]!;
    const { result, rerender } = renderHook(
      ({ playback, assignment }: { playback: Playback; assignment: Assignment | null }) =>
        useCursor({ host, groups, playback, assignment, mutedHands: [] }),
      { initialProps: { playback: playing({ sec: 0.01 }), assignment: null as Assignment | null } },
    );
    rerender({ playback: stopped({ sec: 0.01 }), assignment: null });
    expect(result.current.pressed.every((k) => k.finger === null)).toBe(true);
    const first = g0.notes[0]!;
    rerender({
      playback: stopped({ sec: 0.01 }),
      assignment: { [first.id]: { finger: 3, source: 'engine' } },
    });
    expect(marked(host)).toEqual(g0.noteIds);
    const key = result.current.pressed.find((k) => k.midi === first.midi && k.hand === first.hand);
    expect(key?.finger).toBe(3);
    host.remove();
  });
  // Task 5 review (the blocker, a): Play from the pause starts a lead-in at the pause position
  // (one-hand practice can wait 2.4 s for the next note); a pause in that lead-in has still heard
  // the group before it, so the group is marked again and Play stays plain.
  it("a pause in a resume's lead-in marks the last group heard again", () => {
    const groups = BOTH_AT_ONCE.slice(0, 3);
    const host = hostFor(groups);
    const sec = groups[1]!.sec + 0.01;
    const later = (groups[1]!.sec + groups[2]!.sec) / 2;
    const { result, rerender } = renderHook(
      (playback: Playback) =>
        useCursor({ host, groups, playback, assignment: null, mutedHands: [] }),
      { initialProps: playing({ sec }) },
    );
    rerender(stopped({ sec }));
    const keys = result.current.pressed;
    rerender(playing({ waiting: true, sec })); // Play: the lead-in to the next note
    expect(marked(host)).toEqual([]);
    rerender(playing({ waiting: true, sec: later })); // the clock runs on in the lead-in
    rerender(stopped({ sec: later }));
    expect(marked(host)).toEqual(groups[1]!.noteIds);
    expect(result.current.pressed).toEqual(keys);
    expect(result.current.currentGroup).toBe(1);
    host.remove();
  });
  it('a pause in a lead-in after a jump back (Rewind while playing) marks nothing', () => {
    const groups = BOTH_AT_ONCE.slice(0, 3);
    const host = hostFor(groups);
    const sec = groups[1]!.sec + 0.01;
    const { result, rerender } = renderHook(
      (playback: Playback) =>
        useCursor({ host, groups, playback, assignment: null, mutedHands: [] }),
      { initialProps: playing({ sec }) },
    );
    rerender(playing({ waiting: true, sec: 0 })); // Rewind while playing: a lead-in at the start
    rerender(stopped({ sec: 0 }));
    expect(marked(host)).toEqual([]);
    expect(result.current.currentGroup).toBe(-1);
    // ...and from a resume's lead-in, where `waiting` does not change.
    rerender(playing({ sec }));
    rerender(stopped({ sec }));
    rerender(playing({ waiting: true, sec }));
    rerender(playing({ waiting: true, sec: 0 }));
    rerender(stopped({ sec: 0 }));
    expect(marked(host)).toEqual([]);
    expect(result.current.currentGroup).toBe(-1);
    host.remove();
  });
  it('a pause in the count-in after a jump forward (a loop set later) marks nothing', () => {
    const groups = BOTH_AT_ONCE.slice(0, 3);
    const host = hostFor(groups);
    const sec = groups[0]!.sec + 0.01;
    const { result, rerender } = renderHook(
      (playback: Playback) =>
        useCursor({ host, groups, playback, assignment: null, mutedHands: [] }),
      { initialProps: playing({ sec }) },
    );
    rerender(stopped({ sec }));
    expect(result.current.currentGroup).toBe(0);
    // Play from the loop's start, two groups on: the count-in holds the clock there.
    const loopStart = groups[2]!.sec;
    rerender(playing({ countIn: { beat: 0, beats: 4, beatInBar: 1 }, sec: loopStart }));
    rerender(stopped({ sec: loopStart }));
    expect(marked(host)).toEqual([]);
    expect(result.current.currentGroup).toBe(-1);
    host.remove();
  });
  // UI batch review: a loop set while paused that leaves the pause position outside it makes
  // Play start at the loop's first bar, so the position marked is not where Play resumes.
  it('a loop set while paused that leaves the pause position outside it clears the marks, and back', () => {
    const groups = BOTH_AT_ONCE.slice(0, 3);
    const host = hostFor(groups);
    const sec = groups[0]!.sec + 0.01;
    const { result, rerender } = renderHook(
      (playback: Playback) =>
        useCursor({ host, groups, playback, assignment: null, mutedHands: [] }),
      { initialProps: playing({ sec }) },
    );
    rerender(stopped({ sec }));
    expect(marked(host)).toEqual(groups[0]!.noteIds);
    const keys = result.current.pressed;
    expect(keys.length).toBeGreaterThan(0);
    // A loop two groups on: Play would start at its first bar, not at the pause position.
    const outside = { from: 3, to: 4 };
    rerender(stopped({ sec, loop: outside, loopStart: groups[2]!.sec }));
    expect(marked(host)).toEqual([]);
    expect(result.current.pressed).toEqual([]);
    expect(result.current.muted).toEqual([]);
    expect(result.current.currentGroup).toBe(-1);
    // A loop round the pause position: Play resumes there, so it is marked again.
    rerender(stopped({ sec, loop: { from: 0, to: 4 }, loopStart: sec }));
    expect(marked(host)).toEqual(groups[0]!.noteIds);
    expect(result.current.currentGroup).toBe(0);
    // Out again, then the loop unticked: the position to resume is unchanged, marked again.
    rerender(stopped({ sec, loop: outside, loopStart: groups[2]!.sec }));
    expect(result.current.currentGroup).toBe(-1);
    rerender(stopped({ sec }));
    expect(marked(host)).toEqual(groups[0]!.noteIds);
    expect(result.current.pressed).toEqual(keys);
    expect(result.current.currentGroup).toBe(0);
    host.remove();
  });
  it('re-marks the same group when the pages are laid out again while paused', () => {
    const groups = BOTH_AT_ONCE.slice(0, 2);
    const host = hostFor(groups);
    const { rerender } = renderHook(
      ({ playback, layoutKey }: { playback: Playback; layoutKey: number }) =>
        useCursor({ host, groups, playback, assignment: null, mutedHands: [], layoutKey }),
      { initialProps: { playback: playing({ sec: 0.01 }), layoutKey: 1 } },
    );
    rerender({ playback: stopped({ sec: 0.01 }), layoutKey: 1 });
    host.innerHTML = pagesFor(groups); // new pages: the old marks are gone
    expect(marked(host)).toEqual([]);
    rerender({ playback: stopped({ sec: 0.01 }), layoutKey: 2 });
    expect(marked(host)).toEqual(groups[0]!.noteIds);
    host.remove();
  });
});

// T13: a seek while stopped (a click on a bar, the arrow keys) cues the bar: the note Play starts
// with is marked, wherever the cursor was and whatever was heard before.
describe('the cursor at a cue', () => {
  it('marks the group at the cue from the start, and a group before the last one heard', () => {
    const groups = BOTH_AT_ONCE.slice(0, 4);
    const host = hostFor(groups);
    const { result, rerender } = renderHook(
      (playback: Playback) =>
        useCursor({ host, groups, playback, assignment: null, mutedHands: [] }),
      { initialProps: stopped({ atStart: true }) },
    );
    expect(marked(host)).toEqual([]);
    rerender(stopped({ cued: true, sec: groups[2]!.sec }));
    expect(marked(host)).toEqual(groups[2]!.noteIds);
    expect(result.current.currentGroup).toBe(2);
    // Its keys are pressed, with the notes still held from before it.
    expect(result.current.pressed.length).toBeGreaterThanOrEqual(groups[2]!.noteIds.length);
    // Heard up to the last group, paused, then cued back to the second: marked there.
    rerender(playing({ sec: groups[3]!.sec + 0.01 }));
    rerender(stopped({ sec: groups[3]!.sec + 0.01 }));
    expect(result.current.currentGroup).toBe(3);
    rerender(stopped({ cued: true, sec: groups[1]!.sec }));
    expect(marked(host)).toEqual(groups[1]!.noteIds);
    expect(result.current.currentGroup).toBe(1);
    host.remove();
  });
  it('marks the first note of the hands played at or after the cue, past a rest', () => {
    const groups = PICKUP; // the right hand's pickup alone at 0 s, then both hands at 0.6 s
    const host = hostFor(groups);
    const { result } = renderHook(() =>
      useCursor({
        host,
        groups,
        playback: stopped({ cued: true, sec: 0.3 }),
        assignment: null,
        mutedHands: ['R'],
      }),
    );
    const g2 = groups.find((g) => g.notes.some((n) => n.hand === 'L'))!;
    expect(result.current.currentGroup).toBe(groups.indexOf(g2));
    expect(marked(host)).toEqual(g2.notes.filter((n) => n.hand === 'L').map((n) => n.id));
    expect(result.current.pressed.every((k) => k.hand === 'L')).toBe(true);
    host.remove();
  });
  it('marks nothing when Play would start elsewhere (a cue outside the loop)', () => {
    const groups = BOTH_AT_ONCE.slice(0, 3);
    const host = hostFor(groups);
    renderHook(() =>
      useCursor({
        host,
        groups,
        playback: stopped({
          cued: true,
          sec: groups[2]!.sec,
          loop: { from: 0, to: 0 },
          loopStart: 0,
        }),
        assignment: null,
        mutedHands: [],
      }),
    );
    expect(marked(host)).toEqual([]);
    host.remove();
  });
});

// The band is the part of the window no sticky bar covers: here a 750 px window less a 150 px dock.
const band = { top: 0, bottom: 600 };

describe('the cursor scroll (issue #5: a page turn puts the system at the top of the band)', () => {
  it('stays put while the new system is wholly above the dock', () => {
    expect(
      cursorScrollDelta({ top: 100, bottom: 300 }, { top: 120, bottom: 140 }, true, band),
    ).toBe(null);
    // Even the last system fully visible above the dock: it is where the next turn is taken from.
    expect(
      cursorScrollDelta({ top: 350, bottom: 600 }, { top: 360, bottom: 380 }, true, band),
    ).toBe(null);
  });

  it('turns the page to a new system that reaches under the dock, putting it at the top of the band with the margin', () => {
    // 250 px tall in a 600 px band: its top goes to the margin below the band's top, so the
    // systems after it fill the band.
    expect(
      cursorScrollDelta({ top: 450, bottom: 700 }, { top: 460, bottom: 480 }, true, band),
    ).toBe(450 - SYSTEM_TOP_MARGIN);
    // Even when its first notes are above the dock: the rest of the system would play under it.
    expect(
      cursorScrollDelta({ top: 400, bottom: 650 }, { top: 410, bottom: 430 }, true, band),
    ).toBe(400 - SYSTEM_TOP_MARGIN);
  });

  it('gives up the margin when the system only just fits the band', () => {
    // 595 px tall in a 600 px band: 5 px of margin is all there is.
    expect(
      cursorScrollDelta({ top: 300, bottom: 895 }, { top: 310, bottom: 330 }, true, band),
    ).toBe(295);
    // Exactly the band's height: its top at the band's top.
    expect(
      cursorScrollDelta({ top: 300, bottom: 900 }, { top: 310, bottom: 330 }, true, band),
    ).toBe(300);
  });

  it("within a system that fits the band, never scrolls: a reader's own scroll is kept until the next turn", () => {
    const system = { top: 450, bottom: 700 };
    expect(cursorScrollDelta(system, { top: 460, bottom: 480 }, false, band)).toBe(null);
    // The red notes under the dock, or above the window, after the reader scrolled: no scroll.
    expect(cursorScrollDelta(system, { top: 620, bottom: 640 }, false, band)).toBe(null);
    expect(
      cursorScrollDelta({ top: -100, bottom: 150 }, { top: -50, bottom: -30 }, false, band),
    ).toBe(null);
  });

  it('scrolls back up to a system above the window (a loop starting again)', () => {
    expect(
      cursorScrollDelta({ top: -500, bottom: -250 }, { top: -480, bottom: -460 }, true, band),
    ).toBe(-500 - SYSTEM_TOP_MARGIN);
  });

  it('keeps clear of a bar at the top of the window too', () => {
    const below = { top: 50, bottom: 600 };
    const system = { top: 20, bottom: 200 };
    const delta = cursorScrollDelta(system, { top: 30, bottom: 60 }, true, below);
    // Up is negative: the system, behind the top bar now, is brought below it, by the margin.
    expect(delta).toBe(20 - 50 - SYSTEM_TOP_MARGIN);
  });

  it('takes fewer turns than the old centring rule over a screenful of systems', () => {
    // Four 200 px systems 20 px apart, in a 600 px band: playing through them from the top.
    const systems = [0, 1, 2, 3].map((i) => ({ top: i * 220, bottom: i * 220 + 200 }));
    let scrollY = 0;
    let turns = 0;
    for (const s of systems) {
      const at = { top: s.top - scrollY, bottom: s.bottom - scrollY };
      const cursor = { top: at.top + 10, bottom: at.top + 30 };
      const delta = cursorScrollDelta(at, cursor, true, band);
      if (delta !== null) {
        scrollY += delta;
        turns++;
      }
      // After every group the red notes are inside the band.
      expect(s.top - scrollY).toBeGreaterThanOrEqual(band.top);
      expect(s.bottom - scrollY).toBeLessThanOrEqual(band.bottom);
    }
    // The first two fit the first screen; the third reaches under the dock and turns the page,
    // bringing the fourth into view with it: one turn, where centring took two.
    expect(turns).toBe(1);
    expect(scrollY).toBe(440 - SYSTEM_TOP_MARGIN);
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
