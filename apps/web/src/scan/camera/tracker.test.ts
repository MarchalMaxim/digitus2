import { afterEach, describe, expect, it, vi } from 'vitest';
import * as quality from './quality.js';
import { createTracker, type TrackerWorker } from './tracker.js';
import { trackerHandler, type TrackerAnswer, type TrackerRequest } from './trackerHandler.js';
import * as vision from './vision.js';

afterEach(() => vi.restoreAllMocks());

const frame = (width = 32, height = 24) => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
});
const REGION = [
  { x: 2, y: 2 },
  { x: 30, y: 2 },
  { x: 30, y: 22 },
  { x: 2, y: 22 },
];
const MATRIX = [1, 0, 3, 0, 1, 4, 0, 0, 1];

/** A worker the test answers by hand, recording what it was sent and what was transferred. */
function fakeWorker() {
  const sent: { message: TrackerRequest; transfer: Transferable[] }[] = [];
  const worker: TrackerWorker & { sent: typeof sent; terminated: boolean } = {
    sent,
    terminated: false,
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message, transfer) {
      sent.push({ message, transfer });
    },
    terminate() {
      worker.terminated = true;
    },
  };
  const reply = (answer: TrackerAnswer) =>
    worker.onmessage!({ data: answer } as MessageEvent<TrackerAnswer>);
  return { worker, reply };
}

describe('the camera tracker', () => {
  it('prepares the reference once and tracks every frame against it, inside the page', () => {
    const prepare = vi.spyOn(vision, 'prepareReference');
    const register = vi
      .spyOn(vision, 'registerFrame')
      .mockReturnValue({ matrix: MATRIX, inliers: 20, error: 0.5, coverage: 0.6 });
    vi.spyOn(vision, 'sharpness').mockReturnValue(120);
    const handle = trackerHandler();
    // Before any reference there is nothing to find.
    expect(handle({ type: 'track', id: 1, frame: frame() })).toMatchObject({
      registration: null,
      sharp: 120,
    });
    const reference = frame();
    expect(handle({ type: 'reference', frame: reference, region: REGION })).toBeUndefined();
    for (let id = 2; id < 5; id++) {
      const current = frame();
      const answer = handle({ type: 'track', id, frame: current });
      expect(answer).toMatchObject({ type: 'track', id, registration: { matrix: MATRIX } });
      // The frame goes back with its answer.
      expect(answer!.frame).toBe(current);
    }
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(reference, REGION);
    expect(register).toHaveBeenCalledTimes(3);
    expect(register.mock.calls[0]![0]).toMatchObject({ width: 32, height: 24, region: REGION });
  });

  it('measures light, blur and sharpness, and turns a failure into a failed answer', () => {
    const good = { brightness: 150, blur: 0.2, glare: 0, page: null };
    vi.spyOn(quality, 'measureFrame').mockReturnValue(good);
    vi.spyOn(vision, 'sharpness').mockReturnValue(90);
    const handle = trackerHandler();
    expect(handle({ type: 'measure', id: 7, frame: frame() })).toMatchObject({
      type: 'measure',
      id: 7,
      quality: good,
      sharp: 90,
    });
    vi.spyOn(quality, 'measureFrame').mockImplementation(() => {
      throw new Error('broken');
    });
    expect(handle({ type: 'measure', id: 8, frame: frame() })).toMatchObject({
      type: 'failed',
      id: 8,
    });
  });

  it('without a worker, answers at once on the main thread', () => {
    vi.spyOn(vision, 'sharpness').mockReturnValue(100);
    const register = vi.spyOn(vision, 'registerFrame').mockReturnValue(null);
    const tracker = createTracker(() => undefined);
    tracker.setReference(frame(), REGION);
    const answers: unknown[] = [];
    expect(tracker.track(frame(), (answer) => answers.push(answer))).toBe(true);
    expect(answers).toEqual([expect.objectContaining({ type: 'track', registration: null })]);
    expect(tracker.busy).toBe(false);
    expect(register).toHaveBeenCalledTimes(1);
    // A worker that cannot even start is no worker.
    const broken = createTracker(() => {
      throw new Error('no module workers');
    });
    expect(broken.measure(frame(), (answer) => answers.push(answer))).toBe(true);
    expect(answers).toHaveLength(2);
  });

  it('asks the worker one question at a time, lending the pixels, and skips frames meanwhile', () => {
    const { worker, reply } = fakeWorker();
    const tracker = createTracker(() => worker);
    const reference = frame();
    tracker.setReference(reference, REGION);
    // The reference is copied, not lent: the camera keeps it.
    expect(worker.sent[0]).toEqual({
      message: { type: 'reference', frame: reference, region: REGION },
      transfer: [],
    });
    const first = frame();
    const answers: unknown[] = [];
    expect(tracker.track(first, (answer) => answers.push(answer))).toBe(true);
    expect(worker.sent[1]!.transfer).toEqual([first.data.buffer]);
    expect(tracker.busy).toBe(true);
    // Busy: the next frame is refused, never queued.
    const skipped = vi.fn();
    expect(tracker.track(frame(), skipped)).toBe(false);
    expect(tracker.measure(frame(), skipped)).toBe(false);
    expect(worker.sent).toHaveLength(2);
    const { id } = worker.sent[1]!.message as { id: number };
    // An answer to some other question is not this one's.
    reply({ type: 'track', id: id + 99, frame: first, ms: 1, registration: null, sharp: 0 });
    expect(answers).toEqual([]);
    const registration = { matrix: MATRIX, inliers: 20, error: 0.5, coverage: 0.6 };
    reply({ type: 'track', id, frame: first, ms: 1, registration, sharp: 120 });
    expect(answers).toEqual([expect.objectContaining({ registration, sharp: 120, frame: first })]);
    expect(tracker.busy).toBe(false);
    expect(skipped).not.toHaveBeenCalled();
    // The answer may ask the next question at once.
    expect(tracker.measure(frame(), () => {})).toBe(true);
    reply({ type: 'failed', id: id + 1, frame: frame() });
    expect(tracker.busy).toBe(false);
  });

  it('a failed worker answers its question with nothing, then the main thread takes over', () => {
    vi.spyOn(vision, 'sharpness').mockReturnValue(100);
    const register = vi
      .spyOn(vision, 'registerFrame')
      .mockReturnValue({ matrix: MATRIX, inliers: 20, error: 0.5, coverage: 0.6 });
    const { worker } = fakeWorker();
    const tracker = createTracker(() => worker);
    tracker.setReference(frame(), REGION);
    const answers: unknown[] = [];
    tracker.track(frame(), (answer) => answers.push(answer));
    worker.onerror!(new Event('error'));
    expect(worker.terminated).toBe(true);
    expect(answers).toEqual([undefined]);
    expect(tracker.busy).toBe(false);
    // The reference the worker held is prepared again here.
    tracker.track(frame(), (answer) => answers.push(answer));
    expect(answers[1]).toMatchObject({ registration: { matrix: MATRIX } });
    expect(register.mock.calls[0]![0]).toMatchObject({ region: REGION });
  });

  it('closing stops the worker and refuses every later question', () => {
    const { worker, reply } = fakeWorker();
    const tracker = createTracker(() => worker);
    const done = vi.fn();
    tracker.measure(frame(), done);
    tracker.dispose();
    expect(worker.terminated).toBe(true);
    expect(tracker.busy).toBe(false);
    expect(tracker.measure(frame(), done)).toBe(false);
    reply({ type: 'failed', id: 1, frame: frame() });
    expect(done).not.toHaveBeenCalled();
  });
});
