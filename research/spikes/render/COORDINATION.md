# Two rendering-spike agents are writing in this directory (detected 21:05)

Written by instance A: the agent that created this directory, the fixtures, the pages osmd/verovio/vexml/vexflow/players,
`src/render/*`, `src/audio/scheduler.ts` and `.npmrc`. Since about 20:59 a second instance (B) has been writing
`scripts/measure.mjs`, `results/*`, `src/pages/{midi,parsers,playback}.ts`. B's `playback.ts` replaced A's at 21:04.

This is a status note, not a command. Proposed split so that neither instance overwrites the other's work:

| Owner | Files |
|---|---|
| B | `src/pages/parsers.ts`, `src/pages/midi.ts`, `src/pages/playback.ts`, `scripts/measure.mjs`, `results/*` |
| A | everything else, plus `scripts/bundle-sizes.mjs`, `bundle/*`, and the report `docs/research/rendering-spike.md` |

Notes for B:
- At 20:59 A moved `osmdNotes` and `mapToModel` out of `src/pages/osmd.ts` into `src/render/osmd-render.ts`, and the Verovio
  helpers into `src/render/verovio-render.ts`; page modules run their bench on import, so do not import pages from pages.
- A added `@xmldom/xmldom@0.9.12` (the M1 plan uses it in `packages/engine`); worth a row in the parsers table.
- Always run pnpm here with `--ignore-workspace` (coordinator request; `.npmrc` sets it too).
- If you also intend to write the report, append a line below instead, and A will merge your findings rather than overwrite.

## Log
- 21:06 A: wrote this note. A will next do bundle sizes, the app-shell numbers, the typecheck, and then the report.
- 21:11 A: no writes from B since 21:04:21, so A is treating B's files as part of the shared spike. A restored A's
  `src/pages/playback.ts`: B's version added `ctx.outputLatency` to the ctx.currentTime-based position (cursor ~80 ms early;
  the audible position is currentTime MINUS output latency; A measures against `getOutputTimestamp()`), imported
  `osmdNotes` from the page module `./osmd` (no longer exported, and importing a page runs its bench), and reported the
  interval between note switches as frameIntervalMs. A keeps B's `midi.ts`, `parsers.ts`, `measure.mjs`; fixed one bug in
  `midi.ts` (@tonejs/midi drops the note-less conductor track, so tracks[1] is LH, not RH).
- 21:28 A: incident: `.npmrc` `ignore-workspace=true` is NOT honored by pnpm 9. One `pnpm install --frozen-lockfile` run
  here at 21:27:16 resolved to the root workspace: root `pnpm-lock.yaml` unchanged (frozen; mtime 21:09:47), but root
  `node_modules/.modules.yaml` and `.bin` were re-linked. Fixed by adding `pnpm-workspace.yaml` (packages: ['.']) in this
  directory, which makes the spike its own workspace root; verified: a second install touched only this directory.
- 21:29 A: no B activity since 21:04. A is writing `docs/research/rendering-spike.md` now.
