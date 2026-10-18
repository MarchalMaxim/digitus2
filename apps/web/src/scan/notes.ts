/**
 * A read-only model of the notes in a recognised MusicXML score, built from the document itself
 * rather than from the engine's strict import, so a recognition the import refuses can still be
 * inspected and corrected. A note is identified by its ordinal: its position among all `<note>`
 * elements of the raw recognition in document order (rests and chord members included). That is
 * the same index the engine's `sourceIndices` use.
 */

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SEMITONES: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** The attribute that carries a note's raw ordinal through corrections (never exported). */
export const ORDINAL = 'data-scan-note';

export interface ScanNote {
  ordinal: number;
  element: Element;
  part: number;
  /** Index of the bar within its part. */
  measure: number;
  /** The bar's printed number, or its position when it has none. */
  measureNumber: string;
  /** Staff within the part, 1-based; the part's staff count is `staves`. */
  staff: number;
  staves: number;
  voice: string;
  chord: boolean;
  rest: boolean;
  grace: boolean;
  step?: Step | undefined;
  alter: number;
  octave: number;
  /** MIDI number of a pitched note. */
  midi?: number | undefined;
  /** In the score's common ticks (`ScanScore.ticksPerQuarter` per quarter note). */
  onset: number;
  duration: number;
  /** Bar-local onset, in ticks. */
  offsetInBar: number;
  type?: string | undefined;
  dots: number;
  tieStart: boolean;
  tieStop: boolean;
}

export interface ScanBar {
  part: number;
  index: number;
  number: string;
  start: number;
  length: number;
  /** The time signature in force: beats and beat type. */
  meter?: { beats: number; beatType: number } | undefined;
  /**
   * Bar length per staff, in ticks: the longest voice that stays mostly on that staff. Measured by
   * voice, so a voice that crosses to the other staff for a few notes still counts as one hand.
   */
  staffLengths: Map<number, number>;
  /** A bar MusicXML marks as implicit (a pickup or a bar split by a repeat). */
  implicit: boolean;
  /**
   * The bar opens a volta ending, or closes one or a backward repeat. A tie may legitimately skip
   * from such a bar to a bar that is not the next in the file (into a second ending).
   */
  opensEnding: boolean;
  jumpsBack: boolean;
  /** Key signature fifths in force at the bar's start, per staff (0 when none is written). */
  fifths: Map<number, number>;
}

export interface ScanScore {
  notes: ScanNote[];
  bars: ScanBar[];
  ticksPerQuarter: number;
}

const kids = (el: Element, name?: string) =>
  [...el.children].filter((child) => name === undefined || child.localName === name);
const kid = (el: Element, name: string) => kids(el, name)[0];
const text = (el: Element, name: string) => kid(el, name)?.textContent?.trim() ?? '';
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export function midiOf(step: Step, alter: number, octave: number): number {
  return (octave + 1) * 12 + SEMITONES[step] + alter;
}

/** Parses MusicXML without entities; throws on anything that is not partwise MusicXML. */
export function parseScanXml(xml: string): XMLDocument {
  if (/<!ENTITY/i.test(xml)) throw new Error('XML entities are unsupported');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'score-partwise')
    throw new Error('expected partwise MusicXML');
  return doc;
}

/** Positive integer content, or NaN. */
function count(value: string): number {
  return /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : NaN;
}

export function readScanScore(doc: XMLDocument): ScanScore {
  const parts = kids(doc.documentElement, 'part');
  let ticksPerQuarter = 1;
  for (const el of doc.getElementsByTagName('divisions')) {
    const value = count(el.textContent?.trim() ?? '');
    if (Number.isSafeInteger(value))
      ticksPerQuarter = (ticksPerQuarter * value) / gcd(ticksPerQuarter, value);
  }
  const notes: ScanNote[] = [];
  const lengths: number[] = [];
  const raw: Omit<ScanBar, 'start'>[] = [];
  let ordinal = 0;
  parts.forEach((part, partIndex) => {
    let divisions = 1;
    let staves = 1;
    let meter: ScanBar['meter'];
    const fifths = new Map<number, number>();
    kids(part, 'measure').forEach((measure, measureIndex) => {
      const scale = () => ticksPerQuarter / divisions;
      let cursor = 0;
      let length = 0;
      let chordOnset = 0;
      const staffLengths = new Map<number, number>();
      const voices = new Map<string, { end: number; staves: Map<number, number> }>();
      const bar: Omit<ScanBar, 'start'> = {
        part: partIndex,
        index: measureIndex,
        number: measure.getAttribute('number') ?? String(measureIndex + 1),
        length: 0,
        meter,
        staffLengths,
        implicit: measure.getAttribute('implicit') === 'yes',
        opensEnding: kids(measure, 'barline').some((b) =>
          kids(b, 'ending').some((e) => e.getAttribute('type') === 'start'),
        ),
        jumpsBack: kids(measure, 'barline').some(
          (b) =>
            kids(b, 'repeat').some((r) => r.getAttribute('direction') === 'backward') ||
            kids(b, 'ending').some((e) => e.getAttribute('type') !== 'start'),
        ),
        fifths: new Map(fifths),
      };
      let sawNote = false;
      for (const el of kids(measure)) {
        const tag = el.localName;
        if (tag === 'attributes') {
          const d = count(text(el, 'divisions'));
          if (Number.isFinite(d)) divisions = d;
          const s = count(text(el, 'staves'));
          if (Number.isFinite(s)) staves = s;
          for (const key of kids(el, 'key')) {
            const value = Number(text(key, 'fifths'));
            if (!Number.isInteger(value)) continue;
            const number = key.getAttribute('number');
            const targets = number
              ? [Number(number)]
              : Array.from({ length: staves }, (_, i) => i + 1);
            for (const staff of targets) {
              fifths.set(staff, value);
              if (!sawNote) bar.fifths.set(staff, value);
            }
          }
          const time = kid(el, 'time');
          if (time) {
            const beats = Number(text(time, 'beats'));
            const beatType = Number(text(time, 'beat-type'));
            meter = beats > 0 && beatType > 0 ? { beats, beatType } : undefined;
            if (!sawNote) bar.meter = meter;
          }
        } else if (tag === 'backup' || tag === 'forward') {
          const d = count(text(el, 'duration'));
          if (!Number.isFinite(d)) continue;
          cursor += (tag === 'backup' ? -d : d) * scale();
          cursor = Math.max(0, cursor);
          length = Math.max(length, cursor);
        } else if (tag === 'note') {
          sawNote = true;
          const chord = !!kid(el, 'chord');
          const grace = !!kid(el, 'grace');
          const rest = !!kid(el, 'rest');
          const declared = count(text(el, 'duration'));
          const duration = grace || !Number.isFinite(declared) ? 0 : declared * scale();
          const onset = chord ? chordOnset : cursor;
          if (!chord) chordOnset = cursor;
          if (!chord && !grace) cursor += duration;
          length = Math.max(length, cursor, onset + duration);
          const staff = Number(text(el, 'staff') || '1');
          const voiceKey = text(el, 'voice') || '1';
          const voice = voices.get(voiceKey) ?? { end: 0, staves: new Map<number, number>() };
          voice.end = Math.max(voice.end, onset + duration);
          if (!grace) voice.staves.set(staff, (voice.staves.get(staff) ?? 0) + 1);
          voices.set(voiceKey, voice);
          const pitch = kid(el, 'pitch');
          const step = pitch ? (text(pitch, 'step') as Step) : undefined;
          const alter = pitch ? Number(text(pitch, 'alter') || '0') : 0;
          const octave = pitch ? Number(text(pitch, 'octave')) : 0;
          const valid = !!step && STEPS.includes(step) && Number.isInteger(octave);
          const ties = kids(el, 'tie').map((t) => t.getAttribute('type'));
          const tied = kids(kid(el, 'notations') ?? el, 'tied').map((t) => t.getAttribute('type'));
          const marks = ties.length ? ties : tied;
          notes.push({
            ordinal: Number(el.getAttribute(ORDINAL) ?? ordinal),
            element: el,
            part: partIndex,
            measure: measureIndex,
            measureNumber: bar.number,
            staff,
            staves,
            voice: text(el, 'voice') || '1',
            chord,
            rest,
            grace,
            step: valid ? step : undefined,
            alter: Number.isFinite(alter) ? alter : 0,
            octave: valid ? octave : 0,
            midi: valid && !rest ? midiOf(step, alter, octave) : undefined,
            onset,
            duration,
            offsetInBar: onset,
            type: text(el, 'type') || undefined,
            dots: kids(el, 'dot').length,
            tieStart: marks.includes('start'),
            tieStop: marks.includes('stop'),
          });
          ordinal++;
        }
      }
      for (const voice of voices.values()) {
        const counts = [...voice.staves].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        const staff = counts[0]?.[0];
        if (staff !== undefined)
          staffLengths.set(staff, Math.max(staffLengths.get(staff) ?? 0, voice.end));
      }
      bar.length = length;
      raw.push(bar);
      lengths[measureIndex] = Math.max(lengths[measureIndex] ?? 0, length);
    });
  });
  // Bars start where the longest part's previous bar ended, as in the engine's import.
  const starts: number[] = [];
  lengths.forEach((_, i) => (starts[i] = i === 0 ? 0 : starts[i - 1]! + lengths[i - 1]!));
  const bars = raw.map((bar) => ({ ...bar, start: starts[bar.index] ?? 0 }));
  for (const note of notes) note.onset += starts[note.measure] ?? 0;
  return { notes, bars, ticksPerQuarter };
}

/** Tags every `<note>` with its ordinal so later edits keep each note's identity. */
export function tagOrdinals(doc: XMLDocument): void {
  [...doc.getElementsByTagName('note')].forEach((note, i) => {
    if (!note.hasAttribute(ORDINAL)) note.setAttribute(ORDINAL, String(i));
  });
}

/** The notes of `note`'s chord: the lead note and its `<chord/>` members, in document order. */
export function chordOf(score: ScanScore, note: ScanNote): ScanNote[] {
  const index = score.notes.indexOf(note);
  let lead = index;
  while (lead > 0 && score.notes[lead]!.chord) lead--;
  const out = [score.notes[lead]!];
  for (let i = lead + 1; i < score.notes.length && score.notes[i]!.chord; i++)
    out.push(score.notes[i]!);
  return out;
}

/** The pitched note that `note`'s tie start reaches: same part, staff and pitch, starting at its end. */
export function tieTarget(score: ScanScore, note: ScanNote): ScanNote | undefined {
  if (note.midi === undefined) return;
  const end = note.onset + note.duration;
  const candidates = score.notes.filter(
    (n) =>
      n !== note &&
      n.part === note.part &&
      n.staff === note.staff &&
      n.midi === note.midi &&
      !n.grace &&
      n.onset === end,
  );
  return candidates.find((n) => n.voice === note.voice) ?? candidates[0];
}

/** The note a tie start actually pairs with in the file: the next same-pitch note with a stop. */
export function tiePartner(score: ScanScore, note: ScanNote): ScanNote | undefined {
  if (note.midi === undefined) return;
  const later = score.notes.filter(
    (n) =>
      n.part === note.part &&
      n.staff === note.staff &&
      n.midi === note.midi &&
      n.tieStop &&
      n.onset > note.onset,
  );
  later.sort((a, b) => a.onset - b.onset);
  return later.find((n) => n.voice === note.voice) ?? later[0];
}

/** The note whose tie start pairs with `note`'s tie stop. */
export function tieSource(score: ScanScore, note: ScanNote): ScanNote | undefined {
  if (note.midi === undefined) return;
  const earlier = score.notes.filter(
    (n) =>
      n.part === note.part &&
      n.staff === note.staff &&
      n.midi === note.midi &&
      n.tieStart &&
      n.onset < note.onset,
  );
  earlier.sort((a, b) => b.onset - a.onset);
  return earlier.find((n) => n.voice === note.voice) ?? earlier[0];
}

/** Every note joined to `note` by ties, in order. */
export function tieChain(score: ScanScore, note: ScanNote): ScanNote[] {
  const chain = [note];
  for (let n = note; n.tieStop;) {
    const source = tieSource(score, n);
    if (!source || chain.includes(source)) break;
    chain.unshift(source);
    n = source;
  }
  for (let n = note; n.tieStart;) {
    const partner = tiePartner(score, n);
    if (!partner || chain.includes(partner)) break;
    chain.push(partner);
    n = partner;
  }
  return chain;
}

/** Notes in reading order for keyboard stepping: by time, then upper staff first, then high to low. */
export function readingOrder(score: ScanScore): ScanNote[] {
  return score.notes
    .filter((n) => !n.grace)
    .sort(
      (a, b) =>
        a.part - b.part ||
        a.onset - b.onset ||
        a.staff - b.staff ||
        (b.midi ?? -1) - (a.midi ?? -1) ||
        a.ordinal - b.ordinal,
    );
}
