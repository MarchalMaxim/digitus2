import { expect, it, vi } from 'vitest';
import { hasTorch, releaseCamera, setTorch } from './device.js';

function track(capabilities: object | (() => never), applied: unknown[] = []) {
  return {
    getCapabilities: typeof capabilities === 'function' ? capabilities : () => capabilities,
    applyConstraints: vi.fn(async (constraints: unknown) => {
      applied.push(constraints);
    }),
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

it('offers the light only when the camera reports one', () => {
  expect(hasTorch(track({ torch: true }))).toBe(true);
  expect(hasTorch(track({ torch: false }))).toBe(false);
  expect(hasTorch(track({}))).toBe(false);
  expect(
    hasTorch(
      track(() => {
        throw new Error('not supported');
      }),
    ),
  ).toBe(false);
  expect(hasTorch({} as MediaStreamTrack)).toBe(false);
  expect(hasTorch(undefined)).toBe(false);
});

it('sets the light through an advanced constraint and reports a refusal', async () => {
  const applied: unknown[] = [];
  expect(await setTorch(track({ torch: true }, applied), true)).toBe(true);
  expect(applied).toEqual([{ advanced: [{ torch: true }] }]);
  const refusing = track({ torch: true });
  vi.mocked(refusing.applyConstraints).mockRejectedValue(
    new DOMException('no', 'OverconstrainedError'),
  );
  expect(await setTorch(refusing, true)).toBe(false);
});

it('switches the light off and lets the request land before stopping every track', async () => {
  const order: string[] = [];
  const video = track({ torch: true });
  vi.mocked(video.applyConstraints).mockImplementation(async () => {
    order.push('light off');
  });
  vi.mocked(video.stop).mockImplementation(() => order.push('stop'));
  await releaseCamera({ getTracks: () => [video] } as unknown as MediaStream, true);
  expect(order).toEqual(['light off', 'stop']);
  await releaseCamera(undefined, true);
  // A camera that never answers the light request is still stopped.
  const silent = track({ torch: true });
  vi.mocked(silent.applyConstraints).mockReturnValue(new Promise(() => {}));
  await releaseCamera({ getTracks: () => [silent] } as unknown as MediaStream, true);
  expect(silent.stop).toHaveBeenCalledTimes(1);
});
