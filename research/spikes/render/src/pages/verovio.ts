// THROWAWAY spike: Verovio (WASM) evaluation + measurements.
import type { VerovioToolkit } from 'verovio/esm';
import { baseOptions, getToolkit, renderAllPages, mapToModel, type Mode } from '../render/verovio-render';
import { FIXTURES, type FixtureName, fetchText, now, nextPaint, params, runBench, stats, r1, log, computedPaint } from '../bench/util';
import { fromDom } from '../model/xml';
import { buildScore, injectNoteIds, type ScoreModel } from '../model/musicxml';

const host = document.getElementById('score')!;

async function renderOnce(tk: VerovioToolkit, data: string, mode: Mode, widthPx = 1200) {
  host.innerHTML = '';
  host.classList.toggle('horizontal', mode === 'horizontal');
  const div = document.createElement('div');
  div.style.width = mode === 'horizontal' ? 'auto' : widthPx + 'px';
  host.appendChild(div);
  tk.setOptions(baseOptions(mode, widthPx));
  const t0 = now();
  tk.loadData(data);
  const t1 = now();
  const pages = renderAllPages(tk);
  const t2 = now();
  div.innerHTML = pages.join('');
  div.getBoundingClientRect();
  const t3 = now();
  await nextPaint();
  const t4 = now();
  return { div, pages, load: t1 - t0, toSvg: t2 - t1, dom: t3 - t2, paint: t4 - t3 };
}

const countFing = (root: Element) => root.querySelectorAll('g.fing').length;

async function bench() {
  const res: Record<string, unknown> = {};
  const { tk, initMs } = await getToolkit();
  res.library = 'verovio ' + tk.getVersion();
  res.wasmInitMs = r1(initMs);
  const xmls = { short: await fetchText(FIXTURES.short), long: await fetchText(FIXTURES.long) } as Record<FixtureName, string>;
  const models = { short: buildScore(fromDom(xmls.short)), long: buildScore(fromDom(xmls.long)) };
  const RUNS = Number(params.get('runs') ?? 4);

  for (const fx of ['short', 'long'] as FixtureName[]) {
    for (const mode of ['paged', 'horizontal'] as Mode[]) {
      const load: number[] = [], toSvg: number[] = [], dom: number[] = [], paint: number[] = [];
      let last: Awaited<ReturnType<typeof renderOnce>> | undefined;
      for (let i = 0; i < RUNS; i++) {
        last = await renderOnce(tk, xmls[fx], mode);
        load.push(last.load); toSvg.push(last.toSvg); dom.push(last.dom); paint.push(last.paint);
      }
      res[`render.${fx}.${mode}`] = {
        loadData: stats(load), renderToSVG: stats(toSvg), innerHTML: stats(dom), paint: stats(paint),
        total_median: r1(stats(load).median + stats(toSvg).median + stats(dom).median + stats(paint).median),
        pages: last!.pages.length, svgBytes: last!.pages.reduce((a, s) => a + s.length, 0),
        svgElements: last!.div.querySelectorAll('svg *').length,
        width: Math.round(last!.div.scrollWidth), height: Math.round(last!.div.scrollHeight),
        fingeringGroups: countFing(last!.div), modelFingerings: models[fx].allNotes.filter((n) => n.fingering).length,
      };
      log(fx, mode, res[`render.${fx}.${mode}`]);
    }
  }

  for (const fx of ['short', 'long'] as FixtureName[]) {
    const model = models[fx];
    // mapping on the file as-is (short fixture has <note id>, long fixture has none -> time-based fallback)
    {
      const { div } = await renderOnce(tk, xmls[fx], 'paged');
      res[`mapping.${fx}.asIs`] = { ...mapToModel(tk, div, model), idToEl: undefined };
    }
    // recommended: inject our model ids into the MusicXML first -> SVG id === model id
    const ti0 = now();
    const xmlIds = injectNoteIds(xmls[fx], model);
    const injectMs = now() - ti0;
    const { div } = await renderOnce(tk, xmlIds, 'paged');
    const map = mapToModel(tk, div, model);
    res[`mapping.${fx}.injectedIds`] = { ...map, idToEl: undefined, injectMs: r1(injectMs) };

    // re-render without data change (e.g. after an option toggle): only renderToSVG
    const rr: number[] = [];
    for (let i = 0; i < RUNS; i++) { const t = now(); renderAllPages(tk); rr.push(now() - t); }
    res[`rerender.${fx}.renderToSVG`] = stats(rr);

    const targetNote = model.notes.find((n) => n.measureIndex === Math.floor(model.measures.length / 2) && n.staff === 1 && n.fingering)!;
    const midIndex = xmlIds.indexOf(`id="${targetNote.id}"`);

    // fingering edit path A: change the digit in the MusicXML text and reload (full re-import + layout + SVG)
    {
      const xmlEdited = xmlIds.slice(0, midIndex) + xmlIds.slice(midIndex).replace(/<fingering([^>]*)>(\d)<\/fingering>/, (_m, a, d) => `<fingering${a}>${d === '4' ? '3' : '4'}</fingering>`);
      const t0 = now(); tk.loadData(xmlEdited); const pages = renderAllPages(tk); const t1 = now();
      div.innerHTML = pages.join(''); div.getBoundingClientRect(); const t2 = now();
      res[`fingeringEdit.${fx}.musicxmlReload`] = { loadAndSvgMs: r1(t1 - t0), domMs: r1(t2 - t1), fingeringGroups: countFing(div) };
    }
    // fingering edit path B: add a <fing> element to the MEI and reload the MEI
    {
      tk.loadData(xmlIds);
      const t0 = now();
      const mei = tk.getMEI({ pageNo: 0 });
      const t1 = now();
      const doc = new DOMParser().parseFromString(mei, 'application/xml');
      const NS = 'http://www.music-encoding.org/ns/mei';
      const meiNote = Array.from(doc.getElementsByTagNameNS(NS, 'note')).find((n) => n.getAttribute('xml:id') === targetNote.id)!;
      let measure: Element | null = meiNote; while (measure && measure.localName !== 'measure') measure = measure.parentElement;
      const fing = doc.createElementNS(NS, 'fing');
      fing.setAttribute('startid', '#' + targetNote.id); fing.setAttribute('place', 'below'); fing.setAttribute('staff', '1');
      fing.textContent = '5';
      measure!.appendChild(fing);
      const meiEdited = new XMLSerializer().serializeToString(doc);
      const t2 = now();
      tk.loadData(meiEdited);
      const pages = renderAllPages(tk);
      const t3 = now();
      div.innerHTML = pages.join(''); div.getBoundingClientRect();
      const t4 = now();
      res[`fingeringEdit.${fx}.meiReload`] = { getMEIMs: r1(t1 - t0), domEditMs: r1(t2 - t1), loadAndSvgMs: r1(t3 - t2), domMs: r1(t4 - t3), meiBytes: mei.length, fingeringGroups: countFing(div), fingOnTarget: div.querySelectorAll(`g.fing[data-startid="#${targetNote.id}"]`).length };
    }
    // fingering edit path C: the toolkit editor API
    {
      tk.loadData(xmlIds); renderAllPages(tk);
      const attempts: Record<string, unknown> = {};
      for (const action of [
        { action: 'insert', param: { elementType: 'fing', startid: targetNote.id } },
        { action: 'set', param: { elementId: targetNote.id, attribute: 'color', value: 'red' } },
      ]) {
        const t0 = now();
        let ok: unknown;
        try { ok = tk.edit(action); } catch (e) { ok = String(e); }
        const t1 = now();
        const pages = renderAllPages(tk);
        const t2 = now();
        const d = document.createElement('div'); d.innerHTML = pages.join('');
        attempts[action.action] = { ok, editMs: r1(t1 - t0), renderToSvgMs: r1(t2 - t1), fingeringGroupsAfter: countFing(d), editInfo: tk.editInfo(), targetColorAttr: d.querySelector(`[id="${targetNote.id}"]`)?.getAttribute('color') ?? d.querySelector(`[id="${targetNote.id}"]`)?.getAttribute('fill') ?? null };
      }
      res[`fingeringEdit.${fx}.editorApi`] = attempts;
    }

    // resize relayout: 1200px -> 800px (redoLayout re-uses the loaded document)
    {
      tk.loadData(xmlIds); div.innerHTML = renderAllPages(tk).join('');
      const t0 = now();
      tk.setOptions(baseOptions('paged', 800));
      tk.redoLayout();
      const pages = renderAllPages(tk);
      const t1 = now();
      div.innerHTML = pages.join(''); div.getBoundingClientRect();
      res[`resize.${fx}.1200to800`] = { redoLayoutAndSvgMs: r1(t1 - t0), domMs: r1(now() - t1), pages: pages.length };
      tk.setOptions(baseOptions('paged', 1200)); tk.redoLayout(); div.innerHTML = renderAllPages(tk).join('');
    }

    // cursor primitives: timemap + elements at time
    {
      const tm0 = now(); const timemap = tk.renderToTimemap({ includeMeasures: true, includeRests: true }); const tm1 = now();
      const lastMs = timemap.at(-1)!.tstamp;
      const q: number[] = [];
      for (let i = 0; i < 50; i++) { const t = now(); tk.getElementsAtTime((lastMs * i) / 50); q.push(now() - t); }
      const mid = tk.getElementsAtTime(lastMs / 2);
      res[`cursor.${fx}`] = { renderToTimemapMs: r1(tm1 - tm0), timemapEntries: timemap.length, getElementsAtTimeMs: stats(q), sampleAtMiddle: mid, lastTstampMs: lastMs, modelLastOnsetMs: Math.round(model.notes.at(-1)!.onsetSec * 1000) };
    }

    // fingering edit path D: replace the digit text in place in the existing SVG (no layout change when a digit
    // replaces a digit). This is how a re-solve can update ALL digits and animate the changed ones.
    {
      const fings = Array.from(div.querySelectorAll('g.fing[data-startid]'));
      const t0 = now();
      let changed = 0;
      for (const g of fings) {
        const span = g.querySelector('tspan tspan') ?? g.querySelector('text');
        if (!span) continue;
        const d = span.textContent ?? '';
        const next = d === '5' ? '1' : String(Number(d) + 1);
        if (next !== d) { span.textContent = next; g.classList.add('fing-changed'); changed++; }
      }
      const t1 = now();
      await nextPaint();
      res[`fingeringEdit.${fx}.inPlaceAllDigits`] = { digits: fings.length, changed, updateMs: r1(t1 - t0), paintMs: r1(now() - t1) };
      for (const g of fings) g.classList.remove('fing-changed');
    }

    // red styling via CSS class on one note group + its fingering digit (found via data-startid)
    {
      const el = document.getElementById(targetNote.id)!;
      el.classList.add('is-current');
      const fingEl = div.querySelector(`g.fing[data-startid="#${targetNote.id}"]`);
      fingEl?.classList.add('is-current');
      await nextPaint();
      res[`redStyle.${fx}`] = {
        noteComputed: computedPaint(el.querySelector('.notehead') ?? el), fingComputed: computedPaint(fingEl),
        fingMatchedByStartId: !!fingEl,
        otherNoteComputed: computedPaint(div.querySelector('g.note:not(.is-current) .notehead')),
        noteheadFillAttr: el.querySelector('.notehead use, .notehead path')?.getAttribute('fill') ?? null,
      };
      el.classList.remove('is-current'); fingEl?.classList.remove('is-current');
    }
  }

  // Web Worker variant: layout + SVG generation off the main thread (long piece, paged)
  {
    const worker = new Worker(new URL('../bench/verovio.worker.ts', import.meta.url), { type: 'module' });
    const call = (msg: Record<string, unknown>) => new Promise<{ svg: string[]; ms: Record<string, number> }>((resolve) => { worker.onmessage = (e) => resolve(e.data); worker.postMessage(msg); });
    const t0 = now();
    await call({ type: 'init' });
    const t1 = now();
    const runs: Record<string, number>[] = [];
    let longest = 0;
    for (let i = 0; i < RUNS; i++) {
      // measure the longest main-thread task while the worker renders
      let lastTick = now(); longest = 0;
      const ticker = setInterval(() => { const t = now(); longest = Math.max(longest, t - lastTick); lastTick = t; }, 4);
      const s0 = now();
      const out = await call({ type: 'render', xml: injectNoteIds(xmls.long, models.long), options: baseOptions('paged', 1200) });
      const s1 = now();
      clearInterval(ticker);
      host.innerHTML = out.svg.join(''); host.getBoundingClientRect();
      const s2 = now();
      runs.push({ roundTrip: s1 - s0, workerLoad: out.ms.load, workerSvg: out.ms.svg, mainThreadInsert: s2 - s1, longestMainThreadGapWhileRendering: longest });
    }
    worker.terminate();
    const pick = (k: string) => stats(runs.map((r) => r[k]));
    res['worker.long.paged'] = { initMs: r1(t1 - t0), roundTrip: pick('roundTrip'), workerLoad: pick('workerLoad'), workerSvg: pick('workerSvg'), mainThreadInsert: pick('mainThreadInsert'), longestMainThreadGap: pick('longestMainThreadGapWhileRendering') };
  }
  return res;
}

async function interactive() {
  const fx = (params.get('fx') as FixtureName) ?? 'short';
  const mode = (params.get('mode') as Mode) ?? 'paged';
  const { tk, initMs } = await getToolkit();
  const raw = await fetchText(FIXTURES[fx]);
  const model = buildScore(fromDom(raw));
  const xml = params.get('noids') ? raw : injectNoteIds(raw, model);
  const r = await renderOnce(tk, xml, mode, Number(params.get('width') ?? 1200));
  log(`Verovio ${tk.getVersion()} ${fx}/${mode}: wasm init ${r1(initMs)} ms, loadData ${r1(r.load)} ms, renderToSVG ${r1(r.toSvg)} ms, DOM ${r1(r.dom)} ms`);
  const map = mapToModel(tk, r.div, model);
  log('mapping', { ...map, idToEl: undefined });
  const elToId = new Map<Element, string>();
  for (const [id, el] of map.idToEl) elToId.set(el, id);
  r.div.addEventListener('click', (e) => {
    const g = (e.target as Element).closest('g.note');
    r.div.querySelectorAll('.is-selected').forEach((x) => x.classList.remove('is-selected'));
    if (g) { g.classList.add('is-selected'); log('clicked', g.id, '->', elToId.get(g) ?? '(unmapped)'); }
  });
  const hl = params.get('highlight');
  if (hl) {
    const el = map.idToEl.get(hl);
    el?.classList.add('is-current');
    if (params.get('hlfing')) r.div.querySelector(`g.fing[data-startid="#${el?.id}"]`)?.classList.add('is-current');
  }
  Object.assign(window, { tk, model, map });
  window.__bench = { status: 'done', results: {} };
}

if (params.get('auto')) runBench(bench); else interactive();
