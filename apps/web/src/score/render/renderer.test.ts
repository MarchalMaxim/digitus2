import { describe, expect, it } from 'vitest';
import { createRenderer, SupersededError } from './renderer.js';
// renderer.ts re-exports the engine client's WorkerLike, so one fake worker type serves both.
import type { WorkerLike } from './renderer.js';

/**
 * A Verovio worker that answers each render after `delays` (ms); `grown` says, per answer, whether
 * its WASM heap has grown by then (default no). `posted` keeps the request types it was sent.
 */
function fakeWorker(
  delays: number[],
  grown: boolean[] = [],
): WorkerLike & { terminated: boolean; posted: string[] } {
  const w: WorkerLike & { terminated: boolean; posted: string[] } = {
    terminated: false,
    posted: [],
    onmessage: null,
    postMessage(m: unknown) {
      const req = m as { id: number; type: string; widthPx?: number };
      w.posted.push(req.type);
      if (req.type === 'init') return;
      const delay = delays.shift() ?? 0;
      const heapGrown = grown.shift() ?? false;
      setTimeout(
        () =>
          w.onmessage?.({
            data: {
              id: req.id,
              ok: true,
              pages: [`<svg data-w="${req.widthPx}"/>`],
              ms: 1,
              grown: heapGrown,
            },
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
    const r = createRenderer(() => fakeWorker([0]));
    const res = await r.render({ xml: '<x/>', widthPx: 800 });
    expect(res.pages).toEqual(['<svg data-w="800"/>']);
  });
  it('drops results of superseded render requests', async () => {
    const r = createRenderer(() => fakeWorker([50, 0]));
    const first = r.render({ xml: '<x/>', widthPx: 800 });
    const second = r.render({ xml: '<x/>', widthPx: 600 });
    await expect(first).rejects.toBeInstanceOf(SupersededError);
    expect((await second).pages).toEqual(['<svg data-w="600"/>']);
  });
  it('rejects pending and later renders when the worker fails, and tells its owner once', async () => {
    const w = fakeWorker([1000]);
    const failures: Error[] = [];
    const r = createRenderer(
      () => w,
      (e) => failures.push(e),
    );
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
    const r = createRenderer(() => w);
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
    const r = createRenderer(() => w);
    void r.render({ xml: '<x/>', widthPx: 800 }).catch(() => undefined);
    r.warmUp();
    expect(types).toEqual(['render']);
    r.dispose();
  });
});

describe('renderer: a worker whose heap grew', () => {
  /** Spawns the fake workers `make` returns, in order, and keeps them. */
  function spawner(make: () => ReturnType<typeof fakeWorker>) {
    const spawned: ReturnType<typeof fakeWorker>[] = [];
    return {
      spawned,
      spawn: () => {
        const w = make();
        spawned.push(w);
        return w;
      },
    };
  }

  it('is retired once nothing is pending, and the next layout runs in a fresh one', async () => {
    const grows = [true, false]; // the first worker's heap grows, the next one's does not
    const { spawn, spawned } = spawner(() => fakeWorker([0], [grows.shift() ?? false]));
    const r = createRenderer(spawn);
    await r.render({ xml: '<x/>', widthPx: 800 });
    expect(spawned[0]!.terminated).toBe(true);
    const next = await r.render({ xml: '<x/>', widthPx: 640 });
    expect(next.pages).toEqual(['<svg data-w="640"/>']);
    expect(spawned).toHaveLength(2);
    expect(spawned[1]!.terminated).toBe(false);
  });

  it('is kept when its heap did not grow', async () => {
    const { spawn, spawned } = spawner(() => fakeWorker([0, 0]));
    const r = createRenderer(spawn);
    await r.render({ xml: '<x/>', widthPx: 800 });
    await r.render({ xml: '<x/>', widthPx: 640 });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.terminated).toBe(false);
  });

  it('lays out the newest request first, also when a superseded one reported the growth', async () => {
    // The first layout grows the heap and is superseded; the second is still running in the
    // same worker, which is retired only once it has answered.
    const { spawn, spawned } = spawner(() => fakeWorker([0, 30], [true, true]));
    const r = createRenderer(spawn);
    const first = r.render({ xml: '<x/>', widthPx: 800 });
    const second = r.render({ xml: '<x/>', widthPx: 640 });
    await expect(first).rejects.toBeInstanceOf(SupersededError);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(spawned[0]!.terminated).toBe(false);
    expect((await second).pages).toEqual(['<svg data-w="640"/>']);
    expect(spawned[0]!.terminated).toBe(true);
    expect(spawned).toHaveLength(1);
  });

  it('lets the library warm a fresh worker up after the retirement', async () => {
    const { spawn, spawned } = spawner(() => fakeWorker([0], [true]));
    const r = createRenderer(spawn);
    await r.render({ xml: '<x/>', widthPx: 800 });
    r.warmUp();
    expect(spawned).toHaveLength(2);
    expect(spawned[1]!.posted).toEqual(['init']);
  });

  it('ignores a failure reported by a worker it has retired', async () => {
    const { spawn, spawned } = spawner(() => fakeWorker([0], [true]));
    const failures: Error[] = [];
    const r = createRenderer(spawn, (e) => failures.push(e));
    await r.render({ xml: '<x/>', widthPx: 800 });
    spawned[0]!.onerror?.({ message: 'late' } as ErrorEvent);
    expect(failures).toEqual([]);
    expect((await r.render({ xml: '<x/>', widthPx: 640 })).pages).toEqual(['<svg data-w="640"/>']);
  });
});
