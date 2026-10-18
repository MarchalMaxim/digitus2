/**
 * What the service worker (sw.ts) does with a request, as pure functions so they can be tested
 * without a worker. Only same-origin GET requests inside the worker's scope are answered:
 * navigations network first, then the precached shell; precached files from the precache; other
 * hashed assets (scores and their chunks) and piano samples cache first, kept as they are fetched.
 * Everything else, the scanning worker on 127.0.0.1 included, goes to the network untouched.
 */

export const PRECACHE_PREFIX = 'digitus2-precache-';
/** Hashed build files fetched on demand: score files and their per-score chunks. */
export const ASSETS_CACHE = 'digitus2-assets';
/** At most this many entries stay in ASSETS_CACHE (two per score), the oldest go first. */
export const ASSETS_CACHE_MAX_ENTRIES = 600;
/** The piano samples, named after their release (`tag` in scripts/piano-samples.lock.json). */
export const PIANO_CACHE = 'digitus2-piano-samples-v1';
const PIANO_PREFIX = 'digitus2-piano-samples-';
/** How long a navigation waits for the network before the cached shell answers. */
export const NAVIGATION_TIMEOUT_MS = 4_000;

export type SwRoute =
  | { kind: 'network' }
  | { kind: 'navigate' }
  | { kind: 'precache' }
  | { kind: 'runtime'; cache: string };

const NETWORK: SwRoute = { kind: 'network' };

/** The precache of one build: its version is a hash of the precached files (vitePlugin.ts). */
export function precacheName(version: string): string {
  return `${PRECACHE_PREFIX}${version}`;
}

/** A URL's path relative to the scope, without its query; undefined outside the scope. */
function scopePath(href: string, scope: string): string | undefined {
  const url = new URL(href);
  const base = new URL(scope);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return undefined;
  return url.pathname.slice(base.pathname.length);
}

/** `precached` holds paths relative to the scope, such as `index.html` or `assets/index-abc.js`. */
export function routeRequest(
  request: { url: string; method: string; mode: string },
  scope: string,
  precached: ReadonlySet<string>,
): SwRoute {
  if (request.method !== 'GET') return NETWORK;
  const path = scopePath(request.url, scope);
  if (path === undefined) return NETWORK;
  if (request.mode === 'navigate') return { kind: 'navigate' };
  if (precached.has(path)) return { kind: 'precache' };
  if (path.startsWith('assets/')) return { kind: 'runtime', cache: ASSETS_CACHE };
  if (path.startsWith('piano/')) return { kind: 'runtime', cache: PIANO_CACHE };
  return NETWORK;
}

/**
 * How the installing worker fetches a precached file: hashed `assets/` files through the HTTP
 * cache (a name never changes its content, and the page may have fetched it already), the
 * unhashed ones (index.html, the web app manifest, icons, licenses) past it, so they come from
 * the same build as the hashed files they name.
 */
export function precacheRequestMode(path: string): 'default' | 'reload' {
  return path.startsWith('assets/') ? 'default' : 'reload';
}

/**
 * Whether a fetched response may be kept: a whole (200) response that is not a page, because the
 * Vite servers answer a missing file with index.html and 200; in the piano cache, audio only.
 */
export function isCacheable(
  response: { status: number; headers: { get(name: string): string | null } },
  cache: string,
): boolean {
  if (response.status !== 200) return false;
  const type = (response.headers.get('content-type') ?? '').toLowerCase();
  if (type.startsWith('text/html')) return false;
  return cache !== PIANO_CACHE || type.startsWith('audio/');
}

/**
 * The caches an activating worker deletes: older precaches and an older piano cache. The assets
 * cache stays, so the scores opened so far still open; assetsToPurge thins it.
 */
export function obsoleteCaches(names: readonly string[], currentPrecache: string): string[] {
  return names.filter(
    (name) =>
      (name.startsWith(PRECACHE_PREFIX) && name !== currentPrecache) ||
      (name.startsWith(PIANO_PREFIX) && name !== PIANO_CACHE),
  );
}

/**
 * The entries of ASSETS_CACHE an activating worker deletes: the files its own precache holds.
 * A page of the new build that loaded while the older worker was in control fetched the new
 * shell through the older worker's routes into the assets cache; kept there, those copies (the
 * Verovio worker alone is 8 MB) would push the user's scores out of its 600 entries.
 */
export function assetsToPurge(
  cachedUrls: readonly string[],
  scope: string,
  precached: ReadonlySet<string>,
): string[] {
  return cachedUrls.filter((url) => {
    const path = scopePath(url, scope);
    return path !== undefined && precached.has(path);
  });
}
