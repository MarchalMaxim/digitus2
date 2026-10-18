// Recognition error classes beyond the projection F1s of evaluate.mjs: the errors the scanning
// issue names (missed chord ties, duplicated notes, notes in the wrong hand) and beam groups.
// Each count is an exact comparison of the reference and recognised files; nothing is guessed.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const engineRequire = createRequire(resolve(import.meta.dirname, '../../packages/engine/package.json'));
const { DOMParser } = engineRequire('@xmldom/xmldom');

const gcd = (a, b) => (b === 0n ? a : gcd(b, a % b));
/** An exact rational in quarter notes, as evaluate.mjs writes onsets: "3/2". */
function quarters(ticks, divisions) {
  const t = BigInt(ticks);
  const d = BigInt(divisions);
  const g = gcd(t < 0n ? -t : t, d) || 1n;
  return `${t / g}/${d / g}`;
}

/** Bars paired by ordinal position whose starts agree; later timing errors void the rest. */
function alignedBars(reference, recognized) {
  const pairs = [];
  const count = Math.min(reference.measures.length, recognized.measures.length);
  for (let i = 0; i < count; i++) {
    const a = reference.measures[i];
    const b = recognized.measures[i];
    if (quarters(a.startTick, reference.divisions) !== quarters(b.startTick, recognized.divisions))
      break;
    pairs.push([a, b]);
  }
  return pairs;
}

function notesByBar(score) {
  const bars = new Map();
  for (const note of score.notes) {
    if (note.isGrace) continue;
    const list = bars.get(note.measureIndex) ?? [];
    list.push(note);
    bars.set(note.measureIndex, list);
  }
  return bars;
}

function counts(keys) {
  const map = new Map();
  for (const key of keys) map.set(key, (map.get(key) ?? 0) + 1);
  return map;
}

/**
 * Counts, over bars whose starts agree:
 * - tiesMissed: a reference note held through a tie that the recognition re-attacks (the same
 *   pitch and staff starts at the same onset but ends sooner, and starts again where it ended);
 * - tiesExtra: the reverse, a recognised tie where the reference re-attacks;
 * - duplicates: recognised notes beyond the reference's count at one staff, onset and pitch;
 * - wrongStaff: notes whose onset and pitch match but whose staff does not.
 */
export function errorClasses(reference, recognized) {
  const result = { tiesMissed: 0, tiesExtra: 0, duplicates: 0, wrongStaff: 0 };
  const pairs = alignedBars(reference, recognized);
  const refBars = notesByBar(reference);
  const recBars = notesByBar(recognized);
  const at = (score, note) => quarters(note.onsetTick, score.divisions);
  const end = (score, note) => quarters(note.offsetTick, score.divisions);
  const held = (score, others, note, partners) => {
    // `note` is tied when it spans more than one source element. Its counterpart in the other
    // score re-attacks it when that one starts at the same time and is shorter, with an attack
    // of the same pitch where it ends.
    if (note.sourceIndices.length < 2) return false;
    const twin = partners.find(
      (n) => n.staff === note.staff && n.midi === note.midi && at(others, n) === at(score, note),
    );
    if (!twin || end(others, twin) === end(score, note)) return false;
    return others.notes.some(
      (n) => n.staff === twin.staff && n.midi === twin.midi && at(others, n) === end(others, twin),
    );
  };
  for (const [a, b] of pairs) {
    const refNotes = refBars.get(a.index) ?? [];
    const recNotes = recBars.get(b.index) ?? [];
    for (const note of refNotes) if (held(reference, recognized, note, recNotes)) result.tiesMissed++;
    for (const note of recNotes) if (held(recognized, reference, note, refNotes)) result.tiesExtra++;
    const refKeys = counts(refNotes.map((n) => `${n.staff}|${at(reference, n)}|${n.midi}`));
    for (const [key, count] of counts(recNotes.map((n) => `${n.staff}|${at(recognized, n)}|${n.midi}`)))
      result.duplicates += Math.max(0, count - Math.max(1, refKeys.get(key) ?? 0));
    const onsetPitch = (score, list) => counts(list.map((n) => `${at(score, n)}|${n.midi}`));
    const withStaff = (score, list) => counts(list.map((n) => `${n.staff}|${at(score, n)}|${n.midi}`));
    const matched = (x, y) => [...x].reduce((sum, [key, c]) => sum + Math.min(c, y.get(key) ?? 0), 0);
    result.wrongStaff +=
      matched(onsetPitch(reference, refNotes), onsetPitch(recognized, recNotes)) -
      matched(withStaff(reference, refNotes), withStaff(recognized, recNotes));
  }
  return result;
}

const childElements = (el, name) => {
  const out = [];
  for (let c = el.firstChild; c; c = c.nextSibling)
    if (c.nodeType === 1 && (name === undefined || c.tagName === name)) out.push(c);
  return out;
};
const childText = (el, name) => childElements(el, name)[0]?.textContent?.trim();

/**
 * The primary beam groups of a partwise MusicXML file: per bar (ordinal) and global staff, the
 * bar-local onsets of each group's notes in quarter notes, in order. Chord members are one event.
 */
export function beamGroups(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const groups = [];
  let staffBase = 0;
  for (const part of childElements(doc.documentElement, 'part')) {
    let divisions = 1;
    let staves = 1;
    childElements(part, 'measure').forEach((measure, bar) => {
      let cursor = 0;
      const open = new Map();
      for (const el of childElements(measure)) {
        if (el.tagName === 'attributes') {
          divisions = Number(childText(el, 'divisions') ?? divisions) || divisions;
          staves = Math.max(staves, Number(childText(el, 'staves') ?? 1) || 1);
        } else if (el.tagName === 'backup') cursor -= Number(childText(el, 'duration') ?? 0);
        else if (el.tagName === 'forward') cursor += Number(childText(el, 'duration') ?? 0);
        else if (el.tagName === 'note') {
          const chord = childElements(el, 'chord').length > 0;
          const grace = childElements(el, 'grace').length > 0;
          const duration = grace ? 0 : Number(childText(el, 'duration') ?? 0);
          const onset = chord ? cursor - duration : cursor;
          if (!chord) cursor += duration;
          if (chord || grace) continue;
          const beam = childElements(el, 'beam').find((b) => (b.getAttribute('number') ?? '1') === '1');
          const value = beam?.textContent?.trim();
          if (!value) continue;
          const staff = staffBase + Number(childText(el, 'staff') ?? 1);
          const key = `${staff}|${childText(el, 'voice') ?? '1'}`;
          const time = quarters(onset, divisions);
          if (value === 'begin') open.set(key, { bar, staff, onsets: [time] });
          else if (open.has(key)) {
            open.get(key).onsets.push(time);
            if (value === 'end') {
              groups.push(open.get(key));
              open.delete(key);
            }
          }
        }
      }
    });
    staffBase += staves;
  }
  return groups;
}

/** Exact beam groups found: precision and recall over groups, as F1. */
export function compareBeams(reference, recognized) {
  const key = (g) => `${g.bar}|${g.staff}|${g.onsets.join(',')}`;
  const available = counts(reference.map(key));
  let matched = 0;
  for (const group of recognized) {
    const k = key(group);
    if ((available.get(k) ?? 0) > 0) {
      matched++;
      available.set(k, available.get(k) - 1);
    }
  }
  const total = reference.length + recognized.length;
  return { matched, reference: reference.length, recognized: recognized.length, f1: total ? (2 * matched) / total : 1 };
}

/**
 * What a recognised photo page is checked on when there is no MusicXML ground truth: the facts
 * read off the page by eye (research/omr/photos/manifest.json). Bars and the first key and time
 * signature come from the XML itself, so a file the strict import refuses is still measured.
 */
export function photoFacts(E, xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = childElements(doc.documentElement, 'part')[0];
  const measures = part ? childElements(part, 'measure') : [];
  let staves = 1;
  let fifths = null;
  let time = null;
  for (const el of doc.getElementsByTagName('staves')) staves = Math.max(staves, Number(el.textContent) || 1);
  const key = doc.getElementsByTagName('fifths')[0];
  if (key) fifths = Number(key.textContent);
  const t = doc.getElementsByTagName('time')[0];
  if (t) time = `${childText(t, 'beats')}/${childText(t, 'beat-type')}`;
  let imports = false;
  let error = null;
  let notes = 0;
  try {
    notes = E.parseMusicXml(xml, { preserveNotation: true }).score.notes.length;
    imports = true;
  } catch (cause) {
    error = cause.message;
  }
  return { imports, error, bars: measures.length, staves, fifths, time, notes };
}
