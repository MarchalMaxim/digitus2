import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeMidi, type MidiEvent } from 'midi-file';
import { describe, expect, it } from 'vitest';
import { midiTickToSeconds, parseMidiFile } from './read.js';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url))),
  );

const on = (deltaTime: number, noteNumber: number, channel = 0, velocity = 80): MidiEvent => ({
  deltaTime,
  type: 'noteOn',
  channel,
  noteNumber,
  velocity,
});
const off = (deltaTime: number, noteNumber: number, channel = 0): MidiEvent => ({
  deltaTime,
  type: 'noteOff',
  channel,
  noteNumber,
  velocity: 0,
});
const end = (deltaTime = 0): MidiEvent => ({ deltaTime, meta: true, type: 'endOfTrack' });
const tempo = (deltaTime: number, bpm: number): MidiEvent => ({
  deltaTime,
  meta: true,
  type: 'setTempo',
  microsecondsPerBeat: Math.round(60e6 / bpm),
});

function smf(
  tracks: MidiEvent[][],
  opts: { format?: 0 | 1; ppq?: number; running?: boolean } = {},
): Uint8Array {
  const bytes = writeMidi(
    {
      header: { format: opts.format ?? 1, numTracks: tracks.length, ticksPerBeat: opts.ppq ?? 480 },
      tracks,
    },
    { running: opts.running ?? false, useByte9ForNoteOff: opts.running ?? false },
  );
  return new Uint8Array(bytes);
}

describe('parseMidiFile', () => {
  it('reads the tempo map: bar 5 at 10 s, bar 7 at 18 s, the last right-hand note at 21.5 s', () => {
    const data = parseMidiFile(fixture('tempo-map.mid'));
    expect(data.ppq).toBe(480);
    expect(data.tempos).toEqual([
      { tick: 0, usPerQuarter: 625_000 },
      { tick: 7680, usPerQuarter: 1_000_000 },
      { tick: 11520, usPerQuarter: 500_000 },
    ]);
    expect(data.timeSignatures).toEqual([{ tick: 0, beats: 4, beatType: 4 }]);
    expect(data.notes).toHaveLength(40);
    const rh = data.notes.filter((n) => n.channel === 0);
    expect(rh).toHaveLength(32);
    expect(midiTickToSeconds(data, rh[16]!.tick)).toBeCloseTo(10, 9);
    expect(midiTickToSeconds(data, rh[24]!.tick)).toBeCloseTo(18, 9);
    expect(midiTickToSeconds(data, rh[31]!.tick)).toBeCloseTo(21.5, 9);
    expect(data.warnings).toEqual([]);
  });
  it('pairs overlapping notes on one key first-in first-out, so no duration is negative', () => {
    const data = parseMidiFile(smf([[on(0, 60), on(240, 60), off(240, 60), off(240, 60), end()]]));
    expect(data.notes.map((n) => [n.tick, n.endTick])).toEqual([
      [0, 480],
      [240, 720],
    ]);
    for (const n of data.notes) expect(n.endTick).toBeGreaterThanOrEqual(n.tick);
  });
  it('reads format 0 with running status and note-on velocity 0 as note-off', () => {
    const bytes = smf(
      [
        [
          tempo(0, 90),
          on(0, 48, 1),
          on(0, 64, 0),
          off(96, 64, 0),
          on(0, 67, 0),
          off(96, 67, 0),
          off(0, 48, 1),
          end(),
        ],
      ],
      { format: 0, ppq: 96, running: true },
    );
    const data = parseMidiFile(bytes);
    expect(data.ppq).toBe(96);
    expect(data.notes.map((n) => [n.tick, n.endTick, n.midi, n.channel])).toEqual([
      [0, 192, 48, 1],
      [0, 96, 64, 0],
      [96, 192, 67, 0],
    ]);
    expect(data.tempos).toEqual([{ tick: 0, usPerQuarter: 666_667 }]);
  });
  it('assumes 120 quarter notes per minute and 4/4 when the file says nothing', () => {
    const data = parseMidiFile(smf([[on(0, 60), off(480, 60), end()]]));
    expect(data.tempos).toEqual([{ tick: 0, usPerQuarter: 500_000 }]);
    expect(data.timeSignatures).toEqual([{ tick: 0, beats: 4, beatType: 4 }]);
    expect(midiTickToSeconds(data, 480)).toBeCloseTo(0.5, 12);
    expect(data.warnings).toEqual([
      'no tempo in the file; using 120 quarter notes per minute',
      'no time signature in the file; using 4/4',
    ]);
  });
  it('ignores the percussion channel and notes outside the piano, and says so', () => {
    const data = parseMidiFile(
      smf([
        [on(0, 36, 9), off(120, 36, 9), on(0, 60), off(480, 60), on(0, 12), off(480, 12), end()],
      ]),
    );
    expect(data.notes.map((n) => n.midi)).toEqual([60]);
    expect(data.warnings).toContain('ignored 1 percussion note on channel 10');
    expect(data.warnings).toContain('ignored 1 note outside the piano range (A0 to C8)');
  });
  it('reads the key signature and closes a note that never ends at the end of its track', () => {
    const ks: MidiEvent = { deltaTime: 0, meta: true, type: 'keySignature', key: -3, scale: 1 };
    const data = parseMidiFile(smf([[ks, on(0, 60), on(0, 63), off(480, 60), end(480)]]));
    expect(data.keySignature).toEqual({ fifths: -3, mode: 'minor' });
    expect(data.notes.map((n) => [n.midi, n.tick, n.endTick])).toEqual([
      [60, 0, 480],
      [63, 0, 960],
    ]);
    expect(data.warnings).toContain('1 note had no note-off and ends with its track');
  });
  it('reads SMPTE-timed files at 120 quarter notes per minute so seconds stay right', () => {
    const bytes = smf([[on(0, 60), off(1000, 60), end()]]);
    bytes[12] = 0xe7; // -25 frames per second
    bytes[13] = 0x28; // 40 ticks per frame: 1000 ticks per second
    const data = parseMidiFile(bytes);
    expect(data.ppq).toBe(500);
    expect(midiTickToSeconds(data, data.notes[0]!.endTick)).toBeCloseTo(1, 12);
    expect(data.warnings[0]).toBe(
      'the file counts time in SMPTE frames, not beats; notes are placed on a 120 quarter-note-per-minute grid',
    );
  });
  it('reads the generated Twinkle fixture: 64 notes, 42 on the RH track and 22 on the LH track', () => {
    const data = parseMidiFile(fixture('twinkle.mid'));
    expect(data.notes).toHaveLength(64);
    expect(data.notes.filter((n) => n.track === 1)).toHaveLength(42);
    expect(data.notes.filter((n) => n.track === 2)).toHaveLength(22);
    expect(data.tempos).toEqual([{ tick: 0, usPerQuarter: 600_000 }]);
    expect(data.keySignature).toEqual({ fifths: 0, mode: 'major' });
    expect(data.warnings).toEqual([]);
  });
  it('rejects bytes that are not a MIDI file with a readable message', () => {
    expect(() => parseMidiFile(new TextEncoder().encode('<score-partwise/>'))).toThrow(
      /^not a MIDI file/,
    );
    expect(() => parseMidiFile(new TextEncoder().encode('MThd'))).toThrow(/^not a MIDI file/);
  });
  it('rejects a file cut off in the middle of an event instead of inventing a note or a tempo', () => {
    // header 14 bytes, track header 8, then 00 90 3C 50 | 83 60 80 3C 00 | 00 90 3E 50 | ...
    const notes = smf([[on(0, 60), off(480, 60), on(0, 62), off(480, 62), end()]]);
    expect(parseMidiFile(notes.slice(0, 31)).notes).toHaveLength(1); // the cut falls between events
    expect(() => parseMidiFile(notes.slice(0, 34))).toThrow(/^not a MIDI file/); // no velocity
    expect(() => parseMidiFile(notes.slice(0, 33))).toThrow(/^not a MIDI file/); // no key
    // 00 FF 51 03 0A 2C 2B | ...: the tempo loses its last byte
    const tempoCut = smf([[tempo(0, 90), on(0, 60), off(480, 60), end()]]).slice(0, 28);
    expect(() => parseMidiFile(tempoCut)).toThrow(/^not a MIDI file/);
  });
  it('keeps the highest piano key, C8, and counts nothing outside the range', () => {
    const data = parseMidiFile(smf([[on(0, 108), off(480, 108), end()]]));
    expect(data.notes.map((n) => n.midi)).toEqual([108]);
    expect(data.warnings.some((w) => w.includes('outside the piano range'))).toBe(false);
  });
  it('rejects a header whose ticks per beat is zero', () => {
    const bytes = smf([[on(0, 60), off(480, 60), end()]]);
    bytes[12] = 0; // the writer turns 0 into 128, so patch the header
    bytes[13] = 0;
    expect(() => parseMidiFile(bytes)).toThrow(/^not a MIDI file/);
  });
  it('sorts tempo changes by tick even when two tracks list them out of order', () => {
    const data = parseMidiFile(
      smf([
        [tempo(960, 60), end()],
        [tempo(0, 120), tempo(480, 90), on(0, 60), off(480, 60), end()],
      ]),
    );
    expect(data.tempos.map((t) => t.tick)).toEqual([0, 480, 960]);
  });
  it('reads the sequence name from the first track only, decoded from its bytes', () => {
    const name = (deltaTime: number, text: string): MidiEvent => ({
      deltaTime,
      meta: true,
      type: 'trackName',
      text,
    });
    const named = parseMidiFile(
      smf([
        [name(0, 'Etude'), name(0, 'second'), end()],
        [name(0, 'up'), on(0, 60), off(480, 60), end()],
      ]),
    );
    expect(named.sequenceName).toBe('Etude');
    // the UTF-8 bytes of 'Träumerei', one character per byte as midi-file reads them
    const utf8 = String.fromCharCode(...new TextEncoder().encode('Träumerei'));
    expect(parseMidiFile(smf([[name(0, utf8), on(0, 60), off(480, 60), end()]])).sequenceName).toBe(
      'Träumerei',
    );
    // a name only on a later track is an instrument or a hand, not the piece
    const later = parseMidiFile(
      smf([[end()], [name(0, 'Les etoiles'), on(0, 60), off(480, 60), end()]]),
    );
    expect(later.sequenceName).toBeUndefined();
    expect(parseMidiFile(smf([[on(0, 60), off(480, 60), end()]])).sequenceName).toBeUndefined();
  });
});
