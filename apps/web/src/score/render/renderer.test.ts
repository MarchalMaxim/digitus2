import { describe, expect, it } from 'vitest';
import { createRenderer, SupersededError } from './renderer.js';
// WorkerLike is defined by the engine client (Task 4), which does not exist yet; renderer.ts
// declares the same structural interface itself.
import type { WorkerLike } from './renderer.js';

function fakeWorker(delays: number[]): WorkerLike {
  const w: WorkerLike = {
    onmessage: null,
    postMessage(m: unknown) {
      const req = m as { id: number; type: string; widthPx?: number };
      if (req.type === 'init') return;
      const delay = delays.shift() ?? 0;
      setTimeout(
        () =>
          w.onmessage?.({
            data: { id: req.id, ok: true, pages: [`<svg data-w="${req.widthPx}"/>`], ms: 1 },
          } as MessageEvent),
        delay,
      );
    },
    terminate() {},
  };
  return w;
}

describe('renderer', () => {
  it('returns pages for a request', async () => {
    const r = createRenderer(fakeWorker([0]));
    const res = await r.render({ xml: '<x/>', widthPx: 800 });
    expect(res.pages).toEqual(['<svg data-w="800"/>']);
  });
  it('drops results of superseded render requests', async () => {
    const r = createRenderer(fakeWorker([50, 0]));
    const first = r.render({ xml: '<x/>', widthPx: 800 });
    const second = r.render({ xml: '<x/>', widthPx: 600 });
    await expect(first).rejects.toBeInstanceOf(SupersededError);
    expect((await second).pages).toEqual(['<svg data-w="600"/>']);
  });
});
