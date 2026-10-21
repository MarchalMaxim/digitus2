# Guided score camera implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Only the coordinator runs git. The user approved the design and requested implementation on 2026-10-21.

**Goal:** Capture multiple printed score pages using PhotoScan-style five-view acquisition, with perspective correction and staff-based straightening of smoothly curved paper.

**Architecture:** A lazy camera dialog returns processed page Files to the current multi-page import. Pure TypeScript vision functions register camera images and conservatively combine registered views. No new hosted runtime or recognizer.

**Tech Stack:** Existing React, TypeScript, Vitest, Playwright, Canvas and MediaDevices.

**Spec:** docs/superpowers/specs/2026-10-21-guided-score-camera-design.md

## Global constraints

- Printed score pages; initial reference plus four tracked views; never timed or decorative completion.
- Existing 20-page and 10-MB page limits; black/white and exactly one visible red primary action.
- Release all camera resources and reject late callbacks on close/navigation.
- Five existing locales; existing page ordering and recognition pipeline.
- Subagents do not run git. Coordinator commits explicit paths; never merge main.

## Review focus

- Repeated staff patterns and page changes must fail closed instead of misregistering.
- Stationary camera cannot advance target completion; drift and blur reset hold.
- Late camera permission or processing after close cannot keep tracks or append pages.
- Fusion must preserve dark notes, reject missing coverage, and use all five views.
- Adding captures to an existing batch must respect current busy state and remaining capacity.

## Interfaces

Vision exports from apps/web/src/scan/camera/vision.ts:

```ts
export interface Point {
  x: number;
  y: number;
}
export interface Frame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export type Matrix = readonly number[]; // row-major 3x3, reference pixels -> current pixels
export interface Registration {
  matrix: Matrix;
  inliers: number;
  error: number;
  coverage: number;
}
export interface Capture {
  frame: Frame;
  matrix: Matrix;
}
export function project(matrix: Matrix, point: Point): Point;
export function registerFrame(
  reference: Frame,
  current: Frame,
  region?: readonly Point[],
): Registration | null;
export function sharpness(frame: Frame): number;
export function mergeCaptures(
  captures: Capture[],
  corners: Point[],
  signal?: AbortSignal,
): Promise<Frame>;
```

registerFrame supports identical image sizes, with callers providing downsampled tracking frames (long side <= 360). Matrices for full captures are scaled by the caller using intrinsic dimensions; capture dimensions remain fixed for a page. mergeCaptures accepts exactly five full-resolution registered views and ordered TL/TR/BR/BL reference corners, validates the quadrilateral and coverage, and returns one rectified RGBA frame or throws. UI translates failures into its localized retake advice.

Camera exports from apps/web/src/scan/camera/GuidedCamera.tsx:

```tsx
export function GuidedCamera(props: {
  maxPages: number;
  onComplete(files: File[]): void;
  onClose(): void;
}): React.JSX.Element;
```

The component owns a modal dialog/portal, media acquisition and cleanup, capture/review/next-page stages and corner controls. Reads t.scan.camera locale object. The parent hides/inerts its background while mounted and restores trigger focus. Returned Files are valid JPEG/PNG under 10 MB. No files returned on cancel. Existing ordinary file/camera fallback remains reachable if live acquisition fails.

## Task 1: Local registration and page processing

**Owner:** vision agent. **Paths:** scan/camera/vision.ts and its helper .ts files/tests, excluding GuidedCamera*, camera.css.

- [x] Write and run failing deterministic fixtures: known projective score transforms, translation, unrelated/blank/repeated staves, blur, glare, invalid corners, incomplete coverage, cancellation.
- [x] Implement feature registration with robust fitting and spatial confidence; preserve reference-to-current convention.
- [x] Implement bounded rectification and conservative aligned image combination. Yield during processing and support AbortSignal. Glare recovery is outside the revised scope.
- [x] Run vision tests and typecheck; report limits and exact measured fixture results.

## Task 2: Camera dialog and multi-page acquisition

**Owner:** camera agent. **Paths:** scan/camera/GuidedCamera.tsx, GuidedCamera.test.tsx, camera.css, captureState.ts/tests if needed.

- [x] Write failing tests for alignment hold, reset, unique targets, capture failure, late permission, track end, two-page review/retake and cancel.
- [x] Build rear-camera flow with real image-anchored target projection from vision registration. Capture reference and four full images on successful aligned holds. Recheck still registration.
- [x] Add explicit page corners, local processing, review, keep/retake/another-page and finish; respect maxPages.
- [x] Keep focus in the dialog, release tracks/frame loops/URLs on close and stale work, provide named native fallback and concise localized failures.
- [x] Run focused tests; report integration needs.

## Task 3: Entry points, locales and browser acceptance

**Owner:** coordinator; locales may be delegated to a bounded agent.

- [x] Add lazy guided-camera entry to OwnFileLine and ImagePages, preserving ordinary upload and native fallback.
- [x] Add camera strings in five existing locales with identical shapes.
- [x] Write failing integration/browser scenarios for real two-page acquisition, retake, stationary rejection, denial/fallback, cancel cleanup, ordering and recognition payload.
- [x] Implement integration with current batch limits and busy-state guards.
- [x] Update docs/scanning.md and PROGRESS.md with sources, behavior, limitations and directory ownership.
- [x] Independent code/UI review; fix findings, run pnpm verify and pnpm format:check.

## Repair wave: real curved score pages

The revised spec includes curved pages and excludes glare recovery. Use test-driven changes and independent Astra review.

- [x] Geometry owner: pin the <4-pixel corner-noise reproduction, gate metric aspect with source-scaled uncertainty, retain legitimate well-conditioned geometry.
- [x] Camera owner: pin unreachable off-center crops and choose reachable, distinct targets; pass edited corners to live and still registration in tracking coordinates.
- [x] Coordinator: extend `registerFrame(reference, current, region?)` to require matches distributed inside the selected page. Pin the textured-surroundings/blank-page reproduction.
- [x] Local-alignment owner: add `alignLocalView(reference, current, initialMatrix, region, signal?)` and `mapLocalPoint(alignment, referencePoint)`. Matrices and maps are reference-to-current. Fit a supported, smooth local displacement grid; reject wrong-page matches and folds. Test curved synthetic oracles and the two actual photos.
- [x] Staff owner: add automatic five-line staff detection and smooth, monotone inverse y mapping in `staffGeometry.ts`. Test curvature, perspective, varying staff widths, notation preservation, flat/no-evidence behavior and cancellation. Measure the actual photographs.
- [x] Coordinator: add `reconstructPage(captures, corners, signal?)` accepting one to five genuine views. Compose perspective correction and staff warp into sampling; use supported local correspondences for conservative multi-view detail. Keep `mergeCaptures` as the five-view camera wrapper. Remove glare-only complexity where it conflicts with the new purpose.
- [x] Coordinator: produce reproducible real-photo acceptance and before/after images without duplicated inputs. Clearly distinguish the genuine two-view case and the independent one-view case. Retain titles, notes and page detail within the selected visible crop.
- [x] Fresh Astra reviewers: examine numerical integrity, the three repairs, real outputs, camera behavior and unresolved limitations; fix supported findings.
- [x] Coordinator: run all available `pnpm verify` gates and formatting; prepare scanning documentation and PR #133 for the reviewed repair. Commit explicit paths and push the feature branch; never merge main without confirmation.
