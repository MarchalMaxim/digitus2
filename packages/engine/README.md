# @digitus2/engine

Pure TypeScript piano-fingering engine: score model, MusicXML and PIG readers and writers, PIG metrics, and a CLI. No DOM dependency; runs in Node 22 and in the browser.

## API

- `parseMusicXml(input, { source? })` → `{ score, editorial, warnings }` — accepts text, bytes, or a `.mxl` archive.
- `injectFingerings(xml, score, assignment, { replace? })` → MusicXML text with `<fingering>` elements. A `score-timewise` input is written back as `score-partwise`, and an `.mxl` input comes back as plain MusicXML text.
- `unpackMusicXml(input)` → MusicXML text from a string, file bytes (decoded by byte-order mark, then the XML declaration, then UTF-8) or a `.mxl` archive.
- `timewiseToPartwise(doc)` → a `score-partwise` `@xmldom/xmldom` Document (the same document when it already is one). The other XML helpers are internal.
- `parsePig(text, { source? })` / `writePig(score, assignment)` — the PIG text format (Nakamura, Saito, Yoshii 2020).
- `pigMetrics(pred, golds, hands?, goldHands?)` and `metricsForScores(pred, golds)` — general, highest, soft and recombination match rates.
- `handEvents(score, hand)` — notes grouped into simultaneous events per hand (the solver's input).
- `embellishMusicXml(text, { density?, dropBars? })` → `{ xml, inserted, refusal, skipped, melodyVoice }` — the light embellishment of a partwise piano score: passing notes that fill a third and an upper neighbour a whole step above a repeated note, at most one figure per bar and never in neighbouring bars. A refused piece comes back unchanged with the reason in `refusal`.
- `guardEmbellishment(plainXml, opts?)` → `{ offered, reason, kind }` — what the app's `Add notes between` switch runs: the embellisher, the independent check, then a solve and a beginner lint at the large, medium, small and child hand sizes. `offered` holds the embellished score with a fingering for every hand size, or is null with the `reason` and its `kind`.

## CLI

```bash
pnpm --filter @digitus2/engine cli inspect fixtures/two-staff.musicxml
pnpm --filter @digitus2/engine cli eval --pred ../../research/baselines/outputs/<name> --gold ../../research/data/pig
pnpm --filter @digitus2/engine cli embellish ../../content/scores/twinkle-twinkle-little-star.musicxml --out twinkle-light.musicxml
pnpm --filter @digitus2/engine cli embellish --library ../../content/manifest.json --floor ../../benchmarks/floor.json
```

`embellish <file>` writes the light embellishment (to stdout without `--out`; `--inserted` writes the inserted notes as JSON) or prints `digitus2: refused: <reason>` and exits 1. With `--guard` it runs the app's guard and writes what the app would show. `embellish --library` is the gate that `pnpm verify` runs as the step `embellish`: it fails when fewer pieces are offered than `embellish.offeredMin` in `benchmarks/floor.json`, or when an offered piece fails the independent check, the lint or the level.

CLI paths are relative to `packages/engine`, because pnpm runs the script there.

## Tests

`pnpm --filter @digitus2/engine test`
