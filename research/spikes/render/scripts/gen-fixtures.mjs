// THROWAWAY spike: generates the MusicXML / MXL / MIDI fixtures used by the measurements.
//   node scripts/gen-fixtures.mjs
// Output: fixtures/short-piano.musicxml (+ .mxl), fixtures/long-120.musicxml (+ .mxl), fixtures/tempo-map.mid
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import midiFile from 'midi-file';

const here = dirname(fileURLToPath(import.meta.url));
const out = (name) => join(here, '..', 'fixtures', name);
const DIV = 12; // divisions per quarter (allows 8th-triplets = 4)

// ---------- pitch helpers ----------
const STEP_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
function parsePitch(s) {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d)$/.exec(s);
  if (!m) throw new Error('bad pitch ' + s);
  const acc = m[2] ?? '';
  const alter = acc.startsWith('#') ? acc.length : -acc.length;
  return { step: m[1], alter, octave: Number(m[3]) };
}
const keyAlter = (fifths, step) =>
  fifths > 0 ? (SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0)
  : fifths < 0 ? ([...SHARP_ORDER].reverse().slice(0, -fifths).includes(step) ? -1 : 0) : 0;
const ACC_NAME = { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };
function typeOf(dur, timeMod) {
  const d = timeMod ? (dur * timeMod[0]) / timeMod[1] : dur;
  const table = { 48: ['whole', 0], 36: ['half', 1], 24: ['half', 0], 18: ['quarter', 1], 12: ['quarter', 0], 9: ['eighth', 1], 6: ['eighth', 0], 3: ['16th', 0] };
  if (!table[d]) throw new Error('no type for duration ' + dur);
  return table[d];
}

// ---------- MusicXML writer ----------
// event: { d, n: ['G4',..] | rest:true, f:[fingers|null], tie:[..], slur, beam, tuplet, tm:[3,2], grace:{slash}, stem, fermata, placement }
function writeScore({ title, measures, withIds }) {
  let idCounter = 0;
  let accState = new Map(); // per measure: "step+octave" -> alter currently in effect
  let fifths = 0;
  let measureLen = 48;
  const xmlMeasures = measures.map((m, mi) => {
    accState = new Map();
    if (m.attributes?.fifths !== undefined) fifths = m.attributes.fifths;
    if (m.attributes?.time) measureLen = (m.attributes.time[0] * 4 * DIV) / m.attributes.time[1];
    const parts = [];
    if (m.attributes) {
      const a = m.attributes;
      parts.push('<attributes>' +
        (mi === 0 ? `<divisions>${DIV}</divisions>` : '') +
        (a.fifths !== undefined ? `<key><fifths>${a.fifths}</fifths></key>` : '') +
        (a.time ? `<time><beats>${a.time[0]}</beats><beat-type>${a.time[1]}</beat-type></time>` : '') +
        (mi === 0 ? '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>' : '') +
        '</attributes>');
    }
    for (const dir of m.directions ?? []) parts.push(dir);
    m.voices.forEach((v, vi) => {
      let total = 0;
      for (const ev of v.events) {
        const notes = ev.rest ? [null] : ev.n;
        notes.forEach((ps, ni) => {
          const x = [];
          if (ev.grace) x.push(ev.grace.slash ? '<grace slash="yes"/>' : '<grace/>');
          if (ni > 0) x.push('<chord/>');
          let pitch = null;
          if (ev.rest) x.push('<rest/>');
          else {
            pitch = parsePitch(ps);
            x.push(`<pitch><step>${pitch.step}</step>${pitch.alter ? `<alter>${pitch.alter}</alter>` : ''}<octave>${pitch.octave}</octave></pitch>`);
          }
          if (!ev.grace) x.push(`<duration>${ev.d}</duration>`);
          const tie = ev.tie?.[ni];
          if (tie === 'stop' || tie === 'both') x.push('<tie type="stop"/>');
          if (tie === 'start' || tie === 'both') x.push('<tie type="start"/>');
          x.push(`<voice>${v.voice}</voice>`);
          const [type, dots] = ev.grace ? [ev.graceType ?? 'eighth', 0] : typeOf(ev.d, ev.tm);
          x.push(`<type>${type}</type>`);
          for (let i = 0; i < dots; i++) x.push('<dot/>');
          if (pitch) {
            const key = pitch.step + pitch.octave;
            const expected = accState.has(key) ? accState.get(key) : keyAlter(fifths, pitch.step);
            if (pitch.alter !== expected && tie !== 'stop') {
              x.push(`<accidental>${ACC_NAME[pitch.alter]}</accidental>`);
              accState.set(key, pitch.alter);
            }
          }
          if (ev.tm) x.push(`<time-modification><actual-notes>${ev.tm[0]}</actual-notes><normal-notes>${ev.tm[1]}</normal-notes></time-modification>`);
          if (ev.stem && !ev.rest) x.push(`<stem>${ev.stem}</stem>`);
          x.push(`<staff>${v.staff}</staff>`);
          if (ev.beam && !ev.rest) x.push(`<beam number="1">${ev.beam}</beam>`);
          const nots = [];
          if (tie === 'stop' || tie === 'both') nots.push('<tied type="stop"/>');
          if (tie === 'start' || tie === 'both') nots.push('<tied type="start"/>');
          if (ni === 0 && ev.slur) for (const s of [].concat(ev.slur)) nots.push(`<slur type="${s}" number="1"${s === 'start' ? (v.staff === 1 ? ' placement="above"' : ' placement="below"') : ''}/>`);
          if (ni === 0 && ev.tuplet) nots.push(`<tuplet type="${ev.tuplet}" bracket="no"/>`);
          const f = ev.f?.[ni];
          if (f) {
            const placement = ev.placement === null ? '' : ` placement="${ev.placement ?? (v.staff === 1 ? 'above' : 'below')}"`;
            nots.push(`<technical><fingering${placement}>${f}</fingering></technical>`);
          }
          if (ni === 0 && ev.fermata) nots.push(`<fermata type="${v.staff === 1 ? 'upright' : 'inverted'}"/>`);
          if (nots.length) x.push(`<notations>${nots.join('')}</notations>`);
          const idAttr = withIds ? ` id="n${++idCounter}"` : '';
          parts.push(`<note${idAttr}>${x.join('')}</note>`);
        });
        if (!ev.grace) total += ev.d;
      }
      if (total !== measureLen) throw new Error(`measure ${m.number} staff ${v.staff} voice ${v.voice}: duration ${total} != ${measureLen}`);
      if (vi < m.voices.length - 1) parts.push(`<backup><duration>${total}</duration></backup>`);
    });
    if (m.final) parts.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
    return `  <measure number="${m.number}">\n    ${parts.join('\n    ')}\n  </measure>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>${title}</work-title></work>
  <identification><creator type="composer">digitus2 spike (generated)</creator><encoding><software>digitus2 gen-fixtures.mjs</software></encoding></identification>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name>
      <score-instrument id="P1-I1"><instrument-name>Piano</instrument-name></score-instrument>
      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
${xmlMeasures.join('\n')}
  </part>
</score-partwise>
`;
}

const tempoDir = (bpm) => `<direction placement="above"><direction-type><metronome parentheses="no"><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${bpm}"/></direction>`;
const dynDir = (d) => `<direction placement="below"><direction-type><dynamics><${d}/></dynamics></direction-type><staff>1</staff></direction>`;

// ---------- short two-staff piece (hand-written) ----------
const R = (number, rh, lh, extra = {}) => ({ number, voices: [...rh, { staff: 2, voice: 5, events: lh }], ...extra });
const short = [
  R(1, [{ staff: 1, voice: 1, events: [
    { d: 12, n: ['G4'], f: [1], slur: 'start' },
    { d: 6, n: ['A4'], f: [2], beam: 'begin' },
    { d: 6, n: ['B4'], f: [3], beam: 'end' },
    { d: 12, n: ['C5'], f: [4] },
    { d: 12, n: ['D5'], f: [5], slur: 'stop' }] }],
  [{ d: 48, n: ['G2', 'B2', 'D3'], f: [5, 3, 1], tie: ['start', 'start', 'start'] }],
  { attributes: { fifths: 1, time: [4, 4] }, directions: [tempoDir(96), dynDir('p')] }),
  R(2, [{ staff: 1, voice: 1, events: [
    { grace: { slash: true }, n: ['C5'], f: [5] },
    { d: 12, n: ['B4'], f: [4], slur: 'start' },
    { d: 12, n: ['A4'], f: [3], slur: 'stop' },
    { d: 24, n: ['D4', 'F#4', 'A4'], f: [1, 3, 5] }] }],
  [{ d: 24, n: ['G2', 'B2', 'D3'], f: [null, null, null], tie: ['stop', 'stop', 'stop'] },
   { d: 24, n: ['D2', 'A2', 'C3'], f: [5, 2, 1] }]),
  R(3, [{ staff: 1, voice: 1, events: [
    { d: 12, n: ['B4'], f: [2], slur: 'start', stem: 'up' },
    { d: 12, n: ['C5'], f: [3], stem: 'up' },
    { d: 12, n: ['D5'], f: [4], stem: 'up' },
    { d: 12, n: ['E5'], f: [5], slur: 'stop', stem: 'up' }] },
  { staff: 1, voice: 2, events: [
    { d: 24, n: ['G4'], f: [1], stem: 'down', placement: 'below' },
    { d: 24, n: ['G4'], f: [1], stem: 'down', placement: 'below' }] }],
  [{ d: 18, n: ['E3'], f: [1] }, { d: 6, n: ['D3'], f: [2] }, { d: 24, n: ['C3'], f: [3] }]),
  R(4, [{ staff: 1, voice: 1, events: [
    { d: 4, n: ['D5'], f: [5], tuplet: 'start', tm: [3, 2], beam: 'begin', slur: 'start' },
    { d: 4, n: ['C5'], f: [4], tm: [3, 2], beam: 'continue' },
    { d: 4, n: ['B4'], f: [3], tuplet: 'stop', tm: [3, 2], beam: 'end' },
    { d: 12, n: ['A4'], f: [2], slur: 'stop' },
    { d: 24, n: ['F#4', 'A4', 'D5'], f: [1, 2, 5] }] }],
  [{ d: 12, n: ['D2'], f: [5] }, { d: 12, n: ['A2'], f: [2] }, { d: 24, n: ['D3'], f: [1] }]),
  R(5, [{ staff: 1, voice: 1, events: [
    { d: 24, n: ['B4'], f: [3] },
    { d: 24, n: ['D5'], f: [5], tie: ['start'] }] }],
  [{ d: 48, n: ['G2', 'G3'], f: [5, 1] }]),
  R(6, [{ staff: 1, voice: 1, events: [
    { d: 12, n: ['D5'], f: [null], tie: ['stop'] },
    { d: 6, n: ['C5'], f: [4], beam: 'begin', slur: 'start' },
    { d: 6, n: ['B4'], f: [3], beam: 'end' },
    { grace: { slash: false }, n: ['B4'], f: [3] },
    { d: 12, n: ['A4'], f: [2] },
    { d: 12, n: ['G4'], f: [1], slur: 'stop' }] }],
  [{ d: 24, n: ['C3', 'E3', 'G3'], f: [5, 3, 1] }, { d: 24, n: ['A2', 'C3', 'E3'], f: [5, 3, 1] }]),
  R(7, [{ staff: 1, voice: 1, events: [
    { d: 6, n: ['A4'], f: [1], beam: 'begin', slur: 'start', placement: null },
    { d: 6, n: ['B4'], f: [2], beam: 'continue', placement: null },
    { d: 6, n: ['C#5'], f: [3], beam: 'continue', placement: null },
    { d: 6, n: ['D5'], f: [1], beam: 'end', slur: 'stop', placement: null },
    { d: 12, n: ['E5'], f: [2], slur: 'start', placement: null },
    { d: 12, n: ['F#5'], f: [3], slur: 'stop', placement: null }] }],
  [{ d: 24, n: ['D3', 'F#3', 'C4'], f: [5, 3, 1], placement: null }, { d: 12, n: ['D3'], f: [5], placement: null }, { d: 12, rest: true }]),
  R(8, [{ staff: 1, voice: 1, events: [
    { d: 48, n: ['G4', 'B4', 'D5', 'G5'], f: [1, 2, 3, 5], fermata: true, placement: null }] }],
  [{ d: 48, n: ['G2', 'G3'], f: [5, 1], fermata: true, placement: null }], { final: true }),
];
const shortXml = writeScore({ title: 'Digitus Spike Etude (short)', measures: short, withIds: true });

// ---------- long generated piece (~120 measures) ----------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20261013);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
// diatonic index -> pitch name in key (deg 0 = tonic in octave tonicOct)
function degToName(deg, tonicStepIdx, tonicOct, fifths) {
  const abs = tonicStepIdx + deg;
  const step = STEPS[((abs % 7) + 7) % 7];
  const oct = tonicOct + Math.floor(abs / 7);
  const alter = keyAlter(fifths, step);
  return step + (alter === 1 ? '#' : alter === -1 ? 'b' : '') + oct;
}
const N_MEASURES = 120;
const long = [];
let carryTie = null; // RH tie carried into next measure
for (let i = 0; i < N_MEASURES; i++) {
  const num = i + 1;
  const inG = num > 60;
  const fifths = inG ? 1 : 0;
  const tonicStep = inG ? 4 : 0; // G or C
  const threeFour = num >= 97 && num <= 104;
  const len = threeFour ? 36 : 48;
  const chordRoots = [0, 5, 3, 4]; // I vi IV V
  const root = chordRoots[i % 4];
  const triad = [root, root + 2, root + 4];
  const name = (deg, octShift = 0) => degToName(deg, tonicStep, 4 + octShift, fifths);
  const attributes = i === 0 ? { fifths: 0, time: [4, 4] } : num === 61 ? { fifths: 1 } : num === 97 ? { time: [3, 4] } : num === 105 ? { time: [4, 4] } : undefined;
  const directions = i === 0 ? [tempoDir(100), dynDir('mf')] : num === 61 ? [tempoDir(88)] : [];
  // ---- RH
  const rh = [];
  const variant = threeFour ? (i % 2 ? 'E3' : 'A3') : ['A', 'B', 'C', 'D'][Math.floor(i / 2) % 4];
  let cursorDeg = pick(triad) + (rnd() < 0.5 ? 0 : 3);
  const walk = () => { cursorDeg += pick([-2, -1, -1, 1, 1, 2]); cursorDeg = Math.max(-2, Math.min(10, cursorDeg)); return cursorDeg; };
  let thumb = cursorDeg - 2;
  const fingerFor = (deg) => { let f = deg - thumb + 1; if (f < 1 || f > 5) { thumb = f < 1 ? deg : deg - 4; f = deg - thumb + 1; } return f; };
  let used = 0;
  if (carryTie) { rh.push({ d: carryTie.d, n: [carryTie.name], f: [null], tie: ['stop'] }); used = carryTie.d; }
  carryTie = null;
  const chromatic = num % 12 === 5 && !threeFour; // a sharp then the natural again in the same measure
  const fillQuarters = (remaining) => { for (let r = remaining; r > 0; r -= 12) { const dd = walk(); rh.push({ d: 12, n: [name(dd)], f: [fingerFor(dd)] }); } };
  if (variant === 'A' || variant === 'A3') {
    const count = (len - used) / 6;
    for (let k = 0; k < count; k++) {
      const deg = walk();
      let nm = name(deg);
      if (chromatic && k === 1 && /^[A-G]\d$/.test(nm)) nm = nm[0] + '#' + nm.slice(1);
      const g = k % 4;
      const last = k === count - 1;
      const single = last && g === 0;
      rh.push({ d: 6, n: [nm], f: [fingerFor(deg)],
        beam: single ? undefined : g === 0 ? 'begin' : (g === 3 || last) ? 'end' : 'continue',
        slur: single ? undefined : g === 0 ? 'start' : (g === 3 || last) ? 'stop' : undefined });
    }
  } else if (variant === 'B') {
    if (num % 10 === 0 && used === 0) rh.push({ grace: { slash: true }, n: [name(cursorDeg + 1)], f: [3] });
    const quarters = (len - used) / 12;
    for (let k = 0; k < quarters; k++) {
      if (k === quarters - 2) rh.push({ d: 12, n: [name(triad[0]), name(triad[1]), name(triad[2])], f: [1, 3, 5] });
      else { const deg = walk(); rh.push({ d: 12, n: [name(deg)], f: [fingerFor(deg)] }); }
    }
  } else if (variant === 'C' || variant === 'E3') {
    if (used === 0) {
      const d1 = walk(); rh.push({ d: 18, n: [name(d1)], f: [fingerFor(d1)], slur: 'start' });
      const d2 = walk(); rh.push({ d: 6, n: [name(d2)], f: [fingerFor(d2)], slur: 'stop' });
      used = 24;
    }
    const remaining = len - used;
    const tieOut = num % 8 === 0 && num < N_MEASURES && !(num + 1 >= 97 && num + 1 <= 104);
    if (remaining === 24 || remaining === 12) {
      const d3 = walk();
      rh.push({ d: remaining, n: [name(d3)], f: [fingerFor(d3)], tie: tieOut ? ['start'] : undefined });
      if (tieOut) carryTie = { d: remaining, name: name(d3) };
    } else fillQuarters(remaining);
  } else { // D: triplet + quarter + half
    const remaining = len - used;
    if (remaining === 48) {
      for (let k = 0; k < 3; k++) { const deg = walk(); rh.push({ d: 4, n: [name(deg)], f: [fingerFor(deg)], tm: [3, 2], tuplet: k === 0 ? 'start' : k === 2 ? 'stop' : undefined, beam: k === 0 ? 'begin' : k === 2 ? 'end' : 'continue' }); }
      const q = walk(); rh.push({ d: 12, n: [name(q)], f: [fingerFor(q)] });
      const h = walk(); rh.push({ d: 24, n: [name(h)], f: [fingerFor(h)] });
    } else fillQuarters(remaining);
  }
  // ---- LH
  const lh = [];
  const alberti = Math.floor(i / 4) % 2 === 0;
  if (alberti) {
    const pat = [triad[0], triad[2], triad[1], triad[2]];
    const fing = [5, 1, 3, 1];
    const count = len / 6;
    for (let k = 0; k < count; k++) {
      const g = k % 4; const last = k === count - 1;
      lh.push({ d: 6, n: [name(pat[g] - 7, -1)], f: [fing[g]], beam: g === 0 ? 'begin' : (g === 3 || last) ? 'end' : 'continue', slur: g === 0 ? 'start' : (g === 3 || last) ? 'stop' : undefined });
    }
  } else {
    const chord = [name(triad[0] - 7, -1), name(triad[1] - 7, -1), name(triad[2] - 7, -1)];
    if (len === 48) { lh.push({ d: 24, n: chord, f: [5, 3, 1] }); lh.push({ d: 24, n: chord, f: [5, 3, 1] }); }
    else lh.push({ d: 36, n: chord, f: [5, 3, 1] });
  }
  long.push({ number: num, attributes, directions, voices: [{ staff: 1, voice: 1, events: rh }, { staff: 2, voice: 5, events: lh }], final: num === N_MEASURES });
}
const longXml = writeScore({ title: 'Digitus Spike Etude (long, generated)', measures: long, withIds: false });

// ---------- MXL (compressed MusicXML) ----------
function mxl(xml) {
  return zipSync({
    mimetype: [strToU8('application/vnd.recordare.musicxml'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'),
    'score.musicxml': strToU8(xml),
  });
}

// ---------- MIDI with a tempo map (for the MIDI parser comparison) ----------
// Conductor track (96 bpm, 60 bpm at bar 5, 120 bpm at bar 7) + RH track (ch 0) + LH track (ch 1).
function tempoMapMidi() {
  const PPQ = 480;
  const bar = 4 * PPQ;
  const conductor = [
    { deltaTime: 0, meta: true, type: 'trackName', text: 'Conductor' },
    { deltaTime: 0, meta: true, type: 'timeSignature', numerator: 4, denominator: 4, metronome: 24, thirtyseconds: 8 },
    { deltaTime: 0, meta: true, type: 'setTempo', microsecondsPerBeat: Math.round(60e6 / 96) },
    { deltaTime: 4 * bar, meta: true, type: 'setTempo', microsecondsPerBeat: Math.round(60e6 / 60) },
    { deltaTime: 2 * bar, meta: true, type: 'setTempo', microsecondsPerBeat: Math.round(60e6 / 120) },
    { deltaTime: 0, meta: true, type: 'endOfTrack' },
  ];
  const track = (channel, notes) => {
    const evs = [];
    for (const [tick, dur, midi] of notes) { evs.push({ t: tick, on: true, midi }); evs.push({ t: tick + dur, on: false, midi }); }
    evs.sort((a, b) => a.t - b.t || (a.on === b.on ? 0 : a.on ? 1 : -1));
    let last = 0;
    const evOut = [{ deltaTime: 0, meta: true, type: 'trackName', text: channel === 0 ? 'RH' : 'LH' }];
    for (const e of evs) { evOut.push({ deltaTime: e.t - last, channel, type: e.on ? 'noteOn' : 'noteOff', noteNumber: e.midi, velocity: e.on ? 80 : 0 }); last = e.t; }
    evOut.push({ deltaTime: 0, meta: true, type: 'endOfTrack' });
    return evOut;
  };
  const rh = []; const lh = [];
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  for (let b = 0; b < 8 * 4; b++) rh.push([b * PPQ, PPQ - 10, scale[b % 8]]);
  for (let m = 0; m < 8; m++) lh.push([m * bar, bar - 10, m % 2 ? 55 : 48]);
  return new Uint8Array(midiFile.writeMidi({ header: { format: 1, numTracks: 3, ticksPerBeat: PPQ }, tracks: [conductor, track(0, rh), track(1, lh)] }));
}

writeFileSync(out('short-piano.musicxml'), shortXml);
writeFileSync(out('long-120.musicxml'), longXml);
writeFileSync(out('short-piano.mxl'), mxl(shortXml));
writeFileSync(out('long-120.mxl'), mxl(longXml));
writeFileSync(out('tempo-map.mid'), tempoMapMidi());
const count = (x) => (x.match(/<note[ >]/g) ?? []).length;
console.log('short notes:', count(shortXml), 'bytes', shortXml.length, '| long notes:', count(longXml), 'bytes', longXml.length);
