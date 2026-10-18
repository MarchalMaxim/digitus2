/**
 * Builds the service worker (sw.ts) into `sw.js` after every production build (`vite build`,
 * whatever runs it: `pnpm build`, the e2e script, the Pages workflow with `--base`). Once the
 * bundle is on disk it lists the precache from the files written (precache.ts), hashes them into a
 * version, and builds sw.ts as one classic script with both filled in, so a new build installs a
 * new worker. The build fails when the precache grows past PRECACHE_MAX_BYTES.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build, type Plugin, type ResolvedConfig } from 'vite';
import { PRECACHE_MAX_BYTES, precacheList, type BuildManifest } from './precache.js';

function walk(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

export function serviceWorkerPlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'digitus2:service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      if (config.build.ssr) return;
      const outDir = resolve(config.root, config.build.outDir);
      const manifestPath = join(outDir, '.vite', 'manifest.json');
      // Rolldown calls closeBundle after a failed build too; its error is the one to show.
      if (!existsSync(manifestPath)) return;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BuildManifest;
      const files = precacheList(walk(outDir), manifest);
      if (!files.includes('index.html'))
        throw new Error('service worker: no index.html in the build');
      const version = createHash('sha256');
      let bytes = 0;
      for (const file of files) {
        const data = readFileSync(join(outDir, file));
        bytes += data.length;
        version.update(`${file}\n${createHash('sha256').update(data).digest('hex')}\n`);
      }
      if (bytes > PRECACHE_MAX_BYTES)
        throw new Error(
          `service worker: the precache is ${mib(bytes)} MiB, over ${mib(PRECACHE_MAX_BYTES)} MiB; ` +
            'is a score or sample folder no longer excluded? (src/sw/precache.ts)',
        );
      const hash = version.digest('hex').slice(0, 12);
      await build({
        configFile: false,
        root: config.root,
        logLevel: 'warn',
        define: { __PRECACHE__: JSON.stringify(files), __VERSION__: JSON.stringify(hash) },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          manifest: false,
          sourcemap: false,
          minify: true,
          target: 'es2022',
          lib: {
            entry: join(config.root, 'src/sw/sw.ts'),
            formats: ['iife'],
            name: 'digitus2ServiceWorker',
            fileName: () => 'sw.js',
          },
        },
      });
      config.logger.info(
        `service worker: ${files.length} files, ${mib(bytes)} MiB precached, version ${hash}`,
      );
    },
  };
}
