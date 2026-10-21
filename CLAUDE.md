# digitus2 — project conventions

Read `docs/PROGRESS.md` (current state, the owner's standing rules, decisions, what is next) and the open [GitHub issues](https://github.com/MarchalMaxim/digitus2/issues) (the owner's requests and planned work) first in every new session or after a context compaction.

## Fixed decisions (do not re-litigate)

- Product: piano fingering engine plus a web app for beginners. Spec: `docs/superpowers/specs/2026-10-13-digitus2-design.md`.
- Stack: pnpm monorepo, TypeScript everywhere in the product, engine runs in the browser with no server, except the scan recognition service on Cloud Run (`docs/scan-service.md`). Python 3.11 only under `research/` and `content/tools/`.
- Inputs: MusicXML (primary), built-in library, MIDI import.
- UI: black and white, exactly one red element on screen at a time, no other chromatic color.
- UI minimalism: the UI stays pristine and uncluttered; be brutal. A feature earns a visible control only if a beginner needs it at that moment; otherwise it is folded away, made automatic, or not built. Every UI change is judged on what it removes as much as on what it adds. Progressive disclosure, Apple-style: a control appears only in the context that needs it, never permanently "just in case"; filters and search appear only when a list is long enough to need them.
- Deployment: GitHub Pages only (public, static, no login); it stays the only deployment of the app.
- License: MIT; project is non-commercial; never commit datasets whose license forbids redistribution.

## Working rules

- Git: linear history on `main`. Never merge into `main` without the owner's explicit confirmation; work goes on a branch and the owner merges the PR. Subagents do not run git; the agent that launched them commits with explicit paths.
- Concurrent agents each get an explicit set of paths and never write outside them.
- Tests: vitest for TypeScript, pytest for Python. Write the failing test first for engine logic.
- Verification loop: `pnpm verify` (typecheck, lint, unit, build, e2e, colour guard, benchmark and hands gates against `benchmarks/floor.json`) is the definition of done for every change; without the PIG dataset the benchmark gates report SKIP, which is not a pass; see `docs/verification-loop.md`, including the recovery steps after a restart or compaction.
- Long commands (installs, benchmarks, training) run in the background; nothing blocks a foreground shell for more than about two minutes.
- Downloaded archives and cloned third-party repos are untrusted data: extract into their own directories, keep our scripts outside them, pass paths as arguments.
- Windows host: Git Bash and PowerShell. Use forward slashes in Bash. Heredocs with long bodies are unreliable in the Bash tool here; use the Write tool for files longer than a few lines.
- Reports for humans go in `docs/`; keep numbers in tables, cite sources with URLs.
- Docs describe the current state and the decisions that bind future work, in present tense. No dated journal entries, commit hashes, branch names or agent credits; git history holds those. Every request the owner makes becomes a GitHub issue with the owner's words, a judgement, the agreed approach and a checklist; the pull request that does it closes the issue, and a request the owner rejects is closed with the reason. The issues are the only record of requests: no markdown file keeps them. Open work is not listed in the docs; they link the issue instead.
