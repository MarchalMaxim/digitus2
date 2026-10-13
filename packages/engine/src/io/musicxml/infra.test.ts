import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { childElements, childText, parseXml, serializeXml } from './dom.js';
import { timewiseToPartwise } from './timewise.js';
import { unpackMusicXml } from './unpack.js';

const PARTWISE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;

const TIMEWISE = `<?xml version="1.0" encoding="UTF-8"?>
<score-timewise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part><score-part id="P2"><part-name>Left</part-name></score-part></part-list>
<measure number="1"><part id="P1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></part><part id="P2"><note><rest/><duration>1</duration></note></part></measure>
<measure number="2"><part id="P1"><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note></part><part id="P2"><note><rest/><duration>1</duration></note></part></measure>
</score-timewise>`;

describe('dom helpers', () => {
  it('parses, navigates and serializes', () => {
    const doc = parseXml(PARTWISE);
    const root = doc.documentElement!;
    expect(root.tagName).toBe('score-partwise');
    const parts = childElements(root, 'part');
    expect(parts).toHaveLength(1);
    const measure = childElements(parts[0]!, 'measure')[0]!;
    expect(childText(childElements(measure, 'attributes')[0]!, 'divisions')).toBe('1');
    expect(serializeXml(doc)).toContain('<score-partwise');
  });
  it('throws on malformed XML', () => {
    expect(() => parseXml('<score-partwise><part></score-partwise>')).toThrow();
  });
});

describe('unpackMusicXml', () => {
  it('returns text unchanged and strips a BOM', () => {
    expect(unpackMusicXml('﻿<a/>')).toBe('<a/>');
    expect(unpackMusicXml(new TextEncoder().encode('﻿<a/>'))).toBe('<a/>');
  });
  it('unzips an mxl using the container rootfile, even in a subfolder', () => {
    const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="scores/piece.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
    const zip = zipSync({
      'META-INF/container.xml': strToU8(container),
      'scores/piece.xml': strToU8(PARTWISE),
      'scores/other.xml': strToU8('<wrong/>'),
    });
    expect(unpackMusicXml(zip)).toBe(PARTWISE);
  });
  it('falls back to the first xml entry without a container', () => {
    const zip = zipSync({ 'piece.musicxml': strToU8(PARTWISE) });
    expect(unpackMusicXml(zip)).toBe(PARTWISE);
  });
});

describe('timewiseToPartwise', () => {
  it('returns partwise documents untouched', () => {
    const doc = parseXml(PARTWISE);
    expect(timewiseToPartwise(doc)).toBe(doc);
  });
  it('regroups measures under parts', () => {
    const out = timewiseToPartwise(parseXml(TIMEWISE));
    const root = out.documentElement!;
    expect(root.tagName).toBe('score-partwise');
    expect(childElements(root, 'part-list')).toHaveLength(1);
    const parts = childElements(root, 'part');
    expect(parts.map((p) => p.getAttribute('id'))).toEqual(['P1', 'P2']);
    const p1Measures = childElements(parts[0]!, 'measure');
    expect(p1Measures.map((m) => m.getAttribute('number'))).toEqual(['1', '2']);
    expect(childText(childElements(p1Measures[1]!, 'note')[0]!, 'duration')).toBe('1');
  });
});
