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
