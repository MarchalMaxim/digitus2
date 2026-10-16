import { PIANO_MAX, PIANO_MIN } from './pitch.js';
import type { Note } from './types.js';

export interface OrnamentAttack {
  midi: number;
  onsetSec: number;
  offsetSec: number;
}

/** A separate performance view; source notes and solver inputs are never expanded. */
export function ornamentAttacks(note: Note): OrnamentAttack[] {
  const plain = () => [{ midi: note.midi, onsetSec: note.onsetSec, offsetSec: note.offsetSec }];
  const o = note.ornament;
  if (!o || note.isGrace) return plain();
  const end = Math.min(o.endSec, note.offsetSec);
  const duration = end - note.onsetSec;
  if (!(duration > 0) || !Number.isFinite(duration)) return plain();
  const alternate = o.kind === 'mordent' ? o.lowerMidi : o.upperMidi;
  const start =
    o.startNote === 'upper' ? o.upperMidi : o.startNote === 'below' ? o.lowerMidi : note.midi;
  if ([start, alternate].some((m) => !Number.isInteger(m) || m < PIANO_MIN || m > PIANO_MAX))
    return plain();
  const trill = o.kind === 'trill-mark';
  let count =
    o.beats ?? (trill ? Math.max(3, Math.min(63, Math.floor(duration * 8) | 1)) : o.long ? 5 : 3);
  // An explicit start/count is authoritative. The default always finishes on the principal.
  if (o.beats === undefined && start !== note.midi && count % 2) count++;
  const span = trill ? duration : Math.min(0.08 * (count - 1), duration / 2);
  const spacing = trill ? span / count : span / (count - 1);
  const events: OrnamentAttack[] = [];
  for (let i = 0; i < count; i++) {
    const midi =
      start === note.midi
        ? i % 2
          ? alternate
          : note.midi
        : i === 0
          ? start
          : i % 2
            ? note.midi
            : alternate;
    events.push({
      midi,
      onsetSec: note.onsetSec + spacing * i,
      offsetSec: i + 1 < count ? note.onsetSec + spacing * (i + 1) : note.offsetSec,
    });
  }
  const last = events.at(-1)!;
  if (last.midi !== note.midi && note.offsetSec > end) {
    last.offsetSec = end;
    events.push({ midi: note.midi, onsetSec: end, offsetSec: note.offsetSec });
  }
  return events;
}
