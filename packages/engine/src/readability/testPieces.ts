import { buildHandSequence } from '../fingering/sequence.js';
import { parsePig } from '../io/pig/read.js';
import type { Assignment, Hand, Score } from '../score/types.js';

/**
 * Hand-made pieces for the readability tests: a list of events per hand, each a MIDI pitch or a
 * chord of pitches with its fingers, at `step` seconds apart. Built through a PIG text so the
 * score is the engine's own (note ids, hand sequence).
 */
export type Spec = [pitch: number | number[], finger: number | number[]];

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nameOf = (m: number): string => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

export interface TestPiece {
  score: Score;
  /** The engine's fingers as given in the spec (a stand-in for a solved fingering). */
  full: Assignment;
}

export function pieceOf(right: Spec[], left: Spec[] = [], step = 0.5): TestPiece {
  const rows: Array<[number, number, string, 0 | 1, number]> = [];
  const add = (specs: Spec[], ch: 0 | 1): void => {
    specs.forEach(([p, f], t) => {
      const ps = Array.isArray(p) ? p : [p];
      const fs = Array.isArray(f) ? f : ps.map(() => f);
      ps.forEach((pp, i) =>
        rows.push([
          +(t * step).toFixed(4),
          +((t + 1) * step).toFixed(4),
          nameOf(pp),
          ch,
          ch === 1 ? -fs[i]! : fs[i]!,
        ]),
      );
    });
  };
  add(right, 0);
  add(left, 1);
  rows.sort((a, b) => a[0] - b[0] || a[3] - b[3] || 0);
  const text =
    '//Version: PianoFingering_v170101\n' +
    rows
      .map(([on, off, p, ch, f], i) => `${i}\t${on}\t${off}\t${p}\t80\t80\t${ch}\t${f}`)
      .join('\n') +
    '\n';
  const { score, assignment } = parsePig(text);
  return { score, full: assignment };
}

/** Note ids of a hand in sequence order (thumb side first within an event). */
export function idsOf(score: Score, hand: Hand): string[] {
  return buildHandSequence(score, hand).notes.map((n) => n.noteId);
}

/** A seeded generator, so the property tests are reproducible. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * A random piece of both hands: single notes and chords of two to four notes, rests, reused
 * motifs (so repeats occur) and random, often absurd, fingers. Chord fingers are distinct, as a
 * hand's are.
 */
export function randomPiece(seed: number, events = 40): TestPiece {
  const rnd = lcg(seed);
  const hands: Spec[][] = [[], []];
  for (const ch of [0, 1] as const) {
    let p = ch === 0 ? 67 : 48;
    const motif: Spec[] = [];
    for (let s = 0; s < events; s++) {
      let event: Spec;
      if (motif.length >= 4 && rnd() < 0.3) {
        event = motif[s % motif.length]!;
      } else {
        const size = rnd() < 0.7 ? 1 : 2 + Math.floor(rnd() * 3);
        p = Math.max(
          ch === 0 ? 55 : 31,
          Math.min(ch === 0 ? 84 : 60, p + Math.floor(rnd() * 15) - 7),
        );
        const pitches: number[] = [];
        let q = p;
        while (pitches.length < size) {
          pitches.push(q);
          q += 1 + Math.floor(rnd() * 4);
        }
        const pool = [1, 2, 3, 4, 5];
        const fingers = pitches.map(() => pool.splice(Math.floor(rnd() * pool.length), 1)[0]!);
        // The right hand's thumb side is the low note, the left hand's the high one.
        if (ch === 1) fingers.sort((a, b) => b - a);
        else fingers.sort((a, b) => a - b);
        event = size === 1 ? [pitches[0]!, fingers[0]!] : [pitches, fingers];
        if (motif.length < 6) motif.push(event);
      }
      hands[ch]!.push(event);
    }
  }
  return pieceOf(hands[0]!, hands[1]!, 0.5);
}
