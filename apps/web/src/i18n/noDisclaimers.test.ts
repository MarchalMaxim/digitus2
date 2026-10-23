// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The scan states what it read, never how far to trust it (issue 158): no accuracy disclaimer in
 * the app's texts in any language, nor in the scanning guide. The same holds for the lines of
 * playing along on a piano (issue 182), in the library and the score view: a connection
 * instruction is not a disclaimer, but the lines never hedge the feature. Each file has an anchor
 * that proves the right file was read whole.
 */
const files = [
  ['en', './en/scan.ts', 'useForFingerings'],
  ['fr', './fr/scan.ts', 'useForFingerings'],
  ['nl', './nl/scan.ts', 'useForFingerings'],
  ['es', './es/scan.ts', 'useForFingerings'],
  ['pt', './pt/scan.ts', 'useForFingerings'],
  ['docs/scanning.md', '../../../../docs/scanning.md', '# Scanning'],
  ['en library', './en/library.ts', 'piano: {'],
  ['fr library', './fr/library.ts', 'piano: {'],
  ['nl library', './nl/library.ts', 'piano: {'],
  ['es library', './es/library.ts', 'piano: {'],
  ['pt library', './pt/library.ts', 'piano: {'],
  ['en score', './en/score.ts', 'playAlongHint'],
  ['fr score', './fr/score.ts', 'playAlongHint'],
  ['nl score', './nl/score.ts', 'playAlongHint'],
  ['es score', './es/score.ts', 'playAlongHint'],
  ['pt score', './pt/score.ts', 'playAlongHint'],
] as const;

const phrases = [
  // en
  'may contain errors',
  'can fail',
  'not certified',
  'not reliable',
  'unreliable',
  'certify',
  'not accurate',
  'may not work',
  // fr
  'peut contenir des erreurs',
  'peuvent échouer',
  'pas garantie exacte',
  'peu fiable',
  // nl
  'kan fouten bevatten',
  'kunnen mislukken',
  'niet gegarandeerd juist',
  'onbetrouwbaar',
  // es
  'puede tener errores',
  'pueden fallar',
  'no está certificado',
  'poco fiable',
  // pt
  'pode ter erros',
  'podem falhar',
  'não é garantido',
  'pouco confiável',
];

describe('no accuracy disclaimers', () => {
  it.each(files)('%s is read whole', (name, path, anchor) => {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(text.length, `${name} is empty or the path is wrong`).toBeGreaterThan(1000);
    expect(text).toContain(anchor);
  });

  it.each(files)('%s has none', (name, path) => {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8').toLowerCase();
    for (const phrase of phrases)
      expect(text.includes(phrase), `${name} says "${phrase}"`).toBe(false);
  });
});
