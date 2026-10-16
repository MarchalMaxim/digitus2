/**
 * The renderer adapter: lays out MusicXML to SVG pages in the Verovio worker. Only the newest
 * render request counts: a newer `render()` rejects every older pending one with
 * `SupersededError`, and their late results are dropped, so a resize never shows a stale layout.
 * A worker that fails (its script did not load, it crashed) rejects every pending and later
 * request, so the score view shows an error instead of waiting forever.
 */
import type { WorkerLike } from '../../engine/client.js';
import { normalizeVoices } from './normalizeVoices.js';
import { prepareScanBeams } from './scanBeams.js';

/** The part of `Worker` the adapter uses: the engine client's type, so one fake serves both. */
export type { WorkerLike } from '../../engine/client.js';

export interface RenderRequest {
  xml: string;
  widthPx: number;
}

export interface RenderResult {
  pages: string[];
  ms: number;
}

export interface ScoreRenderer {
  /** Lays out `xml` at `widthPx`; a newer call makes this one reject with `SupersededError`. */
  render(req: RenderRequest): Promise<RenderResult>;
  /** Asks the worker to compile the WASM now, so the first piece opens faster. Posts once. */
  warmUp(): void;
  /** Terminates the worker and rejects every pending request. */
  dispose(): void;
}

export class SupersededError extends Error {
  constructor() {
    super('render superseded by a newer request');
    this.name = 'SupersededError';
  }
}

/** Messages to the worker. */
export type RenderWorkerRequest =
  { id: number; type: 'init' } | { id: number; type: 'render'; xml: string; widthPx: number };

/** Messages from the worker. */
export type RenderWorkerResponse =
  { id: number; ok: true; pages: string[]; ms: number } | { id: number; ok: false; error: string };

interface Pending {
  resolve(r: RenderResult): void;
  reject(e: Error): void;
}

function defaultWorker(): WorkerLike {
  return new Worker(new URL('./verovio.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * `onFail` is told once when the worker fails, so the owner can make a fresh renderer for the
 * next piece (this one stays closed).
 */
export function createRenderer(
  worker: WorkerLike = defaultWorker(),
  onFail?: (e: Error) => void,
): ScoreRenderer {
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let warmed = false;
  let disposed = false;
  // Set once the worker has failed: every request after that rejects with it.
  let failure: Error | undefined;

  const post = (m: RenderWorkerRequest) => worker.postMessage(m);
  const rejectAll = (e: Error) => {
    for (const p of pending.values()) p.reject(e);
    pending.clear();
  };

  worker.onmessage = (e: MessageEvent) => {
    const res = e.data as RenderWorkerResponse;
    const p = pending.get(res.id);
    if (!p) return; // superseded, disposed, or an init acknowledgement
    pending.delete(res.id);
    if (res.ok) p.resolve({ pages: res.pages, ms: res.ms });
    else p.reject(new Error(res.error));
  };

  worker.onerror = (e: ErrorEvent) => {
    if (disposed) return;
    // A failed module load reports a plain Event, without a message.
    const message = typeof e.message === 'string' && e.message ? `: ${e.message}` : '';
    failure = new Error(`the score renderer failed${message}`);
    disposed = true;
    worker.terminate();
    rejectAll(failure);
    onFail?.(failure);
  };

  return {
    render({ xml, widthPx }) {
      if (disposed) return Promise.reject(failure ?? new Error('renderer disposed'));
      const id = ++nextId;
      for (const [older, p] of pending) {
        if (older < id) {
          pending.delete(older);
          p.reject(new SupersededError());
        }
      }
      warmed = true;
      return new Promise<RenderResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        post({ id, type: 'render', xml: prepareScanBeams(normalizeVoices(xml)), widthPx });
      });
    },
    warmUp() {
      if (warmed || disposed) return;
      warmed = true;
      post({ id: ++nextId, type: 'init' });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      worker.terminate();
      rejectAll(new Error('renderer disposed'));
    },
  };
}
