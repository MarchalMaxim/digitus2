// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The scan states what it read, never how far to trust it (issue 158): no accuracy disclaimer in
 * the app's texts in any language, nor in the scanning guide.
 */
const files = [
  ['en', './en/scan.ts'],
  ['fr', './fr/scan.ts'],
  ['nl', './nl/scan.ts'],
  ['es', './es/scan.ts'],
  ['pt', './pt/scan.ts'],
  ['docs/scanning.md', '../../../../docs/scanning.md'],
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
  it.each(files)('%s is read whole', (name, path) => {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(text.length, `${name} is empty or the path is wrong`).toBeGreaterThan(1000);
    expect(text).toContain(name === 'docs/scanning.md' ? '# Scanning' : 'useForFingerings');
  });

  it.each(files)('%s has none', (name, path) => {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8').toLowerCase();
    for (const phrase of phrases)
      expect(text.includes(phrase), `${name} says "${phrase}"`).toBe(false);
  });
});
