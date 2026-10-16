# Optional local HOMR photo runtime

Run from the repository root with Python 3.11 available:

```powershell
powershell -File research/omr/prototypes/homr-photo/setup.ps1
```

This is the complete setup command. It downloads the pinned upstream source, creates an isolated CPU-only virtual environment, installs the locked inference dependencies, downloads three pinned ONNX models, applies all three source patches, and verifies the resulting 45 inference Python files. No global Python packages are installed. A second run verifies the same prepared source; unexpected edits or added inference files fail closed. The source-patch pipeline was also rebuilt from a fresh pristine copy and matched every final file digest.

Default ignored toolchain: research/omr/results/photo-options/toolchain. Override with -Root when deliberately preparing a separate toolchain. The worker accepts this directory via --homr-toolchain. It uses the patched source only for PNG/JPEG jobs; original PDFs continue through the existing Audiveris adapter.

The runtime uses about 139 MB of compressed model downloads (157 MB unpacked), Python/OpenCV/ONNX Runtime on the CPU, and no PyTorch or GPU dependency. Title OCR is disabled. Recognition jobs verify all source and model pins, use an isolated child Python process with Python networking disabled, retain original image bytes, reject decoded images above 25 megapixels before OpenCV/inference, and use the existing worker cancellation, timeout, log and workspace bounds. The dependency record is checked against the lock; it does not make the environment immutable.

The native adapter is research/omr/prototypes/local-worker/homr.py. Its metadata_for method returns per-job warnings and structured omission/masking audits. Key and time signatures missing from a continuation page may be assumed or inferred by the model/exporter and require source review. Geometry exclusions are experimental: an indented single-staff coda can resemble an example. The audit therefore records possible exclusions, bounds, evidence and the need for review.

Source modifications are explicit and reproduced by setup:

- upstream.patch: detect short far-inset single-staff examples on a dominant piano page before layout repair and decoding.
- ../photo-recovery/upstream-boundaries.patch: mask detached smaller five-line examples in a grand-staff decoder margin, preserving the main staff and its ordinary ledger margin.
- ../photo-recovery/upstream-accidentals.patch: emit accidental display glyphs consistently with existing recognized pitch alterations during native export.

Setup preserves the pinned vendor byte format independently of Git checkout line endings. Retained patch artifacts are verified as LF-normalized UTF-8 text and are never rewritten by setup.

The frozen source identity is in source-manifests.json; setup-source-provenance.json is written under the ignored toolchain. See NOTICE.md and LICENSE.upstream for the AGPL source/model distinction. The web app does not bundle this runtime.

Research controls:

```powershell
python research/omr/prototypes/homr-photo/test_piano_cues.py
python research/omr/prototypes/homr-photo/test_prepare_patched.py
python -m pytest research/omr/prototypes/local-worker/test_homr.py -q
python research/omr/prototypes/homr-photo/run.py PATH_TO_IMAGE NEW_JOB --piano-cues
```

The last command preserves source bytes, raw MusicXML, exact model/source identities and audits in a new ignored evidence directory. It refuses to reuse a job directory. This debug runner is for research; the application uses the bounded offline adapter. Public clean piano and standalone melody controls produced byte-for-byte unchanged MusicXML under the final patch. That is regression evidence on those controls, not a universal recognition guarantee.
