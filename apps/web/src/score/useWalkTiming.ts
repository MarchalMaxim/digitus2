/**
 * Timing in the waiting walk (issue 192): while the reader walks the piece on their piano, this
 * hook compares their rhythm with the written one, against their own pulse (walkTiming.ts), and
 * after each bar it hands ScoreView the rings of the note that came clearly early or late. The
 * red still waits; Play judges nothing.
 *
 * The walk (usePlayAlong.ts) tells what it passed through `tap`: each step with the start of the
 * run that passed it, and every break in its own sequence (a seek, going inactive, a loop's wrap,
 * a release too early, the finish). This hook keeps the passed steps as timed onsets, in chains
 * the breaks cut, and judges a bar the moment the walk leaves it. Its own note-on log gives each
 * onset the event time of the key that started the run (`NoteMessage.atMs`); that listener must
 * subscribe before the walk's, so ScoreView calls this hook first.
 *
 * A MIDI message renders nothing here: it goes into a ref. Only a judgement that changes the rings
 * or the explanation, and a clear, set state.
 */
import type { Hand, Score } from '@digitus2/engine';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tempoFactorOf, useAppStore } from '../app/store.js';
import { performanceFor } from '../audio/performance.js';
import { subscribeNotes, usePianoSnapshot } from '../midi/piano.js';
import { holdSec } from './playAlong.js';
import type { TimingMark } from './render/timingMarks.js';
import type { WalkTimingEvent } from './usePlayAlong.js';
import type { Playback } from './usePlayback.js';
import {
  EXPLAIN_BARS,
  judgeBar,
  marksOf,
  resolveOnset,
  walkTimingPlan,
  type Judged,
  type NotePress,
  type Onset,
  type WalkPlan,
} from './walkTiming.js';

export interface WalkTimingOptions {
  score: Score | null;
  /** `doc.status === 'ready'`. */
  ready: boolean;
  playback: Playback;
  mutedHands: readonly Hand[];
}

export interface WalkTiming {
  /** Hand to usePlayAlong's `onTiming`; the same function for the life of the hook. */
  tap: (e: WalkTimingEvent) => void;
  /** The rings of every judged bar not replayed or cleared since; null when none. */
  marks: readonly TimingMark[] | null;
  /** The one-time explanation is on the status line (docs/app.md, Timing in the walk). */
  explain: boolean;
}

/** What the Playwright check reads (installed with `?audio=silent` or `?hooks=1`). */
export interface WalkTimingHook {
  /** The steps of the hands played, aligned with __digitus2Along's indices. */
  steps(): {
    perfSec: number;
    pitches: number[];
    bar: number;
    writtenBar: number;
    ids: string[];
    holdMs: number;
  }[];
  /** The onsets since the last clear, resolved (resolving any not yet resolved). */
  onsets(): { index: number; ms: number; chain: number }[];
  /** Every judgement since the last clear, in order, with the performance bar judged. */
  judged(): {
    bar: number;
    index: number;
    verdict: 'onTime' | 'early' | 'late';
    offsetMs: number;
    tolMs: number;
  }[];
  /** TimingMark entries kept now (one per ringed step; the DOM draws one ring per staff). */
  markCount(): number;
}

/** Note-ons kept for `resolveOnset`. */
export const NOTE_LOG_CAP = 512;
/** Onsets kept for `judgeBar` (the tempo window needs TEMPO_WINDOW gaps plus one bar). */
export const ONSET_CAP = 256;
/** Judgements kept for the test hook. */
export const JUDGED_CAP = 512;

/** The rings of the judged bars, by written bar, for the plan they were judged against. */
interface Rings {
  plan: WalkPlan | null;
  byBar: ReadonlyMap<number, readonly TimingMark[]>;
}

/** A passed step as the hook keeps it: `ms` is resolved when the bar is judged, else null. */
interface Entry {
  index: number;
  sinceMs: number;
  chain: number;
  ms: number | null;
}

/** The latest render's view of the options, read by the note listener and the tap. */
interface Live {
  plan: WalkPlan | null;
  playback: Playback;
  /** The open piece's Practice tempo: real seconds = performance seconds / factor. */
  factor: number;
}

const NO_MARKS: ReadonlyMap<number, readonly TimingMark[]> = new Map();
const NO_RINGS: Rings = { plan: null, byBar: NO_MARKS };

/** The Playwright hooks are on: `?audio=silent` (the silent instrument) or `?hooks=1` (the real one). */
function hooksOn(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('audio') === 'silent' || params.get('hooks') === '1';
}

/** The entry as an onset, its time resolved against the note-on log once and kept. */
function onsetOf(entry: Entry, plan: WalkPlan, log: readonly NotePress[]): Onset {
  if (entry.ms === null) {
    entry.ms = resolveOnset(entry.sinceMs, plan.steps[entry.index]!.pitches, log);
  }
  return { index: entry.index, ms: entry.ms, chain: entry.chain };
}

export function useWalkTiming({
  score,
  ready,
  playback,
  mutedHands,
}: WalkTimingOptions): WalkTiming {
  const setting = useAppStore((s) => s.settings.playAlong);
  const practiceMode = useAppStore((s) => s.settings.practiceMode);
  const factor = useAppStore(tempoFactorOf);
  const piano = usePianoSnapshot();
  // The walk's own gate (usePlayAlong.ts): a piano connected, Practice mode on.
  const walking = setting && piano.status === 'connected' && practiceMode;

  // The steps of the hands played, as the walk has them: both come from `alongPlanNotes` with the
  // same arguments, so their indices agree. The list of hands is rebuilt from its key, so a new
  // array of the same hands changes nothing.
  const muteKey = [...new Set(mutedHands)].sort().join(',');
  const plan = useMemo(
    () =>
      walking && score
        ? walkTimingPlan(performanceFor(score), muteKey ? (muteKey.split(',') as Hand[]) : [])
        : null,
    [walking, score, muteKey],
  );

  const liveRef = useRef<Live>({ plan, playback, factor });
  useLayoutEffect(() => {
    liveRef.current = { plan, playback, factor };
  });
  const logRef = useRef<NotePress[]>([]);
  const entriesRef = useRef<Entry[]>([]);
  /** Onsets of different chains are never compared; a break starts a new one. */
  const chainRef = useRef(0);
  /** The performance bar the walk is in (its onsets are the visit), null when none is open. */
  const openBarRef = useRef<number | null>(null);
  /** The index of the last step passed, -1 after a break. */
  const lastRef = useRef(-1);
  const judgedRef = useRef<(Judged & { bar: number })[]>([]);
  /** The rings: the authority. The state below only makes the render see them. */
  const ringsRef = useRef<Rings>(NO_RINGS);
  const explainedRef = useRef(false);
  const explainBarsRef = useRef(0);
  const explainRef = useRef(false);
  const [rings, setRings] = useState<Rings>(NO_RINGS);
  const [explain, setExplain] = useState(false);

  // Every note-on, logged as it arrives: the walk passes a step a hold after the press, and the
  // event time of the press is needed then. Subscribed once and never again, so it stays ahead of
  // the walk's listener, which ScoreView declares after this hook.
  useEffect(
    () =>
      subscribeNotes((e) => {
        if (!e.on || e.lost || !liveRef.current.plan) return;
        const arrivalMs = performance.now();
        const log = logRef.current;
        log.push({ midi: e.midi, arrivalMs, atMs: e.atMs ?? arrivalMs });
        if (log.length > NOTE_LOG_CAP) log.splice(0, log.length - NOTE_LOG_CAP);
      }),
    [],
  );

  const showExplain = useCallback((on: boolean) => {
    if (explainRef.current === on) return;
    explainRef.current = on;
    setExplain(on);
  }, []);

  const tap = useCallback(
    (e: WalkTimingEvent) => {
      const broken = () => {
        chainRef.current++;
        openBarRef.current = null;
        lastRef.current = -1;
      };
      try {
        const walk = liveRef.current.plan;
        if (!walk) return;
        if (e.kind === 'break') {
          broken();
          showExplain(false);
          return;
        }
        const byBar =
          ringsRef.current.plan === walk
            ? new Map(ringsRef.current.byBar)
            : new Map<number, readonly TimingMark[]>();
        /** Written bars judged in this tap. */
        const judgedNow = new Set<number>();
        /** Written bars this tap gave rings. */
        const ringedNow = new Set<number>();
        let changed = false;

        /** Judges the bar of the last onset: the walk has left it. */
        const judge = (finishing: boolean) => {
          const entries = entriesRef.current;
          const lastEntry = entries.at(-1);
          if (!lastEntry) return;
          const onsets = entries.map((entry) => onsetOf(entry, walk, logRef.current));
          const last = walk.steps[lastEntry.index]!;
          let judged = judgeBar(walk.steps, onsets);
          // A written rit. at the end is text the tempo map does not carry: a reader who slows
          // down as written must not get late rings.
          if (finishing) judged = judged.filter((j) => j.verdict !== 'late');
          const kept = judgedRef.current;
          for (const j of judged) kept.push({ ...j, bar: last.bar });
          if (kept.length > JUDGED_CAP) kept.splice(0, kept.length - JUDGED_CAP);
          const marks = marksOf(walk.steps, judged);
          if (marks.length > 0) {
            byBar.set(last.writtenBar, marks);
            ringedNow.add(last.writtenBar);
          } else {
            byBar.delete(last.writtenBar);
            ringedNow.delete(last.writtenBar);
          }
          judgedNow.add(last.writtenBar);
          changed = true;
        };

        for (const run of e.runs) {
          const step = walk.steps[run.index];
          if (!step || !Number.isFinite(run.sinceMs)) {
            // A key with no press time (or a step the plan does not have): no onset, and no gap
            // across it.
            chainRef.current++;
            lastRef.current = -1;
            continue;
          }
          const jumped = lastRef.current >= 0 && run.index !== lastRef.current + 1;
          if (jumped) chainRef.current++;
          const inBar = openBarRef.current;
          if (inBar !== null && (jumped || step.bar !== inBar)) judge(false);
          if (openBarRef.current === null || jumped || step.bar !== openBarRef.current) {
            // A new visit: the bar played again loses its rings, unless this tap just judged it.
            if (!judgedNow.has(step.writtenBar) && byBar.has(step.writtenBar)) {
              byBar.delete(step.writtenBar);
              changed = true;
            }
            openBarRef.current = step.bar;
          }
          const entries = entriesRef.current;
          entries.push({
            index: run.index,
            sinceMs: run.sinceMs,
            chain: chainRef.current,
            ms: null,
          });
          if (entries.length > ONSET_CAP) entries.splice(0, entries.length - ONSET_CAP);
          lastRef.current = run.index;
        }
        // A release too early: the step is pressed again, and that press is a correction, not
        // rhythm.
        if (e.early) chainRef.current++;
        const open = openBarRef.current;
        if (open !== null) {
          const next = e.at >= 0 ? walk.steps[e.at] : undefined;
          if (e.finished || !next || next.bar !== open || e.at !== lastRef.current + 1) {
            judge(e.finished); // the walk left the bar
            openBarRef.current = null;
          }
        }
        if (e.finished) {
          chainRef.current++;
          lastRef.current = -1;
        }

        if (changed) {
          ringsRef.current = { plan: walk, byBar: byBar.size > 0 ? byBar : NO_MARKS };
          setRings(ringsRef.current);
        }
        // The explanation, decided once per tap from the rings this tap left on screen.
        const shown = [...ringedNow].some((bar) => byBar.has(bar));
        if (shown && !explainedRef.current) {
          explainedRef.current = true;
          explainBarsRef.current = 0;
          showExplain(true);
        } else if (explainRef.current && judgedNow.size > 0) {
          explainBarsRef.current += judgedNow.size;
          if (explainBarsRef.current >= EXPLAIN_BARS) showExplain(false);
        }
      } catch (error) {
        // A timing fault never reaches the walk: the chain starts afresh.
        console.error(error);
        broken();
      }
    },
    [showExplain],
  );

  // Clears: the onsets, the chain, the judgements, the rings and the explanation on screen (the
  // explanation is said once per view, so `explainedRef` stays).
  const reset = useCallback(() => {
    entriesRef.current = [];
    chainRef.current++;
    openBarRef.current = null;
    lastRef.current = -1;
    judgedRef.current = [];
    ringsRef.current = { plan: liveRef.current.plan, byBar: NO_MARKS };
    setRings(ringsRef.current);
    showExplain(false);
  }, [showExplain]);
  // A new score, a hands change, Practice mode off, the piano lost, the setting off.
  useEffect(() => {
    reset();
  }, [reset, plan]);
  useEffect(() => {
    if (!ready) reset();
  }, [reset, ready]);
  // Play pressed. The layout effect above set `liveRef`, and these effects come before ScoreView's
  // usePlayAlong, so in the commit where Play starts the reset runs before the walk's inactive
  // break.
  const { playing } = playback;
  useEffect(() => {
    if (playing) reset();
  }, [reset, playing]);

  // Playwright's check.
  useEffect(() => {
    if (!hooksOn()) return;
    const w = window as unknown as { __digitus2Timing?: WalkTimingHook };
    const hook: WalkTimingHook = {
      steps: () => {
        const o = liveRef.current;
        if (!o.plan) return [];
        const { plan: walk, playback: pb, factor: tempo } = o;
        const loop = pb.performanceLoop();
        return walk.steps.map((step, i) => ({
          perfSec: step.perfSec,
          pitches: [...step.pitches],
          bar: step.bar,
          writtenBar: step.writtenBar,
          ids: [...step.ids],
          holdMs: (holdSec(walk.along, walk.times, i, loop) * 1000) / tempo,
        }));
      },
      onsets: () => {
        const walk = liveRef.current.plan;
        if (!walk) return [];
        return entriesRef.current.map((entry) => onsetOf(entry, walk, logRef.current));
      },
      judged: () =>
        judgedRef.current.map(({ bar, index, verdict, offsetMs, tolMs }) => ({
          bar,
          index,
          verdict,
          offsetMs,
          tolMs,
        })),
      markCount: () => {
        const kept = ringsRef.current;
        if (kept.plan === null || kept.plan !== liveRef.current.plan) return 0;
        let count = 0;
        for (const marks of kept.byBar.values()) count += marks.length;
        return count;
      },
    };
    w.__digitus2Timing = hook;
    return () => {
      if (w.__digitus2Timing === hook) delete w.__digitus2Timing;
    };
  }, []);

  // Derived in render: the commit that brings a new plan (score, hands, Practice mode) already has
  // no rings, before the reset effect runs, so old rings are never drawn on new pages.
  const marks = useMemo(
    () => (rings.plan === plan && rings.byBar.size > 0 ? [...rings.byBar.values()].flat() : null),
    [rings, plan],
  );
  return useMemo(() => ({ tap, marks, explain }), [tap, marks, explain]);
}
