import assert from 'node:assert/strict';
import { request } from 'node:http';
import { serve } from './server.mjs';
const server = await serve(0);
const port = server.address().port;
function call(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
      let bytes = 0;
      res.on('data', (data) => (bytes += data.length));
      res.on('end', () => resolve({ status: res.statusCode, bytes }));
    });
    req.on('error', reject);
    req.end();
  });
}
try {
  for (const path of [
    '/',
    '/input.png',
    '/research/omr/prototypes/oemer-performance/index.html',
    '/research/omr/prototypes/oemer-performance/oemer-worker.mjs',
  ]) {
    const response = await call(path);
    assert.equal(response.status, 200, path);
    assert.ok(response.bytes > 0);
  }
  for (const path of [
    '/.git/config',
    '/AGENTS.md',
    '/research/omr/prototypes/oemer-performance/../oemer/setup.ps1',
    '/research/omr/prototypes/oemer-performance/%2e%2e/oemer/setup.ps1',
    '/research/omr/results/local-options/..%2f..%2f..%2f..%2fAGENTS.md',
  ]) {
    assert.equal((await call(path)).status, 404, path);
  }
  assert.equal((await call('/input.png', 'POST')).status, 404);
  console.log('10 explicit serving/containment/method checks passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
