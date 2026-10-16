import { ticksToSeconds } from '../../score/build.js';
import { spellingToMidi, type Alter, type Spelling, type Step } from '../../score/pitch.js';
import type { Note, Ornament, Score } from '../../score/types.js';
import { childElements, childText } from './dom.js';
import type { Element } from './dom.js';

interface PitchContext {
  lane: string;
  measure: number;
  offset: number;
  spelling: Spelling;
  part: number;
  staff: number;
}
interface PendingOrnament {
  note: Note;
  el: Element;
  context: PitchContext;
  duration: number;
}
interface KeyContext {
  part: number;
  staff: number | undefined;
  measure: number;
  offset: number;
  fifths: number;
  order: number;
}
const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const ACCIDENTALS: Record<string, Alter> = {
  natural: 0,
  sharp: 1,
  flat: -1,
  'double-sharp': 2,
  'sharp-sharp': 2,
  'flat-flat': -2,
  'natural-sharp': 1,
  'natural-flat': -1,
};
const signs = (el: Element) =>
  childElements(el).filter((n) => !['accidental-mark', 'wavy-line'].includes(n.tagName));

/** Collect source pitches before tie merging; resolve in musical time, not backup/XML order. */
export class OrnamentReader {
  private pitches: PitchContext[] = [];
  private pending: PendingOrnament[] = [];
  private keys: KeyContext[] = [];

  key(el: Element, part: number, measure: number, offset: number): void {
    const staff = el.getAttribute('number');
    const fifths = childText(el, 'fifths');
    this.keys.push({
      part,
      measure,
      offset,
      staff: staff ? Number(staff) : undefined,
      fifths: fifths === undefined ? NaN : Number(fifths),
      order: this.keys.length,
    });
  }

  pitch(context: PitchContext): void {
    this.pitches.push(context);
  }

  note(el: Element, note: Note, context: PitchContext, duration: number): void {
    const ornaments = childElements(el, 'notations').flatMap((n) => childElements(n, 'ornaments'));
    if (ornaments.length !== 1) return;
    const marks = signs(ornaments[0]!);
    if (
      marks.length !== 1 ||
      !['trill-mark', 'mordent', 'inverted-mordent'].includes(marks[0]!.tagName)
    )
      return;
    const sign = marks[0]!;
    // Compound/accelerating realizations need separate musical policy; preserve their notation.
    if (
      ['approach', 'departure', 'second-beat', 'last-beat'].some((a) => sign.hasAttribute(a)) ||
      sign.getAttribute('accelerate') === 'yes' ||
      (sign.hasAttribute('two-note-turn') && sign.getAttribute('two-note-turn') !== 'none')
    )
      return;
    this.pending.push({ note, el: ornaments[0]!, context, duration });
  }

  resolve(score: Pick<Score, 'divisions' | 'tempoMap'>): void {
    for (const { note, el, context, duration } of this.pending) {
      const sign = signs(el)[0]!;
      const key = this.keys
        .filter(
          (k) =>
            k.part === context.part &&
            (k.staff === undefined || k.staff === context.staff) &&
            (k.measure < context.measure ||
              (k.measure === context.measure && k.offset <= context.offset)),
        )
        .sort(
          (a, b) =>
            b.measure - a.measure ||
            b.offset - a.offset ||
            Number(b.staff !== undefined) - Number(a.staff !== undefined) ||
            b.order - a.order,
        )
        .at(0);
      const fifths = key?.fifths ?? 0;
      if (!Number.isInteger(fifths) || Math.abs(fifths) > 7) continue;
      const neighbor = (direction: -1 | 1) => {
        const index = STEPS.indexOf(note.spelling.step) + direction;
        const step = STEPS[(index + 7) % 7]!;
        const octave = note.spelling.octave + (index < 0 ? -1 : index > 6 ? 1 : 0);
        const order = fifths < 0 ? 'BEADGCF' : 'FCGDAEB';
        let alter = order.slice(0, Math.min(7, Math.abs(fifths))).includes(step)
          ? Math.sign(fifths)
          : 0;
        const earlier = this.pitches
          .filter(
            (p) =>
              p.lane === context.lane &&
              p.measure === context.measure &&
              (!key || key.measure < context.measure || p.offset >= key.offset) &&
              p.offset < context.offset &&
              p.spelling.step === step &&
              p.spelling.octave === octave,
          )
          .sort((a, b) => b.offset - a.offset);
        if (earlier[0]) alter = earlier[0].spelling.alter;
        const placement = direction === 1 ? 'above' : 'below';
        const marks = childElements(el, 'accidental-mark').filter(
          (mark) => (mark.getAttribute('placement') || 'above') === placement,
        );
        if (marks.length > 1) return undefined;
        if (marks[0]) {
          const value = ACCIDENTALS[marks[0].textContent?.trim() ?? ''];
          if (value === undefined) return undefined;
          alter = value;
        }
        return spellingToMidi({ step, octave, alter: alter as Alter });
      };
      let upperMidi = neighbor(1);
      let lowerMidi = neighbor(-1);
      const step = sign.getAttribute('trill-step');
      if (step) {
        const interval = ({ whole: 2, half: 1, unison: 0 } as Record<string, number>)[step];
        if (interval === undefined) continue;
        upperMidi = note.midi + interval;
        lowerMidi = note.midi - interval;
      }
      if (upperMidi === undefined || lowerMidi === undefined) continue;
      const start = sign.getAttribute('start-note') || 'main';
      if (!['main', 'upper', 'below'].includes(start)) continue;
      const rawBeats = sign.getAttribute('beats');
      const beats = rawBeats ? Number(rawBeats) : undefined;
      if (beats !== undefined && (!Number.isInteger(beats) || beats < 2 || beats > 64)) continue;
      const endTick = note.onsetTick + duration;
      note.ornament = {
        kind: sign.tagName as Ornament['kind'],
        long: sign.getAttribute('long') === 'yes',
        upperMidi,
        lowerMidi,
        startNote: start as Ornament['startNote'],
        ...(beats === undefined ? {} : { beats }),
        endTick,
        endSec: ticksToSeconds(score.tempoMap, score.divisions, endTick),
      };
    }
  }
}
