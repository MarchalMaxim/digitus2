/**
 * The engine client: parse, solve, fingered-XML export and the guarded embellishment as promises
 * over the engine worker, so the main thread never parses MusicXML or runs the solver (spec
 * section 4). Requests carry an incrementing id and responses are matched by it, so answers may
 * arrive in any order.
 */
import type { Assignment, MidiInfo, Score } from '@digitus2/engine';
import type { HandSize } from '../app/store.js';
import { PhraseError } from '../i18n/PhraseError.js';
import {
  sourceKind,
  type EmbellishedDoc,
  type EngineRequest,
  type EngineResponse,
} from './protocol.js';

/** What the printed digits depend on besides the fingering (issue 94). */
export interface EditionOptions {
  level?: number;
  editorDigits?: number;
}

export interface EngineClient {
  /**
   * Parses a MusicXML file, or imports a MIDI file (decided by `sourceKind(source)`); for MIDI,
   * `opts.splitMidi` replaces the learned hand separation with a fixed split point.
   */
  load(
    input: string | Uint8Array,
    source: string,
    opts?: { splitMidi?: number; preserveNotation?: boolean },
  ): Promise<{
    score: Score;
    editorial: Assignment;
    warnings: string[];
    xml: string;
    midiInfo: MidiInfo | null;
  }>;
  /**
   * `edition` tunes the digits printed at rest (issue 94): the library level and, for a library
   * piece with an editor's fingering, the editor's digit count as the cap. Uploads pass neither.
   */
  solve(
    score: Score,
    profile: HandSize,
    pins?: Assignment,
    edition?: EditionOptions,
  ): Promise<{ assignment: Assignment; printed: string[]; ms: number }>;
  fingeredXml(xml: string, score: Score, assignment: Assignment): Promise<string>;
  /**
   * "Add notes between": the guarded light embellishment of a plain MusicXML text, or null with
   * the guard's reason.
   */
  embellish(
    xml: string,
    level?: number,
  ): Promise<{ offered: EmbellishedDoc | null; reason: string | null; ms: number }>;
  /** Terminates the worker and rejects every pending call. */
  dispose(): void;
}

/**
 * The part of `Worker` the client uses; structurally the same as the renderer's `WorkerLike`
 * (`score/render/renderer.ts`), so one fake worker type serves both. `onerror` is optional so
 * fakes can leave it out; a real `Worker` reports a script that failed to load through it.
 */
export interface WorkerLike {
  postMessage(m: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror?: ((e: ErrorEvent) => void) | null;
  terminate(): void;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RequestBody = DistributiveOmit<EngineRequest, 'id'>;
type OkResponse = Extract<EngineResponse, { ok: true }>;
type OkOf<T extends RequestBody['type']> = Extract<OkResponse, { type: T }>;

interface Pending {
  type: RequestBody['type'];
  resolve(res: OkResponse): void;
  reject(e: Error): void;
}

function defaultWorker(): WorkerLike {
  return new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * A score of this many notes or more makes the worker's work heavy: reading and writing its
 * MusicXML builds whole xmldom trees, about 40 bytes of heap per byte of text (Beethoven's Ninth,
 * 11,049 notes in 6 MB: some 200 MB), and V8 collects that garbage only some 20 s after the worker
 * goes idle. About a tenth of the library is this long (docs/research/ram-usage.md).
 */
export const HEAVY_NOTES = 2000;

/** How long the worker idles after heavy work before it is released (ms). */
export const RELEASE_IDLE_MS = 2000;

/** The notes of the score a request carries or an answer brings, for `HEAVY_NOTES`. */
function notesOf(m: RequestBody | OkResponse): number {
  return 'score' in m && m.score ? m.score.notes.length : 0;
}

/**
 * `spawn` makes the worker: one at once, so the library's warm-up loads the engine ahead of the
 * first piece. Once the worker has handled a score of `HEAVY_NOTES` or more and then idled for
 * `releaseIdleMs` with nothing pending, it is terminated, and the next call spawns a fresh one
 * (the worker keeps no state between calls); shorter pieces keep theirs. Chrome hands a terminated
 * worker's heap back on its own schedule, about when V8 would have collected the garbage, so the
 * release saves the idle worker itself (some 25 MB) and part of the garbage sooner: 24 to 107 MB
 * on the longest pieces (docs/research/ram-usage.md). `onFail` is told once when a worker fails,
 * so the owner can make a fresh client for the next piece (this one stays closed).
 */
export function createEngineClient(
  spawn: () => WorkerLike = defaultWorker,
  onFail?: (e: Error) => void,
  releaseIdleMs = RELEASE_IDLE_MS,
): EngineClient {
  const pending = new Map<number, Pending>();
  let nextId = 0;
  // Set once the client can no longer answer: disposed, or the worker itself failed.
  let closed: Error | undefined;
  // The worker running now; undefined once released, until the next call.
  let worker: WorkerLike | undefined;
  // This worker has handled a long piece: release it once it idles.
  let heavy = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function rejectAll(e: Error) {
    for (const p of pending.values()) p.reject(e);
    pending.clear();
  }

  function stopIdleTimer() {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = undefined;
  }

  function release() {
    idleTimer = undefined;
    if (closed || pending.size > 0 || !worker) return;
    worker.terminate();
    worker = undefined;
    heavy = false;
  }

  function start(): WorkerLike {
    const w = spawn();
    w.onmessage = (e: MessageEvent) => {
      const res = e.data as EngineResponse;
      const p = pending.get(res.id);
      if (!p) return; // answered after dispose or a worker failure
      pending.delete(res.id);
      if (!res.ok) p.reject(new Error(res.error));
      else if (res.type !== p.type)
        p.reject(new Error(`engine worker answered "${res.type}" to a "${p.type}" request`));
      else {
        if (notesOf(res) >= HEAVY_NOTES) heavy = true;
        p.resolve(res);
      }
      if (heavy && pending.size === 0 && w === worker) {
        stopIdleTimer();
        idleTimer = setTimeout(release, releaseIdleMs);
      }
    };
    // An uncaught failure in the worker (its script did not load, a result could not be cloned)
    // would otherwise leave every pending call waiting forever. handle() itself never throws.
    // A worker already released is gone: whatever it reports is not this client's.
    w.onerror = (e: ErrorEvent) => {
      if (closed || w !== worker) return;
      // The reader may be shown this (a score that cannot load), so it is a Phrase.
      const detail = e.message;
      closed = new PhraseError((t) => t.app.engineFailed(detail));
      stopIdleTimer();
      w.terminate();
      rejectAll(closed);
      onFail?.(closed);
    };
    return w;
  }

  worker = start();

  function call<B extends RequestBody>(body: B): Promise<OkOf<B['type']>> {
    if (closed) return Promise.reject(closed);
    stopIdleTimer();
    const w = (worker ??= start());
    if (notesOf(body) >= HEAVY_NOTES) heavy = true;
    const id = ++nextId;
    return new Promise<OkOf<B['type']>>((resolve, reject) => {
      pending.set(id, {
        type: body.type,
        // onmessage has checked that the response type matches the request type.
        resolve: (res) => resolve(res as OkOf<B['type']>),
        reject,
      });
      try {
        w.postMessage({ ...body, id });
      } catch (e) {
        // A value that cannot be cloned: the promise rejects with that error, nothing waits.
        pending.delete(id);
        throw e;
      }
    });
  }

  return {
    load(input, source, opts) {
      // exactOptionalPropertyTypes: leave `splitMidi` out rather than send `splitMidi: undefined`.
      return call({
        type: 'load',
        kind: sourceKind(source),
        input,
        source,
        ...(opts?.preserveNotation !== undefined
          ? { preserveNotation: opts.preserveNotation }
          : {}),
        ...(opts?.splitMidi !== undefined ? { splitMidi: opts.splitMidi } : {}),
      }).then(({ score, editorial, warnings, xml, midiInfo }) => ({
        score,
        editorial,
        warnings,
        xml,
        midiInfo,
      }));
    },
    solve(score, profile, pins, edition) {
      // exactOptionalPropertyTypes: leave what is absent out rather than send it as undefined.
      const body: Extract<RequestBody, { type: 'solve' }> = {
        type: 'solve',
        score,
        profile,
        ...(pins ? { pins } : {}),
        ...(edition?.level !== undefined ? { level: edition.level } : {}),
        ...(edition?.editorDigits !== undefined ? { editorDigits: edition.editorDigits } : {}),
      };
      return call(body).then(({ assignment, printed, ms }) => ({ assignment, printed, ms }));
    },
    fingeredXml(xml, score, assignment) {
      return call({ type: 'fingeredXml', xml, score, assignment }).then((res) => res.xml);
    },
    embellish(xml, level) {
      return call(
        level !== undefined ? { type: 'embellish', xml, level } : { type: 'embellish', xml },
      ).then(({ offered, reason, ms }) => ({
        offered,
        reason,
        ms,
      }));
    },
    dispose() {
      closed = new Error('engine client disposed');
      stopIdleTimer();
      worker?.terminate();
      worker = undefined;
      rejectAll(closed);
    },
  };
}
