# Guided multi-page score camera

Build the requested PhotoScan-style four-point acquisition into digitus2's existing multi-page score import. The implementation stays in the web app, TypeScript, on the existing camera and recognition route.

## Capture behavior

One page begins with a reference photograph. The user then moves the phone, keeping it parallel to the paper, to place the center reticle over each of four targets anchored to the photographed page. Tracking must actually move the targets with the page. Capture a view only after alignment and a steady hold; refuse tracking loss, blur, duplicate viewpoints, and incomplete page coverage. A manual capture remains available once alignment is valid for accessibility. Do not implement decorative targets, a timer slideshow, four corner crops, or four unrelated photos.

Register all five overlapping views to the reference. Produce one rectified page with conservative glare reduction that preserves black music notation. Reject unreliable alignment rather than introducing duplicate notes. Scope is flat printed pages; curved books must be flattened and retried. Provide editable page corners and a review with retake/keep. No proprietary Google assets, code or service is used.

## Multiple pages and integration

The camera stays open between pages. Keep a reviewed page, photograph the next page, and finish once all pages are captured. Existing page thumbnails allow ordering, rotation, removal, and adding ordinary images. Respect the existing 20-page and 10-MB-per-page limits. Finished pages enter the existing recognition and source-versus-recognition review flow together in reading order. Capture and processing stay local; only explicit recognition submits images to the existing configured scanner.

The existing quiet camera entry on touch devices opens the guided camera. A native camera/file fallback remains available if live camera access fails or is unsupported. Explain denied permission, HTTPS requirements, camera contention, tracking loss and insufficient overlap. Cancel/navigation releases media tracks, frame callbacks, image bitmaps, object URLs and intermediate images, including late asynchronous work.

## UI constraints

Keep the existing monochrome interface and exactly one red element visible. Camera overlays use white/black marks; only the current primary action uses red. Hide the underlying app while the camera is open. Controls appear only for the current stage. All text follows the five existing locales. Respect reduced motion, keyboard operation, touch targets and dialog focus restoration.

## Verification

Unit-test image geometry and registration using synthetic notation with known projective transforms, occlusion, glare, repeated staff lines and unrelated images. Assert all views contribute and dark marks survive. Test alignment/dwell reset and stale camera operations. Exercise two-page capture, retake, cancel, fallback and existing recognition integration in Playwright with controlled camera frames. Run pnpm verify and pnpm format:check. A fresh reviewer checks the UI and numerical output. Real phone optics, autofocus and glare remain a manual acceptance check and must be reported honestly.

## Sources

- https://support.google.com/photos/answer/7177983?hl=en — initial capture, four dots, center reticle, keep the phone parallel.
- https://research.google/blog/photoscan-taking-glare-free-pictures-of-pictures/ — five views, feature registration, glare reduction, rectification; nonrigid pages need more than one homography.

Implementation choices (ours): use bounded local processing without a new hosted runtime; retain the existing recognizer and batch model; reject curved or untrackable pages rather than claiming Google's full reconstruction quality.

User clarification during implementation (2026-10-21): reconstruction into a planar scan is central. Account for output-resolution alignment error, use local refinement before combining images, and recover rectangular proportions from perspective geometry when the camera assumptions and views support it. Near-frontal degeneracy, unknown lens distortion and curved paper must be described honestly. Google's public description discloses its pipeline but not its optimizer, parameters, crop detector or aspect estimator.
