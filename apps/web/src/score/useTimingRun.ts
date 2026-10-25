/**
 * The timing run (issue 192): with a piano connected and Practice mode on, a run of Play is the
 * reader's turn to play along. Digitus listens: each note-on is mapped, as it arrives, to where
 * the listener was when the key went down (`Playback.heardAt` at the message's `atMs`), because the
 * transport forgets its segments a little after they end. When the run stops (Pause, the end of
 * the piece, a selection that pauses) the presses are judged against what was heard
 * (`judgeRun`, on the passes of `Playback.runPasses`), and the result is kept until the next Play.
 *
 * Armed while the walk could own the red (the piano on and connected, Practice mode on, the score
 * ready and playable), without "not playing": a run is judged only when it was armed from its
 * start and still is at its stop. A new score, a change of the hands played, Practice mode off,
 * the piano going away or the document leaving `ready` clears the result and discards a run in
 * progress.
 *
 * A MIDI message renders nothing here: presses go into refs, and only a judgement and a clear set
 * the one state. Nothing is drawn and nothing is said during the run.
 */
import type { Hand, Score } from '@digitus2/engine';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tempoFactorOf, useAppStore } from '../app/store.js';
import { performanceFor } from '../audio/performance.js';
import type { HeardAt, PassSpan } from '../audio/timeline.js';
import { subscribeNotes, usePianoSnapshot } from '../midi/piano.js';
import type { TimingMark } from './render/timingMarks.js';
import {
  judgeRun,
  timingSteps,
  type RunJudgement,
  type TimedPress,
  type TimingStep,
} from './timing.js';
import type { Playback } from './usePlayback.js';

export interface TimingRunOptions {
  score: Score | null;
  /** `doc.status === 'ready'`. */
  ready: boolean;
  playable: boolean;
  playback: Playback;
  mutedHands: readonly Hand[];
}

/** What the status line says after a run (issue 192). */
export interface TimingSummary {
  onTime: number;
  total: number;
  /** The run ended below 100 % Practice tempo. */
  belowFullTempo: boolean;
}

export interface TimingRun {
  /** The rings of the last run, null when none are shown. */
  marks: readonly TimingMark[] | null;
  /** The last run's summary (a new object per judgement), null when none is shown. */
  summary: TimingSummary | null;
}

/** One note-on heard while armed, as the Playwright check and the latency notes read it. */
export interface TimingLogEntry {
  midi: number;
  /** The recorder's own performance.now() in the listener. */
  arrivalMs: number;
  /** NoteMessage.atMs (the event time, or arrival when implausible). */
  atMs: number;
  /** Where the press was heard; null when the transport was not playing. */
  pass: number | null;
  perfSec: number | null;
  factor: number | null;
}

/** What the Playwright check reads (installed with `?audio=silent` or `?hooks=1`). */
export interface TimingHook {
  /** The last LOG_CAP note-ons heard while armed, oldest first. */
  presses(): TimingLogEntry[];
  /** The current run's passes (`Playback.runPasses`). */
  passes(): PassSpan[];
  /** The steps of the hands played (`timingSteps`): onset, pitches and parts. */
  steps(): {
    perfSec: number;
    pitches: number[];
    parts: { hand: Hand; pitches: number[]; key: string }[];
  }[];
  /** `Playback.heardAt(performance.now())`. */
  heardNow(): HeardAt | null;
  /** The last run's judgement, null when none or barely played. */
  judgement(): RunJudgement | null;
}

/** The log's cap; the judge's own list follows the runs (dropped after each judgement). */
const LOG_CAP = 2000;

const NO_STEPS: TimingStep[] = [];

/** The latest render's view of the options, read by the listener and the run's stop. */
interface Live {
  armed: boolean;
  playback: Playback;
  steps: readonly TimingStep[];
  /** The open piece's Practice tempo: real seconds = performance seconds / factor. */
  factor: number;
}

interface Result {
  judgement: RunJudgement;
  marks: readonly TimingMark[] | null;
  summary: TimingSummary;
}

/** The Playwright hooks are on: `?audio=silent` (the silent instrument) or `?hooks=1` (the real one). */
function hooksOn(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('audio') === 'silent' || params.get('hooks') === '1';
}

/** The rings and the line of a judgement: a ring for each unit that was not on time. */
function resultOf(judgement: RunJudgement, factor: number): Result {
  const marks = judgement.verdicts.flatMap((v): TimingMark[] =>
    v.verdict === 'onTime'
      ? []
      : [{ ids: v.ids, verdict: v.verdict, offsetSec: v.offsetSec, prev: v.prev, next: v.next }],
  );
  return {
    judgement,
    marks: marks.length > 0 ? marks : null,
    summary: {
      onTime: judgement.onTime,
      total: judgement.total,
      belowFullTempo: factor < 1,
    },
  };
}

export function useTimingRun({
  score,
  ready,
  playable,
  playback,
  mutedHands,
}: TimingRunOptions): TimingRun {
  const setting = useAppStore((s) => s.settings.playAlong);
  const practiceMode = useAppStore((s) => s.settings.practiceMode);
  const factor = useAppStore(tempoFactorOf);
  const piano = usePianoSnapshot();
  const connected = setting && piano.status === 'connected';
  // A playback without the timeline (a hand-made fake) has nothing to time against.
  const timed = playback.heardAt !== undefined && playback.runPasses !== undefined;
  const armed = connected && practiceMode && ready && playable && score !== null && timed;

  // The steps of the hands played, as the walk has them; the list of hands is rebuilt from its
  // key, so a new array of the same hands changes nothing.
  const muteKey = [...new Set(mutedHands)].sort().join(',');
  const steps = useMemo(
    () =>
      armed && score
        ? timingSteps(performanceFor(score), muteKey ? (muteKey.split(',') as Hand[]) : [])
        : NO_STEPS,
    [armed, score, muteKey],
  );

  const [result, setResult] = useState<Result | null>(null);
  const liveRef = useRef<Live>({ armed, playback, steps, factor });
  const resultRef = useRef<Result | null>(result);
  useLayoutEffect(() => {
    liveRef.current = { armed, playback, steps, factor };
    resultRef.current = result;
  });
  /** The judge's presses: every note-on heard while armed and playing, until its run is judged. */
  const pressesRef = useRef<TimedPress[]>([]);
  const logRef = useRef<TimingLogEntry[]>([]);
  /** A run is in progress that was armed at its start. */
  const runRef = useRef(false);

  // Every note-on, mapped live: the transport prunes its segments soon after they end.
  useEffect(
    () =>
      subscribeNotes((e) => {
        if (!e.on || e.lost) return;
        const o = liveRef.current;
        if (!o.armed) return;
        const arrivalMs = performance.now();
        const atMs = e.atMs ?? arrivalMs;
        const heard = o.playback.playingNow() ? (o.playback.heardAt?.(atMs) ?? null) : null;
        const log = logRef.current;
        log.push({
          midi: e.midi,
          arrivalMs,
          atMs,
          pass: heard?.pass ?? null,
          perfSec: heard?.perfSec ?? null,
          factor: heard?.factor ?? null,
        });
        if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP);
        if (heard) {
          pressesRef.current.push({
            pass: heard.pass,
            perfSec: heard.perfSec,
            midi: e.midi,
            factor: heard.factor,
          });
        }
      }),
    [],
  );

  // Discard and clear (R1.5): declared before the run's stop, so a stop in the same commit as one
  // of these judges nothing.
  useEffect(() => {
    runRef.current = false;
    pressesRef.current = [];
    setResult(null);
  }, [score, muteKey, practiceMode, connected, ready]);

  // A run is one stretch of the transport playing: its start clears the last result, its stop
  // judges it. Only presses whose pass is in the run's log are judged, so a press the listener
  // took before this effect saw the start still counts. Runs are told apart by `playId`, not by
  // `playing` turning: a play carried across "Add notes between" halts the old transport and
  // starts the new one in the same commit, so `playing` stays true while a new run begins.
  const runId = playback.playing ? (playback.playId ?? 0) : null;
  const runIdRef = useRef(runId);
  useEffect(() => {
    const was = runIdRef.current;
    runIdRef.current = runId;
    if (runId === was) return;
    const o = liveRef.current;
    if (runId !== null) {
      if (was !== null) {
        // Straight from one run into the next: the new start replaced the passes of the one before
        // (a carried play's new score has discarded it anyway), so it is never judged and its
        // presses go.
        const first = o.playback.runPasses?.()[0]?.pass ?? Infinity;
        pressesRef.current = pressesRef.current.filter((p) => p.pass >= first);
      }
      runRef.current = o.armed;
      setResult(null);
      return;
    }
    const run = runRef.current;
    runRef.current = false;
    const passes = o.playback.runPasses?.() ?? [];
    const presses = pressesRef.current;
    // The presses of this run's passes are spent, judged or not; pass numbers never repeat.
    const highest = passes.reduce((top, p) => Math.max(top, p.pass), -Infinity);
    pressesRef.current = presses.filter((p) => p.pass > highest);
    if (!run || !o.armed) return;
    const judgement = judgeRun({ steps: o.steps, passes, presses, factor: o.factor });
    if (judgement) setResult(resultOf(judgement, o.factor));
  }, [runId]);

  // Playwright's check, and the latency notes (docs/research/play-along-timing.md).
  useEffect(() => {
    if (!hooksOn()) return;
    const w = window as unknown as { __digitus2Timing?: TimingHook };
    const hook: TimingHook = {
      presses: () => logRef.current.map((entry) => ({ ...entry })),
      passes: () => [...(liveRef.current.playback.runPasses?.() ?? [])],
      steps: () =>
        liveRef.current.steps.map((s) => ({
          perfSec: s.perfSec,
          pitches: [...s.pitches],
          parts: s.parts.map((p) => ({ hand: p.hand, pitches: [...p.pitches], key: p.key })),
        })),
      heardNow: () => liveRef.current.playback.heardAt?.(performance.now()) ?? null,
      judgement: () => resultRef.current?.judgement ?? null,
    };
    w.__digitus2Timing = hook;
    return () => {
      if (w.__digitus2Timing === hook) delete w.__digitus2Timing;
    };
  }, []);

  return useMemo(
    () => ({ marks: result?.marks ?? null, summary: result?.summary ?? null }),
    [result],
  );
}
