// @vitest-environment node
import {
  midiToSpelling,
  parseMusicXml,
  type Arpeggio,
  type Hand,
  type Note,
  type PedalEvent,
  type Score,
} from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { playEvents, type PlayEvent } from '../audio/events.js';
import { noteVelocity, type AccNote } from '../audio/instrument.js';
import { performanceOf, scoreEndSec } from '../audio/performance.js';
import { accompanimentNotes, accompanimentStretches, type Stretch } from './accompaniment.js';
import { alongSteps, type AlongStep, type PerfRange } from './playAlong.js';

/** Bars of four quarter notes: divisions 1 and 120 qpm, so a tick is half a second. */
const BAR_TICKS = 4;
const TICK_SEC = 0.5;

interface NoteSpec {
  midi: number;
  tick: number;
  hand?: Hand;
  grace?: boolean;
  /** Ticks the note lasts (default 1). */
  ticks?: number;
  velocity?: number;
  arpeggio?: Arpeggio;
  /** A trill of this many attacks over the note. */
  trill?: number;
  /** Notes sharing a chord id roll together. */
  chord?: string;
}

let nextId = 0;
function note(spec: NoteSpec): Note {
  const onsetSec = spec.tick * TICK_SEC;
  const ticks = spec.grace ? 0 : (spec.ticks ?? 1);
  const offsetSec = onsetSec + ticks * TICK_SEC;
  return {
    id: `n${nextId++}`,
    onsetTick: spec.tick,
    offsetTick: spec.tick + ticks,
    onsetSec,
    offsetSec,
    midi: spec.midi,
    spelling: midiToSpelling(spec.midi),
    hand: spec.hand ?? 'R',
    staff: spec.hand === 'L' ? 2 : 1,
    voice: 1,
    measureIndex: Math.floor(spec.tick / BAR_TICKS),
    isGrace: spec.grace ?? false,
    chordId: spec.chord ?? `c${nextId}`,
    sourceIndices: [nextId],
    ...(spec.velocity === undefined ? {} : { velocity: spec.velocity }),
    ...(spec.arpeggio ? { arpeggio: spec.arpeggio } : {}),
    ...(spec.trill
      ? {
          ornament: {
            kind: 'trill-mark' as const,
            long: false,
            upperMidi: spec.midi + 2,
            lowerMidi: spec.midi - 2,
            startNote: 'main' as const,
            beats: spec.trill,
            endTick: spec.tick + ticks,
            endSec: offsetSec,
          },
        }
      : {}),
  };
}

function scoreOf(specs: NoteSpec[], bars = 4, pedals?: PedalEvent[]): Score {
  return {
    meta: {},
    divisions: 1,
    tempoMap: [{ tick: 0, qpm: 120 }],
    timeSignatures: [{ tick: 0, beats: 4, beatType: 4 }],
    keySignatures: [],
    measures: Array.from({ length: bars }, (_, i) => ({
      index: i,
      startTick: i * BAR_TICKS,
      lengthTicks: BAR_TICKS,
      number: String(i + 1),
    })),
    notes: specs.map(note),
    ...(pedals ? { pedals } : {}),
  };
}

const eventsOf = (specs: NoteSpec[], bars = 4, pedals?: PedalEvent[]): PlayEvent[] =>
  playEvents(performanceOf(scoreOf(specs, bars, pedals)).score);

const range = (from: number, to: number, offset = 0): Stretch => ({ from, to, offset });
const step = (perfSec: number, ...p: number[]): AlongStep => ({ perfSec, pitches: p });
const midis = (notes: readonly AccNote[]): number[] => notes.map((n) => n.midi);
const offsets = (notes: readonly AccNote[]): number[] => notes.map((n) => n.offsetSec);

describe('accompanimentStretches', () => {
  const steps = [step(0, 60), step(1, 62), step(2, 64), step(3, 65), step(4, 67)];

  it('plays from the step passed to the next step of the walk', () => {
    expect(accompanimentStretches(steps, 1, { kind: 'cue', index: 2 }, null, 9)).toEqual([
      { from: 1, to: 2, offset: 0 },
    ]);
    expect(accompanimentStretches(steps, 0, { kind: 'cue', index: 1 }, null, 9)).toEqual([
      { from: 0, to: 1, offset: 0 },
    ]);
  });

  it('counts a chain from its last step', () => {
    // Steps 0, 1 and 2 passed in one decision: only the stretch from step 2 plays.
    expect(accompanimentStretches(steps, 2, { kind: 'cue', index: 3 }, null, 9)).toEqual([
      { from: 2, to: 3, offset: 0 },
    ]);
  });

  it('ends a loop wrap at the loop end and plays nothing of the loop opening', () => {
    const loop: PerfRange = { from: 2, to: 4 };
    const stretches = accompanimentStretches(steps, 3, { kind: 'cue', index: 2 }, loop, 9);
    expect(stretches).toEqual([{ from: 3, to: 4, offset: 0 }]);
    // A one-step loop wraps onto itself.
    const lap = accompanimentStretches(steps, 3, { kind: 'cue', index: 3 }, { from: 3, to: 4 }, 9);
    expect(lap).toEqual([{ from: 3, to: 4, offset: 0 }]);
  });

  it('plays an ordinary stretch inside a loop to the next step', () => {
    const loop: PerfRange = { from: 2, to: 4 };
    // A chain that wrapped and went on (3, then 2) lands on step 3 again: no wrap, from step 2.
    expect(accompanimentStretches(steps, 2, { kind: 'cue', index: 3 }, loop, 9)).toEqual([
      { from: 2, to: 3, offset: 0 },
    ]);
  });

  it('runs a finish to the end of the performance: the tail', () => {
    expect(accompanimentStretches(steps, 4, { kind: 'finish' }, null, 6.5)).toEqual([
      { from: 4, to: 6.5, offset: 0 },
    ]);
    // A chain that ran off the end counts from its last step too.
    expect(accompanimentStretches(steps, 4, { kind: 'finish' }, { from: 9, to: 12 }, 6.5)).toEqual([
      { from: 4, to: 6.5, offset: 0 },
    ]);
  });

  it('starts a stretch handed over after its press that much earlier, and keeps what sounded', () => {
    const move = { kind: 'cue', index: 2 } as const;
    // Handed over 0.4 s into the stretch: it started 0.4 s before, and the first 0.4 s sounded.
    expect(accompanimentStretches(steps, 1, move, null, 9, 0.4)).toEqual([
      { from: 1, to: 2, offset: -0.4, heard: 0.4 },
    ]);
    // After a tempo change what sounded (0.1 s of music) is less than the time at the new tempo.
    expect(accompanimentStretches(steps, 1, move, null, 9, 0.2, 0.1)).toEqual([
      { from: 1, to: 2, offset: -0.2, heard: 0.1 },
    ]);
    // Nothing elapsed gives the stretch as before, with no `heard`.
    expect(accompanimentStretches(steps, 1, move, null, 9, 0)).toEqual([
      { from: 1, to: 2, offset: 0 },
    ]);
  });

  it('gives none for stay, for no step passed, or a stretch with no length', () => {
    expect(accompanimentStretches(steps, 1, { kind: 'stay' }, null, 9)).toEqual([]);
    expect(accompanimentStretches(steps, -1, { kind: 'cue', index: 2 }, null, 9)).toEqual([]);
    expect(accompanimentStretches(steps, -1, { kind: 'finish' }, null, 9)).toEqual([]);
    expect(accompanimentStretches(steps, 4, { kind: 'finish' }, null, 4)).toEqual([]);
    expect(accompanimentStretches([], 0, { kind: 'finish' }, null, 9)).toEqual([]);
  });
});

describe('accompanimentNotes', () => {
  it('gives only the hands asked for', () => {
    const events = eventsOf([
      { midi: 72, tick: 0, hand: 'R' },
      { midi: 48, tick: 0, hand: 'L' },
      { midi: 74, tick: 1, hand: 'R' },
      { midi: 50, tick: 1, hand: 'L' },
    ]);
    const left = accompanimentNotes(events, ['L'], [range(0, 1.5)], null);
    expect(midis(left)).toEqual([48, 50]);
    expect(left.every((n) => n.hand === 'L')).toBe(true);
    const right = accompanimentNotes(events, ['R'], [range(0, 1.5)], null);
    expect(midis(right)).toEqual([72, 74]);
    expect(right.every((n) => n.hand === 'R')).toBe(true);
    expect(accompanimentNotes(events, [], [range(0, 1.5)], null)).toEqual([]);
    expect(accompanimentNotes(events, ['L', 'R'], [range(0, 1.5)], null)).toHaveLength(4);
  });

  it('gives the notes of a stretch by onset, half-open: a note at the next step belongs to the next stretch', () => {
    // Notes at 0, 1 and 2 s.
    const events = eventsOf([
      { midi: 48, tick: 0, hand: 'L' },
      { midi: 50, tick: 2, hand: 'L' },
      { midi: 52, tick: 4, hand: 'L' },
    ]);
    expect(midis(accompanimentNotes(events, ['L'], [range(0, 1)], null))).toEqual([48]);
    expect(midis(accompanimentNotes(events, ['L'], [range(1, 2)], null))).toEqual([50]);
    expect(midis(accompanimentNotes(events, ['L'], [range(0, 2)], null))).toEqual([48, 50]);
    // The slack of the cursor: a note within 1e-9 of the end is the next stretch's.
    expect(midis(accompanimentNotes(events, ['L'], [range(0, 1 + 1e-12)], null))).toEqual([48]);
    expect(midis(accompanimentNotes(events, ['L'], [range(1 - 1e-12, 2)], null))).toEqual([50]);
  });

  it('counts the offset from sec, the stretch start being the press', () => {
    const events = eventsOf([
      { midi: 48, tick: 1, hand: 'L' },
      { midi: 50, tick: 2, hand: 'L', ticks: 2 },
    ]);
    const notes = accompanimentNotes(events, ['L'], [range(0.5, 1.5)], null);
    expect(notes).toEqual([
      {
        offsetSec: 0,
        durationSec: 0.5,
        midi: 48,
        velocity: noteVelocity({ hand: 'L' }),
        hand: 'L',
      },
      {
        offsetSec: 0.5,
        durationSec: 1,
        midi: 50,
        velocity: noteVelocity({ hand: 'L' }),
        hand: 'L',
      },
    ]);
    // The stretch's own offset is added.
    expect(offsets(accompanimentNotes(events, ['L'], [range(0.5, 1.5, 0.25)], null))).toEqual([
      0.25, 0.75,
    ]);
  });

  it('starts a rolled note late, as Play does, and a grace note clamped at the press', () => {
    const roll: Arpeggio = { direction: 'up' };
    const events = eventsOf([
      // A rolled left-hand chord on the beat the stretch starts at.
      { midi: 48, tick: 1, hand: 'L', chord: 'a', arpeggio: roll },
      { midi: 52, tick: 1, hand: 'L', chord: 'a', arpeggio: roll },
      { midi: 55, tick: 1, hand: 'L', chord: 'a', arpeggio: roll },
      // A grace note before a principal at the same beat, and one before a later beat.
      { midi: 59, tick: 1, hand: 'L', grace: true },
      { midi: 60, tick: 2, hand: 'L' },
      { midi: 57, tick: 2, hand: 'L', grace: true },
    ]);
    const notes = accompanimentNotes(events, ['L'], [range(0.5, 1.5)], null);
    const at = (midi: number) => notes.find((n) => n.midi === midi)!;
    expect(at(48).offsetSec).toBe(0);
    expect(at(52).offsetSec).toBeCloseTo(0.04, 9);
    expect(at(55).offsetSec).toBeCloseTo(0.08, 9);
    // The grace of the principal that opens the stretch sounds with it, at the press.
    expect(at(59).offsetSec).toBe(0);
    // The grace of a later beat keeps its 50 ms lead.
    expect(at(57).offsetSec).toBeCloseTo(0.45, 9);
    expect(at(60).offsetSec).toBeCloseTo(0.5, 9);
    expect(offsets(notes)).toEqual([...offsets(notes)].sort((a, b) => a - b));
  });

  it('lets a note ring its length: the stretch end never shortens it, and the pedal holds it', () => {
    const events = eventsOf([{ midi: 48, tick: 0, hand: 'L', ticks: 4 }]);
    const [held] = accompanimentNotes(events, ['L'], [range(0, 0.5)], null);
    expect(held!.durationSec).toBe(2);
    const pedalled = eventsOf(
      [
        { midi: 48, tick: 0, hand: 'L' },
        { midi: 50, tick: 1, hand: 'L' },
      ],
      4,
      [
        { tick: 0, sec: 0, type: 'down' },
        { tick: 3, sec: 1.5, type: 'up' },
      ],
    );
    const [first] = accompanimentNotes(pedalled, ['L'], [range(0, 0.5)], null);
    expect(first!.durationSec).toBe(1.5); // to the lift, as Play holds it
  });

  it('clips a duration at the loop end inside a loop only', () => {
    const events = eventsOf([{ midi: 48, tick: 1, hand: 'L', ticks: 4 }]);
    const loop: PerfRange = { from: 0, to: 2 };
    const [clipped] = accompanimentNotes(events, ['L'], [range(0.5, 1.5)], loop);
    expect(clipped!.durationSec).toBe(1.5); // 2 - 0.5
    const [free] = accompanimentNotes(events, ['L'], [range(0.5, 1.5)], null);
    expect(free!.durationSec).toBe(2);
    // A note shorter than what is left in the loop keeps its length.
    const short = eventsOf([{ midi: 48, tick: 1, hand: 'L' }]);
    expect(accompanimentNotes(short, ['L'], [range(0.5, 1.5)], loop)[0]!.durationSec).toBe(0.5);
  });

  it('leaves out a note that would sound only after the loop end', () => {
    // A roll starts the chord's top note 0.08 s late: it lies past the loop end the transport wraps at.
    const roll: Arpeggio = { direction: 'up' };
    const events = eventsOf([
      { midi: 48, tick: 3, hand: 'L', chord: 'a', arpeggio: roll },
      { midi: 52, tick: 3, hand: 'L', chord: 'a', arpeggio: roll },
      { midi: 55, tick: 3, hand: 'L', chord: 'a', arpeggio: roll },
    ]);
    const loop: PerfRange = { from: 0, to: 1.54 };
    const notes = accompanimentNotes(events, ['L'], [range(1.5, 1.54)], loop);
    expect(midis(notes)).toEqual([48]);
    expect(notes[0]!.durationSec).toBeCloseTo(0.04, 9);
  });

  it('leaves out a note in unison with a note of the hand the reader plays', () => {
    const events = eventsOf([
      { midi: 60, tick: 0, hand: 'R' },
      { midi: 60, tick: 0, hand: 'L' }, // the reader plays this pitch
      { midi: 48, tick: 0, hand: 'L' },
      { midi: 62, tick: 1, hand: 'R' },
      { midi: 60, tick: 1, hand: 'L' }, // the same pitch at another onset is not a unison
    ]);
    const notes = accompanimentNotes(events, ['L'], [range(0, 1.5)], null);
    expect(notes.map((n) => [n.midi, n.offsetSec])).toEqual([
      [48, 0],
      [60, 0.5],
    ]);
    // And the mirror: the reader plays the left hand, digitus the right.
    const mirror = accompanimentNotes(events, ['R'], [range(0, 1.5)], null);
    expect(mirror.map((n) => [n.midi, n.offsetSec])).toEqual([[62, 0.5]]);
    // With both hands played by digitus nothing is a unison.
    expect(accompanimentNotes(events, ['L', 'R'], [range(0, 1.5)], null)).toHaveLength(5);
  });

  it('counts onsets within 1e-9 as the same for a unison', () => {
    const base: PlayEvent = {
      sec: 0.5,
      onset: 0.5,
      duration: 0.5,
      midi: 60,
      hand: 'R',
      velocity: 90,
    };
    const near: PlayEvent = { ...base, hand: 'L', sec: 0.5 + 5e-10, onset: 0.5 + 5e-10 };
    const far: PlayEvent = { ...base, hand: 'L', sec: 0.5 + 1e-6, onset: 0.5 + 1e-6, midi: 60 };
    expect(accompanimentNotes([base, near], ['L'], [range(0, 1)], null)).toEqual([]);
    expect(accompanimentNotes([base, far], ['L'], [range(0, 1)], null)).toHaveLength(1);
  });

  it("gives each note's own velocity: the score's, else its hand's", () => {
    const events = eventsOf([
      { midi: 48, tick: 0, hand: 'L', velocity: 50 },
      { midi: 50, tick: 1, hand: 'L' },
    ]);
    const notes = accompanimentNotes(events, ['L'], [range(0, 1.5)], null);
    expect(notes.map((n) => n.velocity)).toEqual([50, noteVelocity({ hand: 'L' })]);
  });

  it('sounds the attacks of an ornament as the transport has them', () => {
    // A left-hand trill of five attacks over one second, 0.2 s apart.
    const specs: NoteSpec[] = [{ midi: 48, tick: 0, hand: 'L', ticks: 2, trill: 5 }];
    const events = eventsOf(specs);
    expect(events).toHaveLength(5);
    const notes = accompanimentNotes(events, ['L'], [range(0, 1.5)], null);
    expect(notes.map((n) => [n.midi, +n.offsetSec.toFixed(9), +n.durationSec.toFixed(9)])).toEqual(
      events.map((e) => [e.midi, +e.sec.toFixed(9), +e.duration.toFixed(9)]),
    );
    expect(midis(notes)).toEqual([48, 50, 48, 50, 48]);
    // A stretch that ends inside the trill takes the attacks that begin before it.
    expect(midis(accompanimentNotes(events, ['L'], [range(0, 0.5)], null))).toEqual([48, 50, 48]);
  });

  it("gives the notes of a repeat's second hearing from the performance", () => {
    // Bars 1 2 3 with a repeat over bars 2 and 3: the order heard is 1 2 3 2 3.
    const staves = (right: string, left: string) =>
      `${right}<backup><duration>4</duration></backup>${left}`;
    const n = (step: string, octave: number, staff: number) =>
      `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>4</duration><voice>${staff}</voice><type>whole</type><staff>${staff}</staff></note>`;
    const source = `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><direction-type><words>x</words></direction-type><sound tempo="120"/></direction>${staves(n('C', 5, 1), n('C', 3, 2))}</measure><measure number="2"><barline location="left"><repeat direction="forward"/></barline>${staves(n('D', 5, 1), n('D', 3, 2))}</measure><measure number="3">${staves(n('E', 5, 1), n('E', 3, 2))}<barline location="right"><repeat direction="backward"/></barline></measure></part></score-partwise>`;
    const { score } = parseMusicXml(source);
    const perf = performanceOf(score);
    expect(perf.written).toEqual([0, 1, 2, 1, 2]);
    const events = playEvents(perf.score);
    const steps = alongSteps(perf, ['L']); // the reader plays the right hand
    expect(steps.map((s) => s.perfSec)).toEqual([0, 2, 4, 6, 8]);
    // Between the reader's steps 3 and 4: the second hearing of bar 2, which the written score lacks.
    const second = accompanimentStretches(steps, 3, { kind: 'cue', index: 4 }, null, 10);
    expect(second).toEqual([{ from: 6, to: 8, offset: 0 }]);
    expect(midis(accompanimentNotes(events, ['L'], second, null))).toEqual([50]);
    expect(accompanimentNotes(playEvents(score), ['L'], second, null)).toEqual([]);
    // The tail after the last step is the second hearing of bar 3.
    const tail = accompanimentStretches(
      steps,
      4,
      { kind: 'finish' },
      null,
      scoreEndSec(perf.score),
    );
    expect(tail).toEqual([{ from: 8, to: 10, offset: 0 }]);
    expect(midis(accompanimentNotes(events, ['L'], tail, null))).toEqual([52]);
  });

  it('gives several stretches ascending by offset', () => {
    const events = eventsOf([
      { midi: 48, tick: 0, hand: 'L' },
      { midi: 50, tick: 2, hand: 'L' },
    ]);
    const notes = accompanimentNotes(events, ['L'], [range(1, 1.5, 0.5), range(0, 0.5, 0)], null);
    expect(notes.map((n) => [n.midi, n.offsetSec])).toEqual([
      [48, 0],
      [50, 0.5],
    ]);
  });

  it('leaves out the notes that already sounded in a stretch handed over after its press', () => {
    const events = eventsOf([
      { midi: 48, tick: 1, hand: 'L' },
      { midi: 50, tick: 1.5, hand: 'L' },
      { midi: 52, tick: 1.9, hand: 'L' },
    ]);
    // [0.5, 1) handed over 0.4 s in: the notes at 0 and 0.25 s are over, the one at 0.45 s is next.
    const early = accompanimentNotes(
      events,
      ['L'],
      [{ from: 0.5, to: 1, offset: -0.4, heard: 0.4 }],
      null,
    );
    expect(midis(early)).toEqual([52]);
    expect(offsets(early)[0]).toBeCloseTo(0.05, 9);
    // A note exactly where the hand-over is, not yet struck, sounds at once.
    const at = accompanimentNotes(
      events,
      ['L'],
      [{ from: 0.5, to: 1, offset: -0.25, heard: 0.25 }],
      null,
    );
    expect(midis(at)).toEqual([50, 52]);
    expect(offsets(at)[0]).toBe(0);
    // A faster tempo made the stretch older than what sounded: the notes in between sound at once.
    const caught = accompanimentNotes(
      events,
      ['L'],
      [{ from: 0.5, to: 1, offset: -0.4, heard: 0.2 }],
      null,
    );
    expect(midis(caught)).toEqual([50, 52]);
    expect(offsets(caught)[0]).toBe(0);
    expect(offsets(caught)[1]).toBeCloseTo(0.05, 9);
    // A stretch with no `heard` keeps every note, clamped at the press, as before.
    const all = accompanimentNotes(events, ['L'], [{ from: 0.5, to: 1, offset: -0.4 }], null);
    expect(midis(all)).toEqual([48, 50, 52]);
    expect(offsets(all)[0]).toBe(0);
  });

  it('gives nothing without stretches, or for a stretch where the hand is silent', () => {
    const events = eventsOf([{ midi: 72, tick: 0, hand: 'R' }]);
    expect(accompanimentNotes(events, ['L'], [], null)).toEqual([]);
    expect(accompanimentNotes(events, ['L'], [range(0, 2)], null)).toEqual([]);
    expect(accompanimentNotes([], ['L'], [range(0, 2)], null)).toEqual([]);
  });
});
