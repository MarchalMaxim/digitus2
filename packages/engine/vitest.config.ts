import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'cli/**/*.test.ts'],
    // The textbook oracle, the metamorphic suite and the library tests solve whole corpora; on the
    // GitHub runner they take two to three times longer than on the dev machine and crossed
    // vitest's 5 s default (2026-10-14). Speed is gated by the benchmark's ms-per-1000-notes floor,
    // not here.
    testTimeout: 20_000,
  },
});
