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
    'linke Hand',
    'Piano droit',
    'Piano gauche',
    'main gauche',
    'mano izquierda',
    'Mano destra',
    'Klavier links',
    'Flügel rechts',
    'Piano derecho',
    'Piano izquierdo',
    'Piano direito',
    'Piano esquerdo',
    'Pista 1',
    'Piste 1',
    'Spoor 1',
    'Faixa 1',
    'Spur 1',
    'Traccia 1',
    'Sin título',
    'Sans titre',
    'Sem título',
    'Zonder titel',
    'Senza titolo',
    'Ohne Titel',
    'Partitura sin título',
    'Partition sans titre',
    'Partitura sem título',
    'Partituur zonder titel',
    'Unbenannte Partitur',
    'Piano 2',
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
  it.each([
    'Träumerei',
    'Kinderszenen: Träumerei',
    'Für Elise',
    'Les étoiles d’or',
    'Sans Souci',
    'Spur der Steine',
  ])('treats %j as a title', (name) => {
    expect(isGenericName(name)).toBe(false);
  });
});

describe('cleanFileTitle', () => {
  it.each([
    ['SchumannOp15No07', 'Schumann Op. 15 No. 7'],
    ['Nocturne-in-C-Minor-Opus-48-Nr-1', 'Nocturne in C Minor Opus 48 Nr. 1'],
    ['chopin_nocturne_op9_n2', 'chopin nocturne Op. 9 No. 2'],
    ['K545-3', 'K545 3'],
    ['Dr Dre - Still Dre', 'Dr Dre - Still Dre'],
    ['twinkle', 'twinkle'],
    ['Twinkle', 'Twinkle'],
    ['K.545', 'K.545'],
    ['J.S.Bach-Minuet', 'J.S.Bach Minuet'],
    ['BWV846', 'BWV 846'],
    ['bwv846', 'bwv 846'],
  ])('%j reads %j', (stem, title) => {
    expect(cleanFileTitle(stem)).toBe(title);
  });
  // Real file names of the Mutopia Project's MIDI files (https://www.mutopiaproject.org/).
  it.each([
    ['diabeli.op163.s1-1', 'diabeli Op. 163 s1 1'],
    ['diabeli.op149.2', 'diabeli Op. 149 2'],
    ['Scriabin_prelude_op11no1', 'Scriabin prelude Op. 11 No. 1'],
    ['LVB_Sonate_02no1_2', 'LVB Sonate 02 No. 1 2'],
    ['Les_Etoiles_dOr_No1', 'Les Etoiles dOr No. 1'],
    ['Czerny_Op_821_No_001', 'Czerny Op. 821 No. 1'],
    ['Mazurka-Op33-No1', 'Mazurka Op. 33 No. 1'],
    ['rach-prelude23-01', 'rach prelude 23 01'],
    ['sonata1', 'sonata 1'],
    ['KV331_3_RondoAllaTurca', 'KV331 3 Rondo Alla Turca'],
    ['AveMaria-PianoViolin', 'Ave Maria Piano Violin'],
    ['schumann-op68-36-chant-de-marins-italiens', 'schumann Op. 68 36 chant de marins italiens'],
    ['op149-9', 'Op. 149 9'],
    ['25EF-01', '25 EF 01'],
  ])('reads the Mutopia file name %j as %j', (stem, title) => {
    expect(cleanFileTitle(stem)).toBe(title);
  });
  it('reads Op and No with a full stop or no space, in a name with spaces too', () => {
    expect(cleanFileTitle('Nocturne Op.9 No.2')).toBe('Nocturne Op. 9 No. 2');
  });
  it('returns the original when nothing is left', () => {
    expect(cleanFileTitle('___')).toBe('___');
  });
});
