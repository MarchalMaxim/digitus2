# Browser OMR runtime and accuracy experiment — 2026-10-15

## Result

Browser-only recognition executes locally in a classic single-thread Web Worker without COOP/COEP. **Neither tested checkpoint produces usable music on the app's clean piano fixtures. Scanning is blocked on a usable recognizer/checkpoint; no scan UI or production adapter should be added from these results.**

The strongest diagnostic is an exact source-model comparison: original SMT system safetensors, loaded strictly into official PyTorch SMT++ code, produce byte-for-byte identical wrong output to the F32 browser GGUF on the same Twinkle crop. Quantization and browser conversion are not the cause of that particular failure. The inverted official preprocessing policy also fails. The separate full-page model fails both tested polarities.

This is a local execution and accuracy spike, not a benchmark claim. No product code changed. Raw models, downloaded sources, fixtures and outputs remain in ignored research directories. Product implementation remains TypeScript/browser-only; Python was used only to diagnose a model.

## Executed controls

Inputs are actual white-background fixture PNGs at `research/omr/results/fixtures-final/<piece-id>/page-001-clean.png`. Piece IDs: `twinkle-twinkle-little-star`, `bach-minuet-g-major-bwv-anh-114`, `chopin-prelude-op28-no7`. Fixture generation and symbolic truth are recorded separately in that directory's manifest. Outputs were inspected against visible notation; no aggregate accuracy percentage is asserted here.

| Full-page Q8 model input | Twinkle | Bach | Chopin |
| --- | --- | --- | --- |
| Native 1260x1782 | Encoder finishes; 213172224-byte KV cache allocation fails at 2 GB WASM heap limit | Not run | Not run |
| Half scale 630x891 | 4.96 s, no notes | 145.49 s, repetitive rests/punctuation | 5.17 s, no notes |
| Ink bounds +16 px, maximum 800000 pixels | 7.58 s, partial wrong pitches, six separators | 136.45 s, repetition | 12.78 s, mostly rests |
| Three-quarter scale | 12.26 s, mostly rests | Not run | Not run |
| Same Twinkle ink crop, RGB inverted before worker | 8.20 s, clefs/key and invented 9/16; zero notes | Not run | Not run |

The final inversion control was one 1184x676 Twinkle crop, with worker termination after 30 seconds if necessary. It completed normally. Its complete text is `*clefF4 <t> *clefG2 <b> *k[] <t> *k[] <b> *M9/16 <t> *M9/16 <b> *- <t> *- <b>`.

| System-model control | Time | Actual result |
| --- | ---: | --- |
| Q8, upstream 672x256 regression staff image | 2.19 s | Plausible correspondence: Bb, 2/4, bass F eighth; treble rest then ff-ee-dd sixteenths. No independent symbolic scoring |
| Q8, Twinkle first system x102..1255,y48..281 | 4.92 s | Invented opening C-sharp/B whole-note chord, many pitch/rhythm errors |
| F32, identical first-system crop | 3.96 s | Same opening hallucination, later errors |
| Q8, second system x100..1255,y310..512, no tempo | 5.11 s | Invented 3/4, wrong pitches/chords and extra measures |
| Original official PyTorch, identical first crop, noninverted | 7.34 s | 203 generated tokens, EOS; complete text byte-identical to F32 browser output |
| Original official PyTorch, identical crop, inverted | 19.74 s | Repeated null events; 384-token cap without EOS; invented 3/4 |

The full-page model was also tried on the upstream system image: 140.09 s, malformed repetition. That is out-of-domain and is not evidence of full-page accuracy. Confidence is always zero in this runtime and must not be presented as a calibrated quality score.

## Pinned artifacts and sources

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Full-page Q8 GGUF | 17160032 | `2f53c0a93c0c2f7c289f69dcc10b36464a5bfed07ad2ed89df42582d5675272c` |
| System Q8 GGUF | 25473440 | `f6612885a8d7015bef5ab7f045a37a0f667575f4b65b324a353cf348d6edc752` |
| System F32 GGUF | 87128608 | `6058e9581b9b79bd75c1e7ebfe13e6e966cb8a5bd3a5d00356016e8788e55ddc` |
| Original system safetensors | 85544056 | `495b5831c5a92fc75b6bf607cbe65d8a8432508177e0f76055da750d132c7be0` |
| Deployed WASM | 3664439 | `c23ca812e34bfb3623e2806d99744ac698ece0442c82fec5ec3de806cc96f6f6` |
| Emscripten loader | 67415 | `28e508e984f4571bcff807481e9ac6effe7beb6a03d82e37d6826e2d113e2cb1` |
| Browser wrapper | 38402 | `fbdb66dbd251a7ec6dbd3d03b6fc0edd315c3c5598fd5d3d86ef0f6fc9fb4347` |
| Worker | 5050 | `b4cfce3ca4410f87d39aa12f00332870c41de1eee6a0a28eb067ad3c977fa8c5` |

- [Full-page Q8 weights, pinned revision](https://huggingface.co/cstr/smt-fp-grandstaff-GGUF/resolve/522e448e70c5c4b5ab4ceb793610b0aad9d27c53/smt-fp-grandstaff-q8_0.gguf), derived from [PRAIG full-page model](https://huggingface.co/PRAIG/smt-fp-grandstaff).
- [System Q8 weights, pinned revision](https://huggingface.co/cstr/smt-grandstaff-GGUF/resolve/8e1595591659aa03cf1e71aab5aa03e8f3fccd7e/smt-grandstaff-q8_0.gguf) and [system F32](https://huggingface.co/cstr/smt-grandstaff-GGUF/resolve/8e1595591659aa03cf1e71aab5aa03e8f3fccd7e/smt-grandstaff-f32.gguf).
- [Original system weights/config, pinned revision](https://huggingface.co/antoniorv6/smt-grandstaff/tree/2eb5a45c29d63bdf063cd0427175f57675e7da9e).
- [Official SMT++ source used in PyTorch control](https://github.com/antoniorv6/SMT-plusplus/tree/e49345abccc77d3b030b84fcdec7387204563736).
- [CrispEmbed source inspected](https://github.com/CrispStrobe/CrispEmbed/tree/ed071aa7c02ee403b4c4ccc22f9c4dfbfabd7cc2); runtime downloaded from [deployed site](https://crispstrobe.github.io/CrispEmbed/). The deployed binary cannot be attributed to this source commit; hashes pin what actually ran.
- [Upstream regression input](https://raw.githubusercontent.com/CrispStrobe/CrispEmbed/ed071aa7c02ee403b4c4ccc22f9c4dfbfabd7cc2/tests/regression/images/staff_smt.png).

The downloaded model cards and metadata declare MIT, as does the runtime; retain attribution and bundled notices when shipping. Card claims about quantization parity are upstream claims, not substitute accuracy evidence.

## Reproduction and evidence locations

From the OMR worktree root, with existing pnpm dependencies and Playwright Chromium:

```powershell
node research/omr/results/runtime-spike/run.mjs crop
node research/omr/results/runtime-spike/run.mjs system-control
node research/omr/results/runtime-spike/run.mjs system-twinkle
node research/omr/results/runtime-diagnosis/run-f32.mjs system-twinkle
node research/omr/results/runtime-diagnosis/run-system2.mjs system-twinkle
node research/omr/results/runtime-diagnosis/run-fp-invert.mjs crop
research/omr/results/runtime-diagnosis/.venv/Scripts/python.exe research/omr/results/runtime-diagnosis/run-pytorch.py
research/omr/results/runtime-diagnosis/.venv/Scripts/python.exe research/omr/results/runtime-diagnosis/run-pytorch.py --invert
```

These ignored runners are retained local experiment artifacts, not committed product tooling. `runtime-spike/EVIDENCE.md`, `.json`, `.bekern` and execution logs contain initial calls. `runtime-diagnosis/EVIDENCE.md` contains independent controls. In that directory, `system-twinkle-twinkle-twinkle-little-star.json` is F32, `system2-system-twinkle-twinkle-twinkle-little-star.json` is second-system Q8, `crop-twinkle-twinkle-little-star.json` is full-page inverted, and `pytorch-twinkle*.json` contains source-model results. Generic run-summary filenames can be replaced by later harness calls; individual result filenames above identify each control.

PyTorch setup is isolated under ignored `runtime-diagnosis/.venv`; shared `research/.venv` was not modified. Pinned principal packages: CPU-only torch 2.5.1+cpu, transformers 4.44.2, safetensors 0.8.0, opencv-python-headless 5.0.0.93, loguru 0.7.3; exact transitive versions in `requirements-reference.txt`. Downloads include torch 205.5 MB (initial pip dry-run fetched it, installation reused cache), OpenCV 43.8 MB, transformers 9.5 MB and original weights 85.5 MB. No arbitrary pickle or remote auto-model code was executed. Official source was inspected, then safetensors loaded with strict weight matching. The runner uses official encoder/decoder methods and greedy argmax with 4 CPU threads, 384-token/90-second inference caps.

## Interpretation and next gate

The system model uses noninverted grayscale /255, width at most 3056 and height at least 256 in the inspected runtime; logs match expected system flags (unscaled attention, head ReLU). Its official source preprocessing contains inversion, but the inverted control is worse. The full-page runtime logs scaled attention, no head ReLU, reduce ratio 1, inversion false; explicit RGB inversion did not salvage it. Matching source/browser output establishes the system checkpoint failure on this input, not parity for every model, image or precision.

A viable browser execution substrate is established: lazy static model/WASM, classic worker, transferable RGBA, worker termination for cancellation, and no required cross-origin isolation. Desktop memory still matters: half-scale full-page runs used roughly 860 MB renderer working set, cropped Bach roughly 1.07 GB, and native page exceeded the deployed 2 GB heap. No mobile inference or acceptable accuracy was established.

The next gate is actual recognition on these clean fixtures with independently checked pitches, durations and staff assignment, using a different checkpoint or trained/fine-tuned model. Only after that passes should integration add strict bekern conversion/validation and the smallest contextual scan affordance. Returning incorrect notes, empty music or fabricated confidence is not a scan feature.
