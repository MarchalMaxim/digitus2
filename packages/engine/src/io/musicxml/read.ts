import { finalizeScore, validateScore } from '../../score/build.js';
import { spellingToMidi } from '../../score/pitch.js';
import type { Alter, Spelling, Step } from '../../score/pitch.js';
import type { Assignment, Finger, Hand, KeySigEvent, MeasureInfo, Note, Score, TempoEvent, TimeSigEvent } from '../../score/types.js';
import { childElements, childText, firstChild, parseXml } from './dom.js';
import type { Element } from './dom.js';
import { timewiseToPartwise } from './timewise.js';
import { unpackMusicXml } from './unpack.js';

export interface ParsedMusicXml {
  score: Score;
  editorial: Assignment;
  warnings: string[];
}

interface PendingTie {
  note: Note;
}

const BEAT_UNIT_QUARTERS: Record<string, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125,
};

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

export function parseMusicXml(input: string | Uint8Array, opts: { source?: string } = {}): ParsedMusicXml {
  const doc = timewiseToPartwise(parseXml(unpackMusicXml(input)));
  const root = doc.documentElement!;
  if (root.tagName !== 'score-partwise') throw new Error('not a MusicXML score');
  const warnings: string[] = [];
  const editorial: Assignment = {};

  // Global divisions = lcm of all <divisions> in the document.
  let divisions = 1;
  for (const d of allDescendants(root, 'divisions')) {
    const v = Number((d.textContent ?? '').trim());
    if (Number.isInteger(v) && v > 0) divisions = lcm(divisions, v);
  }

  const parts = childElements(root, 'part');
  const measureStarts: number[] = [];
  const measureLengths: number[] = [];
  const measureNumbers: string[] = [];
  const notes: Note[] = [];
  const tempoMap: TempoEvent[] = [];
  const timeSignatures: TimeSigEvent[] = [];
  const keySignatures: KeySigEvent[] = [];
  let noteIndex = 0;

  parts.forEach((part, partIndex) => {
    let currentDivisions = 1;
    let staves = 1;
    const pending = new Map<string, PendingTie>();
    let measureStart = 0;
    childElements(part, 'measure').forEach((measure, mIndex) => {
      if (measureStarts[mIndex] === undefined) {
        measureStarts[mIndex] = mIndex === 0 ? 0 : measureStarts[mIndex - 1]! + (measureLengths[mIndex - 1] ?? 0);
        measureNumbers[mIndex] = measure.getAttribute('number') ?? String(mIndex + 1);
      }
      measureStart = measureStarts[mIndex]!;
      let cursor = measureStart;
      let maxCursor = measureStart;
      // Onset of the last non-chord <note> element; <chord/> tones share it. Tracked per element
      // (not via the merged Note) so a chord tone beside a tie continuation is not pulled back
      // to the tie start's onset.
      let chordOnset = measureStart;
      let lastAdvance = 0;
      for (const el of childElements(measure)) {
        switch (el.tagName) {
          case 'attributes': {
            const d = childText(el, 'divisions');
            if (d) currentDivisions = Number(d);
            const st = childText(el, 'staves');
            if (st) staves = Number(st);
            const key = firstChild(el, 'key');
            if (key && partIndex === 0) {
              const fifths = Number(childText(key, 'fifths') ?? '0');
              const mode = childText(key, 'mode');
              keySignatures.push(mode === 'major' || mode === 'minor' ? { tick: cursor, fifths, mode } : { tick: cursor, fifths });
            }
            const time = firstChild(el, 'time');
            if (time && partIndex === 0) {
              timeSignatures.push({ tick: cursor, beats: Number(childText(time, 'beats') ?? '4'), beatType: Number(childText(time, 'beat-type') ?? '4') });
            }
            break;
          }
          case 'direction':
          case 'sound': {
            const qpm = readTempo(el);
            if (qpm !== undefined && partIndex === 0) tempoMap.push({ tick: cursor, qpm });
            break;
          }
          case 'backup': {
            cursor -= scaled(childText(el, 'duration'), currentDivisions, divisions);
            break;
          }
          case 'forward': {
            cursor += scaled(childText(el, 'duration'), currentDivisions, divisions);
            maxCursor = Math.max(maxCursor, cursor);
            break;
          }
          case 'note': {
            const index = noteIndex++;
            const isChord = firstChild(el, 'chord') !== undefined;
            const isGrace = firstChild(el, 'grace') !== undefined;
            const isRest = firstChild(el, 'rest') !== undefined;
            const duration = isGrace ? 0 : scaled(childText(el, 'duration'), currentDivisions, divisions);
            const onset = isChord ? chordOnset : cursor;
            if (!isChord) chordOnset = cursor;
            if (!isChord && !isGrace) {
              cursor += duration;
              lastAdvance = duration;
              maxCursor = Math.max(maxCursor, cursor);
            }
            if (isRest) break;
            const pitch = firstChild(el, 'pitch');
            if (!pitch) {
              warnings.push(`note ${index}: no pitch and no rest, skipped`);
              break;
            }
            const spelling: Spelling = {
              step: (childText(pitch, 'step') ?? 'C') as Step,
              alter: Number(childText(pitch, 'alter') ?? '0') as Alter,
              octave: Number(childText(pitch, 'octave') ?? '4'),
            };
            const staff = Number(childText(el, 'staff') ?? '1');
            const hand: Hand = staves >= 2 ? (staff === 1 ? 'R' : 'L') : partIndex === 0 ? 'R' : 'L';
            const voice = Number(childText(el, 'voice') ?? '1');
            const midi = spellingToMidi(spelling);
            const ties = childElements(el, 'tie').map((t) => t.getAttribute('type'));
            const tied = childElements(firstChild(el, 'notations') ?? el, 'tied').map((t) => t.getAttribute('type'));
            const tieStop = ties.includes('stop') || (ties.length === 0 && tied.includes('stop'));
            const tieStart = ties.includes('start') || (ties.length === 0 && tied.includes('start'));
            const tieKey = `${staff}:${midi}`;
            const offset = isGrace ? onset : onset + (isChord ? lastAdvance : duration);

            if (tieStop) {
              const prev = pending.get(tieKey);
              if (prev) {
                prev.note.offsetTick = Math.max(prev.note.offsetTick, offset);
                prev.note.sourceIndices.push(index);
                if (!tieStart) pending.delete(tieKey);
                break;
              }
              warnings.push(`note ${index}: tie stop without a start`);
            }
            const note: Note = {
              id: `n${index}`,
              onsetTick: onset,
              offsetTick: offset,
              onsetSec: 0,
              offsetSec: 0,
              midi,
              spelling,
              hand,
              staff,
              voice,
              measureIndex: mIndex,
              isGrace,
              chordId: '',
              sourceIndices: [index],
            };
            notes.push(note);
            if (tieStart) pending.set(tieKey, { note });
            const finger = readFingering(el);
            if (finger !== undefined) editorial[note.id] = { finger, source: 'editorial' };
            break;
          }
          default:
            break;
        }
      }
      measureLengths[mIndex] = Math.max(measureLengths[mIndex] ?? 0, maxCursor - measureStart);
    });
    if (pending.size > 0) warnings.push(`part ${partIndex}: ${pending.size} tie(s) never closed`);
  });

  // Second pass: measure starts must reflect lengths from all parts; recompute and remap notes.
  const measures: MeasureInfo[] = [];
  let start = 0;
  for (let i = 0; i < measureLengths.length; i++) {
    measures.push({ index: i, startTick: start, lengthTicks: measureLengths[i] ?? 0, number: measureNumbers[i] ?? String(i + 1) });
    start += measureLengths[i] ?? 0;
  }
  for (const n of notes) {
    const delta = measures[n.measureIndex]!.startTick - measureStarts[n.measureIndex]!;
    if (delta !== 0) {
      n.onsetTick += delta;
      n.offsetTick += delta;
    }
  }

  const score = finalizeScore({
    meta: readMeta(root, opts.source),
    divisions,
    tempoMap: tempoMap.length > 0 ? tempoMap : [{ tick: 0, qpm: 120 }],
    timeSignatures,
    keySignatures,
    measures,
    notes,
  });
  const problems = validateScore(score);
  if (problems.length > 0) throw new Error(`invalid score: ${problems.join('; ')}`);
  return { score, editorial, warnings };
}

function scaled(text: string | undefined, current: number, global: number): number {
  const d = Number(text ?? '0');
  return Math.round((d * global) / current);
}

function readTempo(el: Element): number | undefined {
  const sound = el.tagName === 'sound' ? el : allDescendants(el, 'sound')[0];
  const tempoAttr = sound?.getAttribute('tempo');
  if (tempoAttr && Number(tempoAttr) > 0) return Number(tempoAttr);
  const metronome = allDescendants(el, 'metronome')[0];
  if (!metronome) return undefined;
  const unit = childText(metronome, 'beat-unit') ?? 'quarter';
  const dots = childElements(metronome, 'beat-unit-dot').length;
  const perMinute = Number(childText(metronome, 'per-minute') ?? '0');
  if (!(perMinute > 0)) return undefined;
  const quarters = (BEAT_UNIT_QUARTERS[unit] ?? 1) * (dots > 0 ? 1.5 : 1);
  return perMinute * quarters;
}

function readFingering(noteEl: Element): Finger | undefined {
  for (const notations of childElements(noteEl, 'notations')) {
    for (const technical of childElements(notations, 'technical')) {
      for (const f of childElements(technical, 'fingering')) {
        const v = Number((f.textContent ?? '').trim());
        if (Number.isInteger(v) && v >= 1 && v <= 5) return v as Finger;
      }
    }
  }
  return undefined;
}

function readMeta(root: Element, source?: string): Score['meta'] {
  const meta: Score['meta'] = {};
  const work = firstChild(root, 'work');
  const title = (work && childText(work, 'work-title')) || childText(root, 'movement-title');
  if (title) meta.title = title;
  const ident = firstChild(root, 'identification');
  if (ident) {
    const composer = childElements(ident, 'creator').find((c) => c.getAttribute('type') === 'composer');
    if (composer?.textContent?.trim()) meta.composer = composer.textContent.trim();
  }
  if (source !== undefined) meta.source = source;
  return meta;
}

function allDescendants(el: Element, name: string): Element[] {
  const out: Element[] = [];
  const list = el.getElementsByTagName(name);
  for (let i = 0; i < list.length; i++) out.push(list.item(i) as Element);
  return out;
}
