import { parseMidi } from 'midi-file';
import { PIANO_MAX, PIANO_MIN } from '../../score/pitch.js';
import { count } from './plural.js';
import { decodeMetaText } from './title.js';

export interface MidiTempo {
  tick: number;
  usPerQuarter: number;
}
export interface MidiTimeSignature {
  tick: number;
  beats: number;
  beatType: number;
}
export interface MidiKeySignature {
  fifths: number;
  mode: 'major' | 'minor';
}
export interface MidiNote {
  tick: number;
  endTick: number;
  midi: number;
  velocity: number;
  channel: number;
  track: number;
}
export interface MidiData {
  ppq: number;
  tempos: MidiTempo[];
  timeSignatures: MidiTimeSignature[];
  keySignature?: MidiKeySignature;
  /** The first track name of the first track, decoded; it may still be a generic label. */
  sequenceName?: string;
  notes: MidiNote[];
  warnings: string[];
}

export const DEFAULT_US_PER_QUARTER = 500_000;
export const PERCUSSION_CHANNEL = 9;

/** midi-file reads past the end of a cut-off track as `undefined`: refuse such an event. */
function whole(...values: number[]): void {
  if (!values.every((v) => Number.isFinite(v)))
    throw new Error('not a MIDI file: a track ends in the middle of an event');
}

export function parseMidiFile(bytes: Uint8Array): MidiData {
  let file: ReturnType<typeof parseMidi>;
  try {
    file = parseMidi(bytes);
  } catch (e) {
    throw new Error(`not a MIDI file: ${e instanceof Error ? e.message : String(e)}`);
  }
  const warnings: string[] = [];
  // midi-file does not throw on a truncated header: it returns NaN fields. Check them here.
  const smpte = file.header.framesPerSecond !== undefined;
  const ppq = smpte
    ? ((file.header.framesPerSecond ?? 0) * (file.header.ticksPerFrame ?? 0)) / 2
    : (file.header.ticksPerBeat ?? Number.NaN);
  if (!(Number.isFinite(ppq) && ppq > 0)) throw new Error('not a MIDI file: no time division');
  if (smpte)
    warnings.push(
      'the file counts time in SMPTE frames, not beats; notes are placed on a 120 quarter-note-per-minute grid',
    );
  if (file.header.format === 2)
    warnings.push('format 2 MIDI file: its tracks are read as if they played together');

  const tempos: MidiTempo[] = [];
  const timeSignatures: MidiTimeSignature[] = [];
  let keySignature: MidiKeySignature | undefined;
  let sequenceName: string | undefined;
  const notes: MidiNote[] = [];
  let percussion = 0;
  let outside = 0;
  let unclosed = 0;
  const push = (n: MidiNote) => {
    if (n.midi < PIANO_MIN || n.midi > PIANO_MAX) outside++;
    else notes.push(n);
  };

  file.tracks.forEach((events, track) => {
    let tick = 0;
    // `${channel}:${key}` -> note-ons waiting for their note-off, oldest first
    const open = new Map<string, Array<{ tick: number; velocity: number }>>();
    for (const e of events) {
      tick += e.deltaTime;
      switch (e.type) {
        case 'setTempo':
          whole(e.microsecondsPerBeat);
          if (!smpte) tempos.push({ tick, usPerQuarter: e.microsecondsPerBeat });
          break;
        case 'timeSignature':
          whole(e.numerator, e.denominator);
          timeSignatures.push({ tick, beats: e.numerator, beatType: e.denominator });
          break;
        case 'trackName':
          if (track === 0 && sequenceName === undefined && typeof e.text === 'string')
            sequenceName = decodeMetaText(e.text);
          break;
        case 'keySignature':
          whole(e.key, e.scale);
          keySignature ??= { fifths: e.key, mode: e.scale === 1 ? 'minor' : 'major' };
          break;
        case 'noteOn': {
          whole(e.noteNumber, e.velocity);
          if (e.channel === PERCUSSION_CHANNEL) {
            percussion++;
            break;
          }
          const key = `${e.channel}:${e.noteNumber}`;
          const list = open.get(key);
          if (list) list.push({ tick, velocity: e.velocity });
          else open.set(key, [{ tick, velocity: e.velocity }]);
          break;
        }
        case 'noteOff': {
          whole(e.noteNumber, e.velocity);
          if (e.channel === PERCUSSION_CHANNEL) break;
          const started = open.get(`${e.channel}:${e.noteNumber}`)?.shift();
          if (started)
            push({
              tick: started.tick,
              endTick: tick,
              midi: e.noteNumber,
              velocity: started.velocity,
              channel: e.channel,
              track,
            });
          break;
        }
        default:
          break;
      }
    }
    for (const [key, list] of open) {
      const [channel, midi] = key.split(':').map(Number) as [number, number];
      for (const started of list) {
        unclosed++;
        push({
          tick: started.tick,
          endTick: tick,
          midi,
          velocity: started.velocity,
          channel,
          track,
        });
      }
    }
  });

  tempos.sort((a, b) => a.tick - b.tick);
  if (tempos.length === 0) {
    if (!smpte) warnings.push('no tempo in the file; using 120 quarter notes per minute');
    tempos.push({ tick: 0, usPerQuarter: DEFAULT_US_PER_QUARTER });
  } else if (tempos[0]!.tick > 0) tempos.unshift({ tick: 0, usPerQuarter: DEFAULT_US_PER_QUARTER });
  timeSignatures.sort((a, b) => a.tick - b.tick);
  if (timeSignatures.length === 0) {
    warnings.push('no time signature in the file; using 4/4');
    timeSignatures.push({ tick: 0, beats: 4, beatType: 4 });
  } else if (timeSignatures[0]!.tick > 0)
    timeSignatures.unshift({ tick: 0, beats: 4, beatType: 4 });
  if (percussion > 0)
    warnings.push(
      `ignored ${count(percussion, 'percussion note', 'percussion notes')} on channel 10`,
    );
  if (outside > 0)
    warnings.push(`ignored ${count(outside, 'note', 'notes')} outside the piano range (A0 to C8)`);
  if (unclosed > 0)
    warnings.push(
      unclosed === 1
        ? '1 note had no note-off and ends with its track'
        : `${unclosed} notes had no note-off and end with their track`,
    );
  notes.sort(
    (a, b) => a.tick - b.tick || a.midi - b.midi || a.track - b.track || a.channel - b.channel,
  );
  return {
    ppq,
    tempos,
    timeSignatures,
    ...(keySignature ? { keySignature } : {}),
    ...(sequenceName !== undefined ? { sequenceName } : {}),
    notes,
    warnings,
  };
}

/** Seconds at `tick` (fractional ticks allowed), through the tempo map; mirrors ticksToSeconds. */
export function midiTickToSeconds(data: Pick<MidiData, 'ppq' | 'tempos'>, tick: number): number {
  const tempos =
    data.tempos.length > 0 ? data.tempos : [{ tick: 0, usPerQuarter: DEFAULT_US_PER_QUARTER }];
  let seconds = 0;
  let cursor = 0;
  let us = tempos[0]!.tick <= 0 ? tempos[0]!.usPerQuarter : DEFAULT_US_PER_QUARTER;
  for (const t of tempos) {
    if (t.tick >= tick) break;
    if (t.tick > cursor) {
      seconds += ((t.tick - cursor) / data.ppq) * (us / 1e6);
      cursor = t.tick;
    }
    us = t.usPerQuarter;
  }
  return seconds + ((tick - cursor) / data.ppq) * (us / 1e6);
}
