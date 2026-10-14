/**
 * The engine client: parse, solve and fingered-XML export as promises over the engine worker,
 * so the main thread never parses MusicXML or runs the solver (spec section 4). Requests carry
 * an incrementing id and responses are matched by it, so answers may arrive in any order.
 */
import type { Assignment, Score } from '@digitus2/engine';
import type { HandSize } from '../app/store.js';
import type { EngineRequest, EngineResponse } from './protocol.js';

export interface EngineClient {
  load(
    input: string | Uint8Array,
    source: string,
  ): Promise<{ score: Score; editorial: Assignment; warnings: string[]; xml: string }>;
  solve(
    score: Score,
    profile: HandSize,
    pins?: Assignment,
  ): Promise<{ assignment: Assignment; ms: number }>;
  fingeredXml(xml: string, score: Score, assignment: Assignment): Promise<string>;
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
    closed = new Error(`the engine worker failed${e.message ? `: ${e.message}` : ''}`);
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
    load(input, source) {
      return call({ type: 'load', input, source }).then(({ score, editorial, warnings, xml }) => ({
        score,
        editorial,
        warnings,
        xml,
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
    dispose() {
      closed = new Error('engine client disposed');
      worker.terminate();
      rejectAll(closed);
    },
  };
}
