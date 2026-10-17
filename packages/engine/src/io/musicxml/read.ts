import { finalizeScore, UNMARKED_VELOCITY, validateScore } from '../../score/build.js';
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

/**
 * A dynamics mark (or a `<sound dynamics>`) as a velocity from its position on, or a gradual
 * change (a hairpin, cresc., dim.), for its part: every staff of it, or one staff when the mark
 * stands outside the staves (`dynamicsStaff`).
 */
type DynamicsEvent = {
  part: number;
  staff: number | undefined;
  measureIndex: number;
  offset: number;
} & ({ velocity: number } | Ramp);

interface Ramp {
  /** +1 louder, -1 softer. */
  direction: 1 | -1;
  /** A hairpin's part and `<wedge number>`, which pair it with its stop (`WedgeStop`). */
  wedge?: string;
}

/** A hairpin's end, `<wedge type="stop">`; cresc., dim. and a hairpin left open run to the next mark. */
interface WedgeStop {
  wedge: string;
  measureIndex: number;
  offset: number;
}

const DEFAULT_QPM = 120;

/**
 * The MIDI velocity each dynamics mark plays at: steps of 12 around mf, so a change from p to f
 * is a clear step rather than a switch (smplr's gain grows with the square of the velocity, on
 * top of the louder sample layer).
 */
const DYNAMICS_VELOCITY: Record<string, number> = {
  ppp: 32,
  pp: 44,
  p: 56,
  mp: 68,
  mf: 80,
  f: 92,
  ff: 104,
  fff: 116,
};

/** How far a hairpin, cresc. or dim. goes when no mark in its direction ends it: one mark's step. */
const RAMP_STEP = 12;
/** A cresc. or dim. without a later mark (or a hairpin without a stop) lasts this many bars. */
const RAMP_BARS = 4;

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
  const dynamics: DynamicsEvent[] = [];
  const wedgeStops: WedgeStop[] = [];
  /** Each note's part and staff within it, which the dynamics marks are written per. */
  const noteStaves = new Map<Note, { part: number; staff: number }>();
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
            // A direction's <offset> moves its sound only with sound="yes".
            const shift = firstChild(el, 'offset');
            const where = {
              part: partIndex,
              staff: dynamicsStaff(el, staves),
              measureIndex: mIndex,
              offset:
                cursor -
                measureStart +
                (shift?.getAttribute('sound') === 'yes'
                  ? scaled(shift.textContent ?? '0', currentDivisions, divisions)
                  : 0),
            };
            const velocity = readDynamics(el);
            if (velocity !== undefined) dynamics.push({ ...where, velocity });
            if (el.tagName !== 'direction') break;
            for (const w of allDescendants(el, 'wedge')) {
              const wedge = `${partIndex}:${w.getAttribute('number') ?? '1'}`;
              const type = w.getAttribute('type');
              if (type === 'crescendo' || type === 'diminuendo') {
                dynamics.push({ ...where, direction: type === 'crescendo' ? 1 : -1, wedge });
              } else if (type === 'stop') {
                wedgeStops.push({ wedge, measureIndex: mIndex, offset: where.offset });
              }
            }
            const direction = wordsDirection(el);
            if (direction !== undefined) dynamics.push({ ...where, direction });
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
            noteStaves.set(note, { part: partIndex, staff: localStaff });
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
  applyDynamics(notes, noteStaves, dynamics, wedgeStops, measures);
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

/**
 * The velocity a `<direction>` or `<sound>` sets: its dynamics mark (ppp to fff), else its
 * `<sound dynamics>`, a percentage of forte (MIDI velocity 90). A mark outside ppp to fff (sfz,
 * fp) is an accent, so the direction sets no level, whatever its sound says.
 */
function readDynamics(el: Element): number | undefined {
  const marks = el.tagName === 'direction' ? allDescendants(el, 'dynamics') : [];
  for (const d of marks) {
    for (const mark of childElements(d)) {
      const velocity = DYNAMICS_VELOCITY[mark.tagName];
      if (velocity !== undefined) return velocity;
    }
  }
  if (marks.length > 0) return undefined;
  const sound = el.tagName === 'sound' ? el : allDescendants(el, 'sound')[0];
  const percent = Number(sound?.getAttribute('dynamics') || NaN);
  if (!Number.isFinite(percent) || percent < 0) return undefined;
  return Math.min(127, Math.max(1, Math.round(percent * 0.9)));
}

/**
 * The direction a `<words>` marking changes the level in: cresc. louder; dim., decresc. and their
 * kin softer (also inside "dim. e poco rit." and the like).
 */
function wordsDirection(el: Element): 1 | -1 | undefined {
  for (const w of allDescendants(el, 'words')) {
    const text = w.textContent ?? '';
    if (/\b(decresc|dim|smorz|perdend|calando|morendo)/i.test(text)) return -1;
    if (/\bcresc/i.test(text)) return 1;
  }
  return undefined;
}

/**
 * The one staff a dynamics direction applies to, or undefined for every staff of its part. In
 * piano music a mark between the staves (below the upper staff, above the lower one, MusicXML's
 * default placement for dynamics being below) is for both hands; only a mark above the top staff
 * or below the bottom one is for that staff's hand alone.
 */
function dynamicsStaff(el: Element, staves: number): number | undefined {
  if (el.tagName !== 'direction' || staves < 2) return undefined;
  const staff = Number(childText(el, 'staff') ?? NaN);
  const placement =
    el.getAttribute('placement') ||
    ['dynamics', 'wedge', 'words']
      .map((tag) => allDescendants(el, tag)[0]?.getAttribute('placement'))
      .find((p) => p) ||
    'below';
  if (staff === 1 && placement === 'above') return 1;
  if (staff === staves && placement === 'below') return staff;
  return undefined;
}

/** An absolute-tick dynamics event of one part, in the order `staffLevels` takes them. */
type TickEvent = { tick: number; staff: number | undefined; measureIndex: number } & (
  { velocity: number } | { direction: 1 | -1; end: number | undefined; endMeasure: number }
);

type TickRamp = Extract<TickEvent, { direction: 1 | -1 }>;

/**
 * A stretch of one staff's level: from `tick` it moves linearly from `from` to `to`, reached at
 * `end`, and holds `to` from there until the next stretch.
 */
interface Level {
  tick: number;
  end: number;
  from: number;
  to: number;
}

/**
 * Gives each note the level of its staff at its onset (final ticks): the latest mark, or a point
 * on a hairpin, cresc. or dim. running through it. A staff without a mark of its own yet follows
 * its part's latest mark on another staff (a p above the top staff only, say); a note before any
 * mark or gradual change keeps no velocity.
 */
function applyDynamics(
  notes: Note[],
  noteStaves: Map<Note, { part: number; staff: number }>,
  dynamics: DynamicsEvent[],
  wedgeStops: WedgeStop[],
  measures: MeasureInfo[],
): void {
  if (dynamics.length === 0) return;
  const tickOf = (l: { measureIndex: number; offset: number }) =>
    measures[l.measureIndex]!.startTick + l.offset;
  const byPart = new Map<number, TickEvent[]>();
  const wedges = new Map<string, ({ start: TickRamp } | { stop: WedgeStop })[]>();
  for (const d of dynamics) {
    const at = { tick: tickOf(d), staff: d.staff, measureIndex: d.measureIndex };
    const event: TickEvent =
      'velocity' in d
        ? { ...at, velocity: d.velocity }
        : { ...at, direction: d.direction, end: undefined, endMeasure: d.measureIndex };
    const list = byPart.get(d.part);
    if (list) list.push(event);
    else byPart.set(d.part, [event]);
    if ('wedge' in d && d.wedge !== undefined) {
      const start = { start: event as TickRamp };
      const list = wedges.get(d.wedge);
      if (list) list.push(start);
      else wedges.set(d.wedge, [start]);
    }
  }
  // A hairpin ends at the first stop of its number after it in time: in another voice the stop
  // can come first in the document (written before a <backup>).
  for (const stop of wedgeStops) wedges.get(stop.wedge)?.push({ stop });
  const tick = (x: { start: TickEvent } | { stop: WedgeStop }) =>
    'start' in x ? x.start.tick : tickOf(x.stop);
  for (const list of wedges.values()) {
    list.sort((a, b) => tick(a) - tick(b) || Number('start' in a) - Number('start' in b));
    let open: TickRamp | undefined;
    for (const x of list) {
      if ('start' in x) open = x.start;
      else if (open) {
        open.end = tickOf(x.stop);
        open.endMeasure = x.stop.measureIndex;
        open = undefined;
      }
    }
  }
  // By tick, a mark before a gradual change at the same tick (which starts from it); stable, so
  // of two marks at the same tick the later in the document wins.
  for (const list of byPart.values()) {
    list.sort((a, b) => a.tick - b.tick || Number('direction' in a) - Number('direction' in b));
  }
  const levels = new Map<string, Level[]>();
  for (const n of notes) {
    const where = noteStaves.get(n)!;
    const events = byPart.get(where.part);
    if (!events) continue;
    const key = `${where.part}:${where.staff}`;
    let staffLevel = levels.get(key);
    if (!staffLevel) {
      const own = events.filter((e) => e.staff === undefined || e.staff === where.staff);
      const first = own[0]?.tick ?? Infinity;
      const borrowed = events.filter((e) => 'velocity' in e && e.tick < first);
      staffLevel = staffLevels([...borrowed, ...own], UNMARKED_VELOCITY[n.hand], measures);
      levels.set(key, staffLevel);
    }
    const level = levelAt(staffLevel, n.onsetTick);
    if (level !== undefined) n.velocity = Math.round(level);
  }
}

/**
 * One staff's level over time from its events in order. A gradual change runs from the level at
 * its start to the mark at its end (for a hairpin, one up to a bar after its stop), when that
 * mark lies in its direction, else one step (`RAMP_STEP`) but no further than a step from the
 * latest mark, so a run of short sighs does not sink to nothing; then it holds. A mark inside it
 * sets the level and the change carries on from there.
 */
function staffLevels(events: TickEvent[], unmarked: number, measures: MeasureInfo[]): Level[] {
  const marks = events.filter((e): e is TickEvent & { velocity: number } => 'velocity' in e);
  const last = measures[measures.length - 1]!;
  const scoreEnd = last.startTick + last.lengthTicks;
  const out: Level[] = [];
  /** The gradual change under way, which a mark inside it resumes. */
  let ramp: { end: number; direction: 1 | -1; target: number | undefined } | undefined;
  /** The latest mark's level (or the unmarked one), which a change without a target stays near. */
  let base: number | undefined;
  const push = (tick: number, from: number) => {
    const { direction, target } = ramp!;
    base ??= from;
    const to =
      target !== undefined && Math.sign(target - from) === direction
        ? target
        : direction > 0
          ? Math.max(from, Math.min(127, from + RAMP_STEP, base + RAMP_STEP))
          : Math.min(from, Math.max(1, from - RAMP_STEP, base - RAMP_STEP));
    out.push({ tick, end: ramp!.end, from, to });
  };
  for (const e of events) {
    const current = out[out.length - 1];
    if (current && current.end > e.tick) {
      // Cut the stretch under way short at this event.
      current.to = levelAt(out, e.tick)!;
      current.end = e.tick;
    }
    if (ramp && ramp.end <= e.tick) ramp = undefined;
    if ('velocity' in e) {
      base = e.velocity;
      out.push({ tick: e.tick, end: e.tick, from: e.velocity, to: e.velocity });
      if (ramp) push(e.tick, e.velocity);
      continue;
    }
    const next = marks.find((m) => m.tick > e.tick);
    const cap = measures[e.measureIndex + RAMP_BARS]?.startTick ?? scoreEnd;
    const end = e.end ?? Math.min(cap, next?.tick ?? cap);
    if (end <= e.tick) continue;
    const window = e.end === undefined ? 0 : measures[e.endMeasure]!.lengthTicks;
    const target = marks.find((m) => m.tick >= end && m.tick <= end + window);
    ramp = { end, direction: e.direction, target: target?.velocity };
    push(e.tick, levelAt(out, e.tick) ?? unmarked);
  }
  return out;
}

/** The level at a tick, or undefined before the first stretch. */
function levelAt(levels: Level[], tick: number): number | undefined {
  let lo = 0;
  let hi = levels.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (levels[mid]!.tick <= tick) lo = mid + 1;
    else hi = mid;
  }
  const l = levels[lo - 1];
  if (!l) return undefined;
  if (tick >= l.end) return l.to;
  return l.from + ((l.to - l.from) * (tick - l.tick)) / (l.end - l.tick);
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
