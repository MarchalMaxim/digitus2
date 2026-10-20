import type { Note, Score } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { handOfKey, keyForNote, noteAt, noteBoxes } from './noteKey.js';

function note(id: string, midi: number, hand: 'L' | 'R'): Note {
  return {
    id,
    onsetTick: 0,
    offsetTick: 1,
    onsetSec: 0,
    offsetSec: 1,
    midi,
    spelling: { step: 'C', alter: 0, octave: 4 },
    hand,
    staff: hand === 'R' ? 1 : 2,
    voice: 1,
    measureIndex: 0,
    isGrace: false,
    chordId: id,
    sourceIndices: [0],
  };
}

describe('keyForNote', () => {
  it('maps a note to its key with the finger on screen and its hand', () => {
    const n = note('n1', 60, 'R');
    expect(keyForNote(n, { n1: { finger: 1, source: 'engine' } })).toEqual({
      midi: 60,
      finger: 1,
      hand: 'R',
    });
  });
  it('presses the key without a number when the fingering has no digit for the note', () => {
    const n = note('n2', 48, 'L');
    expect(keyForNote(n, {})).toEqual({ midi: 48, finger: null, hand: 'L' });
    expect(keyForNote(n, null)).toEqual({ midi: 48, finger: null, hand: 'L' });
  });
});

describe('handOfKey', () => {
  const score = { notes: [note('a', 48, 'L'), note('b', 60, 'R'), note('c', 55, 'L')] } as Score;
  it("is the hand that plays that key in the piece, else the right hand's", () => {
    expect(handOfKey(score, 48)).toBe('L');
    expect(handOfKey(score, 60)).toBe('R');
    expect(handOfKey(score, 55)).toBe('L');
    expect(handOfKey(score, 72)).toBe('R');
  });
});

describe('noteBoxes and noteAt', () => {
  function rect(el: Element, x: number, y: number, w: number, h: number): void {
    el.getBoundingClientRect = () =>
      ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h }) as DOMRect;
  }
  it('measures each note of a page from the host corner, padded, and finds the note under a point', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<svg><g class="note" id="n1"><use/></g><g class="note" id="n2"><use/></g>' +
      '<g class="note"><use/></g></svg>';
    rect(host, 100, 50, 600, 800);
    const [n1, n2, anon] = Array.from(host.querySelectorAll('g.note'));
    rect(n1!, 110, 60, 10, 8); // 10..20 x 10..18 in the host
    rect(n2!, 140, 60, 10, 8); // 40..50 x 10..18
    rect(anon!, 170, 60, 10, 8);
    const boxes = noteBoxes(host, host.firstElementChild!, 2);
    expect(boxes).toEqual([
      { id: 'n1', left: 8, top: 8, right: 22, bottom: 20 },
      { id: 'n2', left: 38, top: 8, right: 52, bottom: 20 },
    ]);
    expect(noteAt(boxes, 15, 14)?.id).toBe('n1');
    expect(noteAt(boxes, 51, 19)?.id).toBe('n2'); // inside the padding
    expect(noteAt(boxes, 30, 14)).toBeNull();
    expect(noteAt(boxes, 15, 30)).toBeNull();
  });
  it('leaves out a note drawn nowhere', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g class="note" id="n1"><use/></g></svg>';
    rect(host, 0, 0, 600, 800);
    rect(host.querySelector('g.note')!, 0, 0, 0, 0);
    expect(noteBoxes(host, host.firstElementChild!, 2)).toEqual([]);
  });
});
