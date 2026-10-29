import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineClient, HEAVY_NOTES, type WorkerLike } from './client.js';
import { handle } from './handlers.js';
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
    const c = createEngineClient(() => w);
    const score = { notes: [] } as never;
    const [a, b] = await Promise.all([
      c.fingeredXml('a', score, {}),
      c.fingeredXml('b', score, {}),
    ]);
    expect(a).toBe('xml-1');
    expect(b).toBe('xml-2');
  });
  it('passes the options of a scan load to the worker and its tie repairs back', async () => {
    const requests: EngineRequest[] = [];
    const c = createEngineClient(() =>
      fakeWorker((req) => {
        requests.push(req);
        return handle(req);
      }),
    );
    const input =
      '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name/></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/></note></measure></part></score-partwise>';
    const loaded = await c.load(input, 'scan.musicxml', {
      preserveNotation: true,
      tolerateScanTies: true,
    });
    expect(requests[0]).toMatchObject({ preserveNotation: true, tolerateScanTies: true });
    expect(loaded.score.notes).toHaveLength(1);
    expect(loaded.tieRepairs).toEqual([{ note: 0, part: 0, measure: 0, reason: 'unmatchedStop' }]);
    c.dispose();
  });
  it('rejects with the worker error message', async () => {
    const c = createEngineClient(() =>
      fakeWorker((req) => ({ id: req.id, ok: false, error: 'boom' })),
    );
    await expect(c.load('x', 'x.xml')).rejects.toThrow('boom');
  });
  it('terminates the worker on dispose and rejects pending calls', async () => {
    const w = fakeWorker((req) => ({ id: req.id, ok: false, error: 'late' }), [1000]);
    const c = createEngineClient(() => w);
    const p = c.load('x', 'x.xml');
    c.dispose();
    expect(w.terminated).toBe(true);
    await expect(p).rejects.toThrow(/disposed/);
  });
  it('rejects pending and later calls when the worker itself fails', async () => {
    const w = fakeWorker((req) => ({ id: req.id, ok: false, error: 'late' }), [1000]);
    const failures: Error[] = [];
    const c = createEngineClient(
      () => w,
      (e) => failures.push(e),
    );
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
    const c = createEngineClient(() =>
      fakeWorker((req) => ({ id: req.id, ok: true, type: 'fingeredXml', xml: 'x' })),
    );
    await expect(c.solve({ notes: [] } as never, 'medium')).rejects.toThrow(/"fingeredXml"/);
  });
  it('sends the hand size, and pins only when given', async () => {
    const sent: EngineRequest[] = [];
    const c = createEngineClient(() =>
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
  it('sends the source kind and the hand split with a load', async () => {
    const sent: EngineRequest[] = [];
    const c = createEngineClient(() =>
      fakeWorker((req) => {
        sent.push(req);
        return { id: req.id, ok: false, error: 'stop' };
      }),
    );
    await expect(c.load(new Uint8Array([1]), 'tune.mid', { splitMidi: 60 })).rejects.toThrow(
      'stop',
    );
    await expect(c.load('<x/>', 'a.musicxml')).rejects.toThrow('stop');
    expect(sent.map((r) => (r.type === 'load' ? [r.kind, r.splitMidi] : null))).toEqual([
      ['midi', 60],
      ['musicxml', undefined],
    ]);
  });
  it('posts an embellish request and resolves the offer, the reason and the time', async () => {
    const sent: EngineRequest[] = [];
    const offered = {
      xml: '<e/>',
      score: { notes: [] } as never,
      editorial: {},
      assignments: { large: {}, medium: {}, small: {}, child: {} },
      figures: 3,
    };
    const c = createEngineClient(() =>
      fakeWorker((req) => {
        sent.push(req);
        return { id: req.id, ok: true, type: 'embellish', offered, reason: null, ms: 7 };
      }),
    );
    await expect(c.embellish('<x/>')).resolves.toEqual({ offered, reason: null, ms: 7 });
    expect(sent).toEqual([{ id: 1, type: 'embellish', xml: '<x/>' }]);
  });
});

describe('engine client: releasing the worker after work on a long piece', () => {
  const IDLE = 100;
  const long = { notes: Array.from({ length: HEAVY_NOTES }, () => ({})) } as never;
  const short = { notes: Array.from({ length: HEAVY_NOTES - 1 }, () => ({})) } as never;

  /** Spawns fake workers that answer every solve after `delays` (ms), and keeps them in order. */
  function spawner(delays: number[] = []) {
    const spawned: ReturnType<typeof fakeWorker>[] = [];
    const spawn = () => {
      const w = fakeWorker(
        (req) => ({ id: req.id, ok: true, type: 'solve', assignment: {}, ms: 1 }),
        delays,
      );
      spawned.push(w);
      return w;
    };
    return { spawn, spawned };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('releases the worker once it has idled after a long piece, and answers from a fresh one', async () => {
    const { spawn, spawned } = spawner();
    const c = createEngineClient(spawn, undefined, IDLE);
    expect(spawned).toHaveLength(1); // spawned at once, so the library's warm-up loads it
    const solved = c.solve(long, 'medium');
    await vi.advanceTimersByTimeAsync(0);
    await expect(solved).resolves.toEqual({ assignment: {}, ms: 1 });
    await vi.advanceTimersByTimeAsync(IDLE - 1);
    expect(spawned[0]!.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(spawned[0]!.terminated).toBe(true);
    const again = c.solve(short, 'small');
    await vi.advanceTimersByTimeAsync(0);
    await expect(again).resolves.toEqual({ assignment: {}, ms: 1 });
    expect(spawned).toHaveLength(2);
  });

  it('counts a long piece by the score it loads', async () => {
    const spawned: ReturnType<typeof fakeWorker>[] = [];
    const c = createEngineClient(
      () => {
        const w = fakeWorker((req) => ({
          id: req.id,
          ok: true,
          type: 'load',
          score: long,
          editorial: {},
          warnings: [],
          tieRepairs: [],
          xml: '<x/>',
          midiInfo: null,
        }));
        spawned.push(w);
        return w;
      },
      undefined,
      IDLE,
    );
    const loaded = c.load('<x/>', 'long.musicxml');
    await vi.advanceTimersByTimeAsync(0);
    await loaded;
    await vi.advanceTimersByTimeAsync(IDLE);
    expect(spawned[0]!.terminated).toBe(true);
  });

  it('keeps the worker after work on shorter pieces, and while it is only warmed up', async () => {
    const { spawn, spawned } = spawner();
    const c = createEngineClient(spawn, undefined, IDLE);
    await vi.advanceTimersByTimeAsync(10 * IDLE);
    const solved = c.solve(short, 'medium');
    await vi.advanceTimersByTimeAsync(0);
    await solved;
    await vi.advanceTimersByTimeAsync(10 * IDLE);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.terminated).toBe(false);
  });

  it('never releases a worker with a call pending, and counts the idle time from the last answer', async () => {
    const { spawn, spawned } = spawner([0, 5 * IDLE]);
    const c = createEngineClient(spawn, undefined, IDLE);
    const first = c.solve(long, 'medium');
    const second = c.solve(long, 'small');
    await vi.advanceTimersByTimeAsync(0);
    await first;
    await vi.advanceTimersByTimeAsync(2 * IDLE);
    expect(spawned[0]!.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(3 * IDLE);
    await second;
    await vi.advanceTimersByTimeAsync(IDLE - 1);
    expect(spawned[0]!.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(spawned[0]!.terminated).toBe(true);
  });

  it('keeps the worker when a call comes within the idle time', async () => {
    const { spawn, spawned } = spawner();
    const c = createEngineClient(spawn, undefined, IDLE);
    const first = c.solve(long, 'medium');
    await vi.advanceTimersByTimeAsync(0);
    await first;
    await vi.advanceTimersByTimeAsync(IDLE / 2);
    const second = c.solve(short, 'small');
    await vi.advanceTimersByTimeAsync(0);
    await second;
    await vi.advanceTimersByTimeAsync(IDLE / 2);
    expect(spawned[0]!.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(IDLE / 2);
    expect(spawned[0]!.terminated).toBe(true);
    expect(spawned).toHaveLength(1);
  });

  it('stays closed after dispose, released or not', async () => {
    const { spawn, spawned } = spawner();
    const c = createEngineClient(spawn, undefined, IDLE);
    const solved = c.solve(long, 'medium');
    await vi.advanceTimersByTimeAsync(0);
    await solved;
    await vi.advanceTimersByTimeAsync(IDLE);
    c.dispose();
    await expect(c.solve(short, 'medium')).rejects.toThrow(/disposed/);
    expect(spawned).toHaveLength(1);
  });

  it('ignores a failure reported by a worker it has released', async () => {
    const { spawn, spawned } = spawner();
    const failures: Error[] = [];
    const c = createEngineClient(spawn, (e) => failures.push(e), IDLE);
    const solved = c.solve(long, 'medium');
    await vi.advanceTimersByTimeAsync(0);
    await solved;
    await vi.advanceTimersByTimeAsync(IDLE);
    spawned[0]!.onerror?.({ message: 'late' } as ErrorEvent);
    expect(failures).toEqual([]);
    const again = c.solve(short, 'medium');
    await vi.advanceTimersByTimeAsync(0);
    await expect(again).resolves.toEqual({ assignment: {}, ms: 1 });
  });
});
