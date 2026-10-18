import { PhraseError } from '../i18n/PhraseError.js';

/**
 * Kept in the saved warnings as this English marker; the review writes it in the language on
 * screen (ScanView.tsx).
 */
export const UNKNOWN_WARNING =
  'The recognizer reported an unknown warning. Check the original carefully.';
/**
 * The worker found a piano page read as one staff with alternating clefs: the hands are not
 * separated. Kept as this marker so the review can show it, translated, above the comparison.
 */
export const GRAND_STAFF_WARNING =
  'The staves were not paired into a grand staff, so the hands are not separated.';

/** Explicit-action-only connection to the optional PC worker. */
export interface WorkerMetadata {
  protocol?: string;
  state?: string;
  failure?: { code: string; message: string; details?: { interlinePixels?: number } };
  id?: string;
  recognizer?: string;
  warnings?: string[];
  capabilities?: { textModelConfigured?: boolean };
  maxUploadBytes?: number;
}
function metadataOf(
  value: Omit<WorkerMetadata, 'warnings'> & { warnings?: unknown[] },
): WorkerMetadata {
  const warnings = (value.warnings ?? []).map((warning: unknown) => {
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
  return { ...value, warnings };
}
export function createScanClient(fetcher: typeof fetch = fetch) {
  async function request(path: string, init: RequestInit = {}) {
    const options: RequestInit & { targetAddressSpace: string } = {
      mode: 'cors',
      credentials: 'omit',
      targetAddressSpace: 'loopback',
      signal: AbortSignal.timeout(10000),
      ...init,
    };
    const response = await fetcher('http://127.0.0.1:8996/v1/' + path, options);
    if (!response.ok)
      throw new PhraseError((t) =>
        [409, 429].includes(response.status)
          ? t.scan.client.busy
          : t.scan.client.workerStatus(response.status),
      );
    return response;
  }
  const path = (id: string) => {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new PhraseError((t) => t.scan.client.invalidJob);
    return 'jobs/' + id;
  };
  return {
    async connect(): Promise<WorkerMetadata> {
      const metadata = metadataOf(await (await request('health')).json());
      if (metadata.protocol !== 'digitus2-scan-v1')
        throw new PhraseError((t) => t.scan.client.updateWorker);
      return metadata;
    },
    async start(file: File): Promise<string> {
      const job = (await (
        await request('jobs', {
          method: 'POST',
          headers: { 'Content-Type': file.type, 'X-Digitus2-Client': '1' },
          body: file,
        })
      ).json()) as WorkerMetadata;
      if (!job.id) throw new PhraseError((t) => t.scan.client.noJob);
      path(job.id);
      return job.id;
    },
    async status(id: string): Promise<WorkerMetadata> {
      return metadataOf(await (await request(path(id))).json());
    },
    async result(id: string): Promise<string> {
      return (await request(path(id) + '/result')).text();
    },
    async cancel(id: string): Promise<void> {
      await request(path(id), { method: 'DELETE', headers: { 'X-Digitus2-Client': '1' } });
    },
  };
}
