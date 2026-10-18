import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './read.js';

const note = (step: string, extra = '', duration = 4) =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration>${extra}</note>`;
const sign = '<notations><ornaments><trill-mark/></ornaments></notations>';
const measure = (body: string, number = 1) => `<measure number="${number}">${body}</measure>`;
const attributes = '<attributes><divisions>4</divisions></attributes>';
const xml = (parts: string[]) =>
  `<score-partwise><part-list>${parts.map((_, i) => `<score-part id="P${i}"><part-name>Piano</part-name></score-part>`).join('')}</part-list>${parts.map((body, i) => `<part id="P${i}">${body}</part>`).join('')}</score-partwise>`;

describe('scan notation preservation with ornaments', () => {
  it('preserves duplicate source events while normal import transfers the ornament to the unison', () => {
    const source = xml([
      measure(
        attributes +
          note('C', '<voice>1</voice>') +
          '<backup><duration>4</duration></backup>' +
          note('C', `<voice>2</voice>${sign}`),
      ),
    ]);
    const preserved = parseMusicXml(source, { preserveNotation: true });
    expect(preserved.warnings).toEqual([]);
    expect(preserved.score.notes.map((n) => n.sourceIndices)).toEqual([[0], [1]]);
    expect(preserved.score.notes[0]?.ornament).toBeUndefined();
    expect(preserved.score.notes[1]?.ornament).toMatchObject({ kind: 'trill-mark', endTick: 4 });
    const imported = parseMusicXml(source);
    expect(imported.score.notes).toHaveLength(1);
    expect(imported.score.notes[0]?.ornament).toEqual(preserved.score.notes[1]?.ornament);
  });

  it('resolves staff-specific key signatures within their part despite global scan staff IDs', () => {
    const source = xml([
      measure(attributes + '<note><rest/><duration>4</duration></note>'),
      measure(
        '<attributes><divisions>4</divisions><staves>2</staves><key number="1"><fifths>1</fifths></key><key number="2"><fifths>-1</fifths></key></attributes>' +
          note('E', `<staff>1</staff>${sign}`) +
          '<backup><duration>4</duration></backup>' +
          note('A', `<staff>2</staff>${sign}`),
      ),
    ]);
    const { score, warnings } = parseMusicXml(source, { preserveNotation: true });
    expect(warnings).toEqual([]);
    expect(score.notes.map((n) => n.staff)).toEqual([2, 3]);
    expect(score.notes.map((n) => n.ornament?.upperMidi)).toEqual([66, 70]);
  });

  it('retains the source ornament duration after final measure remapping and tie merging', () => {
    const source = xml([
      measure(attributes + note('D')) +
        measure(note('C', `<tie type="start"/>${sign}`), 2) +
        measure(note('C', '<tie type="stop"/>'), 3),
      measure(attributes + '<note><rest/><duration>8</duration></note>') +
        measure('<note><rest/><duration>4</duration></note>', 2) +
        measure('<note><rest/><duration>4</duration></note>', 3),
    ]);
    const { score, warnings } = parseMusicXml(source, { preserveNotation: true });
    expect(warnings).toEqual([]);
    expect(score.notes[1]).toMatchObject({
      onsetTick: 8,
      offsetTick: 16,
      sourceIndices: [1, 2],
      ornament: { endTick: 12, endSec: 1.5 },
    });
  });

  it('still rejects invalid recognized timing on an ornamented note', () => {
    const source = xml([
      measure(attributes + note('C', sign).replace('<duration>4</duration>', '')),
    ]);
    expect(() => parseMusicXml(source, { preserveNotation: true })).toThrow(
      /cannot preserve notation: note 0: invalid or missing duration/,
    );
  });

  it('rejects a missing or empty octave and an invalid step instead of guessing a pitch', () => {
    const pitched = (pitch: string) =>
      xml([measure(attributes + `<note><pitch>${pitch}</pitch><duration>4</duration></note>`)]);
    const bad = [
      '<step>C</step>',
      '<step>C</step><octave></octave>',
      '<step>H</step><octave>4</octave>',
      '<step>c</step><octave>4</octave>',
      '<octave>4</octave>',
    ];
    for (const pitch of bad) {
      expect(() => parseMusicXml(pitched(pitch), { preserveNotation: true })).toThrow(
        /cannot preserve notation: note 0: invalid or missing pitch step\/octave/,
      );
    }
  });

  it('rejects a staves or staff value of zero', () => {
    const withStaves = (staves: string, staff = '') =>
      xml([
        measure(
          `<attributes><divisions>4</divisions><staves>${staves}</staves></attributes>` +
            note('C', staff),
        ),
      ]);
    expect(() => parseMusicXml(withStaves('0'), { preserveNotation: true })).toThrow(
      /staves must be a positive safe integer/,
    );
    expect(() =>
      parseMusicXml(withStaves('1', '<staff>0</staff>'), { preserveNotation: true }),
    ).toThrow(/staff must be a positive safe integer/);
  });

  it('keeps a note tied across three measures as one note and accepts its contiguous joins', () => {
    const source = xml([
      measure(attributes + note('C', '<tie type="start"/>', 16)) +
        measure(note('C', '<tie type="stop"/><tie type="start"/>', 16), 2) +
        measure(note('C', '<tie type="stop"/>', 16), 3),
    ]);
    const { score, warnings } = parseMusicXml(source, { preserveNotation: true });
    expect(warnings).toEqual([]);
    expect(score.notes).toHaveLength(1);
    expect(score.notes[0]).toMatchObject({
      onsetTick: 0,
      offsetTick: 48,
      sourceIndices: [0, 1, 2],
    });
  });
});
