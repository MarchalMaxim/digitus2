// THROWAWAY spike: our own look-ahead transport over a sampler. Tempo factor, seek, loop range,
// per-hand mute and metronome; the sampler only has to accept "start note at AudioContext time t".
import type { ScoreModel, ScoreNote, Hand } from '../model/musicxml';
import { makeQuarterToSeconds } from '../model/musicxml';

export interface Voice { (n: { midi: number; time: number; duration: number; velocity: number }): void }
export interface TransportOptions { lookaheadSec?: number; intervalMs?: number; onSchedule?: (e: ScheduledEvent) => void }
export type ScheduledEvent = { kind: 'note' | 'click'; ctxTime: number; scoreSec: number; noteId?: string; hand?: Hand; midi?: number };

export class Transport {
  tempo = 1;                       // playback speed factor (1 = score tempo)
  muted = new Set<Hand>();
  metronome = false;
  loop: { from: number; to: number } | null = null; // score seconds
  private anchorCtx = 0;           // ctx time that corresponds to anchorScore
  private anchorScore = 0;         // score seconds
  private scheduledUntil = 0;      // score seconds already scheduled
  private prevAnchor: { ctx: number; score: number } | null = null; // anchor before the last loop wrap
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly notes: ScoreNote[];
  private readonly beats: { sec: number; down: boolean }[] = [];
  private readonly lookahead: number;
  private readonly intervalMs: number;

  constructor(private ctx: AudioContext, model: ScoreModel, private voice: Voice, private stopAll: () => void, private opts: TransportOptions = {}) {
    this.notes = model.notes;
    this.lookahead = opts.lookaheadSec ?? 0.15;
    this.intervalMs = opts.intervalMs ?? 25;
    const toSec = makeQuarterToSeconds(model.tempos);
    for (const m of model.measures) {
      const beatQ = 4 / m.beatType;
      for (let k = 0; k * beatQ < m.lengthQ - 1e-6; k++) this.beats.push({ sec: toSec(m.startQ + k * beatQ), down: k === 0 });
    }
  }
  get playing() { return this.timer !== undefined; }
  get end() { const last = this.notes.at(-1); return last ? last.onsetSec + last.durationSec : 0; }
  /** score position (seconds) that is AUDIBLE right now (output latency compensated) */
  audibleScoreTime(): number {
    if (!this.playing) return this.anchorScore;
    const ts = this.ctx.getOutputTimestamp();
    const ctxNow = (ts.contextTime ?? this.ctx.currentTime) + (performance.now() - (ts.performanceTime ?? performance.now())) / 1000;
    return this.toScore(ctxNow);
  }
  /** naive variant most demos use: ctx.currentTime (ignores output latency) */
  naiveScoreTime(): number { return this.playing ? this.toScore(this.ctx.currentTime) : this.anchorScore; }
  private toScore(ctxTime: number) {
    // audio scheduled before a loop wrap is still sounding until the new anchor time
    const a = ctxTime < this.anchorCtx && this.prevAnchor ? this.prevAnchor : { ctx: this.anchorCtx, score: this.anchorScore };
    return a.score + (ctxTime - a.ctx) * this.tempo;
  }
  play(fromScoreSec = this.anchorScore) {
    this.stop(false);
    this.anchorCtx = this.ctx.currentTime + 0.05;
    this.anchorScore = this.scheduledUntil = fromScoreSec;
    this.prevAnchor = null;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.tick();
  }
  stop(resetPosition = true) {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.stopAll();
    if (resetPosition) this.anchorScore = 0;
  }
  seek(scoreSec: number) { const was = this.playing; this.stop(false); this.anchorScore = scoreSec; if (was) this.play(scoreSec); }
  setTempo(factor: number) { const pos = this.naiveScoreTime(); this.tempo = factor; if (this.playing) this.play(pos); }
  setLoop(from: number, to: number) { this.loop = { from, to }; if (this.playing) this.play(Math.min(Math.max(this.naiveScoreTime(), from), to)); }
  private tick() {
    const horizonCtx = this.ctx.currentTime + this.lookahead;
    let horizon = this.anchorScore + (horizonCtx - this.anchorCtx) * this.tempo;
    // loop: when the window crosses the loop end, schedule up to the end and re-anchor at loop start
    if (this.loop && horizon >= this.loop.to && this.scheduledUntil < this.loop.to + 1e-9) {
      this.scheduleRange(this.scheduledUntil, this.loop.to);
      this.prevAnchor = { ctx: this.anchorCtx, score: this.anchorScore };
      this.anchorCtx += (this.loop.to - this.anchorScore) / this.tempo;
      this.anchorScore = this.scheduledUntil = this.loop.from;
      horizon = this.anchorScore + (horizonCtx - this.anchorCtx) * this.tempo;
    }
    if (!this.loop && this.scheduledUntil > this.end + 1) { this.stop(false); return; }
    this.scheduleRange(this.scheduledUntil, horizon);
    this.scheduledUntil = Math.max(this.scheduledUntil, horizon);
  }
  private scheduleRange(from: number, to: number) {
    const toCtx = (s: number) => this.anchorCtx + (s - this.anchorScore) / this.tempo;
    for (const n of this.notes) {
      if (n.onsetSec < from || n.onsetSec >= to) continue; // half-open [from, to): no epsilon, or boundary notes double-trigger
      if (this.muted.has(n.hand)) continue;
      const time = Math.max(toCtx(n.onsetSec), this.ctx.currentTime);
      this.voice({ midi: n.midi, time, duration: n.durationSec / this.tempo, velocity: 80 });
      this.opts.onSchedule?.({ kind: 'note', ctxTime: time, scoreSec: n.onsetSec, noteId: n.id, hand: n.hand, midi: n.midi });
    }
    if (this.metronome) for (const b of this.beats) {
      if (b.sec < from || b.sec >= to) continue;
      const time = toCtx(b.sec);
      click(this.ctx, time, b.down);
      this.opts.onSchedule?.({ kind: 'click', ctxTime: time, scoreSec: b.sec });
    }
  }
}

/** metronome click without samples: 25 ms sine blip */
function click(ctx: AudioContext, time: number, down: boolean) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = down ? 1760 : 1320;
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(0.4, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.025);
  osc.connect(g).connect(ctx.destination);
  osc.start(time); osc.stop(time + 0.03);
}
