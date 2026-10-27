import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore, type PieceSource } from '../app/store.js';
import { loadPiece, loadPieceDetails, setPieceDetails } from '../library/manifest.js';
import { fakeRenderer, inlineEngine } from './testing/services.js';
import { useScoreDocument } from './useScoreDocument.js';

// The edition's digits in the score document (issue 94): what the worker is asked for, and what
// the document publishes with the fingering it shows.
const SCORES = '../../../../content/scores/';
const read = (path: string) => new Uint8Array(readFileSync(new URL(path, import.meta.url)));
const upload: PieceSource = {
  kind: 'file',
  name: 'twinkle.musicxml',
  bytes: read(`${SCORES}twinkle-twinkle-little-star.musicxml`),
};
// A file whose own <fingering>s are the editor's: the editor's fingering can be shown for it.
const fingered: PieceSource = {
  kind: 'file',
  name: 'short-piano.musicxml',
  bytes: read('../../fixtures/short-piano.musicxml'),
};
const library: PieceSource = { kind: 'library', slug: 'schumann-op68-no1-melody' };

async function fetchText(url: string): Promise<Uint8Array> {
  const name = decodeURIComponent(url.replace(/[?#].*$/, '').replace(/^.*\//, ''));
  return read(`${SCORES}${name}`);
}

beforeEach(() =>
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
  }),
);
afterEach(cleanup);

// The solver and the layout stand in for a busy machine too.
const LONG = { timeout: 60_000 };
vi.setConfig({ testTimeout: 120_000 });

describe('the edition in the score document', () => {
  it('passes the level and the editor count of a library piece, and nothing for an upload', async () => {
    const piece = (await loadPiece(library.slug))!;
    expect(piece.editorDigits).toBeGreaterThan(0);
    const engine = inlineEngine();
    const lib = renderHook(() =>
      useScoreDocument(library, 800, { engine, renderer: fakeRenderer(), fetchText }),
    );
    await waitFor(() => expect(lib.result.current.status).toBe('ready'), LONG);
    expect(engine.solves[0]).toEqual({ level: piece.level, editorDigits: piece.editorDigits });
    const printed = lib.result.current.printed!;
    expect(printed.size).toBeGreaterThan(0);
    expect(printed.size).toBeLessThanOrEqual(piece.editorDigits!);

    const dropped = inlineEngine();
    const file = renderHook(() =>
      useScoreDocument(upload, 800, { engine: dropped, renderer: fakeRenderer() }),
    );
    await waitFor(() => expect(file.result.current.status).toBe('ready'), LONG);
    // No argument at all: a file with a few stray fingerings must not cap the whole piece.
    expect(dropped.solves[0]).toBeUndefined();
    expect(file.result.current.printed!.size).toBeGreaterThan(0);
  });

  it('a library piece without an editor count gets the level only', async () => {
    const piece = (await loadPiece(library.slug))!;
    const bare = { ...piece };
    delete bare.editorDigits;
    const details = [...(await loadPieceDetails()).values()];
    setPieceDetails(details.map((p) => (p.slug === piece.slug ? bare : p)));
    try {
      const engine = inlineEngine();
      const { result } = renderHook(() =>
        useScoreDocument(library, 800, { engine, renderer: fakeRenderer(), fetchText }),
      );
      await waitFor(() => expect(result.current.status).toBe('ready'), LONG);
      expect(engine.solves[0]).toEqual({ level: piece.level });
    } finally {
      setPieceDetails(details);
    }
  });

  it("publishes no printed set while the editor's fingering is shown", async () => {
    useAppStore.getState().setSettings({ showEditorial: true });
    const { result } = renderHook(() =>
      useScoreDocument(fingered, 800, { engine: inlineEngine(), renderer: fakeRenderer() }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'), LONG);
    expect(result.current.assignment).toEqual(result.current.editorial);
    expect(result.current.printed).toBeNull();
  });

  it('a hand-size re-solve publishes the printed set with the digits that changed', async () => {
    const engine = inlineEngine();
    const { result } = renderHook(() =>
      useScoreDocument(upload, 800, { engine, renderer: fakeRenderer() }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'), LONG);
    const before = result.current.printed;
    act(() => useAppStore.getState().setSettings({ handSize: 'child' }));
    await waitFor(() => expect(result.current.printed).not.toBe(before), LONG);
    // One update: when the digits are patched, the printed set is the one for those digits.
    const printed = result.current.printed!;
    for (const id of printed) expect(result.current.assignment![id]).toBeDefined();
    expect(printed.size).toBeGreaterThan(0);
  });
});
