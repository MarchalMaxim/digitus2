// The Verovio worker: compiles the WASM once per session (2.3 MB gzip, a lazy chunk of this
// worker only) and lays out MusicXML to SVG pages off the main thread (spike section 8.1).
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { verovioOptions } from './options.js';
import type { RenderWorkerRequest, RenderWorkerResponse } from './renderer.js';

interface WorkerScope {
  onmessage: ((e: MessageEvent<RenderWorkerRequest>) => void) | null;
  postMessage(message: RenderWorkerResponse): void;
}
const scope = self as unknown as WorkerScope;

// One cached promise, so concurrent first messages compile the WASM only once. A failed
// compile is forgotten, so the next request tries again.
let toolkit: Promise<VerovioToolkit> | undefined;
// Whether the WASM heap is larger than when the module started; the renderer retires a worker
// whose heap grew (renderer.ts).
let heapGrown = () => false;
function getToolkit(): Promise<VerovioToolkit> {
  toolkit ??= createVerovioModule().then(
    (module) => {
      const initial = module.HEAPU8.length;
      heapGrown = () => module.HEAPU8.length > initial;
      return new VerovioToolkit(module);
    },
    (e: unknown) => {
      toolkit = undefined;
      throw e;
    },
  );
  return toolkit;
}

// The newest render request received. Requests that queued up behind the WASM compile or a
// running layout and were superseded meanwhile are skipped; the renderer has already dropped
// their ids.
let latestRender = 0;

async function handle(req: RenderWorkerRequest): Promise<RenderWorkerResponse> {
  try {
    const tk = await getToolkit();
    if (req.type === 'init') return { id: req.id, ok: true, pages: [], ms: 0 };
    // Yield one task so render messages queued behind a running layout can raise latestRender
    // before this one starts; during a resize burst only the newest width is laid out.
    await new Promise((r) => setTimeout(r, 0));
    if (req.id < latestRender) return { id: req.id, ok: false, error: 'superseded' };
    const t0 = performance.now();
    tk.setOptions(verovioOptions(req.widthPx, req.layout));
    if (!tk.loadData(req.xml)) throw new Error('the score could not be laid out');
    const pages = Array.from({ length: tk.getPageCount() }, (_, i) => tk.renderToSVG(i + 1));
    return { id: req.id, ok: true, pages, ms: performance.now() - t0, grown: heapGrown() };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // A trap or an abort leaves the WASM module unusable: the renderer retires this worker, so
    // the next layout starts a fresh one instead of failing the same way.
    return { id: req.id, ok: false, error, broken: e instanceof WebAssembly.RuntimeError };
  }
}

scope.onmessage = (e) => {
  const req = e.data;
  if (req.type === 'render') latestRender = Math.max(latestRender, req.id);
  void handle(req).then((res) => scope.postMessage(res));
};
