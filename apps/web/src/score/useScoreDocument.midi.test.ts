import { act, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { fakeRenderer, inlineEngine } from './testing/services.js';
import { useScoreDocument } from './useScoreDocument.js';

// Under happy-dom, Vite's asset plugin rewrites a literal `new URL('…', import.meta.url)` into
// an http URL; a path held in a variable is left alone and stays a file URL.
const TWINKLE_MID = '../../fixtures/twinkle.mid';
const SHORT_PIANO = '../../fixtures/short-piano.musicxml';
const twinkle = new Uint8Array(readFileSync(new URL(TWINKLE_MID, import.meta.url)));
const shortPiano = new Uint8Array(readFileSync(new URL(SHORT_PIANO, import.meta.url)));

beforeEach(() =>
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
  }),
);

describe('useScoreDocument with a MIDI file', () => {
  it('imports, exposes the MIDI facts, and re-imports when the hand split changes', async () => {
    const engine = inlineEngine();
    const { result } = renderHook(() =>
      useScoreDocument({ kind: 'file', name: 'twinkle.mid', bytes: twinkle }, 800, {
        engine,
        renderer: fakeRenderer(),
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.score!.notes).toHaveLength(64);
    expect(result.current.title).toBe('twinkle');
    expect(result.current.midiInfo).toMatchObject({ quantizedMovedShare: 0, splitMidi: null });
    expect(result.current.splitMidi).toBeNull();
    act(() => result.current.setSplitMidi(67));
    await waitFor(() => expect(result.current.midiInfo?.splitMidi).toBe(67));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.splitMidi).toBe(67);
    expect(result.current.score!.notes.filter((n) => n.hand === 'R')).toHaveLength(14);
    expect(Object.keys(result.current.assignment!)).toHaveLength(64);
    act(() => result.current.setSplitMidi(null));
    await waitFor(() => expect(result.current.midiInfo?.splitMidi).toBeNull());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(engine.loads.map((o) => o?.splitMidi)).toEqual([undefined, 67, undefined]);
  });
  it('keeps the previous import on screen while a new hand split is imported', async () => {
    const { result } = renderHook(() =>
      useScoreDocument({ kind: 'file', name: 'twinkle.mid', bytes: twinkle }, 800, {
        engine: inlineEngine(),
        renderer: fakeRenderer(),
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const before = result.current;
    act(() => result.current.setSplitMidi(60));
    // The Hand split control (and its focus) needs midiInfo and the score while the new import
    // is prepared; the title and the pages stay too, so nothing flashes.
    expect(result.current.status).toBe('loading');
    expect(result.current.splitMidi).toBe(60);
    expect(result.current.midiInfo).toBe(before.midiInfo);
    expect(result.current.score).toBe(before.score);
    expect(result.current.pages).toEqual(before.pages);
    expect(result.current.title).toBe('twinkle');
    await waitFor(() => expect(result.current.midiInfo?.splitMidi).toBe(60));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.score).not.toBe(before.score);
    expect(result.current.score!.notes.filter((n) => n.hand === 'R')).toHaveLength(42);
  });
  it('keeps midiInfo null for a MusicXML file', async () => {
    const { result } = renderHook(() =>
      useScoreDocument({ kind: 'file', name: 'short-piano.musicxml', bytes: shortPiano }, 800, {
        engine: inlineEngine(),
        renderer: fakeRenderer(),
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.midiInfo).toBeNull();
    expect(result.current.splitMidi).toBeNull();
  });
  it('opens again when other bytes arrive under the same file name', async () => {
    const engine = inlineEngine();
    const other = new Uint8Array([...twinkle, 0, 0, 0]); // the same song with trailing padding
    const { result, rerender } = renderHook(
      ({ bytes }) =>
        useScoreDocument({ kind: 'file', name: 'twinkle.mid', bytes }, 800, {
          engine,
          renderer: fakeRenderer(),
        }),
      { initialProps: { bytes: twinkle } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(engine.loads).toHaveLength(1);
    rerender({ bytes: other });
    await waitFor(() => expect(engine.loads).toHaveLength(2));
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
