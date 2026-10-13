import { finalizeScore, validateScore } from '../../score/build.js';
import { parsePigPitch, spellingToMidi } from '../../score/pitch.js';
import type { Assignment, Finger, Hand, Note, Score } from '../../score/types.js';

export const PIG_HEADER = '//Version: PianoFingering_v170101';
export const PIG_DIVISIONS = 480;
export const PIG_QPM = 120;
const TICKS_PER_SECOND = (PIG_DIVISIONS * PIG_QPM) / 60; // 960

export interface ParsedPig {
  score: Score;
  assignment: Assignment;
  warnings: string[];
}

export function parseFingerField(
  text: string,
  hand: Hand,
): { finger?: Finger; substitution?: Finger; warning?: string } {
  const parts = text.trim().split('_');
  const first = toFinger(parts[0] ?? '');
  if (first === undefined) return {};
  const result: { finger: Finger; substitution?: Finger; warning?: string } = { finger: first.finger };
  const second = parts.length > 1 ? toFinger(parts[1]!) : undefined;
  if (second) result.substitution = second.finger;
  const expectedSign = hand === 'L' ? -1 : 1;
  if (first.sign !== 0 && first.sign !== expectedSign) {
    result.warning = `finger ${text} has the wrong sign for hand ${hand}`;
  }
  return result;
}

function toFinger(raw: string): { finger: Finger; sign: -1 | 0 | 1 } | undefined {
  const n = Number(raw);
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 5) return undefined;
  return { finger: Math.abs(n) as Finger, sign: n < 0 ? -1 : 1 };
}

export function parsePig(text: string, opts: { source?: string } = {}): ParsedPig {
  const lines = text.split(/\r?\n/);
  const notes: Note[] = [];
  const assignment: Assignment = {};
  const warnings: string[] = [];
  // The file's exact seconds, keyed by note id. finalizeScore overwrites onsetSec/offsetSec
  // on the same Note objects with tick-derived (1/960 s rounded) values, so keep them aside.
  const fileSeconds = new Map<string, { onsetSec: number; offsetSec: number }>();
  let lineIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (raw === '' || raw.startsWith('//')) continue;
    const cols = raw.split(/\s+/);
    if (cols.length < 8) throw new Error(`PIG line ${i + 1}: expected 8 columns, got ${cols.length}`);
    // Column 6 (offset velocity) has no place in the Note model and is skipped.
    const [id, onset, offset, pitch, onVel, , channel, fingerText] = cols as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const onsetSec = Number(onset);
    const offsetSec = Number(offset);
    if (!Number.isFinite(onsetSec) || !Number.isFinite(offsetSec)) throw new Error(`PIG line ${i + 1}: bad times`);
    const hand: Hand = channel === '1' ? 'L' : 'R';
    const spelling = parsePigPitch(pitch);
    const note: Note = {
      id,
      onsetTick: Math.round(onsetSec * TICKS_PER_SECOND),
      offsetTick: Math.round(offsetSec * TICKS_PER_SECOND),
      onsetSec,
      offsetSec,
      midi: spellingToMidi(spelling),
      spelling,
      hand,
      staff: hand === 'R' ? 1 : 2,
      voice: 1,
      measureIndex: 0,
      isGrace: false,
      chordId: '',
      sourceIndices: [lineIndex],
      velocity: Number(onVel),
    };
    notes.push(note);
    fileSeconds.set(id, { onsetSec, offsetSec });
    const f = parseFingerField(fingerText, hand);
    if (f.warning) warnings.push(`PIG line ${i + 1}: ${f.warning}`);
    if (f.finger !== undefined) {
      assignment[id] =
        f.substitution !== undefined
          ? { finger: f.finger, substitution: f.substitution, source: 'editorial' }
          : { finger: f.finger, source: 'editorial' };
    }
    lineIndex++;
  }
  const score = finalizeScore({
    meta: opts.source !== undefined ? { source: opts.source } : {},
    divisions: PIG_DIVISIONS,
    tempoMap: [{ tick: 0, qpm: PIG_QPM }],
    timeSignatures: [],
    keySignatures: [],
    measures: [],
    notes,
  });
  // keep the file's exact seconds rather than the tick-derived ones
  for (const n of score.notes) {
    const original = fileSeconds.get(n.id);
    if (original) {
      n.onsetSec = original.onsetSec;
      n.offsetSec = original.offsetSec;
    }
  }
  const problems = validateScore(score);
  if (problems.length > 0) throw new Error(`invalid PIG score: ${problems.join('; ')}`);
  return { score, assignment, warnings };
}
