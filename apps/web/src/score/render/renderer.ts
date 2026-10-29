/**
 * The renderer adapter: lays out MusicXML to SVG pages in the Verovio worker. Only the newest
 * render request counts: a newer `render()` rejects every older pending one with
 * `SupersededError`, and their late results are dropped, so a resize never shows a stale layout.
 * A layout with no page rejects with `NO_MUSIC`, so a view never waits on a score that draws
 * nothing. A worker that fails (its script did not load, it crashed) rejects every pending request,
 * so the score view shows an error instead of waiting forever, and the next request starts a fresh
 * worker: one crash does not refuse every later layout (issue 233).
 *
 * The worker (its 128 MB WASM heap and some 50 MB of code) is kept warm between pieces, except
 * after a long one: once it has laid out a piece of `HEAVY_NOTES` or more, or its heap has grown
 * (Verovio's heap never shrinks: 154 MB after Beethoven's Ninth, 221 MB after an 18,000-note
 * medley), it is retired once nothing is pending. That frees the whole worker while the piece is
 * read (some 190 MB on Chopin's Scherzo No. 2), and the next layout or the library's warm-up
 * starts a fresh one: a long piece pays a cold start on its next layout (a new width bucket, the
 * editor's fingering), which itself takes seconds (docs/research/ram-usage.md).
 */
import { HEAVY_NOTES, type WorkerLike } from '../../engine/client.js';
import { normalizeVoices } from './normalizeVoices.js';
import { prepareScanBeams } from './scanBeams.js';

/** The part of `Worker` the adapter uses: the engine client's type, so one fake serves both. */
export type { WorkerLike } from '../../engine/client.js';

export interface RenderRequest {
  xml: string;
  widthPx: number;
  layout?: 'screen' | 'print';
  /** The piece's note count: a layout of `HEAVY_NOTES` or more retires the worker after it. */
  notes?: number;
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

/** The message of a layout that has no page: the score holds nothing Verovio can draw. */
export const NO_MUSIC = 'the score has no music to draw';

export class SupersededError extends Error {
  constructor() {
    super('render superseded by a newer request');
    this.name = 'SupersededError';
  }
}

/** Messages to the worker. */
export type RenderWorkerRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'render'; xml: string; widthPx: number; layout?: 'screen' | 'print' };

/**
 * Messages from the worker. `grown`: the worker's WASM heap is larger now than when it started.
 * `broken`: the WASM module aborted, so every later layout in it would fail too.
 */
export type RenderWorkerResponse =
  | { id: number; ok: true; pages: string[]; ms: number; grown?: boolean }
  | { id: number; ok: false; error: string; broken?: boolean };

interface Pending {
  resolve(r: RenderResult): void;
  reject(e: Error): void;
}

function defaultWorker(): WorkerLike {
  return new Worker(new URL('./verovio.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * `spawn` makes the worker: one at once, and another after one is retired or has failed. `onFail`
 * is told once each time a worker fails; the next request runs in a fresh worker.
 */
export function createRenderer(
  spawn: () => WorkerLike = defaultWorker,
  onFail?: (e: Error) => void,
): ScoreRenderer {
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let warmed = false;
  let disposed = false;
  // The worker running now; undefined once retired, until the next render or warm-up.
  let worker: WorkerLike | undefined;
  // The worker has laid out a long piece, or its heap has grown: retire it once nothing is pending.
  let retire = false;

  const rejectAll = (e: Error) => {
    for (const p of pending.values()) p.reject(e);
    pending.clear();
  };

  function start(): WorkerLike {
    const w = spawn();
    w.onmessage = (e: MessageEvent) => {
      const res = e.data as RenderWorkerResponse;
      // A superseded layout still tells whether the heap grew; an aborted module cannot lay out
      // again, so its worker is retired as well.
      if (res.ok ? res.grown : res.broken) retire = true;
      const p = pending.get(res.id);
      if (p) {
        pending.delete(res.id);
        if (!res.ok) p.reject(new Error(res.error));
        else if (res.pages.length) p.resolve({ pages: res.pages, ms: res.ms });
        else p.reject(new Error(NO_MUSIC));
      }
      if (retire && pending.size === 0 && w === worker && !disposed) {
        w.terminate();
        worker = undefined;
        retire = false;
        warmed = false;
      }
    };
    // A worker already retired or replaced is gone: whatever it reports is not this renderer's.
    w.onerror = (e: ErrorEvent) => {
      if (disposed || w !== worker) return;
      // A failed module load reports a plain Event, without a message.
      const message = typeof e.message === 'string' && e.message ? `: ${e.message}` : '';
      const failure = new Error(`the score renderer failed${message}`);
      w.terminate();
      worker = undefined;
      retire = false;
      warmed = false;
      rejectAll(failure);
      onFail?.(failure);
    };
    return w;
  }

  worker = start();
  const post = (m: RenderWorkerRequest) => (worker ??= start()).postMessage(m);

  return {
    render({ xml, widthPx, notes = 0, layout = 'screen' }) {
      if (disposed) return Promise.reject(new Error('renderer disposed'));
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
        post({ id, type: 'render', xml: prepareScanBeams(normalizeVoices(xml)), widthPx, layout });
        if (notes >= HEAVY_NOTES) retire = true;
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
      worker?.terminate();
      worker = undefined;
      rejectAll(new Error('renderer disposed'));
    },
  };
}
