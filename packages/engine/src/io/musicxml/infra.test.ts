import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import * as api from '../../index.js';
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

describe('parseXml errors', () => {
  it('reports a recoverable error with the XML parse error prefix and its own message', () => {
    expect(() => parseXml('<a>&nope;</a>')).toThrow('XML parse error: entity not found:&nope;');
  });
  it('reports the first of several errors', () => {
    expect(() => parseXml('<!DOCTYPE a [<!ENTITY e "x">]><a>&e;&e2;</a>')).toThrow(
      'XML parse error: entity not found:&e;',
    );
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

describe('unpackMusicXml encodings', () => {
  const TEXT = PARTWISE.replace('UTF-8', 'UTF-16').replace('Piano', 'Klavier für Anfänger');
  const utf16 = (text: string, littleEndian: boolean, bom = true) => {
    const offset = bom ? 2 : 0;
    const bytes = new Uint8Array(offset + text.length * 2);
    if (bom) bytes.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
    for (let i = 0; i < text.length; i++) {
      const lo = text.charCodeAt(i) & 0xff;
      const hi = text.charCodeAt(i) >> 8;
      bytes[offset + 2 * i] = littleEndian ? lo : hi;
      bytes[offset + 2 * i + 1] = littleEndian ? hi : lo;
    }
    return bytes;
  };
  const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

  it('decodes UTF-16LE with a byte-order mark', () => {
    expect(unpackMusicXml(utf16(TEXT, true))).toBe(TEXT);
  });
  it('decodes UTF-16BE with a byte-order mark', () => {
    expect(unpackMusicXml(utf16(TEXT, false))).toBe(TEXT);
  });
  it('decodes UTF-16 without a byte-order mark from its first character', () => {
    expect(unpackMusicXml(utf16(TEXT, true, false))).toBe(TEXT);
    expect(unpackMusicXml(utf16(TEXT, false, false))).toBe(TEXT);
  });
  it('uses the encoding named in the XML declaration', () => {
    const text = PARTWISE.replace('UTF-8', 'ISO-8859-1').replace('Piano', 'Klavier für Anfänger');
    expect(unpackMusicXml(latin1(text))).toBe(text);
  });
  it('reads an ASCII-compatible file as UTF-8 when its declaration wrongly names UTF-16', () => {
    const text = PARTWISE.replace('UTF-8', 'UTF-16').replace('Piano', 'Klavier für Anfänger');
    expect(unpackMusicXml(new TextEncoder().encode(text))).toBe(text);
  });
  it('falls back to UTF-8 for an unknown declared encoding', () => {
    const text = PARTWISE.replace('UTF-8', 'x-no-such-encoding').replace(
      'Piano',
      'Klavier für Anfänger',
    );
    expect(unpackMusicXml(new TextEncoder().encode(text))).toBe(text);
  });
  it('decodes the rootfile of an mxl archive by its own encoding', () => {
    const zip = zipSync({ 'piece.musicxml': utf16(TEXT, true) });
    expect(unpackMusicXml(zip)).toBe(TEXT);
  });
});

describe('package exports', () => {
  it('exports timewiseToPartwise from the package entry point', () => {
    expect(api.timewiseToPartwise).toBe(timewiseToPartwise);
    const out = api.timewiseToPartwise(parseXml(TIMEWISE));
    expect(out.documentElement!.tagName).toBe('score-partwise');
  });
  it('keeps the xmldom helpers internal', () => {
    expect('parseXml' in api).toBe(false);
    expect('serializeXml' in api).toBe(false);
    expect('childElements' in api).toBe(false);
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
    const names = childElements(childElements(root, 'part-list')[0]!, 'score-part').map((p) =>
      childText(p, 'part-name'),
    );
    expect(names).toEqual(['Piano', 'Left']);
    const parts = childElements(root, 'part');
    expect(parts.map((p) => p.getAttribute('id'))).toEqual(['P1', 'P2']);
    const p1Measures = childElements(parts[0]!, 'measure');
    expect(p1Measures.map((m) => m.getAttribute('number'))).toEqual(['1', '2']);
    expect(childText(childElements(p1Measures[1]!, 'note')[0]!, 'duration')).toBe('1');
  });
});
