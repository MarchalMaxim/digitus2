// THROWAWAY spike: MIDI parsers compared on a 3-track file with a tempo map (96 -> 60 -> 120 bpm).
// Expected (from gen-fixtures.mjs): bar 5 starts at 10.0 s, bar 7 at 18.0 s, last RH note (bar 8 beat 4) at 21.5 s.
import { FIXTURES, now, params, runBench, stats, r1, log } from '../bench/util';

export interface MidiNote { midi: number; onsetSec: number; durationSec: number; velocity: number; track: number; channel: number }
export interface TempoPoint { tick: number; usPerQuarter: number }

/** ticks -> seconds through a tempo map (shared by the midi-file and midi-json-parser paths) */
export function makeTickToSec(ppq: number, tempos: TempoPoint[]) {
  const t = [...tempos].sort((a, b) => a.tick - b.tick);
  if (!t.length || t[0].tick > 0) t.unshift({ tick: 0, usPerQuarter: 500_000 });
  const acc = [0];
  for (let i = 1; i < t.length; i++) acc[i] = acc[i - 1] + ((t[i].tick - t[i - 1].tick) / ppq) * (t[i - 1].usPerQuarter / 1e6);
  return (tick: number) => { let i = t.length - 1; while (i > 0 && t[i].tick > tick) i--; return acc[i] + ((tick - t[i].tick) / ppq) * (t[i].usPerQuarter / 1e6); };
}

const EXPECT = { bar5: 10, bar7: 18, lastRh: 21.5 };
const check = (notes: MidiNote[]) => {
  // RH = MIDI channel 0 in the fixture. (Track indices differ: @tonejs/midi drops the note-less conductor track.)
  const rh = notes.filter((n) => n.channel === 0).sort((a, b) => a.onsetSec - b.onsetSec);
  const at = (tick: number) => rh.find((n) => Math.abs(n.onsetSec - tick) < 1e-3);
  return { notes: notes.length, bar5: r1(rh[16]?.onsetSec ?? NaN), bar7: r1(rh[24]?.onsetSec ?? NaN), lastRh: r1(rh.at(-1)?.onsetSec ?? NaN), ok: !!at(EXPECT.bar5) && !!at(EXPECT.bar7) && Math.abs((rh.at(-1)?.onsetSec ?? 0) - EXPECT.lastRh) < 1e-3 };
};

async function bench() {
  const res: Record<string, unknown> = {};
  const RUNS = Number(params.get('runs') ?? 20);
  const buf = await (await fetch(FIXTURES.midi)).arrayBuffer();
  res.fileBytes = buf.byteLength;

  // 1) @tonejs/midi: tempo map applied for us (note.time / note.duration in seconds)
  {
    const { Midi } = await import('@tonejs/midi');
    const t: number[] = []; let midi!: InstanceType<typeof Midi>;
    for (let i = 0; i < RUNS; i++) { const t0 = now(); midi = new Midi(buf); t.push(now() - t0); }
    const notes: MidiNote[] = midi.tracks.flatMap((tr, ti) => tr.notes.map((n) => ({ midi: n.midi, onsetSec: n.time, durationSec: n.duration, velocity: n.velocity, track: ti, channel: tr.channel })));
    res['@tonejs/midi'] = { ms: stats(t), ...check(notes), tempos: midi.header.tempos.map((x) => ({ ticks: x.ticks, bpm: r1(x.bpm), time: r1(x.time ?? NaN) })), ppq: midi.header.ppq, api: 'new Midi(ArrayBuffer); header.tempos/timeSignatures; header.ticksToSeconds(); track.notes[{midi,time,duration,velocity}]', types: 'bundled .d.ts (classes)', tracks: midi.tracks.map((x) => x.name) };
  }
  // 2) midi-file: raw events; we apply the tempo map (10 lines above)
  {
    const { parseMidi } = await import('midi-file');
    const t: number[] = []; let data!: ReturnType<typeof parseMidi>;
    for (let i = 0; i < RUNS; i++) { const t0 = now(); data = parseMidi(new Uint8Array(buf)); t.push(now() - t0); }
    const ppq = data.header.ticksPerBeat ?? 480;
    const tempos: TempoPoint[] = [];
    const notes: MidiNote[] = [];
    data.tracks.forEach((track, ti) => {
      let tick = 0; const open = new Map<string, { tick: number; vel: number }>();
      for (const ev of track) {
        tick += ev.deltaTime;
        if (ev.type === 'setTempo') tempos.push({ tick, usPerQuarter: ev.microsecondsPerBeat });
        else if (ev.type === 'noteOn' && ev.velocity > 0) open.set(ev.channel + ':' + ev.noteNumber, { tick, vel: ev.velocity });
        else if (ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) {
          const k = ev.channel + ':' + ev.noteNumber; const o = open.get(k); if (!o) continue; open.delete(k);
          notes.push({ midi: ev.noteNumber, onsetSec: o.tick, durationSec: tick - o.tick, velocity: o.vel / 127, track: ti, channel: ev.channel });
        }
      }
    });
    const toSec = makeTickToSec(ppq, tempos);
    for (const n of notes) { const end = toSec(n.onsetSec + n.durationSec); n.onsetSec = toSec(n.onsetSec); n.durationSec = end - n.onsetSec; }
    res['midi-file'] = { ms: stats(t), ...check(notes), tempos, ppq, api: 'parseMidi(Uint8Array) -> {header, tracks[][]} raw delta-time events; writeMidi(); tempo map is yours', types: 'bundled index.d.ts (event unions)' };
  }
  // 3) midi-json-parser: parses in a Web Worker (async), raw events; same tempo-map code
  {
    const { parseArrayBuffer } = await import('midi-json-parser');
    const t: number[] = []; let json!: Awaited<ReturnType<typeof parseArrayBuffer>>;
    for (let i = 0; i < RUNS; i++) { const t0 = now(); json = await parseArrayBuffer(buf.slice(0)); t.push(now() - t0); }
    const ppq = json.division;
    const tempos: TempoPoint[] = []; const notes: MidiNote[] = [];
    json.tracks.forEach((track, ti) => {
      let tick = 0; const open = new Map<string, { tick: number; vel: number }>();
      for (const ev of track as Array<Record<string, unknown> & { delta: number }>) {
        tick += ev.delta;
        if ('setTempo' in ev) tempos.push({ tick, usPerQuarter: (ev.setTempo as { microsecondsPerQuarter: number }).microsecondsPerQuarter });
        else if ('noteOn' in ev) { const on = ev.noteOn as { noteNumber: number; velocity: number }; if (on.velocity > 0) open.set(ev.channel + ':' + on.noteNumber, { tick, vel: on.velocity }); }
        else if ('noteOff' in ev) { const off = ev.noteOff as { noteNumber: number }; const k = ev.channel + ':' + off.noteNumber; const o = open.get(k); if (!o) continue; open.delete(k); notes.push({ midi: off.noteNumber, onsetSec: o.tick, durationSec: tick - o.tick, velocity: o.vel / 127, track: ti, channel: ev.channel as number }); }
      }
    });
    const toSec = makeTickToSec(ppq, tempos);
    for (const n of notes) { const end = toSec(n.onsetSec + n.durationSec); n.onsetSec = toSec(n.onsetSec); n.durationSec = end - n.onsetSec; }
    res['midi-json-parser'] = { ms: stats(t), ...check(notes), tempos, ppq, api: 'await parseArrayBuffer(buf) (worker, async) -> {division, format, tracks[][]} with {delta, noteOn:{...}} shape', types: 'bundled (interfaces via midi-json-parser-worker)' };
  }
  return res;
}

runBench(bench);
log('see window.__bench');
