import { expect, it } from 'vitest';
import { bucket } from '../useScoreDocument.js';
import { scaleForWidth, verovioOptions } from './options.js';

it('engraves paper with fixed width and height independent of the phone viewport', () => {
  const paper = verovioOptions(390, 'print');
  expect(paper.pageWidth).toBe(1900);
  expect(paper.pageHeight).toBe(2420);
  expect(paper.adjustPageHeight).toBe(false);
  expect(paper.pageWidth).not.toBe(verovioOptions(390).pageWidth);
});

it.each([
  [328, 40],
  [361, 40],
  [398, 40],
  [719, 40],
  [720, 46],
  [736, 46],
  [832, 46],
  [879, 46],
  [880, 50],
  [992, 50],
  [1040, 54],
  [1199, 54],
  [1200, 56],
  [1472, 56],
  [3000, 56],
])('scaleForWidth(%i) is %i', (w, s) => expect(scaleForWidth(w)).toBe(s));

it('keeps a phone exactly as before', () => {
  const o = verovioOptions(361);
  expect(o.scale).toBe(40);
  expect(o.pageWidth).toBe(903);
});

it('fits the page to the column at the larger scale', () => {
  const o = verovioOptions(992);
  expect(o.scale).toBe(50);
  expect(o.pageWidth).toBe(1984);
});

it('prints at 40 whatever the width', () => {
  const o = verovioOptions(1472, 'print');
  expect(o.scale).toBe(40);
  expect(o.pageWidth).toBe(1900);
});

it('never shrinks as the column grows, and changes only between layout buckets', () => {
  for (let w = 200; w <= 3000; w++) {
    expect(scaleForWidth(w + 1)).toBeGreaterThanOrEqual(scaleForWidth(w));
    expect(scaleForWidth(w)).toBe(scaleForWidth(bucket(w)));
  }
});
