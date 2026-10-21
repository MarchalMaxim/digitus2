import { expect, it } from 'vitest';
import { verovioOptions } from './options.js';

it('engraves paper with fixed width and height independent of the phone viewport', () => {
  const paper = verovioOptions(390, 'print');
  expect(paper.pageWidth).toBe(1900);
  expect(paper.pageHeight).toBe(2420);
  expect(paper.adjustPageHeight).toBe(false);
  expect(paper.pageWidth).not.toBe(verovioOptions(390).pageWidth);
});
