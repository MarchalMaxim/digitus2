# Self-hosted Piano Samples and Installable PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers do not run git; the controller commits each task with explicit paths.

**Goal:** The piano samples come from the app's own site instead of smplr's host, and the app installs on a phone and opens offline. The 452 Splendid Grand Piano files (226 samples in Ogg Opus and in AAC/M4A, public domain) become one GitHub release asset, `piano-samples-v1`, pinned by SHA-256 in the repository; the Pages workflow unpacks it into the built site, so smplr fetches `<base>piano/<file>` same-origin. A web app manifest with black-and-white icons makes the app installable (standalone), and a hand-written service worker precaches the app shell, the Verovio worker and the library data, and caches scores and piano samples as they are used, so a piece opened once opens and plays offline. No new UI, no new dependency.

**Issues:** [#51](https://github.com/MarchalMaxim/digitus2/issues/51) "Self-host the piano samples" (the owner: "let's do it with a release asset"), all three bullets. [#35](https://github.com/MarchalMaxim/digitus2/issues/35) "Installable PWA for phones, with offline library": the manifest, service worker and install-prompt bullets. The photo-input bullet of #35 belongs to the scanning session and is out of this plan; #35 stays open for it.

**Architecture:** `scripts/piano-samples-lib.mjs` holds the asset's constants, the file naming (`PP C#1` is stored as `PP_Cs1`), a deterministic ustar writer and reader, and the checks. `scripts/build-piano-samples.mjs` downloads the samples from the source repository at a pinned commit, checks each against that commit's git tree, and writes the tar and `scripts/piano-samples.lock.json`; the controller publishes the tar as the release asset. `scripts/fetch-piano-samples.mjs` downloads the asset, checks it against the lock and unpacks it into the gitignored `apps/web/public/piano/`, which Vite serves in dev and preview and copies into `dist/piano/`; the Pages workflow runs it before the build. In the app, `src/audio/pianoSamples.ts` gives smplr a `baseUrl` of `<base>piano` and a `storage` that maps smplr's sample URL to the stored name and rejects anything that is not audio. `src/sw/` holds the service worker: `policy.ts` (pure routing and cache rules), `precache.ts` (the precache list from the build output), `sw.ts` (the event handlers) and `vitePlugin.ts` (a build-only Vite plugin that, after the bundle is written, walks `dist`, computes the precache list and its version, and builds `sw.js` as one classic script with a nested Vite library build). `src/app/serviceWorker.ts` registers it after `load` on production builds. Playwright blocks service workers in every spec except `e2e/pwa.spec.ts`.

**Tech stack:** as the app today: TypeScript strict, React 19.3, Vite 8.3.4, vitest 5 with happy-dom, @playwright/test 1.59.1, smplr 1.1.0. Node 22 built-ins only in the scripts. No new dependencies, no lockfile change.

## Global Constraints

Binding values (use them verbatim):

| What                        | Value                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Release tag                 | `piano-samples-v1`                                                                                                                  |
| Release asset               | `splendid-grand-piano-v1.tar` (uncompressed ustar, about 44 MB)                                                                     |
| Release download URL        | `https://github.com/MarchalMaxim/digitus2/releases/download/piano-samples-v1/splendid-grand-piano-v1.tar`                           |
| Lock (the pin)              | `scripts/piano-samples.lock.json`: `tag`, `repository`, `asset`, `bytes`, `sha256`, `files` (the 452 audio file names)              |
| Sample source               | `smpldsnds/sfzinstruments-splendid-grand-piano` at commit `009793ebf849aee57f9a213aeaf8f2d1e2178f4f`, folder `samples/`             |
| Source download URL pattern | `https://raw.githubusercontent.com/smpldsnds/sfzinstruments-splendid-grand-piano/<commit>/samples/<encodeURIComponent(name)>.<ext>` |
| Formats                     | both `ogg` and `m4a` (smplr skips ogg on any Safari user agent, so iOS fetches m4a; Chrome and Firefox fetch ogg)                   |
| Stored file name            | smplr's sample name with each space replaced by `_` and each `#` by `s`: `PP C#1` → `PP_Cs1.ogg`, `Mf B-1` → `Mf_B-1.m4a`           |
| Where the app serves them   | `<base>piano/<file>`: `/digitus2/piano/PP_Cs1.ogg` on Pages, `/piano/PP_Cs1.ogg` in dev, preview and e2e                            |
| Local copy                  | `apps/web/public/piano/` (gitignored; also `apps/web/public/piano.partial/` while unpacking)                                        |
| Build output of the asset   | `build/piano-samples/` (gitignored by the existing `build/` rule)                                                                   |
| E2E route pattern           | the RegExp `PIANO_SAMPLES` in `apps/web/e2e/helpers/samples.ts`, given below the table (same-origin, so no CORS header)             |
| Cache names                 | `digitus2-precache-<version>`, `digitus2-assets` (at most 600 entries), `digitus2-piano-samples-v1` (`digitus2-` + the tag)         |
| Precache budget             | at most 24 MiB raw, enforced by the build (today about 16.1 MiB, 3.4 MiB gzip)                                                      |
| Bundle budget               | the library page's initial JavaScript and CSS stay under 150 KB gzip (`scripts/check-bundle-size.mjs`); Verovio stays lazy          |
| Navigation timeout          | 4,000 ms network-first, then the cached `index.html`                                                                                |

The e2e route pattern, verbatim:

```ts
export const PIANO_SAMPLES = /\/piano\/[^/?#]+\.(?:ogg|m4a)$/;
```

Rules:

- The repository never contains the samples. `scripts/check-repo-size.mjs` keeps its budgets; `apps/web/public/piano` and `build/piano-samples` are added to its `MUST_BE_IGNORED` before anything is downloaded (Task 1).
- Release-asset downloads send no `Access-Control-Allow-Origin` header, so the browser never fetches the asset; the Pages workflow and the local fetch script do, in Node.
- Downloaded files are untrusted data: the scripts live in `scripts/`, the downloads in `build/piano-samples/source/`, and the tar reader accepts only plain files with the names `README.md`, `manifest.json` and `^[A-Za-z0-9_-]+\.(?:ogg|m4a)$`.
- UI: black and white, exactly one red element on screen, brutal minimalism. This plan adds no visible control, no install button and no About line. The manifest's colours live only in `apps/web/public/manifest.webmanifest` (`scripts/check-colors.mjs` forbids colour literals in `index.html` and `apps/web/src`). Every user-visible string stays in the i18n dictionaries; the manifest's only text is the wordmark `digitus2`, which is not translated, and it has no `description`.
- E2E: `serviceWorkers: 'block'` in the global `use` of `apps/web/playwright.config.ts`; only `e2e/pwa.spec.ts` sets `'allow'`. Every other spec keeps intercepting samples with `page.route`.
- Tests first for logic (vitest); Playwright for the user-facing flows; `pnpm verify` is the definition of done for every task (without the PIG dataset the benchmark steps report SKIP, which is not a pass; say so in the report). Run `pnpm exec prettier --write <files>` on every new or changed file, because CI runs `pnpm format:check`.
- Windows host: Git Bash rewrites arguments that start with `/` (`--base=/digitus2/` becomes a `C:/Program Files/Git/...` path). Run such commands in PowerShell, or prefix them with `MSYS_NO_PATHCONV=1` in Git Bash. Long commands (the asset build, `pnpm verify`) run in the background. Use the Write tool for files longer than a few lines.
- Docs are present tense, without dates, branch names or agent credits.
- Installing on a phone needs HTTPS, so the owner tests Android Chrome and iOS Safari on the Pages site after merging; the e2e suite covers what Chromium can check.

## Decisions

- **Storage:** the release asset `piano-samples-v1` is the storage and the pin; the Pages build serves its files same-origin, because release downloads send no CORS header and Pages sends `Access-Control-Allow-Origin: *` only for its own files.
- **Both formats (452 files, 43.7 MB):** smplr's `findFirstSupportedFormat` skips ogg whenever the user agent looks like Safari, so iOS needs the m4a files; `formats: ['ogg', 'm4a']` is passed explicitly.
- **Safe file names plus a smplr `storage` shim:** vite dev and preview decode paths with `decodeURI`, which keeps `%23` encoded; probed with Vite 8.3.4, `/a%23b.ogg` came back as `index.html` with status 200, so a `#` in a name would play silence locally. smplr honours a `storage` option (`SMPLR_OPTION_KEYS`), so the app maps its URL to the stored name.
- **The shim rejects a response that is not audio:** a missing sample comes back as `index.html` with 200 from the Vite servers and smplr would swallow it; rejecting it shows the existing "The piano sounds could not be loaded" notice, and offline the same notice appears for samples never fetched.
- **Source pinned by commit, checked by git blob SHA-1:** raw.githubusercontent.com at commit `009793eb…` with each file's size and blob SHA-1 from that commit's tree is content-addressed; `samples/files.json` is cross-checked; the Pages copy of the source could change.
- **Deterministic ustar written and read by our own Node code:** the root has no zip library (fflate is the engine's), the audio is already compressed, and our reader enforces the safe names (no path traversal); entries sorted, mode 0644, owner 0, time 0.
- **The lock lands with the asset script (Task 1):** the tar is deterministic, so its SHA-256 is known before publishing; the controller checks it again before `gh release create`.
- **One fetch script for Pages and local work:** Vite copies `public/` into `dist`, so dev, preview and Pages serve the same `piano/` path with no app-side switch.
- **Hand-written service worker, not vite-plugin-pwa:** no dependency can be installed or tested now; Workbox globs cannot cleanly exclude the 2,702 score files and their per-score URL chunks; its default 2 MiB file limit silently drops the 8.2 MB Verovio worker and the 3.7 MB library manifest; the worker here is about 120 lines with pure, unit-tested routing.
- **`sw.js` is built inside `vite build` by a plugin (`closeBundle`, a nested IIFE library build):** all three build paths (`pnpm build`, the e2e script's `vite build`, the Pages workflow's `vite build --base=…`) run it; a classic script works in every browser. Prototyped with Vite 8.3.4: the nested build emits `sw.js` with the `define`d list.
- **Precache list from the dist walk, not the Vite manifest graph:** the engine and Verovio worker chunks are not manifest keys; the walk keeps everything except source maps, `.vite/`, `sw.js`, `piano/` and the files the manifest attributes to `content/scores/` (both the score file and its `?url` JS wrapper). Measured on the current tree: 25 files, 16.1 MiB raw, 3.4 MiB gzip; the build fails above 24 MiB.
- **Strategies:** navigations network-first (4 s), then the precached `index.html` ignoring the query (so `?audio=silent` reloads offline); precached files from the precache; other hashed `assets/` and `piano/` cache-first; only same-origin GETs inside the scope are answered, never the scan worker on 127.0.0.1.
- **Only status 200 responses that are not `text/html` are cached, and only `audio/*` in the piano cache:** the Vite servers answer a missing file with `index.html` and status 200.
- **Updates without `skipWaiting`, without a forced reload and without update UI:** the new worker waits until every window of the app has closed, so an open page never loses the lazy chunks it was built with; `clients.claim()` on activate lets the first visit be controlled; activation deletes only older precaches (and an older piano cache), never `digitus2-assets`.
- **The piano cache is named after the release tag,** and a unit test ties `PIANO_CACHE` to the lock's `tag`, so a new asset gets a fresh cache.
- **Registration:** a small module called from `main.tsx`; production builds only, after `load`, `updateViaCache: 'none'`, failures swallowed silently (the smoke and score specs fail on any console error); no workbox-window.
- **Playwright blocks service workers except in `pwa.spec.ts`:** `page.route` does not see requests a service worker answers. In Playwright 1.59.1 a blocked context replaces `navigator.serviceWorker.register` with a function that warns and resolves, and with `'allow'` the context's offline mode and `context.route` reach the worker's own fetches (read in `playwright-core/lib/server/chromium/crServiceWorker.js` and `server/browserContext.js`).
- **Manifest:** `display: standalone` (full screen without browser UI, status bar kept), relative `id`, `start_url` and `scope` (`./`) so one file works under `/` and `/digitus2/`, white `background_color` and `theme_color`, name and short name `digitus2`, no description.
- **No `theme-color` meta in `index.html`:** `check-colors` fails on any colour literal there; the installed app's splash screen and status bar stay white in dark mode (a known limitation).
- **Icons:** a geometric white "2" drawn as a stroked path (no font) on full-bleed black, inside the maskable safe zone; PNGs at 192, 512 and 180 px rendered once with Playwright's Chromium (no image library in the repository) and committed; the SVG is also the favicon.
- **Install prompt:** the browser's own. The app does not listen to `beforeinstallprompt` and adds no About line: a beginner does not need an install control on screen, Chrome on Android shows its own install UI, iOS installs from Share, Add to Home Screen, and the About text is pinned by `about.spec` and two Windows baselines.
- **Docs and closure:** #51 gets a line in `docs/TODO.md`; #35 stays open for the photo bullet, so it gets no TODO line and the controller ticks its three bullets; README.md mentions neither the piano host nor offline use and stays as it is.

## Not verified

- Installing and playing on Android Chrome and iOS Safari (standalone mode, m4a decoding, storage quota): the owner tests on the Pages site after merging; phones cannot reach a local preview.
- The nested `vite build` inside `closeBundle` was prototyped in a scratch project with Vite 8.3.4, not inside the real app config (its React plugin and worker builds).
- The Playwright service-worker behaviour (offline and `context.route` reaching the worker's fetches, `request.serviceWorker()`) was read from playwright-core 1.59.1, not run.
- Chromium choosing ogg (`canPlayType('audio/ogg')` not empty) is assumed; the playback test asserts `.ogg` requests and fails loudly if not.
- The content type of `.webmanifest` from `vite preview` (expected `application/manifest+json`) and from Pages.
- That `cache.keys()` returns entries in insertion order in every browser (the spec says so; the trim of `digitus2-assets` relies on it).
- The GitHub API tree listing for the source commit was probed unauthenticated (453 blobs under `samples/`, 19,888,425 bytes of ogg, 23,824,778 of m4a); the build script sends `GITHUB_TOKEN` when set, in case of rate limits.

## File Map

Task 1: piano samples asset builder

- Create `scripts/piano-samples-lib.mjs`, `scripts/piano-samples-lib.d.mts`, `scripts/build-piano-samples.mjs`, `apps/web/src/audio/pianoSamplesAsset.test.ts`
- Create (generated by the script) `scripts/piano-samples.lock.json`
- Modify `.gitignore`, `scripts/check-repo-size.mjs`

Task 2: same-origin piano loader and the e2e sample helper

- Create `apps/web/src/audio/pianoSamples.ts`, `apps/web/src/audio/pianoSamples.test.ts`
- Modify `apps/web/src/audio/instrument.ts`, `apps/web/src/audio/transport.test.ts`, `apps/web/e2e/helpers/samples.ts`, `apps/web/e2e/playback.spec.ts`

Task 3: release, fetch script and Pages workflow

- Controller: the GitHub release `piano-samples-v1` with its asset
- Create `scripts/fetch-piano-samples.mjs`
- Modify `apps/web/vite.config.ts`, `.github/workflows/pages.yml`

Task 4: web app manifest and icons

- Create `apps/web/public/manifest.webmanifest`, `apps/web/public/icon.svg`, `scripts/render-icons.mjs`, `apps/web/public/icons/icon-192.png`, `apps/web/public/icons/icon-512.png`, `apps/web/public/icons/apple-touch-icon.png`, `apps/web/src/app/webManifest.test.ts`
- Modify `apps/web/index.html`

Task 5: the service worker and its build

- Create `apps/web/src/sw/policy.ts`, `apps/web/src/sw/policy.test.ts`, `apps/web/src/sw/precache.ts`, `apps/web/src/sw/precache.test.ts`, `apps/web/src/sw/sw.ts`, `apps/web/src/sw/vitePlugin.ts`
- Modify `apps/web/vite.config.ts`, `.github/workflows/pages.yml`

Task 6: registration, with service workers blocked in the e2e suite

- Create `apps/web/src/app/serviceWorker.ts`, `apps/web/src/app/serviceWorker.test.ts`
- Modify `apps/web/src/main.tsx`, `apps/web/playwright.config.ts`

Task 7: the offline end-to-end spec

- Create `apps/web/e2e/pwa.spec.ts`

Task 8: docs

- Modify `docs/app.md`, `docs/PROGRESS.md`, `docs/verification-loop.md`, `docs/TODO.md`, `docs/superpowers/specs/2026-10-13-digitus2-design.md`
- Not modified: `README.md` (it mentions neither the piano host nor offline use)

## Tasks

### Task 1: Piano samples asset builder

**Model:** opus

Why: network downloads, verification against the source commit, a new shared library.

**Files:** create `scripts/piano-samples-lib.mjs`, `scripts/piano-samples-lib.d.mts`, `scripts/build-piano-samples.mjs`, `apps/web/src/audio/pianoSamplesAsset.test.ts`; generate `scripts/piano-samples.lock.json`; modify `.gitignore` and `scripts/check-repo-size.mjs`.

- [ ] **Step 1: Ignore the download and unpack directories first.** Append to `.gitignore`:

```gitignore
# Piano samples (issue #51): the piano-samples-v1 release asset, unpacked by
# scripts/fetch-piano-samples.mjs (piano.partial/ while it unpacks). build/piano-samples/ is
# covered by the build/ rule above.
apps/web/public/piano*/
```

In `scripts/check-repo-size.mjs`, add `'apps/web/public/piano'` and `'build/piano-samples'` to `MUST_BE_IGNORED`. Run `node scripts/check-repo-size.mjs`: it passes.

- [ ] **Step 2: Write the failing tests.** Create `apps/web/src/audio/pianoSamplesAsset.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  assetEntries,
  checkAssetEntries,
  gitBlobSha1,
  lockFor,
  readTar,
  sampleFileName,
  sha256,
  writeTar,
  type SampleSource,
  type TarEntry,
} from '../../../../scripts/piano-samples-lib.mjs';

const bytes = (text: string) => new TextEncoder().encode(text);
const source = (name: string, format: string, data: Uint8Array): SampleSource => ({
  name,
  format,
  data,
  gitBlobSha1: gitBlobSha1(data),
});
const samples: SampleSource[] = [
  source('PP C#1', 'ogg', bytes('ogg one')),
  source('PP C#1', 'm4a', bytes('m4a one')),
  source('Mf B-1', 'ogg', bytes('x'.repeat(700))),
];
const hex = (data: Uint8Array) => Buffer.from(data).toString('hex');

describe('the piano samples asset', () => {
  it('names a sample so that its URL needs no escaping', () => {
    expect(sampleFileName('PP C#1')).toBe('PP_Cs1');
    expect(sampleFileName('Mf B-1')).toBe('Mf_B-1');
  });

  it('hashes like git hash-object and like sha256sum', () => {
    expect(gitBlobSha1(new Uint8Array())).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(gitBlobSha1(bytes('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    expect(sha256(bytes('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('writes a deterministic tar that reads back to the same entries', () => {
    const entries: TarEntry[] = [
      { name: 'a.ogg', data: bytes('a') },
      { name: 'b.m4a', data: new Uint8Array(1024).fill(7) },
    ];
    const tar = writeTar(entries);
    expect(tar.length).toBe(512 + 512 + 512 + 1024 + 1024);
    expect(hex(writeTar(entries))).toBe(hex(tar));
    expect(readTar(tar).map((e) => [e.name, hex(e.data)])).toEqual(
      entries.map((e) => [e.name, hex(e.data)]),
    );
  });

  it('refuses a corrupted header, a missing end marker and a name over 100 bytes', () => {
    const tar = Buffer.from(writeTar([{ name: 'a.ogg', data: bytes('a') }]));
    const corrupted = Buffer.from(tar);
    corrupted[0] = 0x62;
    expect(() => readTar(corrupted)).toThrow(/checksum/);
    expect(() => readTar(tar.subarray(0, tar.length - 1024))).toThrow(/end marker/);
    expect(() => writeTar([{ name: `${'a'.repeat(101)}.ogg`, data: bytes('a') }])).toThrow(/100/);
  });

  it('builds entries whose manifest the checks accept, and a lock that pins the tar', () => {
    const entries = assetEntries(samples);
    expect(entries.map((e) => e.name)).toEqual([
      'README.md',
      'manifest.json',
      'Mf_B-1.ogg',
      'PP_Cs1.m4a',
      'PP_Cs1.ogg',
    ]);
    const tar = writeTar(entries);
    const lock = lockFor(tar, entries);
    expect(lock).toEqual({
      tag: 'piano-samples-v1',
      repository: 'MarchalMaxim/digitus2',
      asset: 'splendid-grand-piano-v1.tar',
      bytes: tar.length,
      sha256: sha256(tar),
      files: ['Mf_B-1.ogg', 'PP_Cs1.m4a', 'PP_Cs1.ogg'],
    });
    expect(() => checkAssetEntries(readTar(tar), lock)).not.toThrow();
    const manifest = JSON.parse(Buffer.from(entries[1]!.data).toString('utf8'));
    expect(manifest.source).toEqual({
      repository: 'https://github.com/smpldsnds/sfzinstruments-splendid-grand-piano',
      commit: '009793ebf849aee57f9a213aeaf8f2d1e2178f4f',
      path: 'samples',
    });
    expect(manifest.files[2]).toEqual({
      file: 'PP_Cs1.ogg',
      source: 'samples/PP C#1.ogg',
      bytes: 7,
      sha256: sha256(bytes('ogg one')),
      gitBlobSha1: gitBlobSha1(bytes('ogg one')),
    });
  });

  it('refuses a changed file, an unsafe name, a missing file and a duplicate', () => {
    const entries = assetEntries(samples);
    const lock = lockFor(writeTar(entries), entries);
    const changed = entries.map((e) =>
      e.name === 'PP_Cs1.ogg' ? { ...e, data: bytes('ogg 0ne') } : e,
    );
    expect(() => checkAssetEntries(changed, lock)).toThrow(/PP_Cs1\.ogg/);
    expect(() =>
      checkAssetEntries([...entries, { name: '../evil.ogg', data: bytes('x') }], lock),
    ).toThrow(/unexpected entry/);
    expect(() =>
      checkAssetEntries(
        entries.filter((e) => e.name !== 'Mf_B-1.ogg'),
        lock,
      ),
    ).toThrow(/manifest/);
    expect(() => checkAssetEntries([...entries, entries[2]!], lock)).toThrow(/duplicate/);
  });

  it('refuses two samples whose files differ only in case', () => {
    expect(() => assetEntries([...samples, { ...samples[0]!, name: 'pp C#1' }])).toThrow(
      /two samples/,
    );
  });
});
```

Run `pnpm --filter @digitus2/web exec vitest run src/audio/pianoSamplesAsset.test.ts`: it fails (the module does not exist).

- [ ] **Step 3: Write the library.** Create `scripts/piano-samples-lib.mjs`:

```js
// The piano samples' release asset (issue #51): its constants, the file naming, hashing, a
// minimal deterministic ustar writer and reader, and the checks shared by build-piano-samples.mjs
// (builds the asset), fetch-piano-samples.mjs (unpacks it for the app) and the unit tests
// (apps/web/src/audio/pianoSamplesAsset.test.ts and pianoSamples.test.ts).
import { createHash } from 'node:crypto';

export const TAG = 'piano-samples-v1';
export const ASSET_NAME = 'splendid-grand-piano-v1.tar';
export const RELEASE_REPOSITORY = 'MarchalMaxim/digitus2';
export const SOURCE_REPOSITORY = 'smpldsnds/sfzinstruments-splendid-grand-piano';
export const SOURCE_COMMIT = '009793ebf849aee57f9a213aeaf8f2d1e2178f4f';
export const FORMATS = ['ogg', 'm4a'];
export const LOCK_FILE = 'scripts/piano-samples.lock.json';

/** An audio file of the asset: a name that needs no escaping in a URL, and one of the formats. */
const SAMPLE_FILE = /^[A-Za-z0-9_-]+\.(?:ogg|m4a)$/;
const BLOCK = 512;

export const README = `# Splendid Grand Piano samples for digitus2

The piano samples digitus2 plays, as the release asset \`${TAG}\` that the app serves from its own
site (\`<base>piano/\`).

- Source: https://github.com/${SOURCE_REPOSITORY}, commit ${SOURCE_COMMIT}, folder \`samples\`:
  226 samples, each as Ogg Opus (\`.ogg\`) and as AAC in MP4 (\`.m4a\`). The files are unchanged.
- Origin: the Splendid Grand Piano, Steinway samples that Akai released into the public domain
  around 2000, mapped to SFZ by kinwie (https://github.com/sfzinstruments/SplendidGrandPiano) and
  converted for the smplr library by smpldsnds.
- Licence: public domain, as the source repository states.
- Names: the sample \`PP C#1\` is stored as \`PP_Cs1\` (a space becomes \`_\`, \`#\` becomes \`s\`), so
  its URL needs no escaping on any server. The app maps smplr's names the same way.
- \`manifest.json\` lists every file with its size, SHA-256 and git blob SHA-1 at the source commit.
`;

/** 'PP C#1' -> 'PP_Cs1'. The app maps smplr's names the same way (apps/web/src/audio/pianoSamples.ts). */
export function sampleFileName(name) {
  return name.replace(/ /g, '_').replace(/#/g, 's');
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Git's object id of a file (`git hash-object`), as the source commit's tree lists it. */
export function gitBlobSha1(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function checksum(header) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i];
  return sum;
}

function field(header, start, length) {
  return header
    .subarray(start, start + length)
    .toString('latin1')
    .replace(/\0.*$/s, '')
    .trim();
}

/**
 * A ustar archive of plain files, deterministic: the entries in the order given, mode 0644,
 * owner and group 0, modification time 0, no user or group names. Names up to 100 bytes.
 */
export function writeTar(entries) {
  const parts = [];
  for (const { name, data } of entries) {
    if (Buffer.byteLength(name) > 100) throw new Error(`tar entry name over 100 bytes: ${name}`);
    const header = Buffer.alloc(BLOCK);
    header.write(name, 0, 100, 'utf8');
    header.write(octal(0o644, 8), 100, 'ascii');
    header.write(octal(0, 8), 108, 'ascii');
    header.write(octal(0, 8), 116, 'ascii');
    header.write(octal(data.length, 12), 124, 'ascii');
    header.write(octal(0, 12), 136, 'ascii');
    header.write('0', 156, 'ascii');
    header.write('ustar\0', 257, 'ascii');
    header.write('00', 263, 'ascii');
    header.write(`${octal(checksum(header), 7)} `, 148, 'ascii');
    parts.push(header, Buffer.from(data), Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(2 * BLOCK));
  return Buffer.concat(parts);
}

/** The plain files of a ustar archive; anything else (a link, a directory, a bad header) throws. */
export function readTar(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let offset = 0;
  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) return entries;
    if (Number.parseInt(field(header, 148, 8), 8) !== checksum(header))
      throw new Error(`tar header checksum mismatch at byte ${offset}`);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    if (header[156] !== 0x30 && header[156] !== 0)
      throw new Error(`tar entry ${name} is not a plain file`);
    const size = Number.parseInt(field(header, 124, 12), 8);
    if (!Number.isFinite(size) || offset + BLOCK + size > buffer.length)
      throw new Error(`tar entry ${name} is truncated`);
    offset += BLOCK;
    entries.push({ name, data: new Uint8Array(buffer.subarray(offset, offset + size)) });
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new Error('tar archive has no end marker');
}

const byFile = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);

/**
 * The asset's entries: README.md, manifest.json (each file's source path, size, SHA-256 and git
 * blob SHA-1), then the audio files under their safe names, sorted. `samples` are
 * `{ name, format, data, gitBlobSha1 }` as downloaded from the source commit.
 */
export function assetEntries(samples) {
  const files = samples
    .map((s) => ({
      file: `${sampleFileName(s.name)}.${s.format}`,
      source: `samples/${s.name}.${s.format}`,
      bytes: s.data.length,
      sha256: sha256(s.data),
      gitBlobSha1: s.gitBlobSha1,
      data: s.data,
    }))
    .sort(byFile);
  const seen = new Set();
  for (const f of files) {
    if (!SAMPLE_FILE.test(f.file)) throw new Error(`unsafe sample file name ${f.file}`);
    if (seen.has(f.file.toLowerCase())) throw new Error(`two samples map to ${f.file}`);
    seen.add(f.file.toLowerCase());
  }
  const manifest = {
    tag: TAG,
    source: {
      repository: `https://github.com/${SOURCE_REPOSITORY}`,
      commit: SOURCE_COMMIT,
      path: 'samples',
    },
    licence: 'Public domain (see README.md)',
    files: files.map(({ data: _data, ...entry }) => entry),
  };
  return [
    { name: 'README.md', data: Buffer.from(README, 'utf8') },
    { name: 'manifest.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') },
    ...files.map((f) => ({ name: f.file, data: f.data })),
  ];
}

/** The lock that pins a built asset: what the Pages workflow and the fetch script check. */
export function lockFor(tar, entries) {
  return {
    tag: TAG,
    repository: RELEASE_REPOSITORY,
    asset: ASSET_NAME,
    bytes: tar.length,
    sha256: sha256(tar),
    files: entries
      .map((e) => e.name)
      .filter((n) => SAMPLE_FILE.test(n))
      .sort(),
  };
}

/**
 * Throws unless `entries` are exactly the asset the lock names: only README.md, manifest.json
 * and safely named audio files, no duplicates, the manifest listing exactly those files with
 * their sizes and SHA-256, and the same file names as the lock.
 */
export function checkAssetEntries(entries, lock) {
  const byName = new Map();
  for (const e of entries) {
    if (byName.has(e.name)) throw new Error(`duplicate entry ${e.name}`);
    if (e.name !== 'README.md' && e.name !== 'manifest.json' && !SAMPLE_FILE.test(e.name))
      throw new Error(`unexpected entry ${JSON.stringify(e.name)}`);
    byName.set(e.name, e.data);
  }
  if (!byName.has('README.md')) throw new Error('the asset has no README.md');
  const manifestBytes = byName.get('manifest.json');
  if (!manifestBytes) throw new Error('the asset has no manifest.json');
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  const audio = [...byName.keys()].filter((n) => SAMPLE_FILE.test(n)).sort();
  const listed = manifest.files.map((f) => f.file).sort();
  if (JSON.stringify(listed) !== JSON.stringify(audio))
    throw new Error("the manifest does not list exactly the asset's audio files");
  if (JSON.stringify(audio) !== JSON.stringify([...lock.files].sort()))
    throw new Error(`the asset's audio files differ from ${LOCK_FILE}`);
  for (const f of manifest.files) {
    const data = byName.get(f.file);
    if (data.length !== f.bytes || sha256(data) !== f.sha256)
      throw new Error(`${f.file} does not match the manifest`);
  }
}
```

Create `scripts/piano-samples-lib.d.mts` (types for the TypeScript tests, as `check-colors.d.mts` does):

```ts
// Types for piano-samples-lib.mjs, so the TypeScript tests in apps/web can import it.
export interface TarEntry {
  name: string;
  data: Uint8Array;
}
export interface SampleSource {
  name: string;
  format: string;
  data: Uint8Array;
  gitBlobSha1: string;
}
export interface PianoSamplesLock {
  tag: string;
  repository: string;
  asset: string;
  bytes: number;
  sha256: string;
  files: string[];
}
export const TAG: string;
export const ASSET_NAME: string;
export const RELEASE_REPOSITORY: string;
export const SOURCE_REPOSITORY: string;
export const SOURCE_COMMIT: string;
export const FORMATS: string[];
export const LOCK_FILE: string;
export const README: string;
export function sampleFileName(name: string): string;
export function sha256(bytes: Uint8Array): string;
export function gitBlobSha1(bytes: Uint8Array): string;
export function writeTar(entries: readonly TarEntry[]): Uint8Array;
export function readTar(bytes: Uint8Array): TarEntry[];
export function assetEntries(samples: readonly SampleSource[]): TarEntry[];
export function lockFor(tar: Uint8Array, entries: readonly TarEntry[]): PianoSamplesLock;
export function checkAssetEntries(entries: readonly TarEntry[], lock: PianoSamplesLock): void;
```

Run the test file again: it passes.

- [ ] **Step 4: Write the build script.** Create `scripts/build-piano-samples.mjs`:

```js
#!/usr/bin/env node
// Builds the piano samples' release asset (issue #51): downloads the Splendid Grand Piano samples
// that smplr plays from the source repository at a pinned commit, checks every file against that
// commit's git tree (size and blob SHA-1) and its samples/files.json, and writes one deterministic
// tar with a manifest (SHA-256 per file) and a README. Run it from the repository root.
//
//   node scripts/build-piano-samples.mjs               build; fail if the tar differs from the lock
//   node scripts/build-piano-samples.mjs --write-lock  build and write scripts/piano-samples.lock.json
//
// Output (gitignored): build/piano-samples/splendid-grand-piano-v1.tar and README.md (the release
// notes). Downloads stay in build/piano-samples/source/ and are reused while they still match.
// Set GITHUB_TOKEN if the GitHub API rate limit refuses the tree listing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ASSET_NAME,
  FORMATS,
  LOCK_FILE,
  README,
  SOURCE_COMMIT,
  SOURCE_REPOSITORY,
  assetEntries,
  checkAssetEntries,
  gitBlobSha1,
  lockFor,
  readTar,
  writeTar,
} from './piano-samples-lib.mjs';

const OUT = 'build/piano-samples';
const SOURCE_DIR = join(OUT, 'source');
const RAW = `https://raw.githubusercontent.com/${SOURCE_REPOSITORY}/${SOURCE_COMMIT}`;
const TREE = `https://api.github.com/repos/${SOURCE_REPOSITORY}/git/trees/${SOURCE_COMMIT}?recursive=1`;
const writeLock = process.argv.includes('--write-lock');

async function get(url, attempts = 3) {
  const headers = { 'user-agent': 'digitus2-piano-samples' };
  if (url.startsWith('https://api.github.com/') && process.env.GITHUB_TOKEN)
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${url}: ${error.message}`);
    }
  }
}

const json = (data) => JSON.parse(Buffer.from(data).toString('utf8'));

const tree = json(await get(TREE));
if (tree.truncated) throw new Error('the git tree listing of the source commit is truncated');
const blobs = new Map(
  tree.tree
    .filter((e) => e.type === 'blob' && e.path.startsWith('samples/'))
    .map((e) => [e.path, e]),
);
const names = json(await get(`${RAW}/samples/files.json`));
const wanted = new Set(names.flatMap((n) => FORMATS.map((f) => `samples/${n}.${f}`)));
const missing = [...wanted].filter((p) => !blobs.has(p));
const extra = [...blobs.keys()].filter((p) => p !== 'samples/files.json' && !wanted.has(p));
if (missing.length > 0 || extra.length > 0)
  throw new Error(`files.json and the tree disagree; missing: ${missing}; extra: ${extra}`);

const jobs = [...wanted].sort();
const samples = [];
let next = 0;
async function download() {
  while (next < jobs.length) {
    const path = jobs[next++];
    const blob = blobs.get(path);
    const local = join(SOURCE_DIR, path);
    let data = existsSync(local) ? new Uint8Array(readFileSync(local)) : null;
    if (!data || gitBlobSha1(data) !== blob.sha) {
      data = await get(`${RAW}/${path.split('/').map(encodeURIComponent).join('/')}`);
      mkdirSync(dirname(local), { recursive: true });
      writeFileSync(local, data);
    }
    if (data.length !== blob.size || gitBlobSha1(data) !== blob.sha)
      throw new Error(`${path} does not match the source commit`);
    const file = path.slice('samples/'.length);
    const dot = file.lastIndexOf('.');
    samples.push({
      name: file.slice(0, dot),
      format: file.slice(dot + 1),
      data,
      gitBlobSha1: blob.sha,
    });
  }
}
await Promise.all(Array.from({ length: 8 }, download));

const entries = assetEntries(samples);
const tar = writeTar(entries);
const lock = lockFor(tar, entries);
checkAssetEntries(readTar(tar), lock);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, ASSET_NAME), tar);
writeFileSync(join(OUT, 'README.md'), README);
const mb = (tar.length / 1e6).toFixed(1);
process.stdout.write(
  `${join(OUT, ASSET_NAME)}: ${entries.length} files, ${mb} MB, SHA-256 ${lock.sha256}\n`,
);

if (writeLock) {
  writeFileSync(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`);
  process.stdout.write(`wrote ${LOCK_FILE}\n`);
} else {
  const pinned = existsSync(LOCK_FILE) ? JSON.parse(readFileSync(LOCK_FILE, 'utf8')) : null;
  if (pinned?.sha256 === lock.sha256 && pinned.bytes === lock.bytes) {
    process.stdout.write(`matches ${LOCK_FILE}\n`);
  } else {
    process.stdout.write(
      `FAIL the tar differs from ${LOCK_FILE} (run with --write-lock for a new asset)\n`,
    );
    process.exitCode = 1;
  }
}
```

- [ ] **Step 5: Build the asset and write the lock.** From the repository root, in the background: `node scripts/build-piano-samples.mjs --write-lock`. Expect 454 files (452 audio files, `README.md`, `manifest.json`), about 44 MB, and `scripts/piano-samples.lock.json` with 452 names. Run it a second time without `--write-lock`: it reuses the downloads and prints `matches scripts/piano-samples.lock.json` (the tar is reproducible). Run `pnpm exec prettier --write scripts/piano-samples-lib.mjs scripts/piano-samples-lib.d.mts scripts/build-piano-samples.mjs scripts/piano-samples.lock.json apps/web/src/audio/pianoSamplesAsset.test.ts`, then `pnpm exec prettier --check scripts/piano-samples.lock.json` (prettier must leave the generated lock unchanged; if it reformats it, adjust the script's JSON output to match and rebuild).

- [ ] **Step 6: Verify.** `pnpm verify hygiene typecheck lint unit` passes; the hygiene step's largest-files list shows nothing under `build/` (the directory is ignored).

**Done when:** the tests pass, the tar sits in `build/piano-samples/` with its README, the lock is generated and prettier-clean, a second build matches the lock, and hygiene passes. Report the tar's size and SHA-256 to the controller.

### Task 2: Same-origin piano loader and the e2e sample helper

**Model:** opus

Why: it touches the instrument, its unit tests and two e2e files.

**Files:** create `apps/web/src/audio/pianoSamples.ts` and `apps/web/src/audio/pianoSamples.test.ts`; modify `apps/web/src/audio/instrument.ts`, `apps/web/src/audio/transport.test.ts`, `apps/web/e2e/helpers/samples.ts`, `apps/web/e2e/playback.spec.ts`. Needs the lock from Task 1.

- [ ] **Step 1: Write the failing tests.** Create `apps/web/src/audio/pianoSamples.test.ts`:

```ts
import { LAYERS } from 'smplr';
import { describe, expect, it, vi } from 'vitest';
import lock from '../../../../scripts/piano-samples.lock.json';
import { sampleFileName } from '../../../../scripts/piano-samples-lib.mjs';
import { pianoSampleBaseUrl, pianoSampleFile, pianoStorage } from './pianoSamples.js';

/** Every sample name smplr's Splendid Grand Piano can ask for, over all its velocity layers. */
const names = [...new Set(LAYERS.flatMap((layer) => layer.samples.map((s) => String(s[1]))))];

describe('the piano samples', () => {
  it('maps a smplr sample name to the file it is stored as', () => {
    expect(pianoSampleFile('PP C#1')).toBe('PP_Cs1');
    expect(pianoSampleFile('FF B-1')).toBe('FF_B-1');
  });

  it('names every sample as the asset script does: safe and without collisions, in any case', () => {
    expect(names).toHaveLength(226);
    for (const name of names) expect(pianoSampleFile(name)).toBe(sampleFileName(name));
    const files = names.map(pianoSampleFile);
    expect(files.every((f) => /^[A-Za-z0-9_-]+$/.test(f))).toBe(true);
    expect(new Set(files.map((f) => f.toLowerCase())).size).toBe(names.length);
  });

  it('finds every file smplr can ask for in the pinned asset, and nothing else', () => {
    const wanted = names.flatMap((n) => ['ogg', 'm4a'].map((f) => `${pianoSampleFile(n)}.${f}`));
    expect(wanted.sort()).toEqual([...lock.files].sort());
  });

  it("serves the samples from the app's own piano directory", () => {
    expect(pianoSampleBaseUrl('/')).toBe('/piano');
    expect(pianoSampleBaseUrl('/digitus2/')).toBe('/digitus2/piano');
  });

  it('fetches the stored file for the URL smplr builds', async () => {
    const fetchFile = vi.fn(
      async (_url: string) => new Response('ogg', { headers: { 'content-type': 'audio/ogg' } }),
    );
    const response = await pianoStorage(fetchFile).fetch('/digitus2/piano/PP%20C%231.ogg');
    expect(fetchFile).toHaveBeenCalledWith('/digitus2/piano/PP_Cs1.ogg');
    expect(response.status).toBe(200);
  });

  it('rejects a missing sample and a page served in its place', async () => {
    const page = pianoStorage(
      async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
    );
    await expect(page.fetch('/piano/PP%20C1.ogg')).rejects.toThrow(/PP_C1\.ogg/);
    const missing = pianoStorage(
      async () => new Response('', { status: 404, headers: { 'content-type': 'audio/ogg' } }),
    );
    await expect(missing.fetch('/piano/PP%20C1.ogg')).rejects.toThrow(/404/);
  });
});
```

In `apps/web/src/audio/transport.test.ts`, widen the fake's options type:

```ts
interface FakePiano {
  options: {
    baseUrl?: string;
    formats?: string[];
    storage?: { fetch(url: string): Promise<unknown> };
    notesToLoad: { notes: number[]; velocityRange: [number, number] };
  };
```

and add to `describe('the sampled piano', …)`:

```ts
it("loads its samples from the app's own piano directory, in both formats", async () => {
  const piano = createPiano({} as AudioContext);
  await piano.load([60], [96]);
  const fake = smplrMock.pianos[0]!;
  expect(fake.options.baseUrl).toBe('/piano');
  expect(fake.options.formats).toEqual(['ogg', 'm4a']);
  expect(typeof fake.options.storage?.fetch).toBe('function');
});
```

Run `pnpm --filter @digitus2/web exec vitest run src/audio`: the new tests fail.

- [ ] **Step 2: Write the module.** Create `apps/web/src/audio/pianoSamples.ts`:

```ts
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
```

In `apps/web/src/audio/instrument.ts`, import `pianoSampleBaseUrl` and `pianoStorage` from `./pianoSamples.js` and construct the piano with them:

```ts
const next = smplr.SplendidGrandPiano(ctx, {
  baseUrl: pianoSampleBaseUrl(import.meta.env.BASE_URL),
  formats: ['ogg', 'm4a'],
  storage: pianoStorage(),
  notesToLoad: {
    notes: [...new Set(midis)],
    velocityRange,
    fallback: 'nearest',
  },
});
```

Add one sentence to `createPiano`'s doc comment: "The samples come from the app's own site (`<base>piano/`, see pianoSamples.ts); Safari fetches the `.m4a` files, other browsers the `.ogg` ones." Run the unit tests: they pass. `pianoSamples.ts` imports smplr's types only, so smplr stays out of the entry chunk.

- [ ] **Step 3: Update the e2e helper.** In `apps/web/e2e/helpers/samples.ts`, replace the constant, its comment and `fulfillSilently`:

```ts
/**
 * The piano sample requests: smplr fetches them from the app's own site, `<base>piano/<file>`
 * (`src/audio/pianoSamples.ts`), which serves the `piano-samples-v1` release asset. The suite never
 * needs that asset: a flow that plays with the real instrument (no `?audio=silent`) answers these
 * requests itself with the helpers below. Service workers are blocked in the suite
 * (playwright.config.ts), so `page.route` sees these requests.
 */
export const PIANO_SAMPLES = /\/piano\/[^/?#]+\.(?:ogg|m4a)$/;
```

```ts
/** Answers a sample request with the silent WAV. */
function fulfillSilently(route: Route): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav() });
}
```

`delayPianoSamples` and `holdPianoSamples` keep their code; they now pass the RegExp to `page.route`.

- [ ] **Step 4: Assert the requests are same-origin.** In `apps/web/e2e/playback.spec.ts`, in the test "the first Play with the real piano says "Loading the piano…" until playback starts", after `expect(requested.length, 'piano samples requested').toBeGreaterThan(0);` add:

```ts
// The samples come from the app's own site, under their stored names (issue #51).
const origin = new URL(page.url()).origin;
for (const url of requested) {
  expect(new URL(url).origin, url).toBe(origin);
  expect(new URL(url).pathname, url).toMatch(/^\/piano\/[A-Za-z0-9_-]+\.ogg$/);
}
```

- [ ] **Step 5: Verify.** Prettier on the changed files. `pnpm verify typecheck lint unit build bundle` passes. Then `pnpm --filter @digitus2/web exec playwright test e2e/playback.spec.ts e2e/states.spec.ts --project=desktop` (stop any stale preview on port 4173 first) passes, including `score-loading-piano`.

**Done when:** the unit tests pass (including the LAYERS-against-lock test), the playback and states specs pass with the new route pattern, and the bundle check still passes.

### Task 3: Release, fetch script and Pages workflow

**Model:** sonnet

Why: the files are given in full below. The release itself is created by the controller, not the implementer (Step 1).

**Files:** controller creates the release; implementer creates `scripts/fetch-piano-samples.mjs` and modifies `apps/web/vite.config.ts` and `.github/workflows/pages.yml`.

- [ ] **Step 1 (controller): Publish the release.** Publishing is public; the owner chose it in #51. From the repository root, on a machine with `gh` authenticated to the owner's account:

```bash
node scripts/build-piano-samples.mjs        # must print "matches scripts/piano-samples.lock.json"
sha256sum build/piano-samples/splendid-grand-piano-v1.tar   # must equal "sha256" in the lock
gh release create piano-samples-v1 build/piano-samples/splendid-grand-piano-v1.tar \
  --repo MarchalMaxim/digitus2 --target main --title "Piano samples v1" \
  --notes-file build/piano-samples/README.md --latest=false
```

`--latest=false` keeps the release from being shown as the project's latest version. The tag is created on `main`; it only labels the asset.

- [ ] **Step 2: Write the fetch script.** Create `scripts/fetch-piano-samples.mjs`:

```js
#!/usr/bin/env node
// Puts the piano samples where the app serves them (issue #51): downloads the release asset named
// in scripts/piano-samples.lock.json, checks its size and SHA-256, checks every file against the
// asset's manifest, and unpacks it into apps/web/public/piano (gitignored). vite dev, vite preview
// and the build then serve the samples at <base>piano/. The Pages workflow runs it before the
// build; run it once locally to hear the piano. A run with nothing to do says so. Run it from the
// repository root.
//
//   node scripts/fetch-piano-samples.mjs [--from <tar>] [--dest <dir>]
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LOCK_FILE, checkAssetEntries, readTar, sha256 } from './piano-samples-lib.mjs';

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
const dest = resolve(arg('--dest') ?? 'apps/web/public/piano');
const from = arg('--from');
/** Written last: the SHA-256 of the asset the directory was unpacked from. */
const MARKER = 'asset.sha256';

function upToDate() {
  try {
    if (readFileSync(join(dest, MARKER), 'utf8').trim() !== lock.sha256) return false;
    const names = ['README.md', 'manifest.json', ...lock.files];
    checkAssetEntries(
      names.map((name) => ({ name, data: new Uint8Array(readFileSync(join(dest, name))) })),
      lock,
    );
    return true;
  } catch {
    return false;
  }
}

if (upToDate()) {
  process.stdout.write(`piano samples up to date in ${dest}\n`);
} else {
  let tar;
  if (from) {
    tar = new Uint8Array(readFileSync(from));
  } else {
    const url = `https://github.com/${lock.repository}/releases/download/${lock.tag}/${lock.asset}`;
    process.stdout.write(`downloading ${url}\n`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    tar = new Uint8Array(await response.arrayBuffer());
  }
  if (tar.length !== lock.bytes || sha256(tar) !== lock.sha256)
    throw new Error(
      `the asset does not match ${LOCK_FILE}: ${tar.length} bytes, SHA-256 ${sha256(tar)}`,
    );
  const entries = readTar(tar);
  checkAssetEntries(entries, lock); // only safe plain names: nothing can land outside dest
  const partial = `${dest}.partial`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  for (const e of entries) writeFileSync(join(partial, e.name), e.data);
  writeFileSync(join(partial, MARKER), `${lock.sha256}\n`);
  rmSync(dest, { recursive: true, force: true });
  renameSync(partial, dest);
  process.stdout.write(`piano samples: ${entries.length} files unpacked into ${dest}\n`);
}
```

- [ ] **Step 3: Check it against the local tar, then the release.** `node scripts/fetch-piano-samples.mjs --from build/piano-samples/splendid-grand-piano-v1.tar --dest build/piano-samples/unpacked` unpacks 454 files; a second run prints `up to date`; delete one `.ogg` from `build/piano-samples/unpacked` and run again: it unpacks again. After the controller's release exists: `node scripts/fetch-piano-samples.mjs` downloads into `apps/web/public/piano`, and `node scripts/check-repo-size.mjs` still passes (the directory is ignored, so its 44 MB are not counted).

- [ ] **Step 4: Say when the samples are missing.** In `apps/web/vite.config.ts` add, above `export default`:

```ts
/**
 * Says once, in `vite dev` and `vite build`, when the piano samples are not in public/piano
 * (`node scripts/fetch-piano-samples.mjs` puts them there). Without them Play says the piano
 * sounds could not be loaded; `?audio=silent` plays without them.
 */
function pianoSamplesNotice(): Plugin {
  return {
    name: 'digitus2:piano-samples-notice',
    // ResolvedConfig has no isPreview in Vite 8; the plugin's apply hook gets it in ConfigEnv.
    apply: (_config, env) => !env.isPreview,
    configResolved(config) {
      if (process.env.VITEST || !config.publicDir) return;
      if (existsSync(join(config.publicDir, 'piano', 'manifest.json'))) return;
      config.logger.warn(
        'No piano samples in public/piano: run `node scripts/fetch-piano-samples.mjs` to hear the piano.',
      );
    },
  };
}
```

with `import { existsSync } from 'node:fs';`, `import { join } from 'node:path';`, `import type { Plugin } from 'vite';`, and `plugins: [react(), pianoSamplesNotice()]`.

- [ ] **Step 5: The Pages workflow.** In `.github/workflows/pages.yml`, between `pnpm install --frozen-lockfile` and the engine build, add the cache and fetch steps; after the app build, add the check:

```yaml
- run: pnpm install --frozen-lockfile
# The piano samples (issue #51): the release asset pinned by scripts/piano-samples.lock.json,
# unpacked into apps/web/public/piano, which the build copies to <base>piano/.
- uses: actions/cache@v4
  with:
    path: apps/web/public/piano
    key: piano-samples-${{ hashFiles('scripts/piano-samples.lock.json') }}
- run: node scripts/fetch-piano-samples.mjs
- run: pnpm --filter @digitus2/engine build
- run: pnpm --filter @digitus2/web exec vite build --base=/${{ github.event.repository.name }}/
- run: test -f apps/web/dist/piano/manifest.json
```

Update the workflow's header comment: one sentence saying that it also unpacks the piano samples from the pinned release asset. The CI workflow does not change: its e2e run answers sample requests with routes.

- [ ] **Step 6: Verify locally.** With the samples fetched: `pnpm --filter @digitus2/web build`, then `apps/web/dist/piano/PP_Cs1.ogg` exists; `pnpm --filter @digitus2/web preview`, then `curl -sI http://localhost:4173/piano/PP_Cs1.ogg` shows `200` and `audio/ogg` and `curl -sI http://localhost:4173/piano/PP_Cs1.m4a` shows `audio/mp4`; stop the preview. Then `pnpm verify` (in the background) passes, with the benchmark steps' SKIP stated if the datasets are absent.

**Done when:** the release exists with the asset, the fetch script reproduces `apps/web/public/piano` from it and from the local tar, the build copies it to `dist/piano`, the Pages workflow fetches before the build and checks after it, and `pnpm verify` passes.

### Task 4: Web app manifest and icons

**Model:** sonnet

Why: every file is given in full.

**Files:** create `apps/web/public/manifest.webmanifest`, `apps/web/public/icon.svg`, `scripts/render-icons.mjs`, the three PNGs under `apps/web/public/icons/`, `apps/web/src/app/webManifest.test.ts`; modify `apps/web/index.html`.

- [ ] **Step 1: Write the failing test.** Create `apps/web/src/app/webManifest.test.ts`:

```ts
// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publicFile = (path: string) => new URL(`../../public/${path}`, import.meta.url);
const manifest = JSON.parse(readFileSync(publicFile('manifest.webmanifest'), 'utf8')) as {
  [key: string]: unknown;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};

describe('the web app manifest', () => {
  it('installs the app full screen under its name, wherever the site is served', () => {
    expect(manifest).toMatchObject({
      id: './',
      name: 'digitus2',
      short_name: 'digitus2',
      start_url: './',
      scope: './',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#ffffff',
    });
    expect(manifest).not.toHaveProperty('description');
  });

  it('lists PNG icons of the sizes it claims, a maskable one included', () => {
    for (const icon of manifest.icons) {
      const png = readFileSync(publicFile(icon.src));
      expect(png.subarray(0, 8).toString('hex'), icon.src).toBe('89504e470d0a1a0a');
      const [width, height] = icon.sizes.split('x').map(Number);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], icon.src).toEqual([width, height]);
      expect(icon.type).toBe('image/png');
    }
    expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);
    expect(existsSync(publicFile('icons/apple-touch-icon.png'))).toBe(true);
  });

  it('draws the icon in black and white only', () => {
    const svg = readFileSync(publicFile('icon.svg'), 'utf8');
    expect(new Set(svg.match(/#[0-9a-f]{3,8}\b/gi))).toEqual(new Set(['#000000', '#ffffff']));
  });

  it('is linked from index.html with the icon and the Apple touch icon', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
  });
});
```

Run it: it fails.

- [ ] **Step 2: The manifest.** Create `apps/web/public/manifest.webmanifest` (relative URLs resolve against the manifest's own URL, so the same file works under `/` and `/digitus2/`; the colours are white, outside the colour guard's scope, and black and white only):

```json
{
  "id": "./",
  "name": "digitus2",
  "short_name": "digitus2",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 3: The icon.** Create `apps/web/public/icon.svg`: a white "2" stroked on full-bleed black, all of it within the maskable safe circle (radius 40 % of the size around the centre); no text, so no font is involved:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#000000" />
  <path
    d="M176 196a80 80 0 1 1 152 36L176 380h160"
    fill="none"
    stroke="#ffffff"
    stroke-width="44"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>
```

Create `scripts/render-icons.mjs`, which renders the SVG to the three PNGs with Playwright's Chromium (a dev dependency of apps/web; no image library is needed):

```js
#!/usr/bin/env node
// Renders apps/web/public/icon.svg to the PNG icons the web app manifest and iOS need. Run it from
// the repository root after changing the SVG, and commit the PNGs: node scripts/render-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const svg = readFileSync(new URL('../apps/web/public/icon.svg', import.meta.url), 'utf8');
const out = new URL('../apps/web/public/icons/', import.meta.url);
const SIZES = { 'icon-192.png': 192, 'icon-512.png': 512, 'apple-touch-icon.png': 180 };

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, size] of Object.entries(SIZES)) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    writeFileSync(new URL(name, out), await page.screenshot({ type: 'png' }));
    await page.close();
    process.stdout.write(`${name} ${size} x ${size}\n`);
  }
} finally {
  await browser.close();
}
```

Run `node scripts/render-icons.mjs`. Open the three PNGs and check them: a white "2" centred on black, nothing cut off.

- [ ] **Step 4: Link them.** In `apps/web/index.html`, after `<meta name="color-scheme" content="light dark" />`, add:

```html
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
```

Vite prefixes public files in `index.html` with the base path. No `theme-color` meta: the colour guard forbids colour literals in `index.html`.

- [ ] **Step 5: Verify.** The test passes. In PowerShell (or Git Bash with `MSYS_NO_PATHCONV=1`): `pnpm --filter @digitus2/web exec vite build --base=/digitus2/ --outDir ../../build/web-base-check`, then `build/web-base-check/index.html` contains `href="/digitus2/manifest.webmanifest"`, `href="/digitus2/icon.svg"` and `href="/digitus2/icons/apple-touch-icon.png"`, and `build/web-base-check/manifest.webmanifest` and the icons exist; delete `build/web-base-check`. `pnpm verify hygiene design typecheck lint unit build bundle` passes (the PNGs are small; the colour guard does not scan `public/`).

**Done when:** the manifest, the SVG and the three PNGs exist and pass the test, `index.html` links them, and a `--base=/digitus2/` build rewrites the links.

### Task 5: The service worker and its build

**Model:** opus

Why: integration work: a Vite plugin with a nested build, the cache policy, the service worker.

**Files:** create `apps/web/src/sw/policy.ts`, `policy.test.ts`, `precache.ts`, `precache.test.ts`, `sw.ts`, `vitePlugin.ts`; modify `apps/web/vite.config.ts` and `.github/workflows/pages.yml`. Nothing registers the worker yet (Task 6), so the e2e suite is unaffected.

- [ ] **Step 1: Write the failing policy tests.** Create `apps/web/src/sw/policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import lock from '../../../../scripts/piano-samples.lock.json';
import {
  ASSETS_CACHE,
  PIANO_CACHE,
  isCacheable,
  obsoleteCaches,
  precacheName,
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

  it('names the piano cache after the release the samples come from', () => {
    expect(PIANO_CACHE).toBe(`digitus2-${lock.tag}`);
  });
});
```

Create `apps/web/src/sw/precache.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { precacheList, type BuildManifest } from './precache.js';

const manifest: BuildManifest = {
  'index.html': { file: 'assets/index-abc.js' },
  '../../content/manifest.json': { file: 'assets/manifest-def.json' },
  '../../content/scores/twinkle.musicxml': { file: 'assets/twinkle-111.musicxml' },
  '../../content/scores/twinkle.musicxml?url': {
    file: 'assets/twinkle-222.js',
    assets: ['assets/twinkle-111.musicxml'],
  },
  '../../content/scores/song.musicxml.gz?url': {
    file: 'assets/song-333.js',
    assets: ['assets/song.musicxml-444.gz'],
  },
};

describe('the precache list', () => {
  it('keeps the shell, the workers and the library data, and leaves scores, maps and samples out', () => {
    const files = [
      'index.html',
      'sw.js',
      '.vite/manifest.json',
      'assets/index-abc.js',
      'assets/index-abc.js.map',
      'assets/verovio.worker-zz.js',
      'assets/manifest-def.json',
      'assets/twinkle-111.musicxml',
      'assets/twinkle-222.js',
      'assets/song-333.js',
      'assets/song.musicxml-444.gz',
      'piano/PP_Cs1.ogg',
      'piano/manifest.json',
      'licenses\\pdfjs.txt',
      'manifest.webmanifest',
      'icons/icon-192.png',
    ];
    expect(precacheList(files, manifest)).toEqual([
      'assets/index-abc.js',
      'assets/manifest-def.json',
      'assets/verovio.worker-zz.js',
      'icons/icon-192.png',
      'index.html',
      'licenses/pdfjs.txt',
      'manifest.webmanifest',
    ]);
  });
});
```

Run `pnpm --filter @digitus2/web exec vitest run src/sw`: they fail.

- [ ] **Step 2: The policy.** Create `apps/web/src/sw/policy.ts`:

```ts
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

/** `precached` holds paths relative to the scope, such as `index.html` or `assets/index-abc.js`. */
export function routeRequest(
  request: { url: string; method: string; mode: string },
  scope: string,
  precached: ReadonlySet<string>,
): SwRoute {
  if (request.method !== 'GET') return NETWORK;
  const url = new URL(request.url);
  const base = new URL(scope);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return NETWORK;
  if (request.mode === 'navigate') return { kind: 'navigate' };
  const path = url.pathname.slice(base.pathname.length);
  if (precached.has(path)) return { kind: 'precache' };
  if (path.startsWith('assets/')) return { kind: 'runtime', cache: ASSETS_CACHE };
  if (path.startsWith('piano/')) return { kind: 'runtime', cache: PIANO_CACHE };
  return NETWORK;
}

/**
 * Whether a fetched response may be kept: a whole (200) response that is not a page, because the
 * Vite servers answer a missing file with index.html and 200; in the piano cache, audio only.
 */
export function isCacheable(
  response: { status: number; type: string; headers: { get(name: string): string | null } },
  cache: string,
): boolean {
  if (response.status !== 200 || response.type === 'opaque') return false;
  const type = (response.headers.get('content-type') ?? '').toLowerCase();
  if (type.startsWith('text/html')) return false;
  return cache !== PIANO_CACHE || type.startsWith('audio/');
}

/** The caches an activating worker deletes: older precaches and an older piano cache. */
export function obsoleteCaches(names: readonly string[], currentPrecache: string): string[] {
  return names.filter(
    (name) =>
      (name.startsWith(PRECACHE_PREFIX) && name !== currentPrecache) ||
      (name.startsWith(PIANO_PREFIX) && name !== PIANO_CACHE),
  );
}
```

- [ ] **Step 3: The precache list.** Create `apps/web/src/sw/precache.ts`:

```ts
/** Vite's build manifest (`dist/.vite/manifest.json`), as far as the precache reads it. */
export type BuildManifest = Record<string, { file: string; assets?: string[] }>;

/** The largest precache the build accepts (about 16 MiB today: Verovio 8.2 MB, the library 3.7 MB). */
export const PRECACHE_MAX_BYTES = 24 * 1024 * 1024;

/**
 * The files the service worker installs with: every file of the build except source maps,
 * Vite's manifest, the service worker itself, the piano samples (kept as they are played) and the
 * library's score files with their per-score URL chunks (kept as pieces open; there are thousands).
 * Paths relative to the build directory with `/`, sorted. The engine and Verovio worker chunks are
 * not keys of Vite's manifest, which is why the list starts from the files on disk.
 */
export function precacheList(files: readonly string[], manifest: BuildManifest): string[] {
  const scores = new Set<string>();
  for (const [key, chunk] of Object.entries(manifest)) {
    if (!key.includes('content/scores/')) continue;
    scores.add(chunk.file);
    for (const asset of chunk.assets ?? []) scores.add(asset);
  }
  return files
    .map((f) => f.replace(/\\/g, '/'))
    .filter(
      (f) =>
        !f.startsWith('.vite/') &&
        !f.endsWith('.map') &&
        f !== 'sw.js' &&
        !f.startsWith('piano/') &&
        !scores.has(f),
    )
    .sort();
}
```

Run the tests: they pass.

- [ ] **Step 4: The service worker.** Create `apps/web/src/sw/sw.ts`:

```ts
/**
 * The service worker (issue #35), built to `sw.js` next to index.html as one classic script by
 * vitePlugin.ts, which fills in `__PRECACHE__` (the shell, see precache.ts) and `__VERSION__` (a
 * hash of those files). It installs with the precache and takes control of the open pages on its
 * first activation. A newer build's worker waits until every window of the app has closed, so a
 * page never loses the chunks it was built with; on activation it deletes older precaches and
 * keeps the scores and samples cached so far. Routing: policy.ts.
 */
import {
  ASSETS_CACHE,
  ASSETS_CACHE_MAX_ENTRIES,
  NAVIGATION_TIMEOUT_MS,
  isCacheable,
  obsoleteCaches,
  precacheName,
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
  // `cache: 'reload'` skips the HTTP cache, so index.html and its chunks come from the same build.
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) =>
        cache.addAll(__PRECACHE__.map((path) => new Request(urlOf(path), { cache: 'reload' }))),
      ),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(obsoleteCaches(names, PRECACHE).map((n) => caches.delete(n))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event) => {
  const route = routeRequest(event.request, scope, PRECACHED);
  if (route.kind === 'navigate') event.respondWith(navigate(event.request));
  else if (route.kind === 'precache') event.respondWith(fromPrecache(event.request));
  else if (route.kind === 'runtime') event.respondWith(cacheFirst(event, route.cache));
});

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

async function fromPrecache(request: Request): Promise<Response> {
  return (
    (await caches.match(request, { cacheName: PRECACHE, ignoreSearch: true })) ?? fetch(request)
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
```

The DOM library types `self`, `caches`, `Request` and `Response`; the worker's own events are typed locally (as `verovio.worker.ts` does), because the DOM and WebWorker libraries conflict in one program.

- [ ] **Step 5: The build plugin.** Create `apps/web/src/sw/vitePlugin.ts` (build-time code, imported by `vite.config.ts` only):

```ts
/**
 * Builds the service worker (sw.ts) into `sw.js` after every production build (`vite build`,
 * whatever runs it: `pnpm build`, the e2e script, the Pages workflow with `--base`). Once the
 * bundle is on disk it lists the precache from the files written (precache.ts), hashes them into a
 * version, and builds sw.ts as one classic script with both filled in, so a new build installs a
 * new worker. The build fails when the precache grows past PRECACHE_MAX_BYTES.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build, type Plugin, type ResolvedConfig } from 'vite';
import { PRECACHE_MAX_BYTES, precacheList, type BuildManifest } from './precache.js';

function walk(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

export function serviceWorkerPlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'digitus2:service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      if (config.build.ssr) return;
      const outDir = resolve(config.root, config.build.outDir);
      const manifest = JSON.parse(
        readFileSync(join(outDir, '.vite', 'manifest.json'), 'utf8'),
      ) as BuildManifest;
      const files = precacheList(walk(outDir), manifest);
      if (!files.includes('index.html'))
        throw new Error('service worker: no index.html in the build');
      const version = createHash('sha256');
      let bytes = 0;
      for (const file of files) {
        const data = readFileSync(join(outDir, file));
        bytes += data.length;
        version.update(`${file}\n${createHash('sha256').update(data).digest('hex')}\n`);
      }
      if (bytes > PRECACHE_MAX_BYTES)
        throw new Error(
          `service worker: the precache is ${mib(bytes)} MiB, over ${mib(PRECACHE_MAX_BYTES)} MiB; ` +
            'is a score or sample folder no longer excluded? (src/sw/precache.ts)',
        );
      const hash = version.digest('hex').slice(0, 12);
      await build({
        configFile: false,
        root: config.root,
        logLevel: 'warn',
        define: { __PRECACHE__: JSON.stringify(files), __VERSION__: JSON.stringify(hash) },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          manifest: false,
          sourcemap: false,
          minify: true,
          target: 'es2022',
          lib: {
            entry: join(config.root, 'src/sw/sw.ts'),
            formats: ['iife'],
            name: 'digitus2ServiceWorker',
            fileName: () => 'sw.js',
          },
        },
      });
      config.logger.info(
        `service worker: ${files.length} files, ${mib(bytes)} MiB precached, version ${hash}`,
      );
    },
  };
}
```

In `apps/web/vite.config.ts`, import it (`import { serviceWorkerPlugin } from './src/sw/vitePlugin.js';`) and set `plugins: [react(), pianoSamplesNotice(), serviceWorkerPlugin()]`. In `.github/workflows/pages.yml`, extend the check after the build to `test -f apps/web/dist/piano/manifest.json && test -f apps/web/dist/sw.js && test -f apps/web/dist/manifest.webmanifest`.

- [ ] **Step 6: Verify.** `pnpm --filter @digitus2/web build` prints the `service worker:` line (expect about 30 files and 16 MiB) and writes `apps/web/dist/sw.js`, a single IIFE that contains `digitus2-precache-`, `index.html` and the Verovio worker's file name, and no `.musicxml` path. `node scripts/check-bundle-size.mjs` passes and does not count `sw.js` (the nested build writes no manifest entry). The `--base=/digitus2/` build of Task 4, Step 5 also produces `sw.js`. `pnpm verify hygiene design typecheck lint unit build bundle` passes; the e2e suite is unchanged because nothing registers the worker yet.

**Done when:** the policy and precache tests pass, every production build writes `sw.js` with the precache list and a version, the precache stays under its cap, and the bundle check passes.

### Task 6: Registration, with service workers blocked in the e2e suite

**Model:** sonnet

Why: two small files and two short edits, all given below.

**Files:** create `apps/web/src/app/serviceWorker.ts` and `apps/web/src/app/serviceWorker.test.ts`; modify `apps/web/src/main.tsx` and `apps/web/playwright.config.ts`.

- [ ] **Step 1: Write the failing test.** Create `apps/web/src/app/serviceWorker.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, type ServiceWorkerHost } from './serviceWorker.js';

function fakeHost(overrides: Partial<ServiceWorkerHost> = {}) {
  const onLoad: (() => void)[] = [];
  const register = vi.fn(() => Promise.resolve({} as ServiceWorkerRegistration));
  const host: ServiceWorkerHost = {
    prod: true,
    base: '/digitus2/',
    serviceWorker: { register },
    whenLoaded: (run) => onLoad.push(run),
    ...overrides,
  };
  return { host, register, load: () => onLoad.forEach((run) => run()) };
}

describe('registerServiceWorker', () => {
  it('registers sw.js at the base path once the page has loaded, updates bypassing the HTTP cache', async () => {
    const { host, register, load } = fakeHost();
    registerServiceWorker(host);
    expect(register).not.toHaveBeenCalled();
    load();
    await vi.waitFor(() =>
      expect(register).toHaveBeenCalledWith('/digitus2/sw.js', {
        scope: '/digitus2/',
        updateViaCache: 'none',
      }),
    );
  });

  it('does nothing on a development server or where the browser has no service workers', () => {
    const dev = fakeHost({ prod: false });
    registerServiceWorker(dev.host);
    dev.load();
    expect(dev.register).not.toHaveBeenCalled();
    const none = fakeHost({ serviceWorker: undefined });
    expect(() => {
      registerServiceWorker(none.host);
      none.load();
    }).not.toThrow();
  });

  it('stays silent when the registration fails or throws', async () => {
    const errors = vi.spyOn(console, 'error');
    const rejected = fakeHost();
    rejected.register.mockImplementation(() => Promise.reject(new Error('blocked')));
    registerServiceWorker(rejected.host);
    rejected.load();
    const thrown = fakeHost();
    thrown.register.mockImplementation(() => {
      throw new Error('insecure context');
    });
    registerServiceWorker(thrown.host);
    expect(() => thrown.load()).not.toThrow();
    await vi.waitFor(() => expect(thrown.register).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
```

Run it: it fails.

- [ ] **Step 2: The module.** Create `apps/web/src/app/serviceWorker.ts`:

```ts
/**
 * Registers the service worker (src/sw/sw.ts, built to `sw.js` next to index.html) once the page
 * has loaded, on production builds only: `vite dev` serves no sw.js. `updateViaCache: 'none'`
 * makes the browser check sw.js itself for a new build. A failed registration (blocked site data,
 * an insecure origin) leaves the app as it was, online only, and says nothing: there is nothing a
 * reader could do about it.
 */
export interface ServiceWorkerHost {
  prod: boolean;
  /** Vite's base path, ending in '/'. */
  base: string;
  serviceWorker: Pick<ServiceWorkerContainer, 'register'> | undefined;
  whenLoaded(run: () => void): void;
}

export function registerServiceWorker(host: ServiceWorkerHost = browserHost()): void {
  const container = host.serviceWorker;
  if (!host.prod || !container) return;
  host.whenLoaded(() => {
    Promise.resolve()
      .then(() =>
        container.register(`${host.base}sw.js`, { scope: host.base, updateViaCache: 'none' }),
      )
      .catch(() => undefined);
  });
}

function browserHost(): ServiceWorkerHost {
  return {
    prod: import.meta.env.PROD,
    base: import.meta.env.BASE_URL,
    serviceWorker: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    whenLoaded: (run) => {
      if (document.readyState === 'complete') run();
      else window.addEventListener('load', run, { once: true });
    },
  };
}
```

In `apps/web/src/main.tsx`, import it (`import { registerServiceWorker } from './app/serviceWorker.js';`) and call `registerServiceWorker();` on its own line after the `Promise.all(...)` chain, with the comment `// Offline use and installing (issue #35): the service worker, registered once the page has loaded.`

- [ ] **Step 3: Block service workers in the e2e suite.** In `apps/web/playwright.config.ts`, add to the global `use`:

```ts
    // The production build registers a service worker (src/app/serviceWorker.ts). Page routes do
    // not see the requests a service worker answers, so every spec blocks it; e2e/pwa.spec.ts
    // alone allows it.
    serviceWorkers: 'block',
```

- [ ] **Step 4: Verify.** The unit test passes. `pnpm verify` passes in full (in the background); the whole e2e suite runs as before because Playwright replaces `register` in every context. The bundle step shows the entry grown by well under 1 KB gzip.

**Done when:** the production app registers `sw.js` after `load` at the base path, nothing changes in dev or in the existing e2e specs, and `pnpm verify` passes.

### Task 7: The offline end-to-end spec

**Model:** opus

Why: it runs real service workers in Playwright and may need debugging.

**Files:** create `apps/web/e2e/pwa.spec.ts`. It runs in the `desktop` project only (the `mobile` project's `testMatch` does not include it).

- [ ] **Step 1: Write the spec.** Create `apps/web/e2e/pwa.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { ASSETS_CACHE, PIANO_CACHE } from '../src/sw/policy.js';
import { PIANO_SAMPLES, silentWav } from './helpers/samples.js';

// The installable, offline app (issues #35 and #51). This spec alone lets the app register its
// service worker; every other spec blocks it (playwright.config.ts). With service workers allowed,
// Playwright applies the context's offline mode and context.route to the worker's own fetches.
test.use({ serviceWorkers: 'allow' });

const TWINKLE = '#/piece/twinkle-twinkle-little-star';
const DIGITS = '.score-sheet g.fing';

/** Waits until the service worker has installed (its precache complete) and controls the page. */
async function controlled(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000,
  });
}

/** The paths kept in one of the app's caches. */
function cachedPaths(page: Page, name: string): Promise<string[]> {
  return page.evaluate(
    async (cacheName) =>
      (await (await caches.open(cacheName)).keys()).map((r) => new URL(r.url).pathname),
    name,
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
  expect(worker.caches.some((name) => name.startsWith('digitus2-precache-'))).toBe(true);
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

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(DIGITS)).toHaveCount(64, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
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
  const urls = [...new Set(served.map((s) => new URL(s.url).pathname))].sort();
  await expect.poll(async () => (await cachedPaths(page, PIANO_CACHE)).sort()).toEqual(urls);

  await context.unroute(PIANO_SAMPLES);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(DIGITS)).toHaveCount(64, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/piano sounds could not be loaded/)).toHaveCount(0);
});
```

- [ ] **Step 2: Run it.** `pnpm --filter @digitus2/web build`, stop any stale preview on port 4173, then `pnpm --filter @digitus2/web exec playwright test e2e/pwa.spec.ts --project=desktop`. All four tests pass. If the samples test sees `byWorker` false, check that `context.route` (not `page.route`) is used; if offline reloads fail, open the trace (`--trace on`) and check which request missed the cache before changing the worker. Do not weaken an assertion to get green: a failure here is a real offline gap.

- [ ] **Step 3: Verify.** Prettier on the spec. `pnpm verify` passes in full; the e2e step now includes `pwa.spec.ts`.

**Done when:** the four tests pass: the manifest and icons are served, the worker installs and controls the first visit, Twinkle opened once reloads offline with its 64 digits, and the piano plays offline from samples the worker kept.

### Task 8: Docs

**Model:** opus

Why: judgement on wording, present tense, numbers taken from the real build.

**Files:** modify `docs/app.md`, `docs/PROGRESS.md`, `docs/verification-loop.md`, `docs/TODO.md`, `docs/superpowers/specs/2026-10-13-digitus2-design.md`. `README.md` does not change.

- [ ] **Step 1: `docs/app.md`.**
  - Architecture table: add a row "Offline" whose Where cell is `src/sw/`, `src/app/serviceWorker.ts` and whose What cell reads: The service worker: the app shell precached, scores and piano samples kept as they are used; registered on production builds.
  - Add a section `### Offline and installing` after `#### Ornament playback` (before `## Screens`): the manifest (standalone, black-and-white icons, relative start URL and scope, no install button: the browser's own install UI on Android, Share and Add to Home Screen on iOS); the worker's caches and strategies (precache of about 30 files and 16 MiB, version per build, the 24 MiB cap; navigations network first with a 4 s timeout, then the cached shell; `digitus2-assets` cache first with at most 600 entries; `digitus2-piano-samples-v1` cache first, audio only); updates (no `skipWaiting`: a new build takes over once every window of the app has closed; older precaches deleted on activation); what works offline (a piece opened before, with the piano samples its first Play fetched).
  - Audio, first bullet: replace the smplr-host wording with the self-hosted samples: the Splendid Grand Piano samples are the release asset `piano-samples-v1` (452 files, 226 samples in Ogg Opus and in AAC, public domain), pinned by `scripts/piano-samples.lock.json` and served by the app at `<base>piano/` under safe names (`PP C#1` is `PP_Cs1`, `src/audio/pianoSamples.ts`); Safari fetches the `.m4a` files, other browsers the `.ogg`; a sample that does not arrive as audio makes Play say the piano sounds could not be loaded. Add how a new sample set ships: a new tag and asset name in `scripts/piano-samples-lib.mjs`, `PIANO_CACHE` in `src/sw/policy.ts`, then `node scripts/build-piano-samples.mjs --write-lock` and a new release.
  - Running: add rows `node scripts/fetch-piano-samples.mjs` (downloads the pinned release asset, about 44 MB, into the gitignored `apps/web/public/piano`, which dev, preview and the build serve; does nothing when it is already there) and `node scripts/build-piano-samples.mjs` (rebuilds the asset from the pinned source and checks it against the lock; `--write-lock` for a new asset). Say that without the samples `vite dev` and `vite build` warn and Play says the piano sounds could not be loaded, and that `?audio=silent` needs no samples. The Pages workflow paragraph: it fetches the samples before the build.
  - Testing: service workers are blocked in every spec (`serviceWorkers: 'block'`) except `pwa`; add a `pwa` bullet to the specs (manifest and icons, the worker installing and controlling the first visit, Twinkle reloaded offline, the piano played offline from kept samples); the `playback` bullet's first-Play test now also checks that the samples are requested same-origin from `/piano/`.
  - Performance budget: a gate row `Service worker precache | at most 24 MiB | src/sw/vitePlugin.ts (step build)`; a measurement row with the numbers the build printed in Task 5 (files, MiB) and the gzip transfer (about 3.4 MiB, mostly Verovio, which the library warms up anyway).
  - Known limitations: remove the bullet "Piano samples load from smplr's hosted sample site …" and the sentence "The app is not a PWA: it needs the network to load (#35)." Add: offline, only pieces opened before open, and the piano plays only the samples fetched before (another piece may need others, and then Play says the sounds could not be loaded); a new build reaches an open app only after every window of it has closed; the installed app's splash screen and status bar are white in dark mode (the manifest's colours are fixed, and the colour guard keeps colour literals out of `index.html`); iOS shows no install prompt.

- [ ] **Step 2: `docs/PROGRESS.md`.**
  - Key code: `apps/web/src/`: add `sw/` (the service worker, its routing and build plugin); `scripts/`: add `build-piano-samples.mjs`, `fetch-piano-samples.mjs` and `render-icons.mjs`.
  - Outside the repository: add a row `apps/web/public/piano/`, `build/piano-samples/` | the piano samples unpacked for the app; the asset build and its downloads | `node scripts/fetch-piano-samples.mjs` (release asset `piano-samples-v1`, pinned by `scripts/piano-samples.lock.json`); `node scripts/build-piano-samples.mjs`.
  - Milestones: the M8 row becomes "Done: Pages deployment (M12), dark mode, motion, the installable PWA (M13). Open: MIDI held notes (#34)."; add a row `M13 Mobile as a PWA | done, except phone photo input (#35)` with: installable web app (manifest, black-and-white icons, standalone); a hand-written service worker precaching the shell, Verovio and the library data and keeping scores and piano samples as they are used, so a piece opened once opens and plays offline; the piano samples self-hosted from the release asset `piano-samples-v1` (#51).
  - Decisions, App and UI: add "Piano samples are self-hosted" (release asset, both formats, safe names, the lock as the single pin, the Pages workflow unpacking it) and "The service worker is hand-written" (no dependency, the strategies, no `skipWaiting`, blocked in every e2e spec but `pwa`). Replace "made installable as a PWA (#35)" in the GitHub Pages decision with "installable as a PWA".
  - Known limitations, App and tests: the line "Repeats are not expanded in playback (#50); the piano samples load from smplr's host (#51)." becomes "Repeats are not expanded in playback (#50)."; add one line on the offline limits (pieces and samples used before).
  - Next: item 4 "PWA (#35)." becomes "Phone photo input (#35), with the scanning work."

- [ ] **Step 3: `docs/verification-loop.md`.** In the `hygiene` detail, add `apps/web/public/piano` and `build/piano-samples` to the heavy directories that must be ignored. In the `e2e` detail, add that `pwa.spec.ts` checks the manifest, the service worker and an offline reload, and that every other spec blocks service workers. In the CI section, say that the Pages workflow fetches the pinned piano samples before the build and checks that `dist` holds them, `sw.js` and the manifest.

- [ ] **Step 4: `docs/superpowers/specs/2026-10-13-digitus2-design.md`.** Line "M8 Polish: done except the installable PWA (M13). …" becomes "M8 Polish: done. Motion craft, dark mode, accessibility, performance, mobile layout, Pages deployment, the installable PWA (M13), documentation." Line "M13 Mobile as a PWA: not built. …" becomes "M13 Mobile as a PWA: done, except phone photo input (#35). No native app (non-goal); the responsive web app installs from the browser (web manifest, standalone) and a service worker keeps the shell, the library and the piano samples, so a piece opened once opens and plays offline. The piano samples are served from the app's own site (#51)."

- [ ] **Step 5: `docs/TODO.md`.** Append to "Done or closed":

```markdown
- **#51** Self-host the piano samples ("let's do it with a release asset"): done. The 452 Splendid Grand Piano files (226 public-domain samples, Ogg Opus and AAC) are the release asset `piano-samples-v1`, pinned by SHA-256 in `scripts/piano-samples.lock.json`; the Pages workflow unpacks it into the site, smplr loads the samples from the app's own `piano/`, and the service worker keeps them as they are played (`docs/app.md`, Audio).
```

#35 stays open for its photo-input bullet, so it gets no line here.

- [ ] **Step 6: Verify.** `pnpm exec prettier --write` on the changed docs; `pnpm format:check` passes; every number in the docs matches the build log of Task 5 and the asset of Task 1.

**Done when:** the docs describe the current state in the present tense with no smplr-host or not-a-PWA limitation left, the TODO line for #51 is in, and the controller ticks #51's three bullets and #35's manifest, service worker and install-prompt bullets.
