/**
 * The service worker (issue #35), built to `sw.js` next to index.html as one classic script by
 * vitePlugin.ts, which fills in `__PRECACHE__` (the shell, see precache.ts) and `__VERSION__` (a
 * hash of those files). It installs with the precache and takes control of the open pages on its
 * first activation. A newer build's worker waits until every window of the app has closed, so a
 * page never loses the chunks it was built with; on activation it deletes older precaches and
 * the assets cache's copies of its own precached files, and keeps the scores and samples cached
 * so far. Routing: policy.ts.
 */
import {
  ASSETS_CACHE,
  ASSETS_CACHE_MAX_ENTRIES,
  NAVIGATION_TIMEOUT_MS,
  assetsToPurge,
  isCacheable,
  obsoleteCaches,
  precacheName,
  precacheRequestMode,
  routeRequest,
} from './policy.js';

declare const __PRECACHE__: string[];
declare const __VERSION__: string;

interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
interface ServiceWorkerScope {
  registration: { scope: string };
  clients: { claim(): Promise<void> };
  addEventListener(
    type: 'install' | 'activate',
    listener: (event: ExtendableEventLike) => void,
  ): void;
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
}

const sw = self as unknown as ServiceWorkerScope;
const PRECACHE = precacheName(__VERSION__);
const PRECACHED = new Set(__PRECACHE__);
const scope = sw.registration.scope;
const urlOf = (path: string) => new URL(path, scope).href;

sw.addEventListener('install', (event) => {
  // The unhashed files skip the HTTP cache, so index.html and its chunks come from one build.
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) =>
        cache.addAll(
          __PRECACHE__.map(
            (path) => new Request(urlOf(path), { cache: precacheRequestMode(path) }),
          ),
        ),
      ),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(obsoleteCaches(names, PRECACHE).map((n) => caches.delete(n))))
      .then(purgeAssets)
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event) => {
  const route = routeRequest(event.request, scope, PRECACHED);
  if (route.kind === 'navigate') event.respondWith(navigate(event.request));
  else if (route.kind === 'precache') event.respondWith(fromPrecache(event.request));
  else if (route.kind === 'runtime') event.respondWith(cacheFirst(event, route.cache));
});

/** Deletes from the assets cache the files the precache now holds (policy.ts, assetsToPurge). */
async function purgeAssets(): Promise<void> {
  if (!(await caches.has(ASSETS_CACHE))) return;
  const cache = await caches.open(ASSETS_CACHE);
  // Deleting by the stored requests themselves, so a Vary header cannot keep an entry.
  const keys = await cache.keys();
  const purge = new Set(
    assetsToPurge(
      keys.map((k) => k.url),
      scope,
      PRECACHED,
    ),
  );
  await Promise.all(keys.filter((k) => purge.has(k.url)).map((k) => cache.delete(k)));
}

/** Network first, so an online visit always gets the newest build; offline, the cached shell. */
async function navigate(request: Request): Promise<Response> {
  try {
    return await withTimeout(fetch(request), NAVIGATION_TIMEOUT_MS);
  } catch {
    const cache = await caches.open(PRECACHE);
    return (
      (await cache.match(request, { ignoreSearch: true })) ??
      (await cache.match(urlOf('index.html'))) ??
      Response.error()
    );
  }
}

/**
 * The precache holds one copy of each file, fetched by the installing worker without an Origin
 * header. The page asks for its module scripts and stylesheets with one (`crossorigin`), and
 * `vite preview` answers with `Vary: Origin`, so the match ignores Vary.
 */
async function fromPrecache(request: Request): Promise<Response> {
  return (
    (await caches.match(request, { cacheName: PRECACHE, ignoreSearch: true, ignoreVary: true })) ??
    fetch(request)
  );
}

/** Hashed files never change, and the samples of one release neither: the cache answers first. */
async function cacheFirst(event: FetchEventLike, name: string): Promise<Response> {
  const cache = await caches.open(name);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (isCacheable(response, name)) {
    const copy = response.clone();
    event.waitUntil(
      cache
        .put(event.request, copy)
        .then(() => (name === ASSETS_CACHE ? trim(cache, ASSETS_CACHE_MAX_ENTRIES) : undefined)),
    );
  }
  return response;
}

/** Deletes the oldest entries (a cache lists its keys in insertion order) beyond `max`. */
async function trim(cache: Cache, max: number): Promise<void> {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
