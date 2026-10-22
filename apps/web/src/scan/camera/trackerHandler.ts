/**
 * What the camera's tracker answers about a frame (issue 143), the same in the tracker worker and,
 * where there is none, on the main thread: `measure` (light, blur, the page's outline, sharpness)
 * while aiming, and `track` (where the page's reference is in this frame) while views are taken.
 * The reference is prepared once (its features) for every frame tracked against it.
 */
import { measureFrame, type FrameQuality } from './quality.js';
import {
  prepareReference,
  registerFrame,
  sharpness,
  type Frame,
  type Point,
  type PreparedReference,
  type Registration,
} from './vision.js';

export type TrackerRequest =
  | { type: 'reference'; frame: Frame; region: readonly Point[] }
  | { type: 'measure'; id: number; frame: Frame }
  | { type: 'track'; id: number; frame: Frame };

/** Every answer hands its frame back, so the caller keeps the pixels it lent. */
export type TrackerAnswer =
  | { type: 'measure'; id: number; frame: Frame; ms: number; quality: FrameQuality; sharp: number }
  | {
      type: 'track';
      id: number;
      frame: Frame;
      ms: number;
      registration: Registration | null;
      sharp: number;
    }
  | { type: 'failed'; id: number; frame: Frame };
export type Measured = Extract<TrackerAnswer, { type: 'measure' }>;
export type Tracked = Extract<TrackerAnswer, { type: 'track' }>;

/**
 * The analysis itself, the same in the worker and on the main thread. It keeps the reference,
 * prepared once (its features), for every frame tracked against it. `ms` is the work's own time.
 */
export function trackerHandler(): (request: TrackerRequest) => TrackerAnswer | undefined {
  let reference: PreparedReference | undefined;
  let region: readonly Point[] | undefined;
  return (request) => {
    if (request.type === 'reference') {
      region = request.region;
      try {
        reference = prepareReference(request.frame, request.region);
      } catch {
        // Unpreparable: every frame then reads as not registered, and the camera says so.
        reference = undefined;
      }
      return undefined;
    }
    const start = performance.now();
    const { id, frame } = request;
    try {
      if (request.type === 'measure') {
        const quality = measureFrame(frame);
        const sharp = sharpness(frame);
        return { type: 'measure', id, frame, quality, sharp, ms: performance.now() - start };
      }
      const sharp = sharpness(frame);
      const registration = reference ? registerFrame(reference, frame, region) : null;
      return { type: 'track', id, frame, registration, sharp, ms: performance.now() - start };
    } catch {
      return { type: 'failed', id, frame };
    }
  };
}
