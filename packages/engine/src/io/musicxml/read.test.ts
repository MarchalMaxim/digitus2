import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './read.js';

const xml = readFileSync(fileURLToPath(new URL('../../../fixtures/two-staff.musicxml', import.meta.url)), 'utf8');

describe('parseMusicXml notes', () => {
  const { score, editorial, warnings } = parseMusicXml(xml);
  const byMidiHand = (midi: number, hand: 'L' | 'R') => score.notes.filter((n) => n.midi === midi && n.hand === hand);

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
    expect(score.notes.map((n) => [n.midi, n.hand])).toEqual([[72, 'R'], [48, 'L']]);
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
  const wrap = (direction: string) => `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>${direction}<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
  it('converts a dotted-quarter metronome to quarters per minute', () => {
    const { score } = parseMusicXml(wrap('<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome></direction-type></direction>'));
    expect(score.tempoMap[0]!.qpm).toBeCloseTo(90);
  });
  it('prefers sound tempo over the metronome text', () => {
    const { score } = parseMusicXml(wrap('<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><sound tempo="120"/></direction>'));
    expect(score.tempoMap[0]!.qpm).toBe(120);
  });
  it('defaults to 120 when nothing is marked', () => {
    const { score } = parseMusicXml(wrap(''));
    expect(score.tempoMap).toEqual([{ tick: 0, qpm: 120 }]);
  });
});
