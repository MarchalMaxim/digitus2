import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { handle } from '../engine/handlers.js';
import type { Assignment, Score } from '@digitus2/engine';
import type { EngineClient } from '../engine/client.js';
import { SupersededError, type ScoreRenderer } from './render/renderer.js';
import { bucket, diffDigits, rekeyByIndex, useScoreDocument } from './useScoreDocument.js';

// Under happy-dom, Vite's asset plugin rewrites a literal `new URL('…', import.meta.url)` into
// an http URL; a path held in a variable is left alone and stays a file URL.
const FIXTURE = '../../fixtures/short-piano.musicxml';
const bytes = new Uint8Array(readFileSync(new URL(FIXTURE, import.meta.url)));

/** An engine client that runs the real handlers synchronously inside promises. */
function inlineEngine(): EngineClient & { calls: string[] } {
  let id = 0;
  const calls: string[] = [];
  const run = (req: Parameters<typeof handle>[0]) => {
    calls.push(req.type);
    const r = handle(req);
    return r.ok ? Promise.resolve(r) : Promise.reject(new Error(r.error));
  };
  return {
    calls,
    load: (input, source) => run({ id: ++id, type: 'load', input, source }).then((r) => r as never),
    solve: (score, profile, pins) =>
      run({ id: ++id, type: 'solve', score, profile, ...(pins ? { pins } : {}) }).then(
        (r) => r as never,
      ),
    fingeredXml: (xml, score, assignment) =>
      run({ id: ++id, type: 'fingeredXml', xml, score, assignment }).then(
        (r) => (r as { xml: string }).xml,
      ),
    dispose: () => {},
  };
}
function fakeRenderer(): ScoreRenderer & { renders: number; xmls: string[] } {
  const r = {
    renders: 0,
    xmls: [] as string[],
    render: vi.fn(async ({ xml, widthPx }: { xml: string; widthPx: number }) => {
      r.renders++;
      r.xmls.push(xml);
      return {
        pages: [
          `<svg data-w="${widthPx}" data-fings="${(xml.match(/<fingering/g) ?? []).length}"/>`,
        ],
        ms: 1,
      };
    }),
    warmUp: () => {},
    dispose: () => {},
  };
  return r;
}

beforeEach(() =>
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
  }),
);
// Vitest globals are off, so Testing Library cannot register its own cleanup: unmount every hook
// so an earlier test's document does not react to a later test's settings.
afterEach(cleanup);

describe('useScoreDocument', () => {
  it('walks loading -> fingering -> rendering -> ready for a dropped file', async () => {
    const engine = inlineEngine();
    const renderer = fakeRenderer();
    const seen: string[] = [];
    const { result } = renderHook(() => {
      const d = useScoreDocument({ kind: 'file', name: 'short-piano.musicxml', bytes }, 800, {
        engine,
        renderer,
      });
      seen.push(d.status);
      return d;
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(seen.filter((s, i) => seen[i - 1] !== s)).toEqual([
      'loading',
      'fingering',
      'rendering',
      'ready',
    ]);
    expect(result.current.score!.notes).toHaveLength(67);
    expect(Object.keys(result.current.assignment!)).toHaveLength(67);
    expect(result.current.pages[0]).toContain('data-fings="67"');
    expect(result.current.editorial && Object.keys(result.current.editorial)).toHaveLength(67);
    expect(result.current.title).toBe('Digitus Spike Etude (short)');
  });
  it('re-solves without re-rendering when the hand size changes', async () => {
    const engine = inlineEngine();
    const renderer = fakeRenderer();
    const { result } = renderHook(() =>
      useScoreDocument({ kind: 'file', name: 'x.musicxml', bytes }, 800, { engine, renderer }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const before = engine.calls.filter((c) => c === 'solve').length;
    act(() => useAppStore.getState().setSettings({ handSize: 'child' }));
    await waitFor(() => expect(engine.calls.filter((c) => c === 'solve').length).toBe(before + 1));
    expect(renderer.renders).toBe(1);
  });
  it('shows the editorial fingering when the setting is on and the file has one', async () => {
    const engine = inlineEngine();
    const renderer = fakeRenderer();
    useAppStore.getState().setSettings({ showEditorial: true });
    const { result } = renderHook(() =>
      useScoreDocument({ kind: 'file', name: 'x.musicxml', bytes }, 800, { engine, renderer }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.assignment).toEqual(result.current.editorial);
  });
  it('enters the error state with a message when the file is not a score', async () => {
    const engine = inlineEngine();
    const { result } = renderHook(() =>
      useScoreDocument(
        { kind: 'file', name: 'bad.xml', bytes: new TextEncoder().encode('nope') },
        800,
        { engine, renderer: fakeRenderer() },
      ),
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBeTruthy();
  });
  it('re-renders once when the width bucket changes', async () => {
    const engine = inlineEngine();
    const renderer = fakeRenderer();
    const { result, rerender } = renderHook(
      ({ w }) =>
        useScoreDocument({ kind: 'file', name: 'x.musicxml', bytes }, w, { engine, renderer }),
      { initialProps: { w: 800 } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ w: 810 }); // same bucket
    rerender({ w: 500 }); // new bucket
    await waitFor(() => expect(renderer.renders).toBe(2));
    expect(result.current.pages[0]).toContain('data-w="500"');
  });
  it('lays the same fingered text out again for a new width: no second write of the fingering', async () => {
    const engine = inlineEngine();
    const renderer = fakeRenderer();
    const { result, rerender } = renderHook(
      ({ w }) =>
        useScoreDocument({ kind: 'file', name: 'x.musicxml', bytes }, w, { engine, renderer }),
      { initialProps: { w: 800 } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const writes = () => engine.calls.filter((c) => c === 'fingeredXml').length;
    expect(writes()).toBe(1);
    const firstXml = renderer.xmls[0];
    rerender({ w: 500 });
    await waitFor(() => expect(renderer.renders).toBe(2));
    expect(writes()).toBe(1);
    expect(renderer.xmls[1]).toBe(firstXml);
    // A different fingering is written once, and switching back reuses the first text.
    act(() => useAppStore.getState().setSettings({ showEditorial: true }));
    await waitFor(() => expect(renderer.renders).toBe(3));
    act(() => useAppStore.getState().setSettings({ showEditorial: false }));
    await waitFor(() => expect(renderer.renders).toBe(4));
    expect(writes()).toBe(2);
    expect(renderer.xmls[3]).toBe(firstXml);
  });
  it('enters the error state, never a hung "rendering", when the renderer fails', async () => {
    const renderer: ScoreRenderer = {
      render: () => Promise.reject(new Error('the score renderer failed')),
      warmUp: () => {},
      dispose: () => {},
    };
    const { result } = renderHook(() =>
      useScoreDocument({ kind: 'file', name: 'x.musicxml', bytes }, 800, {
        engine: inlineEngine(),
        renderer,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('the score renderer failed');
  });
  it('gives up with an error when every attempt at the layout is superseded', async () => {
    const render = vi.fn(() => Promise.reject(new SupersededError()));
    const { result } = renderHook(() =>
      useScoreDocument({ kind: 'file', name: 'x.musicxml', bytes }, 800, {
        engine: inlineEngine(),
        renderer: { render, warmUp: () => {}, dispose: () => {} },
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(render).toHaveBeenCalledTimes(3);
    expect(result.current.error).toMatch(/could not be laid out/);
  });
});

describe('score document helpers', () => {
  const fing = (finger: 1 | 2 | 3 | 4 | 5, substitution?: 1 | 2 | 3 | 4 | 5) =>
    substitution === undefined
      ? { finger, source: 'engine' as const }
      : { finger, substitution, source: 'engine' as const };
  const scoreOf = (notes: [string, number][]) =>
    ({ notes: notes.map(([id, midi]) => ({ id, midi })) }) as unknown as Score;

  it('buckets widths by 160 px', () => {
    expect([bucket(800), bucket(810), bucket(500), bucket(328)]).toEqual([800, 800, 480, 320]);
  });
  it('lists the changed digits, and calls a gained digit or substitution structural', () => {
    const prev: Assignment = { n0: fing(1), n1: fing(2), n2: fing(3) };
    expect(diffDigits(prev, { n0: fing(1), n1: fing(4), n2: fing(3) })).toEqual({
      changes: new Map([['n1', '4']]),
      structural: false,
    });
    expect(diffDigits(prev, { n0: fing(1), n1: fing(2) }).structural).toBe(true);
    expect(diffDigits(prev, { ...prev, n2: fing(3, 1) }).structural).toBe(true);
  });
  it('moves an editorial fingering onto the stripped score by note index, skipping pitch clashes', () => {
    const fingered = scoreOf([
      ['a0', 60],
      ['a1', 62],
      ['a2', 64],
    ]);
    const stripped = scoreOf([
      ['n0', 60],
      ['n1', 61],
      ['n2', 64],
    ]);
    const editorial: Assignment = { a0: fing(1), a1: fing(2), a2: fing(3) };
    expect(rekeyByIndex(fingered, editorial, stripped)).toEqual({ n0: fing(1), n2: fing(3) });
    expect(rekeyByIndex(fingered, {}, stripped)).toBeNull();
  });
});
