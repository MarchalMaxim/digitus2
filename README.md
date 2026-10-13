# digitus2

Good piano fingerings for any piece, computed in your browser, for beginning pianists.

Open a piece (built-in, MusicXML, or MIDI), see finger numbers on every note, play it back with the score and an on-screen keyboard following along, and edit any finger you disagree with. Everything runs client-side.

## Status

Early development. See [docs/PROGRESS.md](docs/PROGRESS.md) for the current state and [the design spec](docs/superpowers/specs/2026-10-13-digitus2-design.md) for what is being built and why.

## Layout

- `apps/web` — the web app (Vite, React, TypeScript)
- `packages/engine` — the fingering engine (pure TypeScript, no DOM)
- `content` — built-in public-domain score library
- `research` — Python harness: datasets, metrics, baselines, parameter learning
- `docs` — specs, plans, research reports

## License

MIT. Built-in scores are public domain or original arrangements released under CC0; see `content/manifest.json` for per-piece provenance. Research datasets are downloaded by scripts and are not redistributed here; their licenses are recorded in `research/data/README.md`.
