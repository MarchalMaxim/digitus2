import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { ASSETS_CACHE, PIANO_CACHE, PRECACHE_PREFIX } from '../src/sw/policy.js';
import { PIANO_SAMPLES, silentWav } from './helpers/samples.js';

// The installable, offline app (issues #35 and #51). This spec alone lets the app register its
// service worker; every other spec blocks it (playwright.config.ts).
test.use({ serviceWorkers: 'allow' });

const TWINKLE = '#/piece/twinkle-twinkle-little-star';
const DIGITS = '.score-sheet g.fing';
/** A hashed-looking file no build has: the worker routes it cache first, so it goes to the network. */
const MISSING_ASSET = '/assets/missing-x.js';

/**
 * Waits until the service worker is active and controls the page, with its precache complete
 * (the shell, index.html included, is kept).
 */
async function controlled(page: Page): Promise<string> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  let precache = '';
  await expect
    .poll(async () => {
      precache = await page.evaluate(
        async (prefix) => (await caches.keys()).find((name) => name.startsWith(prefix)) ?? '',
        PRECACHE_PREFIX,
      );
      return precache === '' ? [] : cachedPaths(page, precache);
    })
    .toContain('/index.html');
  return precache;
}

/** The paths kept in one of the app's caches. */
function cachedPaths(page: Page, name: string): Promise<string[]> {
  return page.evaluate(
    async (cacheName) =>
      (await (await caches.open(cacheName)).keys()).map((r) => new URL(r.url).pathname),
    name,
  );
}

/**
 * Takes the browser offline. Chromium lets a service worker's own fetches reach the network again
 * after the page reloads, whatever the context's offline mode, so a route also fails every request
 * that still reaches the network. Returns their paths, filled in as they arrive.
 */
async function goOffline(context: BrowserContext): Promise<string[]> {
  const reached: string[] = [];
  await context.setOffline(true);
  await context.route(
    () => true,
    (route) => {
      const url = new URL(route.request().url());
      reached.push(`${url.pathname}${url.search}`);
      return route.abort('internetdisconnected');
    },
  );
  return reached;
}

/**
 * Asserts that offline, nothing but the navigations (answered by the cached shell once they
 * fail), the control fetches and the browser's update check of sw.js tried the network.
 */
function expectOnlyNavigationsReached(reached: readonly string[]): void {
  expect(reached, 'the control fetch reached the network and failed').toContain(MISSING_ASSET);
  expect(
    reached.filter((p) => !/^\/(?:\?[^/]*)?$/.test(p) && p !== MISSING_ASSET && p !== '/sw.js'),
    'requests the caches did not answer',
  ).toEqual([]);
}

/**
 * Whether a fetch of a file the worker sends to the network succeeds: online, the preview answers
 * it (with its page); offline, it fails.
 */
function fetchMissingAsset(page: Page): Promise<'resolved' | 'rejected'> {
  return page.evaluate(
    (url) =>
      fetch(url).then(
        () => 'resolved' as const,
        () => 'rejected' as const,
      ),
    MISSING_ASSET,
  );
}

test('the page links a manifest that installs the app full screen with its icons', async ({
  page,
}) => {
  await page.goto('/');
  const link = page.locator('link[rel="manifest"]');
  await expect(link).toHaveAttribute('href', '/manifest.webmanifest');
  const manifestUrl = new URL('/manifest.webmanifest', page.url());
  const response = await page.request.get(manifestUrl.href);
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    [key: string]: unknown;
    start_url: string;
    icons: { src: string; sizes: string }[];
  };
  expect(manifest).toMatchObject({ name: 'digitus2', display: 'standalone', scope: './' });
  expect(new URL(manifest.start_url, manifestUrl).href).toBe(new URL('/', page.url()).href);
  for (const icon of manifest.icons) {
    const png = await page.request.get(new URL(icon.src, manifestUrl).href);
    expect(png.ok(), icon.src).toBe(true);
    expect(png.headers()['content-type'], icon.src).toBe('image/png');
    const body = await png.body();
    expect(`${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`, icon.src).toBe(icon.sizes);
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/icons/apple-touch-icon.png',
  );
});

test('the first visit installs a service worker that controls the page, with no console error', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await controlled(page);
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      scope: registration.scope,
      script: registration.active?.scriptURL ?? '',
      caches: await caches.keys(),
    };
  });
  expect(worker.scope).toBe(new URL('/', page.url()).href);
  expect(worker.script).toBe(new URL('/sw.js', page.url()).href);
  expect(worker.caches.some((name) => name.startsWith(PRECACHE_PREFIX))).toBe(true);
  expect(errors).toEqual([]);
});

test('a library piece opened once opens again offline, after a reload', async ({
  page,
  context,
}) => {
  await page.goto('/?audio=silent');
  await controlled(page);
  await page.goto(`/?audio=silent${TWINKLE}`);
  await expect(page.locator(DIGITS)).toHaveCount(64, { timeout: 20_000 });
  // The score came through the service worker, which kept it.
  await expect
    .poll(() => cachedPaths(page, ASSETS_CACHE))
    .toContainEqual(expect.stringMatching(/twinkle-twinkle-little-star[^/]*\.(?:musicxml|gz)$/));
  expect(await fetchMissingAsset(page), 'online, the network answers').toBe('resolved');

  const reached = await goOffline(context);
  expect(await fetchMissingAsset(page), 'offline, the network fails').toBe('rejected');
  // The reload asks for /?audio=silent: the worker answers it with the precached index.html.
  const reloaded = await page.reload();
  expect(reloaded?.fromServiceWorker(), 'the shell came from the service worker').toBe(true);
  expect(new URL(page.url()).search).toBe('?audio=silent');
  await expect(page.locator(DIGITS)).toHaveCount(64, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  expect(await fetchMissingAsset(page), 'still offline').toBe('rejected');
  expectOnlyNavigationsReached(reached);
});

test('the piano plays offline from the samples kept on the first Play', async ({
  page,
  context,
}) => {
  const served: { url: string; byWorker: boolean }[] = [];
  await context.route(PIANO_SAMPLES, (route) => {
    served.push({ url: route.request().url(), byWorker: route.request().serviceWorker() !== null });
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav() });
  });
  await page.goto('/');
  await controlled(page);
  await page.goto(`/${TWINKLE}`);
  await expect(page.locator(DIGITS)).toHaveCount(64, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
  expect(served.length, 'piano samples fetched').toBeGreaterThan(0);
  expect(
    served.every((s) => s.byWorker),
    'fetched by the service worker',
  ).toBe(true);
  // Every sample fetched is kept (the expected set is read again on each poll, in case a fetch
  // still lands after Pause).
  await expect
    .poll(async () => {
      const kept = (await cachedPaths(page, PIANO_CACHE)).sort();
      const fetched = [...new Set(served.map((s) => new URL(s.url).pathname))].sort();
      return JSON.stringify(kept) === JSON.stringify(fetched) ? 'all kept' : { kept, fetched };
    })
    .toBe('all kept');

  await context.unroute(PIANO_SAMPLES);
  // The samples are in public/piano too: offline, the worker must answer them from its cache.
  const reached = await goOffline(context);
  expect(await fetchMissingAsset(page), 'offline, the network fails').toBe('rejected');
  await page.reload();
  await expect(page.locator(DIGITS)).toHaveCount(64, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/piano sounds could not be loaded/)).toHaveCount(0);
  expect(await fetchMissingAsset(page), 'still offline').toBe('rejected');
  expectOnlyNavigationsReached(reached);
});

test("a newer worker, once activated, deletes the older precaches and the assets cache's copies of its shell", async ({
  page,
  context,
}) => {
  await page.goto('/');
  const current = await controlled(page);
  const shellFile = (await cachedPaths(page, current)).find((p) => /^\/assets\/.+\.js$/.test(p));
  expect(shellFile, 'a precached script').toBeDefined();
  // As if an older build had left its precache and an older piano cache, and an older worker had
  // kept a file of the newer shell at runtime, next to a score's chunk.
  const OLDER_PRECACHE = `${PRECACHE_PREFIX}e2e0older000`;
  const OLDER_PIANO = 'digitus2-piano-samples-v0';
  const KEPT = '/assets/kept-x.js';
  await page.evaluate(
    async ({ assets, paths, older }) => {
      const js = () => new Response('', { headers: { 'content-type': 'text/javascript' } });
      const open = await caches.open(assets);
      for (const path of paths) await open.put(path, js());
      for (const name of older) await (await caches.open(name)).put('/index.html', js());
    },
    { assets: ASSETS_CACHE, paths: [shellFile!, KEPT], older: [OLDER_PRECACHE, OLDER_PIANO] },
  );
  expect((await cachedPaths(page, ASSETS_CACHE)).sort()).toEqual([KEPT, shellFile!].sort());

  // The newer worker is the same sw.js at another script URL, which the browser installs as a new
  // worker. It is served by the preview as it is, not changed by a route: the browser checks a
  // worker's script for updates with fetches a route does not see, and a script that differed from
  // what the preview serves would install yet another worker.
  const NEWER_SCRIPT = '/sw.js?newer=1';
  const newerWorker = context.waitForEvent('serviceworker', {
    predicate: (worker) => worker.url().endsWith(NEWER_SCRIPT),
    timeout: 30_000,
  });
  const installed = await page.evaluate(async (scriptUrl) => {
    const registration = await navigator.serviceWorker.register(scriptUrl, {
      scope: '/',
      updateViaCache: 'none',
    });
    const worker = registration.installing ?? registration.waiting;
    if (!worker) return 'no new worker';
    if (worker.state === 'installed') return 'installed';
    return new Promise<string>((resolve) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' || worker.state === 'redundant') resolve(worker.state);
      });
    });
  }, NEWER_SCRIPT);
  expect(installed).toBe('installed');
  const worker = await newerWorker;

  // It waits while a page of the app is open and activates once none is; its activate handler has
  // finished when its state reads "activated". The caches are read in the worker itself, so no
  // page of the site opens again (the app would register /sw.js again).
  await expect(async () => {
    await page.goto('about:blank');
    const state = await worker.evaluate(() => {
      const scope = self as unknown as {
        serviceWorker: ServiceWorker;
        registration: ServiceWorkerRegistration;
      };
      return {
        state: scope.serviceWorker.state,
        active: scope.registration.active === scope.serviceWorker,
        waiting: scope.registration.waiting !== null,
        installing: scope.registration.installing !== null,
      };
    });
    expect(state).toEqual({ state: 'activated', active: true, waiting: false, installing: false });
  }).toPass({ timeout: 30_000 });
  const left = await worker.evaluate(
    async ({ assets }) => ({
      caches: (await caches.keys()).sort(),
      assets: (await (await caches.open(assets)).keys()).map((r) => new URL(r.url).pathname),
    }),
    { assets: ASSETS_CACHE },
  );
  expect(left).toEqual({ caches: [ASSETS_CACHE, current].sort(), assets: [KEPT] });
});
