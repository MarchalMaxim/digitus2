import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeMidi, type MidiEvent } from 'midi-file';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ticksToSeconds } from '../../score/build.js';
import type { Assignment } from '../../score/types.js';
import { parseMusicXml } from '../musicxml/read.js';
import { injectFingerings } from '../musicxml/write.js';
import type * as Engrave from './engrave.js';
import { importMidi } from './import.js';
import { parseMidiFile } from './read.js';

/** Lets one test make the engraver refuse a score that opens with a short measure. */
const engraver = vi.hoisted(() => ({ refuseShortFirstMeasure: false }));
vi.mock('./engrave.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Engrave>();
  return {
    ...actual,
    scoreToMusicXml: (...args: Parameters<typeof actual.scoreToMusicXml>) => {
      const [first, second] = args[0].measures;
      if (engraver.refuseShortFirstMeasure && second && first!.lengthTicks < second.lengthTicks)
        throw new Error('test: the engraver refuses a short first measure');
      return actual.scoreToMusicXml(...args);
    },
  };
});
afterEach(() => {
  engraver.refuseShortFirstMeasure = false;
});

const midiFixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url))),
  );

describe('importMidi', () => {
  it('returns MusicXML and a Score whose ids are the id attributes and whose sources point into that MusicXML', () => {
    const bytes = fixture('twinkle.mid');
    // A split at C4 reproduces the fixture's hands exactly, so this test does not depend on the DP.
    const { xml, score, info } = importMidi(bytes, { title: 'twinkle', splitMidi: 60 });
    expect(score.notes).toHaveLength(64);
    expect(score.notes.filter((n) => n.hand === 'R')).toHaveLength(42);
    expect(new Set(score.notes.map((n) => n.id)).size).toBe(64);
    for (const n of score.notes) expect(xml).toContain(`<note id="${n.id}">`);
    expect(score.meta.title).toBe('twinkle');
    const assignment: Assignment = Object.fromEntries(
      score.notes.map((n) => [n.id, { finger: 1, source: 'engine' } as const]),
    );
    const fingered = injectFingerings(xml, score, assignment);
    expect(fingered.match(/<fingering/g)).toHaveLength(64);
    expect(Object.keys(parseMusicXml(fingered).editorial)).toHaveLength(64);
    expect(info).toMatchObject({ quantizedMovedShare: 0, splitMidi: 60, warnings: [] });
    expect(info.grids['16th-triplet'] + info.grids['32nd']).toBe(0);
  });
  it('separates the hands automatically and agrees with the fixture tracks on at least 62 of 64 notes', () => {
    const bytes = fixture('twinkle.mid');
    const truth = new Map(
      parseMidiFile(bytes).notes.map((n) => [`${n.tick}:${n.midi}`, n.track === 1 ? 'R' : 'L']),
    );
    const { score, info } = importMidi(bytes);
    expect(info.splitMidi).toBeNull();
    const agree = score.notes.filter(
      (n) => truth.get(`${n.onsetTick}:${n.midi}`) === n.hand,
    ).length;
    expect(agree).toBeGreaterThanOrEqual(62);
  });
  it('is deterministic', () => {
    const bytes = fixture('twinkle.mid');
    expect(importMidi(bytes).xml).toBe(importMidi(bytes).xml);
  });
  it('applies a fixed split', () => {
    const { score, info } = importMidi(fixture('twinkle.mid'), { splitMidi: 67 });
    expect(score.notes.filter((n) => n.hand === 'R')).toHaveLength(14);
    expect(info.splitMidi).toBe(67);
  });
  it('keeps the tempo map: bar 5 at 10 s and bar 7 at 18 s in tempo-map.mid', () => {
    const { score } = importMidi(fixture('tempo-map.mid'));
    const at = (m: number) =>
      ticksToSeconds(score.tempoMap, score.divisions, score.measures[m]!.startTick);
    expect(at(4)).toBeCloseTo(10, 6);
    expect(at(6)).toBeCloseTo(18, 6);
    expect(score.notes[score.notes.length - 1]!.onsetSec).toBeCloseTo(21.5, 6); // the last right-hand note
  });
  it('passes the composer to the score and keeps the MIDI velocity of each note through the MusicXML round trip', () => {
    const on = (noteNumber: number, velocity: number): MidiEvent => ({
      deltaTime: 0,
      type: 'noteOn',
      channel: 0,
      noteNumber,
      velocity,
    });
    const off = (noteNumber: number): MidiEvent => ({
      deltaTime: 480,
      type: 'noteOff',
      channel: 0,
      noteNumber,
      velocity: 0,
    });
    const end: MidiEvent = { deltaTime: 0, meta: true, type: 'endOfTrack' };
    const bytes = new Uint8Array(
      writeMidi({
        header: { format: 1, numTracks: 1, ticksPerBeat: 480 },
        tracks: [[on(72, 53), off(72), on(74, 101), off(74), end]],
      }),
    );
    const { score } = importMidi(bytes, { title: 'velocities', composer: 'A. Composer' });
    expect(score.meta.composer).toBe('A. Composer');
    const byMidi = new Map(score.notes.map((n) => [n.midi, n.velocity]));
    expect(byMidi.get(72)).toBe(53);
    expect(byMidi.get(74)).toBe(101);
    expect(importMidi(bytes).score.meta.composer).toBeUndefined();
  });
  it('refuses a file without notes', () => {
    const end: MidiEvent = { deltaTime: 0, meta: true, type: 'endOfTrack' };
    const empty = new Uint8Array(
      writeMidi({ header: { format: 1, numTracks: 1, ticksPerBeat: 480 }, tracks: [[end]] }),
    );
    expect(() => importMidi(empty)).toThrow('the MIDI file contains no notes');
  });
  it('imports a 2000-note file in under two seconds (the target is 500 ms)', () => {
    const rh: MidiEvent[] = [];
    const lh: MidiEvent[] = [];
    for (let i = 0; i < 1000; i++) {
      rh.push(
        { deltaTime: 0, type: 'noteOn', channel: 0, noteNumber: 60 + ((i * 7) % 19), velocity: 80 },
        {
          deltaTime: 120,
          type: 'noteOff',
          channel: 0,
          noteNumber: 60 + ((i * 7) % 19),
          velocity: 0,
        },
      );
      lh.push(
        { deltaTime: 0, type: 'noteOn', channel: 1, noteNumber: 36 + ((i * 5) % 17), velocity: 80 },
        {
          deltaTime: 120,
          type: 'noteOff',
          channel: 1,
          noteNumber: 36 + ((i * 5) % 17),
          velocity: 0,
        },
      );
    }
    const end: MidiEvent = { deltaTime: 0, meta: true, type: 'endOfTrack' };
    const bytes = new Uint8Array(
      writeMidi({
        header: { format: 1, numTracks: 2, ticksPerBeat: 480 },
        tracks: [
          [...rh, end],
          [...lh, end],
        ],
      }),
    );
    const t0 = performance.now();
    const { score } = importMidi(bytes);
    const ms = performance.now() - t0;
    expect(score.notes).toHaveLength(2000);
    expect(ms, `${ms.toFixed(0)} ms`).toBeLessThan(2000);
  });
});

type NoteSpec = [onset: number, offset: number, midi: number, channel: number];
const meta = (type: string, extra: object): MidiEvent =>
  ({ deltaTime: 0, meta: true, type, ...extra }) as MidiEvent;
/** One track of the notes of a channel, ordered, with offsets before onsets at one tick. */
function channelTrack(specs: NoteSpec[], channel: number): MidiEvent[] {
  const events: Array<{ tick: number; off: boolean; event: MidiEvent }> = [];
  for (const [on, off, midi, ch] of specs)
    if (ch === channel) {
      events.push({
        tick: on,
        off: false,
        event: { deltaTime: 0, type: 'noteOn', channel, noteNumber: midi, velocity: 80 },
      });
      events.push({
        tick: off,
        off: true,
        event: { deltaTime: 0, type: 'noteOff', channel, noteNumber: midi, velocity: 0 },
      });
    }
  events.sort((a, b) => a.tick - b.tick || Number(b.off) - Number(a.off));
  let last = 0;
  return events.map(({ tick, event }) => {
    const out = { ...event, deltaTime: tick - last };
    last = tick;
    return out;
  });
}
/** A format 1 file: a conductor track (optionally named), then one track per channel 0 and 1. */
function smf(specs: NoteSpec[], sequenceName?: string): Uint8Array {
  const end = meta('endOfTrack', {});
  const conductor: MidiEvent[] = [
    ...(sequenceName !== undefined ? [meta('trackName', { text: sequenceName })] : []),
    meta('timeSignature', { numerator: 4, denominator: 4, metronome: 24, thirtyseconds: 8 }),
    end,
  ];
  return new Uint8Array(
    writeMidi({
      header: { format: 1, numTracks: 3, ticksPerBeat: 480 },
      tracks: [conductor, [...channelTrack(specs, 0), end], [...channelTrack(specs, 1), end]],
    }),
  );
}

describe('importMidi title', () => {
  const notes: NoteSpec[] = [
    [0, 480, 72, 0],
    [480, 960, 74, 0],
  ];
  it('prefers an explicit title, then the name of the sequence, then the cleaned file name', () => {
    const named = smf(notes, 'Kinderszenen: Traeumerei');
    expect(importMidi(named, { title: 'Mine', fallbackTitle: 'file' }).score.meta.title).toBe(
      'Mine',
    );
    expect(importMidi(named, { fallbackTitle: 'file' }).score.meta.title).toBe(
      'Kinderszenen: Traeumerei',
    );
    expect(
      importMidi(smf(notes, 'Piano'), { fallbackTitle: 'SchumannOp15No07' }).score.meta.title,
    ).toBe('Schumann Op. 15 No. 7');
    expect(importMidi(smf(notes), { fallbackTitle: 'twinkle' }).score.meta.title).toBe('twinkle');
  });
  it('has no title when there is neither a name nor a file name', () => {
    expect(importMidi(smf(notes, 'Track 1')).score.meta.title).toBeUndefined();
  });
  it('reads the file name of Traeumerei as Schumann Op. 15 No. 7', () => {
    const { score } = importMidi(midiFixture('SchumannOp15No07.mid'), {
      fallbackTitle: 'SchumannOp15No07',
    });
    expect(score.meta.title).toBe('Schumann Op. 15 No. 7');
  });
});

describe('importMidi pickup', () => {
  it('gives Traeumerei (Mutopia 504) the 25 bars of the printed score, the first a quarter long', () => {
    const { score, xml } = importMidi(midiFixture('SchumannOp15No07.mid'));
    expect(score.measures).toHaveLength(25);
    expect(score.measures[0]).toMatchObject({ startTick: 0, lengthTicks: 480, number: '0' });
    expect(score.measures[1]).toMatchObject({ startTick: 480, lengthTicks: 1920, number: '1' });
    expect(xml).toContain('<measure number="0" implicit="yes">');
    expect(score.notes[0]!.measureIndex).toBe(0);
  });
  it('places the bars the same way whatever the hand split', () => {
    const bytes = midiFixture('SchumannOp15No07.mid');
    const automatic = importMidi(bytes).score.measures;
    for (const splitMidi of [60, 67])
      expect(importMidi(bytes, { splitMidi }).score.measures).toEqual(automatic);
  });
  it('keeps the full first bar of a piece that opens on the downbeat (Mozart K. 457)', () => {
    const { score } = importMidi(midiFixture('MozartK457-1.mid'));
    expect(score.measures[0]).toMatchObject({ lengthTicks: 1920, number: '1' });
  });
  it('keeps full bars for the existing fixtures', () => {
    for (const name of ['twinkle.mid', 'tempo-map.mid'])
      expect(importMidi(fixture(name)).score.measures[0]!.number).toBe('1');
  });
  it('keeps an eighth-note pickup under eighth triplets on the musical beats', () => {
    const specs: NoteSpec[] = [[0, 240, 67, 0]];
    for (let bar = 0; bar < 8; bar++) {
      const s = 240 + bar * 1920;
      specs.push([s, s + 1920, 48, 1]);
      for (let k = 0; k < 12; k++) specs.push([s + k * 160, s + (k + 1) * 160, 72 + (k % 5), 0]);
    }
    const close = 240 + 8 * 1920; // a closing chord on the downbeat, as a piece ends
    specs.push([close, close + 1920, 48, 1], [close, close + 1920, 72, 0]);
    const { score } = importMidi(smf(specs));
    expect(score.notes).toHaveLength(specs.length);
    expect(score.measures[0]).toMatchObject({ startTick: 0, lengthTicks: 240, number: '0' });
    expect(score.measures[1]).toMatchObject({ startTick: 240, lengthTicks: 1920 });
  });
  it('falls back to full bars when the engraver cannot take the pickup', () => {
    engraver.refuseShortFirstMeasure = true;
    const { score, xml } = importMidi(midiFixture('SchumannOp15No07.mid'));
    expect(score.measures[0]).toMatchObject({ lengthTicks: 1920, number: '1' });
    expect(xml).not.toContain('implicit="yes"');
  });
});
