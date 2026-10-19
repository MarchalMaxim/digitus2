# digitus2

Good piano fingerings for any piece, computed in your browser, for beginning pianists.

Open a piece (built-in, MusicXML or MIDI), see a finger number on every note, and play it back with the score and an on-screen keyboard following along. Everything runs client-side. Live at https://marchalmaxim.github.io/digitus2/.

The built-in library holds 3,224 pieces in four levels, from first-steps songs to advanced originals. Scanning a photo or PDF of printed music is experimental; see [docs/scanning.md](docs/scanning.md).

## Docs

- [docs/PROGRESS.md](docs/PROGRESS.md): current state, decisions, what is next
- [Issues](https://github.com/MarchalMaxim/digitus2/issues): open requests and planned work; [docs/TODO.md](docs/TODO.md): the done and closed requests
- [Product spec](docs/superpowers/specs/2026-10-13-digitus2-design.md) and [verification spec](docs/superpowers/specs/2026-10-13-verification-design.md)
- [docs/app.md](docs/app.md): the web app; [docs/verification-loop.md](docs/verification-loop.md): `pnpm verify`
- `docs/research/`: research reports (literature, datasets, baselines, readability, rendering, OMR)

## Layout

- `apps/web`: the web app (Vite, React, TypeScript)
- `packages/engine`: the fingering engine (pure TypeScript, no DOM)
- `content`: the built-in score library and its tooling
- `research`: Python harness: datasets, metrics, baselines, parameter learning, teacher review, OMR prototypes
- `benchmarks`: floors, history and the textbook oracle

## Engine CLI

```bash
pnpm install
pnpm --filter @digitus2/engine cli inspect fixtures/two-staff.musicxml
pnpm --filter @digitus2/engine cli eval --pred ../../research/baselines/outputs/<name> --gold ../../research/data/pig
```

CLI paths are relative to `packages/engine`, because pnpm runs the script there. See [packages/engine/README.md](packages/engine/README.md) for the engine API.

## License

Application code: MIT. Built-in scores keep their individual public-domain, CC0, CC BY or CC BY-SA terms and attributions; see `content/manifest.json` for per-piece provenance. Research datasets are downloaded by scripts and are not redistributed here; their licences are recorded in `research/data/README.md`.
