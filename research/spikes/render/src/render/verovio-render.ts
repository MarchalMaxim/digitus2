// THROWAWAY spike: shared Verovio helpers (no side effects).
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import type { ScoreModel } from '../model/musicxml';

const now = () => performance.now();
export type Mode = 'paged' | 'horizontal';

export function baseOptions(mode: Mode, widthPx = 1200, scale = 40) {
  return {
    scale,
    pageWidth: Math.round((widthPx * 100) / scale),
    pageHeight: mode === 'paged' ? 2970 * 2 : 60000,
    adjustPageHeight: true,
    adjustPageWidth: mode === 'horizontal',
    breaks: mode === 'horizontal' ? 'none' : 'auto',
    header: 'auto', footer: 'none',
    svgViewBox: true,
    svgRemoveXlink: true,
    // export the fingering's note reference into the SVG, so a digit can be mapped to its note without the MEI
    svgAdditionalAttribute: ['fing@startid', 'note@pname', 'note@oct', 'note@accid.ges'],
    xmlIdSeed: 1,
  };
}

let tkPromise: Promise<{ tk: VerovioToolkit; initMs: number }> | undefined;
export function getToolkit() {
  tkPromise ??= (async () => {
    const t0 = now();
    const mod = await createVerovioModule();
    const tk = new VerovioToolkit(mod);
    return { tk, initMs: now() - t0 };
  })();
  return tkPromise;
}

export function renderAllPages(tk: VerovioToolkit) {
  const pages: string[] = [];
  for (let p = 1, n = tk.getPageCount(); p <= n; p++) pages.push(tk.renderToSVG(p));
  return pages;
}

/** Map our model notes to Verovio SVG note groups.
 *  1) by id: Verovio keeps MusicXML <note id> as the SVG/MEI id (so we inject our ids before loading);
 *  2) fallback for files without ids: (measure index, staff, MIDI pitch, closest onset in ms). */
export function mapToModel(tk: VerovioToolkit, root: Element, model: ScoreModel) {
  const modelById = new Map(model.allNotes.map((n) => [n.id, n]));
  const idToEl = new Map<string, Element>();
  let byId = 0, byTime = 0, missing = 0;
  const unmatched: string[] = [];
  const svgNotes = Array.from(root.querySelectorAll('g.note'));
  const leftovers = svgNotes.filter((g) => {
    if (modelById.has(g.id)) { idToEl.set(g.id, g); byId++; return false; }
    return true;
  });
  if (leftovers.length) {
    tk.renderToTimemap(); // computes the MIDI timemap; getMIDIValuesForElement() fails without it
    const candidates = new Map<string, typeof model.allNotes>();
    for (const n of model.allNotes) {
      if (idToEl.has(n.id)) continue;
      const k = `${n.measureIndex}|${n.staff}|${n.midi}`;
      candidates.set(k, [...(candidates.get(k) ?? []), n]);
    }
    const measures = Array.from(root.querySelectorAll('g.measure'));
    for (const g of leftovers) {
      const m = g.closest('g.measure')!;
      const mi = measures.indexOf(m);
      const staffEl = g.closest('g.staff')!;
      const si = Array.from(m.querySelectorAll(':scope > g.staff')).indexOf(staffEl) + 1;
      const mv = tk.getMIDIValuesForElement(g.id);
      const list = candidates.get(`${mi}|${si}|${mv.pitch}`) ?? [];
      // grace notes: verovio shifts the principal (on-beat) while our model plays graces before the beat -> 120 ms tolerance
      let best: (typeof list)[number] | undefined, bestD = 120;
      for (const n of list) { const d = Math.abs(n.onsetSec * 1000 - mv.time); if (d < bestD && !idToEl.has(n.id)) { best = n; bestD = d; } }
      if (best) { idToEl.set(best.id, g); byTime++; } else { missing++; if (unmatched.length < 5) unmatched.push(`${g.id} m${mi} s${si} p${mv.pitch} t${mv.time}`); }
    }
  }
  return { svgNotes: svgNotes.length, modelNotes: model.allNotes.length, byId, byTime, missing, unmatched, idToEl };
}

