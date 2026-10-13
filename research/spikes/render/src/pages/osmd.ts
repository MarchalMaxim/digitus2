// THROWAWAY spike: OpenSheetMusicDisplay evaluation + measurements.
import { OpenSheetMusicDisplay, TechnicalInstruction, TechnicalInstructionType, type GraphicalNote, type IOSMDOptions } from 'opensheetmusicdisplay';
const PLACEMENT_ABOVE = 0; // PlacementEnum.Above -- PlacementEnum is not exported by the OSMD bundle
import { FIXTURES, type FixtureName, fetchText, now, nextPaint, params, runBench, stats, r1, log, computedPaint } from '../bench/util';
import { fromDom } from '../model/xml';
import { buildScore } from '../model/musicxml';
import { osmdNotes, mapToModel } from '../render/osmd-render';

const host = document.getElementById('score')!;
type Mode = 'paged' | 'endless' | 'horizontal';

function options(mode: Mode): IOSMDOptions {
  return {
    backend: 'svg', autoResize: false, drawTitle: true, drawComposer: false, drawCredits: false,
    drawPartNames: false, drawFingerings: true, // fingeringPosition left at OSMD's default (AboveOrBelow; 'auto' is experimental)
    ...(params.get('fingpos') ? { fingeringPosition: params.get('fingpos')! } : {}),
    renderSingleHorizontalStaffline: mode === 'horizontal',
    pageFormat: mode === 'paged' ? 'A4_P' : 'Endless',
    defaultColorMusic: '#000000', pageBackgroundColor: '#FFFFFF',
    followCursor: false,
    cursorsOptions: [{ type: 0, color: '#000000', alpha: 0.12, follow: false }],
  } as IOSMDOptions;
}

function freshContainer(width = 1200) {
  host.innerHTML = '';
  const div = document.createElement('div');
  div.style.width = width + 'px';
  host.appendChild(div);
  return div;
}

function countFingeringTexts(root: Element) {
  return Array.from(root.querySelectorAll('text')).filter((t) => /^[1-5]$/.test(t.textContent?.trim() ?? '')).length;
}

async function renderOnce(xml: string, mode: Mode, width = 1200) {
  const div = freshContainer(width);
  const osmd = new OpenSheetMusicDisplay(div, options(mode));
  const t0 = now();
  await osmd.load(xml);
  const t1 = now();
  osmd.render();
  const t2 = now();
  await nextPaint();
  const t3 = now();
  return { osmd, div, load: t1 - t0, render: t2 - t1, paint: t3 - t2 };
}

async function bench() {
  const xmls = { short: await fetchText(FIXTURES.short), long: await fetchText(FIXTURES.long) } as Record<FixtureName, string>;
  const models = { short: buildScore(fromDom(xmls.short)), long: buildScore(fromDom(xmls.long)) };
  const res: Record<string, unknown> = { library: 'opensheetmusicdisplay', version: (OpenSheetMusicDisplay.prototype as unknown as { Version: string }).Version ?? 'see package.json' };
  const RUNS = Number(params.get('runs') ?? 4);

  // 1) first render times per fixture and mode
  for (const fx of ['short', 'long'] as FixtureName[]) {
    for (const mode of ['endless', 'paged', 'horizontal'] as Mode[]) {
      const load: number[] = [], render: number[] = [], paint: number[] = [];
      let last: Awaited<ReturnType<typeof renderOnce>> | undefined;
      for (let i = 0; i < RUNS; i++) {
        last = await renderOnce(xmls[fx], mode);
        load.push(last.load); render.push(last.render); paint.push(last.paint);
      }
      const svgs = last!.div.querySelectorAll('svg');
      res[`render.${fx}.${mode}`] = {
        load: stats(load), render: stats(render), paint: stats(paint),
        total_median: r1(stats(load).median + stats(render).median + stats(paint).median),
        svgPages: svgs.length, svgElements: last!.div.querySelectorAll('svg *').length,
        width: Math.round(last!.div.scrollWidth), height: Math.round(last!.div.scrollHeight),
        fingeringTexts: countFingeringTexts(last!.div), modelFingerings: models[fx].allNotes.filter((n) => n.fingering).length,
      };
      log(fx, mode, res[`render.${fx}.${mode}`]);
    }
  }

  // 2) incremental rendering (OSMD 2.x renderNext): time to first batch for the long piece
  {
    const div = freshContainer();
    const osmd = new OpenSheetMusicDisplay(div, options('endless'));
    await osmd.load(xmls.long);
    const t0 = now();
    osmd.renderNext({ measures: 8 } as never);
    const t1 = now();
    await nextPaint();
    res['incremental.long.firstBatch8'] = { renderNext: r1(t1 - t0), paint: r1(now() - t1) };
  }

  // 3) mapping, re-render after fingering change, resize, cursor, red styling (long piece, endless)
  for (const fx of ['short', 'long'] as FixtureName[]) {
    const { osmd, div } = await renderOnce(xmls[fx], 'endless');
    const map = mapToModel(osmd, models[fx]);
    res[`mapping.${fx}`] = { ...map, idToEl: undefined };

    // re-render without changes
    const rr: number[] = [];
    for (let i = 0; i < RUNS; i++) { const t = now(); osmd.render(); rr.push(now() - t); }
    res[`rerender.${fx}.unchanged`] = stats(rr);

    // change an existing fingering + add a new one on a note that has none (model edit, no re-parse)
    const target = osmdNotes(osmd).find((n) => n.mi === Math.floor(models[fx].measures.length / 2) && n.staff === 1)!;
    const note = target.gn.sourceNote;
    const before = countFingeringTexts(div);
    const ve = note.ParentVoiceEntry;
    const existing = ve.TechnicalInstructions.find((t) => t.type === TechnicalInstructionType.Fingering && t.sourceNote === note);
    const t0 = now();
    if (existing) existing.value = '4';
    const added = new TechnicalInstruction();
    added.type = TechnicalInstructionType.Fingering; added.value = '2'; added.placement = PLACEMENT_ABOVE; added.sourceNote = note;
    // put the extra fingering on the first note of the next voice entry without fingering, else on the same note
    ve.TechnicalInstructions.push(added);
    osmd.render();
    const t1 = now();
    await nextPaint();
    res[`fingeringEdit.${fx}`] = { rerenderMs: r1(t1 - t0), paintMs: r1(now() - t1), fingeringTextsBefore: before, fingeringTextsAfter: countFingeringTexts(div), note: { measure: target.mi + 1, midi: target.midi } };

    // resize relayout (what autoResize does): 1200px -> 800px
    div.style.width = '800px';
    const t2 = now(); osmd.render(); const t3 = now();
    await nextPaint();
    res[`resize.${fx}.1200to800`] = { relayoutMs: r1(t3 - t2), paintMs: r1(now() - t3) };
    div.style.width = '1200px'; osmd.render();

    // cursor: show + step + seek to the middle of the piece
    osmd.enableOrDisableCursors(true);
    const cursor = osmd.cursor;
    cursor.show();
    const steps: number[] = [];
    for (let i = 0; i < 50; i++) { const t = now(); cursor.next(); steps.push(now() - t); }
    const targetQ = models[fx].measures[Math.floor(models[fx].measures.length / 2)].startQ;
    const t4 = now();
    cursor.reset();
    while (!cursor.iterator.EndReached && cursor.iterator.currentTimeStamp.RealValue * 4 < targetQ - 1e-6) cursor.next();
    const t5 = now();
    res[`cursor.${fx}`] = { nextMs: stats(steps), seekToMiddleMs: r1(t5 - t4), cursorElement: cursor.cursorElement?.tagName, reachedQ: r1(cursor.iterator.currentTimeStamp.RealValue * 4), targetQ };

    // red styling of a single note and a single fingering digit (CSS class on the SVG group)
    const one = osmdNotes(osmd).find((n) => n.staff === 1 && n.el && !n.grace)!;
    one.el!.classList.add('is-current');
    // the fingering label of exactly this note: GraphicalStaffEntry.FingeringEntries[].sourceNote / .SVGNode
    const staffEntry = one.gn.parentVoiceEntry.parentStaffEntry;
    const label = staffEntry.FingeringEntries.find((l) => l.sourceNote === one.gn.sourceNote);
    const fingerNode = (label?.SVGNode ?? null) as Element | null;
    fingerNode?.classList.add('is-current');
    await nextPaint();
    res[`redStyle.${fx}`] = {
      noteGroupTag: one.el!.tagName, noteGroupId: one.el!.id, noteGroupClass: one.el!.getAttribute('class'),
      noteComputed: computedPaint(one.el!.querySelector('.vf-notehead') ?? one.el!),
      fingeringLabelFound: !!label, fingeringSvgNodeTag: fingerNode?.tagName ?? null, fingeringText: fingerNode?.textContent ?? null,
      fingeringComputed: computedPaint(fingerNode),
      otherNoteComputed: computedPaint(osmdNotes(osmd).find((n) => n.el && n.el !== one.el)!.el),
      noteheadFillAttr: one.el!.querySelector('.vf-notehead path')?.getAttribute('fill') ?? null,
    };
    // bulk: replace every fingering digit in place (GraphicalStaffEntry.FingeringEntries[].SVGNode)
    {
      const labels = osmd.GraphicSheet.MeasureList.flat().filter(Boolean).flatMap((gm) => gm.staffEntries.flatMap((se) => se.FingeringEntries ?? []));
      const t0 = now();
      let changed = 0;
      for (const l of labels) {
        const node = l.SVGNode as Element | undefined;
        const text = node?.querySelector('text') ?? (node as Element | undefined);
        if (!text) continue;
        const d = text.textContent ?? '';
        text.textContent = d === '5' ? '1' : String(Number(d) + 1);
        changed++;
      }
      const t1 = now();
      await nextPaint();
      res[`fingeringEdit.${fx}.inPlaceAllDigits`] = { labels: labels.length, changed, updateMs: r1(t1 - t0), paintMs: r1(now() - t1) };
    }
    // change a digit in place without re-render (SVGNode text) -> instant, but no re-layout
    if (fingerNode) { const t = now(); fingerNode.textContent = fingerNode.textContent === '4' ? '3' : '4'; res[`fingeringEdit.${fx}.inPlaceSvgText`] = { ms: r1(now() - t) }; }
    one.el!.classList.remove('is-current');
    fingerNode?.classList.remove('is-current');
  }
  return res;
}

async function interactive() {
  const fx = (params.get('fx') as FixtureName) ?? 'short';
  const mode = (params.get('mode') as Mode) ?? 'endless';
  const xml = await fetchText(FIXTURES[fx]);
  const model = buildScore(fromDom(xml));
  if (mode === 'horizontal') host.classList.add('horizontal');
  const { osmd, div, load, render } = await renderOnce(xml, mode, Number(params.get('width') ?? 1200));
  log(`OSMD ${fx}/${mode}: load ${r1(load)} ms, render ${r1(render)} ms`);
  const map = mapToModel(osmd, model);
  log('mapping', { ...map, idToEl: undefined });
  const elToId = new Map<Element, string>();
  for (const [id, el] of map.idToEl) if (el) elToId.set(el, id);
  // click-to-select: the clicked note turns red (the single red element)
  div.addEventListener('click', (e) => {
    const g = (e.target as Element).closest('g.vf-stavenote');
    div.querySelectorAll('.is-selected').forEach((x) => x.classList.remove('is-selected'));
    if (g) { g.classList.add('is-selected'); log('clicked', g.id, '->', elToId.get(g) ?? '(unmapped)'); }
  });
  const hl = params.get('highlight');
  if (hl) map.idToEl.get(hl)?.classList.add('is-current');
  Object.assign(window, { osmd, model, map });
  window.__bench = { status: 'done', results: { load, render } };
}

if (params.get('auto')) runBench(bench); else interactive();
