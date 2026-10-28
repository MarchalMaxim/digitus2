import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'cli/**/*.test.ts'],
    // A test's time limit only guards against a hang. The textbook oracle, the metamorphic suite and
    // the library tests solve whole corpora, several times slower on a loaded CI runner than on the
    // dev machine; a limit near their honest time fails them for the machine's speed, not for a
    // fault. The solver's speed is gated by the work it does (solve.test.ts), not by a clock.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
