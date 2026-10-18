import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toHandExamples } from '../src/learn/data.js';
import { dataGate } from './dataGate.js';
import {
  defaultCorpusRoots,
  loadCorpora,
  PIG_VALIDATION_PIECES,
  readPigValidation,
} from './corpora.js';

// The plan's check used paths relative to the working directory, which is packages/engine under
// `pnpm --filter`; the default roots resolve from the repository root instead.
const roots = defaultCorpusRoots();
const have = dataGate(
  'the corpora checks',
  existsSync(join(roots.pig, 'FingeringFiles')) &&
    existsSync(join(roots.mutopia, 'FingeringFiles')) &&
    existsSync(roots.mutopiaSplit),
);

describe.skipIf(!have)('corpora', () => {
  it('validation pieces are 20 fixed train ids', () => {
    expect(PIG_VALIDATION_PIECES).toHaveLength(20);
    expect(PIG_VALIDATION_PIECES).toEqual([...PIG_VALIDATION_PIECES].sort());
    for (const id of PIG_VALIDATION_PIECES) expect(Number(id)).toBeGreaterThanOrEqual(31);
    expect(new Set(PIG_VALIDATION_PIECES).size).toBe(20);
    for (const id of PIG_VALIDATION_PIECES) expect(id).toMatch(/^\d{3}$/);
    // the list is the file's own, and every id of it is a PIG train piece the loader can read
    expect(PIG_VALIDATION_PIECES).toEqual(readPigValidation(roots.pigValidation));
    const { pieces } = loadCorpora({ pigValidation: true });
    expect(pieces.map((p) => p.id)).toEqual([...PIG_VALIDATION_PIECES]);
  });
  it('loads PIG train without the validation and test pieces, with every annotation', () => {
    const { pieces, sources } = loadCorpora({ pigTrain: true });
    expect(pieces).toHaveLength(120 - 20);
    for (const p of pieces) {
      expect(Number(p.id)).toBeGreaterThanOrEqual(31);
      expect(PIG_VALIDATION_PIECES).not.toContain(p.id);
      expect(p.annotations.length).toBeGreaterThanOrEqual(1);
    }
    expect(sources[0]!.corpus).toBe('pig');
    expect(sources[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('loads the PIG validation pieces on request, and never a test piece', () => {
    const { pieces } = loadCorpora({ pigTrain: true, pigValidation: true });
    expect(pieces).toHaveLength(120);
    expect(pieces.filter((p) => PIG_VALIDATION_PIECES.includes(p.id))).toHaveLength(20);
    for (const p of pieces) expect(Number(p.id)).toBeGreaterThanOrEqual(31);
    // every annotation of a piece is an assignment on the first file's note ids
    for (const p of pieces) {
      const ids = new Set(p.score.notes.map((n) => n.id));
      for (const a of p.annotations)
        for (const id of Object.keys(a)) expect(ids.has(id)).toBe(true);
    }
    // PIG train fingers every note, so the only missing entries are the notes a later annotator
    // plays with the other hand (6 files, 66 notes; cross-checked with a Python reading of the
    // channel column): gold 0 for that annotation, never a copied finger.
    let firstMissing = 0;
    let laterMissing = 0;
    for (const p of pieces) {
      const n = p.score.notes.length;
      firstMissing += n - Object.keys(p.annotations[0]!).length;
      for (const a of p.annotations.slice(1)) laterMissing += n - Object.keys(a).length;
    }
    expect(firstMissing).toBe(0);
    expect(laterMissing).toBe(66);
  });
  it('loads the textbook as 672 pieces with alternatives as extra annotations', () => {
    const { pieces } = loadCorpora({ textbook: true });
    expect(pieces).toHaveLength(672);
    expect(pieces.some((p) => p.annotations.length > 1)).toBe(true);
    const ex = toHandExamples(pieces[0]!);
    expect(ex).toHaveLength(1);
    expect(ex[0]!.golds[0]!.every((f) => f !== 0)).toBe(true);
  });
  it('loads Beringer without the C-sharp minor broken chords and Mutopia ok parts by split half', () => {
    const b = loadCorpora({ beringer: true });
    expect(b.pieces).toHaveLength(83);
    expect(b.pieces.map((p) => p.id)).not.toContain('BrokenChordsCsharpMinor');
    const train = loadCorpora({ mutopiaTrain: true }).pieces;
    const test = loadCorpora({ mutopiaTest: true }).pieces;
    expect(train.length + test.length).toBe(286);
    expect(new Set(train.map((p) => p.id)).size + new Set(test.map((p) => p.id)).size).toBe(286);
    // learning-prototype.md sections 1 and 6: 224 / 62 parts
    expect(train).toHaveLength(224);
    expect(test).toHaveLength(62);
    for (const p of [...train, ...test]) expect(p.license).toBeTruthy();
    const testIds = new Set(test.map((p) => p.id));
    for (const p of train) expect(testIds.has(p.id)).toBe(false);
  });
  it('keeps unfingered Mutopia notes in the score with gold 0', () => {
    const { pieces } = loadCorpora({ mutopiaTest: true });
    let notes = 0;
    let fingered = 0;
    for (const p of pieces) {
      notes += p.score.notes.length;
      fingered += Object.keys(p.annotations[0]!).length;
    }
    // research/data/splits/mutopia_split.json counts.test: 56,937 notes, 8,805 fingered
    expect(notes).toBe(56937);
    expect(fingered).toBe(8805);
  });
  it('is deterministic: the same selection gives the same pieces and source hashes', () => {
    const a = loadCorpora({ textbook: true, beringer: true });
    const b = loadCorpora({ textbook: true, beringer: true });
    expect(a.sources).toEqual(b.sources);
    expect(a.sources.map((s) => s.corpus)).toEqual(['textbook', 'beringer']);
    expect(a.pieces.map((p) => `${p.corpus}:${p.id}`)).toEqual(
      b.pieces.map((p) => `${p.corpus}:${p.id}`),
    );
  });
});

describe('corpora without data', () => {
  it('throws naming the missing directory and research/data/README.md', () => {
    expect(() => loadCorpora({ beringer: true }, { beringer: 'no/such/beringer' })).toThrow(
      /no[/\\]such[/\\]beringer.*research\/data\/README\.md/s,
    );
  });
  it('selects nothing when nothing is asked for', () => {
    expect(loadCorpora({})).toEqual({ pieces: [], sources: [] });
  });
  it('refuses a textbook entry it cannot read instead of dropping it from the training data (M3 Task 9)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'digitus2-textbook-'));
    const good = {
      id: 'c-major-r',
      family: 'scale',
      hand: 'R',
      midi: [60, 62, 64],
      fingers: [1, 2, 3],
    };
    const bad = { id: 'broken', family: 'scale', hand: 'R', midi: [60, 62], fingers: [1] };
    writeFileSync(join(dir, 'scales.json'), JSON.stringify([good, bad]));
    writeFileSync(join(dir, 'arpeggios.json'), '[]');
    writeFileSync(join(dir, 'chromatic.json'), '[]');
    expect(() => loadCorpora({ textbook: true }, { textbook: dir })).toThrow(
      /scales\.json.*broken: skipped \(hand R, 2 notes, 1 fingers\)/s,
    );
    writeFileSync(join(dir, 'scales.json'), JSON.stringify([good]));
    expect(loadCorpora({ textbook: true }, { textbook: dir }).pieces.map((p) => p.id)).toEqual([
      'c-major-r',
    ]);
  });
});

// A PIG-shaped corpus written for the test: the data-free half of the loader's contract.
describe('corpora from files written for the test', () => {
  const H = '//Version: PianoFingering_v170101\n';
  /** Two right-hand notes; the first is fingered `first`, the second 5. */
  const annotation = (first: number) =>
    `${H}0\t0\t0.5\tC4\t80\t80\t0\t${first}\n1\t0.5\t1\tD4\t80\t80\t0\t5\n`;
  function pigRoots(files: Record<string, number>) {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-corpora-'));
    const pig = join(root, 'pig');
    mkdirSync(pig);
    for (const [name, first] of Object.entries(files))
      writeFileSync(join(pig, name), annotation(first));
    const pigSplit = join(root, 'split.json');
    writeFileSync(
      pigSplit,
      JSON.stringify({
        splits: { nakamura2020: { train: { pieces: ['031', '032'] }, test: { pieces: ['001'] } } },
      }),
    );
    const pigValidation = join(root, 'validation.json');
    writeFileSync(pigValidation, JSON.stringify({ pieces: ['032'] }));
    return { pig, pigSplit, pigValidation };
  }

  it("reads a piece's annotation files in annotation order, not file name order", () => {
    // Sorted as text, -10 comes before -2; as annotation numbers, -2 comes first.
    const roots = pigRoots({
      '031-1_fingering.txt': 1,
      '031-2_fingering.txt': 2,
      '031-10_fingering.txt': 3,
      '032-1_fingering.txt': 1,
    });
    const piece = loadCorpora({ pigTrain: true }, roots).pieces[0]!;
    expect(piece.id).toBe('031');
    const firstNote = piece.score.notes[0]!.id;
    expect(piece.annotations.map((a) => a[firstNote]?.finger)).toEqual([1, 2, 3]);
  });

  it('records the subset a source was read as, and none for a corpus without subsets', () => {
    const roots = pigRoots({ '031-1_fingering.txt': 1, '032-1_fingering.txt': 1 });
    const train = loadCorpora({ pigTrain: true }, roots).sources[0]!;
    expect(train.subset).toBe('train');
    expect(loadCorpora({ pigValidation: true }, roots).sources[0]!.subset).toBe('validation');
    const textbook = mkdtempSync(join(tmpdir(), 'digitus2-textbook-'));
    writeFileSync(join(textbook, 'scales.json'), '[]');
    writeFileSync(join(textbook, 'arpeggios.json'), '[]');
    writeFileSync(join(textbook, 'chromatic.json'), '[]');
    const source = loadCorpora({ textbook: true }, { textbook }).sources[0]!;
    expect('subset' in source).toBe(false);
  });

  it('refuses a validation list whose pieces are not an array of ids', () => {
    const dir = mkdtempSync(join(tmpdir(), 'digitus2-validation-'));
    const read = (json: unknown) => {
      const file = join(dir, 'v.json');
      writeFileSync(file, JSON.stringify(json));
      return () => readPigValidation(file);
    };
    expect(read({ pieces: ['b', 'a'] })()).toEqual(['a', 'b']);
    expect(read({ pieces: 5 })).toThrow(/expected a "pieces" array of piece ids/);
    expect(read({ pieces: [31, 34] })).toThrow(/expected a "pieces" array of piece ids/);
    expect(read({})).toThrow(/expected a "pieces" array of piece ids/);
  });
});
