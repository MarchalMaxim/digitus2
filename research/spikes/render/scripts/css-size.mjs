// THROWAWAY spike: CSS output size, Tailwind v4 (utilities + preflight) vs vanilla CSS for the same small UI.
import { build } from 'vite';
import tailwind from '@tailwindcss/vite';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const [name, entry, plugins] of [['tailwind v4', 'bundle/css/tailwind-probe.ts', [tailwind()]], ['vanilla css', 'bundle/css/vanilla-probe.ts', []]]) {
  const outDir = join(root, 'dist-sizes', name.replace(/\W+/g, '_'));
  await build({ root, configFile: false, logLevel: 'error', plugins, build: { outDir, emptyOutDir: true, minify: true, cssMinify: true, rollupOptions: { input: { probe: join(root, entry) } } } });
  const css = readdirSync(join(outDir, 'assets')).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(outDir, 'assets', f)));
  const raw = css.reduce((a, b) => a + b.length, 0), gz = css.reduce((a, b) => a + gzipSync(b, { level: 9 }).length, 0);
  console.log(name.padEnd(12), (raw / 1024).toFixed(1), 'KiB min css', (gz / 1024).toFixed(1), 'KiB gz');
}
rmSync(join(root, 'dist-sizes'), { recursive: true, force: true });
