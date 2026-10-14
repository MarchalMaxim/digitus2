import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeMidi, type MidiEvent } from 'midi-file';
import { describe, expect, it } from 'vitest';
import { ticksToSeconds } from '../../score/build.js';
import type { Assignment } from '../../score/types.js';
import { parseMusicXml } from '../musicxml/read.js';
import { injectFingerings } from '../musicxml/write.js';
import { importMidi } from './import.js';
import { parseMidiFile } from './read.js';

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
