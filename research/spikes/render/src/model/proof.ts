// ~50-line proof: MusicXML / .mxl -> notes with onset (quarters + seconds), hand from staff, chords,
// merged ties, grace flag and fingering. Runs unchanged in Node, Web Workers and the browser.
import { DOMParser } from '@xmldom/xmldom';
import { unzipSync, strFromU8 } from 'fflate';

export interface Note { midi: number; onsetQ: number; onsetSec: number; durQ: number; hand: 'R' | 'L'; staff: number; voice: string; chord: boolean; grace: boolean; finger?: string }
const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const kid = (e: Element, n: string) => Array.from(e.childNodes).find((c) => c.nodeName === n) as Element | undefined;
const val = (e: Element | undefined, n: string) => (e && kid(e, n)?.textContent?.trim()) ?? undefined;

export function unpack(bytes: Uint8Array): string {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return strFromU8(bytes).replace(/^﻿/, ''); // plain XML
  const zip = unzipSync(bytes);
  const root = /full-path="([^"]+)"/.exec(strFromU8(zip['META-INF/container.xml'] ?? new Uint8Array()))?.[1]
    ?? Object.keys(zip).find((n) => !n.startsWith('META-INF') && /\.(musicxml|xml)$/.test(n))!;
  return strFromU8(zip[root]);
}

export function readNotes(xml: string): Note[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document;
  const notes: Note[] = [], tempos: [number, number][] = [], open = new Map<string, Note>();
  for (const part of Array.from(doc.getElementsByTagName('part'))) {
    let div = 1, staves = 1, start = 0;
    for (const m of Array.from(part.getElementsByTagName('measure'))) {
      let pos = 0, max = 0, last = 0;
      for (const el of Array.from(m.childNodes).filter((n): n is Element => n.nodeType === 1)) {
        if (el.nodeName === 'attributes') { div = Number(val(el, 'divisions') ?? div); staves = Number(val(el, 'staves') ?? staves); }
        else if (el.nodeName === 'backup') pos -= Number(val(el, 'duration')) / div;
        else if (el.nodeName === 'forward') { pos += Number(val(el, 'duration')) / div; max = Math.max(max, pos); }
        else if (el.nodeName === 'direction' || el.nodeName === 'sound') {
          const t = (el.nodeName === 'sound' ? el : kid(el, 'sound'))?.getAttribute('tempo'); if (t) tempos.push([start + pos, Number(t)]);
        } else if (el.nodeName === 'note') {
          const chord = !!kid(el, 'chord'), grace = !!kid(el, 'grace'), dur = grace ? 0 : Number(val(el, 'duration') ?? 0) / div;
          const onset = chord ? last : pos;
          if (!chord) { last = pos; pos += dur; max = Math.max(max, pos); }
          const p = kid(el, 'pitch'); if (!p) continue; // rests, unpitched
          const staff = Number(val(el, 'staff') ?? 1), midi = 12 * (Number(val(p, 'octave')) + 1) + SEMI[val(p, 'step')!] + Number(val(p, 'alter') ?? 0);
          const ties = Array.from(el.getElementsByTagName('tie')).map((t) => t.getAttribute('type'));
          const head = open.get(staff + ':' + midi);
          if (ties.includes('stop') && head) { head.durQ += dur; if (!ties.includes('start')) open.delete(staff + ':' + midi); continue; } // merge tie
          const fing = Array.from(el.getElementsByTagName('fingering')).find((f) => f.getAttribute('substitution') !== 'yes');
          const n: Note = { midi, onsetQ: start + onset, onsetSec: 0, durQ: dur, staff, hand: staves > 1 && staff > 1 ? 'L' : 'R', voice: val(el, 'voice') ?? '1', chord, grace, finger: fing?.textContent?.trim() || undefined };
          notes.push(n);
          if (ties.includes('start')) open.set(staff + ':' + midi, n);
        }
      }
      start += max;
    }
  }
  const tm = tempos.length ? tempos.sort((a, b) => a[0] - b[0]) : [[0, 120] as [number, number]];
  if (tm[0][0] > 0) tm.unshift([0, tm[0][1]]); // tempo map: [quarter position, bpm]
  const sec = (q: number) => { let s = 0, i = 0; for (; i + 1 < tm.length && tm[i + 1][0] <= q; i++) s += ((tm[i + 1][0] - tm[i][0]) * 60) / tm[i][1]; return s + ((q - tm[i][0]) * 60) / tm[i][1]; };
  for (const n of notes) n.onsetSec = sec(n.onsetQ);
  return notes.sort((a, b) => a.onsetQ - b.onsetQ || a.midi - b.midi);
}
