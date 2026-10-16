import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { resolveStaticAsset } from '../oemer/static-server.mjs';
const ROOT = process.cwd();
export async function serve(port = 8995) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let file;
      if (req.method !== 'GET') throw Error('GET only');
      if (url.pathname === '/favicon.ico') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (url.pathname === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><title>Local browser OMR performance</title>');
        return;
      }
      if (
        /^\/research\/omr\/prototypes\/oemer-performance\/(index\.html|oemer-worker\.mjs)$/.test(
          url.pathname,
        )
      )
        file = url.pathname.slice(1);
      else if (url.pathname.startsWith('/research/omr/results/local-options/')) {
        file = resolveStaticAsset(ROOT, req.url);
        if (!file) throw Error('Unserved');
      } else if (/^\/ort\/[a-zA-Z0-9_.-]+\.(mjs|js|wasm)$/.test(url.pathname))
        file = 'research/omr/results/local-options/ort-web/package/dist/' + url.pathname.slice(5);
      else if (url.pathname === '/model1.onnx')
        file = 'research/omr/results/local-options/1st_model.onnx';
      else if (url.pathname === '/model2.onnx')
        file = 'research/omr/results/local-options/source/oemer/checkpoints/seg_net/model.onnx';
      else if (url.pathname === '/input.png')
        file = 'research/omr/results/fixtures-final/twinkle-twinkle-little-star/page-001-clean.png';
      else throw Error('Unserved');
      res.setHeader(
        'Content-Type',
        {
          '.html': 'text/html',
          '.json': 'application/json',
          '.mjs': 'text/javascript',
          '.js': 'text/javascript',
          '.wasm': 'application/wasm',
          '.png': 'image/png',
        }[extname(file)] || 'application/octet-stream',
      );
      res.end(await readFile(resolve(ROOT, file)));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((r, j) => {
    server.once('error', j);
    server.listen(port, '127.0.0.1', r);
  });
  return server;
}
