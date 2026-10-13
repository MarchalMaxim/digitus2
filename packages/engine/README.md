# @digitus2/engine

Pure TypeScript piano-fingering engine: score model, MusicXML and PIG readers and writers, PIG metrics, and a CLI. No DOM dependency; runs in Node 22 and in the browser.

## API

- `parseMusicXml(input, { source? })` → `{ score, editorial, warnings }` — accepts text, bytes, or a `.mxl` archive.
- `injectFingerings(xml, score, assignment, { replace? })` → MusicXML text with `<fingering>` elements.
- `parsePig(text, { source? })` / `writePig(score, assignment)` — the PIG text format (Nakamura, Saito, Yoshii 2020).
- `pigMetrics(pred, golds, hands?, goldHands?)` and `metricsForScores(pred, golds)` — general, highest, soft and recombination match rates.
- `handEvents(score, hand)` — notes grouped into simultaneous events per hand (the solver's input).

## CLI

```bash
pnpm --filter @digitus2/engine cli inspect fixtures/two-staff.musicxml
pnpm --filter @digitus2/engine cli eval --pred ../../research/baselines/outputs/<name> --gold ../../research/data/pig
```

CLI paths are relative to `packages/engine`, because pnpm runs the script there.

## Tests

`pnpm --filter @digitus2/engine test`
