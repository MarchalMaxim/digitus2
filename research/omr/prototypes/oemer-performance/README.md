# Browser OMR performance experiments

This research preserves the original `../oemer/` prototype and pinned models. See [the performance report](../../../../docs/research/omr-performance-wave-2026-10-15.md).

Prepare the original oemer assets first using its README/setup. Run from the repository root with installed Chrome, repo Node dependencies and Playwright browsers:

```powershell
node research/omr/prototypes/oemer-performance/probe-gpu.mjs
node research/omr/prototypes/oemer-performance/control.mjs
node research/omr/prototypes/oemer-performance/control-expanded.mjs
node research/omr/prototypes/oemer-performance/run-full.mjs NEW-UNIQUE-RUN-ID
node research/omr/prototypes/oemer-performance/run-full.mjs NEW-CANCEL-ID --cancel-smoke
```

The whole-page runner uses baseline Pyodide image preprocessing and reconstruction without native masks. Model 1 runs CPU WASM because GPU tensor controls failed; only model 2 uses hardware WebGPU after passing sampled tensor controls. No tile is omitted or altered. Compare both whole-page label SHA-256 values and the strict scorer's complete per-piece evaluation with `local-options/browser-full-twinkle-v2.json` and `scorecard-browser-full-v2.json` before accepting a speedup.

The isolated server binds localhost port 8995. Public pinned Pyodide runtime GETs are allowed; no score is uploaded. Cancel terminates the worker. Results, downloads and memory observations stay under ignored `results/performance-wave/`; dedicated GPU memory is not measured. The full runner refuses to overwrite a run ID. Probe/control filenames are fixed diagnostic outputs; retain/rename those files before repeating them. Baseline evidence is never replaced.
