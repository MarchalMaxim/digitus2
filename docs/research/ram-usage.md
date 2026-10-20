# RAM usage

## Method

Production build in Playwright's Chromium (new headless) on Windows 11, 1280 × 900, each piece opened by its address in a fresh browser. The renderer process's private memory comes from Windows (`Get-Process`, the commit charge Chrome's Task Manager shows as the memory footprint on Windows); the JS heap and Blink's heap (the DOM, Oilpan) of the page and of each worker come from the DevTools protocol (`Runtime.getHeapUsage`). Each piece is read four times: the peak while it opens (sampled every 250 ms), 6 s after the score shows, 40 s after, and after a garbage collection forced on every thread. Before and after are two production builds, three runs each, interleaved; the tables give the median. The browser's other processes (GPU, network, storage, about 190 MB) are the same for any page and are left out.

The tab's renderer process holds the page and both workers. With the library list open it takes about 226 MB, most of it the Verovio worker (its fixed 128 MB WASM heap and some 50 MB of compiled code), warmed up there so the first piece opens faster.

## Where it goes

Before the changes below, after a forced GC:

| Piece | Notes (engine) | Pages | Elements in the page | Page Blink heap | Page JS heap | Verovio WASM heap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Twinkle | 64 | 1 | 1,070 | 3 MB | 9 MB | 128 MB |
| Sleeping Beauty waltz | 1,968 | 9 | 29,509 | 52 MB | 14 MB | 128 MB |
| Chopin, Scherzo No. 2 | 6,062 | 32 | 102,785 | 151 MB | 47 MB | 128 MB |
| Beethoven, Symphony No. 9, first movement (piano) | 11,049 | 30 | 146,791 | 229 MB | 42 MB | 154 MB |
| Precure piano medley | 18,363 | 53 | 238,027 | 348 MB | 83 MB | 221 MB |

Three things grow with the piece:

- **The pages' DOM.** Every page of the piece is inline SVG, about 1.5 KB of Blink heap per element, and Verovio's indented markup put a whitespace text node between every two elements (1.5 per element: 229,786 on Beethoven's Ninth). The cost is the node tree itself: the pages off screen already skip style, layout and paint (`content-visibility: auto`, issue #79). The same 30 pages of Beethoven's Ninth in a static page, two runs each:

  | Variant | Renderer | Blink heap |
  | --- | ---: | ---: |
  | Empty page | 22 MB | 0 MB |
  | All 30 pages | 314 to 318 MB | 203 MB |
  | All 30, the 27 after the third `display: none` | 312 MB | 203 MB |
  | Only the first 3 pages | 70 to 73 MB | 32 MB |

- **The engine worker's garbage.** Reading a MusicXML file and writing the fingering back into it each build a whole `@xmldom/xmldom` tree, about 40 bytes of heap per byte of text. In Node, Beethoven's Ninth (6 MB of MusicXML) cannot be parsed in a 160 MB heap and its fingerings cannot be written in 256 MB; the solver needs 55 MB. In the browser the worker's heap reached 252 MB while the piece opened and still held 222 MB once it was idle, until V8 collected it 20 to 30 s later, with the page's own first major GC: the renderer then fell from about 960 to 650 MB.
- **Verovio's WASM heap.** It starts at 128 MB, and a layout that needs more grows it for good: 154 MB for Beethoven's Ninth, 221 MB for the medley. The Scherzo and anything shorter fit in 128 MB.

The page's JS heap holds the SVG markup of the pages laid out (two bytes a character: Verovio writes one SMuFL glyph outside Latin-1, so every page string is a two-byte string), the score, the MusicXML texts and the per-layout lists of the score view; 9 to 83 MB.

## What changed

Renderer private memory, before → after, median of three runs:

| Piece | Peak while it opens | 6 s after | 40 s after | After a forced GC |
| --- | ---: | ---: | ---: | ---: |
| Chopin, Scherzo No. 2 | 844 → 730 MB | 844 → 730 MB | 528 → 472 MB | 527 → 471 MB |
| Beethoven, Symphony No. 9, first movement | 1,016 → 703 MB | 1,016 → 701 MB | 657 → 375 MB | 655 → 376 MB |
| Precure piano medley | 1,540 → 967 MB | 1,509 → 648 MB | 947 → 549 MB | 943 → 550 MB |

Each change's share, added one at a time (6 s after / 40 s after, median of three runs):

| Build | Beethoven's Ninth | Precure medley |
| --- | ---: | ---: |
| Before | 1,016 / 657 MB | 1,509 / 947 MB |
| + no indentation in the SVG | 997 / 610 MB | 1,374 / 859 MB |
| + the engine worker released | 957 / 586 MB | 1,267 / 830 MB |
| + a grown Verovio worker retired | 703 / 375 MB | 648 / 549 MB |

- **No indentation in the SVG** (`svgFormatRaw`, `score/render/options.ts`). Pixel for pixel the same on nine pieces chosen for every kind of text in a score (metronome marks, dynamics, lyrics, words, tuplets, chord symbols, endings, pedals, octave lines, digits), with the same text widths; 42 % less markup and no whitespace text nodes. Every piece gains, in proportion to its length: 47 MB on Beethoven's Ninth (Blink heap 229 → 206 MB, page JS 42 → 36 MB), 88 MB on the medley.
- **The engine worker is released after a long piece** (`engine/client.ts`). Once it has handled a score of 2,000 notes or more (`HEAVY_NOTES`, about a tenth of the library) and then idled for 2 s with nothing pending, it is terminated, and the next call (a hand size change, an export) starts a fresh one; the worker keeps no state between calls. Chrome hands a terminated worker's JS heap back some 20 to 40 s later (a worker holding 520 MB, terminated: 154 MB of WebAssembly memory came back at once, the rest between 20 and 40 s later, and a GC of the page did not hasten it), about when V8 would have collected the garbage anyway. So the release saves less than its garbage: the idle worker itself for the rest of the visit, and part of the garbage sooner, 24 to 107 MB. Shorter pieces keep their warm worker, and the library's warm-up still loads it ahead of the first piece.
- **A Verovio worker whose heap grew is retired** (`score/render/renderer.ts`). The worker reports whether its WASM heap is larger than when it started; such a worker is terminated once nothing is pending, and the next layout or the library's next warm-up starts a fresh one. That frees the whole worker, its first 128 MB and its compiled code with them, and WebAssembly memory comes back at once: 211 MB on Beethoven's Ninth and 281 MB on the medley 40 s after the open. It applies only to the pieces whose layout grows the heap (three in the library: the medley and two movements of Beethoven symphonies, from 10,911 notes; the 40 longest pieces were laid out to find them, and the longest that fits, 9,481 notes, stays at 128 MB), which pay a 0.3 to 0.7 s cold start on their next layout (a new width bucket, the editor's fingering) against a layout of 5 to 8 s. On every other piece the worker and its 128 MB stay, as decided (Verovio options below).

The fixed build still holds about 300 MB more for some 30 s after a long piece opens than once it settles (Beethoven's Ninth: 700 MB, then 375 MB). It all comes back at the page's first major GC, which V8 runs about 30 s after the open, or at once when one is forced. The page's own heaps account for about 90 MB of it; the two main-thread passes that parse the fingered MusicXML before each layout (`normalizeVoices`, `prepareScanBeams`, both through `DOMParser`) for about 24 MB (a build without them: 689 instead of 713 MB). The rest is not pinned down.

`e2e/memory.spec.ts` opens Beethoven's Sonata Op. 79 (2,075 notes) and checks that the engine worker is gone within 10 s while the layout worker stays, and that a hand size change then fingers the piece again; it fails on the build before.

## Options not taken

| Option | Saves | Costs |
| --- | --- | --- |
| Keep only the pages near the screen in the DOM | about 245 MB on Beethoven's Ninth, 400 MB on the medley (the table above) | the cursor, the dimming of a hand, the digit patches after a re-solve, click-to-seek, the red's flight and print all find their elements in every page today; each would have to bring the pages it needs back first |
| Retire the Verovio worker after the layout of every long piece, not only one whose heap grew | the Scherzo: 730 → 515 MB 6 s after the open, 472 → 286 MB 40 s after (two runs of a build that always retires) | 0.3 to 0.7 s on such a piece's next layout; the owner kept the worker warm on purpose, so this is the owner's call |
| Write the fingerings into the MusicXML text, not an xmldom tree | the second tree at the peak of the open (more than 256 MB live on Beethoven's Ninth), about 1 s per open | a change to the engine's output; it needs an equivalence check over the whole library |

## Earlier fixes

- **Library manifest:** importing the manifest as a JS module made V8 keep its source and string literal for all 2,702 entries, about 12 MB. The piece details are fetched as JSON instead; `loadPieceDetails` fetches `manifest.json?url` (tests inject it with `setPieceDetails`).
- **Engine on the main thread:** importing `audio/beats.ts` from the engine index loaded the whole 1 MB engine chunk on the main thread. It uses the `@digitus2/engine/score-build` subpath (`score/build.ts`).

## Verovio options, not taken

| Option | Saves | Costs |
| --- | --- | --- |
| Start on open, release 30 s after the last layout | the whole worker | 0.3 to 0.7 s on the next re-layout |
| Release only on leaving the score view | the same, on the library list only | nothing |
| Patch initial WASM memory 128 → 72 MB at build time | about 56 MB on Windows | fragile on Verovio upgrades |
