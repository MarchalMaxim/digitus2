# digitus2 — Design Specification

The product specification. Corrections by the owner override this file. The verification goals, oracles and checks are specified in `2026-10-13-verification-design.md`; the landing page and the library in `2026-10-14-ui-batch-design.md` and `2026-10-16-library-shelves-design.md`.

## 1. Purpose and success criteria

digitus2 computes a good piano fingering for a piece of music and teaches it. A learner opens a piece (built-in, MusicXML, MIDI, or an experimental scan), sees the score with finger numbers on every note, plays it back with a sampled piano while the score and an on-screen keyboard follow along, and can edit any fingering, after which the engine re-solves the rest around the edits (editing is not built yet, see M5 in section 12).

Target users: beginning pianists and their teachers.

Success criteria, in priority order:

1. Fingering quality. On the PIG benchmark (Nakamura, Saito, Yoshii 2020; 150 pieces, 309 expert annotations) the engine must at least match the best published HMM (general match rate around 64 to 65 percent on the official test split) and should approach the human inter-annotator ceiling (about 71 percent). Every output must pass the physical-plausibility lint with zero violations, and it must agree well with independent editorial fingerings from public-domain editions (Mutopia), which cover the beginner repertoire better than PIG does.
2. Verification that is more than one number. The project ships a verification suite that combines benchmark metrics, an independent editorial oracle, lint rules validated against human data, metamorphic tests, and uncertainty estimates. Section 8 defines it.
3. A welcoming product. Minimal black-and-white interface with exactly one red element on screen at any time, snappy animations, built-in songs playable out of the box, runs fully client-side.

## 2. What the user specified and what is assumed

Specified by the user:

- Input: a piece of music; output: an optimal, good fingering. MusicXML and a built-in library are required; MIDI import is required.
- Ground-truth data must be found online and its quality verified before trusting it.
- The algorithm must be grounded in the literature; existing GitHub implementations must be tested.
- Verification must be strong and novel.
- UI: minimal, black and white, one single red element per page, snappy animations, welcoming start screen, playback of built-in songs.
- Stack: TypeScript, engine runs in the browser with no server, except the scan recognition service on Cloud Run (`docs/scan-service.md`); GitHub Pages stays the only deployment of the app; public MIT repository named digitus2.

Assumed:

- The project is non-commercial, so datasets under non-commercial licences (PIG is CC BY-NC-SA 4.0; `docs/research/datasets.md` verifies this) may be used to learn parameters. Weights fitted on PIG data are research-only and never ship, because the licence forbids redistribution.
- Both hands are fingered; hand assignment comes from the staff in MusicXML and from a hand-separation step for MIDI.
- Finger substitutions (changing finger on a held key) are represented in the data model but not produced by the solver, because beginners rarely use them.
- Grays are allowed for secondary text and disabled states; chromatic colour other than the single red is not.
- Desktop and tablet browsers are the primary targets; phones must work but are not optimised for.

## 3. Non-goals

- Instruments other than piano; organ pedals; harpsichord-specific fingering.
- Pedaling, or performance rendering beyond straightforward playback. Playback does follow the dynamics marks ppp to fff, hairpins and cresc. or dim. (`docs/app.md`, Audio).
- Accounts, login, cloud sync, or a hosted server. All state is local to the browser. The one exception is the scan recognition service the project runs on Google Cloud Run, which recognises a page and keeps nothing (section 9, view 4; `docs/scan-service.md`).
- Native mobile apps.
- Certified transcription from photos or PDFs. Scanning is experimental and its output is always reviewed against the source.

## 4. Architecture

A pnpm monorepo. The engine is a pure TypeScript library with no DOM dependency so it runs in the browser, in Node (CLI and benchmarks), and in tests. The web app consumes it. A Python harness holds research, dataset handling, baselines and the library build tools; the learned parameters it and the engine's trainer produce are JSON files the engine imports at build time.

```
digitus2/
  apps/web/                      Vite + React + TypeScript app (@digitus2/web)
  packages/engine/               @digitus2/engine, pure TS, no DOM
    src/score/                   internal score model and helpers
    src/io/musicxml/             MusicXML (.musicxml, .xml, .mxl) reader and writer
    src/io/midi/                 MIDI reader, quantization, hand separation, engraving
    src/io/pig/                  PIG text format reader and writer
    src/fingering/               cost model, state space, exact DP solver, posteriors
    src/fingering/params/        weight sets, level and hand-size profiles, with provenance headers
    src/learn/                   structured-perceptron trainer, calibration, bootstrap
    src/lint/                    fingering lint rules
    src/eval/                    PIG metrics, hard errors, textbook oracle, metamorphic checks
    cli/                         `digitus2` CLI: inspect, finger, lint, eval, bench, evalhands, learn, import
  content/scores/                built-in library (MusicXML) and manifest.json
  content/tools/                 Python: catalog, level grading and library build
  benchmarks/                    floors, scorecards and history
  research/                      Python harness: data, metrics, baselines, learning, readability, teacher review, OMR
  docs/                          specs, plans, research reports, reviews
```

Data flow in the app: file or library entry, then reader to Score, then fingering solver to Assignment, then Score plus Assignment to MusicXML with fingering elements, then renderer draws the score, then playback schedules notes from Score timing and drives the cursor and keyboard. The solver and the reader run in a web worker, so the main thread never parses MusicXML or runs the solver.

Boundaries:

- `score` knows nothing about files, fingering, or rendering.
- `io/*` converts between external formats and `Score`; writers accept an optional `Assignment`.
- `fingering` depends on `score` only. The solver is deterministic given a parameter set.
- `lint` and `eval` depend on `score` and the `Assignment` type only.
- The app depends on the engine's public API and never reaches into internals. The renderer and audio player are wrapped behind small adapters so they can be replaced.

## 5. Score model

```ts
interface Score {
  meta: { title?: string; composer?: string; source?: string };
  divisions: number; // ticks per quarter note
  tempoMap: TempoEvent[]; // tick -> quarter notes per minute
  timeSignatures: TimeSigEvent[];
  keySignatures: KeySigEvent[];
  measures: MeasureInfo[]; // index, start tick, length, number label
  notes: Note[]; // all sounding notes, both hands, sorted by onset then pitch
}

interface Note {
  id: string; // stable within a Score; survives round trips
  onsetTick: number;
  offsetTick: number;
  onsetSec: number;
  offsetSec: number;
  midi: number; // 21..108
  spelling: {
    step: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
    alter: -2 | -1 | 0 | 1 | 2;
    octave: number;
  };
  hand: 'L' | 'R';
  staff: number;
  voice: number;
  measureIndex: number;
  isGrace: boolean;
  chordId: string; // notes with the same hand and onset share a chordId
  sourceIndices: number[]; // document-order indices of the source notes merged into this sounding note (tie start first)
  velocity?: number; // MIDI velocity when the source carries one (PIG, MIDI)
  ornament?: Ornament; // playback interpretation of a trill or mordent sign; the written note stays the solver's input
}

interface Assignment {
  [noteId: string]: {
    finger: 1 | 2 | 3 | 4 | 5;
    substitution?: 1 | 2 | 3 | 4 | 5; // finger after a silent change on the held key
    confidence?: number; // posterior probability of this finger, 0..1
    alternatives?: Array<{ finger: 1 | 2 | 3 | 4 | 5; cost: number }>;
    pinned?: boolean; // set by the user; the solver must respect it
    source: 'engine' | 'user' | 'editorial';
  };
}
```

Ties are merged into one sounding note. Grace notes are kept, flagged, and fingered. Hand comes from the staff by default (staff 1 right, staff 2 left) with MusicXML cross-staff notes honoured. Trills and mordents are played from the written note by a separate performance view (`ornamentAttacks`); the keyboard follows the realised pitches, auxiliary notes get no invented fingering, and the cursor stays on the written note.

## 6. Input and output formats

- MusicXML reader: partwise and timewise, uncompressed and `.mxl` (zip), MusicXML 3.0 to 4.0. Handles divisions changes, backup and forward, chords, ties, voices, grace notes; repeats are expanded for playback only; existing fingering elements are read into an `editorial` Assignment.
- MusicXML writer: injects `<technical><fingering>` per note into the original document when the input was MusicXML (preserving engraving), or generates a clean document from the Score (MIDI input, built-in pieces exported with fingerings).
- MIDI reader: tempo map and time signatures from the file, quantization to a grid derived from the tempo map with a sensible minimum (16th notes, triplets detected per beat), hand separation (section 7.6), then a generated MusicXML for rendering.
- PIG reader and writer: exact PIG text format, including substitution syntax and negative left-hand finger numbers, so the engine can be scored by the same Python tools as the baselines.

## 7. Fingering engine

### 7.1 Formulation

Each hand is solved independently. A hand's notes are grouped into events: all notes of that hand with the same onset tick form one event (a chord or a single note). The solver assigns to each event a configuration: a mapping from its notes to distinct fingers, with ascending pitch mapped to ascending finger number for the right hand and descending finger number for the left hand (the standard constraint; crossed fingers inside one chord are excluded). Held notes from earlier events remain in the hand's current configuration until they end, so a sustained note occupies its finger and contributes to spans.

The objective is a sum of local costs:

- Unary cost of a configuration: finger-key preferences (thumb or fifth finger on black keys, weak fingers), chord span costs between every pair of fingers in the configuration, impossible chord shapes (infinite).
- Pairwise transition cost between consecutive configurations: for every pair of a finger in the previous configuration and a finger in the next, the span cost given the pitch interval, key colours, and whether the pair constitutes a legal crossing; same-finger reuse on a different key (penalised, scaled by the time gap); same finger on a repeated key (small cost); position-change costs.
- Triple costs for rules that look at three consecutive notes (Parncutt's position-change rules), handled by a second-order state where needed.
- Learned terms: the weights of the rule terms and of indicator features (finger transitions conditioned on pitch interval and key colours), fitted from data (section 7.4). The model is a linear hybrid of literature rules and data.

Exact inference is dynamic programming (Viterbi) over events, with state = configuration (at most C(5,k) choices for a k-note chord, times the carried held-note context). For single-note lines this is a 5-state (first order) or 25-state (second order) chain per hand; chords stay small. Complexity is linear in the number of events, so whole pieces solve in milliseconds.

Beyond the best path the solver produces:

- Per-note posterior marginals by forward-backward over the same costs treated as negative log potentials, used as confidence.
- Per-note alternatives: the next-best fingers with their cost gap.
- Constrained solving: pinned fingers (user edits or editorial fingerings) restrict the state space, so the engine completes partial annotations.
- A cost breakdown per note for an explanation in the UI ("why this finger").
- Consistent repeats: identical passages in identical context are fingered alike (a post-pass pins the repeats), because teachers object to inconsistent fingering and the readability model infers a repeat from its first occurrence.

### 7.2 Parameters, profiles and levels

All weights and span tables live in JSON under `packages/engine/src/fingering/params/`, each file with a provenance header (dataset, script, date, git hash of the research code).

- Weight sets: `parncutt` (literature defaults, no fitting) and `learned-open` (fitted on the textbook oracle, Beringer and the Mutopia train half; no PIG data). `learned-open` is the `RECOMMENDED_WEIGHT_SET` and the one the app and the benchmark gate use. `learned-pig` (fitted on PIG train) exists only as a research set and is never shipped.
- Hand-size profiles: `large`, `medium`, `small`, `child` scale the span tables. The app exposes them as the "Hand size" setting (default medium).
- Fingering levels: `expert` (the weight set as it is) and `beginner` (`params/profiles-weights.json`: scales the penalties for position changes and spans, and prices a thumb crossing inside one five-finger position, a crossing of two fingers without the thumb, and a fast hop). The CLI selects them with `--level`. The app solves at the default `expert` level; choosing `beginner` for easy pieces is not wired in.

### 7.3 Rule set

The solver implements the ergonomic rules of Parncutt et al. 1997 with Jacobs 2001 refinements, Balliauw et al. 2017's polyphonic extensions where applicable, plus black-key and crossing rules from pedagogy and a table of textbook scale, arpeggio and chromatic fingerings. The rule implementation is table-driven so a rule's weight can be set to zero without code changes.

### 7.4 Learning

The weights are fitted by an averaged passive-aggressive structured perceptron over the solver's own cost (`packages/engine/src/learn/`, run through the CLI `learn` command), so the features exist once and the learned weights are the ones the product uses. Targets are the closest annotator for pieces with several; unfingered notes are completed by the model. Python (`research/learn/`) holds the prototype, the data handling, the splits and the statistics. The held-out PIG test split is never used for tuning; the Mutopia corpus is split by piece, and its test half stays a held-out oracle (verification spec section 4, item 5).

### 7.5 Neural models

Neural approaches (ArGNN, checklist transformers, newer work) are benchmarked in Python by the baselines work. If one beats the hybrid solver by a clear margin on all three oracles (PIG test, Mutopia editorial, lint pass rate), it is exported to ONNX and run with ONNX Runtime Web behind the same solver interface, with the DP solver kept as a constrained decoder on top of neural scores. This is milestone M9, not built and not a prerequisite.

### 7.6 MIDI hand separation

A beam-searched pitch-trajectory dynamic programme chooses one split point per onset, with movement, chord-span, position and hand-pattern tables learned from the library and the Mutopia train half (no PIG data). It reaches 92.05 percent on the PIG test split (85.10 on the held-out Mutopia test half). The user-adjustable split is the "Hand split" control. A joint assignment using the fingering cost itself, in the spirit of the merged-output HMM of Nakamura, Ono, Sagayama 2014, is the fallback if the split proves too weak.

## 8. Verification

The verification suite is a first-class deliverable. It runs under `pnpm verify`; CI runs the steps that need no PIG data. The binding detail (numeric goals, oracles, checks, iteration protocol, milestone placement) is in `2026-10-13-verification-design.md`; the list below is the summary it expands.

1. Benchmark metrics. General, highest, soft, and recombination match rates on the official PIG test split, computed by the Python metrics library (cross-checked against the dataset's official evaluation code) and by a TypeScript port used in engine tests. `pnpm verify` fails if the general match rate drops below a stored floor.
2. Independent editorial oracle. Fingerings extracted from public-domain Mutopia editions are a second ground truth with a different provenance (editors, pedagogical repertoire). Match rate is reported separately; disagreement patterns are analysed, not hidden.
3. Fingering lint, validated against humans. Each lint rule (illegal crossing, impossible stretch, same finger on consecutive different keys without a gap, thumb on black key in fast passages, finger reuse inside a chord, mirrored rules for the left hand) is first run on the human annotations to measure how often experts violate it. Rules that experts never violate become hard gates for engine output; rules experts sometimes violate become warnings with the measured base rate.
4. Metamorphic tests. Properties the engine must satisfy without any ground truth: octave transposition invariance within the keyboard's comfortable range; mirror symmetry (reflect pitches about an axis and swap hands, fingers must map identically); tempo scaling invariance for moderate factors; repeated-passage consistency (identical passages in identical context get identical fingering); locality (changing bars far away does not change a passage's fingering); idempotence under pinning (pin the engine's own output, re-solve, nothing changes).
5. Hard-error analysis. On notes where all PIG annotators agree, an engine mismatch is a hard error; where annotators disagree, a mismatch is soft. The hard-error rate is tracked separately from the match rate because it is the better signal of real mistakes.
6. Uncertainty. Posterior confidence from forward-backward and disagreement between the rule-only and hybrid solvers are compared with actual error rates (calibration curve) so that the UI's confidence display means something.
7. In-app comparison. For library pieces with editorial fingerings, the app shows the editor's fingering and, once built, the agreement percentage with the engine's, so users can judge for themselves. Today the app toggles between the two fingerings.
8. Baseline comparison. Every open-source implementation that can be made to run is scored on the same split with the same tools, and the table is published in the docs.

## 9. Web app

Views:

1. Welcome and library. The name, one sentence and one red button ("Start with …" the first piece of the lowest level, or "Continue with …" for a reader who has played a library piece); a search field from 100 pieces; then the library at four levels (Easy, Medium, Harder, Challenging; one name everywhere) with style shelves inside a level, as specified in `2026-10-16-library-shelves-design.md`. The landing page reads as a few units, each shown only when the context needs it (`2026-10-14-ui-batch-design.md`). A file dropped anywhere on the window opens it; while a file is dragged over the window the drop frame is the red element and the page beneath is hidden; a quiet "Open your own score" line ends the list. "My scores" lists the reader's browser-local uploads once there are any. A scrolled list may show no red element; the red element is never made sticky.
2. Score view. The rendered score with finger numbers on every note; a transport in a sticky dock (play and pause, rewind) with one "Practice" toggle that folds the rest: tempo, hands (both, right, left), metronome, count-in and loop bars (the loop fields appear only once "Loop bars" is ticked); an on-screen keyboard that shows pressed keys with finger numbers during playback, and the hand letters (L, R) only in bars where the hands come within a fifth; a side panel with what the numbers mean, piece facts, hand size, the editor's-fingering toggle where the piece has one, export and print. During playback the red element is the current note (cursor); paused away from the start, the last group heard keeps the red and its keys stay pressed, and Play is plain; at the start (fresh, rewound, ended) it is the play button. Fingering editing (not built, M5): click a digit to change it; the engine re-solves with the pin and animates changed digits. Hover or tap a digit for "why": the cost breakdown and the alternatives.
3. Export. Download MusicXML with fingerings; print stylesheet.
4. Scan (experimental). PNG, JPEG and PDF import through the same chooser or drop target. The page goes to the project's scan service on Google Cloud Run (homr for photos, Audiveris for PDFs) only when the reader presses "Scan this score", the one primary control on every device, phones included; the scan page says where the page goes, and opening it sends one health request that wakes the service. The original and the recognised notation are shown side by side, and "Use for fingerings" opens the recognised score in the score view. The raw MusicXML can be downloaded. Recognised and imported scores are kept in the browser (IndexedDB, "My scores"). Details and limitations: `docs/scanning.md`.

Design system: ink and paper (black `#000` on white `#fff` in light mode; near-white on near-black in dark mode, which follows the system setting and has a switch), a small gray scale for secondary text and disabled controls, and one red (`#e3000f`) reserved for the single active element. Typography: one grotesque sans for UI, the renderer's music font for the score. Motion: ease-out, subtle and quick, no bounce, reduced motion respected. Layout works from 360 px wide up.

State: a single store (zustand) holding the current Score, Assignment, playback state, and settings. Settings (hand size, hands, metronome, count-in, per-piece tempo, the editor's-fingering toggle, the last piece played) persist in localStorage; imported scores persist in IndexedDB; user edits (M5) persist per piece, so they survive reloads. No network calls except loading static assets and piano samples, and the scan service: one health request when the scan page opens and one request per page on "Scan this score".

Deployment: static build to GitHub Pages through GitHub Actions on every push to main. The site is public; there is no login and no private content folder.

Minimalism rule (owner): the UI stays pristine and uncluttered, and the project is brutal about it. A feature gets a visible control only when a beginner needs it at that moment; everything else is folded away (progressive disclosure), made automatic, or left out. Each UI change is reviewed for what it removes as well as what it adds, and the periodic UI review (verification spec 3.10) flags any control that could go. Progressive disclosure: a control appears only in the context that needs it (an editor's-fingering toggle only on pieces that have one, loop fields only after a loop is chosen); the library's filters and its search appear only once the list is long enough to need them, and the landing page reads as a few clear units with the red Start or Continue button as the one red element.

## 10. Research harness

`research/` is a Python 3.11 project with a venv, pinned requirements, and these parts: `data/` (downloaded datasets, gitignored, with manifests and the official split committed), `fingering_eval/` (loaders, validators, metrics, evaluate CLI), `baselines/` (third-party implementations and wrappers), `learn/` (the learning prototype and statistics), `readability/` (the player model and reduction study), `teacher_review/` (the weekly blinded review), `omr/` (scanning experiments, the scan service's container and the research loopback worker), `spikes/` (throwaway prototypes). Reports live in `docs/research/`.

## 11. Testing and CI

- Engine: vitest unit tests for the score model, readers and writers (round trips), solver correctness on small hand-constructed cases (scales, arpeggios, chords, repeated notes, crossings), lint rules, metrics; metamorphic property tests; a benchmark test that runs the PIG test split through the CLI and compares against the floor.
- App: vitest with testing-library for components and store logic; Playwright end-to-end for open piece, see fingerings, play, export (and edit a finger once M5 exists).
- Research: pytest for metrics and loaders.
- CI (GitHub Actions): typecheck, lint, format check, unit tests, build, OMR harness tests and end-to-end tests; the Pages workflow deploys on every push to main. `pnpm verify` runs the full set locally, including the benchmark gate, which needs the PIG data (`docs/verification-loop.md`).

## 12. Milestones

- M0 Research: done. Datasets and validation, literature survey, baselines, content library, rendering spike (`docs/research/`).
- M1 Foundation: done. Repo scaffold, engine score model, MusicXML and PIG readers and writers, TS metrics, CLI, CI.
- M2 Solver v1 with the verification core: done. Rule-based cost model with exact DP, lint with expert base rates, `digitus2 bench` with scorecards and error galleries, textbook oracle, metamorphic suite.
- M3 Learning: done. Hybrid model with learned weights (`learned-open` ships), hard-error analysis, calibration and ablation, Mutopia oracle.
- M4 App MVP: done. Library, score rendering with fingerings, playback with cursor and keyboard, design system. The renderer is Verovio and the sampler smplr (`docs/research/rendering-spike.md`).
- M5 Interaction and readability: not built. Missing: editing with pins and its persistence per piece, the confidence display, alternatives and "why" explanations, the agreement percentage with the editor's fingering, click-a-bar-to-seek, and the readability reduction (printing only the digits a reader needs; verification spec 3.6). Export, the editor's-fingering toggle and persisted settings exist. The plan `docs/superpowers/plans/2026-10-14-m5-interaction-readability.md` predates the UI redesign and needs a re-plan.
- M6 MIDI import with hand separation and generated engraving: done. Held notes in imported MIDI play at shortened lengths (the one-voice-per-hand rule); open.
- M7 Verification suite complete: see the verification spec. The weekly teacher-review job exists and is never a gate.
- M8 Polish: done. Motion craft, dark mode, accessibility, performance, mobile layout, Pages deployment, the installable PWA (M13), documentation.
- M9 Neural model evaluation and optional ONNX integration: not started.
- M10 Photo and PDF input: experimental. PNG, JPEG and PDF import with source-versus-recognition review (section 9, view 4). Recognition errors remain (missed chord ties, duplicate notes, wrong hand assignment, beam membership inferred from the metre), so the feature is not certified. Verification comes first: the library gives ground truth, so candidate recognisers are scored note by note against the MusicXML (pitch, duration, voice, staff accuracy per bar) on rendered and perturbed library pages, and the `omr` step of `pnpm verify` checks the scoring harness. A browser-only route (oemer in the browser) took 21 minutes for Twinkle and had rhythm and bar errors, so recognition runs on the project's scan service on Google Cloud Run instead, the same on every device (#62, `docs/scan-service.md`). Correcting recognition errors in the browser is done (#40). A shared library of uploads was declined (#41).
- M11 Demo videos: not built. A reusable skill (`.claude/skills/demo-video`) would drive the built app with Playwright's video recording through scripted scenarios, produce short silent clips at phone and desktop sizes, check them (duration, one red element per frame sampled, no console errors) and place them on the homepage: the GitHub README and the Pages landing. Inside the app the minimalism rule applies: at most one muted clip folded behind the welcome, or none.
- M12 GitHub Pages deployment: done. Owner decision: "I ONLY want it on github pages". `.github/workflows/pages.yml` builds the engine and the web app with `--base=/<repo>/` on every push to main and deploys `apps/web/dist` with actions/deploy-pages; the site is https://marchalmaxim.github.io/digitus2/ and it is public. Consequences: no login gate (the auth study in `docs/research/auth-options.md` stays as reference), no private content folder on the site, nothing to deploy but static files. Hash routing keeps deep links working under the sub-path; scores, workers and WASM are Vite assets, so the base path applies to them.
- M13 Mobile as a PWA: done, except phone photo input (#35). No native app (non-goal); the responsive web app installs from the browser (web manifest, standalone on the home screen) and a service worker keeps the shell, the library list and, as they are used, the scores and piano samples, so a piece opened once opens and plays offline. The piano samples are served from the app's own site (#51).

Also not built: an experimental embellishment option for simple songs, a private library folder and a CC-licensed lane, demo videos (M11). The owner's requests and their status are [GitHub issues](https://github.com/MarchalMaxim/digitus2/issues).

## 13. Alternatives considered

- Pure rule-based solver (Parncutt-style only). Simple and explainable, but published results sit well below learned models and chords are weakly handled. Kept as a component of the hybrid, not as the product.
- Learned HMM only (Nakamura HMM3). Strong, small, fast. Lacks explicit ergonomic rules for unseen contexts and offers no explanations. Its transition statistics became learned terms of the hybrid.
- Neural sequence model as the primary engine. Highest reported accuracy but needs a training pipeline, a multi-megabyte model, ONNX Runtime in the browser, and gives weaker guarantees under user pins. Deferred to M9 and adopted only on evidence.
- Python backend. Rejected by the user; the app must run client-side.
- Verovio versus OpenSheetMusicDisplay for rendering, and the choice of sampler library: decided by the rendering spike report (`docs/research/rendering-spike.md`), Verovio and smplr.

## 14. Risks and mitigations

- Dataset access or licence problems: mirrors are recorded; Mutopia provides an independent source; nothing under a non-permissive licence is committed.
- Polyphony edge cases (voice crossing, wide chords, cross-staff writing): modelled as held-note context; excluded shapes get infinite cost and the lint reports them; user pins are the escape hatch.
- Renderer limitations for per-note styling: the rendering spike verified note-to-SVG mapping before the app was built.
- Audio latency and sample size: the spike measured; samples load lazily on the first Play of a score.
- Memory: Verovio's WASM heap is fixed at 128 MB and is a known limitation (`docs/app.md`).
