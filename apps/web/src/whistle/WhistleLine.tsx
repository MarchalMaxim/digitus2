import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWhistleText, type WhistleText } from '../i18n/whistle/index.js';
import { useAppStore } from '../app/store.js';
import { takeWhistleAgain } from './again.js';
import type { Recorder, RecorderFailure } from './recorder.js';
import { LIMIT_S, whistleSession } from './session.js';
import { whistleSupported } from './support.js';
import './whistle.css';

/** How far back the live trace reaches, and the range of semitones it shows (A3 to G7). */
const TRACE_S = 5;
const LOW = 57;
const HIGH = 103;

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function MicrophoneSymbol() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        d="M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V5Z M5.5 11a6.5 6.5 0 0 0 13 0 M12 17.5V21 M8.5 21h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The live pitch trace in ink: a dot for each moment the pitch was clear, higher on the canvas for
 * a higher note, sliding left as the recording goes on.
 */
function Trace({ recorder, onSecond }: { recorder: Recorder; onSecond(seconds: number): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ recorder, onSecond });
  latest.current = { recorder, onSecond };
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const points: (number | null)[] = [];
    let frame = 0;
    let shown = -1;
    const draw = () => {
      const { recorder: open, onSecond: tell } = latest.current;
      const { hz } = open.latest();
      points.push(hz === null ? null : 69 + 12 * Math.log2(hz / 440));
      const wanted = Math.round(TRACE_S * 60);
      if (points.length > wanted) points.splice(0, points.length - wanted);
      const ratio = window.devicePixelRatio || 1;
      const width = Math.round(el.clientWidth * ratio);
      const height = Math.round(el.clientHeight * ratio);
      if (el.width !== width) el.width = width;
      if (el.height !== height) el.height = height;
      ctx.clearRect(0, 0, width, height);
      const ink = getComputedStyle(el).color;
      ctx.fillStyle = ink;
      const dot = 2.5 * ratio;
      points.forEach((midi, i) => {
        if (midi === null) return;
        const x = width - (points.length - i) * (width / wanted);
        const y =
          (1 - (Math.min(HIGH, Math.max(LOW, midi)) - LOW) / (HIGH - LOW)) * (height - 2 * dot) +
          dot;
        ctx.fillRect(x, y - dot / 2, dot, dot);
      });
      const seconds = Math.floor(open.elapsed());
      if (seconds !== shown) {
        shown = seconds;
        tell(seconds);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={canvas} className="whistle-trace" aria-hidden="true" />;
}

type State = 'idle' | 'starting' | 'recording' | 'writing';

/**
 * Whistle a tune (issue 237), a line beside the camera's and the file chooser: the press is the
 * reader's consent to the microphone. While recording the line is the live trace, the time and
 * Stop, with one gray sentence; Escape cancels, and so does leaving the library. Stop writes the
 * notes and opens the recording as a scan that is already read, so the review takes it from there.
 * Nothing here is red: the library keeps its one red.
 */
export default function WhistleLine() {
  const text = useWhistleText();
  const [state, setState] = useState<State>('idle');
  const [problem, setProblem] = useState<keyof WhistleText | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [live, setLive] = useState<Recorder | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const alive = useRef(true);
  const start = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  const begin = async (made?: AudioContext) => {
    if (state !== 'idle') {
      void made?.close().catch(() => undefined);
      return;
    }
    setProblem(null);
    setState('starting');
    // Made here, in the press itself: Safari lets a context run only when a press made it, and
    // the press has been through a fetch and the browser's prompt by the time the sound starts.
    let context = made;
    try {
      context ??= new AudioContext();
      const { startRecorder } = await import('./recorder.js');
      const opened = await startRecorder(context);
      if (!alive.current) {
        opened.cancel();
        return;
      }
      recorder.current = opened;
      setLive(opened);
      setSeconds(0);
      setState('recording');
    } catch (cause) {
      void context?.close().catch(() => undefined);
      if (!alive.current) return;
      const reason: RecorderFailure =
        typeof cause === 'object' && cause !== null && 'reason' in cause
          ? (cause as { reason: RecorderFailure }).reason
          : 'failed';
      setProblem(reason);
      setState('idle');
    }
  };
  const beginRef = useRef(begin);
  beginRef.current = begin;

  const cancel = () => {
    recorder.current?.cancel();
    recorder.current = null;
    setLive(null);
    refocus.current = true;
    setState('idle');
  };
  const stop = async () => {
    const open = recorder.current;
    if (!open || state !== 'recording') return;
    recorder.current = null;
    setLive(null);
    setState('writing');
    // Let the "writing" state paint before the transcription takes the thread.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const heard = await open.stop().catch(() => undefined);
    if (!alive.current) return;
    if (!heard) {
      setProblem(heard === null ? 'noNotes' : 'failed');
      refocus.current = true;
      setState('idle');
      return;
    }
    // A refusal still showing would be stale in the review; leaving the library saves its scroll.
    const { setNotice, openScan } = useAppStore.getState();
    setNotice(null);
    openScan(whistleSession(heard));
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;

  // Leaving the library, or a new render of the page, releases the microphone.
  useEffect(() => {
    alive.current = true;
    if (whistleSupported()) {
      const made = takeWhistleAgain();
      if (made) void beginRef.current(made);
    }
    return () => {
      alive.current = false;
      recorder.current?.cancel();
      recorder.current = null;
    };
  }, []);

  useEffect(() => {
    if (state !== 'recording') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The recording stops by itself at its limit.
  useEffect(() => {
    if (state === 'recording' && seconds >= LIMIT_S) void stopRef.current();
  }, [state, seconds]);

  // The focus follows the line: to Stop when the recording starts, back to the press when it ends.
  useLayoutEffect(() => {
    if (state === 'recording') stopButton.current?.focus();
    else if (state === 'idle' && refocus.current) {
      refocus.current = false;
      start.current?.focus();
    }
  }, [state]);

  if (!whistleSupported()) return null;
  if (state === 'recording' || state === 'writing') {
    return (
      <div className="whistle-recording" role="group" aria-label={text.recording}>
        {live ? (
          <Trace recorder={live} onSecond={setSeconds} />
        ) : (
          <div className="whistle-trace" aria-hidden="true" />
        )}
        <span className="whistle-time">{clock(seconds)}</span>
        <button
          ref={stopButton}
          type="button"
          disabled={state === 'writing'}
          onClick={() => void stop()}
        >
          {text.stop}
        </button>
        <p className="muted small whistle-hint" role="status">
          {state === 'writing' ? text.writing : text.hint}
        </p>
      </div>
    );
  }
  return (
    <div className="whistle-line">
      <button
        ref={start}
        type="button"
        className="text-button own-file whistle-entry"
        aria-busy={state === 'starting' || undefined}
        onClick={() => void begin()}
      >
        <MicrophoneSymbol />
        {text.start}
      </button>
      {problem && (
        <p className="muted small" role="alert">
          {text[problem]}
        </p>
      )}
    </div>
  );
}
