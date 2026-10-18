import { describe, expect, it } from 'vitest';
import lock from '../../../../scripts/piano-samples.lock.json';
import {
  ASSETS_CACHE,
  PIANO_CACHE,
  assetsToPurge,
  isCacheable,
  obsoleteCaches,
  precacheName,
  precacheRequestMode,
  routeRequest,
} from './policy.js';

const PAGES = 'https://marchalmaxim.github.io/digitus2/';
const precached = new Set(['index.html', 'assets/index-abc.js', 'manifest.webmanifest']);
const get = (url: string, mode = 'cors') => ({ url, method: 'GET', mode });
const response = (status: number, type: string) => ({
  status,
  type: 'basic',
  headers: new Headers({ 'content-type': type }),
});

describe('the service worker routes', () => {
  it('answers navigations inside its scope, the query included, network first', () => {
    expect(routeRequest(get(`${PAGES}?audio=silent`, 'navigate'), PAGES, precached)).toEqual({
      kind: 'navigate',
    });
    expect(
      routeRequest(get('https://marchalmaxim.github.io/other/', 'navigate'), PAGES, precached),
    ).toEqual({ kind: 'network' });
  });

  it('serves the precached shell from the precache', () => {
    expect(routeRequest(get(`${PAGES}assets/index-abc.js`), PAGES, precached)).toEqual({
      kind: 'precache',
    });
    expect(
      routeRequest(
        get('http://localhost:4173/assets/index-abc.js'),
        'http://localhost:4173/',
        precached,
      ),
    ).toEqual({ kind: 'precache' });
  });

  it('keeps scores and their chunks, and piano samples, as they are fetched', () => {
    expect(
      routeRequest(get(`${PAGES}assets/twinkle-twinkle-little-star-x1.musicxml`), PAGES, precached),
    ).toEqual({ kind: 'runtime', cache: ASSETS_CACHE });
    expect(routeRequest(get(`${PAGES}piano/PP_Cs1.ogg`), PAGES, precached)).toEqual({
      kind: 'runtime',
      cache: PIANO_CACHE,
    });
  });

  it('leaves everything else to the network: other origins, other methods, other paths', () => {
    expect(routeRequest(get('http://127.0.0.1:8765/jobs'), PAGES, precached)).toEqual({
      kind: 'network',
    });
    expect(
      routeRequest({ ...get(`${PAGES}assets/x.js`), method: 'POST' }, PAGES, precached),
    ).toEqual({ kind: 'network' });
    expect(routeRequest(get(`${PAGES}.vite/manifest.json`), PAGES, precached)).toEqual({
      kind: 'network',
    });
  });
});

describe('the service worker caches', () => {
  it('keeps only whole, non-page responses, and only audio as piano samples', () => {
    expect(isCacheable(response(200, 'text/javascript'), ASSETS_CACHE)).toBe(true);
    expect(isCacheable(response(200, 'audio/ogg'), PIANO_CACHE)).toBe(true);
    expect(isCacheable(response(200, 'audio/mp4'), PIANO_CACHE)).toBe(true);
    expect(isCacheable(response(200, 'text/html'), ASSETS_CACHE)).toBe(false);
    expect(isCacheable(response(200, 'text/html; charset=utf-8'), PIANO_CACHE)).toBe(false);
    expect(isCacheable(response(200, 'application/octet-stream'), PIANO_CACHE)).toBe(false);
    expect(isCacheable(response(404, 'audio/ogg'), PIANO_CACHE)).toBe(false);
    expect(isCacheable(response(206, 'audio/ogg'), PIANO_CACHE)).toBe(false);
  });

  it('deletes older precaches and an older piano cache on activation, never the assets', () => {
    const current = precacheName('new');
    expect(
      obsoleteCaches(
        [
          'digitus2-precache-old',
          current,
          ASSETS_CACHE,
          'digitus2-piano-samples-v0',
          PIANO_CACHE,
          'other',
        ],
        current,
      ),
    ).toEqual(['digitus2-precache-old', 'digitus2-piano-samples-v0']);
  });

  it('purges from the assets cache the files its own precache holds, and keeps the scores', () => {
    // A page of this build that ran under the older worker fetched this build's shell into the
    // assets cache; the new precache holds those files, so the copies would only take room.
    const local = 'http://localhost:4173/';
    const cached = [
      `${PAGES}assets/index-abc.js`,
      `${PAGES}assets/index-abc.js?v=2`,
      `${PAGES}assets/twinkle-111.musicxml`,
      `${PAGES}assets/twinkle-222.js`,
      `${PAGES}assets/index-old.js`,
      'https://marchalmaxim.github.io/other/assets/index-abc.js',
      `${local}assets/index-abc.js`,
    ];
    expect(assetsToPurge(cached, PAGES, precached)).toEqual([
      `${PAGES}assets/index-abc.js`,
      `${PAGES}assets/index-abc.js?v=2`,
    ]);
    expect(assetsToPurge(cached, local, precached)).toEqual([`${local}assets/index-abc.js`]);
  });

  it('installs hashed files through the HTTP cache and the unhashed ones past it', () => {
    expect(precacheRequestMode('assets/verovio.worker-zz.js')).toBe('default');
    for (const path of ['index.html', 'manifest.webmanifest', 'icon.svg', 'icons/icon-192.png'])
      expect(precacheRequestMode(path)).toBe('reload');
    expect(precacheRequestMode('licenses/pdfjs.txt')).toBe('reload');
  });

  it('names the piano cache after the release the samples come from', () => {
    expect(PIANO_CACHE).toBe(`digitus2-${lock.tag}`);
  });
});
