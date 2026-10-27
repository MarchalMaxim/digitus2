import { defineConfig, devices } from '@playwright/test';

// DIGITUS2_E2E_PORT lets two checkouts (worktrees) run the e2e suite at the same time; each needs its own preview server.
const port = Number(process.env.DIGITUS2_E2E_PORT ?? 4173);
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } };
const phone = { ...desktop, viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true };
const LOOP_SPEC = /scan-camera-loop\.spec\.ts/;
/** The loop project exists only when asked for: Playwright's workers read the config again. */
const loopAsked = !!process.env.DIGITUS2_E2E_LOOP;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  // Under CI also an HTML report (with the traces of failed tests) in playwright-report/, which
  // the workflow uploads when a test fails; the 'github' reporter alone writes no files.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    // The production build registers a service worker (src/app/serviceWorker.ts). Page routes do
    // not see the requests a service worker answers, so every spec blocks it; e2e/pwa.spec.ts
    // alone allows it.
    serviceWorkers: 'block',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
  },
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: desktop, testIgnore: LOOP_SPEC },
    {
      name: 'mobile',
      use: phone,
      testMatch:
        /(library|states|hand-letters|keyboard-view|scan|scan-rotation|scan-edit|scan-linked|scan-phone|scan-camera|scan-grand-staff|seek|embellish|page-window|play-along)\.spec\.ts/,
    },
    // The camera loop (issue 156): local homr reads the page the camera made, and its threads slow
    // every other spec's timing (the throttled sweeps, K.545 within 8 s), so the loop is a project
    // of its own that exists only when asked for (DIGITUS2_E2E_LOOP, then `--project=loop`), and
    // `pnpm verify` runs it alone, after `e2e`, as its `e2e:loop` step.
    ...(loopAsked ? [{ name: 'loop', use: phone, testMatch: LOOP_SPEC }] : []),
    // The score camera on Safari's engine (issue 145): an iPhone has no other. Playwright's WebKit
    // for Windows has no video streams at all, so this project runs on Linux and macOS (CI, or
    // `node scripts/e2e-webkit.mjs`, in Docker, on a Windows host). It also holds the one test
    // that needs a browser without Web MIDI (issue 182): the library shows no piano line.
    ...(process.platform === 'win32'
      ? []
      : [
          {
            name: 'iphone',
            use: { ...devices['iPhone 15'], launchOptions: { args: [] } },
            testMatch: /(scan-camera(-real)?|scan-grand-staff|play-along-home)\.spec\.ts/,
          },
        ]),
  ],
});
