import { defineConfig } from 'vitest/config';

// The orientation benchmark (issue 165): Chromium renders and decodes the images, the module
// under test is pure TypeScript. Not part of `pnpm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/scan/camera/orientation.benchmark.ts'],
    testTimeout: 120_000,
    hookTimeout: 600_000,
    pool: 'forks',
  },
});
