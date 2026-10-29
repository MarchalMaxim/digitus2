import captureUrl from './capture.worklet.js?worker&url';
import { yin } from './pitch.js';
import { transcribe, type Transcription } from './transcribe.js';

/**
 * The microphone for Whistle a tune (issue 237). It opens on a press and is released on Stop, on
 * Escape and when the page is left; the samples stay in memory and nothing is sent anywhere. The
 * browser's echo cancellation, noise suppression and gain control are off: they are made for
 * speech and would clip a held whistle.
 */

export type RecorderFailure = 'denied' | 'noMicrophone' | 'failed';

export class RecorderError extends Error {
  constructor(readonly reason: RecorderFailure) {
    super(reason);
  }
}

export interface Recorder {
  /** Seconds of sound captured so far. */
  elapsed(): number;
  /** The pitch of the latest 46 ms, for the live trace; hz is null when nothing clear is heard. */
  latest(): { hz: number | null; clarity: number };
  /** Releases the microphone and writes the notes; null when none was heard. */
  stop(): Promise<Transcription | null>;
  /** Releases the microphone and drops the sound. */
  cancel(): void;
}

const FRAME_S = 0.046;

function failure(cause: unknown): RecorderError {
  const name = cause instanceof DOMException ? cause.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return new RecorderError('denied');
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return new RecorderError('noMicrophone');
  return new RecorderError('failed');
}

/** Records with `context`, which the caller made in the press that started it (see again.ts). */
export async function startRecorder(context: AudioContext): Promise<Recorder> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
  } catch (cause) {
    void context.close().catch(() => undefined);
    throw failure(cause);
  }
  const release = () => {
    for (const track of stream.getTracks()) track.stop();
    void context.close().catch(() => undefined);
  };
  const blocks: Float32Array[] = [];
  let node: AudioWorkletNode;
  try {
    await context.audioWorklet.addModule(captureUrl);
    node = new AudioWorkletNode(context, 'whistle-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => blocks.push(e.data);
    context.createMediaStreamSource(stream).connect(node);
    // The node writes only silence; it is connected on so that the browser keeps running it.
    node.connect(context.destination);
    if (context.state === 'suspended') await context.resume();
  } catch {
    release();
    throw new RecorderError('failed');
  }
  const rate = context.sampleRate;
  let done = false;

  return {
    elapsed: () => (blocks.length * (blocks[0]?.length ?? 0)) / rate,
    latest() {
      const size = Math.round(FRAME_S * rate);
      const block = blocks[0]?.length ?? 0;
      if (blocks.length * block < size) return { hz: null, clarity: 0 };
      const tail = new Float32Array(Math.ceil(size / block) * block);
      const used = tail.length / block;
      blocks.slice(-used).forEach((b, i) => tail.set(b, i * block));
      return yin(tail.subarray(tail.length - size), rate);
    },
    async stop() {
      if (done) return null;
      done = true;
      node.port.onmessage = null;
      release();
      const samples = new Float32Array(blocks.reduce((n, b) => n + b.length, 0));
      let at = 0;
      for (const b of blocks) {
        samples.set(b, at);
        at += b.length;
      }
      blocks.length = 0;
      return transcribe(samples, rate);
    },
    cancel() {
      if (done) return;
      done = true;
      node.port.onmessage = null;
      blocks.length = 0;
      release();
    },
  };
}
