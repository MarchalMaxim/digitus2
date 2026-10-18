import type { Storage } from 'smplr';

/**
 * Where the piano samples live: `<base>piano/`, next to index.html. They are the release asset
 * `piano-samples-v1` (issue #51), unpacked into `public/piano` by `scripts/fetch-piano-samples.mjs`
 * (the Pages workflow runs it before the build), so the app never fetches from another host.
 */
export const PIANO_SAMPLES_DIR = 'piano';

/**
 * The file a smplr sample name is stored as: a space becomes `_`, `#` becomes `s`
 * (`PP C#1` -> `PP_Cs1`), so its URL needs no escaping. The Vite servers decode paths with
 * `decodeURI`, which keeps `%23`, and would answer `PP%20C%231.ogg` with the app's page. The asset
 * script names the files the same way (`scripts/piano-samples-lib.mjs`, `sampleFileName`).
 */
export function pianoSampleFile(name: string): string {
  return name.replace(/ /g, '_').replace(/#/g, 's');
}

/** smplr's `baseUrl` for a Vite base path: `/digitus2/` -> `/digitus2/piano`. */
export function pianoSampleBaseUrl(base: string): string {
  return `${base.endsWith('/') ? base : `${base}/`}${PIANO_SAMPLES_DIR}`;
}

/**
 * What smplr fetches its samples through. smplr asks for `<baseUrl>/<sample name>.<format>` with
 * the space and `#` escaped (`PP%20C%231.ogg`); this fetches the stored file (`PP_Cs1.ogg`). A
 * response that is not audio rejects: a missing sample comes back from the Vite servers as the
 * app's page with status 200, and smplr would play silence; rejected, Play says the piano sounds
 * could not be loaded. Offline, a sample the service worker has not kept rejects the same way.
 */
export function pianoStorage(
  fetchFile: (url: string) => Promise<Response> = (url) => fetch(url),
): Storage {
  return {
    async fetch(url) {
      const slash = url.lastIndexOf('/');
      const file = decodeURIComponent(url.slice(slash + 1));
      const dot = file.lastIndexOf('.');
      const stored = `${url.slice(0, slash + 1)}${pianoSampleFile(file.slice(0, dot))}${file.slice(dot)}`;
      const response = await fetchFile(stored);
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !type.startsWith('audio/'))
        throw new Error(`piano sample ${stored}: HTTP ${response.status} ${type}`);
      return response;
    },
  };
}
