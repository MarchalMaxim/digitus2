import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatHandsScorecard, runEvalHands } from './evalhands.js';
import { main } from './run.js';

const H = '//Version: PianoFingering_v170101\n';
const row = (i: number, on: number, pitch: string, ch: number) =>
  `${i}\t${on}\t${on + 0.5}\t${pitch}\t64\t64\t${ch}\t${ch === 0 ? 1 : -1}`;
const piece = (pitches: Array<[string, number]>) =>
  H + pitches.map(([p, ch], i) => row(i, Math.floor(i / 2) * 0.5, p, ch)).join('\n') + '\n';
const twinkle = fileURLToPath(
  new URL('../../../content/scores/twinkle-twinkle-little-star.musicxml', import.meta.url),
);

function fixtureDir() {
  const root = mkdtempSync(join(tmpdir(), 'digitus2-evalhands-'));
  const gold = join(root, 'gold', 'FingeringFiles');
  mkdirSync(gold, { recursive: true });
  const twoHands: Array<[string, number]> = [
    ['C5', 0],
    ['C3', 1],
    ['D5', 0],
    ['G2', 1],
    ['E5', 0],
    ['C3', 1],
    ['F5', 0],
    ['G2', 1],
  ];
  writeFileSync(join(gold, '001-1_fingering.txt'), piece(twoHands));
  writeFileSync(join(gold, '001-2_fingering.txt'), piece(twoHands.map(([p]) => [p, 0])));
  writeFileSync(join(gold, '002-1_fingering.txt'), piece(twoHands));
  const split = join(root, 'split.json');
  writeFileSync(
    split,
    JSON.stringify({
      default_split: 'toy',
      splits: { toy: { test: { pieces: ['001', '002', '003'] } } },
    }),
  );
  const library = join(root, 'library');
  mkdirSync(join(library, 'scores'), { recursive: true });
  copyFileSync(twinkle, join(library, 'scores', 'twinkle.musicxml'));
  const manifest = join(library, 'manifest.json');
  writeFileSync(
    manifest,
    JSON.stringify([{ slug: 'twinkle', files: { score: 'scores/twinkle.musicxml' } }]),
  );
  const floor = join(root, 'floor.json');
  writeFileSync(floor, JSON.stringify({ hands: { accuracyMin: 101 } }));
  return { root, gold: join(root, 'gold'), split, manifest, floor };
}

describe('digitus2 evalhands', () => {
  it('scores every piece or lists it as skipped, uses the first annotation, and checks the floor', () => {
    const f = fixtureDir();
    const out = join(f.root, 'latest-hands.json');
    const { scorecard, floorBreaches } = runEvalHands({
      gold: f.gold,
      split: f.split,
      library: f.manifest,
      out,
      label: 'toy',
      floor: f.floor,
    });
    expect(scorecard.pig!.pieces.map((p) => p.id)).toEqual(['001', '002']);
    expect(scorecard.pig!.skipped).toEqual([{ id: '003', reason: 'no gold file' }]);
    expect(scorecard.pig!.pieces[0]!.notes).toBe(8);
    expect(scorecard.pig!.pieces[0]!.accuracy).toBeGreaterThanOrEqual(75);
    expect(scorecard.pig!.subset).toBe('test');
    expect(scorecard.library!.pieces).toEqual([
      expect.objectContaining({ id: 'twinkle', notes: 64 }),
    ]);
    expect(scorecard.library!.pieces[0]!.accuracy).toBeGreaterThanOrEqual(95);
    expect(scorecard.handSeparation.accuracy).toBe(scorecard.pig!.macro);
    expect(floorBreaches).toEqual([
      expect.stringMatching(/^hand accuracy [\d.]+ below floor 101\.00$/),
    ]);
    expect(existsSync(out)).toBe(true);
    expect(JSON.parse(readFileSync(out, 'utf8')).label).toBe('toy');
    expect(formatHandsScorecard(scorecard)).toContain('skipped 003: no gold file');
  });
  it('runs from the command line and exits 1 on a floor breach, 2 without a corpus', () => {
    const f = fixtureDir();
    const out: string[] = [];
    const err: string[] = [];
    const io = { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) };
    expect(main(['evalhands', '--library', f.manifest], io)).toBe(0);
    expect(out.join('')).toContain('library: 1 piece');
    expect(main(['evalhands', '--gold', f.gold, '--split', f.split, '--floor', f.floor], io)).toBe(
      1,
    );
    expect(err.join('')).toContain('floor breach: hand accuracy');
    expect(main(['evalhands'], io)).toBe(2);
  });
  it('fails instead of passing when the named floor file is missing', () => {
    const f = fixtureDir();
    const err: string[] = [];
    const io = { stdout: () => {}, stderr: (t: string) => err.push(t) };
    const missing = join(f.root, 'no-such-floor.json');
    expect(main(['evalhands', '--gold', f.gold, '--split', f.split, '--floor', missing], io)).toBe(
      1,
    );
    expect(err.join('')).toContain('floor file not found');
  });
  it('scores only the core benchmark set of a tagged manifest unless asked for all', () => {
    const f = fixtureDir();
    const tagged = join(f.root, 'library', 'tagged.json');
    writeFileSync(
      tagged,
      JSON.stringify([
        { slug: 'twinkle', benchmarkSet: 'core30', files: { score: 'scores/twinkle.musicxml' } },
        { slug: 'twinkle-again', benchmarkSet: null, files: { score: 'scores/twinkle.musicxml' } },
      ]),
    );
    const core = runEvalHands({ library: tagged }).scorecard.library!;
    expect(core.pieces.map((p) => p.id)).toEqual(['twinkle']);
    expect(core.set).toBe('core30');
    const all = runEvalHands({ library: tagged, librarySet: 'all' }).scorecard.library!;
    expect(all.pieces.map((p) => p.id)).toEqual(['twinkle', 'twinkle-again']);
    expect(all.set).toBe('all');
  });
});
