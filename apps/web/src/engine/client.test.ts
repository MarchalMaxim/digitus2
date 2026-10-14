import { describe, expect, it } from 'vitest';
import { createEngineClient, type WorkerLike } from './client.js';
import type { EngineRequest, EngineResponse } from './protocol.js';

/** A worker that answers from a table, asynchronously, possibly out of order. */
function fakeWorker(
  answer: (req: EngineRequest) => EngineResponse,
  delays: number[] = [],
): WorkerLike & { terminated: boolean } {
  const w: WorkerLike & { terminated: boolean } = {
    onmessage: null,
    terminated: false,
    postMessage(m: unknown) {
      const req = m as EngineRequest;
      const delay = delays.shift() ?? 0;
      setTimeout(() => w.onmessage?.({ data: answer(req) } as MessageEvent), delay);
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

describe('engine client', () => {
  it('resolves responses by id even when they arrive out of order', async () => {
    const w = fakeWorker(
      (req) => ({ id: req.id, ok: true, type: 'fingeredXml', xml: `xml-${req.id}` }),
      [30, 0],
    );
    const c = createEngineClient(w);
    const score = { notes: [] } as never;
    const [a, b] = await Promise.all([
      c.fingeredXml('a', score, {}),
      c.fingeredXml('b', score, {}),
    ]);
    expect(a).toBe('xml-1');
    expect(b).toBe('xml-2');
  });
  it('rejects with the worker error message', async () => {
    const c = createEngineClient(fakeWorker((req) => ({ id: req.id, ok: false, error: 'boom' })));
    await expect(c.load('x', 'x.xml')).rejects.toThrow('boom');
  });
  it('terminates the worker on dispose and rejects pending calls', async () => {
    const w = fakeWorker((req) => ({ id: req.id, ok: false, error: 'late' }), [1000]);
    const c = createEngineClient(w);
    const p = c.load('x', 'x.xml');
    c.dispose();
    expect(w.terminated).toBe(true);
    await expect(p).rejects.toThrow(/disposed/);
  });
  it('rejects pending and later calls when the worker itself fails', async () => {
    const w = fakeWorker((req) => ({ id: req.id, ok: false, error: 'late' }), [1000]);
    const failures: Error[] = [];
    const c = createEngineClient(w, (e) => failures.push(e));
    const p = c.load('x', 'x.xml');
    w.onerror?.({ message: 'chunk failed to load' } as ErrorEvent);
    await expect(p).rejects.toThrow('chunk failed to load');
    expect(w.terminated).toBe(true);
    await expect(c.solve({ notes: [] } as never, 'medium')).rejects.toThrow(/engine worker failed/);
    // The owner hears about it once, and can make a fresh client for the next piece.
    w.onerror?.({ message: 'again' } as ErrorEvent);
    expect(failures.map((e) => e.message)).toEqual([
      'the engine worker failed: chunk failed to load',
    ]);
  });
  it('rejects a response whose type does not match the request', async () => {
    const c = createEngineClient(
      fakeWorker((req) => ({ id: req.id, ok: true, type: 'fingeredXml', xml: 'x' })),
    );
    await expect(c.solve({ notes: [] } as never, 'medium')).rejects.toThrow(/"fingeredXml"/);
  });
  it('sends the hand size, and pins only when given', async () => {
    const sent: EngineRequest[] = [];
    const c = createEngineClient(
      fakeWorker((req) => {
        sent.push(req);
        return { id: req.id, ok: true, type: 'solve', assignment: {}, ms: 1 };
      }),
    );
    const score = { notes: [] } as never;
    const pins = { n1: { finger: 2 as const, pinned: true, source: 'user' as const } };
    await expect(c.solve(score, 'small')).resolves.toEqual({ assignment: {}, ms: 1 });
    await c.solve(score, 'child', pins);
    expect(sent[0]).toEqual({ id: 1, type: 'solve', score, profile: 'small' });
    expect('pins' in sent[0]!).toBe(false);
    expect(sent[1]).toEqual({ id: 2, type: 'solve', score, profile: 'child', pins });
  });
});
