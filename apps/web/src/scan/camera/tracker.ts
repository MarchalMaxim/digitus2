/**
 * The camera's per-frame analysis, off the main thread (issue 143): on a phone, registering one
 * tracking frame takes a quarter to half a second, which would freeze the viewfinder. A module
 * worker holds the page's reference, prepared once, and answers two questions about each frame:
 * `measure` (light, blur, the page's outline, sharpness) while aiming, and `track` (where the
 * reference is in this frame) while the views are taken. One question is asked at a time: while
 * the worker is busy, the camera skips frames rather than queueing stale ones. Where there is no
 * worker (old browsers, unit tests) the same handler answers at once on the main thread.
 */
import {
  trackerHandler,
  type Measured,
  type Tracked,
  type TrackerAnswer,
  type TrackerRequest,
} from './trackerHandler.js';
import type { Frame, Point } from './vision.js';

export type { Measured, Tracked } from './trackerHandler.js';

/** The part of `Worker` the tracker uses, so tests can stand in for it. */
export interface TrackerWorker {
  postMessage(message: TrackerRequest, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<TrackerAnswer>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  terminate(): void;
}

export interface Tracker {
  /** A question is being answered: grab no frame now, it would only be dropped. */
  readonly busy: boolean;
  /** The page's reference tracking frame and its region; the frame stays the caller's. */
  setReference(frame: Frame, region: readonly Point[]): void;
  /**
   * Ask about a frame, which is lent until the answer hands it back. False, and `done` is never
   * called, while busy. `done` gets undefined when the question could not be answered.
   */
  measure(frame: Frame, done: (answer: Measured | undefined) => void): boolean;
  track(frame: Frame, done: (answer: Tracked | undefined) => void): boolean;
  /** Stop the worker and refuse every later question. */
  dispose(): void;
}

/** Far longer than any answer takes on a slow phone (about half a second). */
const ANSWER_DEADLINE_MS = 4000;

function defaultWorker(): TrackerWorker | undefined {
  if (typeof Worker === 'undefined') return undefined;
  return new Worker(new URL('./tracker.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as TrackerWorker;
}

/**
 * The tracker over a worker from `spawn`, or on the main thread when there is none, it cannot
 * start, or it fails (then the question it held is answered with undefined).
 */
export function createTracker(spawn: () => TrackerWorker | undefined = defaultWorker): Tracker {
  let worker: TrackerWorker | undefined;
  try {
    worker = spawn();
  } catch {
    worker = undefined;
  }
  let local: ((request: TrackerRequest) => TrackerAnswer | undefined) | undefined;
  let reference: { frame: Frame; region: readonly Point[] } | undefined;
  let pending:
    | {
        id: number;
        done: (answer: TrackerAnswer | undefined) => void;
        deadline: ReturnType<typeof setTimeout> | undefined;
      }
    | undefined;
  let nextId = 0;
  let closed = false;

  /** The main-thread handler, given the current reference the first time it is needed. */
  const inThread = () => {
    if (!local) {
      local = trackerHandler();
      if (reference) local({ type: 'reference', ...reference });
    }
    return local;
  };
  const answer = (value: TrackerAnswer | undefined) => {
    const waiting = pending;
    // Free before answering, so the answer may ask the next question at once.
    pending = undefined;
    clearTimeout(waiting?.deadline);
    waiting?.done(value && value.type !== 'failed' ? value : undefined);
  };
  const fallBack = () => {
    worker?.terminate();
    worker = undefined;
    // The worker took the frame with it: this question has no answer, the next one will.
    answer(undefined);
  };
  if (worker) {
    worker.onmessage = (event) => {
      if (event.data.id === pending?.id) answer(event.data);
    };
    worker.onerror = fallBack;
    worker.onmessageerror = fallBack;
  }
  const ask = (
    type: 'measure' | 'track',
    frame: Frame,
    done: (answer: TrackerAnswer | undefined) => void,
  ): boolean => {
    if (pending || closed) return false;
    const request = { type, id: ++nextId, frame };
    pending = { id: request.id, done, deadline: undefined };
    if (worker)
      try {
        worker.postMessage(request, [request.frame.data.buffer]);
        // A worker that neither answers nor fails (killed by the browser, a message lost) must
        // not leave the camera waiting for ever: the main thread takes over.
        pending.deadline = setTimeout(fallBack, ANSWER_DEADLINE_MS);
        return true;
      } catch {
        worker.terminate();
        worker = undefined;
      }
    // Never left busy: an answer that throws is an unanswered question, and tracking goes on.
    try {
      answer(inThread()(request));
    } catch {
      answer(undefined);
    }
    return true;
  };
  return {
    get busy() {
      return !!pending;
    },
    setReference(frame, region) {
      reference = { frame, region: region.map((point) => ({ x: point.x, y: point.y })) };
      try {
        if (local) local({ type: 'reference', ...reference });
      } catch {
        // A reference the handler cannot prepare tracks nothing; its questions answer undefined.
      }
      // Copied, not transferred: the reference stays the caller's, and the fallback's.
      if (worker)
        try {
          worker.postMessage({ type: 'reference', ...reference }, []);
        } catch {
          fallBack();
        }
      else
        try {
          inThread();
        } catch {
          // As above: the questions will answer undefined.
        }
    },
    measure(frame, done) {
      return ask('measure', frame, (value) => done(value?.type === 'measure' ? value : undefined));
    },
    track(frame, done) {
      return ask('track', frame, (value) => done(value?.type === 'track' ? value : undefined));
    },
    dispose() {
      closed = true;
      worker?.terminate();
      worker = undefined;
      clearTimeout(pending?.deadline);
      pending = undefined;
    },
  };
}
