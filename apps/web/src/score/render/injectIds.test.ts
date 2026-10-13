// @vitest-environment node
import { readFileSync } from 'node:fs';
import { parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { injectNoteIds } from './injectIds.js';

// The spike fixture carries its own 1-based note ids (n1..n72), unlike the engine's 0-based
// ones, so it doubles as an export whose ids must not survive.
const xml = readFileSync(
  new URL('../../../fixtures/short-piano.musicxml', import.meta.url),
  'utf8',
);

describe('injectNoteIds', () => {
  it('gives every sounding note an id on its first source element and keeps the note count', () => {
    const { score } = parseMusicXml(xml);
    const out = injectNoteIds(xml, score);
    expect(out.match(/<note[\s>]/g)!.length).toBe(xml.match(/<note[\s>]/g)!.length);
    for (const n of score.notes) expect(out).toContain(`<note id="${n.id}"`);
  });
  it('replaces a foreign id on a note and is idempotent', () => {
    const { score } = parseMusicXml(xml);
    const once = injectNoteIds(xml, score);
    expect(injectNoteIds(once, score)).toBe(once);
    const first = score.notes.find((n) => n.sourceIndices[0] === 0)!;
    const withId = xml.replace(/<note(\s[^>]*)?>/, '<note id="foreign">');
    const out = injectNoteIds(withId, score);
    expect(out.match(/<note(\s[^>]*)?>/)![0]).toBe(`<note id="${first.id}">`);
    expect(out).toContain('<note id="n0"');
    expect(out).not.toContain('id="foreign"');
  });
  it('leaves every engine id on exactly one note when the input already has note ids', () => {
    const { score } = parseMusicXml(xml);
    const out = injectNoteIds(xml, score);
    for (const n of score.notes) expect(out.split(`id="${n.id}"`)).toHaveLength(2);
    expect(out.match(/<note id="/g)).toHaveLength(score.notes.length);
  });
});
