import { describe, expect, it } from 'vitest';
import {
  formatPigPitch,
  isBlackKey,
  midiToSpelling,
  parsePigPitch,
  spellingToMidi,
} from './pitch.js';

describe('spellingToMidi', () => {
  it('maps middle C and the piano extremes', () => {
    expect(spellingToMidi({ step: 'C', alter: 0, octave: 4 })).toBe(60);
    expect(spellingToMidi({ step: 'A', alter: 0, octave: 0 })).toBe(21);
    expect(spellingToMidi({ step: 'C', alter: 0, octave: 8 })).toBe(108);
  });
  it('handles enharmonics across the octave boundary', () => {
    expect(spellingToMidi({ step: 'B', alter: 1, octave: 3 })).toBe(60);
    expect(spellingToMidi({ step: 'C', alter: -1, octave: 4 })).toBe(59);
    expect(spellingToMidi({ step: 'F', alter: 2, octave: 4 })).toBe(67);
  });
});

describe('midiToSpelling', () => {
  it('prefers sharps by default and flats on request', () => {
    expect(midiToSpelling(61)).toEqual({ step: 'C', alter: 1, octave: 4 });
    expect(midiToSpelling(61, 'flat')).toEqual({ step: 'D', alter: -1, octave: 4 });
    expect(midiToSpelling(60)).toEqual({ step: 'C', alter: 0, octave: 4 });
  });
});

describe('midiToSpelling over a whole octave', () => {
  const sharp = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const flat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  it.each([
    ['sharp', sharp],
    ['flat', flat],
  ] as const)('spells all twelve pitch classes in %s mode', (prefer, names) => {
    for (let pc = 0; pc < 12; pc++) {
      expect(formatPigPitch(midiToSpelling(60 + pc, prefer))).toBe(`${names[pc]}4`);
    }
  });
});

describe('isBlackKey', () => {
  it('matches the five black keys per octave', () => {
    const blacks = [61, 63, 66, 68, 70];
    for (let m = 60; m < 72; m++) expect(isBlackKey(m)).toBe(blacks.includes(m));
  });
});

describe('PIG pitch strings', () => {
  it('parses sharps, flats, doubles and naturals', () => {
    expect(parsePigPitch('C4')).toEqual({ step: 'C', alter: 0, octave: 4 });
    expect(parsePigPitch('C#4')).toEqual({ step: 'C', alter: 1, octave: 4 });
    expect(parsePigPitch('Db4')).toEqual({ step: 'D', alter: -1, octave: 4 });
    expect(parsePigPitch('C##4')).toEqual({ step: 'C', alter: 2, octave: 4 });
    expect(parsePigPitch('Dbb4')).toEqual({ step: 'D', alter: -2, octave: 4 });
    expect(parsePigPitch('B#3')).toEqual({ step: 'B', alter: 1, octave: 3 });
  });
  it('rejects garbage', () => {
    expect(() => parsePigPitch('H4')).toThrow();
    expect(() => parsePigPitch('C')).toThrow();
  });
  it('formats back to the same text', () => {
    for (const t of ['C4', 'C#4', 'Db4', 'C##4', 'Dbb4', 'A0', 'C8']) {
      expect(formatPigPitch(parsePigPitch(t))).toBe(t);
    }
  });
});
