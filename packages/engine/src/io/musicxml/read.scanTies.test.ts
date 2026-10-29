import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './read.js';

// Issue 233: a scan import reads a tie it cannot join as separate presses and says which.
const scan = { preserveNotation: true, tolerateScanTies: true };
const strict = { preserveNotation: true };
const xml = (measures: string) => `<score-partwise version="4.0"><part-list>
  <score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">${measures}</part></score-partwise>`;
const measure = (notes: string, number = 1) => `<measure number="${number}">
  <attributes><divisions>4</divisions></attributes>${notes}</measure>`;
const note = (step: string, duration: number, extra = '', octave = 4) => `<note>${extra}
  <pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration>
  <voice>1</voice></note>`;
const rest = (duration: number) => `<note><rest/><duration>${duration}</duration></note>`;
const multipart = (...parts: string[]) => `<score-partwise version="4.0"><part-list>
  ${parts.map((_, i) => `<score-part id="P${i}"><part-name>Piano</part-name></score-part>`).join('')}
  </part-list>${parts.map((body, i) => `<part id="P${i}">${body}</part>`).join('')}
  </score-partwise>`;
const start = '<tie type="start"/>';
const stop = '<tie type="stop"/>';
const spans = (xmlText: string) =>
  parseMusicXml(xmlText, scan).score.notes.map((n) => [n.onsetTick, n.offsetTick, n.sourceIndices]);

describe('parseMusicXml tolerateScanTies', () => {
  it('reads a tie whose continuation begins after a gap as two presses', () => {
    const input = xml(measure(note('C', 4, start) + rest(4) + note('C', 4, stop)));
    expect(() => parseMusicXml(input, strict)).toThrow(/contiguous/);
    expect(spans(input)).toEqual([
      [0, 4, [0]],
      [8, 12, [2]],
    ]);
    expect(parseMusicXml(input, scan).tieRepairs).toEqual([
      { note: 0, part: 0, measure: 0, reason: 'gap' },
    ]);
  });

  it('finds a gap that only a later part reveals, and names the tied part and bar', () => {
    const input = multipart(
      measure(note('C', 4, start)) + measure(note('C', 4, stop), 2),
      measure(note('E', 8)) + measure(note('E', 4), 2),
    );
    const parsed = parseMusicXml(input, scan);
    expect(parsed.score.notes.filter((n) => n.midi === 60).map((n) => n.offsetTick)).toEqual([
      4, 12,
    ]);
    expect(parsed.tieRepairs).toEqual([{ note: 0, part: 0, measure: 0, reason: 'gap' }]);
  });

  it('breaks only the gapped segment of a chain', () => {
    const input = xml(
      measure(note('C', 4, start)) +
        measure(note('C', 2, stop + start) + rest(2), 2) +
        measure(note('C', 4, stop), 3),
    );
    expect(spans(input)).toEqual([
      [0, 6, [0, 1]],
      [8, 12, [3]],
    ]);
    expect(parseMusicXml(input, scan).tieRepairs).toEqual([
      { note: 1, part: 0, measure: 1, reason: 'gap' },
    ]);
  });

  it('reads a tie stop without a start as a plain note', () => {
    const input = xml(measure(note('C', 4) + note('D', 4, stop)));
    expect(() => parseMusicXml(input, strict)).toThrow(/tie stop without a start/);
    expect(spans(input)).toEqual([
      [0, 4, [0]],
      [4, 8, [1]],
    ]);
    expect(parseMusicXml(input, scan).tieRepairs).toEqual([
      { note: 1, part: 0, measure: 0, reason: 'unmatchedStop' },
    ]);
  });

  it('reads a tie start that never closes as a plain note of its own length', () => {
    const input = xml(measure(note('C', 4)) + measure(note('D', 4, start), 2));
    expect(() => parseMusicXml(input, strict)).toThrow(/never closed/);
    expect(spans(input)).toEqual([
      [0, 4, [0]],
      [4, 8, [1]],
    ]);
    expect(parseMusicXml(input, scan).tieRepairs).toEqual([
      { note: 1, part: 0, measure: 1, reason: 'unmatchedStart' },
    ]);
  });

  it('closes the earlier start as unmatched when a second start replaces it', () => {
    const input = xml(
      measure(note('C', 4, start) + note('C', 4, `<chord/>${start}`) + note('C', 4, stop)),
    );
    expect(() => parseMusicXml(input, strict)).toThrow(/tie already open/);
    expect(spans(input)).toEqual([
      [0, 4, [0]],
      [0, 8, [1, 2]],
    ]);
    expect(parseMusicXml(input, scan).tieRepairs).toEqual([
      { note: 0, part: 0, measure: 0, reason: 'unmatchedStart' },
    ]);
  });

  it.each([
    ['after a gap', 4],
    ['right before its main note', 0],
  ])('reads a grace note tied to a main note %s as two presses', (_, before) => {
    const input = xml(
      measure(
        (before ? rest(before) : '') +
          note('C', 0, `<grace/>${start}`, 5) +
          (before ? rest(before) : '') +
          note('C', 2, stop, 5),
      ),
    );
    const parsed = parseMusicXml(input, scan);
    expect(parsed.score.notes.map((n) => [n.isGrace, n.onsetTick, n.offsetTick])).toEqual([
      [true, before, before],
      [false, 2 * before, 2 * before + 2],
    ]);
    const grace = before ? 1 : 0;
    expect(parsed.tieRepairs).toEqual([{ note: grace, part: 0, measure: 0, reason: 'grace' }]);
  });

  it('reads a main note tied to a grace note as two presses, named by the main note', () => {
    const input = xml(measure(note('C', 4, start) + note('C', 0, `<grace/>${stop}`)));
    expect(parseMusicXml(input, scan).score.notes).toHaveLength(2);
    expect(parseMusicXml(input, scan).tieRepairs).toEqual([
      { note: 0, part: 0, measure: 0, reason: 'grace' },
    ]);
  });

  it('still joins a good tie, and repairs nothing', () => {
    const input = xml(
      measure(note('C', 4, start)) +
        measure(note('C', 4, stop + start), 2) +
        measure(note('C', 4, stop), 3),
    );
    const parsed = parseMusicXml(input, scan);
    expect(parsed.score).toEqual(parseMusicXml(input, strict).score);
    expect(spans(input)).toEqual([[0, 12, [0, 1, 2]]]);
    expect(parsed.tieRepairs).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it('carries no repairs without the option', () => {
    const input = xml(measure(note('C', 4) + note('D', 4, stop)));
    expect(parseMusicXml(input).tieRepairs).toEqual([]);
    expect(parseMusicXml(input).warnings).toEqual([expect.stringContaining('tie stop')]);
  });
});

describe('parseMusicXml strict refusals name their place', () => {
  const second = (notes: string) => xml(measure(note('C', 4), 11) + measure(notes, 12));

  it.each([
    [
      'a tie gap',
      second(note('C', 4, start) + rest(4) + note('C', 4, stop)),
      'note 1: tie segments must be contiguous across final measure boundaries, tied to note 3 (part 1, bar 12)',
    ],
    [
      'a tie stop without a start',
      second(note('C', 4, stop)),
      'note 1: tie stop without a start (part 1, bar 12)',
    ],
    ['an unclosed tie', second(note('C', 4, start)), 'note 1: tie never closed (part 1, bar 12)'],
    [
      'a second open tie',
      second(note('C', 4, start) + note('C', 4, `<chord/>${start}`)),
      'note 2: tie already open for this staff, voice and pitch (part 1, bar 12)',
    ],
    [
      'an invalid duration',
      second(note('C', 0)),
      'note 1: invalid or missing duration (part 1, bar 12)',
    ],
    [
      'a missing pitch',
      second('<note><pitch><step>H</step><octave>4</octave></pitch><duration>4</duration></note>'),
      'note 1: invalid or missing pitch step/octave (part 1, bar 12)',
    ],
    [
      'an alter outside -2..2',
      second(
        '<note><pitch><step>C</step><alter>3</alter><octave>4</octave></pitch><duration>4</duration></note>',
      ),
      'note 1: alter 3 outside -2..2, skipped (part 1, bar 12)',
    ],
    [
      'a backup',
      second('<backup><duration>0</duration></backup>'),
      'backup: invalid or missing duration (part 1, bar 12)',
    ],
    [
      'invalid divisions',
      xml(
        measure(note('C', 4), 11) +
          '<measure number="12"><attributes><divisions>0</divisions></attributes></measure>',
      ),
      'divisions must be a positive safe integer (part 1, bar 12)',
    ],
    [
      'an invalid staff',
      second(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><staff>0</staff></note>',
      ),
      'staff must be a positive safe integer (part 1, bar 12)',
    ],
    [
      'a note above the piano',
      second(note('C', 4, '', 9)),
      'midi 120 outside piano range (part 1, bar 12)',
    ],
  ])('%s', (_, input, message) => {
    expect(() => parseMusicXml(input, strict)).toThrow(message);
  });
});
