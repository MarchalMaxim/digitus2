import { describe, expect, it } from 'vitest';
import { cleanFileTitle, decodeMetaText, isGenericName } from './title.js';

/** The text midi-file hands over: one character per byte (Latin-1). */
const asBytes = (bytes: number[]) => String.fromCharCode(...bytes);
const utf8 = (s: string) => asBytes([...new TextEncoder().encode(s)]);

describe('decodeMetaText', () => {
  it('reads UTF-8 bytes back into text', () => {
    expect(decodeMetaText(utf8('Träumerei'))).toBe('Träumerei');
  });
  it('keeps Latin-1 text that is not valid UTF-8', () => {
    expect(decodeMetaText(asBytes([0x46, 0xfc, 0x72, 0x20, 0x45, 0x6c, 0x69, 0x73, 0x65]))).toBe(
      'Für Elise',
    );
  });
  it('reads UTF-16 with a byte order mark, either way round', () => {
    const be = asBytes([0xfe, 0xff, 0x00, 0x4c, 0x00, 0xe9, 0x00, 0x73]);
    const le = asBytes([0xff, 0xfe, 0x4c, 0x00, 0xe9, 0x00, 0x73, 0x00]);
    expect(decodeMetaText(be)).toBe('Lés');
    expect(decodeMetaText(le)).toBe('Lés');
  });
  it('strips NULs and trims', () => {
    expect(decodeMetaText('  Etude\0 ')).toBe('Etude');
  });
});

describe('isGenericName', () => {
  it.each([
    'Piano',
    'Track 1',
    'Track 0',
    'Untitled',
    'Acoustic Grand Piano',
    'A.PIANO 1',
    'GS/RESET',
    'control track',
    'Conductor',
    'Staff_pfUpper',
    'up:',
    'down',
    'RH',
    'Klavier',
    'Flügel',
    'mano derecha',
    'main droite',
    'rechte Hand',
    'Untitled score',
    'Copyright © 2004 X',
    'Creator: GNU LilyPond 2.6.4',
    'Sequenced by J. Smith',
    '',
    '   ',
    '1234',
    'x'.repeat(81),
  ])('treats %j as no title', (name) => {
    expect(isGenericName(name)).toBe(true);
  });
  it.each(['Träumerei', 'Kinderszenen: Träumerei', 'Für Elise', 'Les étoiles d’or'])(
    'treats %j as a title',
    (name) => {
      expect(isGenericName(name)).toBe(false);
    },
  );
});

describe('cleanFileTitle', () => {
  it.each([
    ['SchumannOp15No07', 'Schumann Op. 15 No. 7'],
    ['Nocturne-in-C-Minor-Opus-48-Nr-1', 'Nocturne in C Minor Opus 48 Nr. 1'],
    ['chopin_nocturne_op9_n2', 'chopin nocturne Op. 9 n2'],
    ['K545-3', 'K545 3'],
    ['Dr Dre - Still Dre', 'Dr Dre - Still Dre'],
    ['twinkle', 'twinkle'],
    ['Twinkle', 'Twinkle'],
  ])('%j reads %j', (stem, title) => {
    expect(cleanFileTitle(stem)).toBe(title);
  });
  it('returns the original when nothing is left', () => {
    expect(cleanFileTitle('___')).toBe('___');
  });
});
