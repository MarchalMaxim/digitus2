// THROWAWAY spike: MusicXML parsing options for the engine's own score model.
// For every candidate: parse time (short / long fixture), can it give us notes with onset, staff/hand,
// chord grouping, tie merging and fingering; .mxl support; DOM dependency (Web Worker friendliness).
import { FIXTURES, type FixtureName, fetchText, now, params, runBench, stats, r1, log } from '../bench/util';
import { fromDom, fromTxml, fromRgrove, fromFastXmlParser, fromXmldom, type XNode } from '../model/xml';
import { buildScore, type ScoreModel } from '../model/musicxml';
import { mxlToXml } from '../model/mxl';

type Probe = { notes: number; fingerings: number; onsetOfFirstRhNoteInM2: number | string; hand: string; extra?: Record<string, unknown> };
interface Candidate { name: string; run(xml: string): Promise<Probe> | Probe; worker: string; mxl: string; notes: string }

const probeModel = (m: ScoreModel): Probe => {
  const n = m.notes.find((x) => x.measureIndex === 1 && x.staff === 1 && !x.grace)!;
  return { notes: m.allNotes.length, fingerings: m.allNotes.filter((x) => x.fingering).length, onsetOfFirstRhNoteInM2: r1(n.onsetSec * 1000) + ' ms (q=' + n.onsetQ + ')', hand: n.hand, extra: { ties: m.allNotes.filter((x) => x.tiedIds.length).length, chords: new Set(m.allNotes.map((x) => x.chordId)).size } };
};
const viaXNode = (parse: (xml: string) => XNode) => (xml: string) => probeModel(buildScore(parse(xml)));

const candidates: Candidate[] = [
  { name: 'hand-rolled over DOMParser', run: viaXNode(fromDom), worker: 'no (DOMParser is main-thread only)', mxl: 'fflate (ours)', notes: 'our builder; zero deps' },
  { name: 'hand-rolled over txml', run: viaXNode(fromTxml), worker: 'yes', mxl: 'fflate (ours)', notes: 'our builder; txml does not decode entities (we do); DOCTYPE ok' },
  { name: 'hand-rolled over @rgrove/parse-xml', run: viaXNode(fromRgrove), worker: 'yes', mxl: 'fflate (ours)', notes: 'our builder; spec-compliant parser' },
  { name: 'hand-rolled over @xmldom/xmldom (M1 plan)', run: viaXNode(fromXmldom), worker: 'yes', mxl: 'fflate (ours)', notes: 'our builder; W3C DOM API + XMLSerializer (needed to write fingerings back into the document)' },
  { name: 'hand-rolled over fast-xml-parser', run: viaXNode(fromFastXmlParser), worker: 'yes', mxl: 'fflate (ours)', notes: 'our builder; needs preserveOrder:true (note/backup order)' },
  {
    name: 'musicxml-io (parse + getAllNotes)', worker: 'yes (browser build, no DOM)', mxl: 'built in (parseAuto, fflate)', notes: 'typed Score model, query + edit API, MIT',
    async run(xml) {
      const m = await import('musicxml-io');
      const score = m.parse(xml);
      const all = m.getAllNotes(score);
      const fing = all.filter((it) => it.note.notations?.some((n) => n.type === 'technical' && n.technical === 'fingering' && ((n as { text?: string }).text ?? n.fingering))).length;
      const div = m.getDivisions(score, { part: 0, measure: 1 }) ?? 1;
      const first = all.find((it) => it.measure.number === '2' && it.note.staff === 1 && !it.note.grace);
      return { notes: all.length, fingerings: fing, onsetOfFirstRhNoteInM2: first ? `position ${first.position} div (=${first.position / div} q); seconds via generatePlaybackTimeline()` : 'n/a', hand: 'staff ' + first?.note.staff, extra: { parts: m.getPartCount(score), measures: m.getMeasureCount(score), playbackTimelineEntries: (() => { try { return (m.generatePlaybackTimeline(score) as unknown as { notes?: unknown[] }).notes?.length ?? 'object'; } catch (e) { return 'ERR ' + String(e).slice(0, 80); } })() } };
    },
  },
  {
    name: 'musicxml-interfaces (parseScore)', worker: 'yes (string parser)', mxl: 'no (bring your own unzip)', notes: 'converts to timewise; AGPL-3.0 (!); unmaintained since 2022',
    async run(xml) {
      const m = await import('musicxml-interfaces');
      const score = m.parseScore(xml);
      type N = { pitch?: unknown; staff?: number; grace?: unknown; chord?: unknown; notations?: { technicals?: { fingering?: { finger?: number } }[] }[] };
      type Part = { notes?: N[] } & Record<string, unknown>;
      let notes = 0, fing = 0;
      for (const measure of score.measures) for (const partId of Object.keys(measure.parts)) {
        const part = measure.parts[partId] as unknown as (Part | { _class: string })[];
        for (const el of part) {
          if ((el as { _class?: string })._class !== 'Note') continue;
          const n = el as unknown as N;
          if (!n.pitch) continue;
          notes++;
          if (n.notations?.some((x) => x.technicals?.some((t) => t.fingering))) fing++;
        }
      }
      return { notes, fingerings: fing, onsetOfFirstRhNoteInM2: 'not computed (no timing API; divisions arithmetic by hand)', hand: 'staff field', extra: { measures: score.measures.length } };
    },
  },
  {
    name: '@stringsync/musicxml (MusicXML.parse)', worker: 'no (DOMParser in browser, xmldom in node)', mxl: 'no', notes: 'typed accessors generated from the XSD; verbose; last release 2023',
    async run(xml) {
      const m = await import('@stringsync/musicxml');
      const doc = m.MusicXML.parse(xml);
      const root = doc.getRoot() as unknown as { contents: unknown[] };
      // generic walk: count <note> with <pitch> and <fingering>
      let notes = 0, fing = 0;
      const walk = (o: unknown): void => {
        if (!o || typeof o !== 'object') return;
        const obj = o as { schema?: { name?: string }; contents?: unknown[] };
        if (obj.schema?.name === 'note') { const s = JSON.stringify(obj); if (s.includes('"name":"pitch"')) notes++; if (s.includes('"name":"fingering"')) fing++; return; }
        for (const c of obj.contents ?? []) Array.isArray(c) ? c.forEach(walk) : walk(c);
      };
      walk(root);
      return { notes, fingerings: fing, onsetOfFirstRhNoteInM2: 'not computed (no timing API)', hand: 'staff element' };
    },
  },
  {
    name: '@audio/musicxml (parse -> note events)', worker: 'yes', mxl: 'no', notes: 'flattens to {time,duration,midi,voice} in seconds; drops staff/fingering',
    async run(xml) {
      const m = await import('@audio/musicxml');
      const parsed = m.parse(xml) as { parts: { name: string; notes: { time: number; duration: number; midi: number; voice: number }[] }[] };
      const all = parsed.parts.flatMap((p) => p.notes);
      const m2 = all.filter((n) => n.time >= 2.5 - 1e-6).sort((a, b) => a.time - b.time)[0];
      return { notes: all.length, fingerings: 0, onsetOfFirstRhNoteInM2: m2 ? r1(m2.time * 1000) + ' ms (voice ' + m2.voice + ')' : 'n/a', hand: 'none (no staff info)', extra: { parts: parsed.parts.length } };
    },
  },
  {
    name: 'OSMD internal model (osmd.load, no render)', worker: 'no', mxl: 'built in (jszip)', notes: 'MusicSheet -> SourceMeasure -> VerticalSourceStaffEntryContainer -> SourceStaffEntry -> VoiceEntry -> Note; Fraction timestamps; TechnicalInstructions on VoiceEntry',
    async run(xml) {
      const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
      const div = document.createElement('div'); div.style.display = 'none'; document.body.appendChild(div);
      const osmd = new OpenSheetMusicDisplay(div, { autoResize: false });
      await osmd.load(xml);
      let notes = 0, fing = 0; let first: string = 'n/a'; let hand = '';
      for (const sm of osmd.Sheet.SourceMeasures) for (const vc of sm.VerticalSourceStaffEntryContainers) for (const se of vc.StaffEntries) {
        if (!se) continue;
        for (const ve of se.VoiceEntries) {
          const fs = new Set(ve.TechnicalInstructions.filter((t) => t.type === 0).map((t) => t.sourceNote));
          for (const n of ve.Notes) {
            if (n.isRest()) continue;
            notes++;
            if (fs.has(n)) fing++;
            if (first === 'n/a' && sm.measureListIndex === 1 && se.ParentStaff.idInMusicSheet === 0 && !ve.IsGrace) { first = `abs timestamp ${(sm.AbsoluteTimestamp.RealValue + ve.Timestamp.RealValue) * 4} q (seconds: via tempo expressions yourself)`; hand = 'staff idInMusicSheet=' + se.ParentStaff.idInMusicSheet; }
          }
        }
      }
      div.remove();
      return { notes, fingerings: fing, onsetOfFirstRhNoteInM2: first, hand };
    },
  },
];

async function bench() {
  const res: Record<string, unknown> = {};
  const RUNS = Number(params.get('runs') ?? 4);
  const xmls = { short: await fetchText(FIXTURES.short), long: await fetchText(FIXTURES.long) } as Record<FixtureName, string>;
  // .mxl: fflate unzip of the long piece (8.8 KB -> 400 KB)
  {
    const bytes = new Uint8Array(await (await fetch(FIXTURES.shortMxl)).arrayBuffer());
    const longMxl = new Uint8Array(await (await fetch(FIXTURES.longMxl)).arrayBuffer());
    const t: number[] = [];
    for (let i = 0; i < RUNS; i++) { const t0 = now(); mxlToXml(longMxl); t.push(now() - t0); }
    const jszip = (await import('jszip')).default;
    const tj: number[] = [];
    for (let i = 0; i < RUNS; i++) { const t0 = now(); const z = await jszip.loadAsync(longMxl); await z.file('score.musicxml')!.async('string'); tj.push(now() - t0); }
    res['mxl'] = { shortMxlBytes: bytes.length, longMxlBytes: longMxl.length, longXmlBytes: xmls.long.length, fflateUnzipMs: stats(t), jszipUnzipMs: stats(tj), sameXml: mxlToXml(bytes) === xmls.short };
  }
  for (const c of candidates) {
    const row: Record<string, unknown> = { worker: c.worker, mxl: c.mxl, notes: c.notes };
    for (const fx of ['short', 'long'] as FixtureName[]) {
      const times: number[] = [];
      let probe: Probe | { error: string } | undefined;
      try {
        for (let i = 0; i < RUNS; i++) { const t0 = now(); probe = await c.run(xmls[fx]); times.push(now() - t0); }
        row[fx] = { ms: stats(times), ...probe };
      } catch (e) { row[fx] = { error: String(e).slice(0, 300) }; }
    }
    res[c.name] = row;
    log(c.name, row);
  }
  return res;
}

if (params.get('auto')) runBench(bench); else { runBench(bench); }
