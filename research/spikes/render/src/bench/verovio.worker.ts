// THROWAWAY spike: Verovio inside a Web Worker (layout + SVG generation off the main thread).
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

let tk: VerovioToolkit | undefined;
self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: 'init' } | { type: 'render'; xml: string; options: Record<string, unknown> };
  if (msg.type === 'init') {
    tk = new VerovioToolkit(await createVerovioModule());
    (self as unknown as Worker).postMessage({ svg: [], ms: {} });
    return;
  }
  const t0 = performance.now();
  tk!.setOptions(msg.options);
  tk!.loadData(msg.xml);
  const t1 = performance.now();
  const svg: string[] = [];
  for (let p = 1, n = tk!.getPageCount(); p <= n; p++) svg.push(tk!.renderToSVG(p));
  const t2 = performance.now();
  (self as unknown as Worker).postMessage({ svg, ms: { load: t1 - t0, svg: t2 - t1 } });
};
