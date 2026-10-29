import { describe, expect, it } from 'vitest';
import { HEAVY_NOTES } from '../../engine/client.js';
import { createRenderer, NO_MUSIC, SupersededError } from './renderer.js';
// renderer.ts re-exports the engine client's WorkerLike, so one fake worker type serves both.
import type { WorkerLike } from './renderer.js';

/**
 * A Verovio worker that answers each render after `delays` (ms); `grown` says, per answer, whether
 * its WASM heap has grown by then (default no). `posted` keeps the request types it was sent.
 * `answer`, when given, replaces the answer to a render.
 */
function fakeWorker(
  delays: number[],
  grown: boolean[] = [],
  answer?: (id: number) => unknown,
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
            data: answer?.(req.id) ?? {
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
  it('rejects the pending render when the worker fails, tells its owner once, and lays out the next one in a fresh worker', async () => {
    const spawned: ReturnType<typeof fakeWorker>[] = [];
    const failures: Error[] = [];
    const r = createRenderer(
      () => {
        const w = fakeWorker([spawned.length ? 0 : 1000]);
        spawned.push(w);
        return w;
      },
      (e) => failures.push(e),
    );
    const pending = r.render({ xml: '<x/>', widthPx: 800 });
    // A module worker whose script did not load reports a plain Event, without a message.
    spawned[0]!.onerror?.(new Event('error') as ErrorEvent);
    await expect(pending).rejects.toThrow('the score renderer failed');
    await expect(pending).rejects.not.toBeInstanceOf(SupersededError);
    expect(spawned[0]!.terminated).toBe(true);
    spawned[0]!.onerror?.({ message: 'again' } as ErrorEvent);
    expect(failures.map((e) => e.message)).toEqual(['the score renderer failed']);
    expect((await r.render({ xml: '<x/>', widthPx: 640 })).pages).toEqual(['<svg data-w="640"/>']);
    expect(spawned).toHaveLength(2);
    expect(spawned[1]!.terminated).toBe(false);
  });
  it('ignores a late failure of the dead worker while the fresh one lays out', async () => {
    const spawned: ReturnType<typeof fakeWorker>[] = [];
    const r = createRenderer(() => {
      const w = fakeWorker([spawned.length ? 30 : 1000]);
      spawned.push(w);
      return w;
    });
    const first = r.render({ xml: '<x/>', widthPx: 800 });
    spawned[0]!.onerror?.({ message: 'crashed' } as ErrorEvent);
    await expect(first).rejects.toThrow('the score renderer failed: crashed');
    const next = r.render({ xml: '<x/>', widthPx: 640 });
    spawned[0]!.onerror?.({ message: 'late' } as ErrorEvent);
    expect((await next).pages).toEqual(['<svg data-w="640"/>']);
    expect(spawned[1]!.terminated).toBe(false);
  });
  it('lets the library warm a fresh worker up after a failure', () => {
    const spawned: ReturnType<typeof fakeWorker>[] = [];
    const r = createRenderer(() => {
      const w = fakeWorker([1000]);
      spawned.push(w);
      return w;
    });
    void r.render({ xml: '<x/>', widthPx: 800 }).catch(() => undefined);
    spawned[0]!.onerror?.({ message: 'crashed' } as ErrorEvent);
    r.warmUp();
    expect(spawned).toHaveLength(2);
    expect(spawned[1]!.posted).toEqual(['init']);
    r.dispose();
  });
  it('rejects a layout without a page, so the review never waits on it', async () => {
    const r = createRenderer(() =>
      fakeWorker([0], [], (id) => ({ id, ok: true, pages: [], ms: 1 })),
    );
    await expect(r.render({ xml: '<x/>', widthPx: 800 })).rejects.toThrow(NO_MUSIC);
    expect(NO_MUSIC).toBe('the score has no music to draw');
  });
  it('rejects every render after dispose', async () => {
    const r = createRenderer(() => fakeWorker([0]));
    r.dispose();
    await expect(r.render({ xml: '<x/>', widthPx: 800 })).rejects.toThrow('renderer disposed');
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

describe('renderer: a worker whose heap grew, or that laid out a long piece', () => {
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

  it('is retired after the layout of a long piece too, whose heap did not grow', async () => {
    const { spawn, spawned } = spawner(() => fakeWorker([0, 0]));
    const r = createRenderer(spawn);
    await r.render({ xml: '<x/>', widthPx: 800, notes: HEAVY_NOTES });
    expect(spawned[0]!.terminated).toBe(true);
    expect((await r.render({ xml: '<x/>', widthPx: 640 })).pages).toEqual(['<svg data-w="640"/>']);
    expect(spawned).toHaveLength(2);
  });

  it('is kept after the layout of a shorter piece', async () => {
    const { spawn, spawned } = spawner(() => fakeWorker([0]));
    const r = createRenderer(spawn);
    await r.render({ xml: '<x/>', widthPx: 800, notes: HEAVY_NOTES - 1 });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.terminated).toBe(false);
  });

  it('is retired when its WASM module aborted, and the next layout runs in a fresh one', async () => {
    const broken = [true, false];
    const { spawn, spawned } = spawner(() =>
      fakeWorker([0], [], (id) =>
        broken.shift() ? { id, ok: false, error: 'Aborted(OOM)', broken: true } : undefined,
      ),
    );
    const r = createRenderer(spawn);
    await expect(r.render({ xml: '<x/>', widthPx: 800 })).rejects.toThrow('Aborted(OOM)');
    expect(spawned[0]!.terminated).toBe(true);
    expect((await r.render({ xml: '<x/>', widthPx: 640 })).pages).toEqual(['<svg data-w="640"/>']);
    expect(spawned).toHaveLength(2);
  });

  it('is kept when a layout failed without breaking its module', async () => {
    const failed = [true, false];
    const { spawn, spawned } = spawner(() =>
      fakeWorker([0, 0], [], (id) =>
        failed.shift() ? { id, ok: false, error: 'the score could not be laid out' } : undefined,
      ),
    );
    const r = createRenderer(spawn);
    await expect(r.render({ xml: '<x/>', widthPx: 800 })).rejects.toThrow(/could not be laid out/);
    await r.render({ xml: '<x/>', widthPx: 640 });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.terminated).toBe(false);
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
