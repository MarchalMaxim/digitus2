import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './read.js';

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

const SOTW = fixture('../../../fixtures/arpeggiate-sound-of-the-wind.musicxml');

const quarter = (step: string, extra = '', chord = false) =>
  `<note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>${extra}</note>`;

/** One 4/4 measure of divisions 1 at 120 qpm: `parts` are the item lists of each part. */
function piece(...parts: string[][]): string {
  const list = parts.map((_, i) => `<score-part id="P${i}"><part-name>P</part-name></score-part>`);
  const body = parts.map(
    (items, i) =>
      `<part id="P${i}"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><words>x</words></direction-type><sound tempo="120"/></direction>${items.join('')}</measure></part>`,
  );
  return `<score-partwise><part-list>${list.join('')}</part-list>${body.join('')}</score-partwise>`;
}

const pedal = (attrs: string) =>
  `<direction><direction-type><pedal ${attrs}/></direction-type></direction>`;
const four = (...marks: Array<string | undefined>) =>
  ['C', 'D', 'E', 'F'].map((s, i) => (marks[i] ?? '') + quarter(s));

describe('arpeggiate in the Sound of the Wind opening', () => {
  const { score, warnings } = parseMusicXml(SOTW);
  const rolled = score.notes.filter((n) => n.arpeggio);

  it('reads the two bars without warnings', () => {
    expect(warnings).toEqual([]);
    expect(score.notes).toHaveLength(13);
  });
  it('marks every rolled chord note and leaves the single G6 alone', () => {
    expect(rolled).toHaveLength(12);
    expect(rolled.every((n) => n.arpeggio!.direction === 'up')).toBe(true);
    expect(rolled.every((n) => n.arpeggio!.number === undefined)).toBe(true);
    expect(score.notes.find((n) => n.midi === 91)!.arpeggio).toBeUndefined();
  });
  it('keeps the written onsets', () => {
    const at = (sec: number) =>
      score.notes
        .filter((n) => n.onsetSec === sec)
        .map((n) => n.midi)
        .sort((a, b) => a - b);
    expect(at(0)).toEqual([67, 74, 79]);
    expect(at(1.5)).toEqual([74, 79, 86]);
  });
  it('reads the tied G5 of bar 2 with its mark', () => {
    const tied = score.notes.find((n) => n.midi === 79 && n.onsetSec === 4.5)!;
    expect(tied.offsetSec).toBe(6);
    expect(tied.arpeggio).toEqual({ direction: 'up' });
  });
  it('has no pedal marks', () => {
    expect(score.pedals).toBeUndefined();
  });
});

describe('arpeggiate variants', () => {
  const rollOf = (mark: string) =>
    parseMusicXml(piece([quarter('C', `<notations>${mark}</notations>`)])).score.notes[0]!.arpeggio;

  it('keeps a down direction and the number', () => {
    expect(rollOf('<arpeggiate direction="down" number="2"/>')).toEqual({
      direction: 'down',
      number: 2,
    });
  });
  it('drops a number that is not a positive integer', () => {
    expect(rollOf('<arpeggiate number="0"/>')).toEqual({ direction: 'up' });
    expect(rollOf('<arpeggiate number="x"/>')).toEqual({ direction: 'up' });
  });
  it('does not read a non-arpeggiate bracket as a roll', () => {
    expect(rollOf('<non-arpeggiate type="top"/>')).toBeUndefined();
  });
  it('ignores a mark on a grace note', () => {
    const grace = `<note><grace/><pitch><step>B</step><octave>3</octave></pitch><voice>1</voice><notations><arpeggiate/></notations></note>`;
    const { score } = parseMusicXml(piece([grace, quarter('C')]));
    expect(score.notes.find((n) => n.isGrace)!.arpeggio).toBeUndefined();
  });
});

describe('pedal marks', () => {
  const events = (xml: string) => parseMusicXml(xml).score.pedals;

  it('reads the line variant: start, change, stop', () => {
    const xml = piece(
      four(
        pedal('type="start" line="yes"'),
        undefined,
        pedal('type="change" line="yes"'),
        pedal('type="stop" line="yes"'),
      ),
    );
    expect(events(xml)).toEqual([
      { tick: 0, sec: 0, type: 'down' },
      { tick: 2, sec: 1, type: 'change' },
      { tick: 3, sec: 1.5, type: 'up' },
    ]);
  });
  it('reads the sign variant the same way', () => {
    const xml = piece(
      four(
        pedal('type="start" line="no" sign="yes"'),
        undefined,
        pedal('type="change" line="no" sign="yes"'),
        pedal('type="stop" line="no" sign="yes"'),
      ),
    );
    expect(events(xml)).toEqual([
      { tick: 0, sec: 0, type: 'down' },
      { tick: 2, sec: 1, type: 'change' },
      { tick: 3, sec: 1.5, type: 'up' },
    ]);
  });
  it('reads resume as down and discontinue as up', () => {
    const xml = piece(four(pedal('type="resume"'), pedal('type="discontinue"')));
    expect(events(xml)!.map((e) => e.type)).toEqual(['down', 'up']);
  });
  it('reads a damper-pedal sound inside a direction and as a measure child', () => {
    const inside = (v: string) =>
      `<direction><direction-type><words>p</words></direction-type><sound damper-pedal="${v}"/></direction>`;
    const child = (v: string) => `<sound damper-pedal="${v}"/>`;
    const types = (...marks: string[]) =>
      events(piece(marks.map((m, i) => m + quarter('CDEF'[i]!))))!.map((e) => e.type);
    expect(types(inside('yes'), child('no'), inside('50'), child('0'))).toEqual([
      'down',
      'up',
      'down',
      'up',
    ]);
  });
  it('reads a direction that has both a pedal and a damper-pedal sound once', () => {
    const both = `<direction><direction-type><pedal type="start" line="yes"/></direction-type><sound damper-pedal="yes"/></direction>`;
    expect(events(piece([both, quarter('C')]))).toEqual([{ tick: 0, sec: 0, type: 'down' }]);
  });
  it('ignores continue and sostenuto', () => {
    const xml = piece(four(pedal('type="continue"'), pedal('type="sostenuto"')));
    expect(events(xml)).toBeUndefined();
  });
  it('orders a stop and a start on one tick as a re-pedal in either document order', () => {
    const stop = pedal('type="stop"');
    const start = pedal('type="start"');
    const a = events(piece(four(start, undefined, stop + start, undefined)));
    const b = events(piece(four(start, undefined, start + stop, undefined)));
    expect(a!.map((e) => e.type)).toEqual(['down', 'up', 'down']);
    expect(b).toEqual(a);
  });
  it('collects a pedal written in the second part', () => {
    const xml = piece(four(), four(pedal('type="start"'), pedal('type="stop"')));
    expect(events(xml)).toEqual([
      { tick: 0, sec: 0, type: 'down' },
      { tick: 1, sec: 0.5, type: 'up' },
    ]);
  });
  it('honours a direction offset that moves its sound', () => {
    const late = `<direction><direction-type><pedal type="start"/></direction-type><offset sound="yes">2</offset></direction>`;
    expect(events(piece([late, ...four()]))).toEqual([{ tick: 2, sec: 1, type: 'down' }]);
  });
  it('reads the Mendelssohn Op. 30 No. 6 sign pedals, with a re-pedal in bars 25 and 26', () => {
    const xml = fixture(
      '../../../../../content/scores/mendelssohn-op30-no6-venetian-boat-song.musicxml',
    );
    const { measures, pedals } = parseMusicXml(xml).score;
    expect(pedals).toHaveLength(57);
    expect(pedals!.filter((p) => p.type === 'down')).toHaveLength(29);
    expect(pedals!.filter((p) => p.type === 'up')).toHaveLength(28);
    const [bar25, bar26] = [measures[25]!, measures[26]!];
    expect([bar25.number, bar26.number]).toEqual(['25', '26']);
    const near = pedals!.filter((p) => p.tick >= bar25.startTick && p.tick < bar26.startTick + 60);
    // Bar 25 presses the pedal and bar 26 presses it again with no lift between.
    expect(near.map((p) => [p.tick, p.type])).toEqual([
      [bar25.startTick, 'down'],
      [bar26.startTick, 'down'],
    ]);
  });
  it('reads Chopin Op. 28 No. 4 as 24 pedals down and 24 up', () => {
    const xml = fixture('../../../../../content/scores/chopin-prelude-op28-no4.musicxml');
    const pedals = parseMusicXml(xml).score.pedals!;
    expect(pedals).toHaveLength(48);
    expect(pedals.filter((p) => p.type === 'down')).toHaveLength(24);
    expect(pedals.filter((p) => p.type === 'up')).toHaveLength(24);
  });
});
