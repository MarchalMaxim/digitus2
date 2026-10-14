import type {
  KeySigEvent,
  MeasureInfo,
  Note,
  Score,
  TempoEvent,
  TimeSigEvent,
} from '../../score/types.js';
import { ENGINE_VERSION } from '../../version.js';

export type NoteTypeName = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd' | '64th';
export interface DurationSpec {
  type: NoteTypeName;
  dots: 0 | 1; // no double dots: they are hard for beginners; such lengths become tied notes
  triplet: boolean; // 3:2 time modification
  ticks: number;
}
export interface EngraveOptions {
  title?: string; // default score.meta.title, else 'Untitled'
  composer?: string; // default score.meta.composer
}
export const MAX_VOICES_PER_STAFF = 4;

const NOTE_TYPES: ReadonlyArray<readonly [NoteTypeName, number, number]> = [
  ['whole', 4, 1],
  ['half', 2, 1],
  ['quarter', 1, 1],
  ['eighth', 1, 2],
  ['16th', 1, 4],
  ['32nd', 1, 8],
  ['64th', 1, 16],
];
const BEAMABLE: ReadonlySet<NoteTypeName> = new Set<NoteTypeName>([
  'eighth',
  '16th',
  '32nd',
  '64th',
]);
const ACCIDENTALS: Readonly<Record<number, string>> = {
  [-2]: 'flat-flat',
  [-1]: 'flat',
  0: 'natural',
  1: 'sharp',
  2: 'double-sharp',
};
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const TIME_MODIFICATION =
  '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';

type Staff = 1 | 2;
interface VoiceEvent {
  notes: Note[];
  onset: number;
  offset: number;
  grace: boolean;
  voice: number;
}
type PieceKind = 'note' | 'rest' | 'grace' | 'measure-rest' | 'forward';
interface Piece {
  kind: PieceKind;
  start: number;
  end: number;
  notes: Note[];
  spec: DurationSpec | null;
  tupletStart: boolean;
  tupletStop: boolean;
  beam: 'begin' | 'continue' | 'end' | null;
  accidentals: Array<string | null>;
  tempos: number[];
}
interface MeasureContext {
  first: boolean;
  last: boolean;
  key: KeySigEvent;
  time: TimeSigEvent;
  keyChanged: boolean;
  timeChanged: boolean;
  initialTempo: TempoEvent | null;
  tempos: TempoEvent[];
}

const tableCache = new Map<string, DurationSpec[]>();

/** Every single note value at these divisions, longest first, undotted before dotted. */
export function durationTable(divisions: number, triplet: boolean): DurationSpec[] {
  const cacheKey = `${divisions}:${triplet}`;
  const cached = tableCache.get(cacheKey);
  if (cached) return cached;
  const out: DurationSpec[] = [];
  for (const [type, qn, qd] of NOTE_TYPES)
    for (const [dots, dn, dd] of [
      [0, 1, 1],
      [1, 3, 2],
    ] as const) {
      const num = divisions * qn * dn * (triplet ? 2 : 1);
      const den = qd * dd * (triplet ? 3 : 1);
      if (num % den === 0) out.push({ type, dots, triplet, ticks: num / den });
    }
  out.sort((a, b) => b.ticks - a.ticks || a.dots - b.dots);
  tableCache.set(cacheKey, out);
  return out;
}

/** One value when one fits exactly, else the longest values first (written tied); null if none fit. */
export function expressDuration(
  ticks: number,
  divisions: number,
  triplet: boolean,
): DurationSpec[] | null {
  const table = durationTable(divisions, triplet);
  const exact = table.find((d) => d.ticks === ticks);
  if (exact) return [exact];
  const parts: DurationSpec[] = [];
  let rest = ticks;
  while (rest > 0) {
    const d = table.find((x) => x.ticks <= rest);
    if (!d) return null;
    parts.push(d);
    rest -= d.ticks;
  }
  return parts;
}

/**
 * Writes the Score as partwise MusicXML 4.0: one part, two staves (right hand upper, left hand
 * lower), up to four voices per staff, ids on the first <note> of every sounding note. The
 * result reads back through parseMusicXml with the same notes; a rhythm it cannot express
 * exactly throws instead of being written wrong.
 */
export function scoreToMusicXml(score: Score, opts: EngraveOptions = {}): string {
  const D = score.divisions;
  const voices = allocateVoices(score);
  const measures: MeasureInfo[] =
    score.measures.length > 0
      ? score.measures
      : [{ index: 0, startTick: 0, lengthTicks: 4 * D, number: '1' }];
  const tempoMap = score.tempoMap.length > 0 ? score.tempoMap : [{ tick: 0, qpm: 120 }];
  const initial = tempoMap[0]!.tick === 0 ? tempoMap[0]! : null;
  const later = initial ? tempoMap.slice(1) : tempoMap;
  const lines = [headerXml(score, opts)];
  let previousKey: KeySigEvent | null = null;
  let previousTime: TimeSigEvent | null = null;
  measures.forEach((m, i) => {
    const key = activeAt(score.keySignatures, m.startTick) ?? { tick: 0, fifths: 0 };
    const time = activeAt(score.timeSignatures, m.startTick) ?? { tick: 0, beats: 4, beatType: 4 };
    const last = i === measures.length - 1;
    const end = m.startTick + m.lengthTicks;
    lines.push(
      measureXml(m, D, voices, {
        first: i === 0,
        last,
        key,
        time,
        keyChanged:
          previousKey !== null &&
          (previousKey.fifths !== key.fifths || previousKey.mode !== key.mode),
        timeChanged:
          previousTime !== null &&
          (previousTime.beats !== time.beats || previousTime.beatType !== time.beatType),
        initialTempo: i === 0 ? initial : null,
        tempos: later.filter((t) => t.tick >= m.startTick && (t.tick < end || last)),
      }),
    );
    previousKey = key;
    previousTime = time;
  });
  lines.push('</part>', '</score-partwise>');
  return lines.join('\n') + '\n';
}

function activeAt<T extends { tick: number }>(events: readonly T[], tick: number): T | undefined {
  let found: T | undefined;
  for (const e of events) if (e.tick <= tick) found = e;
  return found;
}

/**
 * Groups each hand's notes into chord events (same onset and offset) and gives each event the
 * lowest free voice of its staff (1-4 upper, 5-8 lower); grace notes join the voice of a note
 * starting at their onset.
 */
function allocateVoices(score: Score): Map<number, VoiceEvent[]> {
  const byVoice = new Map<number, VoiceEvent[]>([
    [1, []],
    [5, []],
  ]);
  for (const [hand, base] of [
    ['R', 1],
    ['L', 5],
  ] as const) {
    const own = score.notes.filter((n) => n.hand === hand);
    const isGrace = (n: Note) => n.isGrace || n.offsetTick <= n.onsetTick;
    const groups = new Map<string, Note[]>();
    for (const n of own) {
      if (isGrace(n)) continue;
      const k = `${n.onsetTick}:${n.offsetTick}`;
      const g = groups.get(k);
      if (g) g.push(n);
      else groups.set(k, [n]);
    }
    const events: VoiceEvent[] = [...groups.values()]
      .map((notes) => ({
        notes: [...notes].sort((a, b) => a.midi - b.midi),
        onset: notes[0]!.onsetTick,
        offset: notes[0]!.offsetTick,
        grace: false,
        voice: base,
      }))
      .sort(
        (a, b) =>
          a.onset - b.onset ||
          b.offset - a.offset ||
          b.notes[b.notes.length - 1]!.midi - a.notes[a.notes.length - 1]!.midi,
      );
    const busyUntil: number[] = [];
    for (const e of events) {
      let v = busyUntil.findIndex((t) => t <= e.onset);
      if (v < 0) {
        if (busyUntil.length >= MAX_VOICES_PER_STAFF)
          throw new Error(
            `cannot engrave: more than ${MAX_VOICES_PER_STAFF} voices needed in the ${hand === 'R' ? 'upper' : 'lower'} staff at tick ${e.onset}`,
          );
        v = busyUntil.length;
        busyUntil.push(e.offset);
      } else busyUntil[v] = e.offset;
      e.voice = base + v;
    }
    const graces: VoiceEvent[] = own
      .filter(isGrace)
      .sort((a, b) => a.onsetTick - b.onsetTick || a.midi - b.midi)
      .map((n) => {
        let voice = events.find((e) => e.onset === n.onsetTick)?.voice;
        for (let v = base; voice === undefined && v < base + MAX_VOICES_PER_STAFF; v++)
          if (!events.some((e) => e.voice === v && e.onset < n.onsetTick && n.onsetTick < e.offset))
            voice = v;
        return {
          notes: [n],
          onset: n.onsetTick,
          offset: n.onsetTick,
          grace: true,
          voice: voice ?? base,
        };
      });
    for (const e of [...events, ...graces]) {
      const list = byVoice.get(e.voice);
      if (list) list.push(e);
      else byVoice.set(e.voice, [e]);
    }
  }
  for (const list of byVoice.values())
    list.sort(
      (a, b) =>
        a.onset - b.onset ||
        Number(b.grace) - Number(a.grace) ||
        a.notes[0]!.midi - b.notes[0]!.midi,
    );
  return byVoice;
}

function piece(
  kind: PieceKind,
  start: number,
  end: number,
  notes: Note[],
  spec: DurationSpec | null,
): Piece {
  return {
    kind,
    start,
    end,
    notes,
    spec,
    tupletStart: false,
    tupletStop: false,
    beam: null,
    accidentals: notes.map(() => null),
    tempos: [],
  };
}

function measureXml(
  m: MeasureInfo,
  D: number,
  voices: Map<number, VoiceEvent[]>,
  c: MeasureContext,
): string {
  const start = m.startTick;
  const end = m.startTick + m.lengthTicks;
  const nominal = (c.time.beats * 4 * D) / c.time.beatType;
  const out = [
    `<measure number="${escapeXml(m.number)}"${c.first && m.lengthTicks < nominal ? ' implicit="yes"' : ''}>`,
  ];
  if (c.first)
    out.push(
      `<attributes><divisions>${D}</divisions>${keyXml(c.key)}${timeXml(c.time)}<staves>2</staves>` +
        '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>',
    );
  else if (c.keyChanged || c.timeChanged)
    out.push(
      `<attributes>${c.keyChanged ? keyXml(c.key) : ''}${c.timeChanged ? timeXml(c.time) : ''}</attributes>`,
    );
  if (c.initialTempo) out.push(metronomeXml(c.initialTempo.qpm));
  const inside = c.tempos.filter((t) => t.tick < end);
  const trailing = c.tempos.filter((t) => t.tick >= end);
  if (m.lengthTicks > 0) {
    const written: Array<{ voice: number; staff: Staff; pieces: Piece[] }> = [];
    for (const voice of [...voices.keys()].sort((a, b) => a - b)) {
      const primary = voice === 1 || voice === 5;
      const events = voices
        .get(voice)!
        .filter((e) =>
          e.grace ? e.onset >= start && e.onset < end : e.onset < end && e.offset > start,
        );
      if (!primary && events.length === 0) continue;
      const pieces = voicePieces(
        events,
        start,
        end,
        D,
        primary,
        voice === 1 ? inside.map((t) => t.tick) : [],
      );
      if (voice === 1) attachTempos(pieces, inside);
      markBeams(pieces, start, D, c.time);
      written.push({ voice, staff: voice <= MAX_VOICES_PER_STAFF ? 1 : 2, pieces });
    }
    for (const staff of [1, 2] as const)
      markAccidentals(
        written.filter((w) => w.staff === staff),
        c.key,
      );
    written.forEach((w, i) => {
      if (i > 0) out.push(`<backup><duration>${m.lengthTicks}</duration></backup>`);
      for (const p of w.pieces) out.push(pieceXml(p, w.voice, w.staff));
      if (w.voice === 1)
        for (const t of trailing) out.push(`<sound tempo="${formatNumber(t.qpm)}"/>`);
    });
  }
  out.push('</measure>');
  return out.join('\n');
}

/**
 * Cuts one voice's events in one measure into writable pieces: notes and rests split at the
 * barlines, triplet-window edges, grace-note onsets and extra split points (tempo changes),
 * each piece one standard value.
 */
function voicePieces(
  events: VoiceEvent[],
  start: number,
  end: number,
  D: number,
  primary: boolean,
  extraSplits: number[],
): Piece[] {
  const sounding = events.filter((e) => !e.grace);
  const graces = events.filter((e) => e.grace);
  const inside = (t: number) => t > start && t < end;
  if (primary && sounding.length === 0 && graces.length === 0 && !extraSplits.some(inside))
    return [piece('measure-rest', start, end, [], null)];

  const segments: Array<{ start: number; end: number; event: VoiceEvent | null }> = [];
  let cursor = start;
  for (const e of sounding) {
    const s = Math.max(e.onset, start);
    const t = Math.min(e.offset, end);
    if (s > cursor) segments.push({ start: cursor, end: s, event: null });
    segments.push({ start: s, end: t, event: e });
    cursor = t;
  }
  if (cursor < end) segments.push({ start: cursor, end, event: null });

  // Absolute quarter-note windows: straight when every inner boundary is a 64th-note position,
  // triplet when some is not but all are 16th-triplet half positions (D / 24); otherwise refuse.
  const windowOf = (t: number) => Math.floor(t / D);
  const straight = (t: number) => ((t - windowOf(t) * D) * 16) % D === 0;
  const tripletPosition = (t: number) => ((t - windowOf(t) * D) * 24) % D === 0;
  const refuse = (t: number) =>
    new Error(
      `cannot engrave a rhythm at tick ${t}: only straight values down to 64th notes and triplets within one beat are supported`,
    );
  const boundaries = [
    ...segments.flatMap((s) => [s.start, s.end]),
    ...graces.map((g) => g.onset),
    ...extraSplits,
  ].filter(inside);
  const tripletWindows = new Set<number>();
  for (const b of boundaries) {
    if (straight(b)) continue;
    if (!tripletPosition(b)) throw refuse(b);
    tripletWindows.add(windowOf(b));
  }
  for (const b of boundaries)
    if (tripletWindows.has(windowOf(b)) && !tripletPosition(b)) throw refuse(b);

  const splits = new Set<number>([...graces.map((g) => g.onset), ...extraSplits]);
  for (const k of tripletWindows) {
    splits.add(k * D);
    splits.add((k + 1) * D);
  }
  const pieces: Piece[] = [];
  for (const seg of segments) {
    const cuts = new Set([...splits].filter((t) => t > seg.start && t < seg.end));
    if (seg.event === null && primary)
      for (let t = (windowOf(seg.start) + 1) * D; t < seg.end; t += D) cuts.add(t);
    const bounds = [seg.start, ...[...cuts].sort((a, b) => a - b), seg.end];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const a = bounds[i]!;
      const b = bounds[i + 1]!;
      for (const g of graces) if (g.onset === a) pieces.push(piece('grace', a, a, g.notes, null));
      if (seg.event === null && !primary) {
        pieces.push(piece('forward', a, b, [], null));
        continue;
      }
      const specs = expressDuration(b - a, D, tripletWindows.has(windowOf(a)));
      if (!specs)
        throw new Error(
          `cannot engrave a duration of ${b - a} ticks at tick ${a} (divisions ${D})`,
        );
      let t = a;
      for (const spec of specs) {
        pieces.push(
          piece(
            seg.event ? 'note' : 'rest',
            t,
            t + spec.ticks,
            seg.event ? seg.event.notes : [],
            spec,
          ),
        );
        t += spec.ticks;
      }
    }
  }
  for (const k of tripletWindows) {
    const members = pieces.filter(
      (p) => (p.kind === 'note' || p.kind === 'rest') && p.start >= k * D && p.end <= (k + 1) * D,
    );
    if (members.length > 0) {
      members[0]!.tupletStart = true;
      members[members.length - 1]!.tupletStop = true;
    }
  }
  return pieces;
}

function attachTempos(pieces: Piece[], tempos: readonly TempoEvent[]): void {
  for (const t of tempos) {
    const target = pieces.find((p) => p.start >= t.tick) ?? pieces[pieces.length - 1];
    target?.tempos.push(t.qpm);
  }
}

/** Primary beams over runs of eighths and shorter within one beat group. */
function markBeams(pieces: Piece[], start: number, D: number, time: TimeSigEvent): void {
  const width = time.beatType === 8 && time.beats % 3 === 0 && time.beats >= 6 ? (3 * D) / 2 : D;
  const group = (t: number) => Math.floor((t - start) / width);
  const beamable = (p: Piece) =>
    p.kind === 'note' &&
    p.spec !== null &&
    BEAMABLE.has(p.spec.type) &&
    group(p.start) === group(p.end - 1);
  let run: Piece[] = [];
  const flush = () => {
    if (run.length >= 2)
      run.forEach((p, i) => {
        p.beam = i === 0 ? 'begin' : i === run.length - 1 ? 'end' : 'continue';
      });
    run = [];
  };
  for (const p of pieces) {
    if (p.kind === 'grace') continue;
    if (beamable(p) && (run.length === 0 || group(run[0]!.start) === group(p.start))) run.push(p);
    else {
      flush();
      if (beamable(p)) run.push(p);
    }
  }
  flush();
}

function keyAlter(fifths: number, step: string): number {
  if (fifths > 0) return SHARP_ORDER.indexOf(step) < fifths ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.indexOf(step) < -fifths ? -1 : 0;
  return 0;
}

/** Accidentals once per measure, staff, letter and octave, as the key signature requires. */
function markAccidentals(
  voices: ReadonlyArray<{ voice: number; pieces: Piece[] }>,
  key: KeySigEvent,
): void {
  const items = voices
    .flatMap((w) =>
      w.pieces.flatMap((p) => p.notes.map((note, j) => ({ p, j, note, voice: w.voice }))),
    )
    .sort(
      (a, b) =>
        a.p.start - b.p.start ||
        Number(b.p.kind === 'grace') - Number(a.p.kind === 'grace') ||
        a.voice - b.voice ||
        a.note.midi - b.note.midi,
    );
  const current = new Map<string, number>();
  for (const { p, j, note } of items) {
    if (p.kind !== 'grace' && p.start !== note.onsetTick) continue; // tie continuations show no accidental
    const slot = `${note.spelling.step}${note.spelling.octave}`;
    const expected = current.get(slot) ?? keyAlter(key.fifths, note.spelling.step);
    if (note.spelling.alter !== expected) {
      p.accidentals[j] = ACCIDENTALS[note.spelling.alter] ?? null;
      current.set(slot, note.spelling.alter);
    }
  }
}

function pieceXml(p: Piece, voice: number, staff: Staff): string {
  const tempo = p.tempos.map((q) => `<sound tempo="${formatNumber(q)}"/>`).join('');
  const length = p.end - p.start;
  switch (p.kind) {
    case 'forward':
      return `${tempo}<forward><duration>${length}</duration><voice>${voice}</voice><staff>${staff}</staff></forward>`;
    case 'measure-rest':
      return `${tempo}<note><rest measure="yes"/><duration>${length}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`;
    case 'rest':
      return `${tempo}<note><rest/><duration>${length}</duration><voice>${voice}</voice>${typeXml(p.spec!)}${p.spec!.triplet ? TIME_MODIFICATION : ''}<staff>${staff}</staff>${notationsXml('', p)}</note>`;
    default:
      return tempo + p.notes.map((n, j) => noteXml(p, n, j, voice, staff)).join('');
  }
}

function noteXml(p: Piece, n: Note, j: number, voice: number, staff: Staff): string {
  const grace = p.kind === 'grace';
  const first = grace || p.start === n.onsetTick;
  const last = grace || p.end === n.offsetTick;
  const accidental = p.accidentals[j];
  return [
    first ? `<note id="${escapeXml(n.id)}">` : '<note>',
    grace ? '<grace slash="yes"/>' : '',
    j > 0 ? '<chord/>' : '',
    pitchXml(n),
    grace ? '' : `<duration>${p.end - p.start}</duration>`,
    first ? '' : '<tie type="stop"/>',
    last ? '' : '<tie type="start"/>',
    `<voice>${voice}</voice>`,
    grace ? '<type>eighth</type>' : typeXml(p.spec!),
    accidental ? `<accidental>${accidental}</accidental>` : '',
    !grace && p.spec!.triplet ? TIME_MODIFICATION : '',
    `<staff>${staff}</staff>`,
    j === 0 && p.beam ? `<beam number="1">${p.beam}</beam>` : '',
    notationsXml(
      `${first ? '' : '<tied type="stop"/>'}${last ? '' : '<tied type="start"/>'}`,
      j === 0 ? p : null,
    ),
    '</note>',
  ].join('');
}

function notationsXml(tied: string, p: Piece | null): string {
  const tuplet = p
    ? `${p.tupletStart ? '<tuplet type="start"/>' : ''}${p.tupletStop ? '<tuplet type="stop"/>' : ''}`
    : '';
  return tied || tuplet ? `<notations>${tied}${tuplet}</notations>` : '';
}

function typeXml(spec: DurationSpec): string {
  return `<type>${spec.type}</type>${spec.dots ? '<dot/>' : ''}`;
}

function pitchXml(n: Note): string {
  const s = n.spelling;
  return `<pitch><step>${s.step}</step>${s.alter !== 0 ? `<alter>${s.alter}</alter>` : ''}<octave>${s.octave}</octave></pitch>`;
}

function keyXml(k: KeySigEvent): string {
  return `<key><fifths>${k.fifths}</fifths>${k.mode ? `<mode>${k.mode}</mode>` : ''}</key>`;
}

function timeXml(t: TimeSigEvent): string {
  return `<time><beats>${t.beats}</beats><beat-type>${t.beatType}</beat-type></time>`;
}

function metronomeXml(qpm: number): string {
  const q = formatNumber(qpm);
  return `<direction placement="above"><direction-type><metronome parentheses="no"><beat-unit>quarter</beat-unit><per-minute>${q}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${q}"/></direction>`;
}

function headerXml(score: Score, opts: EngraveOptions): string {
  const title = opts.title ?? score.meta.title ?? 'Untitled';
  const composer = opts.composer ?? score.meta.composer;
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `<work><work-title>${escapeXml(title)}</work-title></work>`,
    `<identification>${composer ? `<creator type="composer">${escapeXml(composer)}</creator>` : ''}<encoding><software>digitus2 ${ENGINE_VERSION}</software></encoding></identification>`,
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>',
    '<part id="P1">',
  ].join('\n');
}

function formatNumber(x: number): string {
  return String(Number(x.toFixed(4)));
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
