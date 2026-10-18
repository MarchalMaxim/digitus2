import { parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import {
  applyCorrections,
  barTiming,
  CorrectionError,
  findProblems,
  type Correction,
} from './corrections.js';
import { parseScanXml, readScanScore } from './notes.js';

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
function score(measures: string[], beats = 3, fifths = 0) {
  const body = measures
    .map(
      (m, i) =>
        `<measure number="${i + 1}">${
          i === 0
            ? `<attributes><divisions>2</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`
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
    .notes.map((note) => [note.midi, note.onsetTick, note.offsetTick - note.onsetTick, note.hand] as const)
    .sort((a, b) => (a[3] === b[3] ? 0 : a[3] === 'R' ? -1 : 1) || a[1] - b[1] || a[0] - b[0])
    .map((note) => [...note]);

// Bar: right hand quarter C5, quarter D5, quarter E5; left hand dotted half C3.
const BAR = n('C5', 2, 'quarter') + n('D5', 2, 'quarter') + n('E5', 2, 'quarter') + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 });

describe('pitch corrections', () => {
  it('changes one note, writes the accidental it needs and leaves every other note alone', () => {
    const raw = score([BAR]);
    const { xml } = applyCorrections(raw, [{ kind: 'pitch', note: 1, step: 'E', alter: -1, octave: 5 }]);
    expect(sounding(xml)).toEqual([
      [72, 0, 2, 'R'],
      [75, 2, 2, 'R'],
      [76, 4, 2, 'R'],
      [48, 0, 6, 'L'],
    ]);
    const doc = parseScanXml(xml);
    expect(doc.getElementsByTagName('note')[1]!.querySelector('accidental')?.textContent).toBe('flat');
    expect(doc.getElementsByTagName('note')[0]!.querySelector('accidental')).toBeNull();
  });
  it('writes a natural against the key signature and removes an accidental no longer needed', () => {
    const raw = score([n('F5', 2, 'quarter') + n('G5', 4, 'half') + backup(6) + n('r', 6, 'half', { staff: 2, dots: 1 })], 3, 1);
    // F5 in G major sounds F#; correcting it to F natural needs a natural sign.
    const { xml } = applyCorrections(raw, [{ kind: 'pitch', note: 0, step: 'F', alter: 0, octave: 5 }]);
    expect(parseScanXml(xml).querySelector('note accidental')?.textContent).toBe('natural');
    const back = applyCorrections(xml, [{ kind: 'pitch', note: 0, step: 'F', alter: 1, octave: 5 }]).xml;
    expect(parseScanXml(back).querySelector('note accidental')).toBeNull();
  });
  it('moves a whole tie chain together, so a tie never joins two pitches', () => {
    const raw = score([
      n('C5', 2, 'quarter') + n('D5', 2, 'quarter') + n('A4', 2, 'quarter', { tie: 'start' }) + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 }),
      n('A4', 2, 'quarter', { tie: 'stop' }) + n('r', 4, 'half') + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 }),
    ]);
    const { xml } = applyCorrections(raw, [{ kind: 'pitch', note: 4, step: 'B', alter: 0, octave: 4 }]);
    const notes = strict(xml).notes.filter((note) => note.hand === 'R');
    expect(notes.map((note) => [note.midi, note.offsetTick - note.onsetTick])).toEqual([
      [72, 2],
      [74, 2],
      [71, 4],
    ]);
  });
  it('refuses a rest and an unknown ordinal', () => {
    const raw = score([BAR]);
    expect(() => applyCorrections(raw, [{ kind: 'pitch', note: 99, step: 'C', alter: 0, octave: 4 }], { strict: true })).toThrow(CorrectionError);
    const rest = score([n('r', 6, 'half', { dots: 1 }) + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 })]);
    expect(() => applyCorrections(rest, [{ kind: 'pitch', note: 0, step: 'C', alter: 0, octave: 4 }], { strict: true })).toThrow(CorrectionError);
  });
});

describe('duration corrections check both hands', () => {
  it('lengthening a right-hand note before a backup keeps every left-hand onset', () => {
    // Recognised as three quarters plus a stray eighth: the right hand is half a beat long.
    const raw = score([
      n('C5', 2, 'quarter') + n('D5', 1, 'eighth') + n('E5', 2, 'quarter') + backup(5) + n('C3', 2, 'quarter', { staff: 2 }) + n('G3', 4, 'half', { staff: 2 }),
    ]);
    const { xml } = applyCorrections(raw, [{ kind: 'duration', note: 1, type: 'quarter', dots: 0 }]);
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
    const raw = score([n('C5', 6, 'half', { dots: 1 }) + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 })]);
    const { xml } = applyCorrections(raw, [{ kind: 'duration', note: 0, type: 'quarter', dots: 0 }]);
    expect(sounding(xml)).toEqual([
      [72, 0, 2, 'R'],
      [48, 0, 6, 'L'],
    ]);
  });
  it('changes every member of a chord, never splitting it', () => {
    const raw = score([n('C5', 2, 'quarter') + n('E5', 2, 'quarter', { chord: true }) + n('D5', 4, 'half') + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 })]);
    const { xml } = applyCorrections(raw, [{ kind: 'duration', note: 1, type: 'half', dots: 0 }]);
    const right = strict(xml).notes.filter((note) => note.hand === 'R');
    expect(right.map((note) => [note.midi, note.onsetTick, note.offsetTick - note.onsetTick])).toEqual([
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
    expect(notes.notes.map((note) => [note.midi, note.onsetTick / quarter, (note.offsetTick - note.onsetTick) / quarter])).toEqual([
      [72, 0, 0.25],
      [48, 0, 3],
      [74, 0.25, 1],
      [76, 1.25, 1],
    ]);
  });
  it('reports each hand against the time signature', () => {
    const raw = score([n('C5', 2, 'quarter') + n('D5', 1, 'eighth') + n('E5', 2, 'quarter') + backup(5) + n('C3', 6, 'half', { staff: 2, dots: 1 })]);
    const timing = barTiming(readScanScore(parseScanXml(raw)), 0, 0);
    expect(timing).toEqual({ expected: 3, staves: [{ staff: 1, beats: 2.5 }, { staff: 2, beats: 3 }] });
  });
  it('refuses a grace note', () => {
    const raw = score([`<note><grace/><pitch><step>B</step><octave>4</octave></pitch><voice>1</voice><type>eighth</type><staff>1</staff></note>` + BAR]);
    expect(() => applyCorrections(raw, [{ kind: 'duration', note: 0, type: 'quarter', dots: 0 }], { strict: true })).toThrow(CorrectionError);
  });
});

describe('tie corrections', () => {
  const twoBars = (gap: boolean) =>
    score([
      n('C5', 2, 'quarter') + n('D5', 2, 'quarter') + n('A4', 2, 'quarter', { tie: gap ? 'start' : undefined }) + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 }),
      (gap ? n('r', 2, 'quarter') : '') + n('A4', 2, 'quarter', { tie: gap ? 'stop' : undefined }) + n('B4', gap ? 2 : 4, gap ? 'quarter' : 'half') + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 }),
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
      applyCorrections(raw, [{ kind: 'tie', note: 2, tied: false }, { kind: 'tie', note: 2, tied: true }], { strict: true });
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
    const raw = score([n('C5', 2, 'quarter') + n('E3', 2, 'quarter', { chord: true }) + n('D5', 4, 'half') + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 })]);
    const { xml } = applyCorrections(raw, [{ kind: 'hand', note: 1, staff: 2 }]);
    expect(sounding(xml)).toContainEqual([52, 0, 2, 'L']);
    expect(sounding(xml).filter((note) => note[3] === 'R')).toHaveLength(2);
  });
  it('removes a duplicated chord member, and turns a lone note into a rest of the same length', () => {
    const raw = score([n('C5', 2, 'quarter') + n('C5', 2, 'quarter', { chord: true }) + n('D5', 4, 'half') + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 })]);
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
    const raw = score([n('C5', 2, 'quarter') + n('E5', 2, 'quarter', { chord: true }) + n('D5', 4, 'half') + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 })]);
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
      n('C5', 2, 'quarter') + n('C5', 2, 'quarter', { chord: true }) + n('D5', 2, 'quarter') + n('E5', 2, 'quarter') + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 }),
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
    const result = applyCorrections(raw, [{ kind: 'pitch', note: 1, step: 'E', alter: 0, octave: 5 }]);
    expect([...parseScanXml(result.renderXml).getElementsByTagName('note')].map((el) => el.id)).toEqual(['s0', 's1', 's2', 's3']);
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
      n('C5', 2, 'quarter') + n('D5', 1, 'eighth') + n('E5', 2, 'quarter') + backup(5) + n('C3', 6, 'half', { staff: 2, dots: 1 }),
      BAR,
    ]);
    const problems = findProblems(readScanScore(parseScanXml(raw)));
    expect(problems).toEqual([expect.objectContaining({ kind: 'bar-timing', bar: 1 })]);
  });
  it('flags a tie stop without a start', () => {
    const raw = score([n('C5', 2, 'quarter', { tie: 'stop' }) + n('D5', 4, 'half') + backup(6) + n('C3', 6, 'half', { staff: 2, dots: 1 })]);
    expect(findProblems(readScanScore(parseScanXml(raw)))).toEqual([expect.objectContaining({ kind: 'tie-unmatched', note: 0 })]);
  });
});
