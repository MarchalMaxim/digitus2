// The embellisher's reader: the timeline of a partwise MusicXML score, its melody voice, or the
// reason it is refused. A port of research/embellish/core.py (Measure, Note, Group, Piece, _int,
// _pitch, analyse, _find_melody), with ElementTree's lookups mirrored over @xmldom/xmldom and
// Python's iteration order kept, so that the light embellisher built on it reproduces the
// reference exactly (packages/engine/fixtures/embellish-light-golden.json).
import { parseXml } from '../io/musicxml/dom.js';
import type { Document, Element } from '../io/musicxml/dom.js';
import { frac, roundHalfEven } from './frac.js';
import type { Frac } from './frac.js';

export const OWNER_MIN = 0.9;
export const CHORD_MAX = 0.25;
const STEPS: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const HALF_BAR_STRONG = new Set(['4/4', '2/2', '4/2', '6/4', '4/8', '6/8', '12/8']);
const ZERO = frac(0);

export interface EmbMeasure {
  idx: number;
  number: string;
  el: Element;
  /** Quarters from the start of the score, as written. */
  start: Frac;
  /** Actual length (the furthest position reached). */
  length: Frac;
  time: [number, number] | null;
  fifths: number;
  /** Added to a position to get the metric position (a pickup bar counts from its end). */
  offset: Frac;
  /** A `<time>` inside the bar, after its first position. */
  innerTimeChange: boolean;
}

export function nominal(m: EmbMeasure): Frac | null {
  return m.time ? frac(m.time[0] * 4, m.time[1]) : null;
}

export function compound(m: EmbMeasure): boolean {
  return m.time !== null && m.time[1] === 8 && m.time[0] % 3 === 0 && m.time[0] >= 6;
}

export function beatQ(m: EmbMeasure): Frac {
  if (!m.time) return frac(1);
  return compound(m) ? frac(3, 2) : frac(4, m.time[1]);
}

function halfBarStrong(m: EmbMeasure): boolean {
  return m.time !== null && HALF_BAR_STRONG.has(`${m.time[0]}/${m.time[1]}`);
}

/** A strong metric position: the downbeat and, in the half-bar meters, the middle of the bar. */
export function isStrong(m: EmbMeasure, metric: Frac): boolean {
  if (metric.eq(ZERO)) return true;
  return halfBarStrong(m) && metric.eq(nominal(m)!.div(frac(2)));
}

/** A note from metric position `start` to `end` holds across a strong position (not starting on it). */
export function soundsThroughStrong(m: EmbMeasure, start: Frac, end: Frac): boolean {
  const nom = nominal(m);
  if (!nom) return false;
  const marks = halfBarStrong(m) ? [nom.div(frac(2)), nom] : [nom];
  return marks.some((s) => start.lt(s) && s.lt(end));
}

export interface EmbNote {
  el: Element;
  measure: EmbMeasure;
  onset: Frac;
  rel: Frac;
  dur: Frac;
  divisions: number;
  pitch: number | null;
  voice: string;
  staff: string;
  chord: boolean;
  grace: boolean;
  tie: boolean;
  tuplet: boolean;
  fermata: boolean;
  /** The key signature in force at the note's onset. */
  fifths: number;
}

export function end(n: EmbNote): Frac {
  return n.onset.add(n.dur);
}

/** The notes of one voice that start together (a single note or a chord). */
export interface Group {
  notes: EmbNote[];
}

/** The first note of highest pitch, as Python's `max`. */
export function top(g: Group): EmbNote {
  let best = g.notes[0]!;
  for (const n of g.notes) if ((n.pitch ?? -Infinity) > (best.pitch ?? -Infinity)) best = n;
  return best;
}

export function single(g: Group): boolean {
  return g.notes.length === 1;
}

export interface Piece {
  doc: Document;
  root: Element;
  measures: EmbMeasure[];
  notes: EmbNote[];
  staves: number;
  parts: number;
  melodyVoice: string | null;
  melody: Group[];
  refusal: string | null;
  ownerShare: number | null;
  chordShare: number | null;
}

// ---- ElementTree lookups ------------------------------------------------------------------------

function children(el: Element, name: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling)
    if (c.nodeType === 1 && (c as Element).tagName === name) out.push(c as Element);
  return out;
}

/** `el.find(name)` for a direct child, or `el.find("a/b")` across every `a` child. */
function find(el: Element, path: string): Element | undefined {
  let level = [el];
  for (const name of path.split('/')) level = level.flatMap((e) => children(e, name));
  return level[0];
}

/** ElementTree's `.text`: the character data before the first child node; `''` when none. */
function text(el: Element): string {
  let s = '';
  for (let c = el.firstChild; c && (c.nodeType === 3 || c.nodeType === 4); c = c.nextSibling)
    s += c.nodeValue ?? '';
  return s;
}

/** `el.findtext(path)`: undefined when there is no such element, its untrimmed text otherwise. */
function findtext(el: Element, path: string): string | undefined {
  const e = find(el, path);
  return e ? text(e) : undefined;
}

const FLOAT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** `int(float(text))`, or the default for a missing or non-numeric value. */
function int(s: string | undefined, dflt = 0): number {
  if (s === undefined) return dflt;
  const t = s.trim();
  if (!FLOAT.test(t)) return dflt;
  const x = Math.trunc(Number(t));
  return Number.isFinite(x) ? x + 0 : dflt;
}

function pitchOf(el: Element): number | null {
  const p = find(el, 'pitch');
  if (!p) return null;
  const octave = findtext(p, 'octave');
  const name = (findtext(p, 'step') ?? '').trim();
  const step = Object.hasOwn(STEPS, name) ? STEPS[name] : undefined;
  if (octave === undefined || !/^\s*[+-]?\d+\s*$/.test(octave) || step === undefined)
    throw new Error('MusicXML: a <pitch> without a readable <step> and <octave>');
  const alter = findtext(p, 'alter') || '0';
  if (!FLOAT.test(alter.trim())) throw new Error(`MusicXML: unreadable <alter> ${alter}`);
  return 12 * (parseInt(octave, 10) + 1) + step + roundHalfEven(Number(alter.trim()));
}

// ---- analysis -----------------------------------------------------------------------------------

export function analyseMusicXml(text: string): Piece {
  return analyseDocument(parseXml(text));
}

/** The piece's timeline, its melody voice, or the reason it is refused. */
export function analyseDocument(doc: Document): Piece {
  const root = doc.documentElement!;
  const piece: Piece = {
    doc,
    root,
    measures: [],
    notes: [],
    staves: 1,
    parts: 0,
    melodyVoice: null,
    melody: [],
    refusal: null,
    ownerShare: null,
    chordShare: null,
  };
  if (root.tagName !== 'score-partwise') {
    piece.refusal = `not a partwise score (${root.tagName})`;
    return piece;
  }
  const parts = children(root, 'part');
  piece.parts = parts.length;
  if (parts.length !== 1) {
    piece.refusal = `${parts.length} parts: the hands are not one piano part`;
    return piece;
  }
  let divisions = 1;
  let fifths = 0;
  let time: [number, number] | null = null;
  let staves = 1;
  let absStart = ZERO;
  const keyChanges: [Frac, number][] = []; // (onset, fifths) in document order
  children(parts[0]!, 'measure').forEach((m, mi) => {
    let pos = ZERO;
    let maxpos = ZERO;
    let lastStart = ZERO;
    const meas: EmbMeasure = {
      idx: mi,
      number: m.getAttribute('number') ?? '',
      el: m,
      start: absStart,
      length: ZERO,
      time,
      fifths,
      offset: ZERO,
      innerTimeChange: false,
    };
    for (let c = m.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const el = c as Element;
      if (el.tagName === 'attributes') {
        if (find(el, 'divisions')) divisions = int(findtext(el, 'divisions'), 1) || 1;
        if (find(el, 'staves')) staves = int(findtext(el, 'staves'), 1);
        const k = find(el, 'key/fifths');
        if (k) {
          fifths = int(text(k));
          keyChanges.push([absStart.add(pos), fifths]);
          if (pos.eq(ZERO)) meas.fifths = fifths;
        }
        const t = find(el, 'time');
        if (t && find(t, 'beats')) {
          const beats = (findtext(t, 'beats') ?? '').trim();
          time = /^\d+$/.test(beats)
            ? [parseInt(beats, 10), int(findtext(t, 'beat-type'), 4)]
            : null;
          if (pos.eq(ZERO)) meas.time = time;
          else meas.innerTimeChange = true;
        }
      } else if (el.tagName === 'backup') {
        pos = pos.sub(frac(int(findtext(el, 'duration')), divisions));
      } else if (el.tagName === 'forward') {
        pos = pos.add(frac(int(findtext(el, 'duration')), divisions));
        if (maxpos.lt(pos)) maxpos = pos;
      } else if (el.tagName === 'note') {
        const grace = find(el, 'grace') !== undefined;
        const chord = find(el, 'chord') !== undefined;
        const dur = grace ? ZERO : frac(int(findtext(el, 'duration')), divisions);
        const start = chord ? lastStart : pos;
        if (!chord && !grace) lastStart = pos;
        piece.notes.push({
          el,
          measure: meas,
          onset: absStart.add(start),
          rel: start,
          dur,
          divisions,
          pitch: pitchOf(el),
          voice: (findtext(el, 'voice') || '1').trim(),
          staff: (findtext(el, 'staff') || '1').trim(),
          chord,
          grace,
          tie: find(el, 'tie') !== undefined || find(el, 'notations/tied') !== undefined,
          tuplet: find(el, 'time-modification') !== undefined,
          fermata: find(el, 'notations/fermata') !== undefined,
          fifths: 0,
        });
        if (!chord && !grace) pos = pos.add(dur);
        if (maxpos.lt(pos)) maxpos = pos;
      }
    }
    meas.length = maxpos;
    const nom = nominal(meas);
    if (nom && meas.length.lt(nom) && (mi === 0 || m.getAttribute('implicit') === 'yes'))
      meas.offset = nom.sub(meas.length);
    piece.measures.push(meas);
    absStart = absStart.add(meas.length);
  });
  // a key change applies from its position, whatever the document order
  for (const n of piece.notes) {
    n.fifths = 0;
    for (let i = keyChanges.length - 1; i >= 0; i--) {
      const [t, f] = keyChanges[i]!;
      if (t.le(n.onset)) {
        n.fifths = f;
        break;
      }
    }
  }
  piece.staves = staves;
  if (staves !== 2) {
    piece.refusal = `${staves} staff/staves: the right hand is not a staff of its own`;
    return piece;
  }
  findMelody(piece);
  return piece;
}

/** Python's `f"{x:.0f}"` for a percentage. */
function pct(x: number): string {
  return String(roundHalfEven(x));
}

function findMelody(piece: Piece): void {
  const rh = piece.notes.filter(
    (n) => n.staff === '1' && n.pitch !== null && !n.grace && ZERO.lt(n.dur),
  );
  if (!rh.length) {
    piece.refusal = 'no right-hand notes';
    return;
  }
  const distinct = new Map<string, Frac>();
  for (const n of rh)
    if (!distinct.has(n.onset.toString())) distinct.set(n.onset.toString(), n.onset);
  const instants = [...distinct.values()].sort((a, b) => a.cmp(b));
  const owners = new Map<string, number>();
  const byStart = [...rh].sort((a, b) => a.onset.cmp(b.onset)); // stable, as Python's sorted
  for (const t of instants) {
    let best: EmbNote | undefined;
    let bestKey: [number, number] = [0, 0];
    for (const n of byStart) {
      if (!(n.onset.le(t) && t.lt(end(n)))) continue;
      const key: [number, number] = [n.pitch!, n.onset.eq(t) ? 1 : 0];
      if (!best || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
        best = n;
        bestKey = key;
      }
    }
    owners.set(best!.voice, (owners.get(best!.voice) ?? 0) + 1);
  }
  // Counter.most_common(1): the highest count, the voice counted first on a tie
  let voice = '';
  let owned = -1;
  for (const [v, c] of owners)
    if (c > owned) {
      voice = v;
      owned = c;
    }
  piece.ownerShare = owned / instants.length;
  if (piece.ownerShare < OWNER_MIN) {
    piece.refusal =
      `no voice owns the right hand's top line: voice ${voice} has it at ` +
      `${pct(100 * piece.ownerShare)}% of the onsets (needs ${pct(100 * OWNER_MIN)}%)`;
    return;
  }
  const groups = new Map<string, { onset: Frac; notes: EmbNote[] }>();
  for (const n of rh) {
    if (n.voice !== voice) continue;
    const key = n.onset.toString();
    const g = groups.get(key);
    if (g) g.notes.push(n);
    else groups.set(key, { onset: n.onset, notes: [n] });
  }
  const melody: Group[] = [...groups.values()]
    .sort((a, b) => a.onset.cmp(b.onset))
    .map((g) => ({ notes: g.notes }));
  const chords = melody.filter((g) => !single(g)).length;
  piece.chordShare = chords / melody.length;
  if (piece.chordShare > CHORD_MAX) {
    piece.refusal =
      `the melody voice plays chords at ${pct(100 * piece.chordShare)}% of its onsets ` +
      `(at most ${pct(100 * CHORD_MAX)}%)`;
    return;
  }
  piece.melodyVoice = voice;
  piece.melody = melody;
}
