/**
 * What the score camera saw, shown only behind `?camera=debug` (issue 145): a phone that no cable
 * reaches can still say why a press failed, in a screenshot. Counts, never pictures.
 */

const REMEMBERED = 'digitus2.cameraDebug';

/**
 * True when the page was opened with `camera=debug`, before or after the `#` (both are easy to
 * type on a phone), or earlier in this tab: the app's own navigation then keeps it on.
 */
export function cameraDebugRequested(
  search = globalThis.location?.search ?? '',
  hash = globalThis.location?.hash ?? '',
): boolean {
  const asked = /[?&#]camera=debug\b/.test(`${search}#${hash.replace(/^#/, '')}`);
  try {
    if (asked) globalThis.sessionStorage?.setItem(REMEMBERED, '1');
    return asked || globalThis.sessionStorage?.getItem(REMEMBERED) === '1';
  } catch {
    return asked;
  }
}

export interface CameraDiagnosis {
  /** New video frames, and how many times the frame loop was called back at all. */
  frames: number;
  callbacks: number;
  /** Frames sent for analysis, answered with a result, and answered with none. */
  asked: number;
  answered: number;
  unanswered: number;
  /** The last presses: frames seen and asked during each, and how it was settled. */
  presses: string[];
  /** The last errors, by where they were caught. */
  errors: string[];
}

const KEEP = 4;

export class CameraLog {
  private value: CameraDiagnosis = {
    frames: 0,
    callbacks: 0,
    asked: 0,
    answered: 0,
    unanswered: 0,
    presses: [],
    errors: [],
  };

  callback(fresh: boolean) {
    this.value.callbacks += 1;
    if (fresh) this.value.frames += 1;
  }
  asked() {
    this.value.asked += 1;
  }
  answer(ok: boolean) {
    if (ok) this.value.answered += 1;
    else this.value.unanswered += 1;
  }
  press({ seen, asked, how }: { seen: number; asked: number; how: string }) {
    this.value.presses = [...this.value.presses, `${how}: ${seen} seen, ${asked} asked`].slice(
      -KEEP,
    );
  }
  error(where: string, cause: unknown) {
    const text = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    this.value.errors = [...this.value.errors, `${where}: ${text}`].slice(-KEEP);
  }
  snapshot(): CameraDiagnosis {
    return { ...this.value, presses: [...this.value.presses], errors: [...this.value.errors] };
  }
}

/** The lines the debug panel shows: the counts, then the camera's own report of itself. */
export function diagnosisLines(
  diagnosis: CameraDiagnosis,
  video: HTMLVideoElement | null,
  track: MediaStreamTrack | undefined,
): string[] {
  let settings = '';
  try {
    const { width, height, frameRate } = track?.getSettings?.() ?? {};
    settings = `${width ?? '?'}x${height ?? '?'} @${frameRate ? Math.round(frameRate) : '?'}`;
  } catch {
    settings = 'no settings';
  }
  return [
    `track ${track?.readyState ?? 'none'}${track?.muted ? ' muted' : ''} ${settings}`,
    `video ${video?.videoWidth ?? 0}x${video?.videoHeight ?? 0}${video?.paused ? ' paused' : ''} ready ${video?.readyState ?? 0}`,
    `frames ${diagnosis.frames} of ${diagnosis.callbacks} callbacks`,
    `analysis ${diagnosis.asked} asked, ${diagnosis.answered} answered, ${diagnosis.unanswered} none`,
    ...diagnosis.presses.map((press) => `press ${press}`),
    ...diagnosis.errors.map((error) => `error ${error}`),
  ];
}
