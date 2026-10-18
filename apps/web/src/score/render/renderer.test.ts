import { describe, expect, it } from 'vitest';
import { createRenderer, SupersededError } from './renderer.js';
// renderer.ts re-exports the engine client's WorkerLike, so one fake worker type serves both.
import type { WorkerLike } from './renderer.js';

function fakeWorker(delays: number[]): WorkerLike & { terminated: boolean } {
  const w: WorkerLike & { terminated: boolean } = {
    terminated: false,
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
    terminate() {
      w.terminated = true;
    },
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
  it('rejects pending and later renders when the worker fails, and tells its owner once', async () => {
    const w = fakeWorker([1000]);
    const failures: Error[] = [];
    const r = createRenderer(w, (e) => failures.push(e));
    const pending = r.render({ xml: '<x/>', widthPx: 800 });
    // A module worker whose script did not load reports a plain Event, without a message.
    w.onerror?.(new Event('error') as ErrorEvent);
    await expect(pending).rejects.toThrow('the score renderer failed');
    await expect(pending).rejects.not.toBeInstanceOf(SupersededError);
    expect(w.terminated).toBe(true);
    await expect(r.render({ xml: '<x/>', widthPx: 800 })).rejects.toThrow(/renderer failed/);
    w.onerror?.({ message: 'again' } as ErrorEvent);
    expect(failures.map((e) => e.message)).toEqual(['the score renderer failed']);
  });
  it('names the worker error when there is one', async () => {
    const w = fakeWorker([1000]);
    const r = createRenderer(w);
    const pending = r.render({ xml: '<x/>', widthPx: 800 });
    w.onerror?.({ message: 'out of memory' } as ErrorEvent);
    await expect(pending).rejects.toThrow('the score renderer failed: out of memory');
  });
  it('does not ask for a warm-up once a render has already woken the worker', () => {
    const w = fakeWorker([1000]);
    const types: string[] = [];
    const post = w.postMessage;
    w.postMessage = (m: unknown) => {
      types.push((m as { type: string }).type);
      post(m);
    };
    const r = createRenderer(w);
    void r.render({ xml: '<x/>', widthPx: 800 }).catch(() => undefined);
    r.warmUp();
    expect(types).toEqual(['render']);
    r.dispose();
  });
});
