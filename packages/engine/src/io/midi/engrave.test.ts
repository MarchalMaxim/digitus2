import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { finalizeScore } from '../../score/build.js';
import { midiToSpelling } from '../../score/pitch.js';
import type { Hand, Note, Score, TempoEvent } from '../../score/types.js';
import { childElements, childText, firstChild, parseXml, type Element } from '../musicxml/dom.js';
import { parseMusicXml } from '../musicxml/read.js';
import { durationTable, expressDuration, scoreToMusicXml } from './engrave.js';
import { quantize } from './quantize.js';
import { parseMidiFile } from './read.js';
import { midiToScore } from './toScore.js';

type Spec = [number, number, number, Hand?, boolean?];
function scoreOf(
  spec: Spec[],
  opts: { time?: [number, number]; key?: number; measures?: number; tempos?: TempoEvent[] } = {},
): Score {
  const D = 480;
  const [beats, beatType] = opts.time ?? [4, 4];
  const length = (beats * 4 * D) / beatType;
  const count = opts.measures ?? Math.ceil(Math.max(1, ...spec.map((s) => s[1])) / length);
  return finalizeScore({
    meta: { title: 'Test' },
    divisions: D,
    tempoMap: opts.tempos ?? [{ tick: 0, qpm: 120 }],
    timeSignatures: [{ tick: 0, beats, beatType }],
    keySignatures: [{ tick: 0, fifths: opts.key ?? 0 }],
    measures: Array.from({ length: count }, (_, i) => ({
      index: i,
      startTick: i * length,
      lengthTicks: length,
      number: String(i + 1),
    })),
    notes: spec.map(([onset, offset, midi, hand = 'R', grace = false], i): Note => ({
      id: `x${i}`,
      onsetTick: onset,
      offsetTick: offset,
      onsetSec: 0,
      offsetSec: 0,
      midi,
      spelling: midiToSpelling(midi),
      hand,
      staff: hand === 'R' ? 1 : 2,
      voice: hand === 'R' ? 1 : 5,
      measureIndex: Math.floor(onset / length),
      isGrace: grace,
      chordId: '',
      sourceIndices: [],
    })),
  });
}

interface XmlNote {
  measure: number;
  id: string | null;
  rest: boolean;
  measureRest: boolean;
  grace: boolean;
  duration: number;
  type: string | null;
  dots: number;
  triplet: boolean;
  staff: number;
  voice: number;
  accidental: string | null;
  ties: string[];
  beam: string | null;
  tuplets: string[];
}
function notesOf(xml: string): XmlNote[] {
  const part = childElements(parseXml(xml).documentElement!, 'part')[0]!;
  return childElements(part, 'measure').flatMap((measure, index) =>
    childElements(measure, 'note').map((el: Element) => {
      const rest = firstChild(el, 'rest');
      const notations = firstChild(el, 'notations');
      return {
        measure: index,
        id: el.getAttribute('id') || null,
        rest: rest !== undefined,
        measureRest: rest?.getAttribute('measure') === 'yes',
        grace: firstChild(el, 'grace') !== undefined,
        duration: Number(childText(el, 'duration') ?? '0'),
        type: childText(el, 'type') ?? null,
        dots: childElements(el, 'dot').length,
        triplet: firstChild(el, 'time-modification') !== undefined,
        staff: Number(childText(el, 'staff')),
        voice: Number(childText(el, 'voice')),
        accidental: childText(el, 'accidental') ?? null,
        ties: childElements(el, 'tie').map((t) => t.getAttribute('type') ?? ''),
        beam: childText(el, 'beam') ?? null,
        tuplets: notations
          ? childElements(notations, 'tuplet').map((t) => t.getAttribute('type') ?? '')
          : [],
      };
    }),
  );
}
const QUARTERS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
  '64th': 0.0625,
};
const valueTicks = (n: XmlNote) =>
  480 * QUARTERS[n.type!]! * (n.dots ? 1.5 : 1) * (n.triplet ? 2 / 3 : 1);
const noteKey = (n: Note) => `${n.onsetTick}:${n.offsetTick}:${n.midi}:${n.hand}`;
function readBack(original: Score, xml: string): Score {
  const back = parseMusicXml(xml);
  expect(back.score.notes.map(noteKey).sort()).toEqual(original.notes.map(noteKey).sort());
  expect(back.warnings.filter((w) => /tie/.test(w))).toEqual([]);
  return back.score;
}
const sounding = (xml: string) => notesOf(xml).filter((n) => !n.rest);

describe('note values', () => {
  it('expresses lengths with standard values, longest first, without double dots', () => {
    // at 2 divisions: dotted whole, whole, dotted half, half, dotted quarter, quarter, eighth
    expect(durationTable(2, false).map((d) => d.ticks)).toEqual([12, 8, 6, 4, 3, 2, 1]);
    expect(expressDuration(600, 480, false)!.map((d) => [d.type, d.dots])).toEqual([
      ['quarter', 0],
      ['16th', 0],
    ]);
    expect(expressDuration(840, 480, false)!.map((d) => [d.type, d.dots])).toEqual([
      ['quarter', 1],
      ['16th', 0],
    ]);
    expect(expressDuration(160, 480, true)).toEqual([
      { type: 'eighth', dots: 0, triplet: true, ticks: 160 },
    ]);
    expect(expressDuration(7, 480, false)).toBeNull();
  });
});

describe('scoreToMusicXml', () => {
  it('writes one part with two staves, treble and bass clefs, divisions, key, time, tempo and an escaped title', () => {
    const xml = scoreToMusicXml(scoreOf([[0, 480, 60]]), {
      title: 'Fish & Chips <3>',
      composer: 'Anon',
    });
    expect(xml).toContain('<work-title>Fish &amp; Chips &lt;3&gt;</work-title>');
    expect(xml).toContain('<creator type="composer">Anon</creator>');
    expect(xml.match(/<score-part id="P1">/g)).toHaveLength(1);
    expect(xml).toContain('<divisions>480</divisions>');
    expect(xml).toContain('<key><fifths>0</fifths></key>');
    expect(xml).toContain('<time><beats>4</beats><beat-type>4</beat-type></time>');
    expect(xml).toContain('<staves>2</staves>');
    expect(xml).toContain('<clef number="1"><sign>G</sign><line>2</line></clef>');
    expect(xml).toContain('<clef number="2"><sign>F</sign><line>4</line></clef>');
    expect(xml).toContain('<sound tempo="120"/>');
    expect(xml).toContain('<note id="x0">');
  });
  it('fills gaps with rests split at beats and gives an empty staff a whole-measure rest', () => {
    const s = scoreOf([
      [0, 480, 60],
      [960, 1440, 64],
    ]);
    const xml = scoreToMusicXml(s);
    const ns = notesOf(xml);
    expect(
      ns.filter((n) => n.staff === 1).map((n) => (n.rest ? `rest ${n.type}` : n.type)),
    ).toEqual(['quarter', 'rest quarter', 'quarter', 'rest quarter']);
    expect(ns.filter((n) => n.staff === 2)).toMatchObject([
      { measureRest: true, duration: 1920, voice: 5 },
    ]);
    readBack(s, xml);
  });
  it('ties a note across a barline and writes its id once', () => {
    const s = scoreOf([[1440, 2400, 67]], { measures: 2 });
    const xml = scoreToMusicXml(s);
    expect(sounding(xml).map((n) => [n.measure, n.duration, n.type, n.ties, n.id])).toEqual([
      [0, 480, 'quarter', ['start'], 'x0'],
      [1, 480, 'quarter', ['stop'], null],
    ]);
    expect(readBack(s, xml).notes.map((n) => [n.onsetTick, n.offsetTick])).toEqual([[1440, 2400]]);
  });
  it('writes a triplet beat with a time modification, one tuplet and a beam', () => {
    const s = scoreOf([
      [0, 480, 60],
      [480, 640, 62],
      [640, 800, 64],
      [800, 960, 65],
      [960, 1920, 67],
    ]);
    const xml = scoreToMusicXml(s);
    const ns = sounding(xml);
    expect(ns.map((n) => [n.type, n.triplet])).toEqual([
      ['quarter', false],
      ['eighth', true],
      ['eighth', true],
      ['eighth', true],
      ['half', false],
    ]);
    expect(ns.map((n) => n.tuplets)).toEqual([[], ['start'], [], ['stop'], []]);
    expect(ns.map((n) => n.beam)).toEqual([null, 'begin', 'continue', 'end', null]);
    readBack(s, xml);
  });
  it('writes awkward lengths as tied standard values and every note value matches its duration', () => {
    const spec: Spec[] = [];
    let t = 0;
    for (const sixteenths of [5, 7, 9, 11, 13]) {
      spec.push([t, t + sixteenths * 120, 60 + spec.length]);
      t += sixteenths * 120;
    }
    const s = scoreOf(spec);
    const xml = scoreToMusicXml(s);
    const written = notesOf(xml).filter((n) => !n.measureRest && !n.grace);
    expect(written.length).toBeGreaterThan(spec.length);
    for (const n of written) {
      expect(n.type, JSON.stringify(n)).not.toBeNull();
      expect(n.duration).toBeCloseTo(valueTicks(n), 9);
    }
    readBack(s, xml);
  });
  it('prints accidentals once per measure and staff, as the key signature requires', () => {
    const c = scoreOf([
      [0, 480, 66],
      [480, 960, 66],
      [960, 1440, 65],
      [1920, 2400, 66],
    ]);
    expect(sounding(scoreToMusicXml(c)).map((n) => n.accidental)).toEqual([
      'sharp',
      null,
      'natural',
      'sharp',
    ]);
    const g = scoreOf(
      [
        [0, 480, 66],
        [480, 960, 65],
      ],
      { key: 1 },
    );
    expect(sounding(scoreToMusicXml(g)).map((n) => n.accidental)).toEqual([null, 'natural']);
  });
  it('puts notes of one hand that overlap without starting together into a second voice', () => {
    const s = scoreOf([
      [0, 1920, 48, 'L'],
      [0, 480, 55, 'L'],
      [480, 960, 52, 'L'],
      [960, 1920, 55, 'L'],
    ]);
    const xml = scoreToMusicXml(s);
    expect(sounding(xml).map((n) => [n.voice, n.type])).toEqual([
      [5, 'whole'],
      [6, 'quarter'],
      [6, 'quarter'],
      [6, 'half'],
    ]);
    expect(xml.match(/<backup>/g)).toHaveLength(2);
    readBack(s, xml);
  });
  it('writes a grace note before its principal without a duration and reads it back as a grace note', () => {
    const s = scoreOf([
      [480, 480, 61, 'R', true],
      [480, 960, 62],
    ]);
    const xml = scoreToMusicXml(s);
    expect(sounding(xml).map((n) => [n.grace, n.duration, n.id])).toEqual([
      [true, 0, 'x0'],
      [false, 480, 'x1'],
    ]);
    expect(
      readBack(s, xml).notes.map((n) => [n.onsetTick, n.offsetTick, n.midi, n.isGrace]),
    ).toEqual([
      [480, 480, 61, true],
      [480, 960, 62, false],
    ]);
  });
  it('places a tempo change at its exact tick, splitting a held note with a tie', () => {
    const s = scoreOf([[0, 1920, 60]], {
      tempos: [
        { tick: 0, qpm: 120 },
        { tick: 960, qpm: 60 },
      ],
    });
    const xml = scoreToMusicXml(s);
    expect(xml).toContain('<sound tempo="60"/>');
    expect(sounding(xml).map((n) => [n.type, n.ties])).toEqual([
      ['half', ['start']],
      ['half', ['stop']],
    ]);
    const back = readBack(s, xml);
    expect(back.tempoMap).toEqual([
      { tick: 0, qpm: 120 },
      { tick: 960, qpm: 60 },
    ]);
    expect(back.notes[0]!.offsetSec).toBeCloseTo(3, 9);
  });
  it('beams four 16th notes in a beat and leaves a dotted half alone', () => {
    const s = scoreOf([
      [0, 120, 60],
      [120, 240, 62],
      [240, 360, 64],
      [360, 480, 65],
      [480, 1920, 67],
    ]);
    expect(sounding(scoreToMusicXml(s)).map((n) => n.beam)).toEqual([
      'begin',
      'continue',
      'continue',
      'end',
      null,
    ]);
  });
  it('refuses a rhythm it cannot write instead of writing a wrong one', () => {
    expect(() =>
      scoreToMusicXml(
        scoreOf([
          [0, 96, 60],
          [96, 480, 62],
        ]),
      ),
    ).toThrow(/cannot engrave a rhythm at tick 96/);
    expect(() =>
      scoreToMusicXml(
        scoreOf([0, 120, 240, 360, 480].map((on, i) => [on, 1920, 60 + 2 * i] as Spec)),
      ),
    ).toThrow(/more than 4 voices/);
  });
  it('keeps the tempo map of tempo-map.mid through quantization, separation, engraving and reading back', () => {
    const d = parseMidiFile(
      new Uint8Array(
        readFileSync(fileURLToPath(new URL('../../../fixtures/tempo-map.mid', import.meta.url))),
      ),
    );
    const q = quantize(d);
    const truth = q.notes.map((n): Hand => (d.notes[n.sources[0]!]!.channel === 0 ? 'R' : 'L'));
    const back = parseMusicXml(scoreToMusicXml(midiToScore(d, q, truth).score)).score;
    const rh = back.notes.filter((n) => n.hand === 'R');
    expect(rh).toHaveLength(32);
    expect(rh[16]!.onsetSec).toBeCloseTo(10, 6);
    expect(rh[24]!.onsetSec).toBeCloseTo(18, 6);
    expect(rh[31]!.onsetSec).toBeCloseTo(21.5, 6);
    expect(back.tempoMap.map((t) => [t.tick, t.qpm])).toEqual([
      [0, 96],
      [7680, 60],
      [11520, 120],
    ]);
  });
});
