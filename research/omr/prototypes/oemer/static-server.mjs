import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, extname } from 'node:path';
const BASE = 'research/omr/results/local-options/';
const EXACT = new Set([
  'index.html',
  'oemer-worker.mjs',
  'oemer-tree.json',
  'reconstruct-browser-full.py',
  '1st_model.onnx',
  'source/oemer/checkpoints/seg_net/model.onnx',
]);
function isInside(root, path) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../') && !isAbsolute(rel);
}
export function resolveStaticAsset(root, requestUrl) {
  const decoded = decodeURIComponent(requestUrl.split('?')[0]);
  const path = resolve(root, '.' + decoded);
  if (!isInside(root, path)) return null;
  const rel = relative(root, path).replaceAll('\\', '/');
  if (!rel.startsWith(BASE)) return null;
  const asset = rel.slice(BASE.length);
  const allowed =
    EXACT.has(asset) ||
    /^source\/oemer\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.py$/.test(asset) ||
    /^safe-svc\/(clef|rests|rests_above8|sfn)\.(json|npz)$/.test(asset) ||
    /^ort-web\/package\/dist\/[a-zA-Z0-9_.-]+\.(js|mjs|wasm)$/.test(asset);
  return allowed ? path : null;
}
export async function startStaticServer(root, port = 8994) {
  const server = createServer(async (req, res) => {
    try {
      const path = resolveStaticAsset(root, req.url);
      if (!path) throw Error('Unserved path');
      res.setHeader(
        'Content-Type',
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.mjs': 'text/javascript',
          '.wasm': 'application/wasm',
          '.json': 'application/json',
        }[extname(path)] || 'application/octet-stream',
      );
      res.end(await readFile(path));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}
