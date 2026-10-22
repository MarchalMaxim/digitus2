import { parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { joinScanPages } from './join.js';

function page(divisions = 4, step = 'C', part = 'P1') {
  return `<score-partwise version="4.0"><part-list><score-part id="${part}"><part-name>Piano</part-name><score-instrument id="${part}-I"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="${part}-I"><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="${part}"><measure number="1"><attributes><divisions>${divisions}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><note id="n1"><pitch><step>${step}</step><octave>4</octave></pitch><duration>${divisions}</duration><voice>1</voice><type>quarter</type><staff>1</staff><instrument id="${part}-I"/></note><forward><duration>${divisions}</duration></forward><backup><duration>${divisions * 2}</duration></backup><note id="n2"><pitch><step>C</step><octave>3</octave></pitch><duration>${divisions * 2}</duration><voice>2</voice><type>half</type><staff>2</staff></note></measure></part></score-partwise>`;
}

describe('joining separately recognized pages', () => {
  it('keeps divisions, voices, backup/forward timing and ordered pitches across pages', () => {
    const xml = joinScanPages([page(4), page(12, 'D', 'random-id')]);
    const { score } = parseMusicXml(xml, { preserveNotation: true });
    expect(score.notes.map((n) => [n.midi, n.onsetTick, n.offsetTick - n.onsetTick])).toEqual([
      [60, 0, 12],
      [48, 0, 24],
      [62, 24, 12],
      [48, 24, 24],
    ]);
    expect(xml).toContain('<divisions>12</divisions>');
    expect(new DOMParser().parseFromString(xml, 'text/xml').querySelectorAll('part')).toHaveLength(
      1,
    );
  });
  it('retains page-start key/time/clefs, numbers measures continuously and namespaces note IDs', () => {
    const xml = joinScanPages([page(), page().replace('<fifths>0', '<fifths>2')]);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    expect([...doc.querySelectorAll('measure')].map((m) => m.getAttribute('number'))).toEqual([
      '1',
      '2',
    ]);
    const ids = [...doc.querySelectorAll('note')].map((n) => n.id);
    expect(new Set(ids).size).toBe(4);
    expect([...doc.querySelectorAll('key fifths')].map((n) => n.textContent)).toEqual(['0', '2']);
    expect([...doc.querySelectorAll('instrument')].map((n) => n.id)).toEqual([
      'page1-P1-I',
      'page1-P1-I',
    ]);
  });
  it('preserves single-file output byte for byte', () => {
    expect(joinScanPages([page()])).toBe(page());
  });
  it('accepts HOMR-style split initial attributes without altering raw page files', () => {
    const split = page().replace(
      '</staves><clef',
      '</staves><part-symbol top-staff="1" bottom-staff="2">brace</part-symbol></attributes><attributes><clef',
    );
    expect(
      parseMusicXml(joinScanPages([split, split]), { preserveNotation: true }).score.notes,
    ).toHaveLength(4);
    expect(split).toContain('</attributes><attributes>');
  });
  it('keeps multiple matching parts in their own order and aligns page boundaries', () => {
    const secondPart =
      '<part id="P2"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes><note id="bass"><pitch><step>E</step><octave>2</octave></pitch><duration>8</duration><type>half</type></note></measure></part>';
    const twoParts = page()
      .replace(
        '</part-list>',
        '<score-part id="P2"><part-name>Bass</part-name></score-part></part-list>',
      )
      .replace('</score-partwise>', secondPart + '</score-partwise>');
    const xml = joinScanPages([twoParts, twoParts]);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    expect(
      [...doc.querySelectorAll('part')].map((part) => part.querySelectorAll('measure').length),
    ).toEqual([2, 2]);
    const bass = parseMusicXml(xml, { preserveNotation: true }).score.notes.filter(
      (n) => n.midi === 40,
    );
    expect(bass.map((n) => [n.staff, n.onsetTick, n.offsetTick])).toEqual([
      [3, 0, 8],
      [3, 8, 16],
    ]);
  });
  it('preserves matching cross-page sounding ties and isolates graphic slur endpoints', () => {
    const first = page().replace(
      '</duration>',
      '</duration><tie type="start"/><notations><slur type="start" number="1"/></notations>',
    );
    const second = page().replace(
      '</duration>',
      '</duration><tie type="stop"/><notations><slur type="stop" number="1"/></notations>',
    );
    // A tie must continue immediately, so use the two-beat bass rather than the one-beat treble.
    const start = first
      .replace('<duration>4</duration><tie', '<duration>8</duration><tie')
      .replace('<forward><duration>4</duration></forward>', '');
    const xml = joinScanPages([start, second]);
    expect(parseMusicXml(xml, { preserveNotation: true }).score.notes).toHaveLength(3);
    expect(new DOMParser().parseFromString(xml, 'text/xml').querySelectorAll('slur')).toHaveLength(
      2,
    );
    expect(
      [...new DOMParser().parseFromString(xml, 'text/xml').querySelectorAll('slur')].map((slur) =>
        slur.getAttribute('number'),
      ),
    ).toEqual(['1', '2']);
  });
  it('retains existing orphan/duplicate graphic endpoints without creating links between pages', () => {
    const graphic = page().replace(
      '</note>',
      '<notations><slur type="stop" number="1"/><slur type="start" number="2"/><slur type="start" number="2"/></notations></note>',
    );
    const doc = new DOMParser().parseFromString(joinScanPages([graphic, graphic]), 'text/xml');
    expect(
      [...doc.querySelectorAll('slur')].map((slur) => [
        slur.getAttribute('type'),
        slur.getAttribute('number'),
      ]),
    ).toEqual([
      ['stop', '1'],
      ['start', '2'],
      ['start', '2'],
      ['stop', '3'],
      ['start', '4'],
      ['start', '4'],
    ]);
  });
  it('refuses graphic-number exhaustion instead of writing invalid MusicXML', () => {
    const graphic = page().replace(
      '</note>',
      '<notations><slur type="start" number="1"/></notations></note>',
    );
    expect(() => joinScanPages(Array.from({ length: 17 }, () => graphic))).toThrow('16');
  });
  it.each([
    ['part layout', page().replace('<part-name>Piano', '<part-name>Violin')],
    ['staff layout', page().replace('<staves>2', '<staves>1')],
    ['attributes', page().replace('<divisions>4</divisions>', '')],
    ['attributes', page().replace('<key><fifths>0</fifths></key>', '')],
    [
      'navigation',
      page().replace('</measure>', '<barline><repeat direction="backward"/></barline></measure>'),
    ],
    ['IDs', page().replace('id="n2"', 'id="n1"')],
    [
      'instrument reference',
      page().replace('<instrument id="P1-I"/>', '<instrument id="unknown"/>'),
    ],
    ['instrument change', page().replace('<midi-program>1', '<midi-program>42')],
    [
      'inherited transpose',
      page().replace(
        '</attributes>',
        '<transpose><chromatic>2</chromatic></transpose></attributes>',
      ),
    ],
  ])('refuses unsupported %s rather than silently changing notation', (_kind, xml) => {
    expect(() => joinScanPages([page(), xml])).toThrow();
  });
  it('joins a page whose notes do not fit together, leaving the refusal to the strict import', () => {
    // The joined file is what the review corrects; it is never made to look valid.
    const broken = page().replace('<duration>4</duration>', '<duration>0</duration>');
    const xml = joinScanPages([page(), broken]);
    expect(xml).toContain('<duration>0</duration>');
    expect(() => parseMusicXml(xml, { preserveNotation: true })).toThrow();
  });
  it('refuses a part without measures, naming the measure counts', () => {
    const empty = page().replace(/<measure[\s\S]*<\/measure>/, '');
    expect(() => joinScanPages([page(), empty])).toThrow(/measure counts/);
  });
  it('refuses parts of one page that hold different numbers of measures', () => {
    const measure =
      '<measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>E</step><octave>2</octave></pitch><duration>16</duration><type>whole</type></note></measure>';
    const uneven = page()
      .replace(
        '</part-list>',
        '<score-part id="P2"><part-name>Bass</part-name></score-part></part-list>',
      )
      .replace(
        '</score-partwise>',
        `<part id="P2">${measure}${measure.replace('"1"', '"2"')}</part></score-partwise>`,
      );
    expect(() => joinScanPages([uneven, uneven])).toThrow(/measure counts/);
  });
});

/**
 * Issue 152: the owner's last page, as homr read it: a treble and a bass staff as two parts named
 * "Voice", in different time units, each with homr's split opening attributes.
 */
function splitPage() {
  const voice = (id: string) =>
    `<score-part id="${id}"><part-name>Voice</part-name><score-instrument id="${id}-I1"><instrument-name>Voice</instrument-name></score-instrument><midi-instrument id="${id}-I1"><midi-program>54</midi-program></midi-instrument></score-part>`;
  const opening = (divisions: number, sign: string, line: number) =>
    `<attributes><divisions>${divisions}</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><attributes><clef number="1"><sign>${sign}</sign><line>${line}</line></clef><key><fifths>0</fifths></key></attributes>`;
  const note = (step: string, octave: number, duration: number, type: string) =>
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><type>${type}</type><voice>1</voice><staff>1</staff><notations /></note>`;
  const upper = [
    `<measure number="1">${opening(4, 'G', 2)}${note('C', 5, 8, 'half')}${note('A', 4, 8, 'half')}</measure>`,
    `<measure number="2">${note('E', 4, 16, 'whole')}</measure>`,
  ];
  const lower = [
    `<measure number="1">${opening(2, 'F', 4)}${note('A', 2, 8, 'whole')}</measure>`,
    `<measure number="2">${note('E', 2, 4, 'half')}${note('A', 2, 4, 'half')}</measure>`,
  ];
  return `<score-partwise version="4.0"><part-list>${voice('P1')}${voice('P2')}</part-list><part id="P1">${upper.join('')}</part><part id="P2">${lower.join('')}</part></score-partwise>`;
}

describe('issue 152: a page read as a treble part and a bass part', () => {
  it('joins the piano pages, every note at its own pitch, time and staff', () => {
    const xml = joinScanPages([page(), splitPage()]);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    expect(doc.querySelectorAll('part')).toHaveLength(1);
    expect(doc.querySelector('part-name')?.textContent).toBe('Piano');
    const { score } = parseMusicXml(xml, { preserveNotation: true });
    // In quarters of 4 ticks. The first page's measure is a half note long; the split page's
    // treble and bass then start together on each of its bars, the bass on the lower staff.
    const notes = score.notes.map((n) => [
      n.midi,
      n.onsetTick,
      n.offsetTick - n.onsetTick,
      n.staff,
    ]);
    expect(notes).toEqual([
      [60, 0, 4, 1],
      [48, 0, 8, 2],
      [72, 8, 8, 1],
      [45, 8, 16, 2],
      [69, 16, 8, 1],
      [64, 24, 16, 1],
      [40, 24, 8, 2],
      [45, 32, 8, 2],
    ]);
  });
  it('declares the second staff in the first opening attributes when the split page leads', () => {
    // Issue 156: Verovio reads the staff count from the first measure's first <attributes> only.
    const xml = joinScanPages([splitPage(), page()]);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const opening = [...doc.querySelector('part > measure')!.children].filter(
      (child) => child.tagName === 'attributes',
    );
    expect(opening.length).toBeGreaterThan(1);
    expect(opening[0]!.querySelector('staves')?.textContent).toBe('2');
    expect(opening.slice(1).flatMap((a) => [...a.querySelectorAll('staves')])).toEqual([]);
    // After divisions and time, before the clefs, as the schema orders them.
    expect([...opening[0]!.children].map((child) => child.tagName)).toEqual([
      'divisions',
      'time',
      'staves',
    ]);
    const { score } = parseMusicXml(xml, { preserveNotation: true });
    expect(new Set(score.notes.map((n) => n.staff))).toEqual(new Set([1, 2]));
  });
  it('leaves a batch of split pages, and a split page alone, as they were', () => {
    expect(joinScanPages([splitPage()])).toBe(splitPage());
    const xml = joinScanPages([splitPage(), splitPage()]);
    expect(new DOMParser().parseFromString(xml, 'text/xml').querySelectorAll('part')).toHaveLength(
      2,
    );
  });
  it('still refuses split parts that hold different numbers of measures', () => {
    const uneven = splitPage().replace(
      /<measure number="2">(?:(?!<\/measure>)[\s\S])*<\/measure><\/part><\/score-partwise>/,
      '</part></score-partwise>',
    );
    expect(() => joinScanPages([page(), uneven])).toThrow();
  });
});
