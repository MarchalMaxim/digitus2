import type { Finger, Hand } from '../score/types.js';
import { forEachHold } from '../fingering/reach.js';
import { FIVE_FINGER_SPAN, isThumbCrossing, pairWindows } from '../fingering/sequence.js';
import type { SeqNote } from '../fingering/sequence.js';
import { span } from '../fingering/spans.js';
import type { SpanTables } from '../fingering/spans.js';

export type LintRuleId =
  | 'L01'
  | 'L02'
  | 'L03'
  | 'L04'
  | 'L05'
  | 'L06'
  | 'L07'
  | 'L08'
  | 'L09'
  | 'L10'
  | 'L11'
  | 'L12'
  | 'L13'
  | 'L14'
  | 'L15'
  | 'L24';
export type LintSeverity = 'error' | 'warning' | 'info';
export interface LintIssue {
  rule: LintRuleId;
  severity: LintSeverity;
  hand: Hand;
  noteIds: string[];
  message: string;
}

/**
 * `law` is true for the physical laws L01..L05; L06 and L10 also become errors for beginners, and
 * L15 and L24 are checked for beginners only. L01..L14 are the rules of the same ids in the
 * literature's catalogue (docs/research/literature.md section 4.3). L15 is M3 plan addition 14's
 * rule, not the catalogue's L15 (a position change near a rest); L24, the info that shows a
 * beginner the other thumb crossings, takes an id after the catalogue's L01..L23 so that it
 * collides with none of them.
 */
export const LINT_RULES: Record<LintRuleId, { title: string; law: boolean }> = {
  L01: { title: 'Two simultaneous notes share a finger', law: true },
  L02: { title: 'Crossed fingers inside a chord', law: true },
  L03: { title: 'Finger reused while it holds a key', law: true },
  L04: { title: 'More than five simultaneous notes in one hand', law: true },
  L05: { title: 'Span beyond the practical maximum on keys held together', law: true },
  L06: { title: 'Non-thumb crossing', law: false },
  L07: {
    title: 'Uncomfortable span, a shift beyond the practical span, or a notated hold beyond reach',
    law: false,
  },
  L08: { title: 'Thumb on a black key', law: false },
  L09: { title: 'Fifth finger on a black key next to a white key', law: false },
  L10: { title: 'Thumb passes onto a black key from a white key', law: false },
  L11: { title: 'Fast hop with the same finger', law: false },
  L12: { title: 'Fast repeated key with the same finger', law: false },
  L13: { title: 'Slow repeated key with a finger change', law: false },
  L14: { title: 'Agility: 3 to 4, 3-4-5 run, or 3 white with 4 black', law: false },
  L15: { title: 'Thumb crossing inside one five-finger position (beginner)', law: false },
  L24: { title: 'Thumb crossing that moves the hand, shown to a beginner', law: false },
};

export interface LintContext {
  tables: SpanTables;
  hopFastSec: number;
  repeatFastSec: number;
  beginner: boolean;
  /** Hold tolerance of the held-key laws (`forEachHold`); `HOLD_EPS` unless the caller says. */
  holdEpsSec: number;
}
interface Fingered {
  note: SeqNote;
  finger: Finger;
  substitution: Finger | undefined;
}

/**
 * Lints one hand. `notes` are the fingered notes of the hand's sequence in sequence order
 * (slices in arpeggiated order, mirrored pitch for the left hand); unfingered notes are absent.
 */
export function lintHand(hand: Hand, notes: Fingered[], ctx: LintContext): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (rule: LintRuleId, severity: LintSeverity, ids: string[], message: string): void => {
    issues.push({ rule, severity, hand, noteIds: ids, message });
  };
  // L06 and L10 are preferences that become errors for beginners.
  const beginnerSeverity: LintSeverity = ctx.beginner ? 'error' : 'warning';
  const t = ctx.tables;
  /** Interval `i` from the key of finger g to the key of finger f is within their practical span. */
  const practical = (i: number, g: Finger, f: Finger): boolean =>
    i <= span(t, 'maxPrac', g, f) && i >= span(t, 'minPrac', g, f);

  // Slices.
  const slices = new Map<number, Fingered[]>();
  for (const x of notes) {
    if (!slices.has(x.note.slice)) slices.set(x.note.slice, []);
    slices.get(x.note.slice)!.push(x);
  }
  for (const group of slices.values()) {
    if (group.length > 5)
      add(
        'L04',
        'error',
        group.map((x) => x.note.noteId),
        `${group.length} simultaneous notes`,
      );
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) {
        const lo = group[a]!;
        const hi = group[b]!;
        const i = hi.note.pitch - lo.note.pitch;
        if (lo.finger === hi.finger) {
          const adjacentWhiteThumb = lo.finger === 1 && !lo.note.black && !hi.note.black && i <= 2;
          add(
            'L01',
            adjacentWhiteThumb ? 'info' : 'error',
            [lo.note.noteId, hi.note.noteId],
            `finger ${lo.finger} on two simultaneous keys`,
          );
          continue;
        }
        if (hi.finger < lo.finger)
          add(
            'L02',
            'error',
            [lo.note.noteId, hi.note.noteId],
            `fingers ${lo.finger} and ${hi.finger} crossed in a chord`,
          );
        if (!practical(i, lo.finger, hi.finger)) {
          add(
            'L05',
            'error',
            [lo.note.noteId, hi.note.noteId],
            `chord span ${i} semitones with ${lo.finger}-${hi.finger}`,
          );
        }
      }
    }
  }

  // Held keys, walked by `forEachHold` (reach.ts), the solver's own walk: every earlier note
  // (another slice) that still holds its key at this note's onset is down together with it,
  // whether or not it is the sequence neighbour: the same finger on a new key is L03, and two
  // different fingers must span the interval (L05). A notated hold that no hand can span
  // (`outOfReach`) is a pedal or a release: one L07 warning, and from then on the key is released
  // for the rest of its notated length, so no later note is checked against it (decided per slice,
  // before any of the slice's notes). A repeated key cannot be held under its own repetition, so a
  // pair on one pitch has no span.
  forEachHold(
    notes.map((x) => x.note),
    t,
    (m, k) => {
      const held = notes[m]!;
      const cur = notes[k]!;
      const ids = [held.note.noteId, cur.note.noteId];
      const i = cur.note.pitch - held.note.pitch;
      if (held.finger === cur.finger && held.substitution === undefined) {
        add('L03', 'error', ids, `finger ${cur.finger} moves to a new key while holding another`);
        return;
      }
      // With a substitution ("2_1") the key passes to the second finger while it sounds; whichever
      // of the two is not playing this note holds it, and the hold is legal if either can span it.
      const holders = (
        held.substitution === undefined ? [held.finger] : [held.finger, held.substitution]
      ).filter((g) => g !== cur.finger);
      if (holders.length > 0 && holders.every((g) => !practical(i, g, cur.finger)))
        add(
          'L05',
          'error',
          ids,
          `${i} semitones with ${holders[0]}-${cur.finger} is beyond practical while the key is held`,
        );
    },
    (m, far) =>
      add(
        'L07',
        'warning',
        [notes[m]!.note.noteId, notes[far]!.note.noteId],
        'notated hold beyond reach: pedal or release',
      ),
    ctx.holdEpsSec,
  );

  // Consecutive notes in different slices.
  const consecutive: Array<[Fingered, Fingered]> = [];
  for (let i = 1; i < notes.length; i++) {
    const a = notes[i - 1]!;
    const b = notes[i]!;
    if (a.note.slice !== b.note.slice) consecutive.push([a, b]);
  }
  for (const [a, b] of consecutive) {
    const g = a.finger;
    const f = b.finger;
    const i = b.note.pitch - a.note.pitch;
    const ids = [a.note.noteId, b.note.noteId];
    if (g === f) {
      if (i !== 0 && !b.note.restBefore && b.note.ioi < ctx.hopFastSec)
        add('L11', 'warning', ids, `finger ${f} hops ${i} semitones in ${b.note.ioi.toFixed(2)} s`);
      if (i === 0 && b.note.ioi < ctx.repeatFastSec)
        add('L12', 'warning', ids, `fast repeated key with finger ${f}`);
    } else {
      if (i === 0 && b.note.ioi >= ctx.repeatFastSec)
        add('L13', 'info', ids, `slow repeated key changes finger ${g} to ${f}`);
      if (i !== 0) {
        // Beyond the practical span is a law only while the earlier key is still held: then the
        // hand must stretch over both keys at once, and the held-key loop above reports it (L05,
        // or L07 when the hold is beyond reach) with every other held key. After a release it is
        // a hand shift, which experts make all the time, so it is an L07 warning.
        const held = a.note.offsetSec > b.note.onsetSec + ctx.holdEpsSec;
        if (!practical(i, g, f)) {
          if (!held)
            add(
              'L07',
              'warning',
              ids,
              `${i} semitones with ${g}-${f} is beyond practical: a hand shift`,
            );
        } else if (i > span(t, 'maxComf', g, f) || i < span(t, 'minComf', g, f))
          add('L07', 'warning', ids, `${i} semitones with ${g}-${f} is uncomfortable`);
        if (g !== 1 && f !== 1 && (f - g) * i < 0)
          add('L06', beginnerSeverity, ids, `finger ${g} crosses ${f}`);
        if ((g === 1 || f === 1) && (f - g) * i < 0) {
          const lowerIsA = i > 0;
          const lower = lowerIsA ? a : b;
          const upper = lowerIsA ? b : a;
          if (!lower.note.black && lower.finger !== 1 && upper.note.black && upper.finger === 1)
            add('L10', beginnerSeverity, ids, 'thumb passes onto a black key from a white key');
        }
      }
      if (g === 3 && f === 4) add('L14', 'warning', ids, '3 followed by 4');
      if ((g === 3 && f === 4) || (g === 4 && f === 3)) {
        const of3 = g === 3 ? a : b;
        const of4 = g === 4 ? a : b;
        if (!of3.note.black && of4.note.black)
          add('L14', 'warning', ids, '3 on white with 4 on black');
      }
    }
  }
  for (let k = 2; k < notes.length; k++) {
    const trio = [notes[k - 2]!, notes[k - 1]!, notes[k]!];
    if (new Set(trio.map((x) => x.note.slice)).size !== 3) continue;
    const fs = trio
      .map((x) => x.finger)
      .sort((p, q) => p - q)
      .join('');
    if (fs === '345')
      add(
        'L14',
        'warning',
        trio.map((x) => x.note.noteId),
        '3, 4 and 5 on three consecutive notes',
      );
  }

  // Beginners only (M3 plan addition 14). L15: a thumb crossing between two single notes of a run
  // whose surrounding notes fit one five-finger position (`pairWindows`), so one position would
  // play them without it (Twinkle's F F E E D D C with 2 2 1 1 2 2 1). L24: every other thumb
  // crossing between notes of different slices, an info: the crossing carries the hand beyond one
  // position, as in a scale or Happy Birthday's D5 B4 G4 F#4 E4 C5 with 5 3 1 2 1 5, which the UI
  // review of 2026-10-14 keeps but would point out to a level 2 student. Only L15 is a fault the
  // beginner level removes; L24 stays wherever the passage needs the crossing. The beginner level
  // of the solver prices L15, L06 and L11 with these same tests (`levelPairCosts` in solve.ts).
  if (ctx.beginner) {
    const windows = pairWindows(notes.map((x) => x.note));
    for (let k = 1; k < notes.length; k++) {
      const a = notes[k - 1]!;
      const b = notes[k]!;
      if (a.note.slice === b.note.slice) continue;
      if (!isThumbCrossing(a.finger, b.finger, b.note.pitch - a.note.pitch)) continue;
      const w = windows[k];
      const ids = [a.note.noteId, b.note.noteId];
      if (w !== undefined && w <= FIVE_FINGER_SPAN)
        add(
          'L15',
          'warning',
          ids,
          `${a.finger} to ${b.finger} crosses the thumb inside one five-finger position`,
        );
      else add('L24', 'info', ids, `${a.finger} to ${b.finger} crosses the thumb to move the hand`);
    }
  }

  // Unary black-key rules.
  for (let i = 0; i < notes.length; i++) {
    const x = notes[i]!;
    if (!x.note.black) continue;
    const prev = notes[i - 1];
    const next = notes[i + 1];
    const whitePrev = prev !== undefined && !prev.note.black;
    const whiteNext = next !== undefined && !next.note.black;
    if (x.finger === 1)
      add(
        'L08',
        'warning',
        [x.note.noteId],
        `thumb on a black key (${1 + (whitePrev ? 2 : 0) + (whiteNext ? 2 : 0)} points)`,
      );
    if (x.finger === 5 && (whitePrev || whiteNext))
      add('L09', 'warning', [x.note.noteId], 'fifth finger on a black key next to a white key');
  }
  return issues;
}
