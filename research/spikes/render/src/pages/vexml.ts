// THROWAWAY spike: @stringsync/vexml (MusicXML -> VexFlow 5, canvas-based) evaluation.
import { render, type Score } from '@stringsync/vexml';
import { FIXTURES, type FixtureName, fetchText, now, nextPaint, params, runBench, stats, r1, log } from '../bench/util';
import { fromDom } from '../model/xml';
import { buildScore, injectNoteIds } from '../model/musicxml';

const host = document.getElementById('score')!;
type Mode = 'standard' | 'panoramic';
const config = (mode: Mode) => ({
  layout: mode === 'standard' ? { type: 'standard' as const, referenceWidth: 1200 } : { type: 'panoramic' as const },
  fonts: { text: { family: 'Times New Roman' } }, // avoid the default Google-Fonts text face (offline/static hosting)
});

async function renderOnce(xml: string, mode: Mode) {
  host.innerHTML = '';
  const div = document.createElement('div');
  div.style.width = '1200px';
  host.appendChild(div);
  const t0 = now();
  const score = await render(xml, div, config(mode));
  const t1 = now();
  await nextPaint();
  return { score, div, render: t1 - t0, paint: now() - t1 };
}

function mapping(score: Score, modelIds: Set<string>) {
  const notes = score.getElements().notes();
  let byId = 0;
  for (const n of notes) {
    const id = n.getSources()[0]?.getAttribute('id');
    if (id && modelIds.has(id)) byId++;
  }
  return { renderedNotes: notes.length, byId };
}

async function bench() {
  const res: Record<string, unknown> = { library: '@stringsync/vexml 1.12.1 (vexflow 5.0.0)' };
  const RUNS = Number(params.get('runs') ?? 4);
  for (const fx of ['short', 'long'] as FixtureName[]) {
    const raw = await fetchText(FIXTURES[fx]);
    const model = buildScore(fromDom(raw));
    const xml = injectNoteIds(raw, model);
    for (const mode of ['standard', 'panoramic'] as Mode[]) {
      const r: number[] = [], p: number[] = [];
      let last: Awaited<ReturnType<typeof renderOnce>> | undefined;
      for (let i = 0; i < RUNS; i++) {
        last?.score.dispose();
        try { last = await renderOnce(xml, mode); } catch (e) { res[`render.${fx}.${mode}`] = { error: String(e) }; break; }
        r.push(last.render); p.push(last.paint);
      }
      if (!r.length) continue;
      res[`render.${fx}.${mode}`] = {
        render: stats(r), paint: stats(p), total_median: r1(stats(r).median + stats(p).median),
        canvases: last!.div.querySelectorAll('canvas').length, svgs: last!.div.querySelectorAll('svg').length,
        width: Math.round(last!.div.scrollWidth), height: Math.round(last!.div.scrollHeight),
        durationMs: Math.round(last!.score.getDurationMs()), modelDurationMs: Math.round((model.notes.at(-1)!.onsetSec + model.notes.at(-1)!.durationSec) * 1000),
      };
      if (mode === 'standard') {
        res[`mapping.${fx}`] = { ...mapping(last!.score, new Set(model.allNotes.map((n) => n.id))), modelNotes: model.allNotes.length };
        // highlight one note via the decoration API (canvas: no CSS per note)
        const note = last!.score.getElements().notes()[5];
        const t = now();
        note.color.on('#e00000');
        await nextPaint();
        res[`redStyle.${fx}`] = { api: 'note.color.on(css)', ms: r1(now() - t), active: note.color.active };
        note.color.off();
      }
    }
  }
  return res;
}

async function interactive() {
  const fx = (params.get('fx') as FixtureName) ?? 'short';
  const mode = (params.get('mode') as Mode) ?? 'standard';
  const raw = await fetchText(FIXTURES[fx]);
  const model = buildScore(fromDom(raw));
  const { score, render: ms } = await renderOnce(injectNoteIds(raw, model), mode);
  log(`vexml ${fx}/${mode}: render ${r1(ms)} ms`, mapping(score, new Set(model.allNotes.map((n) => n.id))));
  const hl = params.get('highlight');
  if (hl) score.getElements().notes().find((n) => n.getSources()[0]?.getAttribute('id') === hl)?.color.on('#e00000');
  Object.assign(window, { score, model });
  window.__bench = { status: 'done', results: {} };
}

if (params.get('auto')) runBench(bench); else interactive();
