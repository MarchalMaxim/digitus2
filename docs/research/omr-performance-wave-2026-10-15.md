# Browser OMR performance wave — 2026-10-15

Codex — Astra coordination, Sol 6.1 implementation and measurement.

The preserved `d8ef89e` baseline recognized a whole clean Twinkle image locally in 1,268.25 seconds. This wave changes browser execution only, retaining the pinned models, upstream image preprocessing, patch order, reconstruction and strict quality oracle. It does not change reference scores or silently accept lower recognition quality. The user subsequently permitted native Python and an optional local-PC processing connection; browser acceleration remains a possible frontend fallback, rather than the sole allowed architecture.

## Hardware and cheap controls

The earlier null WebGPU adapter was specific to Playwright's bundled Chromium headless shell: CDP identifies SwiftShader, with WebGPU unavailable. Installed Chrome and Edge launched headlessly with ordinary defaults expose hardware WebGPU and create devices. CDP lists an NVIDIA RTX 4080 SUPER and AMD integrated graphics; the ONNX control adapter identifies NVIDIA/Lovelace. No OS, driver or security settings were changed. Explicit D3D11 selection in bundled Chromium instead fails on a DXIL library error; it is not the chosen path.

[ONNX Runtime's WebGPU documentation](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html) specifies the WebGPU bundle and explicit execution provider. The existing pinned ORT Web 1.22.0 package supplies both. [Runtime flags](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html) distinguish execution-provider selection from WASM thread count. These are browser-executed models, not native GPU inference.

| Control                              | Actual result                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| Model 1, 256×256, GPU default graph  | 1,910/65,536 argmax pixels differ; max probability delta about 0.999: rejected |
| Model 1, graph optimization disabled | Still differs on a musical patch; disabling optimization is not a fix          |
| Model 2, 288×288, four real patches  | Zero argmax differences; maximum probability delta ≤1.32e-6; finite outputs    |
| Model 2 execution                    | CPU approximately 3.45 s/patch; warmed GPU approximately 0.51–0.73 s/patch     |

Cheap controls use identical BGR tensors for CPU and GPU; their canvas image sampling is not asserted identical to the upstream PIL resize. Whole-page proof uses the exact baseline Pyodide/OpenCV/PIL preprocessing instead. GPU model 1 is explicitly excluded, despite its apparent speed. ORT reports some nodes assigned away from the preferred GPU provider; this is a hybrid provider result, not a claim that every operation executes on GPU.

Evidence remains ignored under `research/omr/results/performance-wave/`: `gpu-probe.json`, `tensor-control.json`, `tensor-expanded.json` and corresponding logs. The boundary is a proposed model-1 WASM / model-2 WebGPU path. No tile is skipped, batched, quantized or deduplicated. Whole-page label hashes and strict score metrics must match the baseline before calling it an improvement.

## Reproduction and limits

Durable scripts are in `research/omr/prototypes/oemer-performance/`. First prepare the pinned baseline assets using its README/setup instructions. Installed Chrome and the repo's Playwright dependency are required. The performance server binds only `127.0.0.1:8995` and serves explicit experiment/model/runtime assets. The full runner restricts external requests to pinned public Pyodide GETs, retains raw XML, hashes, model metadata, timings, network audit and sampled process working sets. Dedicated GPU memory is not included in working-set samples; shared pages can be counted more than once. No physical-phone memory/latency guarantee follows from this desktop experiment.

Actual worker termination cancellation was exercised as `hybrid-cancel-1` and again after final runner changes as `hybrid-cancel-final`; no recognizer service received the input. Ten explicit serving, traversal-containment and GET-only checks passed. Syntax checks and scoped formatting passed. Full output accuracy, cancellation responsiveness during active GPU dispatch, cold downloads and desktop-only performance remain separate acceptance questions. The baseline recognizer already has known meter, rhythm and annotation errors; faster execution cannot cure them.

The coordinator stopped this wave at measured controls after the newly permitted native Audiveris path recognized Twinkle in approximately four seconds with better strict quality. Another multi-minute oemer experiment was not justified at this stage. **The proposed hybrid whole-page path was not executed: its total runtime, complete label parity, strict score quality and memory are unmeasured. No whole-page speedup is claimed.** No tile skipping, quantization, batching or broad configuration sweep was performed. GPU model 1 remains rejected for demonstrated incorrect output; model 2's sampled acceleration is a retained research option, not a verified deployable recognizer. The optional loopback worker/native-quality path now takes priority.
