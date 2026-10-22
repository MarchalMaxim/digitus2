# Guided multi-page score camera

Build the requested PhotoScan-style four-point acquisition into digitus2's existing multi-page score import. The implementation stays in the web app, TypeScript, on the existing camera and recognition route.

## Capture behavior

One page begins with a reference photograph. Every live frame is measured (brightness, a content-independent blur estimate, glare, the page outline) and the reader is told what to fix first. The shutter is never a disabled button: a press takes the sharpest frame of a short burst, and a frame too blurred to track is refused with a message, then kept as a single photograph on the second press. The camera's torch is offered when the browser reports one. The user then moves the phone, keeping it parallel to the paper, to place the center reticle over each of four targets anchored to the photographed page. Tracking must actually move the targets with the page. Capture a view only after alignment and a steady hold; refuse tracking loss, blur, duplicate viewpoints, and incomplete page coverage. The view is taken by the hold itself; there is no manual capture button, which would sit disabled while the circle is off the dot (issue 143). A quiet **Skip the rest** appears only after ten seconds on one dot and finishes the page with the photos taken so far. Do not implement decorative targets, a timer slideshow, four corner crops, or four unrelated photos.

Register all five overlapping views to the reference. Produce one rectified page while preserving black music notation. Support smoothly curved printed score pages through staff-based straightening. Reject unreliable alignment rather than introducing duplicate notes. Find the page outline automatically when the page contrasts with its background; provide editable page corners in the review, with retake/keep. No proprietary Google assets, code or service is used. Glare removal is outside the requested scope.

## Multiple pages and integration

The camera stays open between pages. Keep a reviewed page, photograph the next page, and finish once all pages are captured. Existing page thumbnails allow ordering, rotation, removal, and adding ordinary images. Respect the existing 20-page and 10-MB-per-page limits. Finished pages enter the existing recognition and source-versus-recognition review flow together in reading order. Capture and processing stay local; only explicit recognition submits images to the existing configured scanner.

The existing quiet camera entry on touch devices opens the guided camera. A native camera/file fallback remains available if live camera access fails or is unsupported. Explain denied permission, HTTPS requirements, camera contention, tracking loss and insufficient overlap. Cancel/navigation releases media tracks, frame callbacks, image bitmaps, object URLs and intermediate images, including late asynchronous work.

## UI constraints

Keep the existing monochrome interface and exactly one red element visible. The camera is a black viewfinder with white type and marks. The red element is the shutter while aiming, the dot to reach while tracking, and the primary action elsewhere. Hide the underlying app while the camera is open. Controls appear only for the current stage. All text follows the five existing locales. Respect reduced motion, keyboard operation, touch targets and dialog focus restoration.

## Verification

Unit-test image geometry and registration using synthetic notation with known projective transforms, smooth curvature, occlusion, repeated staff lines and unrelated images. Assert all views contribute, dark marks survive and already-flat geometry stays unchanged. Test alignment/dwell reset and stale camera operations. Exercise two-page capture, retake, cancel, fallback and existing recognition integration in Playwright with controlled camera frames. Run pnpm verify and pnpm format:check. Independent Astra reviewers check the acquisition, numerical output and actual-photo evidence. Real phone optics and autofocus remain a device acceptance check.

## Sources

- https://support.google.com/photos/answer/7177983?hl=en — initial capture, four dots, center reticle, keep the phone parallel.
- https://research.google/blog/photoscan-taking-glare-free-pictures-of-pictures/ — five views, feature registration, glare reduction, rectification; nonrigid pages need more than one homography.

Implementation choices: bounded local processing without a new hosted runtime; the existing recognizer and batch model; independent algorithms whose limits are explicit. Google's public description discloses its pipeline but not its optimizer, parameters, crop detector or aspect estimator.

## Reconstruction and evidence

Straighten smoothly curved printed piano staves using detected five-line staff groups and a smooth, monotone image warp. Preserve photographed pixels and symbols, with no generative reconstruction. Local spatially varying alignment registers overlapping views without forcing the entire curved page into one homography. Poorly supported areas retain the reference; unreliable page identity is rejected. Staff geometry comes from the reference, while agreeing aligned views contribute image observations. Missing content is not reconstructed.

Manual-corner uncertainty must prevent false metric aspect confidence; every accepted capture target must be reachable from the chosen crop; registration must require distributed evidence inside the selected page. Preserve cancellation, memory bounds, review/retake and multi-page ordering. Recover rectangular proportions only when camera assumptions and corner sensitivity support them; curved pages use approximate proportions. Strong folds, horizontal foreshortening and unknown lens distortion remain limits.

The production reconstruction API must accept the actual available view count (one to five), so single-photo curvature correction and the two real same-page photos can be tested without duplicating inputs. The guided camera still acquires a reference and four distinct views. Real-photo tests record input hashes, manual crop coordinates, staff residual measurements, correspondence confidence and output files. Keep private images outside version control. A fresh Astra review and the normal verification loop gate completion. Five-view handheld capture and arbitrary creases remain distinct from the available two-view real-photo evidence.
