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
  solve(
    score: Score,
    profile: HandSize,
    pins?: Assignment,
  ): Promise<{ assignment: Assignment; ms: number }>;
  fingeredXml(xml: string, score: Score, assignment: Assignment): Promise<string>;
  /**
   * "Add notes between": the guarded light embellishment of a plain MusicXML text, or null with
   * the guard's reason.
   */
  embellish(
    xml: string,
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
 * `onFail` is told once when the worker fails, so the owner can make a fresh client for the next
 * piece (this one stays closed).
 */
export function createEngineClient(
  worker: WorkerLike = defaultWorker(),
  onFail?: (e: Error) => void,
): EngineClient {
  const pending = new Map<number, Pending>();
  let nextId = 0;
  // Set once the client can no longer answer: disposed, or the worker itself failed.
  let closed: Error | undefined;

  function rejectAll(e: Error) {
    for (const p of pending.values()) p.reject(e);
    pending.clear();
  }

  worker.onmessage = (e: MessageEvent) => {
    const res = e.data as EngineResponse;
    const p = pending.get(res.id);
    if (!p) return; // answered after dispose or a worker failure
    pending.delete(res.id);
    if (!res.ok) p.reject(new Error(res.error));
    else if (res.type !== p.type)
      p.reject(new Error(`engine worker answered "${res.type}" to a "${p.type}" request`));
    else p.resolve(res);
  };

  // An uncaught failure in the worker (its script did not load, a result could not be cloned)
  // would otherwise leave every pending call waiting forever. handle() itself never throws.
  worker.onerror = (e: ErrorEvent) => {
    if (closed) return;
    // The reader may be shown this (a score that cannot load), so it is a Phrase.
    const detail = e.message;
    closed = new PhraseError((t) => t.app.engineFailed(detail));
    worker.terminate();
    rejectAll(closed);
    onFail?.(closed);
  };

  function call<B extends RequestBody>(body: B): Promise<OkOf<B['type']>> {
    if (closed) return Promise.reject(closed);
    const id = ++nextId;
    return new Promise<OkOf<B['type']>>((resolve, reject) => {
      pending.set(id, {
        type: body.type,
        // onmessage has checked that the response type matches the request type.
        resolve: (res) => resolve(res as OkOf<B['type']>),
        reject,
      });
      try {
        worker.postMessage({ ...body, id });
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
    solve(score, profile, pins) {
      // exactOptionalPropertyTypes: leave `pins` out rather than send `pins: undefined`.
      const body: Extract<RequestBody, { type: 'solve' }> = pins
        ? { type: 'solve', score, profile, pins }
        : { type: 'solve', score, profile };
      return call(body).then(({ assignment, ms }) => ({ assignment, ms }));
    },
    fingeredXml(xml, score, assignment) {
      return call({ type: 'fingeredXml', xml, score, assignment }).then((res) => res.xml);
    },
    embellish(xml) {
      return call({ type: 'embellish', xml }).then(({ offered, reason, ms }) => ({
        offered,
        reason,
        ms,
      }));
    },
    dispose() {
      closed = new Error('engine client disposed');
      worker.terminate();
      rejectAll(closed);
    },
  };
}
