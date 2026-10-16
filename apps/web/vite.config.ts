import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const engineSrc = fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url));
const ornamentSrc = fileURLToPath(
  new URL('../../packages/engine/src/score/ornaments.ts', import.meta.url),
);
const scoreBuildSrc = fileURLToPath(
  new URL('../../packages/engine/src/score/build.ts', import.meta.url),
);
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [react()],
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
  },
});
