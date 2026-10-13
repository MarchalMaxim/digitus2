// THROWAWAY spike: piano sample players — load time, first-note latency, scheduling accuracy.
// One player per page load (?player=...), so Playwright can attribute network bytes per player.
import recorderUrl from '../audio/onset-recorder.worklet.js?url';
import { params, runBench, now, sleep, r1, log, median } from '../bench/util';

type Play = (midi: number, time: number | undefined, duration: number) => void;
interface Adapter { load(ctx: AudioContext, out: AudioNode): Promise<Play>; notes: string }

const NOTE = (m: number) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12] + (Math.floor(m / 12) - 1);

const adapters: Record<string, Adapter> = {
  'smplr-splendid': {
    notes: 'smplr SplendidGrandPiano, all 5 velocity layers (default)',
    async load(ctx, out) {
      const { SplendidGrandPiano } = await import('smplr');
      const piano = SplendidGrandPiano(ctx, { destination: out, decayTime: 0.08 });
      await piano.load;
      return (midi, time, duration) => { piano.start({ note: midi, velocity: 80, time, duration }); };
    },
  },
  'smplr-splendid-mf': {
    notes: 'smplr SplendidGrandPiano, one velocity layer (MF) via notesToLoad',
    async load(ctx, out) {
      const { SplendidGrandPiano } = await import('smplr');
      const piano = SplendidGrandPiano(ctx, { destination: out, decayTime: 0.08, notesToLoad: { velocityRange: [85, 100], fallback: 'nearest' } });
      await piano.load;
      return (midi, time, duration) => { piano.start({ note: midi, velocity: 90, time, duration }); };
    },
  },
  'smplr-soundfont': {
    notes: 'smplr Soundfont acoustic_grand_piano (MusyngKite, gleitz CDN)',
    async load(ctx, out) {
      const { Soundfont } = await import('smplr');
      const inst = Soundfont(ctx, { instrument: 'acoustic_grand_piano', destination: out });
      await inst.load;
      return (midi, time, duration) => { inst.start({ note: midi, velocity: 80, time, duration, ampRelease: 0.08 }); };
    },
  },
  'tonejs-piano': {
    notes: '@tonejs/piano (Salamander, velocities: 1) on tone@14 (fails on tone@15)',
    async load(ctx, out) {
      const Tone = await import('tone14');
      Tone.setContext(ctx);
      const { Piano } = await import('@tonejs/piano');
      const piano = new Piano({ velocities: 1, release: false, pedal: false });
      piano.connect(out as never);
      await piano.load();
      return (midi, time, duration) => {
        const t = time ?? Tone.now();
        piano.keyDown({ midi, time: t, velocity: 0.7 });
        piano.keyUp({ midi, time: t + duration });
      };
    },
  },
  'soundfont-player': {
    notes: 'soundfont-player acoustic_grand_piano (MusyngKite mp3, gleitz CDN)',
    async load(ctx, out) {
      const Soundfont = (await import('soundfont-player')).default;
      const inst = await Soundfont.instrument(ctx, 'acoustic_grand_piano', { destination: out, soundfont: 'MusyngKite', format: 'mp3' });
      return (midi, time, duration) => { inst.play(NOTE(midi), time ?? ctx.currentTime, { duration, release: 0.08 } as never); };
    },
  },
  'soundfont-player-fluid': {
    notes: 'soundfont-player acoustic_grand_piano (FluidR3_GM mp3, gleitz CDN)',
    async load(ctx, out) {
      const Soundfont = (await import('soundfont-player')).default;
      const inst = await Soundfont.instrument(ctx, 'acoustic_grand_piano', { destination: out, soundfont: 'FluidR3_GM', format: 'mp3' });
      return (midi, time, duration) => { inst.play(NOTE(midi), time ?? ctx.currentTime, { duration, release: 0.08 } as never); };
    },
  },
  'tone-sampler-selfhosted': {
    notes: 'Tone.Sampler with 30 self-hosted Salamander mp3 (every minor third)',
    async load(ctx, out) {
      const Tone = await import('tone');
      Tone.setContext(ctx);
      const urls: Record<string, string> = { A0: 'A0.mp3', C8: 'C8.mp3' };
      for (let o = 1; o <= 7; o++) Object.assign(urls, { [`C${o}`]: `C${o}.mp3`, [`D#${o}`]: `Ds${o}.mp3`, [`F#${o}`]: `Fs${o}.mp3`, [`A${o}`]: `A${o}.mp3` });
      const sampler = new Tone.Sampler({ urls, release: 0.08, baseUrl: '/samples/salamander/' }).connect(out as never);
      await Tone.loaded();
      return (midi, time, duration) => { sampler.triggerAttackRelease(Tone.Frequency(midi, 'midi').toNote(), duration, time); };
    },
  },
};

/** functional check of smplr's built-in Sequencer (tempo change, seek, loop, mute track, metronome callback)
 *  with fake instruments that only record the AudioContext times they are asked to start at. */
async function sequencerApi() {
  const { Sequencer } = await import('smplr');
  const ctx = new AudioContext();
  await ctx.resume();
  type Ev = { note: string | number; time?: number; noteId?: string | number };
  const rh: Ev[] = [], lh: Ev[] = [], clicks: number[] = [];
  const fake = (sink: Ev[]) => ({ start: (e: Ev) => { sink.push({ ...e }); return () => {}; } });
  const seq = Sequencer(ctx, { bpm: 120, ppq: 480, timeSignature: 4 });
  const rhNotes = Array.from({ length: 32 }, (_, i) => ({ id: 'r' + i, note: 60 + (i % 8), at: i * 480, duration: 240 }));
  const lhNotes = Array.from({ length: 8 }, (_, i) => ({ id: 'l' + i, note: 48, at: i * 1920, duration: 1800 }));
  seq.addTrack(fake(rh), rhNotes, { id: 'R' }).addTrack(fake(lh), lhNotes, { id: 'L' });
  seq.muteTrack('L');
  seq.scheduleRepeat((t) => clicks.push(t), '4n');
  seq.start();
  await sleep(1300);
  const nBefore = rh.length;
  seq.bpm = 240; // tempo change while playing
  await sleep(800);
  const nAfterTempo = rh.length;
  seq.position = '7:1'; // seek to bar 7 (tick 11520)
  await sleep(500);
  const afterSeek = rh.slice(nAfterTempo);
  seq.loopStart = '1:1'; seq.loopEnd = '2:1'; seq.loop = true; seq.position = 0;
  await sleep(2300); // 1 bar = 1 s at 240 bpm -> ~2 passes
  seq.stop();
  const iv = (xs: number[]) => xs.slice(1).map((t, i) => r1((t - xs[i]) * 1000));
  const times = rh.map((e) => e.time ?? NaN);
  const loopPart = rh.slice(nAfterTempo + afterSeek.length);
  await ctx.close();
  return {
    api: 'Sequencer(ctx,{bpm,ppq}) .addTrack(inst, notes, {id}) .muteTrack(id) .bpm= .position= .loop/.loopStart/.loopEnd .scheduleRepeat(cb,"4n") .on("noteOn")',
    rhIntervalsMsAt120: iv(times.slice(0, Math.min(nBefore, 5))),
    rhIntervalsMsAfterBpm240: iv(times.slice(nBefore + 1, Math.min(nAfterTempo, nBefore + 6))),
    lhStartsWhileMuted: lh.length,
    firstNotesAfterSeekTo7_1: afterSeek.slice(0, 3).map((e) => e.noteId),
    loopNoteIds: loopPart.map((e) => e.noteId).join(','),
    metronomeCallbacks: clicks.length,
    metronomeIntervalsMs: iv(clicks.slice(0, 4)),
  };
}

async function bench() {
  const name = params.get('player') ?? 'smplr-splendid';
  if (name === 'smplr-sequencer-api') return sequencerApi();
  const adapter = adapters[name];
  if (!adapter) throw new Error('unknown player ' + name);
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.resume();
  await ctx.audioWorklet.addModule(recorderUrl);
  const recorder = new AudioWorkletNode(ctx, 'onset-recorder', { processorOptions: { threshold: 0.01, quiet: 0.002, quietFrames: Math.round(ctx.sampleRate * 0.02), debugEvery: params.get('debug') ? Math.round(ctx.sampleRate * 0.1) : 0 } });
  const silent = ctx.createGain(); silent.gain.value = 0;
  recorder.connect(silent).connect(ctx.destination);
  const tap = ctx.createGain();
  tap.connect(ctx.destination); tap.connect(recorder);
  const onsets: number[] = [];
  recorder.port.onmessage = (e) => {
    if ('level' in e.data) { if (params.get('debug')) log('level', r1(e.data.time * 1000), e.data.level.toFixed(4)); return; } onsets.push(e.data.time); if (params.get('debug')) log('onset', r1(e.data.time * 1000), 'amp', e.data.amp.toFixed(4), 'ctxNow', r1(ctx.currentTime * 1000)); };

  const t0 = now();
  const play = await adapter.load(ctx, tap);
  const loadMs = now() - t0;
  log(name, 'loaded in', r1(loadMs), 'ms');
  await sleep(400);

  const waitOnset = async (count: number, timeoutMs: number) => { const end = now() + timeoutMs; while (onsets.length < count && now() < end) await sleep(5); };

  // first-note latency: (a) library default "play now" (no time argument), (b) explicit time = currentTime
  const latency = { libraryDefault: [] as number[], explicitNow: [] as number[] };
  for (const mode of ['libraryDefault', 'explicitNow'] as const) {
    for (let i = 0; i < 3; i++) {
      onsets.length = 0;
      const tCall = ctx.currentTime;
      if (params.get('debug')) log('call', mode, r1(tCall * 1000));
      play(60, mode === 'explicitNow' ? tCall : undefined, 0.1);
      await waitOnset(1, 1500);
      if (onsets.length) latency[mode].push((onsets[0] - tCall) * 1000);
      await sleep(600);
    }
  }

  // scheduling accuracy: 16 notes, 0.5 s apart with sub-render-quantum offsets
  onsets.length = 0;
  const start = ctx.currentTime + 0.3;
  const scheduled: number[] = [];
  for (let i = 0; i < 16; i++) { const t = start + i * 0.5 + i * 0.00137; scheduled.push(t); play(60, t, 0.1); }
  await waitOnset(16, 9500);
  await sleep(200);
  const errors = scheduled.map((s) => { const o = onsets.find((x) => Math.abs(x - s) < 0.2); return o === undefined ? NaN : (o - s) * 1000; });
  const valid = errors.filter((e) => !Number.isNaN(e));
  const med = valid.length ? median(valid) : NaN;
  const dev = valid.map((e) => e - med);
  const res = {
    player: name, notes: adapter.notes, loadMs: r1(loadMs),
    sampleRate: ctx.sampleRate, baseLatencyMs: r1(ctx.baseLatency * 1000), outputLatencyMs: r1((ctx.outputLatency ?? 0) * 1000),
    firstNoteLatencyMs: { libraryDefault: latency.libraryDefault.map(r1), explicitNow: latency.explicitNow.map(r1) },
    scheduling: {
      detected: valid.length, of: 16, medianOffsetMs: r1(med),
      jitterMs_maxAbsDevFromMedian: r1(Math.max(...dev.map(Math.abs))),
      stdevMs: r1(Math.sqrt(dev.reduce((a, d) => a + d * d, 0) / Math.max(1, dev.length))),
      rawErrorsMs: errors.map((e) => r1(e)),
    },
  };
  await ctx.close();
  return res;
}

async function interactive() {
  const controls = document.getElementById('controls')!;
  let ctx: AudioContext | undefined;
  for (const name of Object.keys(adapters)) {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = async () => {
      ctx ??= new AudioContext();
      await ctx.resume();
      const t0 = now();
      const play = await adapters[name].load(ctx, ctx.destination);
      log(name, 'loaded', r1(now() - t0), 'ms');
      [60, 64, 67, 72].forEach((m, i) => play(m, ctx!.currentTime + 0.1 + i * 0.25, 0.4));
    };
    controls.appendChild(b);
  }
  window.__bench = { status: 'done', results: {} };
}

if (params.get('auto')) runBench(bench); else interactive();
