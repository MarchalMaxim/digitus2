import { HOP_S, type PitchFrame } from './pitch.js';

/**
 * The pitch track cut into notes (issue 237). A frame counts as sounding when it has a pitch and
 * is not far below the recording's own loud level, so a quiet room and a loud one are read alike.
 * A breath of 40 ms ends a note; inside a breath-free stretch a note changes where the pitch moves
 * by three quarters of a semitone and settles there for 50 ms, so vibrato and a glide into a note
 * do not split it. A note's pitch is the median of its steady middle, in whole semitones. The
 * melody is then moved by whole octaves to where the treble staff holds it: a whistle sounds one
 * or two octaves above the tune it is meant to be.
 */

export interface Note {
  /** The semitone number in the treble staff's range after the octave fold (60 is middle C). */
  midi: number;
  /** Seconds from the start of the recording. */
  start: number;
  end: number;
}

/** Frames this much quieter than the loud ones, or less clear than YIN's threshold, are not notes. */
const LEVEL = 0.1;
const FLOOR = 0.003;
/** Unvoiced frames in a row that end a note: 40 ms. */
const BREATH = 4;
/** The pitch has moved to another note when it is this far (semitones) from the note so far... */
const JUMP = 0.75;
/** ...and stays within this of its own middle, first for 50 ms and then for 80 ms in all, which a glide does not. */
const SETTLED = 0.5;
const SETTLED_FRAMES = 5;
const HOLD_FRAMES = 8;
const MIN_NOTE_S = 0.07;
/** A stretch that runs on into another pitch without a breath is a note only from this long: shorter, it is the start of a slide. */
const MIN_BEFORE_MOVE_S = 0.1;
/** The fold puts the median of the melody in [LOWEST, LOWEST + 12): E4 up to, not including, E5. */
const LOWEST = 64;
const MEDIAN_FRAMES = 5;

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

interface Voiced {
  t: number;
  m: number;
}

/** The semitone number of a pitch, fractional (A4 = 440 Hz is 69). */
const semitone = (hz: number) => 69 + 12 * Math.log2(hz / 440);

export function notesOf(frames: readonly PitchFrame[]): Note[] {
  const levels = frames
    .filter((f) => f.hz !== null)
    .map((f) => f.rms)
    .sort((a, b) => a - b);
  if (!levels.length) return [];
  const loud = levels[Math.floor(0.9 * (levels.length - 1))]!;
  const hop = frames.length > 1 ? frames[1]!.t - frames[0]!.t : HOP_S;
  const sounding = (f: PitchFrame) => f.hz !== null && f.rms >= Math.max(FLOOR, LEVEL * loud);

  // Stretches of sounding frames, joined across gaps shorter than a breath.
  const runs: Voiced[][] = [];
  let run: Voiced[] = [];
  let quiet = 0;
  for (const f of frames) {
    if (sounding(f)) {
      run.push({ t: f.t, m: semitone(f.hz!) });
      quiet = 0;
    } else if (++quiet === BREATH && run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);

  const found: { midi: number; start: number; end: number }[] = [];
  for (const raw of runs) {
    // A median over neighbours takes the one-frame jumps out (an octave slip, a click).
    const steady = raw.map((v, i) => ({
      t: v.t,
      m: median(
        raw
          .slice(Math.max(0, i - (MEDIAN_FRAMES >> 1)), i + (MEDIAN_FRAMES >> 1) + 1)
          .map((x) => x.m),
      ),
    }));
    // The start of a slide that is not a note is where the next note's sound began.
    let slide: number | null = null;
    for (const part of segments(steady)) {
      const long = (part.to - part.from + 1) * hop;
      if (long < (part.moves ? MIN_BEFORE_MOVE_S : MIN_NOTE_S)) {
        if (part.moves) slide ??= part.from;
        else slide = null;
        continue;
      }
      const kept = part.values.slice(
        Math.floor(part.values.length * 0.2),
        Math.ceil(part.values.length * 0.9),
      );
      found.push({
        midi: Math.round(median(kept)),
        start: steady[slide ?? part.from]!.t - hop / 2,
        end: steady[part.to]!.t + hop / 2,
      });
      slide = null;
    }
  }
  if (!found.length) return [];
  const fold = 12 * Math.ceil((LOWEST - median(found.map((n) => n.midi))) / 12);
  return found.map((n) => ({ ...n, midi: n.midi + fold }));
}

interface Segment {
  from: number;
  to: number;
  /** True when another pitch follows with no breath between. */
  moves: boolean;
  /** The pitch of each frame the note holds, in order; frames passed over as glitches are not in it. */
  values: number[];
}

/**
 * The index where five frames in a row sit within half a semitone of their own median and the
 * pitch stays there for eight in all, or -1. A glide of a semitone or two in 80 ms passes through
 * five frames that are close together, but it does not stay.
 */
function settledFrom(run: readonly Voiced[], from: number): number {
  for (let p = from; p + SETTLED_FRAMES <= run.length; p++) {
    const window = run.slice(p, p + SETTLED_FRAMES).map((v) => v.m);
    const middle = median(window);
    if (!window.every((m) => Math.abs(m - middle) <= SETTLED)) continue;
    let held = SETTLED_FRAMES;
    while (p + held < run.length && Math.abs(run[p + held]!.m - middle) <= SETTLED) held++;
    if (held >= HOLD_FRAMES) return p;
  }
  return -1;
}

/** One unbroken stretch cut into notes where the pitch moves to a new, settled value. */
function segments(run: readonly Voiced[]): Segment[] {
  const out: Segment[] = [];
  let cur: Segment | null = null;
  for (let j = 0; j < run.length; j++) {
    const m = run[j]!.m;
    if (!cur) {
      cur = { from: j, to: j, moves: false, values: [m] };
      continue;
    }
    const reference = median(cur.values.slice(-8));
    if (Math.abs(m - reference) < JUMP) {
      cur.values.push(m);
      cur.to = j;
      continue;
    }
    const p = settledFrom(run, j);
    if (p < 0) break; // nothing settles before the stretch ends: the tail is a slip
    const next = median(run.slice(p, p + SETTLED_FRAMES).map((v) => v.m));
    if (Math.abs(next - reference) < JUMP) {
      // It comes back to the same note: the frames between were a glitch. When it settles from
      // this very frame, the frame alone is passed over, so the walk always moves on.
      j = Math.max(p, j + 1) - 1;
      continue;
    }
    cur.moves = true;
    out.push(cur);
    // The frames sliding into the new note belong to it, though its pitch is read from where it settles.
    cur = { from: j, to: p, moves: false, values: [run[p]!.m] };
    j = p;
  }
  if (cur) out.push(cur);
  return out;
}
