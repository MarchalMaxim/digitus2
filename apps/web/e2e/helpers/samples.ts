import type { Page, Route } from '@playwright/test';

/**
 * The piano sample requests: smplr fetches them from the app's own site, `<base>piano/<file>`
 * (`src/audio/pianoSamples.ts`), which serves the `piano-samples-v1` release asset. The suite never
 * needs that asset: a flow that plays with the real instrument (no `?audio=silent`) answers these
 * requests itself with the helpers below. Service workers are blocked in the suite
 * (playwright.config.ts), so `page.route` sees these requests.
 */
export const PIANO_SAMPLES = /\/piano\/[^/?#]+\.(?:ogg|m4a)$/;

/**
 * A short silent WAV (mono, 16-bit PCM, 44.1 kHz). Chromium's `decodeAudioData` reads it whatever
 * the requested file's extension, so the piano loads it as every one of its samples.
 */
export function silentWav(seconds = 0.05, rate = 44_100): Buffer {
  const data = Math.round(seconds * rate) * 2;
  const wav = Buffer.alloc(44 + data);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + data, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16); // the fmt chunk's size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // one channel
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28); // bytes per second
  wav.writeUInt16LE(2, 32); // bytes per frame
  wav.writeUInt16LE(16, 34); // bits per sample
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(data, 40);
  return wav;
}

/** Answers a sample request with the silent WAV. */
function fulfillSilently(route: Route): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav() });
}

/**
 * Answers every piano sample request `delayMs` after it was made, with the silent WAV: the first
 * Play of a score then loads for about that long. Returns the requested URLs, filled in as the
 * requests arrive.
 */
export async function delayPianoSamples(page: Page, delayMs: number): Promise<string[]> {
  const requested: string[] = [];
  await page.route(PIANO_SAMPLES, async (route) => {
    requested.push(route.request().url());
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await fulfillSilently(route).catch(() => undefined); // the page may be gone by then
  });
  return requested;
}

/**
 * Holds every piano sample request unanswered, so the first Play of a score keeps loading for as
 * long as the page lives (a state to check at leisure).
 */
export async function holdPianoSamples(page: Page): Promise<void> {
  await page.route(PIANO_SAMPLES, () => new Promise<void>(() => undefined));
}
