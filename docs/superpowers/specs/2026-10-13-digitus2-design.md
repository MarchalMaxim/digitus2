# digitus2 — Design Specification

- Date: 2026-10-13
- Status: written from the kickoff decisions; the user asked for autonomous execution, so implementation proceeds from this document. Review and correct at any time; corrections override this file.
- Author: Claude (Fable 5.1) with Maxim

## 1. Purpose and success criteria

digitus2 computes a good piano fingering for a piece of music and teaches it. A learner opens a piece (built-in, MusicXML, or MIDI), sees the score with finger numbers on every note, plays it back with a sampled piano while the score and an on-screen keyboard follow along, and can edit any fingering, after which the engine re-solves the rest around the edits.

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
- Stack: TypeScript, engine runs in the browser; public MIT repository named digitus2; many Opus subagents allowed, coordination by Fable.

Assumed (correct me if wrong):

- The project is non-commercial, so datasets under non-commercial licenses (PIG is believed to be CC BY-NC-SA 4.0; the datasets report verifies this) may be used to learn parameters.
- Both hands are fingered; hand assignment comes from the staff in MusicXML and from a hand-separation step for MIDI.
- Finger substitutions (changing finger on a held key) are represented in the data model but not produced by the first solver, because beginners rarely use them.
- Grays are allowed for secondary text and disabled states; chromatic color other than the single red is not.
- Desktop and tablet browsers are the primary targets; phones must work but are not optimized for.

## 3. Non-goals

- Optical music recognition (PDF or image input) before M8. Photo input is roadmap item M10 (section 12), added 2026-10-14 at the user's request.
- Instruments other than piano; organ pedals; harpsichord-specific fingering.
- Pedaling, dynamics interpretation, or performance rendering beyond straightforward playback.
- Accounts, cloud sync, or a server. All state is local.
- Native mobile apps.

## 4. Architecture

A pnpm monorepo. The engine is a pure TypeScript library with no DOM dependency so it runs in the browser, in Node (CLI and benchmarks), and in tests. The web app consumes it. A Python harness holds research, dataset handling, baselines, and parameter learning; it exports learned parameters as JSON that the engine imports at build time.

```
digitus2/
  apps/web/                      Vite + React + TypeScript app (@digitus2/web)
  packages/engine/               @digitus2/engine, pure TS, no DOM
    src/score/                   internal score model and helpers
    src/io/musicxml/             MusicXML (.musicxml, .xml, .mxl) reader and writer
    src/io/midi/                 MIDI reader, quantization, hand separation
    src/io/pig/                  PIG text format reader and writer
    src/fingering/               cost model, state space, exact DP solver, k-best, posteriors
    src/fingering/params/        learned parameter JSON with provenance headers
    src/lint/                    fingering lint rules
    src/eval/                    PIG metrics and metamorphic checks
    cli/                         `digitus2` CLI: finger, eval, lint
  content/scores/                built-in library (MusicXML) and manifest.json
  research/                      Python harness: data, metrics, baselines, learning, spikes
  docs/                          specs, plans, research reports, PROGRESS.md
```

Data flow in the app: file or library entry, then reader to Score, then fingering solver to Assignment, then Score plus Assignment to MusicXML with fingering elements, then renderer draws the score, then playback schedules notes from Score timing and drives the cursor and keyboard.

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
  tiedFrom?: string[]; // original note ids merged into this sounding note
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

Ties are merged into one sounding note. Grace notes are kept, flagged, and fingered. Hand comes from the staff by default (staff 1 right, staff 2 left) with MusicXML cross-staff notes honored.

## 6. Input and output formats

- MusicXML reader: partwise and timewise, uncompressed and `.mxl` (zip), MusicXML 3.0 to 4.0. Handles divisions changes, backup and forward, chords, ties, voices, grace notes; repeats are expanded for playback only; existing fingering elements are read into an `editorial` Assignment.
- MusicXML writer: injects `<technical><fingering>` per note into the original document when the input was MusicXML (preserving engraving), or generates a clean document from the Score (MIDI input, built-in pieces exported with fingerings).
- MIDI reader: tempo map and time signatures from the file, quantization to a grid derived from the tempo map with a sensible minimum (16th notes, triplets detected per beat), hand separation (Section 7.6), then a generated MusicXML for rendering.
- PIG reader and writer: exact PIG text format, including substitution syntax and negative left-hand finger numbers, so the engine can be scored by the same Python tools as the baselines.

## 7. Fingering engine

### 7.1 Formulation

Each hand is solved independently. A hand's notes are grouped into events: all notes of that hand with the same onset tick form one event (a chord or a single note). The solver assigns to each event a configuration: a mapping from its notes to distinct fingers, with ascending pitch mapped to ascending finger number for the right hand and descending finger number for the left hand (the standard constraint; crossed fingers inside one chord are excluded in the first version). Held notes from earlier events remain in the hand's current configuration until they end, so a sustained note occupies its finger and contributes to spans.

The objective is a sum of local costs:

- Unary cost of a configuration: finger-key preferences (thumb or fifth finger on black keys, weak fingers), chord span costs between every pair of fingers in the configuration, impossible chord shapes (infinite).
- Pairwise transition cost between consecutive configurations: for every pair of a finger in the previous configuration and a finger in the next, the span cost given the pitch interval, key colors, and whether the pair constitutes a legal crossing; same-finger reuse on a different key (penalized, scaled by the time gap); same finger on a repeated key (small cost); position-change costs.
- Triple costs for rules that look at three consecutive notes (Parncutt's position-change rules), handled by a second-order state where needed.
- Learned terms: log-probabilities of finger transitions conditioned on pitch interval and key colors, estimated from PIG (and Mutopia) in Python. These make the model a log-linear hybrid of rules and data.

Exact inference is dynamic programming (Viterbi) over events, with state = configuration (at most C(5,k) choices for a k-note chord, times the carried held-note context). For single-note lines this is a 5-state (first order) or 25-state (second order) chain per hand; chords stay small. Complexity is linear in the number of events, so whole pieces solve in milliseconds.

Beyond the best path the solver produces:

- Per-note posterior marginals by forward-backward over the same costs treated as negative log potentials, used as confidence.
- K-best paths per segment for alternatives.
- Constrained solving: pinned fingers (user edits or editorial fingerings) restrict the state space, so the engine completes partial annotations.
- A cost breakdown per note for an explanation in the UI ("why this finger").

### 7.2 Parameters and profiles

All weights and span tables live in JSON under `packages/engine/src/fingering/params/`, each file with a provenance header (dataset, script, date, git hash of the research code). Two profiles ship: `expert` (tuned to maximize PIG general match rate) and `beginner` (adds weight to position stability, five-finger positions, no substitutions, limited spans for smaller hands). The app defaults to `beginner` for level 1 and 2 pieces and `expert` otherwise, with a user toggle and a hand-size setting that scales span tables.

### 7.3 Rule set

The first solver implements the ergonomic rules of Parncutt et al. 1997 with Jacobs 2001 refinements, Balliauw et al. 2017's polyphonic extensions where applicable, plus black-key and crossing rules from pedagogy. Exact rule weights are taken from the literature report and then re-tuned on data. The rule implementation is table-driven so a rule's weight can be set to zero without code changes.

### 7.4 Learning

Python (`research/learn/`) fits the parameters: transition statistics from PIG train annotations; then weight tuning on general match rate with a derivative-free optimizer (coordinate search or CMA-ES) using the TypeScript engine itself through the CLI, so the learned weights are the ones the product uses. The held-out PIG test split is never used for tuning.

### 7.5 Neural models

Neural approaches (ArGNN, checklist transformers, newer work) are benchmarked in Python by the baselines work. If one beats the hybrid solver by a clear margin on all three oracles (PIG test, Mutopia editorial, lint pass rate), it is exported to ONNX and run with ONNX Runtime Web behind the same solver interface, with the DP solver kept as a constrained decoder on top of neural scores. This is a later milestone, not a prerequisite.

### 7.6 MIDI hand separation

First version: a windowed split-point tracker (choose a split pitch per time window minimizing a cost that rewards contiguous ranges and penalizes crossings), with a user-adjustable split in the UI. Second version, if needed: joint assignment using the fingering cost itself, in the spirit of the merged-output HMM of Nakamura, Ono, Sagayama 2014.

M6 (2026-10-14): implemented as a beam-searched pitch-trajectory DP (one split point per onset) with learned movement, chord-span, position and hand-pattern tables (plan 2026-10-14-m6-midi-import.md, decision 1); measured 92.05 percent on the PIG test split (85.10 on the held-out Mutopia test half). The user-adjustable split is the "Hand split" control.

## 8. Verification

The verification suite is a first-class deliverable and runs in CI. The binding detail (numeric goals, oracles, checks, iteration protocol, milestone placement) is in `2026-10-13-verification-design.md`; the list below is the summary it expands.

1. Benchmark metrics. General, highest, soft, and recombination match rates on the official PIG test split, computed by the Python metrics library (cross-checked against the dataset's official evaluation code) and by a TypeScript port used in engine tests. CI fails if the general match rate drops below a stored floor.
2. Independent editorial oracle. Fingerings extracted from public-domain Mutopia editions are a second ground truth with a different provenance (editors, pedagogical repertoire). Match rate is reported separately; disagreement patterns are analyzed, not hidden.
3. Fingering lint, validated against humans. Each lint rule (illegal crossing, impossible stretch, same finger on consecutive different keys without a gap, thumb on black key in fast passages, finger reuse inside a chord, mirrored rules for the left hand) is first run on the human annotations to measure how often experts violate it. Rules that experts never violate become hard gates for engine output; rules experts sometimes violate become warnings with the measured base rate.
4. Metamorphic tests. Properties the engine must satisfy without any ground truth: octave transposition invariance within the keyboard's comfortable range; mirror symmetry (reflect pitches about an axis and swap hands, fingers must map identically); tempo scaling invariance for moderate factors; repeated-passage consistency (identical passages in identical context get identical fingering); locality (changing bars far away does not change a passage's fingering); idempotence under pinning (pin the engine's own output, re-solve, nothing changes).
5. Hard-error analysis. On notes where all PIG annotators agree, an engine mismatch is a hard error; where annotators disagree, a mismatch is soft. The hard-error rate is tracked separately from the match rate because it is the better signal of real mistakes.
6. Uncertainty. Posterior confidence from forward-backward and disagreement between the rule-only and hybrid solvers are compared with actual error rates (calibration curve) so that the UI's confidence display means something.
7. In-app comparison. For library pieces with editorial fingerings, the app shows the editor's fingering next to the engine's and the agreement percentage, so users can judge for themselves.
8. Baseline comparison. Every open-source implementation that can be made to run is scored on the same split with the same tools, and the table is published in the docs.

## 9. Web app

Views:

1. Welcome and library (UI batch, 2026-10-14). The name, one sentence and one red button ("Start with …" the first level-1 piece, or "Continue with …" for a reader who has played a library piece); then the pieces as a clean list of two-line rows (title and length; composer only where it tells the reader something) under collection headings. Level names: First steps, Easy, Moderate, Intermediate, Challenging, Advanced, one name everywhere. Disclosure thresholds: level pills (exactly one chosen) above 40 pieces, search from 100 pieces, collection headings in a section above 12 pieces, genre pills and folded collections above 60 pieces in a level. A file dropped anywhere on the window opens it; while a file is dragged over the window the drop frame is the red element and the page beneath is hidden; a quiet "Open your own MusicXML or MIDI file" line ends the list. A scrolled list may show no red element; the red element is never made sticky.
2. Score view. The rendered score with finger numbers on every note; a transport bar (play and pause, tempo, loop a selection, right hand, left hand, both, metronome and count-in); an on-screen keyboard that shows pressed keys with finger numbers during playback; a side panel with piece information, profile (beginner or expert), hand size, and the editorial comparison when available. During playback the red element is the current note (cursor); paused away from the start, the last group heard keeps the red and its keys stay pressed, and Play is plain; at the start (fresh, rewound, ended) it is the play button. The practice controls fold into one "Practice" toggle in the dock at every width. The keyboard letters the hands (L, R) only in bars where they come within a fifth. Fingering editing: click a digit to change it; the engine re-solves with the pin and animates changed digits. Hover or tap a digit for "why": the cost breakdown and the alternatives.
3. Export. Download MusicXML with fingerings; print stylesheet.

Design system: black `#000`, white `#fff`, a small gray scale for secondary text and disabled controls, and one red (`#e3000f` or close) reserved for the single active element. Typography: one grotesque sans for UI, the renderer's music font for the score. Motion: 120 to 200 ms ease-out transitions, no bounce, reduced-motion respected. Layout works from 360 px wide up.

State: a single store (zustand or equivalent) holding the current Score, Assignment, playback state, and settings; persisted to localStorage per piece (user edits survive reloads). No network calls except loading static assets and piano samples.

Deployment: static build to GitHub Pages through GitHub Actions on every push to main.

Minimalism rule (user, 2026-10-14): the UI stays pristine and uncluttered, and the project is brutal about it. A feature gets a visible control only when a beginner needs it at that moment; everything else is folded away (progressive disclosure), made automatic, or left out. Each UI change is reviewed for what it removes as well as what it adds, and the daily UI review (verification spec 3.10) flags any control that could go. Progressive disclosure (user, 2026-10-14 evening): a control appears only in the context that needs it (an editor's-fingering toggle only on pieces that have one, loop fields only after a loop is chosen); the library's filters (pills for level and for collection or genre) and its search appear only once the list is long enough to need them, and the landing page reads as a few clear units with the red Start or Continue button as the one red element.

## 10. Research harness

`research/` is a Python 3.11 project with a venv, pinned requirements, and these parts: `data/` (downloaded datasets, gitignored, with manifests and the official split committed), `fingering_eval/` (loaders, validators, metrics, evaluate CLI), `baselines/` (third-party implementations and wrappers), `learn/` (parameter fitting and export), `spikes/` (throwaway prototypes). Reports live in `docs/research/`.

## 11. Testing and CI

- Engine: vitest unit tests for the score model, readers and writers (round trips), solver correctness on small hand-constructed cases (scales, arpeggios, chords, repeated notes, crossings), lint rules, metrics; metamorphic property tests; a benchmark test that runs the PIG test split through the CLI and compares against the floor.
- App: vitest with testing-library for components and store logic; Playwright end-to-end for open piece, see fingerings, play, edit a finger, export.
- Research: pytest for metrics and loaders.
- CI (GitHub Actions): lint, typecheck, unit tests, engine benchmark, app build, Pages deploy on main.

## 12. Milestones

- M0 Research (running): datasets and validation, literature survey, baselines, content library, rendering spike.
- M1 Foundation: repo scaffold, engine score model, MusicXML and PIG readers and writers, TS metrics, CLI, CI skeleton.
- M2 Solver v1 with the verification core: rule-based cost model with exact DP, lint with expert base rates, `digitus2 bench` with scorecards and error galleries, textbook oracle, metamorphic suite; benchmark on PIG test at or above the rule-based baselines.
- M3 Learning: Python parameter fitting, hybrid model; benchmark at or above the best HMM; hard-error analysis; calibration and ablation; Mutopia oracle.
- M4 App MVP: library, score rendering with fingerings, playback with cursor and keyboard, design system.
- M5 Interaction: editing with pins, confidence display, alternatives, explanations, editorial comparison, export, persistence.
- M6 MIDI import with hand separation and generated engraving.
- M7 Verification suite complete: metamorphic tests, lint validation against humans, calibration, CI gates, published results.
- M8 Polish: motion, accessibility, performance, mobile layout, Pages deployment, documentation.
- M9 Neural model evaluation and optional ONNX integration.
- M10 Photo and PDF input (added 2026-10-14, advanced; PDFs added the same day with IMSLP 18520, Boellmann's Variations symphoniques, as the example): photograph printed sheet music on a phone or open a scanned PDF (pages rendered to images first), recognise it into a Score, finger it and show it annotated like any other piece. Verification first: the library gives ground truth, so the spike renders library pages, photographs or perturbs them (phone camera, skew, shadow, low light) and scores candidate OMR engines note by note against the MusicXML (pitch, duration, voice, staff accuracy per bar; the whole pipeline must reach the hand-separation and fingering floors on recognised scores before it ships). Candidates to compare in the spike: oemer and homr (Python, deep learning, MusicXML output), Audiveris (Java), and a browser route through ONNX Runtime Web so the no-server constraint holds. UI: one entry point beside the file drop, nothing else visible; recognition errors are corrected in the existing score editor.
- M11 Demo videos (added 2026-10-14): a reusable skill (`.claude/skills/demo-video`) that drives the built app with Playwright's video recording through scripted scenarios (open the library, play a piece with the cursor and keyboard, drop a MIDI file, change hand size, edit a finger once M5 exists), produces short silent WebM/MP4 clips at phone and desktop sizes, checks them (duration, one red element per frame sampled, no console errors) and places them on the homepage: the GitHub README and the Pages landing. Inside the app the minimalism rule applies: at most one muted clip folded behind the welcome, or none.
- M12 VPS deployment (added 2026-10-14): deploy the static build to the user's own VPS on a subdomain they create (they set the DNS records). The VPS is shared with other services and must do no heavy computation, which the architecture already guarantees: the app is static files (HTML, JS, CSS, scores, samples loaded by the browser), no server process, no API. Design: a GitHub Actions job builds on a tag, precompresses assets (gzip and brotli), and publishes over SSH (rsync to a web root served by the existing nginx or Caddy with TLS, long cache headers for hashed assets, no cache for index.html) using a deploy key stored as a repository secret; a smoke check fetches the deployed index and one score; rollback is re-deploying the previous tag. GitHub Pages (M8) stays as the fallback mirror. Access control (user request 2026-10-14): the deployment sits behind a login gate at the reverse proxy, resilient to brute force and spam, self-hosted and without big-tech OAuth; the options study is `docs/research/auth-options.md`. Its recommendation (2026-10-14): Authelia behind Caddy forward_auth, portal on the app's own host, TOTP or WebAuthn second factor; fallback basic_auth plus fail2ban; releases folder with a current symlink and an rrsync-restricted deploy key; the gate fails closed. Open: whether the public GitHub Pages mirror stays (it would be unauthenticated).
- M13 Mobile as a PWA (added 2026-10-14): no native app (non-goal); the responsive web app becomes installable (web manifest, service worker caching the shell and the library, full-screen on the home screen) so the phone is a first-class way to use it, including camera capture for M10. Folded into M8 unless it grows.

## 13. Alternatives considered

- Pure rule-based solver (Parncutt-style only). Simple and explainable, but published results sit well below learned models and chords are weakly handled. Kept as a component of the hybrid, not as the product.
- Learned HMM only (Nakamura HMM3). Strong, small, fast. Lacks explicit ergonomic rules for unseen contexts and offers no explanations. Its transition statistics become the learned terms of the hybrid.
- Neural sequence model as the primary engine. Highest reported accuracy but needs a training pipeline, a multi-megabyte model, ONNX Runtime in the browser, and gives weaker guarantees under user pins. Deferred to M9 and adopted only on evidence.
- Python backend. Rejected by the user; the app must run client-side.
- Verovio versus OpenSheetMusicDisplay for rendering, and the choice of sampler library: decided by the rendering spike report, which is binding for M4.

## 14. Risks and mitigations

- Dataset access or license problems: mirrors are recorded; Mutopia provides an independent source; nothing under a non-permissive license is committed.
- Polyphony edge cases (voice crossing, wide chords, cross-staff writing): modeled as held-note context; excluded shapes get infinite cost and the lint reports them; user pins are the escape hatch.
- Renderer limitations for per-note styling: the spike verifies note-to-SVG mapping before the app is built.
- Audio latency and sample size: the spike measures; samples are loaded lazily per octave if needed.
- Long autonomous sessions: `docs/PROGRESS.md` is the journal updated after every milestone step; memory holds only pointers.
