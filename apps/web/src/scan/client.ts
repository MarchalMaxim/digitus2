import type { Phrase } from '../i18n/messages.js';
import { PhraseError } from '../i18n/PhraseError.js';
import { SCAN_SERVICE } from './service.js';

/**
 * Kept in the saved warnings as this English marker; the review writes it in the language on
 * screen (ScanView.tsx).
 */
export const UNKNOWN_WARNING =
  'The recognizer reported an unknown warning. Check the original carefully.';
/**
 * The service found a piano page read as one staff with alternating clefs: the hands are not
 * separated. Kept as this marker so the review can show it, translated, above the comparison.
 */
export const GRAND_STAFF_WARNING =
  'The staves were not paired into a grand staff, so the hands are not separated.';

/**
 * How long one request usually takes on the deployed service, warm, as measured in
 * `docs/scan-service.md` (Timings): the scan bar (progress.ts) is timed by these.
 */
export const EXPECTED_PHOTO_SECONDS = 35;
export const EXPECTED_PDF_SECONDS = 16;
/** The time a page is expected to take, in milliseconds, by its kind. */
export function expectedMs(file: Blob): number {
  return (file.type === 'application/pdf' ? EXPECTED_PDF_SECONDS : EXPECTED_PHOTO_SECONDS) * 1000;
}

/** While the scanner is busy with another score, the same job is offered again this often… */
export const BUSY_RETRY_MS = 5_000;
/** …for at most this long; then the busy answer is reported as a failure. */
export const BUSY_WAIT_MS = 180_000;
/**
 * The service's answer while another recognition runs: no recognition started, nothing counted
 * against the hourly limit, so the same job can be offered again (ScanView.tsx waits).
 */
export class BusyError extends PhraseError {
  override name = 'BusyError';
  constructor() {
    super(BUSY);
  }
}
/** Resolves after `ms`, or rejects with the abort reason as soon as `signal` aborts. */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
}

/** The protocol this client speaks; the app and the service are deployed together. */
export const PROTOCOL = 'digitus2-scan-v2';
/** What the scan service says about itself in its health answer. */
export interface ScanServiceMetadata {
  protocol?: string;
  recognizer?: string;
  warnings?: string[];
  capabilities?: { textModelConfigured?: boolean };
  maxUploadBytes?: number;
}
/** One recognised page. */
export interface Recognition {
  xml: string;
  recognizer?: string;
  warnings: string[];
  capabilities?: ScanServiceMetadata['capabilities'];
}

function warningsOf(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map((warning: unknown) => {
    if (typeof warning === 'string') return warning;
    if (
      typeof warning === 'object' &&
      warning !== null &&
      'code' in warning &&
      warning.code === 'recognition-grand-staff-unpaired'
    )
      return GRAND_STAFF_WARNING;
    if (
      typeof warning === 'object' &&
      warning !== null &&
      'message' in warning &&
      typeof warning.message === 'string'
    )
      return warning.message;
    return UNKNOWN_WARNING;
  });
}
/** The JSON object an answer carries, or an empty one: a proxy's HTML page is not an answer. */
function bodyOf(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
/** The service's own busy answer: another reader's page is being recognised. */
export const BUSY: Phrase = (t) => t.scan.client.busy;
/** The service's own rate-limited answer: this caller has used up its hour. */
export const LIMITED: Phrase = (t) => t.scan.client.limited;

/** The error for an answer that carries no recognition. */
function refusal(status: number, body: Record<string, unknown>): Error {
  // The service answers 409 to the pending request of a job its DELETE cancelled.
  if (status === 409) return new DOMException('cancelled', 'AbortError');
  if (status === 422 || status === 504) {
    const failure = body.failure;
    const message =
      typeof failure === 'object' && failure !== null && 'message' in failure
        ? failure.message
        : undefined;
    // The service's public message (resolution, several scores, …) says more than ours.
    if (typeof message === 'string' && message) return new Error(message);
    return new PhraseError((t) =>
      status === 422 ? t.scan.errors.notRecognized : t.scan.errors.timedOut,
    );
  }
  // Only the service's own 429 carries these bodies; any other refusal is a failure to answer.
  if (status === 429 && body.error === 'busy') return new BusyError();
  if (status === 429 && body.error === 'rate-limited') return new PhraseError(LIMITED);
  return new PhraseError((t) => t.scan.client.serviceStatus(status));
}
function checked(job: string): string {
  if (!/^[a-f0-9]{32}$/.test(job)) throw new PhraseError((t) => t.scan.client.invalidJob);
  return job;
}
/** A random job id: the client names the job so a cancel can reach it before any answer. */
export function newJobId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** Above the service's 180 s recognition timeout, so its own 504 normally answers first. */
const RECOGNITION_CEILING = 200_000;
const QUICK_CEILING = 10_000;
const OFFLINE: Phrase = (t) => t.scan.errors.offline;
const NO_ANSWER: Phrase = (t) => t.scan.client.noAnswer;
/**
 * The phrase for a request that failed without an answer the page may read, chosen when it fails.
 * Offline, the device says so. Online, the scanner is out of reach: Google's own answers in front
 * of the service (billing disabled by the kill-switch, its 429, 503 and 5xx pages) carry no CORS
 * header, so the browser reports them as a network error.
 */
const unreachable = (): Phrase => (globalThis.navigator?.onLine === false ? OFFLINE : NO_ANSWER);

/** The hosted scan service: one synchronous request per page, cancelled by its job id. */
export function createScanClient(fetcher: typeof fetch = fetch, base: string = SCAN_SERVICE) {
  /**
   * Sends one request and reads its whole answer before `ceiling` ms. A caller abort rethrows
   * as is; a lapsed ceiling throws `late`; any other failure means the scanner is out of reach.
   */
  async function send(
    path: string,
    init: RequestInit,
    ceiling: number,
    late: Phrase,
    signal?: AbortSignal,
  ) {
    // Composed by hand: AbortSignal.any is too recent to rely on; tests can fake this timer.
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException('timed out', 'TimeoutError')),
      ceiling,
    );
    const follow = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', follow, { once: true });
    try {
      const response = await fetcher(base.replace(/\/+$/, '') + '/v1/' + path, {
        mode: 'cors',
        credentials: 'omit',
        ...init,
        signal: controller.signal,
      });
      return { response, body: bodyOf(await response.text()) };
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new PhraseError(controller.signal.aborted ? late : unreachable());
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', follow);
    }
  }
  return {
    async health(): Promise<ScanServiceMetadata> {
      const { response, body } = await send('health', {}, QUICK_CEILING, NO_ANSWER);
      if (!response.ok) throw refusal(response.status, body);
      // Only the warm-up asks, and it shows no failure: this keeps another protocol's metadata out.
      if (body.protocol !== PROTOCOL) throw new Error(`Unknown protocol ${String(body.protocol)}`);
      return { ...body, warnings: warningsOf(body.warnings) } as ScanServiceMetadata;
    },
    async recognize(file: File, job: string, signal?: AbortSignal): Promise<Recognition> {
      checked(job);
      if (signal?.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError');
      const { response, body } = await send(
        'recognize',
        {
          method: 'POST',
          headers: {
            'Content-Type': file.type,
            'X-Digitus2-Client': '1',
            'X-Digitus2-Job': job,
          },
          body: file,
        },
        RECOGNITION_CEILING,
        (t) => t.scan.errors.timedOut,
        signal,
      );
      if (!response.ok) throw refusal(response.status, body);
      if (typeof body.xml !== 'string' || !body.xml)
        throw new PhraseError((t) => t.scan.client.noResult);
      const recognition: Recognition = { xml: body.xml, warnings: warningsOf(body.warnings) };
      if (typeof body.recognizer === 'string') recognition.recognizer = body.recognizer;
      if (typeof body.capabilities === 'object' && body.capabilities !== null)
        recognition.capabilities = body.capabilities as Recognition['capabilities'] & object;
      return recognition;
    },
    /** Resolves on any answer: a 404 means the job has already finished. */
    async cancel(job: string): Promise<void> {
      // keepalive lets the DELETE outlive a page that is closing mid-scan.
      await send(
        'jobs/' + checked(job),
        { method: 'DELETE', keepalive: true, headers: { 'X-Digitus2-Client': '1' } },
        QUICK_CEILING,
        NO_ANSWER,
      );
    },
  };
}
