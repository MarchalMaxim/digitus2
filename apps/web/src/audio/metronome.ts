const CLICK_SEC = 0.03;
const CLICK_GAIN = 0.2;

/**
 * A metronome click without samples: a short sine blip at context time `time`, 1500 Hz on an
 * accented beat and 1000 Hz otherwise, decaying exponentially over 30 ms.
 */
export function scheduleClick(ctx: AudioContext, time: number, accent: boolean): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1500 : 1000;
  gain.gain.setValueAtTime(CLICK_GAIN, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + CLICK_SEC);
  osc.connect(gain).connect(ctx.destination);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
  osc.start(time);
  osc.stop(time + CLICK_SEC);
}
