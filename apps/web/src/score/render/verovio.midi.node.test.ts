// @vitest-environment node
import { readFileSync } from 'node:fs';
import {
  finalizeScore,
  importMidi,
  injectFingerings,
  midiToSpelling,
  scoreToMusicXml,
  solveFingering,
} from '@digitus2/engine';
import type { Hand, Note, Score } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { injectNoteIds } from './injectIds.js';
import { verovioOptions } from './options.js';

async function toolkit() {
  const { default: createVerovioModule } = await import('verovio/wasm');
  const { VerovioToolkit } = await import('verovio/esm');
  const tk = new VerovioToolkit(await createVerovioModule());
  tk.setOptions(verovioOptions(900));
  return tk;
}
function render(tk: Awaited<ReturnType<typeof toolkit>>, xml: string): string {
  // Verovio 6.3 returns 1 or 0 here (its cwrap is typed "number"), not a boolean.
  expect(tk.loadData(xml)).toBeTruthy();
  return Array.from({ length: tk.getPageCount() }, (_, i) => tk.renderToSVG(i + 1)).join('');
}
const hasNote = (svg: string, id: string) =>
  new RegExp(`<g[^>]*\\bid="${id}"[^>]*class="note"|<g[^>]*class="note"[^>]*\\bid="${id}"`).test(
    svg,
  );

/** Lengths of 5, 7 and 9 sixteenths (the last across a barline), eighth triplets, 32nd notes. */
function awkwardScore(): Score {
  const spec: Array<[number, number, number, Hand]> = [
    [0, 600, 60, 'R'],
    [600, 1440, 62, 'R'],
    [1440, 2520, 64, 'R'],
    [2520, 2640, 65, 'R'],
    [2640, 2880, 67, 'R'],
    [2880, 3040, 69, 'R'],
    [3040, 3200, 71, 'R'],
    [3200, 3360, 72, 'R'],
    [3360, 3420, 74, 'R'],
    [3420, 3480, 72, 'R'],
    [3480, 3840, 71, 'R'],
    [0, 1920, 48, 'L'],
    [1920, 3840, 43, 'L'],
  ];
  return finalizeScore({
    meta: { title: 'awkward' },
    divisions: 480,
    tempoMap: [{ tick: 0, qpm: 90 }],
    timeSignatures: [{ tick: 0, beats: 4, beatType: 4 }],
    keySignatures: [{ tick: 0, fifths: 0 }],
    measures: [0, 1].map((i) => ({
      index: i,
      startTick: i * 1920,
      lengthTicks: 1920,
      number: String(i + 1),
    })),
    notes: spec.map(([onset, offset, midi, hand], i): Note => ({
      id: `a${i}`,
      onsetTick: onset,
      offsetTick: offset,
      onsetSec: 0,
      offsetSec: 0,
      midi,
      spelling: midiToSpelling(midi),
      hand,
      staff: hand === 'R' ? 1 : 2,
      voice: hand === 'R' ? 1 : 5,
      measureIndex: Math.floor(onset / 1920),
      isGrace: false,
      chordId: '',
      sourceIndices: [],
    })),
  });
}

describe('verovio renders generated MusicXML', () => {
  it('keeps every note id of an imported MIDI file and tags every fingering digit with its note', async () => {
    const tk = await toolkit();
    const { xml, score } = importMidi(
      new Uint8Array(readFileSync(new URL('../../../fixtures/twinkle.mid', import.meta.url))),
      { title: 'twinkle' },
    );
    // No weight set yet: the engine worker solves with the profile alone until M3 lands.
    const { assignment } = solveFingering(score, { profile: 'medium' });
    const svg = render(tk, injectNoteIds(injectFingerings(xml, score, assignment), score));
    for (const n of score.notes) expect(hasNote(svg, n.id), n.id).toBe(true);
    const digits =
      svg.match(/class="fing"[^>]*data-startid="#m\d+"|data-startid="#m\d+"[^>]*class="fing"/g) ??
      [];
    expect(digits).toHaveLength(64);
    tk.destroy();
  }, 30_000);
  it('renders tuplets, dotted values, ties across barlines and odd lengths written as tied notes', async () => {
    const tk = await toolkit();
    const score = awkwardScore();
    const svg = render(tk, scoreToMusicXml(score));
    for (const n of score.notes) expect(hasNote(svg, n.id), n.id).toBe(true);
    expect(svg).toMatch(/class="tuplet"/);
    expect(svg).toMatch(/class="tie"/);
    expect(svg).toMatch(/class="dots?"/);
    tk.destroy();
  }, 30_000);
});
