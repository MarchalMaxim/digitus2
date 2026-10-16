import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './read.js';
import { injectFingerings } from './write.js';

const note = (pitch: string, ornament = '', more = '') =>
  `<note><pitch>${pitch}</pitch><duration>4</duration><voice>1</voice><type>quarter</type>${more}${ornament ? `<notations><ornaments>${ornament}</ornaments></notations>` : ''}</note>`;
const c = '<step>C</step><octave>4</octave>';
const xml = (notes: string, fifths = 0) =>
  `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>4</divisions><key><fifths>${fifths}</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${notes}</measure></part></score-partwise>`;

describe('MusicXML ornaments', () => {
  it('retains a supported sign on a duplicate unison from another voice', () => {
    const source = xml(
      note(c) +
        '<backup><duration>4</duration></backup>' +
        note(c, '<trill-mark/>').replace('<voice>1</voice>', '<voice>2</voice>'),
    );
    const { score } = parseMusicXml(source);
    expect(score.notes).toHaveLength(1);
    expect(score.notes[0]?.id).toBe('n0');
    expect(score.notes[0]?.sourceIndices).toEqual([0]);
    expect(score.notes[0]?.ornament?.kind).toBe('trill-mark');
  });
  it('retains supported signs separately from notes and fingerings', () => {
    const source = xml(note(c, '<inverted-mordent long="yes"/>'));
    const { score } = parseMusicXml(source);
    expect(score.notes).toHaveLength(1);
    expect(score.notes[0]?.ornament).toMatchObject({
      kind: 'inverted-mordent',
      long: true,
      upperMidi: 62,
      lowerMidi: 59,
      endTick: 4,
      endSec: 0.5,
    });
    const out = injectFingerings(source, score, { n0: { finger: 2, source: 'user' } });
    expect(out).toContain('<inverted-mordent long="yes"/>');
    expect(parseMusicXml(out).editorial.n0?.finger).toBe(2);
    expect(parseMusicXml(out).score.notes[0]?.ornament).toEqual(score.notes[0]?.ornament);
  });

  it('resolves a diatonic neighbor from key and explicit ornament accidental', () => {
    const e = '<step>E</step><octave>4</octave>';
    expect(
      parseMusicXml(xml(note(e, '<trill-mark/>'), 1)).score.notes[0]?.ornament?.upperMidi,
    ).toBe(66);
    expect(
      parseMusicXml(
        xml(
          note(e, '<trill-mark/><accidental-mark placement="above">natural</accidental-mark>'),
          1,
        ),
      ).score.notes[0]?.ornament?.upperMidi,
    ).toBe(65);
    expect(
      parseMusicXml(
        xml(note(c, '<mordent/><accidental-mark placement="below">flat</accidental-mark>')),
      ).score.notes[0]?.ornament?.lowerMidi,
    ).toBe(58);
  });

  it('uses earlier same-staff octave accidentals, resetting at the barline', () => {
    const d = '<step>D</step><alter>1</alter><octave>4</octave>';
    const source = xml(note(d, '', '<accidental>sharp</accidental>') + note(c, '<trill-mark/>'));
    expect(parseMusicXml(source).score.notes[1]?.ornament?.upperMidi).toBe(63);
    const nextBar = source.replace(
      '</measure>',
      `</measure><measure number="2">${note(c, '<trill-mark/>')}</measure>`,
    );
    expect(parseMusicXml(nextBar).score.notes[2]?.ornament?.upperMidi).toBe(62);
  });

  it('keeps source ornament duration when ties merge, including a tempo change', () => {
    const source = xml(
      note(c, '<mordent/>', '<tie type="start"/>') +
        '<direction><sound tempo="60"/></direction>' +
        note(c, '', '<tie type="stop"/>'),
    );
    const { score } = parseMusicXml(source);
    expect(score.notes).toHaveLength(1);
    expect(score.notes[0]?.offsetSec).toBe(1.5);
    expect(score.notes[0]?.ornament?.endSec).toBe(0.5);
  });

  it('reads explicit playback fields without treating an absent trill-step as a chromatic interval', () => {
    const { score } = parseMusicXml(
      xml(note(c, '<trill-mark start-note="upper" beats="6" trill-step="half"/>')),
    );
    expect(score.notes[0]?.ornament).toMatchObject({ startNote: 'upper', beats: 6, upperMidi: 61 });
  });

  it('does not borrow a neighbor accidental from another octave or staff', () => {
    const d = '<step>D</step><alter>1</alter><octave>5</octave>';
    const source = xml(note(d) + note(c, '<trill-mark/>'));
    expect(parseMusicXml(source).score.notes[1]?.ornament?.upperMidi).toBe(62);
    const sameOctaveOtherStaff = xml(
      note(d.replace('5', '4'), '', '<staff>2</staff>') +
        note(c, '<trill-mark/>', '<staff>1</staff>'),
    );
    expect(parseMusicXml(sameOctaveOtherStaff).score.notes[1]?.ornament?.upperMidi).toBe(62);
  });

  it('keeps unsupported complex or microtonal ornaments as notation without guessing playback', () => {
    for (const ornament of [
      '<trill-mark accelerate="yes"/>',
      '<trill-mark beats="999999"/>',
      '<trill-mark/><accidental-mark>quarter-sharp</accidental-mark>',
    ]) {
      const { score, warnings } = parseMusicXml(xml(note(c, ornament)));
      expect(score.notes[0]?.ornament).toBeUndefined();
      expect(warnings).toEqual([]);
    }
  });

  it('accepts a trill extension line while keeping the realization on the written segment', () => {
    expect(
      parseMusicXml(xml(note(c, '<trill-mark/><wavy-line type="start" number="1"/>'))).score
        .notes[0]?.ornament?.kind,
    ).toBe('trill-mark');
  });

  it('resets neighbor accidentals on a key change inside a measure', () => {
    const d = '<step>D</step><alter>1</alter><octave>4</octave>';
    const source = xml(
      note(d) +
        '<attributes><key><fifths>-1</fifths></key></attributes>' +
        note(c, '<trill-mark/>'),
    );
    expect(parseMusicXml(source).score.notes[1]?.ornament?.upperMidi).toBe(62);
  });
  it('resolves the active key in musical time after a backup into an earlier voice', () => {
    const g = '<step>G</step><octave>4</octave>';
    const e = '<step>E</step><octave>4</octave>';
    const source = xml(
      note(c) +
        '<attributes><key><fifths>1</fifths></key></attributes>' +
        note(g) +
        '<backup><duration>8</duration></backup>' +
        note(e, '<trill-mark/>').replace('<voice>1</voice>', '<voice>2</voice>'),
    );
    const { score } = parseMusicXml(source);
    expect(score.keySignatures.map((k) => [k.tick, k.fifths])).toEqual([
      [0, 0],
      [4, 1],
    ]);
    expect(score.notes.find((n) => n.ornament)?.ornament?.upperMidi).toBe(65);
  });

  it('finds all thirteen ornaments in the actual Bach BWV856 library source', () => {
    const source = readFileSync(
      new URL(
        '../../../../../content/scores/bulk-bachjs-bwv856-bwv856-praeludium11-bwv856-praeludium11-ly.musicxml',
        import.meta.url,
      ),
      'utf8',
    );
    const ornaments = parseMusicXml(source).score.notes.flatMap((n) =>
      n.ornament ? [n.ornament] : [],
    );
    expect(ornaments).toHaveLength(13);
    expect(ornaments.filter((o) => o.kind === 'inverted-mordent' && o.long)).toHaveLength(10);
    expect(ornaments.filter((o) => o.kind === 'inverted-mordent' && !o.long)).toHaveLength(2);
    expect(ornaments.filter((o) => o.kind === 'trill-mark')).toHaveLength(1);
  });
});
