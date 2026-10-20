# Hand switch performance (issue #79)

The owner reported the score view as "very sluggish when switching between Left / Right / Both hands" and asked for extensive profiling. This report gives the measurements, the three causes, what each change bought, and the options measured and rejected.

## Method

- Production builds, before and after the change, each served from its own `dist` by an in-process static server on a port nobody else uses (the harness refuses a port that already answers and checks that the served `index.html` is its own). Each build runs in its own Chromium (Playwright 1.59, Chromium 1217, headless), at 1280 x 900, service workers blocked, `?audio=silent`.
- The page is scrolled a third of the way down, as a reader practising a passage would be. Six switches per round (Left, Right, Both, Right, Left, Both), the two builds interleaved switch by switch so both see the same machine load, three rounds. Medians are given; "one hand" pools the switches to Left or Right, "both" the switches back to both hands.
- A click on the hand's label by coordinates (a Playwright role query walks the 100,000 SVG elements of a long piece and would itself show up as a long task).
- Measured inside the page: the click's duration from input to the next paint (Event Timing, [`PerformanceEventTiming`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming)); the long tasks (50 ms or more) in the second after the click; the frame intervals over that second (a frame over 34 ms is janky); the score's running animations right after the click.
- Measured through the DevTools protocol: compositor layers ([`LayerTree`](https://chromedevtools.github.io/devtools-protocol/tot/LayerTree/)), at the peak of a switch and at rest with one hand dimmed, in a separate untimed pass; traces (`devtools.timeline`) and V8 CPU profiles mapped through the build's source maps; a slower phone emulated with 4× CPU throttling ([`Emulation.setCPUThrottlingRate`](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/)).
- The development machine (Windows 11, 16 logical processors) was shared with other sessions' test runs; the interleaving keeps the before and after comparable, and the absolute numbers carry that noise.

The pieces:

| Piece                                   | Bars | Notes | Pages | SVG elements |
| --------------------------------------- | ---: | ----: | ----: | -----------: |
| Twinkle, Twinkle, Little Star           |   12 |    64 |     1 |          911 |
| Mozart, Sonata K.545, 1st movement      |   73 | 1,288 |     5 |       16,487 |
| Kuhlau, Sonatina Op. 20 No. 1, Rondo    |  157 | 1,777 |     5 |       22,483 |
| Chopin, Scherzo No. 2 Op. 31 (archive)  |  780 | 6,670 |    32 |      102,261 |

## Before and after

Switches to one hand (12 per build and speed), medians; in brackets the switches back to both hands (6). Long tasks are the main thread's blocked time in the second after the click.

| Piece          | CPU | Click to paint, before | after           | Long tasks, before | after       | Animations started, before | after |
| -------------- | --: | ---------------------: | --------------- | -----------------: | ----------- | -------------------------: | ----: |
| Twinkle        |  1× |            16 ms (0)   | 0 ms (0)        |            0 ms    | 0 ms        |                         91 |   179 |
| Twinkle        |  4× |            48 ms (32)  | 72 ms (56)      |            0 ms    | 60 ms       |                         91 |   179 |
| Mozart K.545   |  1× |           200 ms (104) | 96 ms (64)      |          424 ms    | 60 ms       |                      1,437 |   751 |
| Mozart K.545   |  4× |           520 ms (376) | 312 ms (200)    |        1,250 ms    | 697 ms      |                      1,437 |   751 |
| Kuhlau Rondo   |  1× |           176 ms (80)  | 64 ms (40)      |          301 ms    | 0 ms        |                      2,103 | 1,045 |
| Kuhlau Rondo   |  4× |           512 ms (296) | 288 ms (184)    |        1,090 ms    | 551 ms      |                      2,103 | 1,045 |
| Chopin Scherzo |  1× |           352 ms (160) | 64 ms (40)      |          790 ms    | 0 ms        |                      8,818 |   463 |
| Chopin Scherzo |  4× |         1,576 ms (680) | 288 ms (232)    |        3,354 ms    | 302 ms      |                      8,818 |   463 |

Compositor layers, at the peak of a switch and at rest with one hand dimmed:

| Piece          | Before: peak | Before: at rest | After: peak | After: at rest |
| -------------- | -----------: | --------------: | ----------: | -------------: |
| Twinkle        |          150 |             107 |          11 |             11 |
| Mozart K.545   |        2,011 |           1,415 |          11 |             11 |
| Kuhlau Rondo   |        3,056 |           2,085 |          11 |             11 |
| Chopin Scherzo |        2,945 |           1,979 |          11 |             11 |

The fade itself no longer drops frames at full speed (the slowest frame of the second after a switch: 17 ms after, against 67 to 183 ms before, on the three longer pieces). The longer the piece, the larger the gain: 5.5 times on the Scherzo at both speeds. On Twinkle, at 4× CPU, a switch is slower than before (72 ms against 48 ms): a one-page piece is all on screen, so all of it fades on the main thread, two properties per element, where the old fade ran on the compositor at a cost its 150 layers kept small; both stay under the 100 ms a click needs to feel instant.

## The three causes

**1. The dimming made Chrome composite about 2,000 layers.** The hand left out was dimmed with `opacity: 0.4` on its groups: whole layers (a staff's voice), chords, notes and digits. A translucent group is an effect; Chrome flattens an effect into the layer below it when it can, and gives it a compositor layer of its own when it cannot ([compositing in Blink](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing/README.md)). Everything painted over a composited layer and overlapping it must then be composited too. Verovio draws every notehead, accidental, clef and rest as a scaled `<use>` (`transform="translate(…) scale(0.72, 0.72)"`), so almost every dimmed group held a transformed shape:

| Kuhlau's Rondo, one hand dimmed, at rest                | Compositor layers |
| ------------------------------------------------------- | ----------------: |
| Both hands (nothing dimmed)                              |                10 |
| `opacity: 0.4` on the dimmed groups (before)             |             2,085 |
| the same with the `<use>` glyphs hidden                  |                11 |
| the same with each `<use>` replaced by a `<g transform>` copy of its glyph |  2,085 |
| `filter: opacity(0.4)` instead                           |             2,085 |
| `will-change: transform` on each page                    |             2,090 |
| `isolation: isolate; contain: paint` on each page        |             2,085 |
| `opacity` forced to 1 (nothing dimmed, as a control)     |                11 |
| `fill-opacity` and `stroke-opacity` 0.4 (after)          |                11 |
| digits at a group opacity of 0.4, notes by fill opacity  |                11 |

So a transform inside a translucent group is the trigger, not `<use>` itself. With 2,000 layers, every repaint pays for layerization and commit. In a trace of six switches on the Rondo, layerization (`PaintArtifactCompositor::Update`) was the largest single cost: 602 ms of the 1,244 ms of long tasks (48 %), ahead of JavaScript (102 ms), paint (85 ms), event dispatch (75 ms), style (58 ms) and commit (57 ms). The playing cursor, a class swap per note, paid it too in one-hand practice.

**2. The sweep faded the whole piece.** Every element dimmed or brought back on every page carried a transition with its `--sweep` delay: 2,103 per one-hand switch on the Rondo, 8,818 on the Scherzo. Each running opacity animation is composited (3,056 layers at the Rondo's peak), and each transition fires `transitionrun`, `transitionstart` and `transitionend`, which bubble to React's root listener: 25,254 events over the six switches of that trace, 278 ms of dispatch.

**3. A switch restyled and walked the whole piece.** Pages far off screen were restyled and repainted too, and `dimNotes` walked all 102,000 elements of the Scherzo on every switch (21 ms there at full speed), with two more full queries for the elements dimmed before and after, and a cursor query (`.is-red, [data-onset-tick]`) that a list of two selectors makes slow: 2.75 ms per call on the Scherzo against 0.25 ms for the class alone.

## What changed

| Change | Where | What it removes |
| ------ | ----- | --------------- |
| The notes are dimmed shape by shape: `fill-opacity` and `stroke-opacity` 0.4, which their shapes inherit ([MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/fill-opacity)) | `base.css` | the 2,000 layers at rest |
| A dimmed digit rests at a group opacity of 0.4 (text alone: Chrome flattens it, no layer); it fades on fill opacity and settles at the end of its fade | `base.css`, `settleSweep` | coloured subpixel fringes on pale digits (below) |
| Only the systems on screen fade (one box per page, then one per system of the pages on screen, read before any class changes); the rest changes at once | `systemsOnScreen`, `sweepDimming` | thousands of transitions and their events |
| The pages off screen skip style and paint ([`content-visibility: auto`](https://web.dev/articles/content-visibility)), each keeping its viewBox's aspect ratio ([`aspect-ratio`](https://developer.mozilla.org/en-US/docs/Web/CSS/aspect-ratio)) so no size or scroll position changes | `base.css`, `ScoreSheet.tsx` | restyling the whole piece |
| What each selection dims is found once per layout; a switch moves the class between two lists | `mutedElements`, `redim`, `ScoreView.tsx` | walking every page per switch |
| The cursor marks are cleared with a one-class query | `clearCurrent` | 2.5 ms per call on a long piece |
| Click-to-seek measures its bars a page at a time, when a pointer or a step first needs that page | `pageBars`, `barBoxes`, `BarSeek.tsx` | drawing every skipped page at the first hover (below) |

Each step, on the Scherzo, one-hand switches, median of eight (at full speed, then 4× CPU):

| Build                                    | Click to paint (1×) | Long tasks (1×) | Click to paint (4×) |
| ---------------------------------------- | ------------------: | --------------: | ------------------: |
| Before                                   |              384 ms |          823 ms |            1,880 ms |
| Shape-by-shape dimming, sweep on screen  |              232 ms |          205 ms |                   — |
| and pages off screen skipped             |               80 ms |           68 ms |              448 ms |
| and the dimming found once per layout    |                   — |               — |              280 ms |

(Each row was measured against the row before it in its own interleaved run; a dash is a measure not taken in that run. The final table above is the before and after of the whole change.)

After the change, what remains of a switch is restyling the pages on screen and their neighbours (6,900 to 11,900 elements on the Scherzo: a dimmed group's shapes inherit its opacity, so each is restyled), React's render of the score view, and painting the fade.

## What skipping the pages off screen could have cost

`content-visibility: auto` defers a page's work until the page nears the window, so it was checked where that work comes due, on the Scherzo, old build against new:

| Check | Before | After |
| ----- | ------ | ----- |
| Document height; page heights after scrolling to the end and back | 33,303 px; unchanged | 33,303 px; unchanged |
| The first hover over the score, a third of the way down (click-to-seek measures the bars) | one 241 ms long task (every bar measured) | none (one page measured; with every bar measured, the skipped pages drawn at once made it 366 + 60 ms, hence the per-page measuring) |
| One-hand playback for 9 s across a page turn (the left hand, from the last system of page 3) | 358 frames, 55 over 34 ms, a 323 ms long task | 541 frames, none over 17 ms |

## Options measured and rejected

| Option | Result | Why not |
| ------ | ------ | ------- |
| Keep `opacity`, make each page its own layer (`will-change: transform`) or contain it (`isolation`, `contain: paint`) | still 2,085 to 2,090 layers | does not stop the overlap cascade |
| Keep `opacity`, draw the glyphs without `<use>` | still 2,085 layers | the transform is the trigger, not the `use` |
| `filter: opacity(0.4)` | 2,085 layers | the same effect |
| Dim by colour, ink mixed 40 % into the paper | 11 layers | an opaque gray notehead hides the staff line through it, where 40 % ink lets it show as before |
| Fade the digits' `opacity` | 320 layers at the peak, 184 ms of long tasks per switch | an opacity animation is composited per element |
| Fill opacity for the digits too | 11 layers | translucent text on the page is drawn with subpixel smoothing on Windows, which fringes a pale digit with colour; a group opacity keeps it gray |
| Fade every page (fill opacity, on the elements that change only) | 11 layers, but 401 ms of long tasks per switch on the Rondo and 4 janky frames | 2,281 main-thread animations and their events |

## The look

Old against new, Kuhlau's Rondo, the right hand dimmed, the second system, reduced motion (the resting look): pixels differing by more than 8 of 255 in any channel, and the mean difference.

| Theme | Scale | Differing pixels | Mean difference |
| ----- | ----: | ---------------: | --------------: |
| light |    1× |  5,545 of 137,560 (4.0 %) |           1.47 |
| light |    3× |  2,382 of 121,500 (2.0 %) |           0.62 |
| dark  |    1× |  4,623 of 137,560 (3.4 %) |           1.16 |
| dark  |    3× |  1,934 of 121,500 (1.6 %) |           0.46 |

The crops are in `hand-switch/` next to this report (`light-1x-old.png` against `light-1x-new.png`, and so on). The tone is the same (40 %), and the digits are drawn as before. The difference sits in antialiased edges and where two dimmed shapes overlap: each shape is dimmed on its own, so a stem's end inside its beam, or a stem along its notehead, is a little darker where they overlap. It shows when zoomed in; at the size the score is read it is a fraction of a pixel. Verovio's markup on the Rondo carries no opacity attributes that could block the inherited dimming.

## Guards

`e2e/hand-switch.spec.ts` checks the mechanisms, so a loaded machine cannot fail it: on K.545 scrolled a third of the way down, a switch fades only systems on screen, with at most two transitions per element faded and fewer bars than the piece has; once settled, no element is left marked, no translucent group holds a transformed shape, the dimmed digits rest at a group opacity of 0.4, and Chrome composites fewer than 100 layers; under reduced motion nothing fades. Against the build before the change, the first two of its three tests fail: nothing is marked to sweep, and 73 dimmed layers are translucent groups holding transformed shapes.
