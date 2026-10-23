# RAM usage

## Method

Production build in Playwright's Chromium (new headless) on Windows 11, 1280 × 900, each piece opened by its address in a fresh browser. The renderer process's private memory comes from Windows (`Get-Process`, the commit charge Chrome's Task Manager shows as the memory footprint on Windows); the JS heap and Blink's heap (the DOM, Oilpan) of the page and of each worker come from the DevTools protocol (`Runtime.getHeapUsage`). Each piece is read four times: the peak while it opens (sampled every 250 ms), 6 s after the score shows, 40 s after, and after a garbage collection forced on every thread. Before and after are two production builds, three runs each, interleaved; the tables give the median. `apps/web/scripts/measure-ram.mjs` (`--dist <build> --port <n> --runs 3 --rounds 4`) takes the readings, and also scrolls the piece through and reads again (the leak oracle). The browser's other processes (GPU, network, storage, about 190 MB) are the same for any page and are left out.

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
| Chopin, Scherzo No. 2 | 844 → 548 MB | 844 → 517 MB | 528 → 286 MB | 527 → 287 MB |
| Beethoven, Symphony No. 9, first movement | 1,016 → 719 MB | 1,016 → 719 MB | 657 → 376 MB | 655 → 376 MB |
| Precure piano medley | 1,540 → 994 MB | 1,509 → 994 MB | 947 → 543 MB | 943 → 544 MB |

The reading 6 s after depends on whether the page's first major GC has run by then (below): on the medley it was 626 to 648 MB in three other runs of the same code path, which had opened more slowly.

Each change's share, added one at a time (40 s after, median of three runs):

| Build | Scherzo | Beethoven's Ninth | Medley |
| --- | ---: | ---: | ---: |
| Before | 528 MB | 657 MB | 947 MB |
| + no indentation in the SVG | 497 MB | 610 MB | 859 MB |
| + the engine worker released | 471 MB | 586 MB | 830 MB |
| + the Verovio worker retired when its heap grew | 472 MB (does not grow) | 375 MB | 549 MB |
| + the Verovio worker retired after every long piece | 286 MB | 376 MB | 543 MB |

- **No indentation in the SVG** (`svgFormatRaw`, `score/render/options.ts`). Pixel for pixel the same on nine pieces chosen for every kind of text in a score (metronome marks, dynamics, lyrics, words, tuplets, chord symbols, endings, pedals, octave lines, digits), with the same text widths; 42 % less markup and no whitespace text nodes. Every piece gains, in proportion to its length: 47 MB on Beethoven's Ninth (Blink heap 229 → 206 MB, page JS 42 → 36 MB), 88 MB on the medley.
- **The engine worker is released after a long piece** (`engine/client.ts`). Once it has handled a score of 2,000 notes or more (`HEAVY_NOTES`, about a tenth of the library) and then idled for 2 s with nothing pending, it is terminated, and the next call (a hand size change, an export) starts a fresh one; the worker keeps no state between calls. Chrome hands a terminated worker's JS heap back some 20 to 40 s later (a worker holding 520 MB, terminated: 154 MB of WebAssembly memory came back at once, the rest between 20 and 40 s later, and a GC of the page did not hasten it), about when V8 would have collected the garbage anyway. So the release saves less than its garbage: the idle worker itself for the rest of the visit, and part of the garbage sooner, 24 to 107 MB. Shorter pieces keep their warm worker, and the library's warm-up still loads it ahead of the first piece.
- **The Verovio worker is retired after a long piece** (`score/render/renderer.ts`). Once it has laid out a piece of 2,000 notes or more (the score view passes the note count), or its WASM heap has grown past its start (it reports so), it is terminated as soon as nothing is pending, and the next layout or the library's next warm-up starts a fresh one. That frees the whole worker, its 128 MB of WASM heap and its compiled code, and WebAssembly memory comes back at once: 186 MB on the Scherzo, 211 MB on Beethoven's Ninth, 281 MB on the medley. The owner asked for it on every long piece ("retire the Verovio worker after the layout of every piece of 2,000+ notes too", issue #90); at first it covered only the three pieces whose heap grows. The cost is a cold start on such a piece's next layout (a new width bucket, the editor's fingering, a fingering change that adds or removes a digit), measured as the time from a narrower window to the new pages, median of five: Beethoven's Sonata Op. 79 (2,075 notes) 535 → 893 ms, the Scherzo 2.0 → 2.5 s. Playback, the cursor, seeking, hand switches, loops and print need no layout. Shorter pieces keep the warm worker, and the library warms a fresh one up while idle, so the next piece opens as fast as before.

- **Only the pages near the screen are built** (`score/render/pageWindow.ts`, `pageIndex.ts`). A long piece's pages stand as empty SVGs with their viewBox; a page is built within one window height of the window and torn down beyond two, and the page holding the red stays. The pieces of six pages or more are windowed (`WINDOW_MIN_PAGES`); a shorter one and the scan review keep every page. One pass over each layout's markup finds the bars of each page, the page of each note and the notes of each staff place (25 ms on the Scherzo, 34 ms on Beethoven's Ninth, 54 ms on the medley: `buildPageIndex` on the pages the layout worker returns, in Chromium, median of nine), which is all that the cursor, a seek, the bar numbering and the dimming of a whole staff need to know about the pages that are not built. Whatever reads a page brings it in first (the cursor, a seek by key or click, the bar boxes, the note under the pointer); a page built later is dimmed and has the digits patched since the layout as it arrives. Print uses its own engraving, so it needs nothing.

Renderer private memory and the DOM, before → after, median of three runs, interleaved:

| Piece | Peak while it opens | 6 s after | 40 s after | After a forced GC | DOM nodes at 40 s | Pages built at 40 s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chopin, Scherzo No. 2 (37 pages) | 620 → 618 MB | 569 → 384 MB | 297 → 143 MB | 295 → 141 MB | 145,842 → 8,510 | 37 → 2 |
| Beethoven, Symphony No. 9, first movement (35 pages) | 648 → 659 MB | 475 → 234 MB | 371 → 151 MB | 361 → 143 MB | 213,651 → 13,181 | 35 → 2 |
| Precure piano medley (60 pages) | 771 → 805 MB | 580 → 198 MB | 536 → 191 MB | 529 → 183 MB | 340,119 → 12,303 | 60 → 2 |

The first column stays within 5 % (the medley's 771 → 805 MB is the largest change): the peak while a piece opens is the engine worker's garbage and the layout, which come before the pages are built. The page counts are those at 1280 px, where the score draws at 56 %. The scroll height is the same as before to the pixel (44,255 px on the Scherzo).

Scrolling a piece through raises the renderer above its fresh reading, on both builds, and then it stops growing. The leak oracle (`measure-ram.mjs --rounds 4`) scrolls the piece to the bottom a viewport at a time, returns to the top and forces garbage collections, four times, and reads again after 40 s idle. The Scherzo, median of three runs:

| Build | Fresh open | After round 1 | Round 2 | Round 3 | Round 4 | 40 s idle | DOM nodes, fresh → idle | SVG elements detached |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Every page built | 305 MB | 417 MB | 426 MB | 432 MB | 433 MB | 433 MB | 145,842 → 145,842 | 0 |
| Pages near the screen | 143 MB | 209 MB | 211 MB | 212 MB | 214 MB | 215 MB | 8,510 → 8,507 | 0 |

The oracle reads three things. The renderer plateaus after the first round (209 to 214 MB through the four; 417 to 433 MB on the build with every page built). The DOM node count returns to its fresh value (8,510 → 8,507) with the same two pages built, and no SVG element is detached and alive (`Runtime.queryObjects` on `SVGElement.prototype`), so no torn page is held. And the rise itself is the cost of having drawn the pages in turn, not a page kept: the build that tears nothing rises too (+112 to 128 MB against +66 to 72 MB), and one jump to the end and back raises it little (170 → 183 MB, and 324 → 327 MB with every page built) where a scroll a viewport at a time raises it more (to 214 MB and to 420 MB, one run each).

The script waits for the score with a locator, not `page.waitForSelector`: that returns an element handle, which the DevTools console keeps. The handle was a digit on the first page, so once that page was torn the page stayed alive, with 12,168 nodes after the first round instead of 8,510 and 70 to 80 MB more; a heap snapshot lists the five detached objects, all reached from "DevTools console".

`useLastHeads` (`RedFlight.tsx`) keeps the noteheads the cursor marked last once its marks clear, for the flight home and the end burst. After a Rewind or a stop the red's page is no longer pinned and the window can tear it, while the ref still holds those noteheads and, through them, the page's whole detached content until the cursor marks the next group: one page (3,658 nodes on the Scherzo's first). The oracle plays nothing, so it does not see it. Dropping the heads that are no longer connected when the cursor clears would release it.

A long piece holds more for some seconds after it opens than once it settles: the 6 s reading less the 40 s reading is 241 MB on the Scherzo, 83 MB on Beethoven's Ninth and 7 MB on the medley (the table above), and the peak while it opens is 618 to 805 MB. It comes back at the page's first major GC, which V8 runs about 30 s after the open, or at once when one is forced. On the build with every page built, Beethoven's Ninth held about 90 MB of this in the page's own heaps, and about 24 MB in the two main-thread passes that parse the fingered MusicXML before each layout (`normalizeVoices`, `prepareScanBeams`, both through `DOMParser`; a build without them: 689 instead of 713 MB); the rest was not pinned down.

`e2e/memory.spec.ts` opens Beethoven's Sonata Op. 79 and checks that both workers go; that a narrower window lays the piece out again in a fresh layout worker, which goes too; that a hand size change fingers it again; and that the library brings a layout worker back, which Twinkle then keeps. It fails on the build before.

## Options not taken

| Option | Saves | Costs |
| --- | --- | --- |
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
