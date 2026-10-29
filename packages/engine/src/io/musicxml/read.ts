import {
  finalizeScore,
  ticksToSeconds,
  UNMARKED_VELOCITY,
  validateScore,
} from '../../score/build.js';
import { spellingToMidi } from '../../score/pitch.js';
import type { Alter, Spelling, Step } from '../../score/pitch.js';
import type {
  Arpeggio,
  Assignment,
  Finger,
  Hand,
  KeySigEvent,
  MeasureForm,
  MeasureInfo,
  Note,
  PedalEvent,
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
  /** The ties a scan import read as separate presses (`tolerateScanTies`), by note; else empty. */
  tieRepairs: TieRepair[];
}

/**
 * A tie a scan import did not join (issue 233): its notes stay separate presses, each with its own
 * written length. `note` is the source index of the `<note>` that starts the tie (for
 * `unmatchedStop`, the one that ends it), `part` and `measure` are 0-based. A `gap` tie's
 * continuation does not begin where its start ends; an `unmatchedStart` is never closed (or a
 * second start on the same staff, voice and pitch replaced it); an `unmatchedStop` has no start;
 * a `grace` tie has a grace note at either end.
 */
export interface TieRepair {
  note: number;
  part: number;
  measure: number;
  reason: 'gap' | 'unmatchedStart' | 'unmatchedStop' | 'grace';
}

interface PendingTie {
  note: Note;
  staff: number;
  midi: number;
  /** The source index of the note whose tie start is open (the latest segment of a chain). */
  start: number;
  /** Whether that note is a grace note. */
  grace: boolean;
  endMeasureIndex: number;
  endOffset: number;
}

/** The tie marks a scan import ignores: a gap tie's start and stop, by source note index. */
interface BrokenTies {
  starts: Set<number>;
  stops: Set<number>;
  repairs: TieRepair[];
}

interface ParseOptions {
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
  /**
   * Scan imports (issue 233): a tie that cannot be joined (its continuation does not begin where
   * its start ends, a stop without a start, a start never closed, a tie on a grace note) leaves
   * its notes as separate presses and is listed in `tieRepairs` instead of failing the import.
   */
  tolerateScanTies?: boolean;
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
 * top of the louder sample layer). mf sits between the hands' unmarked levels (96 and 88), so a
 * piece marked mf sounds like one with no mark, and each mark plays the piano's sample layer
 * nearest its name (mp and p its mp layer, mf its mf layer, f and above its ff layer): one step
 * lower put mf on the mp layer and p on the pp layer, softer and duller than the music asks.
 */
const DYNAMICS_VELOCITY: Record<string, number> = {
  ppp: 44,
  pp: 56,
  p: 68,
  mp: 80,
  mf: 92,
  f: 104,
  ff: 116,
  fff: 127,
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

export function parseMusicXml(input: string | Uint8Array, opts: ParseOptions = {}): ParsedMusicXml {
  const doc = timewiseToPartwise(parseXml(unpackMusicXml(input)));
  const root = doc.documentElement!;
  if (root.tagName !== 'score-partwise') throw new Error('not a MusicXML score');
  // A scan's tie whose segments do not meet is only known once every part has set the bar
  // lengths; the score is then read again with that tie's marks ignored. Each pass ignores at
  // least one more tie start, so this ends.
  const broken: BrokenTies = { starts: new Set(), stops: new Set(), repairs: [] };
  for (;;) {
    const parsed = readPartwise(root, opts, broken);
    if (parsed) return parsed;
  }
}

/** One reading of the score, or undefined when it found tie gaps to ignore (`broken`) first. */
function readPartwise(
  root: Element,
  opts: ParseOptions,
  broken: BrokenTies,
): ParsedMusicXml | undefined {
  const tolerate = opts.tolerateScanTies === true;
  const warnings: string[] = [];
  const editorial: Assignment = {};
  const repairs: TieRepair[] = [];
  const parts = childElements(root, 'part');

  // Global divisions = lcm of all <divisions> in the document.
  let divisions = 1;
  for (const d of allDescendants(root, 'divisions')) {
    const v = Number((d.textContent ?? '').trim());
    if (opts.preserveNotation && (!Number.isSafeInteger(v) || v <= 0)) {
      throw new Error(
        `cannot preserve notation: divisions must be a positive safe integer${placeOf(d, parts)}`,
      );
    }
    if (Number.isInteger(v) && v > 0) divisions = lcm(divisions, v);
  }
  if (opts.preserveNotation && !Number.isSafeInteger(divisions)) {
    throw new Error('cannot preserve notation: combined divisions exceed safe integer range');
  }

  const staffOffsets = opts.preserveNotation ? preservedStaffOffsets(parts) : [];
  const measureStarts: number[] = [];
  const measureLengths: number[] = [];
  const measureNumbers: string[] = [];
  const notes: Note[] = [];
  const ornaments = new OrnamentReader();
  const tempos: Located<TempoEvent>[] = [];
  const pedals: Located<PedalEvent>[] = [];
  const times: Located<TimeSigEvent>[] = [];
  const keys: Located<KeySigEvent>[] = [];
  const tiedEnds = new Map<Note, { measureIndex: number; offset: number }>();
  const dynamics: DynamicsEvent[] = [];
  /** Each bar's repeat signs and jump marks, read from the first part (the form belongs to the piece). */
  const forms = new Map<number, MeasureForm>();
  const wedgeStops: WedgeStop[] = [];
  /** Each note's part and staff within it, which the dynamics marks are written per. */
  const noteStaves = new Map<Note, { part: number; staff: number }>();
  const tieJoins: {
    /** The source indices of the segment's tied note and of its continuation. */
    start: number;
    stop: number;
    part: number;
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
    /** The volta numbers of the ending that is open (from its start to its stop). */
    let openEnding: number[] | null = null;
    let measureStart = 0;
    childElements(part, 'measure').forEach((measure, mIndex) => {
      if (measureStarts[mIndex] === undefined) {
        measureStarts[mIndex] =
          mIndex === 0 ? 0 : measureStarts[mIndex - 1]! + (measureLengths[mIndex - 1] ?? 0);
        measureNumbers[mIndex] = measure.getAttribute('number') ?? String(mIndex + 1);
      }
      measureStart = measureStarts[mIndex]!;
      /** Where a refusal or warning in this bar is: its part and printed bar number. */
      const place = ` (part ${partIndex + 1}, bar ${measureNumbers[mIndex]})`;
      let cursor = measureStart;
      let maxCursor = measureStart;
      // Onset of the last non-chord <note> element; <chord/> tones share it. Tracked per element
      // (not via the merged Note) so a chord tone beside a tie continuation is not pulled back
      // to the tie start's onset.
      let chordOnset = measureStart;
      let lastAdvance = 0;
      let closesEnding = false;
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
          case 'barline': {
            if (partIndex !== 0) break;
            const form = formOf(forms, mIndex);
            const repeat = firstChild(el, 'repeat');
            if (repeat?.getAttribute('direction') === 'forward') form.repeatStart = true;
            if (repeat?.getAttribute('direction') === 'backward') {
              const times = Number.parseInt(repeat.getAttribute('times') ?? '', 10);
              form.repeatEnd = times > 0 ? times : 2;
            }
            const ending = firstChild(el, 'ending');
            const type = ending?.getAttribute('type');
            if (type === 'start') {
              const numbers = (ending!.getAttribute('number') ?? '')
                .split(/[,\s]+/)
                .map((v) => Number.parseInt(v, 10))
                .filter((v) => v > 0);
              openEnding = numbers.length > 0 ? numbers : null;
            } else if (type === 'stop' || type === 'discontinue') closesEnding = true;
            if (firstChild(el, 'segno')) form.segno = true;
            if (firstChild(el, 'coda')) form.coda = true;
            break;
          }
          case 'direction':
          case 'sound': {
            if (partIndex === 0) readJumps(el, formOf(forms, mIndex));
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
            const pedal = readPedal(el);
            if (pedal !== undefined) {
              pedals.push({
                measureIndex: mIndex,
                offset: where.offset,
                event: { type: pedal, sec: 0 },
              });
            }
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
                place,
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
                place,
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
                place,
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
              warnings.push(`note ${index}: no pitch and no rest, skipped${place}`);
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
                  `cannot preserve notation: note ${index}: invalid or missing pitch step/octave${place}`,
                );
              }
            }
            const alter = readAlter(childText(pitch, 'alter'), `note ${index}`, place, warnings);
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
            const tieStop =
              (ties.includes('stop') || (ties.length === 0 && tied.includes('stop'))) &&
              !broken.stops.has(index);
            const tieStart =
              (ties.includes('start') || (ties.length === 0 && tied.includes('start'))) &&
              !broken.starts.has(index);
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
              if (open && tolerate && (open[1].grace || isGrace)) {
                // A grace note has no length to hold through: a scan's tie to or from one leaves
                // both notes as presses of their own.
                pending.delete(open[0]);
                repairs.push(repair(open[1].start, partIndex, open[1].endMeasureIndex, 'grace'));
              } else if (open) {
                const [openKey, prev] = open;
                if (opts.preserveNotation) {
                  tieJoins.push({
                    start: prev.start,
                    stop: index,
                    part: partIndex,
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
                prev.start = index;
                prev.grace = isGrace;
                prev.endMeasureIndex = mIndex;
                prev.endOffset = offset - measureStart;
                pending.delete(openKey);
                // A continuation (stop and start) stays open, now under this note's voice.
                if (tieStart) pending.set(tieKey, prev);
                break;
              } else if (tolerate) {
                repairs.push(repair(index, partIndex, mIndex, isGrace ? 'grace' : 'unmatchedStop'));
              } else {
                warnings.push(`note ${index}: tie stop without a start${place}`);
              }
            }
            const replaced = tieStart ? pending.get(tieKey) : undefined;
            if (replaced && tolerate) {
              // The earlier start is never closed now; its note keeps its own length.
              repairs.push(
                repair(
                  replaced.start,
                  partIndex,
                  replaced.endMeasureIndex,
                  replaced.grace ? 'grace' : 'unmatchedStart',
                ),
              );
            } else if (replaced && opts.preserveNotation) {
              throw new Error(
                `cannot preserve notation: note ${index}: tie already open for this staff, voice and pitch${place}`,
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
            if (!isGrace) {
              const arpeggio = readArpeggio(el);
              if (arpeggio) note.arpeggio = arpeggio;
            }
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
                start: index,
                grace: isGrace,
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
      if (partIndex === 0) {
        if (openEnding) formOf(forms, mIndex).ending = [...openEnding];
        if (closesEnding) openEnding = null;
      }
    });
    for (const open of pending.values()) {
      if (tolerate) {
        repairs.push(
          repair(
            open.start,
            partIndex,
            open.endMeasureIndex,
            open.grace ? 'grace' : 'unmatchedStart',
          ),
        );
      } else {
        warnings.push(
          `note ${open.start}: tie never closed (part ${partIndex + 1}, bar ${measureNumbers[open.endMeasureIndex]})`,
        );
      }
    }
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
      ...(forms.has(i) && Object.keys(forms.get(i)!).length > 0 ? { form: forms.get(i)! } : {}),
    });
    start += measureLengths[i] ?? 0;
  }
  // A later part can lengthen a bar after its ties were read. Only final
  // coordinates distinguish a genuine tie gap from provisional bar overlap.
  const gaps = tieJoins.filter(
    (join) =>
      measures[join.previousMeasure]!.startTick + join.previousEnd !==
      measures[join.nextMeasure]!.startTick + join.nextOnset,
  );
  if (gaps.length > 0 && !tolerate) {
    const gap = gaps[0]!;
    throw new Error(
      `cannot preserve notation: note ${gap.start}: tie segments must be contiguous across final measure boundaries, tied to note ${gap.stop} (part ${gap.part + 1}, bar ${measureNumbers[gap.previousMeasure]})`,
    );
  }
  if (gaps.length > 0) {
    for (const gap of gaps) {
      broken.starts.add(gap.start);
      broken.stops.add(gap.stop);
      broken.repairs.push(repair(gap.start, gap.part, gap.previousMeasure, 'gap'));
    }
    return undefined;
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
  // A re-pedal is a stop and a start on one tick, written in either order: lift, change, press.
  const pedalRank = { up: 0, change: 1, down: 2 };
  const pedalEvents = absolute<PedalEvent>(pedals)
    .map((p) => ({ ...p, sec: ticksToSeconds(tempoMap, divisions, p.tick) }))
    .sort((a, b) => a.tick - b.tick || pedalRank[a.type] - pedalRank[b.type]);

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
    ...(pedalEvents.length ? { pedals: pedalEvents } : {}),
  });
  const problems = validateScore(score);
  if (problems.length > 0) {
    const byId = new Map(score.notes.map((n) => [n.id, n]));
    const placed = problems.map((problem) => {
      const note = byId.get(/^note (\S+):/.exec(problem)?.[1] ?? '');
      const part = note && noteStaves.get(note)?.part;
      return note && part !== undefined
        ? `${problem} (part ${part + 1}, bar ${measureNumbers[note.measureIndex]})`
        : problem;
    });
    throw new Error(`invalid score: ${placed.join('; ')}`);
  }
  const tieRepairs = [...broken.repairs, ...repairs].sort((a, b) => a.note - b.note);
  return { score, editorial, warnings, tieRepairs };
}

function repair(
  note: number,
  part: number,
  measure: number,
  reason: TieRepair['reason'],
): TieRepair {
  return { note, part, measure, reason };
}

/** Where an element is, for a refusal: ` (part 1, bar 12)`, or empty outside a part. */
function placeOf(el: Element, parts: Element[]): string {
  let measure: Element | undefined;
  for (let node = el.parentNode; node; node = node.parentNode) {
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    if (element.tagName === 'measure') measure = element;
    if (element.tagName !== 'part') continue;
    const part = parts.indexOf(element);
    if (part < 0) return '';
    const bars = childElements(element, 'measure');
    const bar = measure
      ? (measure.getAttribute('number') ?? String(bars.indexOf(measure) + 1))
      : undefined;
    return bar === undefined ? ` (part ${part + 1})` : ` (part ${part + 1}, bar ${bar})`;
  }
  return '';
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
          throw new Error(
            `cannot preserve notation: ${tag} must be a positive safe integer${placeOf(element, parts)}`,
          );
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
function readAlter(
  text: string | undefined,
  location: string,
  place: string,
  warnings: string[],
): Alter | undefined {
  if (text === undefined || text === '') return 0;
  const value = Number(text);
  if (!Number.isFinite(value)) {
    warnings.push(`${location}: alter "${text}" is not a number, skipped${place}`);
    return undefined;
  }
  const rounded = Math.round(value) || 0; // `|| 0` turns -0 into 0
  if (rounded < -2 || rounded > 2) {
    warnings.push(`${location}: alter ${text} outside -2..2, skipped${place}`);
    return undefined;
  }
  if (rounded !== value)
    warnings.push(`${location}: microtonal alter ${text} rounded to ${rounded}${place}`);
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
  place: string,
): void {
  const declared = Number(text);
  const exactTicks = (declared * global) / current;
  if (!(declared > 0) || !Number.isSafeInteger(exactTicks) || exactTicks <= 0) {
    throw new Error(`cannot preserve notation: ${location}: invalid or missing duration${place}`);
  }
}

function formOf(forms: Map<number, MeasureForm>, index: number): MeasureForm {
  let form = forms.get(index);
  if (!form) {
    form = {};
    forms.set(index, form);
  }
  return form;
}

/**
 * The jump marks of a `<direction>` or `<sound>`: the sound's attributes (dacapo, dalsegno, segno,
 * coda, tocoda, fine) when it has any of them, else the segno and coda symbols and the words
 * D.C., D.S., Fine and To Coda.
 */
function readJumps(el: Element, form: MeasureForm): void {
  const sound = el.tagName === 'sound' ? el : allDescendants(el, 'sound')[0];
  const marks = {
    daCapo: sound?.getAttribute('dacapo') === 'yes',
    dalSegno: sound?.hasAttribute('dalsegno') ?? false,
    segno: sound?.hasAttribute('segno') ?? false,
    coda: sound?.hasAttribute('coda') ?? false,
    toCoda: sound?.hasAttribute('tocoda') ?? false,
    fine: sound?.hasAttribute('fine') ?? false,
  };
  if (!Object.values(marks).some(Boolean) && el.tagName === 'direction') {
    marks.segno = allDescendants(el, 'segno').length > 0;
    marks.coda = allDescendants(el, 'coda').length > 0;
    for (const w of allDescendants(el, 'words')) {
      const text = (w.textContent ?? '').trim();
      if (/^(D\.\s*C\.|Da\s+Capo)/i.test(text)) marks.daCapo = true;
      else if (/^(D\.\s*S\.|Dal\s+Segno)/i.test(text)) marks.dalSegno = true;
      else if (/^fine\.?$/i.test(text)) marks.fine = true;
      else if (/^to\s+coda/i.test(text)) marks.toCoda = true;
    }
  }
  for (const [name, on] of Object.entries(marks)) if (on) form[name as keyof typeof marks] = true;
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
 * The damper-pedal mark of a `<direction>` or `<sound>`: its `<pedal>` (start and resume press,
 * stop and discontinue lift, change re-presses; continue and sostenuto are not the damper), else
 * its `damper-pedal` attribute (yes or a percentage above 0 presses; no or 0 lifts).
 */
function readPedal(el: Element): PedalEvent['type'] | undefined {
  for (const p of allDescendants(el, 'pedal')) {
    const type = PEDAL_TYPES[p.getAttribute('type') ?? ''];
    if (type) return type;
  }
  const sound = el.tagName === 'sound' ? el : firstChild(el, 'sound');
  const damper = sound?.getAttribute('damper-pedal')?.trim().toLowerCase();
  if (!damper) return undefined;
  if (damper === 'yes') return 'down';
  if (damper === 'no') return 'up';
  const amount = Number(damper);
  if (!Number.isFinite(amount)) return undefined;
  return amount > 0 ? 'down' : 'up';
}

const PEDAL_TYPES: Record<string, PedalEvent['type']> = {
  start: 'down',
  resume: 'down',
  stop: 'up',
  discontinue: 'up',
  change: 'change',
};

/** The `<arpeggiate>` of a note: a rolled chord, up unless it says down. */
function readArpeggio(el: Element): Arpeggio | undefined {
  const mark = childElements(el, 'notations').flatMap((n) => childElements(n, 'arpeggiate'))[0];
  if (!mark) return undefined;
  const number = Number(mark.getAttribute('number') ?? NaN);
  return {
    direction: mark.getAttribute('direction') === 'down' ? 'down' : 'up',
    ...(Number.isInteger(number) && number > 0 ? { number } : {}),
  };
}

/**
 * The velocity a `<direction>` or `<sound>` sets: its dynamics mark (ppp to fff), else its
 * `<sound dynamics>`, a percentage of MIDI velocity 90, moved onto the marks' scale: the MIDI
 * velocities notation programs write for the marks (MuseScore: mf 80, f 96, 16 apart) map onto
 * `DYNAMICS_VELOCITY` (mf 92, f 104, 12 apart). A mark outside ppp to fff (sfz, fp) is an
 * accent, so the direction sets no level, whatever its sound says.
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
  const midi = percent * 0.9;
  return Math.min(127, Math.max(1, Math.round(DYNAMICS_VELOCITY.mf! + (midi - 80) * 0.75)));
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
