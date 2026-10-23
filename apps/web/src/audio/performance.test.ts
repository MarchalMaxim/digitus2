// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMusicXml } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { createSilentInstrument } from './instrument.js';
import {
  pedalStops,
  loopStartSec,
  performanceLoop,
  performanceOf,
  toPerformanceSec,
  toWrittenSec,
} from './performance.js';
import { Transport } from './transport.js';

const sotw = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../packages/engine/fixtures/arpeggiate-sound-of-the-wind.musicxml',
      import.meta.url,
    ),
  ),
  'utf8',
);

const venetian = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../content/scores/mendelssohn-op30-no6-venetian-boat-song.musicxml',
      import.meta.url,
    ),
  ),
  'utf8',
);

const form = (name: string): string =>
  readFileSync(
    fileURLToPath(
      new URL(`../../../../packages/engine/fixtures/${name}.musicxml`, import.meta.url),
    ),
    'utf8',
  );

/** One 4/4 measure of divisions 1 at 120 qpm (a quarter is half a second). */
function piece(items: string[]): string {
  return `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><words>x</words></direction-type><sound tempo="120"/></direction>${items.join('')}</measure></part></score-partwise>`;
}

const note = (step: string, extra = '', duration = 1, type = 'quarter') =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type>${extra}</note>`;
const pedal = (type: string, line = 'yes') =>
  `<direction><direction-type><pedal type="${type}" line="${line}"/></direction-type></direction>`;
const damper = (value: string) => `<sound damper-pedal="${value}"/>`;
const roll = (direction = '') => `<notations><arpeggiate ${direction}/></notations>`;

function setup(source: string, loop?: { from: number; to: number }) {
  const { score } = parseMusicXml(source);
  const ctx = { currentTime: 100 };
  const instrument = createSilentInstrument();
  const t = new Transport(
    { score, ctx, instrument, setInterval: (() => 0) as never, clearInterval: () => {} },
    { startDelaySec: 0, lookAheadSec: 0.15 },
  );
  if (loop) t.setLoop(loop);
  t.play();
  for (let i = 0; i <= 8 * 200; i++) {
    ctx.currentTime = 100 + i / 200;
    t.step();
  }
  const heard = instrument.events
    .map((e) => [e.midi, e.time - 100, e.duration] as const)
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return { score, heard };
}

function expectHeard(
  heard: ReadonlyArray<readonly [number, number, number]>,
  expected: number[][],
): void {
  expect(heard).toHaveLength(expected.length);
  expected.forEach((want, i) => {
    want.forEach((value, j) => expect(heard[i]![j]).toBeCloseTo(value, 6));
  });
}

/** C4 D4 E4 F4 with the given items placed before the notes of the same index. */
const cdef = (before: Record<number, string> = {}, after = '') =>
  [...'CDEF'].map((s, i) => (before[i] ?? '') + note(s)).concat(after);

describe('rolled chords through the real transport', () => {
  it('rolls the Sound of the Wind opening from the low note up and stops each note on time', () => {
    const { heard } = setup(sotw);
    expectHeard(heard, [
      [67, 0, 1.5],
      [74, 0.04, 1.46],
      [79, 0.08, 1.42],
      [74, 1.5, 1.5],
      [79, 1.54, 1.46],
      [86, 1.58, 1.42],
      [67, 3, 1.5],
      [74, 3.04, 1.46],
      [79, 3.08, 1.42],
      [74, 4.5, 0.75],
      [79, 4.54, 1.46],
      [86, 4.58, 0.67],
      [91, 5.25, 0.75],
    ]);
  });

  it('rolls a down chord from the top note', () => {
    const chord = (step: string, first: boolean) =>
      `<note>${first ? '' : '<chord/>'}<pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>${roll('direction="down"')}</note>`;
    const { heard } = setup(piece([chord('C', true), chord('E', false), chord('G', false)]));
    expectHeard(heard, [
      [67, 0, 0.5],
      [64, 0.04, 0.46],
      [60, 0.08, 0.42],
    ]);
  });

  it('caps a roll at a quarter of the shortest note', () => {
    const sixteenth = (step: string, first: boolean) =>
      `<note>${first ? '' : '<chord/>'}<pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type>${roll()}</note>`;
    const source = piece([
      sixteenth('C', true),
      sixteenth('E', false),
      sixteenth('G', false),
      sixteenth('B', false),
    ]).replace('<divisions>1</divisions>', '<divisions>4</divisions>');
    const { heard } = setup(source);
    // A 16th at 120 qpm lasts 0.125 s; three gaps share a quarter of it.
    expectHeard(heard, [
      [60, 0, 0.125],
      [64, 0.0104167, 0.1145833],
      [67, 0.0208333, 0.1041667],
      [71, 0.03125, 0.09375],
    ]);
  });

  it('leaves the written notes of the score alone', () => {
    const before = parseMusicXml(sotw).score.notes.map((n) => [n.onsetSec, n.offsetSec]);
    const { score } = setup(sotw);
    expect(score.notes.map((n) => [n.onsetSec, n.offsetSec])).toEqual(before);
  });
});

describe('the damper pedal through the real transport', () => {
  it('holds a note to the lift and no further', () => {
    const { heard } = setup(piece(cdef({ 0: pedal('start'), 3: pedal('stop') })));
    expectHeard(heard, [
      [60, 0, 1.5],
      [62, 0.5, 1],
      [64, 1, 0.5],
      [65, 1.5, 0.5],
    ]);
  });

  it('ends a held note at a change, and holds to the end of the piece when never lifted', () => {
    const { heard } = setup(piece(cdef({ 0: pedal('start'), 2: pedal('change') })));
    expectHeard(heard, [
      [60, 0, 1],
      [62, 0.5, 0.5],
      [64, 1, 1],
      [65, 1.5, 0.5],
    ]);
  });

  it.each([
    ['stop first', pedal('stop') + pedal('start')],
    ['start first', pedal('start') + pedal('stop')],
  ])('treats a stop and a start on one tick as a change (%s)', (_, mark) => {
    const { heard } = setup(piece(cdef({ 0: pedal('start'), 2: mark })));
    expectHeard(heard, [
      [60, 0, 1],
      [62, 0.5, 0.5],
      [64, 1, 1],
      [65, 1.5, 0.5],
    ]);
  });

  it('does not hold a note that ends as the pedal goes down', () => {
    const { heard } = setup(piece(cdef({ 1: pedal('start') })));
    expectHeard(heard, [
      [60, 0, 0.5],
      [62, 0.5, 1.5],
      [64, 1, 1],
      [65, 1.5, 0.5],
    ]);
  });

  it('re-strikes a key that is struck again while held', () => {
    const items = [note('C'), note('C'), note('D'), note('C'), pedal('stop')];
    items.unshift(pedal('start'));
    const { heard } = setup(piece(items));
    expectHeard(heard, [
      [60, 0, 0.5],
      [60, 0.5, 1],
      [62, 1, 1],
      [60, 1.5, 0.5],
    ]);
  });

  it('reads a damper-pedal sound the same way as a pedal mark', () => {
    const { heard } = setup(piece(cdef({ 0: damper('yes'), 3: damper('no') })));
    expectHeard(heard, [
      [60, 0, 1.5],
      [62, 0.5, 1],
      [64, 1, 0.5],
      [65, 1.5, 0.5],
    ]);
  });

  it('keeps a trill and a grace note as long as before', () => {
    const grace = `<note><grace/><pitch><step>B</step><octave>3</octave></pitch><voice>1</voice><type>eighth</type></note>`;
    const trill = '<notations><ornaments><trill-mark/></ornaments></notations>';
    const plain = setup(piece([grace, note('C', trill, 2, 'half'), note('E', '', 2, 'half')]));
    const held = setup(
      piece([
        pedal('start'),
        grace,
        note('C', trill, 2, 'half'),
        note('E', '', 2, 'half'),
        pedal('stop'),
      ]),
    );
    const ornamented = (r: typeof plain) => r.heard.filter((e) => e[1] < 1);
    expect(ornamented(held)).toEqual(ornamented(plain));
    expect(held.heard.length).toBe(plain.heard.length);
  });

  it('ends a pedal held down at a second press, not at the next lift', () => {
    const { heard } = setup(
      piece(cdef({ 0: pedal('start'), 2: pedal('start'), 3: pedal('stop') })),
    );
    expectHeard(heard, [
      [60, 0, 1],
      [62, 0.5, 0.5],
      [64, 1, 0.5],
      [65, 1.5, 0.5],
    ]);
  });

  it('never rings past the end of a loop', () => {
    // Two bars (4 s); the pedal goes down in bar 1 and lifts in bar 2, the keys of bar 2 differ.
    const twoBars = piece([pedal('start'), ...[...'CDEF'].map((s) => note(s))]).replace(
      '</measure>',
      `</measure><measure number="2">${[...'GABC'].map((s, i) => (i === 3 ? pedal('stop') : '') + note(s)).join('')}</measure>`,
    );
    const first = (r: { heard: ReadonlyArray<readonly [number, number, number]> }) =>
      r.heard.filter((e) => e[1] < 2);
    const looped = first(setup(twoBars, { from: 0, to: 0 }));
    const open = first(setup(twoBars));
    expect(looped).toHaveLength(4);
    expect(open).toHaveLength(4);
    for (const [, time, duration] of looped) expect(time + duration).toBeLessThanOrEqual(2 + 1e-9);
    // Without the loop the same bar-1 notes ring on into bar 2: the loop is what stops them.
    expect(open.some(([, time, duration]) => time + duration > 2 + 1e-6)).toBe(true);
  });
});

describe('pedalStops on a real score', () => {
  it('lets a second press in Mendelssohn Op. 30 No. 6 end the first, bars 25 and 26', () => {
    const { score } = parseMusicXml(venetian);
    const press25 = score.pedals!.find((p) => p.tick === score.measures[25]!.startTick)!;
    const press26 = score.pedals!.find((p) => p.tick === score.measures[26]!.startTick)!;
    const lift = score.pedals!.find((p) => p.tick > press26.tick && p.type === 'up')!;
    expect([press25.type, press26.type]).toEqual(['down', 'down']);
    // The next lift is much later; the second press is what ends the first stretch.
    expect(lift.sec).toBeGreaterThan(press26.sec + 3);
    const held = pedalStops(score);
    const early = score.notes.filter(
      (n) => held.has(n.id) && n.offsetSec > press25.sec && n.offsetSec < press26.sec - 1e-9,
    );
    expect(early.length).toBeGreaterThan(0);
    for (const n of early) expect(held.get(n.id)!).toBeLessThanOrEqual(press26.sec + 1e-9);
  });
});

describe('a score in performance order', () => {
  // The form fixtures: whole notes C D E F G A, four beats at 120 qpm, so two seconds a bar.
  const repeat = parseMusicXml(form('form-repeat')).score;
  const voltas = parseMusicXml(form('form-voltas')).score;
  const fine = parseMusicXml(form('form-dc-al-fine')).score;

  it('unfolds a repeat into the bars in the order heard, each note once per hearing', () => {
    const perf = performanceOf(repeat);
    expect(perf.written).toEqual([0, 1, 0, 1]);
    expect(perf.score.measures.map((m) => m.index)).toEqual([0, 1, 2, 3]);
    expect(perf.score.measures.map((m) => m.number)).toEqual(['1', '2', '1', '2']);
    expect(perf.score.notes).toHaveLength(4);
    expect(new Set(perf.score.notes.map((n) => n.id)).size).toBe(4);
    expect(perf.score.notes.map((n) => [n.midi, n.onsetSec, n.offsetSec, n.measureIndex])).toEqual([
      [60, 0, 2, 0],
      [62, 2, 4, 1],
      [60, 4, 6, 2],
      [62, 6, 8, 3],
    ]);
    expect(repeat.notes).toHaveLength(2); // the written score is left alone
  });

  it('returns the written score itself when nothing repeats, or when a mark changes nothing', () => {
    const plain = parseMusicXml(form('two-staff')).score;
    expect(performanceOf(plain).score).toBe(plain);
    const lone = parseMusicXml(form('form-dc-al-fine')).score;
    lone.measures.forEach((m) => delete m.form);
    expect(performanceOf(lone).identity).toBe(true);
    // A Fine with no D.C. to lead back to leaves the order as written.
    lone.measures[1]!.form = { fine: true };
    const perf = performanceOf(lone);
    expect(perf.identity).toBe(true);
    expect(perf.score).toBe(lone);
  });

  it('keeps the tempo in force and puts the measure numbers of the written bars', () => {
    const perf = performanceOf(repeat);
    expect(perf.score.tempoMap).toEqual([{ tick: 0, qpm: 120 }]);
    expect(perf.score.measures[2]).toMatchObject({ startTick: 8, lengthTicks: 4 });
  });

  it('moves a time in the performance to the written bar, and back', () => {
    const perf = performanceOf(repeat);
    expect(toWrittenSec(perf, 5)).toBeCloseTo(1, 9);
    expect(toWrittenSec(perf, 8)).toBeCloseTo(4, 9);
    expect(toWrittenSec(perf, 3)).toBeCloseTo(3, 9);
    // A bar heard twice: forward to its next hearing, back to its last.
    expect(toPerformanceSec(perf, 2, 5)).toBeCloseTo(6, 9);
    expect(toPerformanceSec(perf, 2, 1)).toBeCloseTo(2, 9);
    expect(toPerformanceSec(perf, 1, 6.5)).toBeCloseTo(5, 9);
    expect(toPerformanceSec(perf, 0.5, 0)).toBeCloseTo(0.5, 9);
    expect(toPerformanceSec(perf, 0, 7)).toBe(0); // the top is the top
  });

  it('loops a stretch that plays the bars in a row (the one the music is in, else the first), else from a hearing to the next end', () => {
    const perf = performanceOf(repeat);
    expect(performanceLoop(perf, { from: 0, to: 1 })).toEqual({ from: 0, to: 4 });
    expect(performanceLoop(perf, { from: 1, to: 1 })).toEqual({ from: 2, to: 4 });
    expect(performanceLoop(perf, { from: 1, to: 0 })).toBeNull();
    expect(performanceLoop(perf, null)).toBeNull();
    // Bars 1 and 2 are heard in a row twice: the loop takes the stretch the music is in.
    expect(performanceLoop(perf, { from: 0, to: 1 }, 3)).toEqual({ from: 0, to: 4 });
    expect(performanceLoop(perf, { from: 0, to: 1 }, 5)).toEqual({ from: 4, to: 8 });
    expect(performanceLoop(perf, { from: 1, to: 1 }, 6.5)).toEqual({ from: 6, to: 8 });
    // 0 1 2 | 0 1 | 3: bars 2 and 3 are not heard in a row.
    expect(performanceLoop(performanceOf(voltas), { from: 2, to: 3 })).toEqual({ from: 4, to: 12 });
    // With the music anywhere in 4..12 the stretch is the same one.
    expect(performanceLoop(performanceOf(voltas), { from: 2, to: 3 }, 9)).toEqual({
      from: 4,
      to: 12,
    });
  });

  it('starts a loop, before any transport, where the loop starts unless the start lies inside it', () => {
    const perf = performanceOf(repeat);
    // Bars 1 2 | 1 2: the loop over bar 2 runs from perf 2 (written 2). A start at the top is
    // outside it; a start in bar 2 is inside it.
    expect(loopStartSec(perf, { from: 1, to: 1 }, 0)).toBeCloseTo(2, 9);
    expect(loopStartSec(perf, { from: 1, to: 1 }, 3)).toBeCloseTo(3, 9);
    expect(loopStartSec(perf, null, 1)).toBe(1);
  });

  it('ends at the Fine on the second hearing of a D.C. al Fine', () => {
    const perf = performanceOf(fine);
    expect(perf.written).toEqual([0, 1, 2, 3, 0, 1]);
    expect(perf.score.notes.map((n) => n.midi)).toEqual([60, 62, 64, 65, 60, 62]);
    expect(toWrittenSec(perf, 12)).toBeCloseTo(4, 9);
  });

  it('shifts pedal marks with their bar and restates the pedal where a jump arrives', () => {
    const { score } = parseMusicXml(
      piece([pedal('start'), note('C'), note('D'), pedal('stop'), note('E'), note('F')]).replace(
        '</measure>',
        '<barline location="right"><repeat direction="backward"/></barline></measure>',
      ),
    );
    const perf = performanceOf(score);
    expect(perf.written).toEqual([0, 0]);
    // Lifted before the end of the bar: the second hearing opens with the pedal down again.
    expect(perf.score.pedals!.map((p) => [p.type, p.sec])).toEqual([
      ['down', 0],
      ['up', 1],
      ['down', 2],
      ['up', 3],
    ]);
  });

  it('restates the pedal where a jump arrives: down when it is held over, up when it was lifted', () => {
    // Bars 1 2 3 with a repeat over bars 2 and 3: the order is 1 2 3 2 3, and the second hearing of
    // bar 2 arrives by a jump, from the end of bar 3.
    const bars = (first: string[]) =>
      `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><words>x</words></direction-type><sound tempo="120"/></direction>${first.join('')}</measure><measure number="2"><barline location="left"><repeat direction="forward"/></barline>${note('D')}${note('D')}${note('D')}${note('D')}</measure><measure number="3">${note('E')}${note('E')}${note('E')}${note('E')}<barline location="right"><repeat direction="backward"/></barline></measure></part></score-partwise>`;
    const four = [note('C'), note('C'), note('C'), note('C')];
    const held = performanceOf(parseMusicXml(bars([pedal('start'), ...four])).score);
    expect(held.written).toEqual([0, 1, 2, 1, 2]);
    // Pressed in bar 1 and never lifted: it is down where the jump arrives, at 6 s.
    expect(held.score.pedals!.map((p) => [p.type, p.sec])).toEqual([
      ['down', 0],
      ['down', 6],
    ]);
    const lifted = performanceOf(
      parseMusicXml(
        bars([pedal('start'), note('C'), note('C'), pedal('stop'), note('C'), note('C')]),
      ).score,
    );
    expect(lifted.score.pedals!.map((p) => [p.type, p.sec])).toEqual([
      ['down', 0],
      ['up', 1],
      ['up', 6],
    ]);
  });

  it('cuts a note tied over a jump at the end of its bar, and lets one ring on in a row', () => {
    const tied = (type: string) => `<notations><tied type="${type}"/></notations>`;
    const bar = (n: number, body: string, extra = '') =>
      `<measure number="${n}">${n === 1 ? '<attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><words>x</words></direction-type><sound tempo="120"/></direction>' : ''}${body}${extra}</measure>`;
    const n = (step: string, tie: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type>${tie ? `<tie type="${tie}"/>${tied(tie)}` : ''}</note>`;
    const source = `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P">${bar(1, n('C', ''))}${bar(2, n('D', 'start'), '<barline location="right"><repeat direction="backward"/></barline>')}${bar(3, n('D', 'stop'))}</part></score-partwise>`;
    const { score } = parseMusicXml(source);
    const perf = performanceOf(score);
    expect(perf.written).toEqual([0, 1, 0, 1, 2]);
    const d = perf.score.notes.filter((x) => x.midi === 62);
    // The first D is tied into a bar that does not follow it; only the last one runs into bar 3.
    expect(d.map((x) => [x.onsetSec, x.offsetSec])).toEqual([
      [1, 2],
      [3, 5],
    ]);
  });
});
