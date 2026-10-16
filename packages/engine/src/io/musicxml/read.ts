import { finalizeScore, validateScore } from '../../score/build.js';
import { spellingToMidi } from '../../score/pitch.js';
import type { Alter, Spelling, Step } from '../../score/pitch.js';
import type {
  Assignment,
  Finger,
  Hand,
  KeySigEvent,
  MeasureInfo,
  Note,
  Score,
  TempoEvent,
  TimeSigEvent,
} from '../../score/types.js';
import { childElements, childText, firstChild, parseXml } from './dom.js';
import type { Element } from './dom.js';
import { timewiseToPartwise } from './timewise.js';
import { unpackMusicXml } from './unpack.js';
import { OrnamentReader } from './ornaments.js';

export interface ParsedMusicXml {
  score: Score;
  editorial: Assignment;
  warnings: string[];
}

interface PendingTie {
  note: Note;
  staff: number;
  midi: number;
  endMeasureIndex: number;
  endOffset: number;
}

/**
 * A tempo, time or key event located by measure and offset within it. Measure start ticks are
 * only final after every part has been read (a later part can make a measure longer), so these
 * become absolute ticks in the second pass.
 */
type Located<T extends { tick: number }> = {
  measureIndex: number;
  offset: number;
  event: Omit<T, 'tick'>;
};

const DEFAULT_QPM = 120;

const BEAT_UNIT_QUARTERS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
};

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

export function parseMusicXml(
  input: string | Uint8Array,
  opts: {
    source?: string;
    /**
     * Evaluation only: retain duplicate note events and each chord member's
     * declared duration, so application import normalization cannot hide OMR
     * errors. Staves are numbered globally in part order. Contiguous ties still
     * merge into sounding notes; this is not a lossless XML AST.
     * Missing/invalid pitch or nongrace duration and any parser warning fail
     * closed instead of silently repairing the material being measured.
     */
    preserveNotation?: boolean;
  } = {},
): ParsedMusicXml {
  const doc = timewiseToPartwise(parseXml(unpackMusicXml(input)));
  const root = doc.documentElement!;
  if (root.tagName !== 'score-partwise') throw new Error('not a MusicXML score');
  const warnings: string[] = [];
  const editorial: Assignment = {};

  // Global divisions = lcm of all <divisions> in the document.
  let divisions = 1;
  for (const d of allDescendants(root, 'divisions')) {
    const v = Number((d.textContent ?? '').trim());
    if (opts.preserveNotation && (!Number.isSafeInteger(v) || v <= 0)) {
      throw new Error('cannot preserve notation: divisions must be a positive safe integer');
    }
    if (Number.isInteger(v) && v > 0) divisions = lcm(divisions, v);
  }
  if (opts.preserveNotation && !Number.isSafeInteger(divisions)) {
    throw new Error('cannot preserve notation: combined divisions exceed safe integer range');
  }

  const parts = childElements(root, 'part');
  const staffOffsets = opts.preserveNotation ? preservedStaffOffsets(parts) : [];
  const measureStarts: number[] = [];
  const measureLengths: number[] = [];
  const measureNumbers: string[] = [];
  const notes: Note[] = [];
  const ornaments = new OrnamentReader();
  const tempos: Located<TempoEvent>[] = [];
  const times: Located<TimeSigEvent>[] = [];
  const keys: Located<KeySigEvent>[] = [];
  const tiedEnds = new Map<Note, { measureIndex: number; offset: number }>();
  const tieJoins: {
    previousMeasure: number;
    previousEnd: number;
    nextMeasure: number;
    nextOnset: number;
  }[] = [];
  let noteIndex = 0;

  parts.forEach((part, partIndex) => {
    let currentDivisions = 1;
    let staves = 1;
    // Open ties keyed by `${staff}:${voice}:${midi}`.
    const pending = new Map<string, PendingTie>();
    let measureStart = 0;
    childElements(part, 'measure').forEach((measure, mIndex) => {
      if (measureStarts[mIndex] === undefined) {
        measureStarts[mIndex] =
          mIndex === 0 ? 0 : measureStarts[mIndex - 1]! + (measureLengths[mIndex - 1] ?? 0);
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
      const at = <T extends { tick: number }>(event: Omit<T, 'tick'>): Located<T> => ({
        measureIndex: mIndex,
        offset: cursor - measureStart,
        event,
      });
      for (const el of childElements(measure)) {
        switch (el.tagName) {
          case 'attributes': {
            const d = childText(el, 'divisions');
            if (d) currentDivisions = Number(d);
            const st = childText(el, 'staves');
            if (st) staves = Number(st);
            const key = firstChild(el, 'key');
            for (const ornamentKey of childElements(el, 'key')) {
              ornaments.key(ornamentKey, partIndex, mIndex, cursor - measureStart);
            }
            if (key && partIndex === 0) {
              const fifths = Number(childText(key, 'fifths') ?? '0');
              const mode = childText(key, 'mode');
              keys.push(
                at<KeySigEvent>(
                  mode === 'major' || mode === 'minor' ? { fifths, mode } : { fifths },
                ),
              );
            }
            const time = firstChild(el, 'time');
            if (time && partIndex === 0) {
              times.push(
                at<TimeSigEvent>({
                  beats: Number(childText(time, 'beats') ?? '4'),
                  beatType: Number(childText(time, 'beat-type') ?? '4'),
                }),
              );
            }
            break;
          }
          case 'direction':
          case 'sound': {
            const qpm = readTempo(el);
            if (qpm !== undefined && partIndex === 0) tempos.push(at<TempoEvent>({ qpm }));
            break;
          }
          case 'backup': {
            if (opts.preserveNotation) {
              validatePreservedDuration(
                childText(el, 'duration'),
                currentDivisions,
                divisions,
                'backup',
              );
            }
            cursor -= scaled(childText(el, 'duration'), currentDivisions, divisions);
            break;
          }
          case 'forward': {
            if (opts.preserveNotation) {
              validatePreservedDuration(
                childText(el, 'duration'),
                currentDivisions,
                divisions,
                'forward',
              );
            }
            cursor += scaled(childText(el, 'duration'), currentDivisions, divisions);
            maxCursor = Math.max(maxCursor, cursor);
            break;
          }
          case 'note': {
            const index = noteIndex++;
            const isChord = firstChild(el, 'chord') !== undefined;
            const isGrace = firstChild(el, 'grace') !== undefined;
            const isRest = firstChild(el, 'rest') !== undefined;
            // Cue notes are printed small for another player; they take time but are not played.
            const isCue = firstChild(el, 'cue') !== undefined;
            if (opts.preserveNotation && !isGrace) {
              validatePreservedDuration(
                childText(el, 'duration'),
                currentDivisions,
                divisions,
                `note ${index}`,
              );
            }
            const duration = isGrace
              ? 0
              : scaled(childText(el, 'duration'), currentDivisions, divisions);
            const onset = isChord ? chordOnset : cursor;
            if (!isChord) chordOnset = cursor;
            if (!isChord && !isGrace) {
              cursor += duration;
              lastAdvance = duration;
              maxCursor = Math.max(maxCursor, cursor);
            }
            // A chord member never advances the document cursor. Evaluation
            // nevertheless preserves its declared end, including an overlong
            // member that extends beyond the leading note or the current bar.
            if (opts.preserveNotation && isChord && !isGrace) {
              maxCursor = Math.max(maxCursor, onset + duration);
            }
            if (isRest || isCue) break;
            const pitch = firstChild(el, 'pitch');
            if (!pitch) {
              warnings.push(`note ${index}: no pitch and no rest, skipped`);
              break;
            }
            if (opts.preserveNotation) {
              const step = childText(pitch, 'step');
              const octave = childText(pitch, 'octave');
              if (
                !step ||
                !/^[A-G]$/.test(step) ||
                !octave?.trim() ||
                !Number.isSafeInteger(Number(octave))
              ) {
                throw new Error(
                  `cannot preserve notation: note ${index}: invalid or missing pitch step/octave`,
                );
              }
            }
            const alter = readAlter(childText(pitch, 'alter'), index, warnings);
            if (alter === undefined) break;
            const spelling: Spelling = {
              step: (childText(pitch, 'step') ?? 'C') as Step,
              alter,
              octave: Number(childText(pitch, 'octave') ?? '4'),
            };
            const localStaff = Number(childText(el, 'staff') ?? '1');
            const staff = opts.preserveNotation
              ? localStaff + staffOffsets[partIndex]!
              : localStaff;
            const hand: Hand =
              staves >= 2 ? (localStaff === 1 ? 'R' : 'L') : partIndex === 0 ? 'R' : 'L';
            const voice = Number(childText(el, 'voice') ?? '1');
            const midi = spellingToMidi(spelling);
            const ties = childElements(el, 'tie').map((t) => t.getAttribute('type'));
            const tied = childElements(firstChild(el, 'notations') ?? el, 'tied').map((t) =>
              t.getAttribute('type'),
            );
            const tieStop = ties.includes('stop') || (ties.length === 0 && tied.includes('stop'));
            const tieStart =
              ties.includes('start') || (ties.length === 0 && tied.includes('start'));
            const ornamentContext = {
              lane: `${partIndex}:${staff}`,
              measure: mIndex,
              offset: onset - measureStart,
              spelling,
              part: partIndex,
              // Numbered key signatures are part-local even when scan staff IDs are global.
              staff: localStaff,
            };
            if (!tieStop || firstChild(el, 'accidental')) ornaments.pitch(ornamentContext);
            const tieKey = `${staff}:${voice}:${midi}`;
            const offset = isGrace
              ? onset
              : onset + (isChord && !opts.preserveNotation ? lastAdvance : duration);

            if (tieStop) {
              const open = findPendingTie(pending, tieKey, staff, midi);
              if (open) {
                const [openKey, prev] = open;
                if (opts.preserveNotation) {
                  tieJoins.push({
                    previousMeasure: prev.endMeasureIndex,
                    previousEnd: prev.endOffset,
                    nextMeasure: mIndex,
                    nextOnset: onset - measureStart,
                  });
                  tiedEnds.set(prev.note, { measureIndex: mIndex, offset: offset - measureStart });
                } else {
                  prev.note.offsetTick = Math.max(prev.note.offsetTick, offset);
                }
                prev.note.sourceIndices.push(index);
                prev.endMeasureIndex = mIndex;
                prev.endOffset = offset - measureStart;
                pending.delete(openKey);
                // A continuation (stop and start) stays open, now under this note's voice.
                if (tieStart) pending.set(tieKey, prev);
                break;
              }
              warnings.push(`note ${index}: tie stop without a start`);
            }
            if (opts.preserveNotation && tieStart && pending.has(tieKey)) {
              throw new Error(
                `cannot preserve notation: note ${index}: tie already open for this staff, voice and pitch`,
              );
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
            if (!isGrace) ornaments.note(el, note, ornamentContext, offset - onset);
            if (tieStart) {
              if (opts.preserveNotation) {
                tiedEnds.set(note, { measureIndex: mIndex, offset: offset - measureStart });
              }
              pending.set(tieKey, {
                note,
                staff,
                midi,
                endMeasureIndex: mIndex,
                endOffset: offset - measureStart,
              });
            }
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

  // Second pass: measure starts must reflect lengths from all parts; recompute and remap notes
  // and events.
  const measures: MeasureInfo[] = [];
  let start = 0;
  for (let i = 0; i < measureLengths.length; i++) {
    measures.push({
      index: i,
      startTick: start,
      lengthTicks: measureLengths[i] ?? 0,
      number: measureNumbers[i] ?? String(i + 1),
    });
    start += measureLengths[i] ?? 0;
  }
  // A later part can lengthen a bar after its ties were read. Only final
  // coordinates distinguish a genuine tie gap from provisional bar overlap.
  for (const join of tieJoins) {
    if (
      measures[join.previousMeasure]!.startTick + join.previousEnd !==
      measures[join.nextMeasure]!.startTick + join.nextOnset
    ) {
      throw new Error(
        'cannot preserve notation: tie segments must be contiguous across final measure boundaries',
      );
    }
  }
  for (const n of notes) {
    const delta = measures[n.measureIndex]!.startTick - measureStarts[n.measureIndex]!;
    if (delta !== 0) {
      n.onsetTick += delta;
      n.offsetTick += delta;
    }
    const tiedEnd = tiedEnds.get(n);
    if (tiedEnd) {
      n.offsetTick = measures[tiedEnd.measureIndex]!.startTick + tiedEnd.offset;
    }
  }
  const absolute = <T extends { tick: number }>(located: Located<T>[]): T[] =>
    located
      .map((l) => ({ tick: measures[l.measureIndex]!.startTick + l.offset, ...l.event }) as T)
      .sort((a, b) => a.tick - b.tick);
  const tempoMap = absolute<TempoEvent>(tempos);
  if (tempoMap.length === 0 || tempoMap[0]!.tick > 0)
    tempoMap.unshift({ tick: 0, qpm: DEFAULT_QPM });

  if (opts.preserveNotation && warnings.length > 0) {
    throw new Error(`cannot preserve notation: ${warnings.join('; ')}`);
  }
  ornaments.resolve({ divisions, tempoMap });
  const score = finalizeScore({
    meta: readMeta(root, opts.source),
    divisions,
    tempoMap,
    timeSignatures: absolute<TimeSigEvent>(times),
    keySignatures: absolute<KeySigEvent>(keys),
    measures,
    notes: opts.preserveNotation ? notes : dropDuplicates(notes, editorial, warnings),
  });
  const problems = validateScore(score);
  if (problems.length > 0) throw new Error(`invalid score: ${problems.join('; ')}`);
  return { score, editorial, warnings };
}

/** Reserve each part's complete staff range before assigning global staff IDs. */
function preservedStaffOffsets(parts: Element[]): number[] {
  let total = 0;
  return parts.map((part) => {
    const offset = total;
    let count = 1;
    for (const tag of ['staves', 'staff']) {
      for (const element of allDescendants(part, tag)) {
        const value = Number((element.textContent ?? '').trim());
        if (!Number.isSafeInteger(value) || value <= 0) {
          throw new Error(`cannot preserve notation: ${tag} must be a positive safe integer`);
        }
        count = Math.max(count, value);
      }
    }
    total += count;
    if (!Number.isSafeInteger(total)) {
      throw new Error('cannot preserve notation: combined staff count exceeds safe integer range');
    }
    return offset;
  });
}

/** The open tie in the same voice, else one on the same staff and pitch in another voice. */
function findPendingTie(
  pending: Map<string, PendingTie>,
  key: string,
  staff: number,
  midi: number,
): [string, PendingTie] | undefined {
  const same = pending.get(key);
  if (same) return [key, same];
  for (const entry of pending) {
    if (entry[1].staff === staff && entry[1].midi === midi) return entry;
  }
  return undefined;
}

/**
 * Keeps the first of several non-grace notes with the same hand, onset and pitch (a unison
 * written in two voices is one key press). Grace notes share their main note's onset, so a
 * grace figure that repeats a pitch is not a duplicate.
 */
function dropDuplicates(notes: Note[], editorial: Assignment, warnings: string[]): Note[] {
  const seen = new Map<string, Note>();
  return notes.filter((n) => {
    if (n.isGrace) return true;
    const key = `${n.hand}:${n.onsetTick}:${n.midi}`;
    const first = seen.get(key);
    if (!first) {
      seen.set(key, n);
      return true;
    }
    warnings.push(
      `note ${n.sourceIndices[0]}: duplicate of note ${first.sourceIndices[0]} (same hand, onset and pitch), dropped`,
    );
    if (!first.ornament && n.ornament) first.ornament = n.ornament;
    delete editorial[n.id];
    return false;
  });
}

/** `<alter>` as a semitone count in -2..2; microtones are rounded, anything else skips the note. */
function readAlter(text: string | undefined, index: number, warnings: string[]): Alter | undefined {
  if (text === undefined || text === '') return 0;
  const value = Number(text);
  if (!Number.isFinite(value)) {
    warnings.push(`note ${index}: alter "${text}" is not a number, skipped`);
    return undefined;
  }
  const rounded = Math.round(value) || 0; // `|| 0` turns -0 into 0
  if (rounded < -2 || rounded > 2) {
    warnings.push(`note ${index}: alter ${text} outside -2..2, skipped`);
    return undefined;
  }
  if (rounded !== value)
    warnings.push(`note ${index}: microtonal alter ${text} rounded to ${rounded}`);
  return rounded as Alter;
}

function scaled(text: string | undefined, current: number, global: number): number {
  const d = Number(text ?? '0');
  return Math.round((d * global) / current);
}

/** Evaluation must reject timing that application import would round or default. */
function validatePreservedDuration(
  text: string | undefined,
  current: number,
  global: number,
  location: string,
): void {
  const declared = Number(text);
  const exactTicks = (declared * global) / current;
  if (!(declared > 0) || !Number.isSafeInteger(exactTicks) || exactTicks <= 0) {
    throw new Error(`cannot preserve notation: ${location}: invalid or missing duration`);
  }
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
  // Each dot adds half the previous value: 1, 1.5, 1.75, ... times the undotted unit.
  const quarters = (BEAT_UNIT_QUARTERS[unit] ?? 1) * (2 - 0.5 ** dots);
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
    const composer = childElements(ident, 'creator').find(
      (c) => c.getAttribute('type') === 'composer',
    );
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
