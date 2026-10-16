/** Optional loopback connector. Call from an explicit user action, never on page load. */
export function createLocalWorkerClient(endpoint = 'http://127.0.0.1:8996') {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('An explicit loopback HTTP endpoint is required');
  }
  const base = url.origin;
  const idPath = (id) => {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid job ID');
    return '/v1/jobs/' + id;
  };
  async function request(path, options = {}) {
    const response = await fetch(base + path, {
      mode: 'cors',
      credentials: 'omit',
      targetAddressSpace: 'loopback',
      signal: AbortSignal.timeout(10000),
      ...options,
    });
    if (!response.ok) {
      const error = new Error('Local worker HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    return response;
  }
  let limits;
  const client = {
    async health() {
      const response = await request('/v1/health');
      const health = { ...(await response.json()), httpStatus: response.status };
      if (health.protocol !== 'digitus2-scan-v1') throw new Error('Incompatible local worker');
      limits = health;
      return health;
    },
    async start(file) {
      if (!limits) await client.health();
      if (!file.size || file.size > limits.maxUploadBytes)
        throw new Error('Scan exceeds worker upload limit');
      if (!['image/png', 'image/jpeg', 'application/pdf'].includes(file.type))
        throw new Error('Choose a PNG, JPEG or PDF');
      const response = await request('/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'X-Digitus2-Client': '1' },
        body: file,
      });
      return { ...(await response.json()), httpStatus: response.status };
    },
    async status(id) {
      return (await request(idPath(id))).json();
    },
    async cancel(id) {
      return (
        await request(idPath(id), { method: 'DELETE', headers: { 'X-Digitus2-Client': '1' } })
      ).json();
    },
    async result(id) {
      const metadata = await client.status(id);
      const response = await request(idPath(id) + '/result');
      const xml = await response.text();
      return {
        xml,
        needsReview: true,
        warnings: metadata.warnings ?? [],
        capabilities: metadata.capabilities ?? {},
        httpStatus: response.status,
      };
    },
    async wait(id, { signal, timeoutMs = 190000, onProgress = () => {} } = {}) {
      const deadline = performance.now() + timeoutMs;
      try {
        while (true) {
          signal?.throwIfAborted();
          if (performance.now() > deadline) throw new Error('Local recognition timed out');
          const status = await client.status(id);
          onProgress(status);
          if (status.state === 'ready') return status;
          if (['failed', 'cancelled', 'timed_out'].includes(status.state))
            throw new Error('Local recognition ' + status.state);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        await client.cancel(id).catch(() => {});
        throw error;
      }
    },
  };
  return client;
}
