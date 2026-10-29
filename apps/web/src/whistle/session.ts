import type { ScanSession } from '../scan/model.js';
import type { Transcription } from './transcribe.js';

/** A recording stops by itself at this length, in seconds. */
export const LIMIT_S = 60;

/** The name that stamps a recording, in the clock style of the camera's "photo 14.05.31". */
export function recordingName(at = new Date()): string {
  const time = [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join('.');
  return `Whistled tune ${time}.wav`;
}

/** Said in the review's details and kept with the score, in the place of the scanner that read a page. */
export const WHISTLE_RECOGNIZER = 'digitus2-whistle/1';

/**
 * A recording as a scanning session (issue 237): the WAV is its file and the transcription its
 * recognition, so the review, its corrections, My scores and Use for fingerings treat it as a scan
 * that is already read.
 */
export function whistleSession(heard: Transcription, at = new Date()): ScanSession {
  return {
    id: crypto.randomUUID(),
    file: new File([heard.wav as Uint8Array<ArrayBuffer>], recordingName(at), {
      type: 'audio/wav',
      lastModified: at.getTime(),
    }),
    xml: heard.xml,
    recognizedAt: at.toISOString(),
    recognizer: WHISTLE_RECOGNIZER,
  };
}
