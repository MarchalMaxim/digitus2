import type { Assignment, Score } from '@digitus2/engine';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore, type PieceSource } from '../app/store.js';
import { handle } from '../engine/handlers.js';
import type { EmbellishedDoc } from '../engine/protocol.js';
import { loadPiece, loadPieceDetails, setPieceDetails } from '../library/manifest.js';
import type { ScanSession } from '../scan/model.js';
import { SupersededError, type RenderRequest, type ScoreRenderer } from './render/renderer.js';
import { fakeRenderer, inlineEngine, notesIn } from './testing/services.js';
import {
  carryAssignment,
  diffDigits,
  embellishEligible,
  EMBELLISH_MAX_GRADE,
  EMBELLISH_MAX_NOTES,
  useScoreDocument,
} from './useScoreDocument.js';

// Under happy-dom, Vite's asset plugin rewrites a literal `new URL('…', import.meta.url)` into
// an http URL; a path held in a variable is left alone and stays a file URL.
const SCORES = '../../../../content/scores/';
const TWINKLE_MID = '../../../../packages/engine/fixtures/twinkle.mid';
const read = (path: string) => new Uint8Array(readFileSync(new URL(path, import.meta.url)));
const twinkleBytes = read(`${SCORES}twinkle-twinkle-little-star.musicxml`);
const maryBytes = read(`${SCORES}mary-had-a-little-lamb.musicxml`);
const twinkle: PieceSource = { kind: 'file', name: 'twinkle.musicxml', bytes: twinkleBytes };
const mary: PieceSource = { kind: 'file', name: 'mary.musicxml', bytes: maryBytes };

/** A library score file's bytes, by the asset URL's file name. */
async function fetchText(url: string): Promise<Uint8Array> {
  const name = decodeURIComponent(url.replace(/[?#].*$/, '').replace(/^.*\//, ''));
  return read(`${SCORES}${name}`);
}

/**
 * The fake renderer, except that a layout of the embellished Twinkle (70 notes) rejects with the
 * next of `failures` while any are left.
 */
function failingRenderer(failures: Error[]): ScoreRenderer {
  const base = fakeRenderer();
  return {
    ...base,
    render: (req: RenderRequest) => {
      const failure = notesIn(req.xml) === 70 ? failures.shift() : undefined;
      return failure ? Promise.reject(failure) : base.render(req);
    },
  };
}

/** A one-staff melody of `n` quarter notes in 4/4, the last bar filled with rests. */
function melodyOf(n: number): PieceSource {
  const steps = ['C', 'D', 'E', 'F', 'G', 'F', 'E', 'D'];
  const note = (i: number) =>
    `<note><pitch><step>${steps[i % steps.length]}</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`;
  const rest = '<note><rest/><duration>1</duration><voice>1</voice><type>quarter</type></note>';
  const bars: string[] = [];
  for (let i = 0; i < n; i += 4) {
    const beats = Array.from({ length: 4 }, (_, k) => (i + k < n ? note(i + k) : rest)).join('');
    const attributes =
      i === 0
        ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>'
        : '';
    bars.push(`<measure number="${i / 4 + 1}">${attributes}${beats}</measure>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${bars.join('')}</part></score-partwise>`;
  return { kind: 'file', name: `melody-${n}.musicxml`, bytes: new TextEncoder().encode(xml) };
}

/** What the worker offers for a text, computed here the way the worker computes it. */
function offerFor(xml: string): EmbellishedDoc {
  const r = handle({ id: 1, type: 'embellish', xml });
  if (!r.ok || r.type !== 'embellish' || !r.offered) throw new Error('not offered');
  return r.offered;
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

/** Opens `source` and waits until the embellished version has been offered. */
async function openOffered(source: PieceSource = twinkle, width = 800) {
  const engine = inlineEngine();
  const renderer = fakeRenderer();
  const hook = renderHook(
    ({ src, w }) => useScoreDocument(src, w, { engine, renderer, fetchText }),
    { initialProps: { src: source, w: width } },
  );
  // A longer piece is solved and linted at four hand sizes twice: give the guard time.
  await waitFor(() => expect(hook.result.current.embellish).toBe('offered'), { timeout: 15_000 });
  return { ...hook, engine, renderer };
}

describe('"Add notes between" in the score document', () => {
  it('offers the embellished version after the plain score is ready', async () => {
    const engine = inlineEngine();
    const renderer = fakeRenderer();
    const seen: Array<[string, string]> = [];
    const { result } = renderHook(() => {
      const d = useScoreDocument(twinkle, 800, { engine, renderer });
      seen.push([d.status, d.embellish]);
      return d;
    });
    await waitFor(() => expect(result.current.embellish).toBe('offered'));
    const ready = seen.findIndex(([s]) => s === 'ready');
    const statuses = seen.slice(0, ready + 1).map(([s]) => s);
    expect(statuses.filter((s, i) => statuses[i - 1] !== s)).toEqual([
      'loading',
      'fingering',
      'rendering',
      'ready',
    ]);
    expect(seen.slice(0, ready + 1).every(([, e]) => e === 'pending')).toBe(true);
    expect(engine.calls.indexOf('embellish')).toBeGreaterThan(engine.calls.indexOf('fingeredXml'));
    // The embellished version was laid out ahead of the switch.
    expect(renderer.xmls.map(notesIn)).toEqual([64, 70]);
    expect(result.current.embellished).toBe(false);
    expect(result.current.shownVersion).toBe('plain');
    expect(result.current.score!.notes).toHaveLength(64);
    expect(result.current.pages[0]).toContain('data-notes="64"');
  });
  it('switching on shows the embellished score and pages at once', async () => {
    const { result, renderer } = await openOffered();
    const plainXml = result.current.xml;
    const renders = renderer.renders;
    act(() => result.current.setEmbellished(true));
    expect(result.current.embellished).toBe(true);
    expect(result.current.shownVersion).toBe('embellished');
    expect(result.current.score!.notes).toHaveLength(70);
    expect(Object.keys(result.current.assignment!)).toHaveLength(70);
    expect(result.current.pages).toEqual(['<svg data-w="800" data-fings="70" data-notes="70"/>']);
    expect(result.current.digitChanges).toBeNull();
    expect(renderer.renders).toBe(renders);
    expect(result.current.plain!.score.notes).toHaveLength(64);
    expect(Object.keys(result.current.plain!.assignment!)).toHaveLength(64);
    expect(result.current.xml).toBe(plainXml);
  });
  it('switching off restores the plain pages without a layout', async () => {
    const { result, renderer } = await openOffered();
    const plainPages = result.current.pages;
    const plainAssignment = result.current.assignment;
    act(() => result.current.setEmbellished(true));
    const renders = renderer.renders;
    act(() => result.current.setEmbellished(false));
    expect(result.current.shownVersion).toBe('plain');
    expect(result.current.pages).toEqual(plainPages);
    expect(result.current.score!.notes).toHaveLength(64);
    expect(result.current.assignment).toBe(plainAssignment);
    expect(renderer.renders).toBe(renders);
  });
  it('a piece with fewer than three figures is never offered', async () => {
    const engine = inlineEngine();
    const { result } = renderHook(() =>
      useScoreDocument(mary, 800, { engine, renderer: fakeRenderer() }),
    );
    await waitFor(() => expect(result.current.embellish).toBe('none'));
    expect(engine.calls).toContain('embellish');
    act(() => result.current.setEmbellished(true));
    expect(result.current.embellished).toBe(false);
    expect(result.current.shownVersion).toBe('plain');
    expect(result.current.score!.notes).toHaveLength(34);
  });
  it('a new source starts with the switch off', async () => {
    const { result, rerender } = await openOffered();
    act(() => result.current.setEmbellished(true));
    expect(result.current.embellished).toBe(true);
    const text = new TextDecoder().decode(twinkleBytes);
    const other = new TextEncoder().encode(text.replace('<work-title>', '<work-title>Another '));
    expect(other).not.toEqual(twinkleBytes);
    rerender({ src: { kind: 'file', name: 'twinkle.musicxml', bytes: other }, w: 800 });
    expect(result.current.embellished).toBe(false);
    expect(result.current.embellish).toBe('pending');
    await waitFor(() => expect(result.current.embellish).toBe('offered'));
    expect(result.current.embellished).toBe(false);
    expect(result.current.shownVersion).toBe('plain');
  });
  it('a MIDI hand-split reopen withdraws the switch until the new import is guarded', async () => {
    const midi: PieceSource = { kind: 'file', name: 'twinkle.mid', bytes: read(TWINKLE_MID) };
    const { result } = renderHook(() =>
      useScoreDocument(midi, 800, { engine: inlineEngine(), renderer: fakeRenderer() }),
    );
    await waitFor(() => expect(result.current.embellish).not.toBe('pending'));
    expect(result.current.embellish).toBe('offered');
    act(() => result.current.setEmbellished(true));
    expect(result.current.shownVersion).toBe('embellished');
    act(() => result.current.setSplitMidi(60));
    expect(result.current.status).toBe('loading');
    expect(result.current.embellish).toBe('pending');
    expect(result.current.embellished).toBe(false);
    expect(result.current.shownVersion).toBe('plain');
    expect(result.current.plain).toBeNull();
    await waitFor(() => expect(result.current.embellish).toBe('offered'));
    expect(result.current.embellished).toBe(false);
    expect(result.current.shownVersion).toBe('plain');
    expect(result.current.score!.notes).toHaveLength(64);
  });
  it('a reopen while switched on puts the plain version back in the same update', async () => {
    const midi: PieceSource = { kind: 'file', name: 'twinkle.mid', bytes: read(TWINKLE_MID) };
    const seen: Array<ReturnType<typeof useScoreDocument>> = [];
    const { result } = renderHook(() => {
      const d = useScoreDocument(midi, 800, { engine: inlineEngine(), renderer: fakeRenderer() });
      seen.push(d);
      return d;
    });
    await waitFor(() => expect(result.current.embellish).toBe('offered'));
    const { score: plainScore, pages: plainPages, assignment: plainAssignment } = result.current;
    act(() => result.current.setEmbellished(true));
    expect(result.current.shownVersion).toBe('embellished');
    expect(result.current.score!.notes).toHaveLength(70);
    const from = seen.length;
    act(() => result.current.setSplitMidi(60));
    // The first render of the reopen shows the plain version everywhere.
    const first = seen[from]!;
    expect(first.splitMidi).toBe(60);
    expect(first.status).toBe('loading');
    expect(first.embellish).toBe('pending');
    expect(first.embellished).toBe(false);
    expect(first.shownVersion).toBe('plain');
    expect(first.plain).toBeNull();
    expect(first.score).toBe(plainScore);
    expect(first.pages).toBe(plainPages);
    expect(first.assignment).toBe(plainAssignment);
    expect(first.digitChanges).toBeNull();
    // The final state is the new plain document, offered again with the switch off.
    await waitFor(() => expect(result.current.embellish).toBe('offered'));
    expect(result.current.status).toBe('ready');
    expect(result.current.midiInfo?.splitMidi).toBe(60);
    expect(result.current.score).not.toBe(plainScore);
    expect(result.current.score!.notes.filter((n) => n.hand === 'R')).toHaveLength(42);
    expect(result.current.shownVersion).toBe('plain');
    expect(result.current.embellished).toBe(false);
    // No render pairs one version's notes with the other version's pages or fingering.
    for (const d of seen) {
      if (!d.score) continue;
      const ids = new Set(d.score.notes.map((n) => n.id));
      if (d.pages.length > 0) expect(d.pages[0]).toContain(`data-notes="${d.score.notes.length}"`);
      if (d.assignment) expect(Object.keys(d.assignment).every((id) => ids.has(id))).toBe(true);
    }
  });
  it('a failed pre-layout never shows the switch', async () => {
    const { result } = renderHook(() =>
      useScoreDocument(twinkle, 800, {
        engine: inlineEngine(),
        renderer: failingRenderer([new Error('the score renderer failed')]),
      }),
    );
    await waitFor(() => expect(result.current.embellish).toBe('none'));
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
    act(() => result.current.setEmbellished(true));
    expect(result.current.embellished).toBe(false);
    expect(result.current.shownVersion).toBe('plain');
  });
  it('a failed layout at the switch falls back to the plain version', async () => {
    const { result } = renderHook(() =>
      useScoreDocument(twinkle, 800, {
        engine: inlineEngine(),
        // The pre-layout is superseded, so the switch lays out, and that layout fails.
        renderer: failingRenderer([new SupersededError(), new Error('the score renderer failed')]),
      }),
    );
    await waitFor(() => expect(result.current.embellish).toBe('offered'));
    const { score: plainScore, pages: plainPages } = result.current;
    act(() => result.current.setEmbellished(true));
    await waitFor(() => expect(result.current.embellish).toBe('none'));
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
    expect(result.current.embellished).toBe(false);
    expect(result.current.shownVersion).toBe('plain');
    expect(result.current.score).toBe(plainScore);
    expect(result.current.pages).toEqual(plainPages);
  });
  it('a hand-split round trip leaves the switch off', async () => {
    const midi: PieceSource = { kind: 'file', name: 'twinkle.mid', bytes: read(TWINKLE_MID) };
    const renderer = fakeRenderer();
    const { result } = renderHook(() =>
      useScoreDocument(midi, 800, { engine: inlineEngine(), renderer }),
    );
    await waitFor(() => expect(result.current.embellish).toBe('offered'));
    act(() => result.current.setEmbellished(true));
    expect(result.current.shownVersion).toBe('embellished');
    const before = renderer.xmls.length;
    act(() => result.current.setSplitMidi(60));
    await waitFor(() => expect(result.current.embellish).toBe('offered'));
    act(() => result.current.setSplitMidi(null));
    expect(result.current.embellished).toBe(false);
    await waitFor(() => expect(result.current.embellish).toBe('offered'));
    // Settle any layout the new document would ask for.
    await act(async () => {});
    expect(result.current.splitMidi).toBeNull();
    expect(result.current.embellished).toBe(false);
    expect(result.current.shownVersion).toBe('plain');
    expect(result.current.score!.notes).toHaveLength(64);
    // Each reopen lays out its plain score and pre-lays out its embellished one, nothing more:
    // the embellished version is never laid out to be shown.
    expect(renderer.xmls.slice(before).map(notesIn)).toEqual([64, 70, 64, 70]);
  });
  it('keeps the pages of one width bucket per version', async () => {
    const { result, rerender, renderer } = await openOffered();
    const renders = renderer.renders;
    rerender({ src: twinkle, w: 500 });
    await waitFor(() => expect(result.current.pages[0]).toContain('data-w="500"'));
    // Back at 800 the plain pages are laid out again: only the 480 bucket's were kept.
    rerender({ src: twinkle, w: 800 });
    await waitFor(() => expect(result.current.pages[0]).toContain('data-w="800"'));
    expect(renderer.renders).toBe(renders + 2);
    // The embellished pages laid out ahead at 800 are still there: the switch lays nothing out.
    act(() => result.current.setEmbellished(true));
    expect(result.current.shownVersion).toBe('embellished');
    expect(result.current.pages[0]).toContain('data-notes="70"');
    expect(renderer.renders).toBe(renders + 2);
    // A new width lays out the embellished version and drops its 800 pages, so switching off
    // and on again at 800 lays it out once more.
    rerender({ src: twinkle, w: 1200 });
    await waitFor(() => expect(result.current.pages[0]).toContain('data-w="1200"'));
    rerender({ src: twinkle, w: 800 });
    await waitFor(() => expect(result.current.pages[0]).toContain('data-w="800"'));
    expect(result.current.pages[0]).toContain('data-notes="70"');
    expect(renderer.renders).toBe(renders + 4);
  });
  it("a failed fetch of the editor's fingering at the switch is the plain document's error", async () => {
    let failFingered = false;
    const fetchFlaky = (url: string) =>
      failFingered && url.includes('.fingered')
        ? Promise.reject(new Error('the fingered file could not be fetched'))
        : fetchText(url);
    const engine = inlineEngine();
    const { result } = renderHook(() =>
      useScoreDocument({ kind: 'library', slug: 'schumann-op68-no1-melody' }, 800, {
        engine,
        renderer: fakeRenderer(),
        fetchText: fetchFlaky,
      }),
    );
    await waitFor(() => expect(result.current.embellish).toBe('offered'), { timeout: 15_000 });
    failFingered = true;
    act(() => {
      useAppStore.getState().setSettings({ showEditorial: true });
      result.current.setEmbellished(true);
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('the fingered file could not be fetched');
    // Not an embellished layout failure: the switch is not withdrawn.
    expect(result.current.embellish).toBe('offered');
  }, 30_000);
  it('a hand-size change re-fingers both versions', async () => {
    const { result, engine, renderer } = await openOffered();
    const offered = offerFor(result.current.xml!);
    const plainScore = result.current.plain!.score;
    act(() => result.current.setEmbellished(true));
    const solves = () => engine.calls.filter((c) => c === 'solve').length;
    const before = solves();
    const renders = renderer.renders;
    const expected = diffDigits(offered.assignments.medium, offered.assignments.child);
    expect(expected.structural).toBe(false);
    expect(expected.changes.size).toBeGreaterThan(0);
    act(() => useAppStore.getState().setSettings({ handSize: 'child' }));
    await waitFor(() => expect(solves()).toBe(before + 1));
    const r = handle({ id: 1, type: 'solve', score: plainScore, profile: 'child' });
    if (!r.ok || r.type !== 'solve') throw new Error('solve failed');
    await waitFor(() => expect(result.current.plain!.assignment).toEqual(r.assignment));
    expect(result.current.shownVersion).toBe('embellished');
    expect(result.current.assignment).toEqual(offered.assignments.child);
    expect(result.current.digitChanges).toEqual(expected.changes);
    const ids = new Set(result.current.score!.notes.map((n) => n.id));
    for (const id of result.current.digitChanges!.keys()) expect(ids.has(id)).toBe(true);
    expect(renderer.renders).toBe(renders);
    expect(solves()).toBe(before + 1);
  });
  it('a width change lays out the version on screen', async () => {
    const { result, rerender, renderer } = await openOffered();
    act(() => result.current.setEmbellished(true));
    const renders = renderer.renders;
    rerender({ src: twinkle, w: 1200 });
    await waitFor(() => expect(result.current.pages[0]).toContain('data-w="1200"'));
    expect(renderer.renders).toBe(renders + 1);
    expect(notesIn(renderer.xmls.at(-1)!)).toBe(70);
    expect(result.current.pages[0]).toContain('data-notes="70"');
    expect(result.current.shownVersion).toBe('embellished');
  });
  it("shows a library piece's editorial fingering on the original notes of the embellished score", async () => {
    useAppStore.getState().setSettings({ showEditorial: true });
    const { result } = await openOffered({ kind: 'library', slug: 'schumann-op68-no1-melody' });
    const plainEditorial = result.current.editorial!;
    expect(result.current.assignment).toBe(plainEditorial);
    act(() => result.current.setEmbellished(true));
    await waitFor(() => expect(result.current.shownVersion).toBe('embellished'));
    const { score, editorial, assignment } = result.current;
    expect(score!.notes).toHaveLength(257);
    expect(assignment).toBe(editorial);
    expect(editorial).toEqual(carryAssignment(result.current.plain!.score, plainEditorial, score!));
    expect(Object.keys(editorial!)).toHaveLength(Object.keys(plainEditorial).length);
    // The plain fingering for export stays the editor's.
    expect(result.current.plain!.assignment).toBe(plainEditorial);
  }, 30_000);
});

describe('which pieces are tried', () => {
  it('embellishEligible', () => {
    expect(EMBELLISH_MAX_GRADE).toBe(2);
    expect(EMBELLISH_MAX_NOTES).toBe(900);
    expect(embellishEligible(null, false, 900)).toBe(true);
    expect(embellishEligible(null, false, 901)).toBe(false);
    expect(embellishEligible(1, false, 5000)).toBe(true);
    expect(embellishEligible(2, false)).toBe(true);
    expect(embellishEligible(3, false)).toBe(false);
    expect(embellishEligible(null, false)).toBe(true);
    expect(embellishEligible(1, true)).toBe(false);
  });
  it('asks the worker for a grade-1 library piece and never for a grade-3 one', async () => {
    const piece = (await loadPiece('twinkle-twinkle-little-star'))!;
    expect(piece.level).toBe(1);
    const details = [...(await loadPieceDetails()).values()];
    setPieceDetails([...details, { ...piece, slug: 'twinkle-at-grade-3', level: 3 }]);
    try {
      const engine = inlineEngine();
      const { result: hard } = renderHook(() =>
        useScoreDocument({ kind: 'library', slug: 'twinkle-at-grade-3' }, 800, {
          engine,
          renderer: fakeRenderer(),
          fetchText,
        }),
      );
      await waitFor(() => expect(hard.current.embellish).toBe('none'));
      expect(engine.calls).not.toContain('embellish');
      const { result: easy } = await openOffered({ kind: 'library', slug: piece.slug });
      expect(easy.current.embellish).toBe('offered');
    } finally {
      setPieceDetails(details);
    }
  });
  it('asks for a dropped file of 900 notes and never for one of 901', async () => {
    const open = async (n: number) => {
      const engine = inlineEngine();
      const posted: string[] = [];
      // The guard itself is not under test here: answer at once, with no offer.
      engine.embellish = (xml) => {
        posted.push(xml);
        return Promise.resolve({ offered: null, reason: 'not under test', ms: 0 });
      };
      const { result, unmount } = renderHook(() =>
        useScoreDocument(melodyOf(n), 800, { engine, renderer: fakeRenderer() }),
      );
      await waitFor(() => expect(result.current.embellish).toBe('none'), { timeout: 15_000 });
      expect(result.current.score!.notes).toHaveLength(n);
      unmount();
      return posted.length;
    };
    expect(await open(901)).toBe(0);
    expect(await open(900)).toBe(1);
  }, 30_000);
  it('never asks for a scan import', async () => {
    const engine = inlineEngine();
    const { result } = renderHook(() =>
      useScoreDocument({ ...twinkle, scan: {} as ScanSession } as PieceSource, 800, {
        engine,
        renderer: fakeRenderer(),
      }),
    );
    await waitFor(() => expect(result.current.embellish).toBe('none'));
    expect(engine.calls).not.toContain('embellish');
  });
});

describe('carryAssignment', () => {
  const load = (bytes: Uint8Array) => {
    const r = handle({ id: 1, type: 'load', kind: 'musicxml', input: bytes, source: 'x.musicxml' });
    if (!r.ok || r.type !== 'load') throw new Error('load failed');
    return r;
  };
  const quarters = (s: Score, id: string) => {
    const n = s.notes.find((m) => m.id === id)!;
    return n.onsetTick / s.divisions;
  };

  it("the editor's fingering carries onto the original notes", () => {
    const plain = load(twinkleBytes);
    const offered = offerFor(plain.xml);
    const first = plain.score.notes[0]!;
    const editorial: Assignment = { [first.id]: { finger: 3, source: 'editorial' } };
    const carried = carryAssignment(plain.score, editorial, offered.score)!;
    const ids = Object.keys(carried);
    expect(ids).toHaveLength(1);
    const target = offered.score.notes.find((n) => n.id === ids[0])!;
    expect(quarters(offered.score, target.id)).toBe(quarters(plain.score, first.id));
    expect(target.midi).toBe(first.midi);
    expect(carried[target.id]).toEqual(editorial[first.id]);
    // Every original note finds its note, and no added note gets an entry.
    const all: Assignment = Object.fromEntries(
      plain.score.notes.map((n) => [n.id, { finger: 1, source: 'editorial' as const }]),
    );
    const everything = carryAssignment(plain.score, all, offered.score)!;
    expect(Object.keys(everything)).toHaveLength(64);
    expect(offered.score.notes.length - Object.keys(everything).length).toBe(offered.figures);
  });
  it('gives null when nothing matches', () => {
    const plain = load(twinkleBytes);
    expect(carryAssignment(plain.score, {}, plain.score)).toBeNull();
    const mary = load(maryBytes);
    const first = plain.score.notes[0]!;
    const shifted = {
      ...mary.score,
      notes: mary.score.notes.map((n) => ({ ...n, midi: n.midi + 100 })),
    };
    expect(
      carryAssignment(plain.score, { [first.id]: { finger: 1, source: 'editorial' } }, shifted),
    ).toBeNull();
  });
});
