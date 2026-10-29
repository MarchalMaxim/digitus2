import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { ODE_TO_JOY_BARS, perform, synthesize } from '../../src/whistle/testing/synth.js';
import { encodeWav } from '../../src/whistle/wav.js';

/**
 * A fake microphone for Whistle a tune (issue 237). Chromium plays a WAV file as its microphone
 * (`--use-file-for-fake-audio-capture`, looping), so the page opens a real stream, an AudioWorklet
 * and the real transcription. The file is a synthetic whistle of the first two bars of Ode to
 * Joy, E E F G G F E D, two octaves above the staff, at 100 beats a minute: a second of silence,
 * then the notes with vibrato, a breath between them and a little noise, then silence to 7 s.
 */

export const MICROPHONE_SECONDS = 7;
/** What the fake microphone whistles, as the app writes it. */
export const ODE_PITCHES = ['E4', 'E4', 'F4', 'G4', 'G4', 'F4', 'E4', 'D4'];

function writeMicrophoneFile(): string {
  const { tones } = perform(ODE_TO_JOY_BARS, { octaves: 2, lead: 1, bpm: 100 });
  const samples = synthesize(tones, {
    sampleRate: 48000,
    length: MICROPHONE_SECONDS,
    vibratoCents: 25,
    noiseDb: -34,
  });
  const folder = fileURLToPath(new URL('../../test-results/', import.meta.url));
  mkdirSync(folder, { recursive: true });
  // One file for each process: two workers never write the same one.
  const file = `${folder}whistle-microphone-${process.pid}.wav`;
  writeFileSync(file, encodeWav(samples, 48000));
  return file;
}

/**
 * The launch arguments of a browser with the fake microphone, with the ones every spec has
 * (playwright.config.ts): launch arguments are per browser, so a spec asks for them with
 * `test.use({ launchOptions: { args: fakeMicrophone() } })`.
 */
export function fakeMicrophone(): string[] {
  return [
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--host-resolver-rules=MAP firestore.googleapis.com ~NOTFOUND',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${writeMicrophoneFile()}`,
  ];
}

/**
 * A microphone that hears one steady tone, for the states every theme and width is checked in:
 * the page's getUserMedia is answered with an oscillator's stream, so no launch argument is
 * needed.
 */
export async function installToneMicrophone(page: Page, hz = 1319): Promise<void> {
  await page.addInitScript((frequency) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      oscillator.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.value = 0.4;
      const destination = context.createMediaStreamDestination();
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      return destination.stream;
    };
  }, hz);
}

/** The pixels of the live trace that are not transparent: the trace has drawn something. */
export function traceInk(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.whistle-trace');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !canvas.width || !canvas.height) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) ink++;
    return ink;
  });
}

/** The notes of a MusicXML text as names like E4 or F#5, in document order, rests left out. */
export function pitchNames(xml: string): string[] {
  return [...xml.matchAll(/<pitch>([\s\S]*?)<\/pitch>/g)].map((m) => {
    const body = m[1]!;
    const step = /<step>([A-G])<\/step>/.exec(body)![1]!;
    const alter = Number(/<alter>(-?\d)<\/alter>/.exec(body)?.[1] ?? 0);
    const octave = /<octave>(\d)<\/octave>/.exec(body)![1]!;
    return `${step}${alter > 0 ? '#'.repeat(alter) : alter < 0 ? 'b'.repeat(-alter) : ''}${octave}`;
  });
}
