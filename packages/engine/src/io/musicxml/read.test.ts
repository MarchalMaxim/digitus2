import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
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
