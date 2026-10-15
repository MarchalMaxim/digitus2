import { defineConfig, devices } from '@playwright/test';

// DIGITUS2_E2E_PORT lets two checkouts (worktrees) run the e2e suite at the same time; each needs its own preview server.
const port = Number(process.env.DIGITUS2_E2E_PORT ?? 4173);
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } };

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  // Under CI also an HTML report (with the traces of failed tests) in playwright-report/, which
  // the workflow uploads when a test fails; the 'github' reporter alone writes no files.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
  },
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: desktop, testIgnore: /visual\.spec\.ts/ },
    {
      name: 'mobile',
      use: { ...desktop, viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
      testMatch: /(library|states|hand-letters|scan)\.spec\.ts/,
    },
    ...(process.env.CI ? [] : [{ name: 'visual', use: desktop, testMatch: /visual\.spec\.ts/ }]),
  ],
});
