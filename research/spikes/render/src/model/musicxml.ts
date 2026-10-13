// THROWAWAY spike code: renderer-independent MusicXML -> score model.
// Handles: parts, staves (hand), voices, backup/forward, chords, ties (merged), grace notes,
// tuplets (via divisions), divisions/tempo/time-signature changes, fingering (technical/fingering).
import { type XNode, kid, kids, txt } from './xnode';

export type Hand = 'R' | 'L';
export interface ScoreNote {
  id: string;              // stable id: MusicXML @id if present, else positional id
  docIndex: number;        // index of the <note> element in document order (rests included) -> used to inject ids
  partId: string;
  measureIndex: number;    // 0-based index in the part
  measureNumber: string;
  staff: number;           // 1-based
  hand: Hand;
  voice: string;
  onsetQ: number;          // absolute onset in quarter notes
  measureOnsetQ: number;   // onset relative to measure start
  durationQ: number;       // sounding duration incl. merged ties (0 for grace notes)
  notatedQ: number;        // notated duration of this <note> element (before tie merging)
  onsetSec: number;
  durationSec: number;
  midi: number;
  step: string; alter: number; octave: number;
  grace: boolean;
  chordId: string;         // id of the first note of the chord this note belongs to
  tiedIds: string[];       // ids of tie-continuation notes merged into this note
  tiedTo?: string;         // for continuation notes: id of the head note
  fingering?: string;      // first non-substitution <fingering> text
  fingeringPlacement?: string;
}
export interface MeasureInfo { index: number; number: string; startQ: number; lengthQ: number; startSec: number; beats: number; beatType: number; fifths: number; }
export interface TempoEvent { q: number; bpm: number; }
export interface ScoreModel {
  title?: string;
  parts: { id: string; name: string; staves: number }[];
  measures: MeasureInfo[];
  tempos: TempoEvent[];
  notes: ScoreNote[];      // playable notes (tie continuations removed), sorted by onset
  allNotes: ScoreNote[];   // every notated note incl. tie continuations (for visual mapping)
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const EPS = 1e-6;

export function buildScore(root: XNode): ScoreModel {
  if (root.name !== 'score-partwise') throw new Error('only score-partwise supported in the spike');
  const title = txt(kid(root, 'work'), 'work-title') ?? txt(root, 'movement-title');
  const partNames = new Map(kids(kid(root, 'part-list'), 'score-part').map((sp) => [sp.attrs.id, txt(sp, 'part-name') ?? sp.attrs.id]));
  const parts: ScoreModel['parts'] = [];
  const tempos: TempoEvent[] = [];
  const allNotes: ScoreNote[] = [];
  let measures: MeasureInfo[] = [];

  let docIndex = -1;
  for (const part of kids(root, 'part')) {
    const partId = part.attrs.id;
    let divisions = 1, staves = 1, beats = 4, beatType = 4, fifths = 0;
    let measureStart = 0;
    const partMeasures: MeasureInfo[] = [];
    const openTies = new Map<string, ScoreNote>(); // key staff|midi -> head note
    kids(part, 'measure').forEach((m, mi) => {
      let pos = 0, maxPos = 0, lastOnset = 0;
      let lastChordId = '';
      const seqPerVoice = new Map<string, number>();
      const pendingGrace: ScoreNote[] = [];
      for (const el of m.children) {
        switch (el.name) {
          case 'attributes': {
            const d = txt(el, 'divisions'); if (d) divisions = Number(d);
            const s = txt(el, 'staves'); if (s) staves = Number(s);
            const t = kid(el, 'time'); if (t) { beats = Number(txt(t, 'beats')); beatType = Number(txt(t, 'beat-type')); }
            const k = kid(el, 'key'); if (k && txt(k, 'fifths') !== undefined) fifths = Number(txt(k, 'fifths'));
            break;
          }
          case 'backup': pos -= Number(txt(el, 'duration')) / divisions; break;
          case 'forward': pos += Number(txt(el, 'duration')) / divisions; maxPos = Math.max(maxPos, pos); break;
          case 'sound':
          case 'direction': {
            const snd = el.name === 'sound' ? el : kid(el, 'sound');
            if (snd?.attrs.tempo) tempos.push({ q: measureStart + pos, bpm: Number(snd.attrs.tempo) });
            break;
          }
          case 'note': {
            docIndex++;
            const isChord = !!kid(el, 'chord');
            const grace = kid(el, 'grace');
            const durQ = grace ? 0 : Number(txt(el, 'duration') ?? 0) / divisions;
            const onset = isChord ? lastOnset : pos;
            const staff = Number(txt(el, 'staff') ?? 1);
            const voice = txt(el, 'voice') ?? '1';
            const vkey = staff + '/' + voice;
            const seq = (seqPerVoice.get(vkey) ?? 0) + 1;
            seqPerVoice.set(vkey, seq);
            const pitch = kid(el, 'pitch');
            if (!isChord) { lastOnset = pos; if (!grace) pos += durQ; maxPos = Math.max(maxPos, pos); }
            if (!pitch || kid(el, 'cue')) break; // rests / unpitched / cue notes do not sound
            const step = txt(pitch, 'step')!;
            const alter = Number(txt(pitch, 'alter') ?? 0);
            const octave = Number(txt(pitch, 'octave'));
            const midi = 12 * (octave + 1) + STEP[step] + Math.round(alter);
            const id = el.attrs.id ?? `${partId}-m${mi}-s${staff}-v${voice}-${seq}`; // CSS/XML-id safe
            const techn = kid(kid(el, 'notations'), 'technical');
            const fing = kids(techn, 'fingering').find((f) => f.attrs.substitution !== 'yes') ?? kid(techn, 'fingering');
            const note: ScoreNote = {
              id, docIndex, partId, measureIndex: mi, measureNumber: m.attrs.number ?? String(mi + 1), staff,
              hand: staves >= 2 ? (staff === 1 ? 'R' : 'L') : 'R', voice,
              onsetQ: measureStart + onset, measureOnsetQ: onset, durationQ: durQ, notatedQ: durQ, onsetSec: 0, durationSec: 0,
              midi, step, alter, octave, grace: !!grace, chordId: isChord ? lastChordId : id, tiedIds: [],
              fingering: fing?.text.trim() || undefined, fingeringPlacement: fing?.attrs.placement,
            };
            if (!isChord) lastChordId = id;
            allNotes.push(note);
            if (grace) { pendingGrace.push(note); break; }
            for (const g of pendingGrace.splice(0)) { g.onsetQ = note.onsetQ; g.measureOnsetQ = note.measureOnsetQ; }
            const tieTypes = kids(el, 'tie').map((t) => t.attrs.type);
            const key = staff + '|' + midi;
            if (tieTypes.includes('stop')) {
              const head = openTies.get(key);
              if (head && Math.abs(head.onsetQ + head.durationQ - note.onsetQ) < EPS) {
                head.durationQ += note.durationQ; head.tiedIds.push(note.id); note.tiedTo = head.id;
                if (!tieTypes.includes('start')) openTies.delete(key);
                break;
              }
            }
            if (tieTypes.includes('start')) openTies.set(key, note);
            break;
          }
        }
      }
      const lengthQ = Math.max(maxPos, EPS);
      partMeasures.push({ index: mi, number: m.attrs.number ?? String(mi + 1), startQ: measureStart, lengthQ, startSec: 0, beats, beatType, fifths });
      measureStart += lengthQ;
    });
    parts.push({ id: partId, name: partNames.get(partId) ?? partId, staves });
    if (measures.length === 0) measures = partMeasures;
  }

  // tempo map -> seconds
  tempos.sort((a, b) => a.q - b.q);
  if (!tempos.length || tempos[0].q > EPS) tempos.unshift({ q: 0, bpm: tempos[0]?.bpm ?? 120 });
  const toSec = makeQuarterToSeconds(tempos);
  for (const n of allNotes) { n.onsetSec = toSec(n.onsetQ); n.durationSec = toSec(n.onsetQ + n.durationQ) - n.onsetSec; }
  // grace notes: sound just before the principal note (acciaccatura-style), 70 ms each
  const graces = allNotes.filter((n) => n.grace);
  for (const g of graces) {
    const group = graces.filter((o) => o.staff === g.staff && o.voice === g.voice && Math.abs(o.onsetQ - g.onsetQ) < EPS);
    const k = group.length - group.indexOf(g);
    g.onsetSec = Math.max(0, g.onsetSec - 0.07 * k);
    g.durationSec = 0.07;
  }
  for (const mm of measures) mm.startSec = toSec(mm.startQ);
  const notes = allNotes.filter((n) => !n.tiedTo).sort((a, b) => a.onsetSec - b.onsetSec || a.midi - b.midi);
  return { title, parts, measures, tempos, notes, allNotes };
}

export function makeQuarterToSeconds(tempos: TempoEvent[]) {
  const acc: number[] = [0];
  for (let i = 1; i < tempos.length; i++) acc[i] = acc[i - 1] + ((tempos[i].q - tempos[i - 1].q) * 60) / tempos[i - 1].bpm;
  return (q: number) => {
    let i = tempos.length - 1;
    while (i > 0 && tempos[i].q > q + EPS) i--;
    return acc[i] + ((q - tempos[i].q) * 60) / tempos[i].bpm;
  };
}

/** Write our stable note ids into the MusicXML (as <note id="...">) so renderers that keep MusicXML ids
 *  (Verovio does; OSMD does not) emit SVG elements whose id === ScoreNote.id. String-based, O(n). */
export function injectNoteIds(xml: string, model: ScoreModel): string {
  const byIndex = new Map(model.allNotes.map((n) => [n.docIndex, n.id]));
  let i = -1;
  return xml.replace(/<note(\s[^>]*)?>/g, (m, attrs: string | undefined) => {
    i++;
    const id = byIndex.get(i);
    if (!id || (attrs && /\sid\s*=/.test(attrs))) return m;
    return '<note id="' + id + '"' + (attrs ?? '') + '>';
  });
}
