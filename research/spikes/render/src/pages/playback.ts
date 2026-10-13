// THROWAWAY spike: MusicXML -> our model -> Verovio (or OSMD) SVG + smplr piano, with a cursor that
// colors the current note(s) red in sync with the audio (rAF + AudioContext.getOutputTimestamp()).
// ?renderer=verovio (default) | osmd   ?fx=short|long   ?auto=1 runs the sync measurement.
import { SplendidGrandPiano } from 'smplr';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { FIXTURES, type FixtureName, fetchText, now, params, runBench, r1, log, median, sleep, nextPaint } from '../bench/util';
import { fromDom } from '../model/xml';
import { buildScore, injectNoteIds, type ScoreModel } from '../model/musicxml';
import { getToolkit, baseOptions, renderAllPages } from '../render/verovio-render';
import { mapToModel as osmdMap } from '../render/osmd-render';
import { Transport, type ScheduledEvent } from '../audio/scheduler';

const host = document.getElementById('score')!;
const controls = document.getElementById('controls')!;
const renderer = params.get('renderer') ?? 'verovio';
const fx = (params.get('fx') as FixtureName) ?? 'short';

async function renderScore(xml: string, model: ScoreModel): Promise<Map<string, Element>> {
  host.innerHTML = '';
  const div = document.createElement('div');
  div.style.width = '1200px';
  host.appendChild(div);
  if (renderer === 'osmd') {
    const osmd = new OpenSheetMusicDisplay(div, { backend: 'svg', autoResize: false, drawTitle: false, drawPartNames: false, drawFingerings: true, defaultColorMusic: '#000000' });
    await osmd.load(xml);
    osmd.render();
    const map = osmdMap(osmd, model).idToEl;
    return new Map([...map].filter(([, el]) => el) as [string, Element][]);
  }
  const { tk } = await getToolkit();
  tk.setOptions({ ...baseOptions('paged', 1200), header: 'none' });
  tk.loadData(injectNoteIds(xml, model)); // SVG ids === our model ids
  div.innerHTML = renderAllPages(tk).join('');
  const map = new Map<string, Element>();
  for (const n of model.allNotes) { const el = document.getElementById(n.id); if (el) map.set(n.id, el); }
  return map;
}

/** visual timeline: every notated note (incl. tie continuations) grouped by onset, sorted */
function visualGroups(model: ScoreModel) {
  const groups = new Map<number, string[]>();
  for (const n of model.allNotes) {
    const key = Math.round(n.onsetSec * 1e6) / 1e6;
    groups.set(key, [...(groups.get(key) ?? []), n.id]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([sec, ids]) => ({ sec, ids }));
}

async function setup() {
  const raw = await fetchText(FIXTURES[fx]);
  const model = buildScore(fromDom(raw));
  const idToEl = await renderScore(raw, model);
  const groups = visualGroups(model);
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  // load only the samples this piece needs: MF layer, the piece's pitches (others fall back to the nearest)
  const pitches = [...new Set(model.notes.map((n) => n.midi))];
  const t0 = now();
  const piano = SplendidGrandPiano(ctx, { notesToLoad: { notes: pitches, velocityRange: [85, 100], fallback: 'nearest' }, decayTime: 0.3 });
  await piano.load;
  const loadMs = now() - t0;
  const events: ScheduledEvent[] = [];
  const transport = new Transport(ctx, model, (n) => piano.start({ note: n.midi, time: n.time, duration: n.duration, velocity: n.velocity }), () => piano.stop(), { onSchedule: (e) => events.push(e) });
  return { model, idToEl, groups, ctx, piano, transport, events, loadMs, pitches };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** rAF loop: color the group whose onset is the latest one <= the audible score time (the ONE red thing) */
function startCursor(s: Setup, mode: 'compensated' | 'naive' = 'compensated') {
  let current = -1, raf = 0, lastFrame = 0;
  const samples: { sec: number; highlightPerf: number; audiblePerf: number }[] = [];
  const frameGaps: number[] = [];
  const frame = (ts: number) => {
    if (lastFrame) frameGaps.push(ts - lastFrame);
    lastFrame = ts;
    const pos = mode === 'compensated' ? s.transport.audibleScoreTime() : s.transport.naiveScoreTime();
    let lo = 0, hi = s.groups.length - 1, idx = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (s.groups[mid].sec <= pos + 1e-4) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    if (idx !== current) {
      if (current >= 0) for (const id of s.groups[current].ids) s.idToEl.get(id)?.classList.remove('is-current');
      if (idx >= 0) for (const id of s.groups[idx].ids) s.idToEl.get(id)?.classList.add('is-current');
      if (idx >= 0) {
        // when does this onset leave the speakers? map its ctx time to performance time via getOutputTimestamp()
        const ev = s.events.find((e) => e.kind === 'note' && Math.abs(e.scoreSec - s.groups[idx].sec) < 1e-4);
        const out = s.ctx.getOutputTimestamp();
        if (ev && out.contextTime !== undefined && out.performanceTime !== undefined) {
          samples.push({ sec: s.groups[idx].sec, highlightPerf: ts, audiblePerf: out.performanceTime + (ev.ctxTime - out.contextTime) * 1000 });
        }
      }
      current = idx;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const clear = () => { if (current >= 0) for (const id of s.groups[current].ids) s.idToEl.get(id)?.classList.remove('is-current'); current = -1; };
  return { stop: () => cancelAnimationFrame(raf), clear, samples, frameGaps };
}

function syncStats(samples: { highlightPerf: number; audiblePerf: number }[]) {
  const d = samples.map((x) => x.highlightPerf - x.audiblePerf); // > 0: red appears after the sound
  const abs = d.map(Math.abs).sort((a, b) => a - b);
  return { n: d.length, medianMs: r1(median(d)), meanMs: r1(d.reduce((a, b) => a + b, 0) / Math.max(1, d.length)), minMs: r1(Math.min(...d)), maxMs: r1(Math.max(...d)), p95AbsMs: r1(abs[Math.floor(abs.length * 0.95)] ?? NaN) };
}

async function bench() {
  const s = await setup();
  await s.ctx.resume();
  const res: Record<string, unknown> = {
    renderer, fixture: fx, sampleLoadMs: r1(s.loadMs), samplesFor: `${s.pitches.length} distinct pitches, MF velocity layer`,
    mappedNotes: s.idToEl.size, modelNotes: s.model.allNotes.length,
    ctx: { sampleRate: s.ctx.sampleRate, baseLatencyMs: r1(s.ctx.baseLatency * 1000), outputLatencyMs: r1(s.ctx.outputLatency * 1000) },
  };
  const playFor = Math.min(s.transport.end + 0.5, Number(params.get('seconds') ?? 30));
  for (const mode of ['compensated', 'naive'] as const) {
    s.events.length = 0;
    const cursor = startCursor(s, mode);
    s.transport.play(0);
    await sleep(playFor * 1000);
    s.transport.stop();
    cursor.stop(); cursor.clear();
    const gaps = cursor.frameGaps.sort((a, b) => a - b);
    const ids = s.events.filter((e) => e.kind === 'note').map((e) => e.noteId);
    res[`sync.${mode}`] = { ...syncStats(cursor.samples), frames: gaps.length, frameMedianMs: r1(median(gaps)), frameMaxMs: r1(gaps.at(-1) ?? NaN), notesScheduled: ids.length, duplicateNotes: ids.length - new Set(ids).size };
    await sleep(400);
  }
  // transport features, verified on the scheduled-event log
  {
    s.events.length = 0;
    s.transport.muted.add('L');
    s.transport.metronome = true;
    s.transport.tempo = 1.5;
    const m = s.model.measures;
    s.transport.setLoop(m[1].startSec, m[3].startSec); // loop bars 2-3
    s.transport.play(m[1].startSec);
    const loopLenCtx = (m[3].startSec - m[1].startSec) / 1.5;
    await sleep((loopLenCtx * 2 + 0.4) * 1000);
    s.transport.stop();
    s.transport.muted.clear(); s.transport.metronome = false; s.transport.tempo = 1; s.transport.loop = null;
    const notes = s.events.filter((e) => e.kind === 'note');
    const clicks = s.events.filter((e) => e.kind === 'click');
    const distinct = new Set(notes.map((e) => e.noteId)).size;
    res.transportFeatures = {
      leftHandNotesScheduledWhileMuted: notes.filter((e) => e.hand === 'L').length,
      rightHandNotesScheduled: notes.length,
      notesOutsideLoop: notes.filter((e) => e.scoreSec < m[1].startSec || e.scoreSec >= m[3].startSec).length,
      loopPassesObserved: r1(notes.length / Math.max(1, distinct)),
      metronomeClicks: clicks.length,
      clickIntervalMsAtTempo1_5: clicks.slice(1, 6).map((c, i) => r1((c.ctxTime - clicks[i].ctxTime) * 1000)),
      expectedClickIntervalMs: r1((60 / s.model.tempos[0].bpm / 1.5) * 1000),
    };
  }
  { const t = now(); s.transport.seek(s.model.measures[Math.floor(s.model.measures.length / 2)].startSec); res.seekMs = r1(now() - t); s.transport.stop(); }
  if (params.get('shot')) { // leave one note red for the screenshot
    const g = s.groups.find((x) => x.sec >= s.model.measures[1].startSec + 0.5)!;
    for (const id of g.ids) s.idToEl.get(id)?.classList.add('is-current');
    await nextPaint();
  }
  await s.ctx.close();
  return res;
}

async function interactive() {
  const s = await setup();
  log(`renderer ${renderer}: ${s.idToEl.size}/${s.model.allNotes.length} notes mapped; samples loaded in ${r1(s.loadMs)} ms (${s.pitches.length} pitches)`);
  const cursor = startCursor(s);
  const btn = (label: string, fn: () => void) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; controls.appendChild(b); return b; };
  btn('play', async () => { await s.ctx.resume(); s.transport.play(0); });
  btn('stop', () => { s.transport.stop(); cursor.clear(); });
  btn('tempo 0.75', () => s.transport.setTempo(0.75));
  btn('tempo 1', () => s.transport.setTempo(1));
  btn('loop bars 2-3', () => s.transport.setLoop(s.model.measures[1].startSec, s.model.measures[3].startSec));
  btn('loop off', () => { s.transport.loop = null; });
  btn('mute LH', () => { if (s.transport.muted.has('L')) s.transport.muted.delete('L'); else s.transport.muted.add('L'); });
  btn('metronome', () => { s.transport.metronome = !s.transport.metronome; });
  host.addEventListener('click', (e) => { // click a note -> seek there
    const el = (e.target as Element).closest('g.note, g.vf-stavenote');
    const id = [...s.idToEl].find(([, v]) => v === el)?.[0];
    const note = s.model.allNotes.find((n) => n.id === id);
    if (note) s.transport.seek(note.onsetSec);
  });
  Object.assign(window, { s });
  window.__bench = { status: 'done', results: {} };
}

if (params.get('auto')) runBench(bench); else interactive();
