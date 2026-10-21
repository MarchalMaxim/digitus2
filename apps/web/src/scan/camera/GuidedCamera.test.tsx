import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { messages as getT } from '../../i18n/i18n.js';
import { GuidedCamera } from './GuidedCamera.js';
import { targetPoints } from './captureState.js';
import * as quality from './quality.js';
import * as vision from './vision.js';

beforeEach(() => vi.stubGlobal('isSecureContext', true));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const GOOD: quality.FrameQuality = { brightness: 160, blur: 0.2, glare: 0, page: null };

/**
 * A live camera whose frames the test delivers one at a time, at the times it chooses. The
 * returned sampler also restarts the camera and changes the page capacity the caller grants.
 */
async function liveCamera({
  width = 1001,
  height = 563,
  track = new EventTarget() as MediaStreamTrack,
  maxPages = 1,
  onClose = () => {},
  onComplete = () => {},
}: {
  width?: number;
  height?: number;
  track?: MediaStreamTrack;
  maxPages?: number;
  onClose?: () => void;
  onComplete?: (files: File[]) => void;
} = {}) {
  let now = 0;
  let nextFrame: VideoFrameRequestCallback | undefined;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      drawImage: () => {},
      putImageData: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }),
    } as unknown as CanvasRenderingContext2D;
  });
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
    callback(new Blob([new Uint8Array([255, 216, 255, 1])], { type: 'image/jpeg' })),
  );
  track.stop ??= () => {};
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }),
    },
  });
  const camera = (pages: number) => (
    <GuidedCamera maxPages={pages} onClose={onClose} onComplete={onComplete} />
  );
  const { rerender } = render(camera(maxPages));
  const video = screen.getByRole('dialog').querySelector('video')!;
  Object.defineProperties(video, {
    srcObject: { value: null, writable: true },
    videoWidth: { value: width },
    videoHeight: { value: height },
    requestVideoFrameCallback: {
      value: (callback: VideoFrameRequestCallback) => {
        nextFrame = callback;
        return 1;
      },
    },
    cancelVideoFrameCallback: { value: () => {} },
  });
  const ready = () => waitFor(() => expect(nextFrame).toBeTypeOf('function'));
  await ready();
  const sample = (time: number) =>
    act(() => {
      now = time;
      nextFrame!(time, { mediaTime: time / 1000 } as VideoFrameCallbackMetadata);
    });
  return Object.assign(sample, {
    /** Press Restart and wait for the fresh session's first frame request (never the dead one's). */
    async restart() {
      nextFrame = undefined;
      fireEvent.click(screen.getByRole('button', { name: getT().scan.camera.restart }));
      await ready();
    },
    /** The caller grants a different number of pages, as the scan page does when its batch fills. */
    setMaxPages: (pages: number) => rerender(camera(pages)),
  });
}

/** Sharp frames with a page that photographs well: a press settles on the first frame. */
function sharpFrames() {
  vi.spyOn(vision, 'sharpness').mockReturnValue(100);
  vi.spyOn(quality, 'measureFrame').mockReturnValue(GOOD);
  vi.spyOn(quality, 'advise').mockReturnValue('good');
  vi.spyOn(quality, 'photographable').mockReturnValue(true);
}
/** Frames too blurred to track: a press runs its whole burst. */
function blurryFrames() {
  vi.spyOn(vision, 'sharpness').mockReturnValue(20);
  vi.spyOn(quality, 'measureFrame').mockReturnValue({ ...GOOD, blur: 0.9 });
  vi.spyOn(quality, 'advise').mockReturnValue('blurry');
  vi.spyOn(quality, 'photographable').mockReturnValue(false);
}
function reconstructs() {
  vi.spyOn(vision, 'reconstructPage').mockResolvedValue({
    frame: { width: 10, height: 10, data: new Uint8ClampedArray(400) },
  } as unknown as Awaited<ReturnType<typeof vision.reconstructPage>>);
}
/**
 * One press of the shutter whose burst sees the frames at the given times and then runs out its
 * 1.2 s on fake timers. Only the burst runs on them; nothing may wait on a real timer meanwhile.
 */
function pressThroughBurst(sample: (time: number) => void, ...times: number[]) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    fireEvent.click(screen.getByRole('button', { name: getT().scan.camera.capture }));
    for (const time of times) sample(time);
    act(() => vi.advanceTimersByTime(1200));
  } finally {
    vi.useRealTimers();
  }
}
/** The reader leaves the page (back gesture, another app): the camera session is interrupted. */
const interrupt = () => act(() => void window.dispatchEvent(new Event('popstate')));
const LIGHT_ON = { advanced: [{ torch: true }] };
const LIGHT_OFF = { advanced: [{ torch: false }] };
/** A camera with a light that records each request; with `pending`, requests wait to be answered. */
function lightTrack(applied: unknown[], pending?: (() => void)[]) {
  const track = new EventTarget() as MediaStreamTrack;
  Object.assign(track, {
    getCapabilities: () => ({ torch: true }),
    applyConstraints: (constraints: unknown) => {
      applied.push(constraints);
      return pending ? new Promise<void>((resolve) => pending.push(resolve)) : Promise.resolve();
    },
    stop: () => applied.push('stop'),
  });
  return track;
}
const answer = (pending: (() => void)[]) =>
  act(async () => pending.splice(0).forEach((resolve) => resolve()));

it('a press takes the sharp frame, then the page is tracked and each view taken by itself', async () => {
  const width = 1001;
  const height = 563;
  const trackingWidth = 360;
  const trackingHeight = 202;
  vi.spyOn(vision, 'sharpness').mockReturnValue(100);
  vi.spyOn(quality, 'measureFrame').mockReturnValue(GOOD);
  vi.spyOn(quality, 'advise').mockReturnValue('good');
  vi.spyOn(quality, 'photographable').mockReturnValue(true);
  const sample = await liveCamera({ width, height });
  sample(0);
  const t = getT().scan.camera;
  expect(screen.getByRole('status')).toHaveTextContent(t.aim);
  // The shutter is the screen's one red element, and it is never disabled.
  const shutter = screen.getByRole('button', { name: t.capture });
  expect(shutter).toHaveClass('is-red');
  expect(shutter).toBeEnabled();
  expect(screen.getByRole('dialog').querySelectorAll('.is-red')).toHaveLength(1);
  fireEvent.click(shutter);
  expect(screen.getByRole('status')).toHaveTextContent(t.hold);
  // No corner step: no page stood out, so the page is the frame less a 5% margin.
  const corners = [
    { x: width * 0.05, y: height * 0.05 },
    { x: width * 0.95, y: height * 0.05 },
    { x: width * 0.95, y: height * 0.95 },
    { x: width * 0.05, y: height * 0.95 },
  ];
  const region = corners.map((point) => ({
    x: (point.x * trackingWidth) / width,
    y: (point.y * trackingHeight) / height,
  }));
  const target = targetPoints(corners, { x: width / 2, y: height / 2 })[0]!;
  const matrix = [
    1,
    0,
    ((width / 2 - target.x) * trackingWidth) / width,
    0,
    1,
    ((height / 2 - target.y) * trackingHeight) / height,
    0,
    0,
    1,
  ];
  const register = vi.spyOn(vision, 'registerFrame').mockReturnValue({
    matrix,
    inliers: 30,
    error: 0,
    coverage: 0.8,
  });
  sample(120);
  expect(screen.getByRole('status')).toHaveTextContent(t.align);
  expect(screen.getByText(t.step(2, 5))).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.capture })).toBeNull();
  sample(240);
  expect(register).toHaveBeenCalledTimes(1);
  expect(register.mock.calls[0]![2]).toEqual(region);
  expect(register.mock.calls[0]![0]).toMatchObject({
    width: trackingWidth,
    height: trackingHeight,
  });
  expect(screen.getByRole('status')).toHaveTextContent(t.hold);
  expect(screen.getByRole('dialog').querySelector('[data-holding="true"]')).not.toBeNull();
  // The dot to reach is the one red element while the reader moves the phone.
  expect(screen.getByRole('dialog').querySelectorAll('.is-red')).toHaveLength(1);
  expect(screen.getByRole('dialog').querySelector('[data-camera-target="1"]')).toHaveClass(
    'is-red',
  );
  for (let time = 360; time <= 960; time += 120) sample(time);
  // The hold completed: the still is registered again before it counts.
  expect(register.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(register.mock.calls.at(-1)![2]).toEqual(region);
  expect(screen.getByText(t.step(3, 5))).toBeInTheDocument();
});

it('a blurred press says so; a second one keeps the single photograph for review', async () => {
  vi.spyOn(vision, 'sharpness').mockReturnValue(20);
  vi.spyOn(quality, 'measureFrame').mockReturnValue({ ...GOOD, blur: 0.9 });
  vi.spyOn(quality, 'advise').mockReturnValue('blurry');
  vi.spyOn(quality, 'photographable').mockReturnValue(false);
  const sample = await liveCamera();
  sample(0);
  const t = getT().scan.camera;
  fireEvent.click(screen.getByRole('button', { name: t.capture }));
  sample(120);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t.retryBlurry), {
    timeout: 3000,
  });
  fireEvent.click(screen.getByRole('button', { name: t.capture }));
  await waitFor(() => expect(screen.queryByRole('button', { name: t.capture })).toBeNull(), {
    timeout: 3000,
  });
});

it('offers the light only when the camera has one, and asks for it when the page is dark', async () => {
  vi.spyOn(vision, 'sharpness').mockReturnValue(100);
  vi.spyOn(quality, 'measureFrame').mockReturnValue({ ...GOOD, brightness: 20 });
  vi.spyOn(quality, 'advise').mockReturnValue('dark');
  const applied: unknown[] = [];
  const track = new EventTarget() as MediaStreamTrack;
  Object.assign(track, {
    getCapabilities: () => ({ torch: true }),
    applyConstraints: async (constraints: unknown) => {
      applied.push(constraints);
    },
    stop: () => applied.push('stop'),
  });
  const sample = await liveCamera({ track });
  sample(0);
  const t = getT().scan.camera;
  expect(screen.getByRole('status')).toHaveTextContent(t.dark);
  const light = screen.getByRole('button', { name: t.light });
  expect(light).toHaveAttribute('aria-pressed', 'false');
  expect(light).toHaveAttribute('data-attention', 'true');
  await act(async () => fireEvent.click(light));
  expect(applied).toEqual([{ advanced: [{ torch: true }] }]);
  expect(light).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: t.close }));
  // The light is switched off first; the tracks stop once that request lands.
  await waitFor(() => expect(applied.slice(1)).toEqual([{ advanced: [{ torch: false }] }, 'stop']));
});

it('has no light button when the camera reports none', async () => {
  vi.spyOn(vision, 'sharpness').mockReturnValue(100);
  vi.spyOn(quality, 'measureFrame').mockReturnValue(GOOD);
  vi.spyOn(quality, 'advise').mockReturnValue('dark');
  const sample = await liveCamera();
  sample(0);
  const t = getT().scan.camera;
  expect(screen.getByRole('status')).toHaveTextContent(t.darkNoLight);
  expect(screen.queryByRole('button', { name: t.light })).toBeNull();
});

it('stops every track when permission resolves after the dialog was closed', async () => {
  let grant!: (stream: MediaStream) => void;
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          grant = resolve;
        }),
    },
  });
  const stopped: string[] = [];
  const stream = {
    getTracks: () => [{ stop: () => stopped.push('video') }, { stop: () => stopped.push('extra') }],
  } as unknown as MediaStream;
  const { unmount } = render(
    <GuidedCamera
      maxPages={2}
      onClose={() => {}}
      onComplete={() => {
        throw Error('late files');
      }}
    />,
  );
  expect(screen.getByRole('dialog').querySelectorAll('.is-red')).toHaveLength(1);
  expect(screen.getByRole('button', { name: getT().scan.camera.cancel })).toHaveClass('is-red');
  unmount();
  await act(async () => grant(stream));
  expect(stopped).toEqual(['video', 'extra']);
});

it('offers explicit native fallback after denied permission and rejects nonimage files', async () => {
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => {
        throw new DOMException('denied', 'NotAllowedError');
      },
    },
  });
  const completed: File[][] = [];
  render(
    <GuidedCamera maxPages={2} onClose={() => {}} onComplete={(files) => completed.push(files)} />,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(getT().scan.camera.denied);
  const input = screen.getByLabelText(getT().scan.camera.fallback);
  fireEvent.change(input, {
    target: { files: [new File(['%PDF-'], 'score.pdf', { type: 'application/pdf' })] },
  });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(getT().scan.camera.processingFailed),
  );
  expect(completed).toEqual([]);
});

it('validates native fallback and finishes only after the reader keeps it', async () => {
  vi.stubGlobal('navigator', { mediaDevices: undefined });
  const completed: File[][] = [];
  render(
    <GuidedCamera maxPages={1} onClose={() => {}} onComplete={(files) => completed.push(files)} />,
  );
  const file = new File([new Uint8Array([255, 216, 255, 1])], 'image.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText(getT().scan.camera.fallback), {
    target: { files: [file] },
  });
  await screen.findByRole('button', { name: getT().scan.camera.finish(1) });
  expect(completed).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: getT().scan.camera.finish(1) }));
  await waitFor(() => expect(completed[0]).toHaveLength(1));
  expect(completed[0]![0]!.type).toBe('image/jpeg');
});

it('handles track end by releasing the stream and showing restart and fallback', async () => {
  const track = new EventTarget() as MediaStreamTrack;
  const stopped: boolean[] = [];
  track.stop = () => stopped.push(true);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }),
    },
  });
  render(<GuidedCamera maxPages={2} onClose={() => {}} onComplete={() => {}} />);
  await act(async () => {});
  act(() => track.dispatchEvent(new Event('ended')));
  expect(await screen.findByRole('alert')).toHaveTextContent(getT().scan.camera.interrupted);
  expect(stopped.length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: getT().scan.camera.restart })).toBeInTheDocument();
  expect(screen.getByLabelText(getT().scan.camera.fallback)).toHaveAttribute(
    'capture',
    'environment',
  );
});

it('traps focus in the dialog and cancel never returns kept or late files', async () => {
  vi.stubGlobal('navigator', { mediaDevices: undefined });
  const closed: boolean[] = [];
  const completed: File[][] = [];
  render(
    <GuidedCamera
      maxPages={2}
      onClose={() => closed.push(true)}
      onComplete={(files) => completed.push(files)}
    />,
  );
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  const close = screen.getByRole('button', { name: getT().scan.camera.close });
  close.focus();
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).not.toBe(close);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(closed).toEqual([true]);
  expect(completed).toEqual([]);
});

it('rejects native input beyond the remaining page capacity', async () => {
  vi.stubGlobal('navigator', { mediaDevices: undefined });
  const completed: File[][] = [];
  render(
    <GuidedCamera maxPages={1} onClose={() => {}} onComplete={(files) => completed.push(files)} />,
  );
  const files = [1, 2].map(
    (n) => new File([new Uint8Array([255, 216, 255, n])], `${n}.jpg`, { type: 'image/jpeg' }),
  );
  fireEvent.change(screen.getByLabelText(getT().scan.camera.fallback), { target: { files } });
  expect(await screen.findByRole('alert')).toHaveTextContent(getT().scan.camera.tooMany);
  expect(
    screen.queryByRole('button', { name: getT().scan.camera.finish(2) }),
  ).not.toBeInTheDocument();
  expect(completed).toEqual([]);
});

it('rejects native validation that finishes after cancel', async () => {
  vi.stubGlobal('navigator', { mediaDevices: undefined });
  const completed: File[][] = [];
  render(
    <GuidedCamera maxPages={2} onClose={() => {}} onComplete={(files) => completed.push(files)} />,
  );
  const file = new File([new Uint8Array([255, 216, 255, 1])], 'image.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText(getT().scan.camera.fallback), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole('button', { name: getT().scan.camera.close }));
  await act(async () => {});
  expect(
    screen.queryByRole('button', { name: getT().scan.camera.finish(1) }),
  ).not.toBeInTheDocument();
  expect(completed).toEqual([]);
});

it('cancels a pending permission on navigation and retains a working native fallback', async () => {
  let grant!: (stream: MediaStream) => void;
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          grant = resolve;
        }),
    },
  });
  const stopped: boolean[] = [];
  render(<GuidedCamera maxPages={2} onClose={() => {}} onComplete={() => {}} />);
  act(() => window.dispatchEvent(new Event('popstate')));
  await act(async () =>
    grant({ getTracks: () => [{ stop: () => stopped.push(true) }] } as unknown as MediaStream),
  );
  expect(stopped).toEqual([true]);
  expect(screen.getByRole('alert')).toHaveTextContent(getT().scan.camera.interrupted);
  const file = new File([new Uint8Array([255, 216, 255, 1])], 'image.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText(getT().scan.camera.fallback), {
    target: { files: [file] },
  });
  expect(
    await screen.findByRole('button', { name: getT().scan.camera.finish(1) }),
  ).toBeInTheDocument();
});

it('issue 143: with every page kept, an interruption leaves finishing as the one red way on', async () => {
  blurryFrames();
  reconstructs();
  const completed: File[][] = [];
  const sample = await liveCamera({ maxPages: 1, onComplete: (files) => completed.push(files) });
  const t = getT().scan.camera;
  const dialog = screen.getByRole('dialog');
  const oneEnabledRed = () => {
    expect(dialog.querySelectorAll('.is-red')).toHaveLength(1);
    expect(dialog.querySelectorAll('.is-red:disabled')).toHaveLength(0);
  };
  sample(0);
  pressThroughBurst(sample, 120);
  expect(screen.getByRole('status')).toHaveTextContent(t.retryBlurry);
  pressThroughBurst(sample, 240);
  // A blurred single photograph: the review's red may be Retake rather than Keep; either way one.
  const keep = await screen.findByRole('button', { name: t.keep });
  expect(keep).toBeEnabled();
  oneEnabledRed();
  fireEvent.click(keep);
  expect(screen.getByRole('button', { name: t.finish(1) })).toHaveClass('is-red');
  oneEnabledRed();
  // The phone locks with the batch full: no camera to restart, no fallback to add a page with.
  interrupt();
  expect(screen.getByRole('alert')).toHaveTextContent(t.interrupted);
  expect(screen.queryByRole('button', { name: t.restart })).toBeNull();
  expect(screen.queryByLabelText(t.fallback)).toBeNull();
  const finish = screen.getByRole('button', { name: t.finish(1) });
  expect(finish).toHaveClass('is-red');
  expect(finish).toBeEnabled();
  oneEnabledRed();
  fireEvent.click(finish);
  expect(completed).toHaveLength(1);
  expect(completed[0]).toHaveLength(1);
}, 15000);

it('issue 143: Keep on a batch that is already full says so instead of doing nothing', async () => {
  blurryFrames();
  reconstructs();
  const sample = await liveCamera({ maxPages: 1 });
  const t = getT().scan.camera;
  sample(0);
  pressThroughBurst(sample, 120);
  pressThroughBurst(sample, 240);
  const keep = await screen.findByRole('button', { name: t.keep });
  sample.setMaxPages(0);
  fireEvent.click(keep);
  expect(screen.getByRole('alert')).toHaveTextContent(t.tooMany);
  expect(screen.getByRole('button', { name: t.keep })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.finish(1) })).toBeNull();
}, 15000);

it('issue 143: a restarted camera forgets the blurred press of the session before it', async () => {
  blurryFrames();
  reconstructs();
  const sample = await liveCamera({ maxPages: 2 });
  const t = getT().scan.camera;
  sample(0);
  pressThroughBurst(sample, 120);
  expect(screen.getByRole('status')).toHaveTextContent(t.retryBlurry);
  interrupt();
  await sample.restart();
  sample(1000);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status')).not.toHaveTextContent(t.retryBlurry);
  // The first blurred press of the new session is told to try again, not kept as the page.
  pressThroughBurst(sample, 1120);
  expect(screen.getByRole('status')).toHaveTextContent(t.retryBlurry);
  expect(screen.getByRole('button', { name: t.capture })).toBeInTheDocument();
}, 15000);

it('issue 143: corner editing from a failed page does not follow the reader into the next one', async () => {
  blurryFrames();
  vi.spyOn(vision, 'reconstructPage').mockRejectedValue(new Error('no page'));
  const sample = await liveCamera({ maxPages: 2 });
  const t = getT().scan.camera;
  const dialog = screen.getByRole('dialog');
  sample(0);
  pressThroughBurst(sample, 120);
  pressThroughBurst(sample, 240);
  await screen.findByRole('button', { name: t.useCorners });
  expect(dialog.querySelectorAll('.camera-corner')).toHaveLength(4);
  interrupt();
  expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([t.interrupted]);
  await sample.restart();
  sample(1000);
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
  // A sharp press reaches tracking: the old page's corner handles must not come back over it.
  sharpFrames();
  fireEvent.click(screen.getByRole('button', { name: t.capture }));
  sample(1120);
  expect(screen.getByText(t.step(2, 5))).toBeInTheDocument();
  expect(dialog.querySelectorAll('.camera-corner')).toHaveLength(0);
  expect(screen.queryByText(t.cornerHint)).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent(t.align);
}, 15000);

it('issue 143: the light goes off while a page is prepared and comes back for the next one', async () => {
  blurryFrames();
  reconstructs();
  const applied: unknown[] = [];
  const sample = await liveCamera({ maxPages: 2, track: lightTrack(applied) });
  const t = getT().scan.camera;
  sample(0);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: t.light })));
  expect(applied).toEqual([LIGHT_ON]);
  pressThroughBurst(sample, 120);
  pressThroughBurst(sample, 240);
  // Off the moment processing starts, and no light button while there is nothing to light.
  expect(applied).toEqual([LIGHT_ON, LIGHT_OFF]);
  expect(screen.queryByRole('button', { name: t.light })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: t.keep }));
  expect(screen.getByRole('button', { name: t.finish(1) })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.light })).toBeNull();
  expect(applied).toEqual([LIGHT_ON, LIGHT_OFF]);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: t.nextPage })));
  expect(applied).toEqual([LIGHT_ON, LIGHT_OFF, LIGHT_ON]);
  expect(screen.getByRole('button', { name: t.light })).toHaveAttribute('aria-pressed', 'true');
}, 15000);

it('issue 143: a quick second tap on the light waits for the first request', async () => {
  sharpFrames();
  const applied: unknown[] = [];
  const pending: (() => void)[] = [];
  const sample = await liveCamera({ maxPages: 2, track: lightTrack(applied, pending) });
  const t = getT().scan.camera;
  sample(0);
  const light = screen.getByRole('button', { name: t.light });
  fireEvent.click(light);
  fireEvent.click(light);
  expect(applied).toEqual([LIGHT_ON]);
  expect(light).toHaveAttribute('aria-pressed', 'true');
  await answer(pending);
  expect(light).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(light);
  expect(applied).toEqual([LIGHT_ON, LIGHT_OFF]);
  expect(light).toHaveAttribute('aria-pressed', 'false');
  await answer(pending);
});

it('issue 143: closing while the light is coming on switches it off before the camera stops', async () => {
  sharpFrames();
  const applied: unknown[] = [];
  const pending: (() => void)[] = [];
  const onClose = vi.fn();
  const sample = await liveCamera({ maxPages: 2, track: lightTrack(applied, pending), onClose });
  const t = getT().scan.camera;
  sample(0);
  fireEvent.click(screen.getByRole('button', { name: t.light }));
  fireEvent.click(screen.getByRole('button', { name: t.close }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(applied).toEqual([LIGHT_ON, LIGHT_OFF]);
  await answer(pending);
  await waitFor(() => expect(applied).toEqual([LIGHT_ON, LIGHT_OFF, 'stop']));
});

it('issue 143: Escape and Tab still work after the camera moves on by itself', async () => {
  sharpFrames();
  const onClose = vi.fn();
  const sample = await liveCamera({ maxPages: 2, onClose });
  const t = getT().scan.camera;
  const dialog = screen.getByRole('dialog');
  sample(0);
  const shutter = screen.getByRole('button', { name: t.capture });
  shutter.focus();
  expect(document.activeElement).toBe(shutter);
  fireEvent.click(shutter);
  sample(120);
  // The burst settled and the shutter went with the aim stage: focus stays in the dialog.
  expect(screen.queryByRole('button', { name: t.capture })).toBeNull();
  expect(document.activeElement).toBe(dialog);
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: t.close }));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('issue 143: a video that stalls during the burst is not photographed', async () => {
  sharpFrames();
  const sample = await liveCamera({ maxPages: 2 });
  const t = getT().scan.camera;
  const dialog = screen.getByRole('dialog');
  sample(0);
  // No frame arrives during the press.
  pressThroughBurst(sample);
  expect(screen.getByRole('alert')).toHaveTextContent(t.interrupted);
  expect(screen.queryByRole('button', { name: t.capture })).toBeNull();
  expect(screen.queryByText(t.step(2, 5))).toBeNull();
  expect(dialog.querySelector('.camera-flash')).toBeNull();
  expect(screen.getByRole('button', { name: t.restart })).toHaveClass('is-red');
});
