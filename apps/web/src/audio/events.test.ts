// @vitest-environment node
import { readFileSync } from 'node:fs';
import { parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import {
  GRACE_DURATION_SEC,
  GRACE_LEAD_SEC,
  MIN_DURATION_SEC,
  playEvents,
  playEventsFor,
} from './events.js';
import { noteVelocity } from './instrument.js';

/** The note list the transport and the accompaniment share (issue 184), moved out of transport.ts. */

const shortPiano = parseMusicXml(
  readFileSync(new URL('../../fixtures/short-piano.musicxml', import.meta.url), 'utf8'),
).score;

/** One 4/4 measure of divisions 1 at 120 qpm (a quarter is half a second). */
function piece(items: string[]): string {
  return `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><words>x</words></direction-type><sound tempo="120"/></direction>${items.join('')}</measure></part></score-partwise>`;
}
const note = (step: string, extra = '', duration = 1, type = 'quarter') =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type>${extra}</note>`;
const grace = (step: string) =>
  `<note><grace/><pitch><step>${step}</step><octave>4</octave></pitch><voice>1</voice><type>eighth</type></note>`;
const pedal = (type: string) =>
  `<direction><direction-type><pedal type="${type}" line="yes"/></direction-type></direction>`;
const arpeggiate = '<notations><arpeggiate/></notations>';
const chordNote = (step: string, first: boolean) =>
  `<note>${first ? '' : '<chord/>'}<pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>${arpeggiate}</note>`;

const eventsOf = (xml: string) => playEvents(parseMusicXml(xml).score);

describe('playEvents', () => {
  it('keeps the grace and duration constants the transport had', () => {
    expect(GRACE_LEAD_SEC).toBe(0.05);
    expect(GRACE_DURATION_SEC).toBe(0.1);
    expect(MIN_DURATION_SEC).toBe(0.05);
  });

  it('spreads graces 50 ms before the principal, in document order', () => {
    // C4 at 0, then two graces (E4, F4) before D4 at 0.5 s.
    const events = eventsOf(piece([note('C'), grace('E'), grace('F'), note('D')]));
    const byMidi = new Map(events.map((e) => [e.midi, e]));
    const first = byMidi.get(64)!; // E4: the first of two graces, 100 ms before
    const second = byMidi.get(65)!; // F4: 50 ms before
    expect(first.sec).toBeCloseTo(0.4, 9);
    expect(second.sec).toBeCloseTo(0.45, 9);
    // The cursor marks the principal's onset, not the moved time.
    expect(first.onset).toBeCloseTo(0.5, 9);
    expect(second.onset).toBeCloseTo(0.5, 9);
    expect(first.duration).toBe(GRACE_DURATION_SEC);
    expect(second.duration).toBe(GRACE_DURATION_SEC);
    expect(byMidi.get(62)!.sec).toBeCloseTo(0.5, 9);
  });

  it('never moves a grace before the start of the piece', () => {
    const events = eventsOf(piece([grace('B'), note('C')]));
    const g = events.find((e) => e.midi === 71)!;
    expect(g.sec).toBe(0);
    expect(g.onset).toBe(0);
  });

  it('rolls a marked chord from the low note up, late, with the onset left as written', () => {
    const events = eventsOf(piece([chordNote('C', true), chordNote('E', false)]));
    expect(events.map((e) => e.midi)).toEqual([60, 64]);
    expect(events.map((e) => e.onset)).toEqual([0, 0]);
    expect(events[0]!.sec).toBe(0);
    expect(events[1]!.sec).toBeCloseTo(0.04, 9);
    // A rolled note ends where it was written to end.
    expect(events[0]!.duration).toBeCloseTo(0.5, 9);
    expect(events[1]!.duration).toBeCloseTo(0.46, 9);
  });

  it('holds a pedalled note to the lift', () => {
    const events = eventsOf(
      piece([pedal('start'), note('C'), note('D'), note('E'), pedal('stop'), note('F')]),
    );
    const c = events.find((e) => e.midi === 60)!;
    const f = events.find((e) => e.midi === 65)!;
    expect(c.duration).toBeCloseTo(1.5, 9); // to the lift at 1.5 s, not to 0.5 s
    expect(f.duration).toBeCloseTo(0.5, 9);
  });

  it('realises a trill into attacks, each limited by the ornament', () => {
    const trilled = piece([
      note('C', '<notations><ornaments><trill-mark beats="9"/></ornaments></notations>', 2, 'half'),
    ]);
    const events = eventsOf(trilled);
    expect(events).toHaveLength(9);
    expect(events.map((e) => e.midi)).toEqual([60, 62, 60, 62, 60, 62, 60, 62, 60]);
    expect(events[0]!.onset).toBe(0);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.onset).toBeCloseTo(events[i - 1]!.onset + events[i - 1]!.duration, 9);
    }
    // Every attack but the closing principal carries the ornament's end.
    expect(events.slice(0, -1).every((e) => e.ornamentEnd !== undefined)).toBe(true);
    expect(events.at(-1)!.ornamentEnd).toBeUndefined();
  });

  it('gives each note its velocity: the score own, else its hand', () => {
    const marked = playEvents(shortPiano);
    expect(marked).toHaveLength(shortPiano.notes.length);
    expect(new Set(marked.map((e) => e.velocity))).toEqual(
      new Set(shortPiano.notes.map(noteVelocity)),
    );
    const unmarked = playEvents({
      ...shortPiano,
      notes: shortPiano.notes.map(({ velocity: _, ...n }) => n),
    });
    expect(new Set(unmarked.filter((e) => e.hand === 'R').map((e) => e.velocity))).toEqual(
      new Set([96]),
    );
    expect(new Set(unmarked.filter((e) => e.hand === 'L').map((e) => e.velocity))).toEqual(
      new Set([88]),
    );
  });

  it('sorts by sounding time, simultaneous notes keeping score order', () => {
    const events = eventsOf(piece([note('E'), grace('C'), note('D')]));
    const secs = events.map((e) => e.sec);
    expect(secs).toEqual([...secs].sort((a, b) => a - b));
    expect(playEvents(shortPiano).map((e) => e.sec)).toEqual(
      [...playEvents(shortPiano).map((e) => e.sec)].sort((a, b) => a - b),
    );
  });
});

describe('playEventsFor', () => {
  it('returns the same array for the same score, and its own for another', () => {
    const a = playEventsFor(shortPiano);
    expect(playEventsFor(shortPiano)).toBe(a);
    expect(a).toEqual(playEvents(shortPiano));
    const other = parseMusicXml(piece([note('C')])).score;
    expect(playEventsFor(other)).not.toBe(a);
    expect(playEventsFor(other)).toHaveLength(1);
  });
});
