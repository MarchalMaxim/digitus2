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

/** A live camera whose frames the test delivers one at a time, at the times it chooses. */
async function liveCamera({
  width = 1001,
  height = 563,
  track = new EventTarget() as MediaStreamTrack,
}: { width?: number; height?: number; track?: MediaStreamTrack } = {}) {
  let now = 0;
  let nextFrame!: VideoFrameRequestCallback;
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
  track.stop ??= () => {};
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }),
    },
  });
  render(<GuidedCamera maxPages={1} onClose={() => {}} onComplete={() => {}} />);
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
  await waitFor(() => expect(nextFrame).toBeTypeOf('function'));
  return (time: number) =>
    act(() => {
      now = time;
      nextFrame(time, { mediaTime: time / 1000 } as VideoFrameCallbackMetadata);
    });
}

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
  expect(applied.slice(1)).toEqual([{ advanced: [{ torch: false }] }, 'stop']);
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
