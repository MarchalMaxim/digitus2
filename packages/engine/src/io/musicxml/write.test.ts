import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './read.js';
import { injectFingerings } from './write.js';

const xml = readFileSync(
  fileURLToPath(new URL('../../../fixtures/two-staff.musicxml', import.meta.url)),
  'utf8',
);

describe('injectFingerings', () => {
  const { score } = parseMusicXml(xml);

  it('adds fingerings that the reader gets back, on tie starts only', () => {
    const out = injectFingerings(xml, score, {
      n1: { finger: 2, source: 'engine' },
      n3: { finger: 4, source: 'engine' },
      n4: { finger: 5, source: 'engine' },
    });
    const { editorial } = parseMusicXml(out);
    expect(editorial['n0']).toEqual({ finger: 1, source: 'editorial' });
    expect(editorial['n1']).toEqual({ finger: 2, source: 'editorial' });
    expect(editorial['n3']).toEqual({ finger: 4, source: 'editorial' });
    expect(editorial['n4']).toEqual({ finger: 5, source: 'editorial' });
    expect(Object.keys(editorial).sort()).toEqual(['n0', 'n1', 'n3', 'n4']);
    const fingerings = out.match(/<fingering[^>]*>/g) ?? [];
    expect(fingerings).toHaveLength(4);
    expect(out).toContain('<fingering placement="above">2</fingering>');
    expect(out).toContain('<fingering placement="below">5</fingering>');
  });
  it('replaces an existing fingering by default and keeps it on request', () => {
    const replaced = injectFingerings(xml, score, { n0: { finger: 3, source: 'user' } });
    expect(parseMusicXml(replaced).editorial['n0']!.finger).toBe(3);
    expect((replaced.match(/<fingering[^>]*>/g) ?? []).length).toBe(1);
    const kept = injectFingerings(
      xml,
      score,
      { n0: { finger: 3, source: 'user' } },
      { replace: false },
    );
    expect((kept.match(/<fingering[^>]*>/g) ?? []).length).toBe(2);
  });
  it('leaves the bare notes without a digit, the file own one removed', () => {
    const out = injectFingerings(
      xml,
      score,
      { n0: { finger: 3, source: 'engine' }, n1: { finger: 2, source: 'engine' } },
      { bare: new Set(['n0']) },
    );
    const { editorial } = parseMusicXml(out);
    expect(Object.keys(editorial)).toEqual(['n1']);
    expect((out.match(/<fingering[^>]*>/g) ?? []).length).toBe(1);
  });
  it('writes substitutions as a second fingering element', () => {
    const out = injectFingerings(xml, score, {
      n1: { finger: 3, substitution: 1, source: 'engine' },
    });
    expect(out).toContain(
      '<fingering placement="above">3</fingering><fingering placement="above" substitution="yes">1</fingering>',
    );
  });
  it('preserves the rest of the document and the declaration', () => {
    const out = injectFingerings(xml, score, { n1: { finger: 2, source: 'engine' } });
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(out).toContain('<work-title>Fixture</work-title>');
    expect(out).toContain('<per-minute>90</per-minute>');
    expect(out).toContain('<backup><duration>8</duration></backup>');
  });
  it('puts notations before lyrics', () => {
    const withLyric = `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><lyric><text>la</text></lyric></note></measure></part></score-partwise>`;
    const parsed = parseMusicXml(withLyric);
    const out = injectFingerings(withLyric, parsed.score, { n0: { finger: 1, source: 'engine' } });
    expect(out.indexOf('<notations>')).toBeLessThan(out.indexOf('<lyric>'));
  });
});
