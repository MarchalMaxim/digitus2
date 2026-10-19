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

/** The protocol this client speaks; a service on another one needs the page reloaded. */
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
  if (status === 429 && body.error === 'rate-limited')
    return new PhraseError((t) => t.scan.client.limited);
  // A 429 from the service or a 503 from the host in front of it: someone else's score.
  if (status === 429 || status === 503) return new PhraseError((t) => t.scan.client.busy);
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
const offline: Phrase = (t) => t.scan.errors.offline;

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
      throw new PhraseError(controller.signal.aborted ? late : offline);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', follow);
    }
  }
  return {
    async health(): Promise<ScanServiceMetadata> {
      const { response, body } = await send('health', {}, QUICK_CEILING, offline);
      if (!response.ok) throw refusal(response.status, body);
      if (body.protocol !== PROTOCOL) throw new PhraseError((t) => t.scan.client.outdated);
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
        offline,
      );
    },
  };
}
