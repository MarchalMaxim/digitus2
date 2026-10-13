// THROWAWAY spike snippet: MIDI file -> notes with ticks AND seconds (tempo map applied), using midi-file.
import { parseMidi } from 'midi-file';

export interface MidiNote { midi: number; velocity: number; channel: number; track: number; startTick: number; endTick: number; onsetSec: number; durationSec: number }

export function midiToNotes(bytes: Uint8Array) {
  const { header, tracks } = parseMidi(bytes);
  const ppq = header.ticksPerBeat ?? 480; // SMPTE-timed files (no ticksPerBeat) are rare; not handled here
  const tempos: { tick: number; usPerQuarter: number }[] = [];
  const notes: MidiNote[] = [];
  tracks.forEach((events, track) => {
    let tick = 0;
    const open = new Map<string, { tick: number; velocity: number }[]>(); // channel:note -> stack (overlapping same-pitch notes)
    for (const e of events) {
      tick += e.deltaTime;
      if (e.type === 'setTempo') tempos.push({ tick, usPerQuarter: e.microsecondsPerBeat });
      else if (e.type === 'noteOn' && e.velocity > 0) {
        const k = e.channel + ':' + e.noteNumber;
        open.set(k, [...(open.get(k) ?? []), { tick, velocity: e.velocity }]);
      } else if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) {
        const k = e.channel + ':' + e.noteNumber;
        const on = open.get(k)?.shift();
        if (on) notes.push({ midi: e.noteNumber, velocity: on.velocity, channel: e.channel, track, startTick: on.tick, endTick: tick, onsetSec: 0, durationSec: 0 });
      }
    }
  });
  // tempo map (format 1: tempo events live in the conductor track but apply to all tracks)
  tempos.sort((a, b) => a.tick - b.tick);
  if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, usPerQuarter: 500_000 });
  const acc = [0];
  for (let i = 1; i < tempos.length; i++) acc[i] = acc[i - 1] + ((tempos[i].tick - tempos[i - 1].tick) / ppq) * (tempos[i - 1].usPerQuarter / 1e6);
  const sec = (t: number) => { let i = tempos.length - 1; while (i > 0 && tempos[i].tick > t) i--; return acc[i] + ((t - tempos[i].tick) / ppq) * (tempos[i].usPerQuarter / 1e6); };
  for (const n of notes) { n.onsetSec = sec(n.startTick); n.durationSec = sec(n.endTick) - n.onsetSec; }
  return { ppq, tempos, notes: notes.sort((a, b) => a.startTick - b.startTick || a.midi - b.midi) };
}
