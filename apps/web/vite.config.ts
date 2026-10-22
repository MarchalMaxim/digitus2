import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { serviceWorkerPlugin } from './src/sw/vitePlugin.js';

const engineSrc = fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url));
const ornamentSrc = fileURLToPath(
  new URL('../../packages/engine/src/score/ornaments.ts', import.meta.url),
);
const scoreBuildSrc = fileURLToPath(
  new URL('../../packages/engine/src/score/build.ts', import.meta.url),
);
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The build the app reports about itself (src/app/build.ts): the short commit and the time of
 * this build. GitHub Pages builds with GITHUB_SHA; anywhere else the checkout answers, and
 * without git (or outside a checkout) the commit is 'dev'. It never fails the build or a test run.
 */
function buildStamp(): { commit: string; date: string } {
  let commit = process.env.GITHUB_SHA?.slice(0, 7) ?? '';
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short=7 HEAD', {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      }).trim();
    } catch {
      commit = '';
    }
  }
  return { commit: commit || 'dev', date: new Date().toISOString() };
}

/**
 * Says once, in `vite dev` and `vite build`, when the piano samples are not in public/piano
 * (`node scripts/fetch-piano-samples.mjs` puts them there). Without them Play says the piano
 * sounds could not be loaded; `?audio=silent` plays without them.
 */
function pianoSamplesNotice(): Plugin {
  return {
    name: 'digitus2:piano-samples-notice',
    // ResolvedConfig has no isPreview in Vite 8; the plugin's apply hook gets it in ConfigEnv.
    apply: (_config, env) => !env.isPreview,
    configResolved(config) {
      if (process.env.VITEST || !config.publicDir) return;
      if (existsSync(join(config.publicDir, 'piano', 'manifest.json'))) return;
      config.logger.warn(
        'No piano samples in public/piano: run `node scripts/fetch-piano-samples.mjs` to hear the piano.',
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), pianoSamplesNotice(), serviceWorkerPlugin()],
  define: { __DIGITUS2_BUILD__: JSON.stringify(buildStamp()) },
  resolve: {
    alias: {
      '@digitus2/engine/ornaments': ornamentSrc,
      '@digitus2/engine/score-build': scoreBuildSrc,
      '@digitus2/engine': engineSrc,
    },
  },
  server: { fs: { allow: [repoRoot] } },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, manifest: true },
  test: {
    environment: 'happy-dom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Two thirds of the suite's time is starting a worker, its happy-dom and the setup file for
    // each of the 75 files, not running tests. A thread starts faster than a forked process
    // (30 s to 25 s for the suite on the dev machine); every file still gets its own module graph.
    pool: 'threads',
  },
});
