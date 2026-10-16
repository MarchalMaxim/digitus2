import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { startStaticServer, resolveStaticAsset } from './static-server.mjs';
const root = resolve('research/omr/results/local-options/security-root');
const sibling = root + '-private';
await mkdir(root + '/research/omr/results/local-options', { recursive: true });
await mkdir(sibling, { recursive: true });
await writeFile(root + '/research/omr/results/local-options/index.html', 'SAFE');
await writeFile(sibling + '/secret.txt', 'MUST_NOT_BE_SERVED');
assert.equal(resolveStaticAsset(root, '/../' + basename(sibling) + '/secret.txt'), null);
const server = await startStaticServer(root, 0);
const port = server.address().port;
function get(path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
try {
  assert.deepEqual(await get('/research/omr/results/local-options/index.html'), {
    status: 200,
    body: 'SAFE',
  });
  for (const path of [
    '/..%2f' + basename(sibling) + '/secret.txt',
    '/../' + basename(sibling) + '/secret.txt',
    '/.git/config',
    '/research/omr/results/local-options/native/twinkle-twinkle-little-star/twinkle-twinkle-little-star.png',
  ]) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.ok(!response.body.includes('MUST_NOT_BE_SERVED'));
  }
  console.log('Static asset containment and encoded sibling traversal regression passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
