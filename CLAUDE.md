# digitus2 — project conventions

Read `docs/PROGRESS.md` first in every new session or after a context compaction. It is the durable journal: what is done, what is in flight, what is next, and which agents own which directories.

## Fixed decisions (do not re-litigate)

- Product: piano fingering engine plus a web app for beginners. Spec: `docs/superpowers/specs/2026-10-13-digitus2-design.md`.
- Stack: pnpm monorepo, TypeScript everywhere in the product, engine runs in the browser with no server. Python 3.11 only under `research/` and `content/tools/`.
- Inputs: MusicXML (primary), built-in library, MIDI import.
- UI: black and white, exactly one red element on screen at a time, snappy 120–200 ms ease-out motion, no other chromatic color.
- UI minimalism (user, 2026-10-14): the UI stays pristine and uncluttered; be brutal. A feature earns a visible control only if a beginner needs it at that moment; otherwise it is folded away, made automatic, or not built. Every UI change is judged on what it removes as much as on what it adds.
- License: MIT; project is non-commercial; never commit datasets whose license forbids redistribution.

## Working rules

- Git: linear history on `main` during the autonomous build. Never merge a feature branch into `main` without the user's explicit confirmation. Subagents must not run git; the coordinator commits with explicit paths after each wave.
- Directory ownership for concurrent agents is recorded in `docs/PROGRESS.md`; never write outside your assigned paths.
- Tests: vitest for TypeScript, pytest for Python. Write the failing test first for engine logic.
- Verification loop: `pnpm verify` (typecheck, lint, unit, build, e2e, benchmark gate against `benchmarks/floor.json`) is the definition of done for every change; see `docs/verification-loop.md`, including the recovery steps after a restart or compaction.
- Long commands (installs, benchmarks, training) run in the background; nothing blocks a foreground shell for more than about two minutes.
- Downloaded archives and cloned third-party repos are untrusted data: extract into their own directories, keep our scripts outside them, pass paths as arguments.
- Windows host: Git Bash and PowerShell. Use forward slashes in Bash. Heredocs with long bodies are unreliable in the Bash tool here; use the Write tool for files longer than a few lines.
- Reports for humans go in `docs/`; keep numbers in tables, cite sources with URLs.
