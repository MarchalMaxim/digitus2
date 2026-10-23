import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  accepts,
  buildIndex,
  corruptSequences,
  cutPages,
  matchSequences,
  mulberry32,
  pitchSequences,
  sameWork,
  shingles,
  workOf,
} from './piece-match.mjs';

const repo = resolve(import.meta.dirname, '../..');
const E = await import(pathToFileURL(resolve(repo, 'packages/engine/dist/src/index.js')).href);

const SLUGS = [
  'bach-invention-no13-bwv-784',
  'bach-invention-no1-bwv-772',
  'bach-invention-no8-bwv-779',
  'twinkle-twinkle-little-star',
  'ode-to-joy',
  'bach-minuet-g-major-bwv-anh-114',
  'chopin-waltz-op69-no2',
];
const INV13 = 'bach-invention-no13-bwv-784';

const parseFile = (path) => E.parseMusicXml(new Uint8Array(readFileSync(path))).score;
const lib = SLUGS.map((slug) => ({
  slug,
  sequences: pitchSequences(parseFile(resolve(repo, 'content/scores', `${slug}.musicxml`))),
}));
const inv13 = lib.find((e) => e.slug === INV13).sequences;
// A second edition of the same work: nothing in a match may count it as a competitor.
const index = buildIndex([...lib, { slug: 'inv13-copy', sequences: inv13 }]);
const pages = cutPages(inv13, 8).filter((p) => shingles(p).size >= 20);

const note = (midi, hand, onsetTick, measureIndex = 0, isGrace = false) => ({
  midi,
  hand,
  onsetTick,
  measureIndex,
  isGrace,
});

test('pitchSequences keeps the top right-hand note, the bottom left-hand note, and drops graces', () => {
  const seqs = pitchSequences({
    notes: [
      note(60, 'R', 0),
      note(64, 'R', 0),
      note(70, 'R', 0, 0, true),
      note(48, 'L', 0),
      note(43, 'L', 0),
    ],
  });
  assert.deepEqual(seqs.R, [{ pc: 4, measure: 0 }]);
  assert.deepEqual(seqs.L, [{ pc: 7, measure: 0 }]);
});

test('shingles are 8 consecutive pitch classes of one hand', () => {
  const run = Array.from({ length: 10 }, (_, pc) => ({ pc, measure: 0 }));
  const set = shingles({ R: run, L: [] });
  assert.equal(set.size, 3);
  assert.ok(set.has('01234567'));
  assert.equal(shingles({ R: run.slice(0, 5), L: run.slice(0, 5) }).size, 0);
});

test('pages of Invention 13 find it with a wide margin', () => {
  assert.ok(pages.length >= 2);
  for (const page of pages) {
    const result = matchSequences(index, page);
    assert.equal(result.best.slug, INV13);
    assert.ok(result.margin >= 0.8, `margin ${result.margin}`);
  }
});

test('corruptSequences leaves everything at rate 0 and touches every element at rate 1', () => {
  const source = {
    R: Array.from({ length: 300 }, (_, i) => ({ pc: i % 12, measure: i })),
    L: Array.from({ length: 300 }, (_, i) => ({ pc: (i * 5) % 12, measure: i })),
  };
  assert.deepEqual(corruptSequences(source, 0, mulberry32(1)), source);
  const out = corruptSequences(source, 1, mulberry32(1));
  const kinds = new Set();
  for (const hand of ['R', 'L']) {
    for (const original of source[hand]) {
      const same = out[hand].filter((e) => e.measure === original.measure);
      if (same.length === 0) kinds.add('drop');
      else if (same.length === 1) {
        assert.notEqual(same[0].pc, original.pc, 'an element passed through unchanged');
        kinds.add('shift');
      } else {
        assert.equal(same.length, 2);
        assert.equal(same[0].pc, original.pc);
        kinds.add('insert');
      }
    }
  }
  assert.deepEqual([...kinds].sort(), ['drop', 'insert', 'shift']);
  assert.deepEqual(
    corruptSequences(source, 0.3, mulberry32(7)),
    corruptSequences(source, 0.3, mulberry32(7)),
  );
  assert.notDeepEqual(
    corruptSequences(source, 0.3, mulberry32(7)),
    corruptSequences(source, 0.3, mulberry32(8)),
  );
});

test('a few corrupted pitches still find Invention 13 and are accepted', () => {
  const rng = mulberry32(166);
  let lowered = 0;
  for (const page of pages) {
    const corrupted = corruptSequences(page, 0.05, rng);
    assert.notDeepEqual(corrupted, page);
    const result = matchSequences(index, corrupted);
    assert.equal(accepts(result), true);
    assert.ok(workOf(index, index.slugs.indexOf(INV13)).has(result.best.slug));
    if (result.best.score < 1) lowered++;
  }
  assert.ok(lowered >= 1, 'the corruption never reached the match score');
});

test('with the whole work left out nothing is accepted', () => {
  const work = workOf(index, index.slugs.indexOf(INV13));
  for (const page of pages) {
    const result = matchSequences(index, page, { exclude: work });
    assert.ok(!work.has(result.best?.slug));
    assert.equal(accepts(result), false);
  }
});

test('a second edition of the same work is no competitor: it joins the work and the margin stays wide', () => {
  const i13 = index.slugs.indexOf(INV13);
  const work = workOf(index, i13);
  assert.ok(work.has(INV13) && work.has('inv13-copy'));
  assert.equal(work.size, 2);
  for (const page of pages) {
    const result = matchSequences(index, page);
    assert.ok(result.margin >= 0.8, `margin ${result.margin}`);
    assert.equal(accepts(matchSequences(index, page, { exclude: work })), false);
  }
});

test('the owner page 2 recognition finds Invention 13', () => {
  const score = parseFile(resolve(repo, 'apps/web/fixtures/scan/owner-page-2.musicxml'));
  const result = matchSequences(index, pitchSequences(score));
  assert.equal(result.best.slug, INV13);
  assert.ok(result.best.score > 0.9, `score ${result.best.score}`);
});

test('empty sequences match nothing', () => {
  const result = matchSequences(index, { R: [], L: [] });
  assert.equal(result.best, null);
  assert.equal(result.margin, 0);
  assert.equal(accepts(result), false);
});

test('sameWork holds for a piece with itself and not across two inventions', () => {
  const i13 = index.slugs.indexOf(INV13);
  const i1 = index.slugs.indexOf('bach-invention-no1-bwv-772');
  assert.equal(sameWork(index, i13, i13), true);
  assert.equal(sameWork(index, i1, i13), false);
});
