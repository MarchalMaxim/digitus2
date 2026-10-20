import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import type { Assignment, Score } from '@digitus2/engine';
import { SupersededError, type ScoreRenderer } from './render/renderer.js';
import { fakeRenderer, inlineEngine } from './testing/services.js';
import { bucket, diffDigits, rekeyByIndex, useScoreDocument } from './useScoreDocument.js';

// Under happy-dom, Vite's asset plugin rewrites a literal `new URL('…', import.meta.url)` into
// an http URL; a path held in a variable is left alone and stays a file URL.
const FIXTURE = '../../fixtures/short-piano.musicxml';
const bytes = new Uint8Array(readFileSync(new URL(FIXTURE, import.meta.url)));

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
    // The renderer retires its worker after a long piece's layout (renderer.ts).
    expect(renderer.render).toHaveBeenCalledWith(expect.objectContaining({ notes: 67 }));
  });
  it('re-solves without re-rendering when the hand size changes', async () => {
    const engine = inlineEngine();
    const renderer = fakeRenderer();
    const { result } = renderHook(() =>
      useScoreDocument({ kind: 'file', name: 'x.musicxml', bytes }, 800, { engine, renderer }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    // A dropped file is tried for "Add notes between"; this one gets no offer, and no layout.
    await waitFor(() => expect(result.current.embellish).toBe('none'));
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
    await waitFor(() => expect(result.current.embellish).toBe('none'));
    rerender({ w: 810 }); // same bucket
    rerender({ w: 500 }); // new bucket
    // The fake renderer counts a call before its result reaches the state, so wait for both:
    // checking the pages right after the count raced React's commit (about 1 run in 7).
    await waitFor(() => {
      expect(renderer.renders).toBe(2);
      expect(result.current.pages[0]).toContain('data-w="500"');
    });
    expect(renderer.renders).toBe(2);
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
    await waitFor(() => expect(result.current.embellish).toBe('none'));
    const writes = () => engine.calls.filter((c) => c === 'fingeredXml').length;
    expect(writes()).toBe(1);
    const firstXml = renderer.xmls[0];
    rerender({ w: 500 });
    await waitFor(() => expect(result.current.pages[0]).toContain('data-w="500"'));
    expect(renderer.renders).toBe(2);
    expect(writes()).toBe(1);
    expect(renderer.xmls[1]).toBe(firstXml);
    const pages500 = result.current.pages;
    // A different fingering is written once. Switching back at the same width takes the pages
    // laid out before, and a new width lays the first text out again.
    act(() => useAppStore.getState().setSettings({ showEditorial: true }));
    await waitFor(() => expect(renderer.renders).toBe(3));
    await waitFor(() => expect(result.current.assignment).toBe(result.current.editorial));
    act(() => useAppStore.getState().setSettings({ showEditorial: false }));
    expect(result.current.pages).toBe(pages500);
    expect(renderer.renders).toBe(3);
    rerender({ w: 1200 });
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

describe('which source is open', () => {
  it('opens again when other bytes arrive under the same file name', async () => {
    const engine = inlineEngine();
    const text = new TextDecoder().decode(bytes);
    const other = new TextEncoder().encode(
      text.replace('Digitus Spike Etude', 'Another Spike Etude'),
    );
    expect(other).not.toEqual(bytes);
    const { result, rerender } = renderHook(
      ({ b }) =>
        useScoreDocument({ kind: 'file', name: 'x.musicxml', bytes: b }, 800, {
          engine,
          renderer: fakeRenderer(),
        }),
      { initialProps: { b: bytes } },
    );
    await waitFor(() => expect(result.current.title).toBe('Digitus Spike Etude (short)'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ b: other });
    await waitFor(() => expect(result.current.title).toBe('Another Spike Etude (short)'));
    expect(engine.calls.filter((c) => c === 'load')).toHaveLength(2);
  });
  it('treats a plain file as an ordinary import, not a scan import', async () => {
    const loads: unknown[] = [];
    const engine = inlineEngine();
    const load = engine.load;
    engine.load = (input, source, opts) => {
      loads.push(opts);
      return load(input, source, opts);
    };
    const { result } = renderHook(() =>
      useScoreDocument({ kind: 'file', name: 'x.musicxml', bytes }, 800, {
        engine,
        renderer: fakeRenderer(),
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(loads).toEqual([undefined]);
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
  it('pairs notes up to the shorter score when the two differ in length', () => {
    const three = scoreOf([
      ['a0', 60],
      ['a1', 62],
      ['a2', 64],
    ]);
    const two = scoreOf([
      ['n0', 60],
      ['n1', 62],
    ]);
    const all: Assignment = { a0: fing(1), a1: fing(2), a2: fing(3), n0: fing(1), n1: fing(2) };
    expect(rekeyByIndex(three, all, two)).toEqual({ n0: fing(1), n1: fing(2) });
    expect(rekeyByIndex(two, all, three)).toEqual({ a0: fing(1), a1: fing(2) });
  });
});
