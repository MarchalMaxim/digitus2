import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { UNMARKED_VELOCITY } from '../../score/build.js';
import { parseMusicXml } from './read.js';

const xml = readFileSync(
  fileURLToPath(new URL('../../../fixtures/two-staff.musicxml', import.meta.url)),
  'utf8',
);

describe('parseMusicXml notes', () => {
  const { score, editorial, warnings } = parseMusicXml(xml);
  const byMidiHand = (midi: number, hand: 'L' | 'R') =>
    score.notes.filter((n) => n.midi === midi && n.hand === hand);

  it('parses without warnings and uses the lcm of divisions', () => {
    expect(warnings).toEqual([]);
    expect(score.divisions).toBe(4);
  });
  it('counts sounding notes: ties merged, rests skipped, grace kept', () => {
    // m1: G4 A4 B4 C5(tie) + G2 D3 = 6 ; m2: [C5 merged] F#4(grace) G4 E4 + C3 C4 = 5 ; m3: D5 E5 F5 B3 G2 = 5
    expect(score.notes).toHaveLength(16);
    expect(score.notes.filter((n) => n.isGrace)).toHaveLength(1);
  });
  it('places onsets with the scaled divisions', () => {
    const a4 = byMidiHand(69, 'R')[0]!;
    expect(a4.onsetTick).toBe(4);
    expect(a4.offsetTick).toBe(8);
    const d5 = byMidiHand(74, 'R')[0]!;
    expect(d5.onsetTick).toBe(32); // measure 3 starts at 2 * 16
    expect(d5.offsetTick).toBe(34);
    const f5 = byMidiHand(77, 'R')[0]!;
    expect(f5.offsetTick - f5.onsetTick).toBe(12);
  });
  it('merges the tie across the barline into one note', () => {
    const c5 = byMidiHand(72, 'R');
    expect(c5).toHaveLength(1);
    expect(c5[0]!.onsetTick).toBe(12);
    expect(c5[0]!.offsetTick).toBe(20);
    expect(c5[0]!.sourceIndices).toHaveLength(2);
    expect(c5[0]!.id).toBe('n3');
  });
  it('groups the left-hand chord and assigns hands by staff', () => {
    const g2 = byMidiHand(43, 'L')[0]!;
    const d3 = byMidiHand(50, 'L')[0]!;
    expect(g2.chordId).toBe(d3.chordId);
    expect(g2.staff).toBe(2);
  });
  it('honors the cross-staff note', () => {
    expect(byMidiHand(59, 'R')).toHaveLength(1);
    expect(byMidiHand(59, 'L')).toHaveLength(0);
  });
  it('keeps the second voice at its backup position', () => {
    const e4 = byMidiHand(64, 'R')[0]!;
    expect(e4.voice).toBe(2);
    expect(e4.onsetTick).toBe(16 + 8);
  });
  it('gives the grace note a zero-length onset at the following note', () => {
    const grace = score.notes.find((n) => n.isGrace)!;
    const g4 = score.notes.find((n) => n.midi === 67 && n.hand === 'R' && n.onsetTick >= 16)!;
    expect(grace.midi).toBe(66);
    expect(grace.onsetTick).toBe(g4.onsetTick);
    expect(grace.offsetTick).toBe(grace.onsetTick);
  });
  it('builds measures with running start ticks', () => {
    expect(score.measures.map((m) => m.startTick)).toEqual([0, 16, 32]);
    expect(score.measures.map((m) => m.lengthTicks)).toEqual([16, 16, 16]);
    expect(score.measures[2]!.number).toBe('3');
    expect(score.notes.find((n) => n.midi === 74)!.measureIndex).toBe(2);
  });
  it('reads editorial fingering by note id', () => {
    expect(editorial['n0']).toEqual({ finger: 1, source: 'editorial' });
    expect(Object.keys(editorial)).toHaveLength(1);
  });
  it('reads metadata', () => {
    expect(score.meta.title).toBe('Fixture');
    expect(score.meta.composer).toBe('Test Composer');
  });
  it('reads the metronome tempo and derives seconds', () => {
    expect(score.tempoMap).toEqual([{ tick: 0, qpm: 90 }]);
    const a4 = score.notes.find((n) => n.midi === 69 && n.hand === 'R')!;
    expect(a4.onsetSec).toBeCloseTo((4 / 4) * (60 / 90));
  });
  it('reads key and time signatures', () => {
    expect(score.keySignatures).toEqual([{ tick: 0, fifths: 1, mode: 'major' }]);
    expect(score.timeSignatures).toEqual([{ tick: 0, beats: 4, beatType: 4 }]);
  });
});

describe('parseMusicXml edge cases', () => {
  it('assigns hands by part order for two single-staff parts', () => {
    const two = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>RH</part-name></score-part><score-part id="P2"><part-name>LH</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration></note></measure></part>
      <part id="P2"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
    const { score } = parseMusicXml(two);
    expect(score.notes.map((n) => [n.midi, n.hand])).toEqual([
      [72, 'R'],
      [48, 'L'],
    ]);
  });
  it('rejects a pitch outside the piano', () => {
    const bad = `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>9</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
    expect(() => parseMusicXml(bad)).toThrow(/piano range/);
  });
  it('warns on a tie stop without a start and keeps the note', () => {
    const orphan = `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/></note></measure></part></score-partwise>`;
    const { score, warnings } = parseMusicXml(orphan);
    expect(score.notes).toHaveLength(1);
    expect(warnings[0]).toMatch(/tie/);
  });
  it('starts a chord tone written beside a tie continuation at the continuation onset', () => {
    // m1: C5 whole tied into m2; m2: C5 (tie stop) with an untied chord tone E5.
    const tiedChord = `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
      <measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><tie type="start"/></note></measure>
      <measure number="2"><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><tie type="stop"/></note><note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`;
    const { score, warnings } = parseMusicXml(tiedChord);
    expect(warnings).toEqual([]);
    const c5 = score.notes.find((n) => n.midi === 72)!;
    const e5 = score.notes.find((n) => n.midi === 76)!;
    expect([c5.onsetTick, c5.offsetTick]).toEqual([0, 8]);
    expect([e5.onsetTick, e5.offsetTick]).toEqual([4, 8]);
    expect(e5.measureIndex).toBe(1);
  });
});

describe('parseMusicXml tempo variants', () => {
  const wrap = (direction: string) =>
    `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>${direction}<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
  it('converts a dotted-quarter metronome to quarters per minute', () => {
    const { score } = parseMusicXml(
      wrap(
        '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome></direction-type></direction>',
      ),
    );
    expect(score.tempoMap[0]!.qpm).toBeCloseTo(90);
  });
  it('prefers sound tempo over the metronome text', () => {
    const { score } = parseMusicXml(
      wrap(
        '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><sound tempo="120"/></direction>',
      ),
    );
    expect(score.tempoMap[0]!.qpm).toBe(120);
  });
  it('defaults to 120 when nothing is marked', () => {
    const { score } = parseMusicXml(wrap(''));
    expect(score.tempoMap).toEqual([{ tick: 0, qpm: 120 }]);
  });
  it('converts a double-dotted-quarter metronome to quarters per minute', () => {
    const { score } = parseMusicXml(
      wrap(
        '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><beat-unit-dot/><per-minute>40</per-minute></metronome></direction-type></direction>',
      ),
    );
    expect(score.tempoMap[0]!.qpm).toBeCloseTo(70);
  });
});

/** One `<note>` element; `pre` goes before `<pitch>` (chord, grace, cue), `post` after `<duration>`. */
function n(step: string, octave: number, duration: number, post = '', pre = ''): string {
  return `<note>${pre}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration>${post}</note>`;
}

/** A single-part partwise score with divisions 1; each string is the body of one measure. */
function onePart(...measures: string[]): string {
  const body = measures
    .map(
      (m, i) =>
        `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>1</divisions></attributes>' : ''}${m}</measure>`,
    )
    .join('');
  return `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">${body}</part></score-partwise>`;
}

describe('parseMusicXml measure starts across parts', () => {
  // P1's measure 1 holds one quarter and P2's holds four, so measure 2 starts at tick 4.
  const tempo = (qpm: number) =>
    `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${qpm}</per-minute></metronome></direction-type><sound tempo="${qpm}"/></direction>`;
  const twoParts = `<score-partwise><part-list><score-part id="P1"/><score-part id="P2"/></part-list>
    <part id="P1">
      <measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${n('C', 5, 1)}</measure>
      <measure number="2"><attributes><key><fifths>2</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>${tempo(60)}${n('D', 5, 1)}${tempo(80)}${n('E', 5, 2)}</measure>
    </part>
    <part id="P2">
      <measure number="1"><attributes><divisions>1</divisions></attributes>${n('C', 3, 4)}</measure>
      <measure number="2">${n('D', 3, 3)}</measure>
    </part></score-partwise>`;
  const { score } = parseMusicXml(twoParts);

  it('uses the longest part for measure starts', () => {
    expect(score.measures.map((m) => m.startTick)).toEqual([0, 4]);
  });
  it('places tempo events at the final measure start plus their offset in the measure', () => {
    expect(score.tempoMap.find((t) => t.qpm === 60)?.tick).toBe(score.measures[1]!.startTick);
    expect(score.tempoMap.find((t) => t.qpm === 80)?.tick).toBe(score.measures[1]!.startTick + 1);
  });
  it('places key and time signature changes at the final measure start', () => {
    expect(score.keySignatures).toEqual([
      { tick: 0, fifths: 0 },
      { tick: 4, fifths: 2 },
    ]);
    expect(score.timeSignatures).toEqual([
      { tick: 0, beats: 4, beatType: 4 },
      { tick: 4, beats: 3, beatType: 4 },
    ]);
  });
  it('prepends 120 qpm at tick 0 when the first tempo mark comes later', () => {
    expect(score.tempoMap).toEqual([
      { tick: 0, qpm: 120 },
      { tick: 4, qpm: 60 },
      { tick: 5, qpm: 80 },
    ]);
  });
});

describe('parseMusicXml ties in several voices', () => {
  it('merges each voice with its own tie start', () => {
    // E5 whole tied in voice 1; an E5 half tied in voice 2 starting on beat 3.
    const xml = onePart(
      `${n('E', 5, 4, '<tie type="start"/><voice>1</voice>')}<backup><duration>4</duration></backup><note><rest/><duration>2</duration><voice>2</voice></note>${n('E', 5, 2, '<tie type="start"/><voice>2</voice>')}`,
      `${n('E', 5, 4, '<tie type="stop"/><voice>1</voice>')}<backup><duration>4</duration></backup>${n('E', 5, 2, '<tie type="stop"/><voice>2</voice>')}<note><rest/><duration>2</duration><voice>2</voice></note>`,
    );
    const { score, warnings } = parseMusicXml(xml);
    expect(warnings).toEqual([]);
    expect(score.notes.map((x) => [x.voice, x.onsetTick, x.offsetTick, x.sourceIndices])).toEqual([
      [1, 0, 8, [0, 3]],
      [2, 2, 6, [2, 4]],
    ]);
  });
  it('falls back to a tie start in another voice when its own voice has none', () => {
    const xml = onePart(
      n('C', 5, 4, '<tie type="start"/><voice>1</voice>'),
      n('C', 5, 4, '<tie type="stop"/><voice>2</voice>'),
    );
    const { score, warnings } = parseMusicXml(xml);
    expect(warnings).toEqual([]);
    expect(score.notes.map((x) => [x.onsetTick, x.offsetTick, x.sourceIndices])).toEqual([
      [0, 8, [0, 1]],
    ]);
  });
});

describe('parseMusicXml cue notes and duplicates', () => {
  it('skips cue notes but still advances the cursor', () => {
    const { score, warnings } = parseMusicXml(
      onePart(`${n('C', 5, 1, '', '<cue/>')}${n('D', 5, 1)}`),
    );
    expect(warnings).toEqual([]);
    expect(score.notes.map((x) => [x.id, x.midi, x.onsetTick])).toEqual([['n1', 74, 1]]);
  });
  it('warns on a duplicate (hand, onset, pitch) note and keeps only the first', () => {
    const fingering = (f: number) =>
      `<notations><technical><fingering>${f}</fingering></technical></notations>`;
    const xml = onePart(
      `${n('C', 5, 1, `<voice>1</voice>${fingering(1)}`)}<backup><duration>1</duration></backup>${n('C', 5, 2, `<voice>2</voice>${fingering(2)}`)}`,
    );
    const { score, editorial, warnings } = parseMusicXml(xml);
    expect(score.notes.map((x) => [x.id, x.onsetTick, x.offsetTick])).toEqual([['n0', 0, 1]]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/duplicate/);
    expect(Object.keys(editorial)).toEqual(['n0']);
  });
  it('does not treat repeated grace notes of one pitch as duplicates', () => {
    const grace = n('D', 5, 0, '', '<grace/>');
    const { score, warnings } = parseMusicXml(onePart(`${grace}${grace}${n('C', 5, 1)}`));
    expect(warnings).toEqual([]);
    expect(score.notes.filter((x) => x.isGrace)).toHaveLength(2);
  });
});

describe('parseMusicXml alter values', () => {
  const withAlter = (alter: string) =>
    onePart(
      `<note><pitch><step>C</step><alter>${alter}</alter><octave>5</octave></pitch><duration>1</duration></note>${n('D', 5, 1)}`,
    );
  it('rounds a microtonal alter to the nearest semitone with a warning', () => {
    const { score, warnings } = parseMusicXml(withAlter('0.5'));
    expect(score.notes[0]!.midi).toBe(73);
    expect(score.notes[0]!.spelling.alter).toBe(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/alter/);
  });
  it('skips a note whose alter is outside -2..2 or not a number, with a warning', () => {
    for (const alter of ['3', '-3', 'sharp']) {
      const { score, warnings } = parseMusicXml(withAlter(alter));
      expect(
        score.notes.map((x) => x.midi),
        alter,
      ).toEqual([74]);
      expect(warnings, alter).toHaveLength(1);
      expect(warnings[0], alter).toMatch(/alter/);
    }
  });
});

describe('parseMusicXml staves, encodings and containers', () => {
  it('puts a voice-1 note written on staff 2 of a two-staff part in the left hand', () => {
    const xml = `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1">
      <attributes><divisions>1</divisions><staves>2</staves></attributes>
      ${n('C', 5, 1, '<voice>1</voice><staff>1</staff>')}${n('A', 3, 1, '<voice>1</voice><staff>2</staff>')}
      </measure></part></score-partwise>`;
    const { score } = parseMusicXml(xml);
    expect(score.notes.map((x) => [x.midi, x.voice, x.staff, x.hand])).toEqual([
      [72, 1, 1, 'R'],
      [57, 1, 2, 'L'],
    ]);
  });
  it('parses a timewise score', () => {
    const timewise = `<?xml version="1.0" encoding="UTF-8"?>
<score-timewise version="4.0"><part-list><score-part id="P1"/><score-part id="P2"/></part-list>
<measure number="1"><part id="P1"><attributes><divisions>1</divisions></attributes>${n('C', 5, 2)}</part><part id="P2"><attributes><divisions>1</divisions></attributes>${n('C', 3, 2)}</part></measure>
<measure number="2"><part id="P1">${n('D', 5, 2)}</part><part id="P2">${n('D', 3, 2)}</part></measure>
</score-timewise>`;
    const { score, warnings } = parseMusicXml(timewise);
    expect(warnings).toEqual([]);
    expect(score.notes.map((x) => [x.midi, x.hand, x.onsetTick])).toEqual([
      [72, 'R', 0],
      [48, 'L', 0],
      [74, 'R', 2],
      [50, 'L', 2],
    ]);
  });
  it('parses an .mxl archive whose rootfile sits in a subfolder', () => {
    const container = `<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="deep/folder/piece.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
    const zip = zipSync({
      'META-INF/container.xml': strToU8(container),
      'decoy.xml': strToU8('<not-a-score/>'),
      'deep/folder/piece.musicxml': strToU8(xml),
    });
    const { score, warnings } = parseMusicXml(zip);
    expect(warnings).toEqual([]);
    expect(score.meta.title).toBe('Fixture');
    expect(score.notes).toHaveLength(16);
  });
  it('parses a UTF-16LE file with a byte-order mark', () => {
    const text = `<?xml version="1.0" encoding="UTF-16"?>${onePart(n('C', 5, 1)).replace('<part-list>', '<movement-title>Für Elise</movement-title><part-list>')}`;
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      bytes[2 + 2 * i] = text.charCodeAt(i) & 0xff;
      bytes[3 + 2 * i] = text.charCodeAt(i) >> 8;
    }
    const { score } = parseMusicXml(bytes);
    expect(score.meta.title).toBe('Für Elise');
    expect(score.notes.map((x) => x.midi)).toEqual([72]);
  });
});

describe('parseMusicXml dynamics', () => {
  /** A `<direction>` with a dynamics mark (or none), optional `<sound>` attributes and staff. */
  const dyn = (
    mark: string | null,
    { staff, sound, placement }: { staff?: number; sound?: string; placement?: string } = {},
  ) =>
    `<direction${placement === undefined ? '' : ` placement="${placement}"`}><direction-type>${mark === null ? '<words>dolce</words>' : `<dynamics><${mark}/></dynamics>`}</direction-type>${staff === undefined ? '' : `<staff>${staff}</staff>`}${sound === undefined ? '' : `<sound dynamics="${sound}"/>`}</direction>`;
  const onStaff = (staff: number) => `<voice>${staff}</voice><staff>${staff}</staff>`;
  const twoStaves = (...measures: string[]) =>
    `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">${measures
      .map(
        (m, i) =>
          `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>1</divisions><staves>2</staves></attributes>' : ''}${m}</measure>`,
      )
      .join('')}</part></score-partwise>`;
  const velocities = (input: string) =>
    parseMusicXml(input).score.notes.map((x) => [x.midi, x.velocity]);

  it('maps every mark from ppp to fff to a velocity', () => {
    const marks = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
    const { score } = parseMusicXml(onePart(marks.map((m) => dyn(m) + n('C', 4, 1)).join('')));
    expect(score.notes.map((x) => x.velocity)).toEqual([32, 44, 56, 68, 80, 92, 104, 116]);
  });
  it('leaves notes before the first mark without a velocity and carries a mark across bars', () => {
    expect(velocities(onePart(n('C', 4, 1) + dyn('p') + n('D', 4, 1), n('E', 4, 1)))).toEqual([
      [60, undefined],
      [62, 56],
      [64, 56],
    ]);
  });
  it('applies a mark between the staves to both hands, at its offset in the bar', () => {
    // Below the upper staff (also by default) or above the lower one, or naming no staff.
    const xml = twoStaves(
      `${dyn('p', { staff: 1 })}${n('C', 5, 1, onStaff(1))}${dyn('ff', { staff: 1, placement: 'below' })}${n('D', 5, 1, onStaff(1))}<backup><duration>2</duration></backup>${n('C', 3, 1, onStaff(2))}${n('D', 3, 1, onStaff(2))}`,
      `${dyn('mp', { staff: 2, placement: 'above' })}${n('E', 5, 1, onStaff(1))}<backup><duration>1</duration></backup>${n('E', 3, 1, onStaff(2))}`,
      `${dyn('pp')}${n('F', 5, 1, onStaff(1))}<backup><duration>1</duration></backup>${n('F', 3, 1, onStaff(2))}`,
    );
    expect(velocities(xml)).toEqual([
      [72, 56],
      [48, 56],
      [74, 104],
      [50, 104],
      [76, 68],
      [52, 68],
      [77, 44],
      [53, 44],
    ]);
  });
  it('keeps a mark above the top staff or below the bottom one to that hand', () => {
    const xml = twoStaves(
      `${dyn('p', { staff: 1 })}${n('C', 5, 1, onStaff(1))}<backup><duration>1</duration></backup>${dyn('f', { staff: 2, placement: 'below' })}${n('C', 3, 1, onStaff(2))}`,
      `${dyn('mf', { staff: 1, placement: 'above' })}${n('D', 5, 1, onStaff(1))}<backup><duration>1</duration></backup>${n('D', 3, 1, onStaff(2))}`,
    );
    expect(velocities(xml)).toEqual([
      [72, 56],
      [48, 92],
      [74, 80],
      [50, 92],
    ]);
  });
  it('reads sound dynamics as a percentage of forte when no mark gives a level', () => {
    // MusicXML's sound dynamics is a percentage of forte, MIDI velocity 90.
    const xml = onePart(
      dyn(null, { sound: '60' }) + n('C', 4, 1),
      dyn('pp', { sound: '100' }) + n('D', 4, 1),
      dyn('sfz', { sound: '120' }) + n('E', 4, 1),
      '<sound dynamics="80"/>' + n('F', 4, 1),
    );
    expect(velocities(xml)).toEqual([
      [60, 54],
      [62, 44], // the mark wins over its sound
      [64, 44], // an accent such as sfz keeps the level
      [65, 72],
    ]);
  });
  it('keeps dynamics within their part and at the final bar starts', () => {
    // P2's first bar is longer, so P1's second bar moves later in the second pass.
    const xml = `<score-partwise><part-list><score-part id="P1"/><score-part id="P2"/></part-list>
      <part id="P1">
        <measure number="1"><attributes><divisions>1</divisions></attributes>${dyn('p')}${n('C', 5, 1)}</measure>
        <measure number="2">${n('D', 5, 1)}${dyn('f')}${n('E', 5, 1)}</measure>
      </part>
      <part id="P2">
        <measure number="1"><attributes><divisions>1</divisions></attributes>${n('C', 3, 4)}</measure>
        <measure number="2">${dyn('pp')}${n('D', 3, 2)}</measure>
      </part></score-partwise>`;
    expect(velocities(xml)).toEqual([
      [72, 56],
      [48, undefined],
      [74, 56],
      [50, 44],
      [76, 92],
    ]);
  });
});

describe('parseMusicXml hairpins', () => {
  const dyn = (mark: string) =>
    `<direction><direction-type><dynamics><${mark}/></dynamics></direction-type></direction>`;
  /** A `<wedge>` direction: crescendo, diminuendo or stop. */
  const wedge = (
    type: string,
    { number, staff, placement }: { number?: number; staff?: number; placement?: string } = {},
  ) =>
    `<direction${placement === undefined ? '' : ` placement="${placement}"`}><direction-type><wedge type="${type}"${number === undefined ? '' : ` number="${number}"`}/></direction-type>${staff === undefined ? '' : `<staff>${staff}</staff>`}</direction>`;
  const words = (text: string) =>
    `<direction><direction-type><words>${text}</words></direction-type></direction>`;
  const velocities = (input: string) =>
    parseMusicXml(input).score.notes.map((x) => [x.midi, x.velocity]);

  it('ramps a crescendo from the level at its start to the mark at its end', () => {
    const xml = onePart(
      dyn('p') + wedge('crescendo') + n('C', 4, 1) + n('D', 4, 1) + n('E', 4, 1) + n('F', 4, 1),
      wedge('stop') + dyn('f') + n('G', 4, 1),
    );
    expect(velocities(xml)).toEqual([
      [60, 56],
      [62, 65],
      [64, 74],
      [65, 83],
      [67, 92],
    ]);
  });
  it('takes a diminuendo with no mark at its end one step softer and holds that level', () => {
    const xml = onePart(
      dyn('f') + wedge('diminuendo') + n('C', 4, 1) + n('D', 4, 1) + wedge('stop'),
      n('E', 4, 1) + n('F', 4, 1),
    );
    expect(velocities(xml)).toEqual([
      [60, 92],
      [62, 86],
      [64, 80],
      [65, 80],
    ]);
  });
  it('goes one step when the mark at its end lies the other way, then plays the mark', () => {
    const xml = onePart(
      dyn('f') + wedge('crescendo') + n('C', 4, 1) + n('D', 4, 1) + wedge('stop'),
      dyn('p') + n('E', 4, 1),
    );
    expect(velocities(xml)).toEqual([
      [60, 92],
      [62, 98],
      [64, 56],
    ]);
  });
  it('carries on from a mark inside a hairpin towards its end', () => {
    const xml = onePart(
      dyn('p') + wedge('crescendo') + n('C', 4, 1) + n('D', 4, 1) + dyn('mp') + n('E', 4, 1),
      n('F', 4, 1) + wedge('stop') + dyn('f') + n('G', 4, 1),
    );
    expect(velocities(xml)).toEqual([
      [60, 56],
      [62, 65],
      [64, 68],
      [65, 80],
      [67, 92],
    ]);
  });
  it('reads cresc. and dim. as a change up to the next mark', () => {
    const xml = onePart(
      dyn('pp') + words('cresc.') + n('C', 4, 1) + n('D', 4, 1) + n('E', 4, 1) + n('F', 4, 1),
      dyn('mf') + words('dim. e poco rit.') + n('G', 4, 1) + n('A', 4, 1),
      dyn('p') + n('B', 4, 1),
    );
    expect(velocities(xml)).toEqual([
      [60, 44],
      [62, 53],
      [64, 62],
      [65, 71],
      [67, 80],
      [69, 68],
      [71, 56],
    ]);
  });
  it('takes a cresc. with no mark after it one step up over four bars at most', () => {
    const xml = onePart(
      dyn('p') + words('poco a poco cresc.') + n('C', 4, 4),
      n('D', 4, 4),
      n('E', 4, 4),
      n('F', 4, 4),
      n('G', 4, 4),
      n('A', 4, 4),
    );
    expect(velocities(xml)).toEqual([
      [60, 56],
      [62, 59],
      [64, 62],
      [65, 65],
      [67, 68],
      [69, 68],
    ]);
  });
  it("starts a hairpin before any mark from the hand's unmarked level", () => {
    const xml = onePart(
      n('B', 3, 1) +
        wedge('diminuendo') +
        n('C', 4, 1) +
        n('D', 4, 1) +
        wedge('stop') +
        n('E', 4, 1),
    );
    expect(velocities(xml)).toEqual([
      [59, undefined],
      [60, UNMARKED_VELOCITY.R],
      [62, UNMARKED_VELOCITY.R - 6],
      [64, UNMARKED_VELOCITY.R - 12],
    ]);
  });
  it('ends a hairpin at its stop in time when another voice writes the stop first', () => {
    const v2 = '<voice>2</voice>';
    const xml = onePart(
      dyn('f') +
        n('C', 5, 2) +
        n('D', 5, 2) +
        wedge('stop') +
        '<backup><duration>4</duration></backup>' +
        n('C', 4, 1, v2) +
        wedge('diminuendo') +
        n('D', 4, 1, v2) +
        n('E', 4, 1, v2) +
        n('F', 4, 1, v2),
      n('G', 4, 4),
    );
    const byPitch = Object.fromEntries(velocities(xml));
    expect(byPitch).toEqual({ 72: 92, 60: 92, 62: 92, 74: 88, 64: 88, 65: 84, 67: 80 });
  });
  it('keeps a run of hairpins without marks within a step of the latest mark', () => {
    const sigh = (a: string, b: string) =>
      wedge('diminuendo') + n(a, 4, 1) + n(b, 4, 1) + wedge('stop');
    const xml = onePart(
      dyn('p') + sigh('C', 'D') + sigh('E', 'F'),
      sigh('G', 'A') + wedge('crescendo') + n('B', 4, 2) + wedge('stop'),
      n('C', 5, 1),
    );
    expect(velocities(xml)).toEqual([
      [60, 56],
      [62, 50],
      [64, 44],
      [65, 44],
      [67, 44],
      [69, 44],
      [71, 44],
      [72, 56],
    ]);
  });
  it("lets a staff without a mark of its own follow the other staff's", () => {
    const onStaff = (staff: number) => `<voice>${staff}</voice><staff>${staff}</staff>`;
    const above = `<direction placement="above"><direction-type><dynamics><pp/></dynamics></direction-type><staff>1</staff></direction>`;
    const lowerF = `<direction placement="below"><direction-type><dynamics><f/></dynamics></direction-type><staff>2</staff></direction>`;
    const xml = `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
      <measure number="1"><attributes><divisions>1</divisions><staves>2</staves></attributes>${above}${n('C', 5, 1, onStaff(1))}${words('cresc.')}${n('D', 5, 1, onStaff(1))}<backup><duration>2</duration></backup>${n('C', 3, 1, onStaff(2))}${n('D', 3, 1, onStaff(2))}</measure>
      <measure number="2">${n('E', 5, 1, onStaff(1))}<backup><duration>1</duration></backup>${lowerF}${n('E', 3, 1, onStaff(2))}</measure>
      </part></score-partwise>`;
    // The cresc. finds no mark for four bars on the upper staff, so it climbs one step over the
    // score's three ticks; the lower staff follows the pp until its own f.
    expect(velocities(xml)).toEqual([
      [72, 44],
      [48, 44],
      [74, 44],
      [50, 44],
      [76, 50],
      [52, 92],
    ]);
  });
  it('pairs hairpins by number and keeps one above the top staff to the right hand', () => {
    const onStaff = (staff: number) => `<voice>${staff}</voice><staff>${staff}</staff>`;
    const xml = `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
      <measure number="1"><attributes><divisions>1</divisions><staves>2</staves></attributes>${dyn('p')}${wedge('crescendo', { number: 2, staff: 1, placement: 'above' })}${wedge('diminuendo', { staff: 2, placement: 'below' })}${n('C', 5, 1, onStaff(1))}${n('D', 5, 1, onStaff(1))}${wedge('stop', { number: 2 })}<backup><duration>2</duration></backup>${n('C', 3, 1, onStaff(2))}${n('D', 3, 1, onStaff(2))}</measure>
      <measure number="2">${wedge('stop')}${n('E', 5, 1, onStaff(1))}<backup><duration>1</duration></backup>${n('E', 3, 1, onStaff(2))}</measure>
      </part></score-partwise>`;
    expect(velocities(xml)).toEqual([
      [72, 56],
      [48, 56],
      [74, 62],
      [50, 50],
      [76, 68],
      [52, 44],
    ]);
  });
});
