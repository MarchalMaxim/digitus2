// The subpath, not the engine's index: the index would bring the whole engine onto the main thread.
import { performanceOrder } from '@digitus2/engine/score-build';
import type { Note, PedalEvent, Score } from '@digitus2/engine';
import { measureEndSec, measureStartSec } from './beats.js';

/** Time between the notes of a rolled chord, in score seconds. */
export const ROLL_STEP_SEC = 0.04;
/** The whole roll lasts at most this fraction of the chord's shortest note. */
export const ROLL_MAX_FRACTION = 0.25;
/** Two times closer than this are the same instant. */
const EPS = 1e-9;

/** The end of the piece in score seconds: the last bar's end, or a note that runs past it. */
export function scoreEndSec(score: Score): number {
  const lastMeasure = score.measures.length - 1;
  // A loop, not Math.max(...notes): spreading a very large score would overflow the stack.
  let endSec = lastMeasure >= 0 ? measureEndSec(score, lastMeasure) : 0;
  for (const n of score.notes) if (n.offsetSec > endSec) endSec = n.offsetSec;
  return endSec;
}

/** A note the performance layer may reshape: not a grace note and not an ornament. */
function isPlain(n: Note): boolean {
  return !n.isGrace && !n.ornament;
}

/**
 * How late each note of a rolled chord (`<arpeggiate>`) starts, in score seconds, by note id. A
 * chord rolls from its lowest note up, or from its highest down with `direction="down"`. A
 * numbered arpeggio rolls across every staff that marks it. Notes that are not delayed are absent.
 */
export function rollDelays(score: Score): Map<string, number> {
  const groups = new Map<string, Note[]>();
  for (const n of score.notes) {
    if (!n.arpeggio || !isPlain(n)) continue;
    const key = n.arpeggio.number !== undefined ? `${n.onsetTick}#${n.arpeggio.number}` : n.chordId;
    const group = groups.get(key);
    if (group) group.push(n);
    else groups.set(key, [n]);
  }
  const delays = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sign = group[0]!.arpeggio!.direction === 'down' ? -1 : 1;
    group.sort((a, b) => sign * (a.midi - b.midi));
    let shortest = Infinity;
    for (const n of group) shortest = Math.min(shortest, n.offsetSec - n.onsetSec);
    const step = Math.min(ROLL_STEP_SEC, (ROLL_MAX_FRACTION * shortest) / (group.length - 1));
    group.forEach((n, i) => delays.set(n.id, i * step));
  }
  return delays;
}

/**
 * Where each note is held to by the damper pedal, in score seconds, by note id. A note whose
 * written end falls while the pedal is down rings until the pedal lifts, changes or is pressed
 * again, or until the
 * same key is struck again, whichever comes first. A pedal never lifted holds to the end of the
 * piece. The pedal belongs to the whole score, both hands. Notes it does not extend are absent.
 */
export function pedalStops(score: Score): Map<string, number> {
  const held = new Map<string, number>();
  const marks = score.pedals;
  if (!marks || marks.length === 0) return held;
  const down: { from: number; to: number }[] = [];
  let open: number | undefined;
  const close = (sec: number): void => {
    if (open !== undefined && sec > open + EPS) down.push({ from: open, to: sec });
    open = undefined;
  };
  for (const mark of marks) {
    if (mark.type === 'up') close(mark.sec);
    else {
      // A press while the pedal is down is a re-pedal (a fresh "Ped." with no "*" before it).
      close(mark.sec);
      open = mark.sec;
    }
  }
  close(scoreEndSec(score));
  if (down.length === 0) return held;

  const strikes = new Map<number, number[]>();
  for (const n of score.notes) {
    if (n.isGrace) continue;
    const list = strikes.get(n.midi);
    if (list) list.push(n.onsetSec);
    else strikes.set(n.midi, [n.onsetSec]);
  }
  for (const list of strikes.values()) list.sort((a, b) => a - b);

  for (const n of score.notes) {
    if (!isPlain(n)) continue;
    // The last stretch that began before the note's end; the note is held when it is still down.
    let lo = 0;
    let hi = down.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (down[mid]!.from < n.offsetSec - EPS) lo = mid + 1;
      else hi = mid;
    }
    const stretch = down[lo - 1];
    if (!stretch || n.offsetSec >= stretch.to - EPS) continue;
    const again = strikes.get(n.midi)!;
    let a = 0;
    let b = again.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (again[mid]! <= n.onsetSec + EPS) a = mid + 1;
      else b = mid;
    }
    const stop = Math.min(stretch.to, again[a] ?? Infinity);
    if (stop > n.offsetSec + EPS) held.set(n.id, stop);
  }
  return held;
}

/**
 * A score in the order it is heard. `score` is the unfolded copy the transport plays: the bars
 * in performance order, every note once per hearing, with ids suffixed `@pass`. The score itself
 * stays engraved once; the maps here take a time in the performance to the bar written and back,
 * so the cursor, a seek and a loop keep speaking of the written score.
 */
export interface Performance {
  score: Score;
  /** True when the order is the written one: `score` is then the written Score itself. */
  identity: boolean;
  /** The written bar of each pass, in order heard. */
  written: number[];
  /** The performance second each pass starts and ends at. */
  starts: number[];
  ends: number[];
  /** The written second each written bar starts and ends at (by written bar index). */
  writtenStarts: number[];
  writtenEnds: number[];
  /** The passes (indices into `written`) in which each written bar is heard, in order. */
  passesOf: number[][];
}

/** The tempo that holds before any tempo mark is written (the engine's `ticksToSeconds` default). */
const DEFAULT_QPM = 120;

/** The last event at or before `tick` (`events` sorted by tick), or undefined. */
function inForce<E extends { tick: number }>(events: readonly E[], tick: number): E | undefined {
  let found: E | undefined;
  for (const e of events) {
    if (e.tick <= tick) found = e;
    else break;
  }
  return found;
}

/**
 * The score in performance order (see `Performance`). A score heard in the order it is written
 * comes back as itself, so a piece without repeats or jumps costs nothing.
 */
export function performanceOf(score: Score): Performance {
  const order = performanceOrder(score.measures);
  const bars = score.measures;
  const writtenStarts = bars.map((_, i) => measureStartSec(score, i));
  const writtenEnds = bars.map((_, i) => measureEndSec(score, i));
  const passesOf: number[][] = bars.map(() => []);
  order.forEach((w, p) => passesOf[w]!.push(p));
  const identity = order.every((w, p) => w === p);
  if (identity) {
    return {
      score,
      identity,
      written: order,
      starts: writtenStarts,
      ends: writtenEnds,
      writtenStarts,
      writtenEnds,
      passesOf,
    };
  }

  const starts: number[] = [];
  const ends: number[] = [];
  const startTicks: number[] = [];
  let sec = 0;
  let tick = 0;
  for (const w of order) {
    starts.push(sec);
    startTicks.push(tick);
    sec += writtenEnds[w]! - writtenStarts[w]!;
    tick += bars[w]!.lengthTicks;
    ends.push(sec);
  }
  // Where the run of consecutive written bars that pass p belongs to ends. A note tied across a
  // jump stops there; the run that reaches the last pass lets its notes ring out.
  const last = order.length - 1;
  const runEndSec: number[] = new Array<number>(order.length);
  const runEndTick: number[] = new Array<number>(order.length);
  for (let p = last; p >= 0; p--) {
    if (p === last) {
      runEndSec[p] = Infinity;
      runEndTick[p] = Infinity;
    } else if (order[p + 1] === order[p]! + 1) {
      runEndSec[p] = runEndSec[p + 1]!;
      runEndTick[p] = runEndTick[p + 1]!;
    } else {
      runEndSec[p] = ends[p]!;
      runEndTick[p] = startTicks[p]! + bars[order[p]!]!.lengthTicks;
    }
  }

  const tempoMap = [...score.tempoMap].sort((a, b) => a.tick - b.tick);
  const timeSignatures = [...score.timeSignatures].sort((a, b) => a.tick - b.tick);
  const keySignatures = [...score.keySignatures].sort((a, b) => a.tick - b.tick);
  const marks = [...(score.pedals ?? [])].sort((a, b) => a.tick - b.tick);
  const tempos: Score['tempoMap'] = [];
  const times: Score['timeSignatures'] = [];
  const keys: Score['keySignatures'] = [];
  const pedals: PedalEvent[] = [];
  const byMeasure: Note[][] = bars.map(() => []);
  for (const n of score.notes) byMeasure[n.measureIndex]?.push(n);
  const notes: Note[] = [];
  const measures = order.map((w, p) => ({
    index: p,
    startTick: startTicks[p]!,
    lengthTicks: bars[w]!.lengthTicks,
    number: bars[w]!.number,
  }));

  order.forEach((w, p) => {
    const bar = bars[w]!;
    const from = bar.startTick;
    const to = from + bar.lengthTicks;
    const dt = startTicks[p]! - from;
    const ds = starts[p]! - writtenStarts[w]!;

    // The tempo, time and key in force where the bar starts, then the changes inside it.
    const qpm = inForce(tempoMap, from)?.qpm ?? DEFAULT_QPM;
    if (tempos.length === 0 || tempos[tempos.length - 1]!.qpm !== qpm) {
      tempos.push({ tick: startTicks[p]!, qpm });
    }
    for (const e of tempoMap) {
      if (e.tick > from && e.tick < to) tempos.push({ ...e, tick: e.tick + dt });
    }
    const time = inForce(timeSignatures, from);
    const lastTime = times[times.length - 1];
    if (
      time &&
      (!lastTime || lastTime.beats !== time.beats || lastTime.beatType !== time.beatType)
    ) {
      times.push({ ...time, tick: startTicks[p]! });
    }
    for (const e of timeSignatures) {
      if (e.tick > from && e.tick < to) times.push({ ...e, tick: e.tick + dt });
    }
    const key = inForce(keySignatures, from);
    const lastKey = keys[keys.length - 1];
    if (key && (!lastKey || lastKey.fifths !== key.fifths || lastKey.mode !== key.mode)) {
      keys.push({ ...key, tick: startTicks[p]! });
    }
    for (const e of keySignatures) {
      if (e.tick > from && e.tick < to) keys.push({ ...e, tick: e.tick + dt });
    }

    // The pedal: arriving by a jump, the state in force there; then the marks inside the bar.
    const inside = marks.filter((m) => m.tick >= from && m.tick < to);
    if (p > 0 && order[p - 1] !== w - 1 && !inside.some((m) => m.tick === from)) {
      const before = inForce(
        marks.filter((m) => m.tick < from),
        from,
      );
      pedals.push({
        tick: startTicks[p]!,
        sec: starts[p]!,
        type: before && before.type !== 'up' ? 'down' : 'up',
      });
    }
    for (const m of inside) pedals.push({ ...m, tick: m.tick + dt, sec: m.sec + ds });

    for (const n of byMeasure[w]!) {
      const offsetTick = Math.min(n.offsetTick + dt, runEndTick[p]!);
      const offsetSec = Math.min(n.offsetSec + ds, runEndSec[p]!);
      notes.push({
        ...n,
        id: `${n.id}@${p}`,
        chordId: `${n.chordId}@${p}`,
        measureIndex: p,
        onsetTick: n.onsetTick + dt,
        offsetTick,
        onsetSec: n.onsetSec + ds,
        offsetSec,
        ...(n.ornament
          ? {
              ornament: {
                ...n.ornament,
                endTick: Math.min(n.ornament.endTick + dt, offsetTick),
                endSec: Math.min(n.ornament.endSec + ds, offsetSec),
              },
            }
          : {}),
      });
    }
  });

  // A re-pedal is a lift, a change and a press on one tick, in that order.
  const rank = { up: 0, change: 1, down: 2 };
  pedals.sort((a, b) => a.tick - b.tick || rank[a.type] - rank[b.type]);
  return {
    score: {
      meta: score.meta,
      divisions: score.divisions,
      tempoMap: tempos,
      timeSignatures: times,
      keySignatures: keys,
      measures,
      notes,
      ...(pedals.length > 0 ? { pedals } : {}),
    },
    identity,
    written: order,
    starts,
    ends,
    writtenStarts,
    writtenEnds,
    passesOf,
  };
}

/** The written second a performance second belongs to. */
export function toWrittenSec(perf: Performance, perfSec: number): number {
  if (perf.identity || perf.starts.length === 0) return perfSec;
  let lo = 0;
  let hi = perf.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (perf.starts[mid]! <= perfSec) lo = mid;
    else hi = mid - 1;
  }
  return perf.writtenStarts[perf.written[lo]!]! + (perfSec - perf.starts[lo]!);
}

/**
 * The performance second to go to for a written second, when the music is at `nearPerfSec`. A bar
 * heard twice is entered at its next hearing going forward in the written score, at its last
 * hearing at or before the music going back, and the top is the top.
 */
export function toPerformanceSec(
  perf: Performance,
  writtenSec: number,
  nearPerfSec: number,
): number {
  if (writtenSec <= 0) return 0;
  if (perf.identity || perf.starts.length === 0) return writtenSec;
  // The bar the written second falls in: the last that starts at or before it.
  let w = 0;
  for (let i = 0; i < perf.writtenStarts.length; i++) {
    if (perf.writtenStarts[i]! <= writtenSec) w = i;
    else break;
  }
  const offset = writtenSec - perf.writtenStarts[w]!;
  const passes = perf.passesOf[w]!;
  if (passes.length === 0) return perf.starts[0]!;
  let pass: number;
  if (writtenSec < toWrittenSec(perf, nearPerfSec) - EPS) {
    pass = passes[0]!;
    for (const p of passes) if (perf.starts[p]! <= nearPerfSec + EPS) pass = p;
  } else {
    pass = passes[passes.length - 1]!;
    for (let i = passes.length - 1; i >= 0; i--) {
      if (perf.starts[passes[i]!]! + offset >= nearPerfSec - EPS) pass = passes[i]!;
    }
  }
  return perf.starts[pass]! + offset;
}

/**
 * A loop over written bars (`from`..`to`, 0-based and inclusive) in performance seconds: a stretch
 * that plays them in a row, one lap of the loop. When several stretches do, the one the music is
 * in (`nearPerfSec`) is taken, else the first. With no stretch in a row it runs from a hearing of
 * the first bar to the next end of the last, chosen the same way. Null for a missing, reversed or
 * empty range.
 */
export function performanceLoop(
  perf: Performance,
  loop: { from: number; to: number } | null,
  nearPerfSec = 0,
): { from: number; to: number } | null {
  if (!loop || perf.written.length === 0) return null;
  const last = perf.writtenStarts.length - 1;
  const a = Math.min(Math.max(0, Math.trunc(loop.from)), last);
  const b = Math.min(Math.max(0, Math.trunc(loop.to)), last);
  if (a > b) return null;
  const hearings = perf.passesOf[a] ?? [];
  const inARow = hearings.filter((p) => {
    for (let k = 1; k <= b - a; k++) if (perf.written[p + k] !== a + k) return false;
    return true;
  });
  const stretches: Array<[number, number]> =
    inARow.length > 0
      ? inARow.map((p) => [p, p + (b - a)])
      : hearings.flatMap((p) => {
          const end = (perf.passesOf[b] ?? []).find((q) => q >= p);
          return end === undefined ? [] : [[p, end] as [number, number]];
        });
  const holding = stretches.find(
    ([p, q]) => perf.starts[p]! <= nearPerfSec + EPS && nearPerfSec < perf.ends[q]! - EPS,
  );
  const [from, to] = holding ?? stretches[0] ?? [-1, -1];
  return from < 0 ? null : span(perf, from, to);
}

const performances = new WeakMap<Score, Performance>();

/** `performanceOf`, kept per score for callers that ask again and again (the score is not edited). */
export function performanceFor(score: Score): Performance {
  let perf = performances.get(score);
  if (!perf) {
    perf = performanceOf(score);
    performances.set(score, perf);
  }
  return perf;
}

/**
 * Where Play starts before a transport exists, in written seconds: `writtenSec`, or the start of
 * the loop's stretch when `writtenSec` lies outside it (what `Transport.startSec` answers once it
 * does).
 */
export function loopStartSec(
  perf: Performance,
  loop: { from: number; to: number } | null,
  writtenSec: number,
): number {
  const near = toPerformanceSec(perf, writtenSec, 0);
  const range = performanceLoop(perf, loop, near);
  return range && (near < range.from || near >= range.to)
    ? toWrittenSec(perf, range.from)
    : writtenSec;
}

function span(perf: Performance, from: number, to: number): { from: number; to: number } | null {
  const range = { from: perf.starts[from]!, to: perf.ends[to]! };
  return range.to > range.from ? range : null;
}
