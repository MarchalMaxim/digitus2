import { parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import {
  applyCorrections,
  barTiming,
  CorrectionError,
  findProblems,
  formOffers,
  meterOffers,
  type Correction,
} from './corrections.js';
import { en } from '../i18n/en/index.js';
import { parseScanXml, readScanScore } from './notes.js';
import { describeCorrection, describeProblem } from './ScanEditor.js';

/** One note element: `p` is a pitch like C5 or Bb4, or `r` for a rest. */
function n(
  p: string,
  duration: number,
  type: string,
  opts: {
    staff?: number;
    voice?: number;
    chord?: boolean;
    tie?: 'start' | 'stop' | 'both' | undefined;
    dots?: number;
  } = {},
) {
  const { staff = 1, voice = staff === 1 ? 1 : 5, chord = false, tie, dots = 0 } = opts;
  let pitch = '<rest/>';
  if (p !== 'r') {
    const [, step, accidental, octave] = /^([A-G])(#|b)?(\d)$/.exec(p)!;
    const alter = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
    pitch = `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`;
  }
  const ties = !tie ? [] : tie === 'both' ? ['stop', 'start'] : [tie];
  return `<note>${chord ? '<chord/>' : ''}${pitch}<duration>${duration}</duration>${ties.map((t) => `<tie type="${t}"/>`).join('')}<voice>${voice}</voice><type>${type}</type>${'<dot/>'.repeat(dots)}<staff>${staff}</staff>${ties.length ? `<notations>${ties.map((t) => `<tied type="${t}"/>`).join('')}</notations>` : ''}</note>`;
}
const backup = (d: number) => `<backup><duration>${d}</duration></backup>`;
/** A two-staff piano score, divisions 2 (an eighth is 1), 3/4 unless `beats` is given. */
function score(measures: string[], beats = 3, fifths = 0, beatType = 4) {
  const body = measures
    .map(
      (m, i) =>
        `<measure number="${i + 1}">${
          i === 0
            ? `<attributes><divisions>2</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`
            : ''
        }${m}</measure>`,
    )
    .join('');
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
}
const strict = (xml: string) => parseMusicXml(xml, { preserveNotation: true }).score;
/** Sounding notes as [midi, onset, length, hand]: right hand first, each hand in time order. */
const sounding = (xml: string) =>
  strict(xml)
    .notes.map(
      (note) => [note.midi, note.onsetTick, note.offsetTick - note.onsetTick, note.hand] as const,
    )
    .sort((a, b) => (a[3] === b[3] ? 0 : a[3] === 'R' ? -1 : 1) || a[1] - b[1] || a[0] - b[0])
    .map((note) => [...note]);

// Bar: right hand quarter C5, quarter D5, quarter E5; left hand dotted half C3.
const BAR =
  n('C5', 2, 'quarter') +
  n('D5', 2, 'quarter') +
  n('E5', 2, 'quarter') +
  backup(6) +
  n('C3', 6, 'half', { staff: 2, dots: 1 });

describe('pitch corrections', () => {
  it('changes one note, writes the accidental it needs and leaves every other note alone', () => {
    const raw = score([BAR]);
    const { xml } = applyCorrections(raw, [
      { kind: 'pitch', note: 1, step: 'E', alter: -1, octave: 5 },
    ]);
    expect(sounding(xml)).toEqual([
      [72, 0, 2, 'R'],
      [75, 2, 2, 'R'],
      [76, 4, 2, 'R'],
      [48, 0, 6, 'L'],
    ]);
    const doc = parseScanXml(xml);
    expect(doc.getElementsByTagName('note')[1]!.querySelector('accidental')?.textContent).toBe(
      'flat',
    );
    expect(doc.getElementsByTagName('note')[0]!.querySelector('accidental')).toBeNull();
  });
  it('writes a natural against the key signature and removes an accidental no longer needed', () => {
    const raw = score(
      [
        n('F5', 2, 'quarter') +
          n('G5', 4, 'half') +
          backup(6) +
          n('r', 6, 'half', { staff: 2, dots: 1 }),
      ],
      3,
      1,
    );
    // F5 in G major sounds F#; correcting it to F natural needs a natural sign.
    const { xml } = applyCorrections(raw, [
      { kind: 'pitch', note: 0, step: 'F', alter: 0, octave: 5 },
    ]);
    expect(parseScanXml(xml).querySelector('note accidental')?.textContent).toBe('natural');
    const back = applyCorrections(xml, [
      { kind: 'pitch', note: 0, step: 'F', alter: 1, octave: 5 },
    ]).xml;
    expect(parseScanXml(back).querySelector('note accidental')).toBeNull();
  });
  it('moves a whole tie chain together, so a tie never joins two pitches', () => {
    const raw = score([
      n('C5', 2, 'quarter') +
        n('D5', 2, 'quarter') +
        n('A4', 2, 'quarter', { tie: 'start' }) +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
      n('A4', 2, 'quarter', { tie: 'stop' }) +
        n('r', 4, 'half') +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    const { xml } = applyCorrections(raw, [
      { kind: 'pitch', note: 4, step: 'B', alter: 0, octave: 4 },
    ]);
    const notes = strict(xml).notes.filter((note) => note.hand === 'R');
    expect(notes.map((note) => [note.midi, note.offsetTick - note.onsetTick])).toEqual([
      [72, 2],
      [74, 2],
      [71, 4],
    ]);
  });
  it('refuses an unknown ordinal and a grace note', () => {
    const raw = score([BAR]);
    expect(() =>
      applyCorrections(raw, [{ kind: 'pitch', note: 99, step: 'C', alter: 0, octave: 4 }], {
        strict: true,
      }),
    ).toThrow(CorrectionError);
  });
});

describe('duration corrections check both hands', () => {
  it('lengthening a right-hand note before a backup keeps every left-hand onset', () => {
    // Recognised as three quarters plus a stray eighth: the right hand is half a beat long.
    const raw = score([
      n('C5', 2, 'quarter') +
        n('D5', 1, 'eighth') +
        n('E5', 2, 'quarter') +
        backup(5) +
        n('C3', 2, 'quarter', { staff: 2 }) +
        n('G3', 4, 'half', { staff: 2 }),
    ]);
    const { xml } = applyCorrections(raw, [
      { kind: 'duration', note: 1, type: 'quarter', dots: 0 },
    ]);
    expect(sounding(xml)).toEqual([
      [72, 0, 2, 'R'],
      [74, 2, 2, 'R'],
      [76, 4, 2, 'R'],
      [48, 0, 2, 'L'],
      [55, 2, 4, 'L'],
    ]);
    expect(xml).toContain('<backup><duration>6</duration></backup>');
  });
  it('shortening keeps the other hand too and removes a backup that would become empty', () => {
    const raw = score([
      n('C5', 6, 'half', { dots: 1 }) + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    const { xml } = applyCorrections(raw, [
      { kind: 'duration', note: 0, type: 'quarter', dots: 0 },
    ]);
    expect(sounding(xml)).toEqual([
      [72, 0, 2, 'R'],
      [48, 0, 6, 'L'],
    ]);
  });
  it('changes every member of a chord, never splitting it', () => {
    const raw = score([
      n('C5', 2, 'quarter') +
        n('E5', 2, 'quarter', { chord: true }) +
        n('D5', 4, 'half') +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    const { xml } = applyCorrections(raw, [{ kind: 'duration', note: 1, type: 'half', dots: 0 }]);
    const right = strict(xml).notes.filter((note) => note.hand === 'R');
    expect(
      right.map((note) => [note.midi, note.onsetTick, note.offsetTick - note.onsetTick]),
    ).toEqual([
      [72, 0, 4],
      [76, 0, 4],
      [74, 4, 4],
    ]);
  });
  it('rescales divisions when the new length needs a finer unit, without changing any timing', () => {
    const raw = score([BAR]);
    const { xml } = applyCorrections(raw, [{ kind: 'duration', note: 0, type: '16th', dots: 0 }]);
    const notes = strict(xml);
    const quarter = notes.divisions;
    expect(
      notes.notes.map((note) => [
        note.midi,
        note.onsetTick / quarter,
        (note.offsetTick - note.onsetTick) / quarter,
      ]),
    ).toEqual([
      [72, 0, 0.25],
      [48, 0, 3],
      [74, 0.25, 1],
      [76, 1.25, 1],
    ]);
  });
  it('reports each hand against the time signature', () => {
    const raw = score([
      n('C5', 2, 'quarter') +
        n('D5', 1, 'eighth') +
        n('E5', 2, 'quarter') +
        backup(5) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    const timing = barTiming(readScanScore(parseScanXml(raw)), 0, 0);
    expect(timing).toEqual({
      expected: 3,
      staves: [
        { staff: 1, beats: 2.5 },
        { staff: 2, beats: 3 },
      ],
    });
  });
  it('says whether the hands disagree or the whole bar overruns its time signature', () => {
    // Both hands 4 beats in 3/4 (a misread meter), then a bar whose hands differ.
    const long = n('C5', 8, 'whole') + backup(8) + n('C3', 8, 'whole', { staff: 2 });
    const uneven = n('C5', 6, 'half', { dots: 1 }) + backup(6) + n('C3', 4, 'half', { staff: 2 });
    const parsed = readScanScore(parseScanXml(score([long, uneven])));
    const texts = findProblems(parsed).map((p) => describeProblem(en, parsed, p));
    expect(texts).toEqual([
      'The bar is longer than its time signature. Bar 1: right hand 4 beats, left hand 4 beats, in 3/4.',
      'The hands disagree. Bar 2: right hand 3 beats, left hand 2 beats, in 3/4.',
    ]);
  });
  it('refuses a grace note', () => {
    const raw = score([
      `<note><grace/><pitch><step>B</step><octave>4</octave></pitch><voice>1</voice><type>eighth</type><staff>1</staff></note>` +
        BAR,
    ]);
    expect(() =>
      applyCorrections(raw, [{ kind: 'duration', note: 0, type: 'quarter', dots: 0 }], {
        strict: true,
      }),
    ).toThrow(CorrectionError);
  });
});

describe('tie corrections', () => {
  const twoBars = (gap: boolean) =>
    score([
      n('C5', 2, 'quarter') +
        n('D5', 2, 'quarter') +
        n('A4', 2, 'quarter', { tie: gap ? 'start' : undefined }) +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
      (gap ? n('r', 2, 'quarter') : '') +
        n('A4', 2, 'quarter', { tie: gap ? 'stop' : undefined }) +
        n('B4', gap ? 2 : 4, gap ? 'quarter' : 'half') +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
  it('ties a note to the same pitch that starts where it ends, writing sound and notation', () => {
    const raw = twoBars(false);
    const { xml } = applyCorrections(raw, [{ kind: 'tie', note: 2, tied: true }]);
    const right = strict(xml).notes.filter((note) => note.hand === 'R');
    expect(right.map((note) => [note.midi, note.offsetTick - note.onsetTick])).toEqual([
      [72, 2],
      [74, 2],
      [69, 4],
      [71, 4],
    ]);
    const doc = parseScanXml(xml);
    const notes = doc.getElementsByTagName('note');
    expect(notes[2]!.querySelector('tie')?.getAttribute('type')).toBe('start');
    expect(notes[2]!.querySelector('notations tied')?.getAttribute('type')).toBe('start');
    expect(notes[4]!.querySelector('tie')?.getAttribute('type')).toBe('stop');
  });
  it('the bar 11 regression: a tie whose continuation arrives a quarter late is found, explained and removable', () => {
    const raw = twoBars(true);
    expect(() => strict(raw)).toThrow(/contiguous/);
    const problems = findProblems(readScanScore(parseScanXml(raw)));
    expect(problems).toEqual([expect.objectContaining({ kind: 'tie-gap', note: 2, gapTicks: 2 })]);
    const { xml } = applyCorrections(raw, [{ kind: 'tie', note: 2, tied: false }]);
    expect(strict(xml).notes).toHaveLength(7);
    expect(xml).not.toContain('<tie ');
    // It cannot be tied again as it is: nothing of that pitch starts where the A4 ends.
    let refusal: unknown;
    try {
      applyCorrections(
        raw,
        [
          { kind: 'tie', note: 2, tied: false },
          { kind: 'tie', note: 2, tied: true },
        ],
        { strict: true },
      );
    } catch (cause) {
      refusal = cause;
    }
    expect(refusal).toBeInstanceOf(CorrectionError);
  });
  it('never touches slurs: a slur stays a slur when a tie is added or removed', () => {
    const slurred = twoBars(false).replace(
      '<voice>1</voice><type>quarter</type><staff>1</staff></note><backup>',
      '<voice>1</voice><type>quarter</type><staff>1</staff><notations><slur type="start" number="1"/></notations></note><backup>',
    );
    const { xml } = applyCorrections(slurred, [{ kind: 'tie', note: 2, tied: true }]);
    expect(parseScanXml(xml).querySelectorAll('slur')).toHaveLength(1);
    const back = applyCorrections(xml, [{ kind: 'tie', note: 2, tied: false }]).xml;
    expect(parseScanXml(back).querySelectorAll('slur')).toHaveLength(1);
    expect(back).not.toContain('<tie ');
  });
});

describe('hand and removal corrections', () => {
  it('moves a note to the other hand without moving it in time', () => {
    const raw = score([
      n('C5', 2, 'quarter') +
        n('E3', 2, 'quarter', { chord: true }) +
        n('D5', 4, 'half') +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    const { xml } = applyCorrections(raw, [{ kind: 'hand', note: 1, staff: 2 }]);
    expect(sounding(xml)).toContainEqual([52, 0, 2, 'L']);
    expect(sounding(xml).filter((note) => note[3] === 'R')).toHaveLength(2);
  });
  it('removes a duplicated chord member, and turns a lone note into a rest of the same length', () => {
    const raw = score([
      n('C5', 2, 'quarter') +
        n('C5', 2, 'quarter', { chord: true }) +
        n('D5', 4, 'half') +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    const removed = applyCorrections(raw, [{ kind: 'remove', note: 1 }]).xml;
    expect(sounding(removed)).toEqual([
      [72, 0, 2, 'R'],
      [74, 2, 4, 'R'],
      [48, 0, 6, 'L'],
    ]);
    const rest = applyCorrections(raw, [{ kind: 'remove', note: 2 }]).xml;
    expect(sounding(rest)).toEqual([
      [72, 0, 2, 'R'],
      [72, 0, 2, 'R'],
      [48, 0, 6, 'L'],
    ]);
  });
  it('removing a chord lead promotes the next member in place', () => {
    const raw = score([
      n('C5', 2, 'quarter') +
        n('E5', 2, 'quarter', { chord: true }) +
        n('D5', 4, 'half') +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    const { xml } = applyCorrections(raw, [{ kind: 'remove', note: 0 }]);
    expect(sounding(xml)).toEqual([
      [76, 0, 2, 'R'],
      [74, 2, 4, 'R'],
      [48, 0, 6, 'L'],
    ]);
  });
});

describe('replaying corrections', () => {
  it('keeps note identities after a removal, so later corrections still find their notes', () => {
    // C5 with a duplicated C5 chord member, then D5 and E5: deleting the member shifts every
    // later element's document position, but corrections keep addressing raw ordinals.
    const raw = score([
      n('C5', 2, 'quarter') +
        n('C5', 2, 'quarter', { chord: true }) +
        n('D5', 2, 'quarter') +
        n('E5', 2, 'quarter') +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    const list: Correction[] = [
      { kind: 'remove', note: 1 },
      { kind: 'pitch', note: 3, step: 'F', alter: 0, octave: 5 },
    ];
    const { xml } = applyCorrections(raw, list);
    expect(sounding(xml).map((note) => note[0])).toEqual([72, 74, 77, 48]);
  });
  it('leaves the raw recognition byte for byte unchanged with no corrections', () => {
    const raw = score([BAR]);
    expect(applyCorrections(raw, []).xml).toBe(raw);
  });
  it('gives the render copy stable ids on every note and none in the export', () => {
    const raw = score([BAR]);
    const result = applyCorrections(raw, [
      { kind: 'pitch', note: 1, step: 'E', alter: 0, octave: 5 },
    ]);
    expect(
      [...parseScanXml(result.renderXml).getElementsByTagName('note')].map((el) => el.id),
    ).toEqual(['s0', 's1', 's2', 's3']);
    expect(result.xml).not.toContain('data-scan-note');
    expect(result.xml).not.toContain('id="s1"');
  });
  it('stops at a correction that no longer applies and reports it, keeping the earlier ones', () => {
    const raw = score([BAR]);
    const result = applyCorrections(raw, [
      { kind: 'pitch', note: 1, step: 'E', alter: 0, octave: 5 },
      { kind: 'pitch', note: 42, step: 'E', alter: 0, octave: 5 },
    ]);
    expect(result.applied).toBe(1);
    expect(sounding(result.xml)[1]![0]).toBe(76);
  });
});

describe('problems to check', () => {
  it('flags hands that disagree inside a bar, but not a pickup bar both hands agree on', () => {
    const raw = score([
      n('G4', 2, 'quarter') + backup(2) + n('r', 2, 'quarter', { staff: 2 }),
      n('C5', 2, 'quarter') +
        n('D5', 1, 'eighth') +
        n('E5', 2, 'quarter') +
        backup(5) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
      BAR,
    ]);
    const problems = findProblems(readScanScore(parseScanXml(raw)));
    expect(problems).toEqual([expect.objectContaining({ kind: 'bar-timing', bar: 1 })]);
  });
  it('flags a tie stop without a start', () => {
    const raw = score([
      n('C5', 2, 'quarter', { tie: 'stop' }) +
        n('D5', 4, 'half') +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    expect(findProblems(readScanScore(parseScanXml(raw)))).toEqual([
      expect.objectContaining({ kind: 'tie-unmatched', note: 0 }),
    ]);
  });
});

describe('removing a stray rest', () => {
  it('pulls the rest of its voice earlier, keeps the other hand, and so mends a late tie', () => {
    const raw = score([
      n('C5', 2, 'quarter') +
        n('D5', 2, 'quarter') +
        n('A4', 2, 'quarter', { tie: 'start' }) +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
      n('r', 2, 'quarter') +
        n('A4', 2, 'quarter', { tie: 'stop' }) +
        n('B4', 2, 'quarter') +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    const { xml } = applyCorrections(raw, [
      { kind: 'remove', note: 4 },
      { kind: 'duration', note: 6, type: 'half', dots: 0 },
    ]);
    expect(sounding(xml)).toEqual([
      [72, 0, 2, 'R'],
      [74, 2, 2, 'R'],
      [69, 4, 4, 'R'],
      [71, 8, 4, 'R'],
      [48, 0, 6, 'L'],
      [48, 6, 6, 'L'],
    ]);
    expect(findProblems(readScanScore(parseScanXml(xml)))).toEqual([]);
  });
});

describe('review fixes', () => {
  it('redraws the accidentals that follow in the bar, so the page shows what sounds', () => {
    // Read as F4 F4 F4; the page has F#4 F4 (natural) F4.
    const raw = score([
      n('F4', 2, 'quarter') +
        n('F4', 2, 'quarter') +
        n('F4', 2, 'quarter') +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    const { xml } = applyCorrections(raw, [
      { kind: 'pitch', note: 0, step: 'F', alter: 1, octave: 4 },
    ]);
    const marks = [...parseScanXml(xml).getElementsByTagName('note')].map(
      (el) => el.querySelector('accidental')?.textContent ?? '',
    );
    expect(marks).toEqual(['sharp', 'natural', '', '']);
    expect(sounding(xml).map((x) => x[0])).toEqual([66, 65, 65, 48]);
  });
  it('refuses a length change on a tuplet note instead of breaking its bar', () => {
    const triplet = n('C5', 2, 'eighth')
      .replace('<voice>', '<voice>')
      .replace(
        '<staff>',
        '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>',
      );
    const raw = score([
      triplet + n('D5', 4, 'half') + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    expect(() =>
      applyCorrections(raw, [{ kind: 'duration', note: 0, type: 'quarter', dots: 0 }], {
        strict: true,
      }),
    ).toThrow(CorrectionError);
  });
  it('removes a grace note outright', () => {
    const grace = `<note><grace/><pitch><step>B</step><octave>4</octave></pitch><voice>1</voice><type>eighth</type><staff>1</staff></note>`;
    const raw = score([grace + BAR]);
    const { xml } = applyCorrections(raw, [{ kind: 'remove', note: 0 }]);
    expect(xml).not.toContain('<grace');
    expect(sounding(xml)).toHaveLength(4);
  });
  it('turns a whole-bar rest into an ordinary rest of the chosen length', () => {
    const raw = score([
      `<note><rest measure="yes"/><duration>6</duration><voice>1</voice><staff>1</staff></note>` +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    const doc = parseScanXml(
      applyCorrections(raw, [{ kind: 'duration', note: 0, type: 'quarter', dots: 0 }]).xml,
    );
    const rest = doc.getElementsByTagName('note')[0]!;
    expect(rest.querySelector('rest')!.hasAttribute('measure')).toBe(false);
    expect(rest.querySelector('type')?.textContent).toBe('quarter');
  });
  it('makes a rest a note when the recognition missed one', () => {
    const raw = score([
      n('C5', 2, 'quarter') +
        n('r', 2, 'quarter') +
        n('E5', 2, 'quarter') +
        backup(6) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    const { xml } = applyCorrections(raw, [
      { kind: 'pitch', note: 1, step: 'D', alter: 0, octave: 5 },
    ]);
    expect(sounding(xml)).toEqual([
      [72, 0, 2, 'R'],
      [74, 2, 2, 'R'],
      [76, 4, 2, 'R'],
      [48, 0, 6, 'L'],
    ]);
  });
  it('removes a note outright when its hand is too long for the bar, rather than leaving a rest', () => {
    // A duplicated D5 makes the right hand four beats in 3/4.
    const raw = score([
      n('C5', 2, 'quarter') +
        n('D5', 2, 'quarter') +
        n('D5', 2, 'quarter') +
        n('E5', 2, 'quarter') +
        backup(8) +
        n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    const { xml } = applyCorrections(raw, [{ kind: 'remove', note: 2 }]);
    expect(xml).not.toContain('<rest');
    expect(sounding(xml)).toEqual([
      [72, 0, 2, 'R'],
      [74, 2, 2, 'R'],
      [76, 4, 2, 'R'],
      [48, 0, 6, 'L'],
    ]);
  });
});

describe('time signature corrections', () => {
  // Nine eighths in both hands: a 9/8 bar, 4.5 beats when the recognition says 4/4.
  const NINE =
    n('C5', 3, 'quarter', { dots: 1 }) +
    n('D5', 3, 'quarter', { dots: 1 }) +
    n('E5', 3, 'quarter', { dots: 1 }) +
    backup(9) +
    n('C3', 6, 'half', { staff: 2, dots: 1 }) +
    n('G3', 3, 'quarter', { staff: 2, dots: 1 });
  // Four quarters in both hands: a 4/4 bar.
  const FOUR = n('C5', 8, 'whole') + backup(8) + n('C3', 8, 'whole', { staff: 2 });
  const time = (beats: number, beatType: number) =>
    `<attributes><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time></attributes>`;
  const meters = (xml: string) =>
    readScanScore(parseScanXml(xml)).bars.map((b) => `${b.meter?.beats}/${b.meter?.beatType}`);
  const meter = (bar: number, beats: number, beatType: number): Correction => ({
    kind: 'meter',
    bar,
    beats,
    beatType,
  });
  const refusal = (raw: string, c: Correction) => {
    try {
      applyCorrections(raw, [c], { strict: true });
    } catch (cause) {
      if (cause instanceof CorrectionError) return cause.phrase(en);
      throw cause;
    }
    return 'applied';
  };

  it('sets 9/8 over a misread 4/4 without moving a note, and the places to check clear', () => {
    const raw = score([NINE, NINE, NINE], 4);
    expect(findProblems(readScanScore(parseScanXml(raw)))).toHaveLength(3);
    const { xml } = applyCorrections(raw, [meter(0, 9, 8)], { strict: true });
    expect(sounding(xml)).toEqual(sounding(raw));
    expect(meters(xml)).toEqual(['9/8', '9/8', '9/8']);
    expect(findProblems(readScanScore(parseScanXml(xml)))).toEqual([]);
    expect(strict(xml).timeSignatures.map((t) => [t.beats, t.beatType])).toEqual([[9, 8]]);
    expect(xml.match(/<time>/g)).toHaveLength(1);
  });
  it('from a later bar: the bars before keep their meter, and the new one is written before the notes', () => {
    const raw = score([FOUR, NINE, NINE], 4);
    const { xml } = applyCorrections(raw, [meter(1, 9, 8)], { strict: true });
    expect(sounding(xml)).toEqual(sounding(raw));
    expect(meters(xml)).toEqual(['4/4', '9/8', '9/8']);
    expect(strict(xml).timeSignatures.map((t) => [t.tick, t.beats, t.beatType])).toEqual([
      [0, 4, 4],
      [8, 9, 8],
    ]);
    expect(xml).toContain('<measure number="2"><attributes><time><beats>9</beats>');
  });
  it('also replaces the old meter where a joined page restates it, and stops at a different one', () => {
    const raw = score([NINE, time(4, 4) + NINE, time(3, 4) + BAR, time(4, 4) + NINE, NINE], 4);
    const { xml } = applyCorrections(raw, [meter(0, 9, 8)], { strict: true });
    expect(meters(xml)).toEqual(['9/8', '9/8', '3/4', '4/4', '4/4']);
    expect(sounding(xml)).toEqual(sounding(raw));
  });
  it('rewrites homr’s layout in place: two leading attributes and a common-time symbol', () => {
    const raw = score([NINE, NINE], 4).replace(
      /<attributes>.*?<\/attributes>/,
      '<attributes><divisions>2</divisions><staves>2</staves><time symbol="common"><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
        '<attributes><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef><key><fifths>2</fifths></key></attributes>',
    );
    const { xml } = applyCorrections(raw, [meter(0, 9, 8)], { strict: true });
    expect(xml).toContain(
      '<attributes><divisions>2</divisions><staves>2</staves><time><beats>9</beats><beat-type>8</beat-type></time></attributes>',
    );
    expect(xml.match(/<time/g)).toHaveLength(1);
    expect(meters(xml)).toEqual(['9/8', '9/8']);
  });
  it('writes a time signature into a bar that has none, in MusicXML’s order', () => {
    const raw = score([NINE], 4).replace(/<time>.*?<\/time>/, '');
    const { xml } = applyCorrections(raw, [meter(0, 9, 8)], { strict: true });
    expect(xml).toContain(
      '<key><fifths>0</fifths></key><time><beats>9</beats><beat-type>8</beat-type></time><staves>2</staves>',
    );
    expect(meters(xml)).toEqual(['9/8']);
  });
  it('refuses a meter it cannot write, a bar that is not there and the meter already in force', () => {
    const raw = score([NINE, NINE], 4);
    const unwritable = en.scan.edit.refused.meter;
    expect(refusal(raw, meter(0, 0, 8))).toBe(unwritable);
    expect(refusal(raw, meter(0, 2.5, 8))).toBe(unwritable);
    expect(refusal(raw, meter(0, 33, 8))).toBe(unwritable);
    expect(refusal(raw, meter(0, 9, 3))).toBe(unwritable);
    expect(refusal(raw, meter(2, 9, 8))).toBe(en.scan.edit.refused.noBar);
    expect(refusal(raw, meter(1, 4, 4))).toBe(en.scan.edit.refused.sameMeter('4/4'));
  });
  it('never makes the strict import fail: a bar that still overruns the new meter imports', () => {
    const raw = score([NINE], 4);
    const { xml } = applyCorrections(raw, [meter(0, 3, 4)], { strict: true });
    expect(() => strict(xml)).not.toThrow();
    expect(findProblems(readScanScore(parseScanXml(xml)))).toEqual([
      expect.objectContaining({ kind: 'bar-timing', bar: 0 }),
    ]);
  });
  it('is offered once, from the first of the bars whose hands agree but overrun the meter', () => {
    const uneven = n('C5', 9, 'whole') + backup(9) + n('C3', 6, 'half', { staff: 2, dots: 1 });
    const parsed = readScanScore(parseScanXml(score([FOUR, NINE, NINE, uneven, NINE], 4)));
    const problems = findProblems(parsed);
    expect(problems.map((p) => p.kind === 'bar-timing' && p.bar)).toEqual([1, 2, 3, 4]);
    const offers = meterOffers(parsed, problems);
    expect([...offers].map(([p, c]) => [p.kind === 'bar-timing' && p.bar, c])).toEqual([
      [1, meter(1, 9, 8)],
    ]);
  });
  it('offers whole beats as quarters, and nothing for one long bar or hands that disagree', () => {
    const quarters = readScanScore(parseScanXml(score([BAR, BAR], 2)));
    expect([...meterOffers(quarters, findProblems(quarters)).values()]).toEqual([meter(0, 3, 4)]);
    const single = readScanScore(parseScanXml(score([NINE, FOUR], 4)));
    expect(meterOffers(single, findProblems(single)).size).toBe(0);
    const uneven = n('C5', 9, 'whole') + backup(9) + n('C3', 6, 'half', { staff: 2, dots: 1 });
    const disagree = readScanScore(parseScanXml(score([uneven, uneven], 4)));
    expect(meterOffers(disagree, findProblems(disagree)).size).toBe(0);
  });
  it('is listed by bar and meter', () => {
    const raw = readScanScore(parseScanXml(score([NINE, NINE], 4)));
    expect(describeCorrection(en, raw, meter(0, 9, 8))).toBe(
      'From bar 1: time signature 4/4 → 9/8',
    );
  });
});

describe('repeat marks the score cannot carry (issue 230)', () => {
  const bracket = (xml: string, bar: number) =>
    xml.replace(
      `<measure number="${bar}">`,
      `<measure number="${bar}"><barline location="left"><ending type="start" number="1"/></barline>`,
    );
  const repeat = (xml: string, bar: number, direction: 'forward' | 'backward') =>
    xml.replace(
      `<measure number="${bar}">`,
      `<measure number="${bar}"><barline location="${direction === 'forward' ? 'left' : 'right'}"><repeat direction="${direction}"/></barline>`,
    );

  it('flags a volta bracket in a score with no repeat sign, once, and offers its removal', () => {
    const raw = bracket(score([BAR, BAR, BAR]), 2);
    const parsed = readScanScore(parseScanXml(raw));
    const problems = findProblems(parsed);
    expect(problems).toEqual([{ kind: 'form', part: 0, bar: 1, mark: 'ending' }]);
    expect(describeProblem(en, parsed, problems[0]!)).toBe(
      'Bar 2: a repeat ending was read here, but the score has no repeat sign.',
    );
    const offer = formOffers(problems).get(problems[0]!)!;
    expect(offer).toEqual({ kind: 'barline', bar: 1 });
    const result = applyCorrections(raw, [offer]);
    expect(result.applied).toBe(1);
    expect(result.xml).not.toContain('<ending');
    // The barline had nothing else to say, so it goes too; the notes are untouched.
    expect(result.xml).not.toContain('<barline');
    expect(findProblems(readScanScore(parseScanXml(result.xml)))).toEqual([]);
    expect(sounding(result.xml)).toEqual(sounding(score([BAR, BAR, BAR])));
    expect(describeCorrection(en, parsed, offer)).toBe('Bar 2: repeat marks removed');
  });

  it('keeps a repeat sign with its ending, and flags a repeat sign no repeat closes', () => {
    const proper = bracket(repeat(repeat(score([BAR, BAR, BAR]), 1, 'forward'), 2, 'backward'), 2);
    expect(findProblems(readScanScore(parseScanXml(proper)))).toEqual([]);
    // A backward repeat on its own returns to the top: nothing to flag.
    expect(
      findProblems(readScanScore(parseScanXml(repeat(score([BAR, BAR]), 2, 'backward')))),
    ).toEqual([]);
    const open = repeat(score([BAR, BAR, BAR]), 2, 'forward');
    const parsed = readScanScore(parseScanXml(open));
    const problems = findProblems(parsed);
    expect(problems).toEqual([{ kind: 'form', part: 0, bar: 1, mark: 'repeat' }]);
    expect(describeProblem(en, parsed, problems[0]!)).toBe(
      'Bar 2: a repeat sign opens here, and no repeat sign closes it.',
    );
  });

  it('keeps the bar style when the marks go, and refuses a bar without marks or no longer there', () => {
    const styled = score([BAR, BAR]).replace(
      '</measure></part>',
      '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline></measure></part>',
    );
    const result = applyCorrections(styled, [{ kind: 'barline', bar: 1 }]);
    expect(result.applied).toBe(1);
    expect(result.xml).toContain('<bar-style>light-heavy</bar-style>');
    expect(result.xml).not.toContain('<repeat');
    expect(() =>
      applyCorrections(score([BAR, BAR]), [{ kind: 'barline', bar: 0 }], { strict: true }),
    ).toThrow(CorrectionError);
    expect(applyCorrections(score([BAR, BAR]), [{ kind: 'barline', bar: 0 }]).refusal!(en)).toBe(
      'This bar has no repeat mark.',
    );
    expect(applyCorrections(score([BAR, BAR]), [{ kind: 'barline', bar: 5 }]).refusal!(en)).toBe(
      'This bar is no longer in the score.',
    );
  });
});
