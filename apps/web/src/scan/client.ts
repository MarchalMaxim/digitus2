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
      'message' in warning &&
      typeof warning.message === 'string'
    )
      return warning.message;
    return 'The recognizer reported an unknown warning. Check the original carefully.';
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
      throw new Error(
        [409, 429].includes(response.status)
          ? 'The PC is already scanning. Try again shortly.'
          : `PC worker returned ${response.status}.`,
      );
    return response;
  }
  const path = (id: string) => {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid scan job.');
    return 'jobs/' + id;
  };
  return {
    async connect(): Promise<WorkerMetadata> {
      const metadata = metadataOf(await (await request('health')).json());
      if (metadata.protocol !== 'digitus2-scan-v1')
        throw new Error('Update the PC worker to continue.');
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
      if (!job.id) throw new Error('The worker did not return a scan job.');
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
