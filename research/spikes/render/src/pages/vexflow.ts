// THROWAWAY spike: direct VexFlow 5 (no MusicXML layer) — what we would have to build ourselves.
// Deliberately naive layout: fixed-width measures, 4 per system, no slurs, no cross-system ties,
// no collision avoidance. It exists to measure raw VexFlow cost and show id/style/fingering control.
import VexFlow, {
  Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Beam, StaveConnector, FretHandFinger,
  ModifierPosition, StaveTie, GraceNote, GraceNoteGroup, Tuplet, type RenderContext,
} from 'vexflow/bravura';
import { FIXTURES, type FixtureName, fetchText, now, nextPaint, params, runBench, stats, r1, log, computedPaint } from '../bench/util';
import { fromDom } from '../model/xml';
import { buildScore, type ScoreModel, type ScoreNote } from '../model/musicxml';

const host = document.getElementById('score')!;
const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const DUR: Record<string, string> = { '4': 'w', '3': 'hd', '2': 'h', '1.5': 'qd', '1': 'q', '0.75': '8d', '0.5': '8', '0.25': '16' };
const vfKey = (n: ScoreNote) => `${n.step.toLowerCase()}${n.alter === 1 ? '#' : n.alter === -1 ? 'b' : n.alter === 2 ? '##' : ''}/${n.octave}`;

/** naive model -> VexFlow layout; returns SVG note elements by our model id */
export function renderModel(model: ScoreModel, div: HTMLElement, opts: { perSystem: number; measureWidth: number }) {
  const width = opts.perSystem * opts.measureWidth + 80;
  const systems = Math.ceil(model.measures.length / opts.perSystem);
  const renderer = new Renderer(div as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(width, systems * 260 + 40);
  const ctx = renderer.getContext() as RenderContext;
  const byId = new Map<string, StaveNote>();
  const tieQueue: { from: ScoreNote; to: ScoreNote }[] = [];
  model.measures.forEach((m, mi) => {
    const sys = Math.floor(mi / opts.perSystem), col = mi % opts.perSystem;
    const x = 40 + col * opts.measureWidth, y = 20 + sys * 260;
    const first = col === 0;
    const staves = [new Stave(x, y, opts.measureWidth), new Stave(x, y + 110, opts.measureWidth)];
    if (first) {
      staves[0].addClef('treble').addKeySignature(KEYS[m.fifths] ?? 'C');
      staves[1].addClef('bass').addKeySignature(KEYS[m.fifths] ?? 'C');
      if (mi === 0) staves.forEach((s) => s.addTimeSignature(`${m.beats}/${m.beatType}`));
    }
    staves.forEach((s) => s.setContext(ctx).draw());
    if (first) {
      new StaveConnector(staves[0], staves[1]).setType('brace').setContext(ctx).draw();
      new StaveConnector(staves[0], staves[1]).setType('singleLeft').setContext(ctx).draw();
    }
    new StaveConnector(staves[0], staves[1]).setType('singleRight').setContext(ctx).draw();
    const voices: Voice[] = [];
    const beams: Beam[] = [];
    const tuplets: Tuplet[] = [];
    for (const staff of [1, 2]) {
      const inMeasure = model.allNotes.filter((n) => n.measureIndex === mi && n.staff === staff);
      const voiceIds = [...new Set(inMeasure.map((n) => n.voice))];
      for (const v of voiceIds) {
        const notes = inMeasure.filter((n) => n.voice === v && !n.grace);
        const chords = [...new Map(notes.map((n) => [n.chordId, notes.filter((o) => o.chordId === n.chordId)])).values()].sort((a, b) => a[0].measureOnsetQ - b[0].measureOnsetQ);
        const tickables: StaveNote[] = [];
        let pos = 0;
        const triplet: StaveNote[] = [];
        const pushRest = (len: number) => { const d = DUR[String(len)]; if (d) tickables.push(new StaveNote({ keys: [staff === 1 ? 'b/4' : 'd/3'], duration: d + 'r', clef: staff === 1 ? 'treble' : 'bass' })); };
        for (const ch of chords) {
          if (ch[0].measureOnsetQ - pos > 1e-6) pushRest(ch[0].measureOnsetQ - pos);
          const q = ch[0].notatedQ;
          const isTriplet = Math.abs(q - 1 / 3) < 1e-6;
          const dur = isTriplet ? '8' : DUR[String(q)] ?? 'q';
          const sorted = [...ch].sort((a, b) => a.midi - b.midi);
          const sn = new StaveNote({ keys: sorted.map(vfKey), duration: dur, clef: staff === 1 ? 'treble' : 'bass', autoStem: true, dots: dur.endsWith('d') ? 1 : 0 });
          sn.setAttribute('id', sorted[0].id);
          sorted.forEach((n, i) => {
            if (n.fingering) sn.addModifier(new FretHandFinger(n.fingering).setPosition(staff === 1 ? ModifierPosition.ABOVE : ModifierPosition.BELOW), i);
            byId.set(n.id, sn);
            if (n.tiedTo) { const head = model.allNotes.find((o) => o.id === n.tiedTo || o.tiedIds.includes(n.id) && o.id !== n.id); if (head) tieQueue.push({ from: head, to: n }); }
          });
          if (dur.endsWith('d')) VexFlow.Dot.buildAndAttach([sn], { all: true });
          const graces = inMeasure.filter((g) => g.grace && g.voice === v && Math.abs(g.measureOnsetQ - ch[0].measureOnsetQ) < 1e-6);
          if (graces.length) sn.addModifier(new GraceNoteGroup(graces.map((g) => new GraceNote({ keys: [vfKey(g)], duration: '8', slash: true })), true).beamNotes(), 0);
          tickables.push(sn);
          if (isTriplet) { triplet.push(sn); if (triplet.length === 3) { tuplets.push(new Tuplet(triplet.splice(0))); } }
          pos = ch[0].measureOnsetQ + q;
        }
        if (m.lengthQ - pos > 1e-6) pushRest(m.lengthQ - pos);
        const voice = new Voice({ numBeats: m.beats, beatValue: m.beatType }).setMode(Voice.Mode.SOFT).addTickables(tickables);
        (voice as unknown as { staffIndex: number }).staffIndex = staff - 1;
        voices.push(voice);
        beams.push(...Beam.generateBeams(tickables.filter((t) => !t.isRest())));
      }
    }
    const keySig = KEYS[m.fifths] ?? 'C';
    Accidental.applyAccidentals(voices, keySig);
    const formatter = new Formatter();
    voices.forEach((v) => formatter.joinVoices([v]));
    formatter.format(voices, opts.measureWidth - (first ? 90 : 20));
    voices.forEach((v) => v.draw(ctx, staves[(v as unknown as { staffIndex: number }).staffIndex]));
    beams.forEach((b) => b.setContext(ctx).draw());
    tuplets.forEach((t) => t.setContext(ctx).draw());
  });
  // ties (only when both notes are rendered; cross-system ties are drawn naively)
  for (const { from, to } of tieQueue) {
    const a = byId.get(from.id), b = byId.get(to.id);
    if (!a || !b) continue;
    const ia = a.getKeys().indexOf(vfKey(from)), ib = b.getKeys().indexOf(vfKey(to));
    new StaveTie({ firstNote: a, lastNote: b, firstIndexes: [ia], lastIndexes: [ib] }).setContext(ctx).draw();
  }
  return byId;
}

async function renderOnce(model: ScoreModel, perSystem = 4) {
  host.innerHTML = '';
  const div = document.createElement('div');
  host.appendChild(div);
  const t0 = now();
  const byId = renderModel(model, div, { perSystem, measureWidth: 280 });
  const t1 = now();
  await nextPaint();
  return { div, byId, render: t1 - t0, paint: now() - t1 };
}

async function bench() {
  await VexFlow.loadFonts('Bravura', 'Academico');
  const res: Record<string, unknown> = { library: 'vexflow ' + VexFlow.BUILD.VERSION + ' (' + VexFlow.BUILD.INFO + ')' };
  const RUNS = Number(params.get('runs') ?? 4);
  for (const fx of ['short', 'long'] as FixtureName[]) {
    const model = buildScore(fromDom(await fetchText(FIXTURES[fx])));
    const r: number[] = [], p: number[] = [];
    let last: Awaited<ReturnType<typeof renderOnce>> | undefined;
    for (let i = 0; i < RUNS; i++) { last = await renderOnce(model); r.push(last.render); p.push(last.paint); }
    const svgIds = new Set(Array.from(last!.div.querySelectorAll('g.vf-stavenote')).map((g) => g.id));
    res[`render.${fx}`] = {
      render: stats(r), paint: stats(p), total_median: r1(stats(r).median + stats(p).median),
      svgElements: last!.div.querySelectorAll('svg *').length, stavenoteGroups: svgIds.size,
      sampleSvgId: [...svgIds][0], fingeringTexts: last!.div.querySelectorAll('.vf-frethandfinger, g.vf-frethandfinger').length,
    };
    // re-render a single measure is possible in principle (we own the layout); here: whole-score re-render cost
    const one = last!.div.querySelector('g.vf-stavenote')!;
    one.classList.add('is-current');
    await nextPaint();
    res[`redStyle.${fx}`] = { noteComputed: computedPaint(one.querySelector('.vf-notehead') ?? one), otherNoteComputed: computedPaint(last!.div.querySelectorAll('g.vf-stavenote')[3]) };
  }
  return res;
}

async function interactive() {
  await VexFlow.loadFonts('Bravura', 'Academico');
  const fx = (params.get('fx') as FixtureName) ?? 'short';
  const model = buildScore(fromDom(await fetchText(FIXTURES[fx])));
  const { render } = await renderOnce(model);
  log(`VexFlow direct ${fx}: render ${r1(render)} ms (naive layout, no slurs)`);
  const hl = params.get('highlight');
  if (hl) document.getElementById('vf-' + hl)?.classList.add('is-current');
  window.__bench = { status: 'done', results: {} };
}

if (params.get('auto')) runBench(bench); else interactive();
