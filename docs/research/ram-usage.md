# RAM usage

Production build, headless Chromium on Linux, 1280 × 900. Renderer PSS from `/proc/<pid>/smaps_rollup`; JS heaps and WASM memory per page and worker over CDP.

## Where it goes

About 210 MB of the roughly 400 MB total is Chromium's own processes (browser, GPU, network, storage), the same for any tab. The tab's renderer process:

| Step | Renderer PSS (MB) | Page JS heap (MB) |
| --- | ---: | ---: |
| Library list | 149 | 2.4 |
| Twinkle (12 bars) | 189 | 15.1 |
| Sleeping Beauty waltz (298 bars, 30k SVG nodes) | 313 | 20.1 |

- **Verovio worker:** a fixed 128 MB WASM heap (3 MB data, a 64 MB stack, then the heap), plus about 50 MB of compiled code and script. It is warmed up on the library list and lives until the tab closes. Left as is (see `docs/app.md`, Known limitations).
- **Library manifest:** importing the manifest as a JS module made V8 keep its source and string literal for all 2,702 entries, about 12 MB. The piece details are now fetched as JSON instead.
- **Engine on the main thread:** importing `audio/beats.ts` from the engine index loaded the whole 1 MB engine chunk on the main thread. It now uses the `@digitus2/engine/score-build` subpath (`score/build.ts`).
- **Long scores:** the SVG of a 298-bar piece costs about 120 MB; inherent to laying out every page.
- **Engine worker** 10 to 35 MB; **playback** under 20 MB plus Chromium's audio service.

The two fixes cut the page JS heap with Twinkle open from 15.1 to 7.9 MB, and with the long piece from 20.1 to 13.1 MB. `loadPieceDetails` fetches `manifest.json?url` (tests inject it with `setPieceDetails`).

## Verovio options, not taken

| Option | Saves | Costs |
| --- | --- | --- |
| Start on open, release 30 s after the last layout | the whole worker | 0.3 to 0.7 s on the next re-layout |
| Release only on leaving the score view | the same, on the library list only | nothing |
| Patch initial WASM memory 128 → 72 MB at build time | about 56 MB on Windows | fragile on Verovio upgrades |
