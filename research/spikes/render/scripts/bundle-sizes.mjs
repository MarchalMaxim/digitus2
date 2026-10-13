// THROWAWAY spike: production bundle size per library (Vite 8 build, minified), gzip -9 and brotli -11.
//   node scripts/bundle-sizes.mjs [filter]
// Each probe in bundle/*.ts imports one library (or one usage pattern) and keeps the imports alive.
// Everything the build emits is counted: JS chunks, lazily imported chunks, WASM, fonts, worklets.
import { build } from 'vite';
import { readFileSync, readdirSync, statSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entries = JSON.parse(readFileSync(join(root, 'bundle/entries.json'), 'utf8'));
const filter = process.argv[2];

// same tweaks as vite.config.ts so @tonejs/piano resolves tone@14 and the Node 'events' polyfill
const tonejsPianoUsesTone14 = {
  name: 'tonejs-piano-uses-tone14', enforce: 'pre',
  async resolveId(source, importer) {
    if (importer && /[\\/]@tonejs[\\/]piano[\\/]/.test(importer) && (source === 'tone' || source.startsWith('tone/')))
      return this.resolve(source.replace(/^tone/, 'tone14'), join(root, 'index.html'), { skipSelf: true });
  },
};

function walk(dir) { return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); }

const rows = [];
for (const [name, file] of Object.entries(entries)) {
  if (filter && !name.includes(filter)) continue;
  const outDir = join(root, 'dist-sizes', name.replace(/[^a-z0-9]+/gi, '_'));
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  try {
    await build({
      root, configFile: false, logLevel: 'error',
      plugins: [tonejsPianoUsesTone14],
      resolve: { alias: { events: join(root, 'node_modules/events/events.js') } },
      build: {
        outDir, emptyOutDir: true, target: 'es2022', minify: true, modulePreload: false, assetsInlineLimit: 0,
        reportCompressedSize: false, chunkSizeWarningLimit: 1e9, copyPublicDir: false,
        rollupOptions: { input: { probe: join(root, file) } },
      },
    });
    const files = walk(outDir);
    let raw = 0, gz = 0, br = 0;
    const parts = [];
    for (const f of files) {
      const buf = readFileSync(f);
      const g = gzipSync(buf, { level: 9 }).length;
      const b = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
      raw += buf.length; gz += g; br += b;
      parts.push({ file: f.slice(outDir.length + 1).replace(/\\/g, '/'), raw: buf.length, gzip: g });
    }
    rows.push({ name, files: files.length, raw, gzip: gz, brotli: br, parts });
    console.log(name.padEnd(46), String(files.length).padStart(3), 'files', (raw / 1024).toFixed(1).padStart(9), 'KiB min', (gz / 1024).toFixed(1).padStart(8), 'KiB gz', (br / 1024).toFixed(1).padStart(8), 'KiB br');
  } catch (e) {
    rows.push({ name, error: String(e).slice(0, 500) });
    console.log(name.padEnd(46), 'BUILD FAILED', String(e).slice(0, 200));
  }
}
mkdirSync(join(root, 'results'), { recursive: true });
const out = join(root, 'results', 'bundle-sizes.json');
let prev = {};
try { prev = JSON.parse(readFileSync(out, 'utf8')); } catch { /* first run */ }
for (const r of rows) prev[r.name] = r;
writeFileSync(out, JSON.stringify(prev, null, 1));
rmSync(join(root, 'dist-sizes'), { recursive: true, force: true });
