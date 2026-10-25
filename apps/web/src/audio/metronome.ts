import type { ClickLevel } from './beats.js';

/**
 * What each step of the metronome's ladder sounds like (issue 203): a bar's first beat, another
 * beat, a sub-beat. Pitch, length and level all step down together, so the beat stands out on
 * laptop speakers and headphones alike; a sub-beat is about 10 dB under a beat.
 */
export const CLICK_SOUND: Record<ClickLevel, { hz: number; sec: number; gain: number }> = {
  bar: { hz: 1500, sec: 0.03, gain: 0.2 },
  beat: { hz: 1000, sec: 0.03, gain: 0.2 },
  sub: { hz: 800, sec: 0.015, gain: 0.06 },
};

/**
 * A metronome click without samples: a short sine blip at context time `time`, decaying
 * exponentially, with the pitch, length and level of `CLICK_SOUND[level]`. Returns its stop: it
 * cuts the click short at once (Pause and a seek stop what is scheduled, as they stop the notes)
 * and does nothing after the click has ended or when called again.
 */
export function scheduleClick(ctx: AudioContext, time: number, level: ClickLevel): () => void {
  const { hz, sec, gain: peak } = CLICK_SOUND[level];
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = hz;
  gain.gain.setValueAtTime(peak, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + sec);
  osc.connect(gain).connect(ctx.destination);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    osc.disconnect();
    gain.disconnect();
  };
  osc.onended = release;
  osc.start(time);
  osc.stop(time + sec);
  return () => {
    if (released) return;
    osc.stop();
    release();
  };
}
