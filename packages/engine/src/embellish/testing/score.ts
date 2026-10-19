// Tiny MusicXML fixtures for the embellisher tests: a line-for-line port of
// research/embellish/tests/fixtures.py, writing the same strings in the same order.
//
// `fixtureScore(...)` writes a one-part, two-staff piano score from compact bar lists. A bar is a
// list of events; an event is `[pitch, quarters]` with pitch a name such as "C4", "F#4", "Bb3",
// "r" for a rest, or an array of names for a chord. Options on an event go in a third item:
// `{ tie: 'start' | 'stop', tuplet: true, fermata: true, voice: '2' }`. A triplet eighth is
// `1 / 3` quarters.
//
// Staff 1 notes are voice 1 unless the bar is given in `rh2` (a second right-hand voice, voice 2);
// staff 2 notes are voice 5. Divisions default to 12, which writes every value the tests need.

export type FixtureEvent = readonly [
  pitch: string | readonly string[],
  quarters: number,
  opts?: { tie?: 'start' | 'stop'; tuplet?: boolean; fermata?: boolean; voice?: string },
];

export type Bar = FixtureEvent[];

export interface FixtureOptions {
  lh?: Bar[];
  time?: [number, number];
  fifths?: number;
  mode?: 'major' | 'minor';
  divisions?: number;
  rh2?: (Bar | null)[];
  staves?: number;
  pickup?: boolean;
  title?: string;
}

type EventOpts = NonNullable<FixtureEvent[2]>;

const TYPES: readonly (readonly [quarters: number, type: string, dots: number])[] = [
  [4, 'whole', 0],
  [3, 'half', 1],
  [2, 'half', 0],
  [3 / 2, 'quarter', 1],
  [1, 'quarter', 0],
  [3 / 4, 'eighth', 1],
  [1 / 2, 'eighth', 0],
  [1 / 4, '16th', 0],
  [1 / 3, 'eighth', 0],
  [6, 'whole', 1],
];

const EPS = 1e-9;

function ticks(q: number, divisions: number): number {
  const dur = q * divisions;
  const r = Math.round(dur);
  if (Math.abs(dur - r) > EPS)
    throw new Error(`fixtureScore: ${q} quarters is not a whole number of divisions ${divisions}`);
  return r;
}

function typeOf(q: number): readonly [string, number] {
  const t = TYPES.find(([tq]) => Math.abs(tq - q) < EPS);
  if (!t) throw new Error(`fixtureScore: no note type for ${q} quarters`);
  return [t[1], t[2]];
}

function pitchXml(name: string): string {
  const step = name[0]!;
  let rest = name.slice(1);
  let alter = 0;
  while (rest && '#b'.includes(rest[0]!)) {
    alter += rest[0] === '#' ? 1 : -1;
    rest = rest.slice(1);
  }
  if (!/^[+-]?\d+$/.test(rest.trim()))
    throw new Error(`fixtureScore: no octave in ${JSON.stringify(name)}`);
  const alt = alter ? `<alter>${alter}</alter>` : '';
  return `<pitch><step>${step}</step>${alt}<octave>${parseInt(rest, 10)}</octave></pitch>`;
}

function note(
  pitch: string,
  q: number,
  staff: string,
  voice: string,
  divisions: number,
  opts: EventOpts,
  chord = false,
): string {
  const dur = ticks(q, divisions);
  const [typ, dots] = opts.tuplet ? (['eighth', 0] as const) : typeOf(q);
  const parts = ['<note>'];
  if (chord) parts.push('<chord/>');
  parts.push(pitch === 'r' ? '<rest/>' : pitchXml(pitch));
  parts.push(`<duration>${dur}</duration>`);
  if (opts.tie) parts.push(`<tie type="${opts.tie}"/>`);
  parts.push(`<voice>${voice}</voice><type>${typ}</type>` + '<dot/>'.repeat(dots));
  if (opts.tuplet)
    parts.push(
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
        '</time-modification>',
    );
  parts.push(`<staff>${staff}</staff>`);
  const notations: string[] = [];
  if (opts.tie) notations.push(`<tied type="${opts.tie}"/>`);
  if (opts.fermata) notations.push('<fermata/>');
  if (notations.length) parts.push('<notations>' + notations.join('') + '</notations>');
  parts.push('</note>');
  return parts.join('');
}

function voiceXml(
  events: Bar,
  staff: string,
  voice: string,
  divisions: number,
): [xml: string, total: number] {
  const out: string[] = [];
  let total = 0;
  for (const ev of events) {
    const [pitch, q] = ev;
    const opts: EventOpts = ev[2] ?? {};
    const v = opts.voice ?? voice;
    if (typeof pitch !== 'string') {
      pitch.forEach((p, k) => out.push(note(p, q, staff, v, divisions, opts, k > 0)));
    } else {
      out.push(note(pitch, q, staff, v, divisions, opts));
    }
    total += ticks(q, divisions);
  }
  return [out.join(''), total];
}

export function fixtureScore(rh: Bar[], opts: FixtureOptions = {}): string {
  const time = opts.time ?? [4, 4];
  const fifths = opts.fifths ?? 0;
  const mode = opts.mode ?? 'major';
  const divisions = opts.divisions ?? 12;
  const rh2 = opts.rh2;
  const staves = opts.staves ?? 2;
  const pickup = opts.pickup ?? false;
  const title = opts.title ?? 'Fixture';
  const bars = rh.length;
  const lh: Bar[] =
    opts.lh ?? Array.from({ length: bars }, (): Bar => [['C3', (time[0] * 4) / time[1]]]);
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
      '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" ' +
      '"http://www.musicxml.org/dtds/partwise.dtd">\n' +
      `<score-partwise version="4.0"><work><work-title>${title}</work-title></work>` +
      '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">',
  ];
  for (let i = 0; i < bars; i++) {
    const implicit = pickup && i === 0 ? ' implicit="yes"' : '';
    const number = pickup && i === 0 ? '0' : String(i + 1 - (pickup ? 1 : 0));
    out.push(`<measure number="${number}"${implicit}>`);
    if (i === 0)
      out.push(
        `<attributes><divisions>${divisions}</divisions><key><fifths>${fifths}</fifths>` +
          `<mode>${mode}</mode></key><time><beats>${time[0]}</beats><beat-type>${time[1]}</beat-type>` +
          `</time><staves>${staves}</staves><clef number="1"><sign>G</sign><line>2</line></clef>` +
          (staves > 1 ? '<clef number="2"><sign>F</sign><line>4</line></clef>' : '') +
          '</attributes>',
      );
    let [body, total] = voiceXml(rh[i]!, '1', '1', divisions);
    out.push(body);
    const second = rh2?.[i];
    if (second && second.length) {
      out.push(`<backup><duration>${total}</duration></backup>`);
      [body, total] = voiceXml(second, '1', '2', divisions);
      out.push(body);
    }
    const left = lh[i];
    if (staves > 1 && left && left.length) {
      out.push(`<backup><duration>${total}</duration></backup>`);
      out.push(voiceXml(left, '2', '5', divisions)[0]);
    }
    out.push('</measure>');
  }
  out.push('</part></score-partwise>\n');
  return out.join('');
}
