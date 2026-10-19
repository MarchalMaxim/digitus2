// `checkEmbellishment`: the independent check of an embellished score against its plain score, the
// port of research/embellish/check.py's `verify`. Both scores are read with the engine's own
// MusicXML reader (`parseMusicXml`), never with the embellisher's parser, and the strong positions
// are derived again here, so that a fault in the embellisher's timeline does not hide itself.
//
// Positions are exact rationals in quarters (`Frac`), as check.py uses Fraction. The engine reader
// merges tied notes, so check.py's tie flags fold into a note's duration. It skips rests, which
// check.py counts among the notes outside the melody, so a small DOM pass over both files compares
// the rests (by part, measure, staff, voice and length): a filled or split rest is a changed note.
import { childElements, childText, parseXml } from '../io/musicxml/dom.js';
import type { Document } from '../io/musicxml/dom.js';
import { parseMusicXml } from '../io/musicxml/read.js';
import { timewiseToPartwise } from '../io/musicxml/timewise.js';
import { unpackMusicXml } from '../io/musicxml/unpack.js';
import type { Score } from '../score/types.js';
import type { InsertedNote } from './embellish.js';
import { frac, parsePyFraction } from './frac.js';
import type { Frac } from './frac.js';

export interface EmbellishCheck {
  ok: boolean;
  problems: string[];
  /** (strong position, melody pitch) pairs sounding in the plain score, and how many are kept. */
  strongTotal: number;
  strongKept: number;
}

/** The meters whose half bar is a strong position too (check.py's `HALF_BAR_STRONG`). */
const HALF_BAR_STRONG = new Set(['4/4', '2/2', '4/2', '6/4', '4/8', '6/8', '12/8']);

interface CNote {
  onset: Frac;
  end: Frac;
  dur: Frac;
  midi: number;
  staff: number;
  voice: number;
  isGrace: boolean;
}

function notesOf(score: Score): CNote[] {
  const q = (tick: number) => frac(tick, score.divisions);
  return score.notes.map((n) => ({
    onset: q(n.onsetTick),
    end: q(n.offsetTick),
    dur: q(n.offsetTick - n.onsetTick),
    midi: n.midi,
    staff: n.staff,
    voice: n.voice,
    isGrace: n.isGrace,
  }));
}

/** A multiset of string keys in first-seen order, as Python's `Counter`. */
class Multiset {
  readonly counts = new Map<string, number>();

  constructor(keys: Iterable<string> = []) {
    for (const k of keys) this.add(k);
  }

  add(k: string, n = 1): void {
    this.counts.set(k, (this.counts.get(k) ?? 0) + n);
  }

  /** `self - other`, keeping positive counts only. */
  minus(other: Multiset): Multiset {
    const out = new Multiset();
    for (const [k, c] of this.counts) {
      const d = c - (other.counts.get(k) ?? 0);
      if (d > 0) out.add(k, d);
    }
    return out;
  }

  /** `Counter.elements()`: each key repeated by its count, in first-seen order. */
  elements(): string[] {
    const out: string[] = [];
    for (const [k, c] of this.counts) for (let i = 0; i < c; i++) out.push(k);
    return out;
  }

  /** Counts are always positive, so equal maps are equal multisets. */
  equals(other: Multiset): boolean {
    if (this.counts.size !== other.counts.size) return false;
    for (const [k, c] of this.counts) if (other.counts.get(k) !== c) return false;
    return true;
  }
}

/** A Python-style list of the first `n` items, already formatted. */
function list(items: string[], n: number): string {
  return `[${items.slice(0, n).join(', ')}]`;
}

/** A reader warning without its note indices: an insertion shifts every later note's index. */
function normalise(warning: string): string {
  return warning.replace(/note \d+/g, 'note #');
}

/** The partwise document, read the way `parseMusicXml` reads it. */
function partwise(xml: string): Document {
  return timewiseToPartwise(parseXml(unpackMusicXml(xml)));
}

function implicitOf(doc: Document): boolean[] {
  const part = childElements(doc.documentElement!, 'part')[0];
  if (!part) return [];
  return childElements(part, 'measure').map((m) => m.getAttribute('implicit') === 'yes');
}

/** `implicit="yes"` per measure index of the first part, which the `Score` does not carry. */
export function implicitMeasures(xml: string): boolean[] {
  return implicitOf(partwise(xml));
}

/**
 * Every `<rest>` note as `(rest, part, measure, staff, voice, length in quarters)`: the rests
 * check.py's non-melody `Counter` holds, which the engine's `Score` does not. Measure starts are
 * compared separately, so the measure index stands in for the onset.
 */
function restKeys(doc: Document): string[] {
  const out: string[] = [];
  childElements(doc.documentElement!, 'part').forEach((part, pi) => {
    let divisions = 1;
    childElements(part, 'measure').forEach((measure, mi) => {
      for (const el of childElements(measure)) {
        if (el.tagName === 'attributes') {
          const d = Number(childText(el, 'divisions'));
          if (Number.isSafeInteger(d) && d > 0) divisions = d;
        }
        if (el.tagName !== 'note' || childElements(el, 'rest').length === 0) continue;
        const text = childText(el, 'duration');
        const dur = Number(text);
        const length =
          text !== undefined && Number.isSafeInteger(dur) ? frac(dur, divisions) : `${text}`;
        const staff = childText(el, 'staff') || '1';
        const voice = childText(el, 'voice') || '1';
        out.push(`(rest, part ${pi}, measure ${mi}, ${staff}, ${voice}, ${length})`);
      }
    });
  });
  return out;
}

/** An inserted note's onset or length, read as Python's `Fraction` reads the record. */
function recordValue(s: string): Frac {
  try {
    return parsePyFraction(s);
  } catch (e) {
    // The reader's own text ("not a number: ...", "zero denominator: ..."), minus its "MusicXML: ".
    const why = e instanceof Error ? e.message.replace(/^MusicXML: /, '') : String(e);
    throw new Error(`inserted note: ${why}`);
  }
}

/**
 * check.py's `strong_positions`: absolute onsets in quarters of the downbeats and, in the even
 * meters, the half bars. A pickup (measure 0, or an implicit measure shorter than its meter) counts
 * from its end. The time signature in force for a measure is the last one before the next
 * measure's start, as xmlcheck keys times by measure index.
 */
export function strongPositions(score: Score, implicit: readonly boolean[]): Frac[] {
  const q = (tick: number) => frac(tick, score.divisions);
  const out: Frac[] = [];
  const zero = frac(0);
  for (const m of score.measures) {
    const next = m.startTick + m.lengthTicks;
    let cur: { beats: number; beatType: number } | undefined;
    for (const t of score.timeSignatures) if (t.tick < next) cur = t;
    if (!cur) continue;
    const nominal = frac(cur.beats * 4, cur.beatType);
    const start = q(m.startTick);
    const length = q(m.lengthTicks);
    const offset =
      length.lt(nominal) && (m.index === 0 || implicit[m.index] === true)
        ? nominal.sub(length)
        : zero;
    const marks = [zero];
    if (HALF_BAR_STRONG.has(`${cur.beats}/${cur.beatType}`)) marks.push(nominal.div(frac(2)));
    for (const mark of marks) {
      const pos = mark.sub(offset);
      if (zero.le(pos) && pos.lt(length)) out.push(start.add(pos));
    }
  }
  return out;
}

const struckKey = (n: CNote) => `(${n.onset.toString()}, ${n.midi})`;

/**
 * Checks an embellished score against its plain score, as check.py's `verify`:
 * - the measures have the same starts and lengths, and the reader finds no new problem;
 * - every note outside the melody voice is unchanged;
 * - every plain melody note still starts at its onset with its pitch, and every other melody note is
 *   one of the recorded insertions;
 * - no inserted note starts on a strong position or holds across one, and the notes struck on the
 *   strong positions are the same;
 * - every (strong position, melody pitch) that sounds in the plain score sounds in the embellished
 *   one, and is struck there when it is struck in the plain score.
 * `inserted` onsets are `Frac` strings ("9/2") and lengths are read as Python's `Fraction` reads
 * them ("0.5", "1").
 */
export function checkEmbellishment(
  plainXml: string,
  embellishedXml: string,
  inserted: readonly Pick<InsertedNote, 'onset' | 'midi' | 'length'>[],
  melodyVoice: string,
): EmbellishCheck {
  const ra = parseMusicXml(plainXml);
  const rb = parseMusicXml(embellishedXml);
  const a = ra.score;
  const b = rb.score;
  const problems: string[] = [];

  const bars = (s: Score) =>
    s.measures.map((m) => `${frac(m.startTick, s.divisions)}|${frac(m.lengthTicks, s.divisions)}`);
  const barsA = bars(a);
  const barsB = bars(b);
  if (barsA.length !== barsB.length || barsA.some((x, i) => x !== barsB[i]))
    problems.push('measure starts or lengths differ');
  // A multiset: after normalising, a second dropped duplicate reads like the first one.
  const newProblems = [
    ...new Multiset(rb.warnings.map(normalise))
      .minus(new Multiset(ra.warnings.map(normalise)))
      .counts.keys(),
  ].sort();
  if (newProblems.length)
    problems.push(
      `new reader problems: ${list(
        newProblems.map((w) => `'${w}'`),
        3,
      )}`,
    );

  const voice = Number(melodyVoice);
  const isMelody = (n: CNote) => n.staff === 1 && n.voice === voice && !n.isGrace;
  const key = (n: CNote) =>
    `(${n.onset}, ${n.midi}, ${n.dur}, ${n.staff}, ${n.voice}, ${n.isGrace ? 'True' : 'False'})`;
  const notesA = notesOf(a);
  const notesB = notesOf(b);
  const docA = partwise(plainXml);
  const docB = partwise(embellishedXml);
  const recs = inserted.map((i) => {
    const onset = recordValue(i.onset);
    return { onset, end: onset.add(recordValue(i.length)), key: `(${onset}, ${i.midi})` };
  });

  const restA = new Multiset([...notesA.filter((n) => !isMelody(n)).map(key), ...restKeys(docA)]);
  const restB = new Multiset([...notesB.filter((n) => !isMelody(n)).map(key), ...restKeys(docB)]);
  if (!restA.equals(restB)) {
    const diff = [
      ...restA.minus(restB).elements().slice(0, 2),
      ...restB.minus(restA).elements().slice(0, 2),
    ];
    problems.push(`non-melody notes changed: ${list(diff, diff.length)}`);
  }
  const melA = notesA.filter(isMelody);
  const melB = notesB.filter(isMelody);
  const struckB = new Set(melB.map(struckKey));
  const missing = melA.map(struckKey).filter((k) => !struckB.has(k));
  if (missing.length) problems.push(`plain melody notes lost: ${list(missing, 3)}`);
  const extra = new Multiset(melB.map(struckKey)).minus(new Multiset(melA.map(struckKey)));
  const recorded = new Multiset(recs.map((r) => r.key));
  if (!extra.equals(recorded))
    problems.push(
      `unrecorded or missing insertions: ${list(extra.minus(recorded).elements(), 3)}` +
        ` / ${list(recorded.minus(extra).elements(), 3)}`,
    );

  const strong = strongPositions(a, implicitOf(docA));
  const strongSet = new Set(strong.map((s) => s.toString()));
  // `recorded.elements()` order: by (onset, midi), first seen first.
  const onsetOf = new Map(recs.map((r) => [r.key, r.onset.toString()]));
  for (const k of recorded.elements()) {
    const o = onsetOf.get(k)!;
    if (strongSet.has(o)) problems.push(`an inserted note starts on a strong position (${o})`);
  }
  for (const { onset: start, end } of recs) {
    if (strong.some((s) => start.lt(s) && s.lt(end)))
      problems.push(`an inserted note sounds through a strong position (${start} to ${end})`);
  }
  const struckOnStrong = (ns: CNote[]) =>
    new Multiset(ns.filter((n) => !n.isGrace && strongSet.has(n.onset.toString())).map(struckKey));
  if (!struckOnStrong(notesA).equals(struckOnStrong(notesB)))
    problems.push('the notes struck on a strong position differ');

  let total = 0;
  let kept = 0;
  for (const t of strong) {
    for (const n of melA) {
      if (!(n.onset.le(t) && t.lt(n.end))) continue;
      total += 1;
      if (n.onset.eq(t)) {
        if (melB.some((m) => m.onset.eq(t) && m.midi === n.midi)) kept += 1;
      } else if (melB.some((m) => m.onset.le(t) && t.lt(m.end) && m.midi === n.midi)) {
        kept += 1;
      }
    }
  }
  if (kept < total) problems.push(`melody pitches on strong positions kept: ${kept} of ${total}`);
  return { ok: problems.length === 0, problems, strongTotal: total, strongKept: kept };
}
