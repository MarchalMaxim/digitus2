# digitus2

Good piano fingerings for any piece, computed in your browser, for beginning pianists.

Open a piece (built-in, MusicXML, or MIDI), see finger numbers on every note, play it back with the score and an on-screen keyboard following along, and edit any finger you disagree with. Everything runs client-side.

The built-in library contains 253 pieces across six levels, including complete advanced originals. Source licences, bulk acquisition and verification are recorded in [the library report](docs/research/library-bulk-expansion-2026-10-15.md).

## Status

Early development. See [docs/PROGRESS.md](docs/PROGRESS.md) for the current state and [the design spec](docs/superpowers/specs/2026-10-13-digitus2-design.md) for what is being built and why.

## Layout

- `apps/web` — the web app (Vite, React, TypeScript)
- `packages/engine` — the fingering engine (pure TypeScript, no DOM)
- `content` — built-in score library (public domain and Creative Commons editions)
- `research` — Python harness: datasets, metrics, baselines, parameter learning
- `docs` — specs, plans, research reports

## Engine CLI

```bash
pnpm install
pnpm --filter @digitus2/engine cli inspect fixtures/two-staff.musicxml
pnpm --filter @digitus2/engine cli eval --pred ../../research/baselines/outputs/<name> --gold ../../research/data/pig
```

CLI paths are relative to `packages/engine`, because pnpm runs the script there.

See [packages/engine/README.md](packages/engine/README.md) for the engine API.

## License

Application code: MIT. Built-in scores retain their individual public-domain, CC0, CC BY or CC BY-SA terms and attributions; see `content/manifest.json` for per-piece provenance. Research datasets are downloaded by scripts and are not redistributed here; their licenses are recorded in `research/data/README.md`.
