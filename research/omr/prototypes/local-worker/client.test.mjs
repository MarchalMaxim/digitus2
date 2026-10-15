import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalWorkerClient } from './client.mjs';
const id = 'a'.repeat(32);

test('reject nonloopback endpoints and invalid IDs before networking', async () => {
  for (const endpoint of [
    'https://127.0.0.1:8996',
    'http://evil.example',
    'http://127.0.0.1:8996/path',
    'http://user@localhost:8996',
  ]) {
    assert.throws(() => createLocalWorkerClient(endpoint));
  }
  await assert.rejects(createLocalWorkerClient().status('../elsewhere'));
});

test('upload and result preserve protocol limits and unreviewed status', async (t) => {
  const original = globalThis.fetch;
  t.after(() => (globalThis.fetch = original));
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/health'))
      return Response.json({ protocol: 'digitus2-scan-v1', maxUploadBytes: 10 });
    if (options.method === 'POST') return Response.json({ id, needsReview: true }, { status: 202 });
    if (url.endsWith('/v1/jobs/' + id))
      return Response.json({
        state: 'ready',
        warnings: [{ code: 'ocr-language-not-configured' }],
        capabilities: { textModelConfigured: false },
      });
    return new Response('<score-partwise/>');
  };
  const client = createLocalWorkerClient();
  await assert.rejects(client.start(new Blob(['x'.repeat(11)], { type: 'image/png' })));
  const job = await client.start(new Blob(['x'], { type: 'image/png' }));
  assert.equal(job.httpStatus, 202);
  const result = await client.result(id);
  assert.equal(result.needsReview, true);
  assert.equal(result.warnings[0].code, 'ocr-language-not-configured');
  for (const { options } of calls) {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.targetAddressSpace, 'loopback');
  }
  assert.equal(
    calls.find((c) => c.options.method === 'POST').options.headers['X-Digitus2-Client'],
    '1',
  );
});

test('aborted wait explicitly cancels native job rather than only abandoning polling', async (t) => {
  const original = globalThis.fetch;
  t.after(() => (globalThis.fetch = original));
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(options.method);
    return Response.json({ state: 'cancelled' });
  };
  const control = new AbortController();
  control.abort();
  await assert.rejects(createLocalWorkerClient().wait(id, { signal: control.signal }));
  assert.deepEqual(calls, ['DELETE']);
});

test('terminal recognition failure cannot become a successful result', async (t) => {
  const original = globalThis.fetch;
  t.after(() => (globalThis.fetch = original));
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(options.method ?? 'GET');
    return Response.json({ state: 'failed' });
  };
  await assert.rejects(createLocalWorkerClient().wait(id), /failed/);
  assert.deepEqual(calls, ['GET', 'DELETE']);
});
