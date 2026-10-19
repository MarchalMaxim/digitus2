import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../src/io/musicxml/read.js';
import type { InsertedNote } from '../src/embellish/embellish.js';
import { formatEmbellishScorecard, runEmbellishGate } from './embellish.js';
import { readLibraryScore } from './libraryScore.js';
import { main } from './run.js';
import type { CliIo } from './run.js';

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, out, err };
}

const content = (rel: string) => fileURLToPath(new URL(`../../../content/${rel}`, import.meta.url));
const twinkle = content('scores/twinkle-twinkle-little-star.musicxml');
const handel = content('scores/handel-aylesford-minuet-d-minor.musicxml');
const tmp = () => mkdtempSync(join(tmpdir(), 'digitus2-embellish-'));

interface Entry {
  slug: string;
  level: number;
  tempoBpm: number;
  files: { score: string; fingered: string | null };
}
const manifest = () => JSON.parse(readFileSync(content('manifest.json'), 'utf8')) as Entry[];

describe('digitus2 embellish <file>', () => {
  it('writes the light embellishment of Twinkle', () => {
    const out = join(tmp(), 'twinkle.musicxml');
    const c = capture();
    expect(main(['embellish', twinkle, '--out', out], c.io)).toBe(0);
    expect(c.out).toEqual([]);
    expect(c.err.join('')).toBe('light: 6 notes added\n');
    expect(parseMusicXml(readFileSync(out, 'utf8')).score.notes).toHaveLength(70);
  });

  it('writes to stdout without --out', () => {
    const c = capture();
    expect(main(['embellish', twinkle], c.io)).toBe(0);
    expect(c.out.join('')).toMatch(/<score-partwise/);
  });

  it('reports a refusal and writes nothing', () => {
    const out = join(tmp(), 'handel.musicxml');
    const c = capture();
    expect(main(['embellish', handel, '--out', out], c.io)).toBe(1);
    expect(c.err.join('')).toMatch(/^digitus2: refused: the melody voice plays chords/);
    expect(c.out).toEqual([]);
    expect(() => readFileSync(out)).toThrow();
  });

  it('takes light as the only density', () => {
    const c = capture();
    expect(main(['embellish', twinkle, '--density', 'playful'], c.io)).toBe(2);
    expect(c.err.join('')).toContain('--density must be one of light');
    expect(main(['embellish', twinkle, '--density', 'light', '--out', join(tmp(), 'x')])).toBe(0);
  });

  it('runs the guard and writes the inserted notes', () => {
    const dir = tmp();
    const inserted = join(dir, 'inserted.json');
    const c = capture();
    expect(
      main(
        ['embellish', twinkle, '--guard', '--inserted', inserted, '--out', join(dir, 'x')],
        c.io,
      ),
    ).toBe(0);
    const records = JSON.parse(readFileSync(inserted, 'utf8')) as InsertedNote[];
    expect(records).toHaveLength(6);
    expect(Object.keys(records[0]!).sort()).toEqual(
      ['bar', 'beat', 'length', 'measureIndex', 'midi', 'onset', 'pitch', 'role', 'rule'].sort(),
    );
  }, 30_000);

  it('takes either a file or --library', () => {
    expect(main(['embellish'], capture().io)).toBe(2);
    expect(main(['embellish', twinkle, '--library', 'm.json'], capture().io)).toBe(2);
  });

  it('reads an archive score through gzip', () => {
    const gz = manifest().find(
      (e) => (e.level === 1 || e.level === 2) && e.files.score.endsWith('.musicxml.gz'),
    )!;
    expect(gz).toBeDefined();
    const text = readLibraryScore(content(gz.files.score));
    expect(text.startsWith('<?xml') || text.startsWith('<score-partwise')).toBe(true);
  });
});

describe('digitus2 embellish --library', () => {
  /** A manifest of Twinkle and Mary with absolute score paths, and a floor file. */
  function twoPieces(offeredMin: number) {
    const dir = tmp();
    const entries = manifest()
      .filter(
        (e) => e.slug === 'twinkle-twinkle-little-star' || e.slug === 'mary-had-a-little-lamb',
      )
      .map((e) => ({ ...e, files: { ...e.files, score: content(e.files.score) } }));
    expect(entries).toHaveLength(2);
    const library = join(dir, 'manifest.json');
    writeFileSync(library, JSON.stringify(entries));
    const floor = join(dir, 'floor.json');
    writeFileSync(floor, JSON.stringify({ embellish: { offeredMin } }));
    return { dir, library, floor };
  }

  it('offers Twinkle and counts Mary under fewer than three figures', () => {
    const f = twoPieces(1);
    const out = join(f.dir, 'runs', 'card.json');
    const { scorecard, failures } = runEmbellishGate({ library: f.library, floor: f.floor, out });
    expect(failures).toEqual([]);
    expect(scorecard.pieces).toBe(2);
    expect(scorecard.offered).toBe(1);
    expect(scorecard.tooFew).toBe(1);
    expect(scorecard.refused).toBe(0);
    expect(scorecard.guardRefused).toBe(0);
    expect(scorecard.figures).toBe(6);
    expect(scorecard.passing + scorecard.neighbour).toBe(6);
    const mary = scorecard.rows.find((r) => r.slug === 'mary-had-a-little-lamb')!;
    expect(mary.offered).toBe(false);
    expect(mary.reason).toMatch(/figures? \(at least 3\)$/);
    const twinkleRow = scorecard.rows.find((r) => r.slug === 'twinkle-twinkle-little-star')!;
    expect(twinkleRow).toMatchObject({ offered: true, figures: 6, droppedBars: [], plainLevel: 1 });
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ offered: 1, pieces: 2 });
    expect(formatEmbellishScorecard(scorecard)).toMatch(/offered 1 of 2/);
  }, 60_000);

  it('fails below the floor, and on a missing floor file', () => {
    const f = twoPieces(2);
    const { failures } = runEmbellishGate({ library: f.library, floor: f.floor });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/offered 1 < 2/);
    const c = capture();
    expect(main(['embellish', '--library', f.library, '--floor', f.floor], c.io)).toBe(1);
    expect(c.err.join('')).toContain('floor breach: offered 1 < 2');
    const missing = capture();
    expect(
      main(['embellish', '--library', f.library, '--floor', join(f.dir, 'none.json')], missing.io),
    ).toBe(1);
    expect(missing.err.join('')).toMatch(/floor file not found/);
  }, 60_000);

  it('prints the scorecard as JSON with --json', () => {
    const f = twoPieces(1);
    const c = capture();
    expect(main(['embellish', '--library', f.library, '--levels', '1', '--json'], c.io)).toBe(0);
    expect(JSON.parse(c.out.join(''))).toMatchObject({ pieces: 2, offered: 1, levels: [1] });
    expect(main(['embellish', '--library', f.library, '--levels', '1,x'], capture().io)).toBe(2);
  }, 60_000);
});
