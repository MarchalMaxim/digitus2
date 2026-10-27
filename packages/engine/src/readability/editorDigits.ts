import { parseMusicXml } from '../io/musicxml/read.js';
import type { Assignment, Note, Score } from '../score/types.js';

/**
 * The digits a source edition prints on a library piece, counted the way the reduction's gate
 * counts them (issue 94): the editorial fingerings of the edition's file (`*.fingered.musicxml`)
 * that land on a note of the plain score, which the engine fingers, one per note (a tie is one
 * sounding note, so a digit on each end counts once). The edition's file is a score of its own, so
 * its notes are matched to the plain score's by hand, onset and pitch, never by id.
 *
 * `manifest.editorDigits` is this number for every entry with an editorial fingering; the library
 * test asserts it, and the app reads it from the manifest because the `.fingered` file loads
 * lazily, only when the editor's view is shown.
 */

export interface EditorDigits {
  /** Digits on notes of the plain score. */
  digits: number;
  /** Editorial fingerings on notes the plain score does not have. */
  unmatched: number;
  /** The editor's fingers on the plain score's note ids. */
  assignment: Assignment;
}

/** A quarter note in the key's unit, so two files with other divisions agree. */
const KEY_TICKS_PER_QUARTER = 960;

const keyOf = (n: Note, divisions: number): string =>
  `${n.hand}|${Math.round((n.onsetTick * KEY_TICKS_PER_QUARTER) / divisions)}|${n.midi}`;

export function editorDigits(plain: Score, fingeredXml: string): EditorDigits {
  const edition = parseMusicXml(fingeredXml);
  // A key can hold several notes (a unison in two voices of one hand): each digit takes the first
  // note of its key that has none yet.
  const byKey = new Map<string, Note[]>();
  for (const n of plain.notes) {
    const key = keyOf(n, plain.divisions);
    const list = byKey.get(key);
    if (list) list.push(n);
    else byKey.set(key, [n]);
  }
  const assignment: Assignment = {};
  let unmatched = 0;
  for (const n of edition.score.notes) {
    const e = edition.editorial[n.id];
    if (!e) continue;
    const target = byKey.get(keyOf(n, edition.score.divisions))?.find((x) => !assignment[x.id]);
    if (!target) unmatched++;
    else assignment[target.id] = e;
  }
  return { digits: Object.keys(assignment).length, unmatched, assignment };
}
