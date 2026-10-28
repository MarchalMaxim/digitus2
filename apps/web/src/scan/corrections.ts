/**
 * Explicit corrections of a recognised score. The raw recognition is never changed: the corrected
 * copy is rebuilt by replaying an ordered list of corrections over it, so every change can be
 * listed, undone one at a time or reset. A correction names its note by the note's raw ordinal
 * (`notes.ts`), which survives earlier corrections, including removals.
 *
 * Rules: a correction changes only what it says. A pitch change moves the note's whole tie chain;
 * a length change applies to the whole chord and never moves the other voices or hand (the
 * `<backup>` that returns to them is re-measured, and every other note's onset is checked); a tie
 * writes both the sounding `<tie>` and the drawn `<tied>` and never touches a slur; removal keeps
 * the bar's timing (a chord member is deleted, a lone note becomes a rest of the same length).
 * A time signature change names its bar by index instead, and moves no note: it rewrites only
 * `<time>`, from that bar until the recognition writes a different time signature.
 */
import type { Phrase } from '../i18n/messages.js';
import {
  chordOf,
  midiOf,
  ORDINAL,
  parseScanXml,
  readScanScore,
  STEPS,
  tieChain,
  tiePartner,
  tieSource,
  tieTarget,
  tagOrdinals,
  type ScanNote,
  type ScanScore,
  type Step,
} from './notes.js';

export type NoteType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd';
export const NOTE_TYPES: readonly NoteType[] = [
  'whole',
  'half',
  'quarter',
  'eighth',
  '16th',
  '32nd',
];
const QUARTERS: Record<NoteType, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
};

export type Correction =
  | { kind: 'pitch'; note: number; step: Step; alter: number; octave: number }
  | { kind: 'duration'; note: number; type: NoteType; dots: 0 | 1 }
  /** `tied` on the tie that starts at this note (`side` 'next', the default) or ends at it. */
  | { kind: 'tie'; note: number; tied: boolean; side?: 'next' | 'previous' }
  | { kind: 'hand'; note: number; staff: number }
  | { kind: 'remove'; note: number }
  /** The time signature from bar index `bar` on, in every part. */
  | { kind: 'meter'; bar: number; beats: number; beatType: number }
  /** The repeat signs and volta brackets of bar index `bar` removed, in every part (issue 230). */
  | { kind: 'barline'; bar: number };
export type MeterCorrection = Extract<Correction, { kind: 'meter' }>;
export type BarlineCorrection = Extract<Correction, { kind: 'barline' }>;

export class CorrectionError extends Error {
  constructor(readonly phrase: Phrase) {
    super('correction refused');
    this.name = 'CorrectionError';
  }
}
const refuse = (phrase: Phrase): never => {
  throw new CorrectionError(phrase);
};

export interface CorrectionResult {
  /** The corrected MusicXML, for import, playback and download. Equal to the raw input with none. */
  xml: string;
  /** The same score for display: every note carries `id="s<ordinal>"`. */
  renderXml: string;
  /** How many corrections of the list applied; the rest stopped at the first refusal. */
  applied: number;
  refusal?: Phrase | undefined;
}

const kids = (el: Element, name?: string) =>
  [...el.children].filter((child) => name === undefined || child.localName === name);
const kid = (el: Element, name: string) => kids(el, name)[0];

/** MusicXML's child order within `<note>`, for inserting an element at its place. */
const NOTE_ORDER = [
  'grace',
  'cue',
  'chord',
  'pitch',
  'unpitched',
  'rest',
  'duration',
  'tie',
  'instrument',
  'footnote',
  'level',
  'voice',
  'type',
  'dot',
  'accidental',
  'time-modification',
  'stem',
  'notehead',
  'notehead-text',
  'staff',
  'beam',
  'notations',
  'lyric',
  'play',
  'listen',
];
function insert(note: Element, child: Element) {
  const rank = NOTE_ORDER.indexOf(child.localName);
  const after = kids(note).find((el) => NOTE_ORDER.indexOf(el.localName) > rank);
  note.insertBefore(child, after ?? null);
}
function make(doc: Document, tag: string, content?: string, attrs: Record<string, string> = {}) {
  // In the score's own namespace (none), as a browser does; some DOMs would give XHTML's.
  const el = doc.createElementNS(doc.documentElement.namespaceURI, tag);
  if (content !== undefined) el.textContent = content;
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}
function setText(note: Element, tag: string, value: string) {
  const existing = kid(note, tag);
  if (existing) existing.textContent = value;
  else insert(note, make(note.ownerDocument, tag, value));
}

function find(score: ScanScore, ordinal: number): ScanNote {
  return (
    score.notes.find((n) => n.ordinal === ordinal) ?? refuse((t) => t.scan.edit.refused.missing)
  );
}

const ACCIDENTALS: Record<number, string> = {
  [-2]: 'flat-flat',
  [-1]: 'flat',
  0: 'natural',
  1: 'sharp',
  2: 'double-sharp',
};
/** Order of sharps in a key signature; flats run backwards. */
const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
function keyAlter(fifths: number, step: Step): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return [...SHARP_ORDER].reverse().slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}

/** The accidental a note needs on paper: against the key and earlier notes of its bar and staff. */
function neededAccidental(
  score: ScanScore,
  note: ScanNote,
  step: Step,
  alter: number,
  octave: number,
) {
  const bar = score.bars.find((b) => b.part === note.part && b.index === note.measure);
  let state = keyAlter(bar?.fifths.get(note.staff) ?? 0, step);
  const earlier = score.notes
    .filter(
      (n) =>
        n !== note &&
        n.part === note.part &&
        n.measure === note.measure &&
        n.staff === note.staff &&
        n.step === step &&
        n.octave === octave &&
        !n.rest &&
        n.onset < note.onset,
    )
    .sort((a, b) => a.onset - b.onset);
  for (const n of earlier) state = n.alter;
  return alter === state ? undefined : ACCIDENTALS[alter];
}

function setPitch(score: ScanScore, note: ScanNote, step: Step, alter: number, octave: number) {
  const el = note.element;
  const pitch = kid(el, 'pitch')!;
  const doc = el.ownerDocument;
  pitch.replaceChildren(make(doc, 'step', step));
  if (alter) pitch.appendChild(make(doc, 'alter', String(alter)));
  pitch.appendChild(make(doc, 'octave', String(octave)));
  kid(el, 'accidental')?.remove();
  // A tie continuation keeps the accidental of its start on paper; only a start can need one.
  const accidental = note.tieStop ? undefined : neededAccidental(score, note, step, alter, octave);
  if (accidental) insert(el, make(doc, 'accidental', accidental));
}

function applyPitch(doc: XMLDocument, score: ScanScore, c: Extract<Correction, { kind: 'pitch' }>) {
  const note = find(score, c.note);
  if (note.grace || (note.rest && note.chord)) refuse((t) => t.scan.edit.refused.rest);
  if (note.rest) {
    // A note the recognition read as a rest: the rest becomes that note, same length and place.
    const rest = kid(note.element, 'rest')!;
    rest.replaceWith(make(doc, 'pitch'));
    for (const child of kids(note.element, 'notehead')) child.remove();
    if (!kid(note.element, 'type')) refuse((t) => t.scan.edit.refused.unwritable);
  } else if (note.midi === undefined) refuse((t) => t.scan.edit.refused.rest);
  if (!STEPS.includes(c.step) || !Number.isInteger(c.octave) || c.octave < 0 || c.octave > 9)
    refuse((t) => t.scan.edit.refused.missing);
  if (![-2, -1, 0, 1, 2].includes(c.alter)) refuse((t) => t.scan.edit.refused.missing);
  const midi = midiOf(c.step, c.alter, c.octave);
  if (midi < 21 || midi > 108) refuse((t) => t.scan.edit.refused.range);
  const chain = note.rest ? [note] : tieChain(score, note);
  const before = { step: note.step, octave: note.octave };
  for (const linked of chain) setPitch(score, linked, c.step, c.alter, c.octave);
  redrawAccidentals(doc, note, [before, { step: c.step, octave: c.octave }]);
}

/**
 * After a pitch change, the later notes of the same letter and octave in that bar and staff are
 * drawn with the accidental they now need: a sharp added or removed carries through the bar.
 * Their pitches (what sounds) are untouched.
 */
function redrawAccidentals(
  doc: XMLDocument,
  edited: ScanNote,
  letters: { step?: Step | undefined; octave: number }[],
) {
  const score = readScanScore(doc);
  const later = score.notes
    .filter(
      (n) =>
        n.part === edited.part &&
        n.measure === edited.measure &&
        n.staff === edited.staff &&
        n.onset > edited.onset &&
        !n.rest &&
        !n.tieStop &&
        n.step !== undefined &&
        letters.some((l) => l.step === n.step && l.octave === n.octave),
    )
    .sort((a, b) => a.onset - b.onset);
  for (const n of later) {
    kid(n.element, 'accidental')?.remove();
    const needed = neededAccidental(
      readScanScore(doc),
      find(readScanScore(doc), n.ordinal),
      n.step!,
      n.alter,
      n.octave,
    );
    if (needed) insert(n.element, make(doc, 'accidental', needed));
  }
}

/** Bar-local onsets of every note outside `moved`, keyed by element. */
function onsets(score: ScanScore, moved: Set<Element>) {
  return new Map(
    score.notes
      .filter((n) => !moved.has(n.element))
      .map((n) => [n.element, n.offsetInBar] as const),
  );
}

/** Multiplies every divisions and duration value of the part by `factor` (timing unchanged). */
function rescalePart(part: Element, factor: number) {
  for (const el of part.getElementsByTagName('divisions'))
    el.textContent = String(Number(el.textContent) * factor);
  for (const el of part.getElementsByTagName('duration'))
    el.textContent = String(Number(el.textContent) * factor);
}

function partOf(note: ScanNote): Element {
  return note.element.closest('part')!;
}
function divisionsAt(note: ScanNote): number {
  // The divisions in force: the last <divisions> before this note in its part.
  const part = partOf(note);
  let divisions = 1;
  for (const measure of kids(part, 'measure')) {
    for (const el of kids(measure)) {
      if (el === note.element) return divisions;
      if (el.localName === 'attributes') {
        const value = Number(kid(el, 'divisions')?.textContent);
        if (value > 0) divisions = value;
      }
    }
  }
  return divisions;
}

function applyDuration(
  doc: XMLDocument,
  score: ScanScore,
  c: Extract<Correction, { kind: 'duration' }>,
) {
  let note = find(score, c.note);
  if (note.grace) refuse((t) => t.scan.edit.refused.grace);
  // A tuplet's length is set by its bracket as much as its note value: not changed here.
  if (kid(note.element, 'time-modification')) refuse((t) => t.scan.edit.refused.tuplet);
  if (!NOTE_TYPES.includes(c.type) || ![0, 1].includes(c.dots))
    refuse((t) => t.scan.edit.refused.missing);
  const quarters = QUARTERS[c.type] * (c.dots ? 1.5 : 1);
  let divisions = divisionsAt(note);
  let local = quarters * divisions;
  if (!Number.isInteger(local)) {
    // A finer unit is needed (an eighth when a quarter is the unit): re-encode the part.
    const scale = [2, 3, 4, 6, 8, 12, 16, 24, 32].find((k) => Number.isInteger(local * k));
    if (!scale || divisions * scale > 1_000_000) refuse((t) => t.scan.edit.refused.unwritable);
    rescalePart(partOf(note), scale!);
    score = readScanScore(doc);
    note = find(score, c.note);
    divisions = divisionsAt(note);
    local = quarters * divisions;
  }
  const chord = chordOf(score, note);
  const lead = chord[0]!;
  const old = Number(kid(lead.element, 'duration')?.textContent);
  retime(doc, score, lead.element, local - old, () => {
    for (const member of chord) {
      const el = member.element;
      setText(el, 'duration', String(local));
      // A whole-bar rest given a length becomes an ordinary rest of that length.
      kid(el, 'rest')?.removeAttribute('measure');
      setText(el, 'type', c.type);
      for (const dot of kids(el, 'dot')) dot.remove();
      if (c.dots) insert(el, make(doc, 'dot'));
    }
  });
}

/**
 * Changes the length of the voice segment that starts at `lead` by `delta` (in the part's
 * divisions) through `change`, keeping every other voice where it was: the `<backup>` that returns
 * to the other voices is re-measured, and every note outside the segment is checked to start
 * exactly where it did. Refuses the change otherwise.
 */
function retime(
  doc: XMLDocument,
  score: ScanScore,
  lead: Element,
  delta: number,
  change: () => void,
) {
  const segment = new Set<Element>();
  for (let el = lead as Element | null; el; el = el.nextElementSibling) {
    if (el.localName === 'backup') break;
    if (el.localName === 'note') segment.add(el);
  }
  const before = onsets(score, segment);
  let backup: Element | null = lead.nextElementSibling;
  while (backup && backup.localName !== 'backup') backup = backup.nextElementSibling;
  change();
  if (backup && delta) {
    const value = Number(kid(backup, 'duration')?.textContent) + delta;
    if (value < 0) refuse((t) => t.scan.edit.refused.otherHand);
    if (value === 0) backup.remove();
    else kid(backup, 'duration')!.textContent = String(value);
  }
  const after = readScanScore(doc);
  const moved = onsets(after, segment);
  for (const [el, onset] of before) {
    // A removed note has no onset left to keep.
    if (!el.isConnected) continue;
    if (moved.get(el) !== onset * (after.ticksPerQuarter / score.ticksPerQuarter))
      refuse((t) => t.scan.edit.refused.otherHand);
  }
}

function writeTie(note: ScanNote, type: 'start' | 'stop') {
  const el = note.element;
  const doc = el.ownerDocument;
  if (!kids(el, 'tie').some((t) => t.getAttribute('type') === type)) {
    const tie = make(doc, 'tie', undefined, { type });
    // A stop comes before a start, as MusicXML writes a continuation.
    const existing = kids(el, 'tie');
    if (type === 'stop' && existing.length) el.insertBefore(tie, existing[0]!);
    else insert(el, tie);
  }
  let notations = kid(el, 'notations');
  if (!notations) {
    notations = make(doc, 'notations');
    insert(el, notations);
  }
  if (!kids(notations, 'tied').some((t) => t.getAttribute('type') === type)) {
    const tied = make(doc, 'tied', undefined, { type });
    const existing = kids(notations, 'tied');
    if (type === 'stop' && existing.length) notations.insertBefore(tied, existing[0]!);
    else notations.appendChild(tied);
  }
}
function clearTie(note: ScanNote, type: 'start' | 'stop') {
  const el = note.element;
  for (const tie of kids(el, 'tie')) if (tie.getAttribute('type') === type) tie.remove();
  const notations = kid(el, 'notations');
  if (!notations) return;
  for (const tied of kids(notations, 'tied')) if (tied.getAttribute('type') === type) tied.remove();
  if (!notations.children.length) notations.remove();
}

function applyTie(score: ScanScore, c: Extract<Correction, { kind: 'tie' }>) {
  const note = find(score, c.note);
  if (note.rest || note.midi === undefined || note.grace) refuse((t) => t.scan.edit.refused.rest);
  const name = { step: note.step!, alter: note.alter, octave: note.octave };
  if ((c.side ?? 'next') === 'next') {
    if (!c.tied) {
      const partner = note.tieStart ? tiePartner(score, note) : undefined;
      clearTie(note, 'start');
      if (partner && tieSource(score, partner) === note) clearTie(partner, 'stop');
      return;
    }
    if (note.tieStart) return;
    const target = tieTarget(score, note) ?? refuse((t) => t.scan.edit.refused.noTieTarget(name));
    if (target.tieStop) refuse((t) => t.scan.edit.refused.tieTaken);
    writeTie(note, 'start');
    writeTie(target, 'stop');
    return;
  }
  if (!c.tied) {
    const source = note.tieStop ? tieSource(score, note) : undefined;
    clearTie(note, 'stop');
    if (source && tiePartner(score, source) === note) clearTie(source, 'start');
    return;
  }
  if (note.tieStop) return;
  const source =
    score.notes.find(
      (n) =>
        n !== note &&
        n.part === note.part &&
        n.staff === note.staff &&
        n.midi === note.midi &&
        n.onset + n.duration === note.onset &&
        !n.tieStart,
    ) ?? refuse((t) => t.scan.edit.refused.noTieSource(name));
  writeTie(source, 'start');
  writeTie(note, 'stop');
}

function applyHand(score: ScanScore, c: Extract<Correction, { kind: 'hand' }>) {
  const note = find(score, c.note);
  if (note.staves < 2) refuse((t) => t.scan.edit.refused.oneStaff);
  if (!Number.isInteger(c.staff) || c.staff < 1 || c.staff > note.staves)
    refuse((t) => t.scan.edit.refused.missing);
  for (const linked of tieChain(score, note)) setText(linked.element, 'staff', String(c.staff));
}

function applyRemove(
  doc: XMLDocument,
  score: ScanScore,
  c: Extract<Correction, { kind: 'remove' }>,
) {
  const note = find(score, c.note);
  if (note.grace) {
    // A grace note holds no time: it simply goes.
    note.element.remove();
    return;
  }
  if (note.rest) {
    // A stray rest goes, and the rest of its voice moves up into its place.
    if (note.grace || note.chord) refuse((t) => t.scan.edit.refused.missing);
    const length = Number(kid(note.element, 'duration')?.textContent) || 0;
    retime(doc, score, note.element, -length, () => note.element.remove());
    return;
  }
  if (note.tieStart || note.tieStop) refuse((t) => t.scan.edit.refused.tiedRemove);
  const chord = chordOf(score, note);
  if (chord.length > 1) {
    if (note === chord[0]) {
      // The next member leads the chord in its place: same onset, and the same declared length.
      const next = chord[1]!;
      const own = (n: ScanNote) => kid(n.element, 'duration')?.textContent;
      if (own(next) !== own(note)) refuse((t) => t.scan.edit.refused.chordLengths);
      kid(next.element, 'chord')!.remove();
    }
    // Chord members follow their lead directly, so the next one now stands in its place.
    note.element.remove();
    return;
  }
  const el = note.element;
  // In a hand already too long for its bar (a duplicated note), the note goes and the rest of
  // its voice moves up; otherwise it becomes a rest of the same length, so nothing moves.
  const timing = barTiming(score, note.part, note.measure);
  const beats = timing?.staves.find((s) => s.staff === note.staff)?.beats;
  if (timing?.expected !== undefined && beats !== undefined && beats > timing.expected + 1e-9) {
    const length = Number(kid(el, 'duration')?.textContent) || 0;
    retime(doc, score, el, -length, () => el.remove());
    return;
  }
  kid(el, 'pitch')!.replaceWith(make(doc, 'rest'));
  for (const tag of ['accidental', 'stem', 'notehead', 'beam', 'notations'])
    for (const child of kids(el, tag)) child.remove();
}

/** MusicXML's child order within `<attributes>`, for inserting a `<time>` at its place. */
const ATTRIBUTES_ORDER = [
  'footnote',
  'level',
  'divisions',
  'key',
  'time',
  'staves',
  'part-symbol',
  'instruments',
  'clef',
  'staff-details',
  'transpose',
  'for-part',
  'directive',
  'measure-style',
];
const BEAT_TYPES = [1, 2, 4, 8, 16, 32];
const meterText = (m: { beats: number; beatType: number }) => `${m.beats}/${m.beatType}`;
function readTime(time: Element) {
  return {
    beats: Number(kid(time, 'beats')?.textContent),
    beatType: Number(kid(time, 'beat-type')?.textContent),
  };
}
function setTime(time: Element, c: MeterCorrection) {
  // A common-time or cut-time symbol would still draw the old meter.
  time.removeAttribute('symbol');
  time.removeAttribute('separator');
  const doc = time.ownerDocument;
  time.replaceChildren(
    make(doc, 'beats', String(c.beats)),
    make(doc, 'beat-type', String(c.beatType)),
  );
}
/** Writes the meter at the start of `measure`: in its leading `<attributes>`, before any note. */
function writeTime(measure: Element, c: MeterCorrection): Element[] {
  const doc = measure.ownerDocument;
  const music = kids(measure).find((el) => ['note', 'backup', 'forward'].includes(el.localName));
  const leading: Element[] = [];
  for (const el of kids(measure)) {
    if (el === music) break;
    if (el.localName === 'attributes') leading.push(el);
  }
  const times = leading.flatMap((el) => kids(el, 'time'));
  if (times.length) {
    for (const time of times) setTime(time, c);
    return times;
  }
  let attributes = leading[0];
  if (!attributes) {
    attributes = make(doc, 'attributes');
    measure.insertBefore(attributes, music ?? null);
  }
  const time = make(doc, 'time');
  setTime(time, c);
  const rank = ATTRIBUTES_ORDER.indexOf('time');
  const after = kids(attributes).find((el) => ATTRIBUTES_ORDER.indexOf(el.localName) > rank);
  attributes.insertBefore(time, after ?? null);
  return [time];
}

function applyMeter(doc: XMLDocument, score: ScanScore, c: MeterCorrection) {
  if (!Number.isInteger(c.beats) || c.beats < 1 || c.beats > 32 || !BEAT_TYPES.includes(c.beatType))
    refuse((t) => t.scan.edit.refused.meter);
  const parts = kids(doc.documentElement, 'part');
  const same = (m: { beats: number; beatType: number } | undefined) =>
    m?.beats === c.beats && m?.beatType === c.beatType;
  let changed = false;
  parts.forEach((part, index) => {
    const measures = kids(part, 'measure');
    const start = Number.isInteger(c.bar) ? measures[c.bar] : undefined;
    if (!start) return refuse((t) => t.scan.edit.refused.noBar);
    const old = score.bars.find((b) => b.part === index && b.index === c.bar)?.meter;
    if (same(old)) return;
    changed = true;
    const written = writeTime(start, c);
    if (!old) return;
    // The replaced meter restated later (a joined page's opening) changes with it; the first
    // different time signature the recognition wrote ends the change.
    for (const measure of measures.slice(c.bar))
      for (const time of measure.getElementsByTagName('time')) {
        if (written.includes(time) || time.parentElement?.localName !== 'attributes') continue;
        const found = readTime(time);
        if (same(found)) continue;
        if (found.beats !== old.beats || found.beatType !== old.beatType) return;
        setTime(time, c);
      }
  });
  if (!changed) refuse((t) => t.scan.edit.refused.sameMeter(meterText(c)));
}

/**
 * Issue 230: the repeat signs and volta brackets of one bar go, in every part. A barline left
 * with nothing to say goes with them; one that still draws a bar style stays.
 */
function applyBarline(doc: XMLDocument, c: Extract<Correction, { kind: 'barline' }>) {
  let removed = 0;
  for (const part of kids(doc.documentElement, 'part')) {
    const measure = Number.isInteger(c.bar) ? kids(part, 'measure')[c.bar] : undefined;
    if (!measure) return refuse((t) => t.scan.edit.refused.noBar);
    for (const barline of kids(measure, 'barline')) {
      for (const mark of kids(barline).filter((el) =>
        ['repeat', 'ending'].includes(el.localName),
      )) {
        mark.remove();
        removed++;
      }
      if (!kids(barline).length) barline.remove();
    }
  }
  if (!removed) refuse((t) => t.scan.edit.refused.noMark);
}

function apply(doc: XMLDocument, correction: Correction) {
  if (correction.kind === 'barline') return applyBarline(doc, correction);
  const score = readScanScore(doc);
  switch (correction.kind) {
    case 'pitch':
      return applyPitch(doc, score, correction);
    case 'duration':
      return applyDuration(doc, score, correction);
    case 'tie':
      return applyTie(score, correction);
    case 'hand':
      return applyHand(score, correction);
    case 'remove':
      return applyRemove(doc, score, correction);
    case 'meter':
      return applyMeter(doc, score, correction);
    default:
      return refuse((t) => t.scan.edit.refused.missing);
  }
}

function renderCopy(doc: XMLDocument): string {
  const copy = doc.cloneNode(true) as XMLDocument;
  const renamed = new Map<string, string>();
  for (const note of copy.getElementsByTagName('note')) {
    const id = `s${note.getAttribute(ORDINAL)}`;
    if (note.id) renamed.set(note.id, id);
    note.setAttribute('id', id);
    note.removeAttribute(ORDINAL);
  }
  // Keep any reference to an exporter's own note id pointing at the same note.
  if (renamed.size)
    for (const el of copy.querySelectorAll('[startid], [endid]'))
      for (const attr of ['startid', 'endid']) {
        const value = el.getAttribute(attr);
        const mapped = value && renamed.get(value.replace(/^#/, ''));
        if (mapped) el.setAttribute(attr, (value.startsWith('#') ? '#' : '') + mapped);
      }
  return new XMLSerializer().serializeToString(copy);
}

function exportCopy(doc: XMLDocument): string {
  const copy = doc.cloneNode(true) as XMLDocument;
  for (const note of copy.getElementsByTagName('note')) note.removeAttribute(ORDINAL);
  return new XMLSerializer().serializeToString(copy);
}

/**
 * Replays `corrections` over the raw recognition. With `strict`, the first refusal throws
 * (`CorrectionError`), which is how a new correction is checked before it is recorded.
 */
export function applyCorrections(
  raw: string,
  corrections: readonly Correction[],
  options: { strict?: boolean } = {},
): CorrectionResult {
  const doc = parseScanXml(raw);
  tagOrdinals(doc);
  let applied = 0;
  let refusal: Phrase | undefined;
  for (const correction of corrections) {
    // Each correction applies to a scratch copy first, so a refusal leaves no partial edit.
    const scratch = doc.cloneNode(true) as XMLDocument;
    try {
      apply(scratch, correction);
    } catch (cause) {
      if (options.strict || !(cause instanceof CorrectionError)) throw cause;
      refusal = cause.phrase;
      break;
    }
    doc.replaceChild(doc.importNode(scratch.documentElement, true), doc.documentElement);
    applied++;
  }
  return {
    xml: applied ? exportCopy(doc) : raw,
    renderXml: renderCopy(doc),
    applied,
    refusal,
  };
}

export interface BarTiming {
  /** The time signature's length in its beats, when one is in force. */
  expected?: number | undefined;
  /** Each staff's length in the same beats. */
  staves: { staff: number; beats: number }[];
}

/** How long each hand's music in a bar is, in the time signature's beats. */
export function barTiming(score: ScanScore, part: number, measure: number): BarTiming | undefined {
  const bar = score.bars.find((b) => b.part === part && b.index === measure);
  if (!bar) return;
  const beat = bar.meter ? (score.ticksPerQuarter * 4) / bar.meter.beatType : score.ticksPerQuarter;
  const staffCount = Math.max(
    1,
    ...score.notes.filter((n) => n.part === part).map((n) => n.staves),
  );
  return {
    expected: bar.meter?.beats,
    staves: Array.from({ length: staffCount }, (_, i) => ({
      staff: i + 1,
      beats: (bar.staffLengths.get(i + 1) ?? 0) / beat,
    })),
  };
}

export type Problem =
  | {
      kind: 'tie-gap';
      note: number;
      target: number;
      gapTicks: number;
      part: number;
      measure: number;
    }
  | { kind: 'tie-unmatched'; note: number; part: number; measure: number }
  | { kind: 'bar-timing'; part: number; bar: number; timing: BarTiming }
  /** A repeat mark the score cannot carry: a volta bracket with no repeat sign, or a repeat sign no repeat closes. */
  | { kind: 'form'; part: number; bar: number; mark: 'ending' | 'repeat' };

/**
 * Places a reader should check, found by rules that can be verified on the file itself. They
 * point at a note or a bar; they never decide the correction.
 */
export function findProblems(score: ScanScore): Problem[] {
  const problems: Problem[] = [];
  const barOf = (note: ScanNote) =>
    score.bars.find((b) => b.part === note.part && b.index === note.measure);
  // A tie may skip from the end of a repeat or first ending into a second ending.
  const acrossRepeat = (start: ScanNote | undefined, stop: ScanNote | undefined) =>
    (!!start && !!barOf(start)?.jumpsBack) || (!!stop && !!barOf(stop)?.opensEnding);
  for (const note of score.notes) {
    if (note.midi === undefined || note.grace) continue;
    if (note.tieStart) {
      const partner = tiePartner(score, note);
      const paired = !!partner && tieSource(score, partner) === note;
      const end = note.onset + note.duration;
      if (paired && partner.onset !== end && !acrossRepeat(note, partner))
        problems.push({
          kind: 'tie-gap',
          note: note.ordinal,
          target: partner.ordinal,
          gapTicks: partner.onset - end,
          part: note.part,
          measure: note.measure,
        });
      else if (!paired && !acrossRepeat(note, undefined))
        problems.push({
          kind: 'tie-unmatched',
          note: note.ordinal,
          part: note.part,
          measure: note.measure,
        });
    }
    if (note.tieStop) {
      const source = tieSource(score, note);
      if ((!source || tiePartner(score, source) !== note) && !acrossRepeat(undefined, note))
        problems.push({
          kind: 'tie-unmatched',
          note: note.ordinal,
          part: note.part,
          measure: note.measure,
        });
    }
  }
  for (const bar of score.bars) {
    const timing = barTiming(score, bar.part, bar.index);
    if (!timing) continue;
    const used = timing.staves.filter((s) => s.beats > 0);
    if (!used.length) continue;
    // Short bars where every hand agrees are ordinary (a pickup, a bar split by a repeat, a coda),
    // so only hands that disagree, or a hand longer than the time signature, are flagged.
    const disagree = used.some((s) => Math.abs(s.beats - used[0]!.beats) > 1e-9);
    const long =
      !bar.implicit &&
      timing.expected !== undefined &&
      used.some((s) => s.beats > timing.expected! + 1e-9);
    if (disagree || long)
      problems.push({ kind: 'bar-timing', part: bar.part, bar: bar.index, timing });
  }
  // A repeat mark the score cannot carry (issue 230): a volta bracket where no bar repeats, or a
  // forward repeat that no later backward repeat answers. A scanner reads such a mark into a page
  // that has none. Marked once per bar, on the first part that carries it; the removal offered
  // clears every part.
  const backward = score.bars.filter((b) => b.repeatBackward);
  const flaggedBars = new Set<number>();
  for (const bar of score.bars) {
    if (flaggedBars.has(bar.index)) continue;
    const mark =
      bar.ending && !backward.length
        ? 'ending'
        : bar.repeatForward && !backward.some((b) => b.index > bar.index)
          ? 'repeat'
          : undefined;
    if (!mark) continue;
    flaggedBars.add(bar.index);
    problems.push({ kind: 'form', part: bar.part, bar: bar.index, mark });
  }
  // In reading order: by part, then by bar, the rules of one bar in the order above.
  const barOfProblem = (p: Problem) =>
    p.kind === 'bar-timing' || p.kind === 'form' ? p.bar : p.measure;
  return problems.sort((a, b) => a.part - b.part || barOfProblem(a) - barOfProblem(b));
}

/** The removal offered on a place to check for a repeat mark the score cannot carry (issue 230). */
export function formOffers(problems: readonly Problem[]): Map<Problem, BarlineCorrection> {
  const offers = new Map<Problem, BarlineCorrection>();
  for (const problem of problems)
    if (problem.kind === 'form') offers.set(problem, { kind: 'barline', bar: problem.bar });
  return offers;
}

/** A meter `quarters` long: whole beats as quarters, else eighths, else sixteenths. */
function meterOfLength(quarters: number) {
  for (const beatType of [4, 8, 16]) {
    const beats = (quarters * beatType) / 4;
    if (Math.abs(beats - Math.round(beats)) < 1e-9)
      return beats >= 1 && beats <= 32 ? { beats: Math.round(beats), beatType } : undefined;
  }
}

/**
 * The time signature change to offer from the places to check: when two or more bars of a part
 * have hands that agree with each other on one length that runs past the time signature (a
 * misread meter, such as 4/4 for 9/8), the meter of that length, from the first of those bars.
 * At most one offer per part, so a page of such bars shows it once; it never decides on its own.
 */
export function meterOffers(
  score: ScanScore,
  problems: readonly Problem[],
): Map<Problem, MeterCorrection> {
  const offers = new Map<Problem, MeterCorrection>();
  const candidates = problems.flatMap((problem) => {
    if (problem.kind !== 'bar-timing' || problem.timing.expected === undefined) return [];
    const used = problem.timing.staves.filter((s) => s.beats > 0);
    if (used.some((s) => Math.abs(s.beats - used[0]!.beats) > 1e-9)) return [];
    const meter = score.bars.find((b) => b.part === problem.part && b.index === problem.bar)?.meter;
    const proposed = meter && meterOfLength((used[0]!.beats * 4) / meter.beatType);
    return proposed ? [{ problem, proposed }] : [];
  });
  const parts = new Set(candidates.map((c) => c.problem.part));
  for (const part of parts) {
    const inPart = candidates.filter((c) => c.problem.part === part);
    const first = inPart.find((c) =>
      inPart.some(
        (other) =>
          other !== c &&
          other.proposed.beats === c.proposed.beats &&
          other.proposed.beatType === c.proposed.beatType,
      ),
    );
    if (first && first.problem.kind === 'bar-timing')
      offers.set(first.problem, { kind: 'meter', bar: first.problem.bar, ...first.proposed });
  }
  return offers;
}
